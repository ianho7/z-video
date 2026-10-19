use log::{debug, info, warn};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::diagnostics;
use crate::nas::auth::{
    sanitize_log_message, ApiResponse, AuthError, CloudPubKeyData, LoginResponseData, MfaProof,
    NasPubKeyData,
};
use crate::nas::crypto::{encrypt_credential, parse_public_key};
use crate::nas::models::{
    ClassificationItem, CollectionDetail, CollectionItem, CollectionPage, Episode, NasError, Season,
};
use crate::nas::session::{
    NasDeviceMetadata, NasRequestContext, NasSession, NAS_APP, NAS_PLATFORM,
};
use crate::playback::{PlaybackProgressUpdate, PlaybackStream};

const MFA_CLOUD_BASE_URL: &str = "https://api.zenithspace.net";
const PLAYBACK_VIDEO_CODECS: &str = "hevc,h264,mpeg4";
const PLAYBACK_SUPPORT_FORMAT: &str = "3";
// The Windows player's generic launch path initializes fromApp with e.from || "".
// Preserve a server-provided value, but do not invent "zvideo" for LAN playback.
const PLAYBACK_SOURCE: &str = "";

/// Trait defining the core LAN authentication and media library protocol with a Z-Space NAS.
pub trait NasClient: Send + Sync {
    /// Fetches the NAS public key and signature identifier from `/key/pub?signme=1`.
    fn fetch_public_key(&self, base_url: &str) -> Result<NasPubKeyData, AuthError>;

    /// Executes the full login handshake: public key acquisition, RSA encryption,
    /// and `/auth/login` verification (optionally forwarding SMS/MFA proof).
    fn login(
        &self,
        base_url: &str,
        username: &str,
        password: &str,
        sms_proof: Option<&MfaProof>,
    ) -> Result<LoginResponseData, AuthError>;

    /// Requests a one-time SMS code from the cloud verification service.
    fn send_mfa_code(
        &self,
        base_url: &str,
        username: &str,
        challenge_type: Option<&str>,
    ) -> Result<(), AuthError>;

    /// Exchanges the user-entered SMS code for an opaque proof.
    fn verify_mfa_code(
        &self,
        base_url: &str,
        username: &str,
        code: &str,
    ) -> Result<MfaProof, AuthError>;

    /// Fetches the classification categories of the Z-Video library (`POST /zvideo/classification/list`).
    fn get_classifications(
        &self,
        session: &NasSession,
    ) -> Result<Vec<ClassificationItem>, NasError>;

    /// Fetches paginated collection items for a specific classification (`POST /zvideo/video/v2/list`).
    fn get_collections(
        &self,
        session: &NasSession,
        classification_id: &str,
        start: usize,
        limit: usize,
    ) -> Result<CollectionPage, NasError>;

    /// Fetches full metadata and playable episodes for one collection (`POST /zvideo/collection/v2/info`).
    fn get_collection_detail(
        &self,
        session: &NasSession,
        collection_id: &str,
        classification_id: &str,
    ) -> Result<CollectionDetail, NasError>;

    /// Resolves a selected Episode into a NAS-provided media URI.
    fn get_playback_stream(
        &self,
        session: &NasSession,
        episode: &Episode,
    ) -> Result<PlaybackStream, NasError>;

    /// Sends the known personal playback-progress payload to NAS.
    fn update_playback_progress(
        &self,
        session: &NasSession,
        progress: &PlaybackProgressUpdate,
    ) -> Result<(), NasError>;

    /// Fetches image raw bytes from the NAS.
    fn fetch_image(&self, session: &NasSession, image_path: &str) -> Result<Vec<u8>, NasError>;
}

/// Normalizes a user-provided LAN IP or URL into a standard base URL (e.g., `http://192.168.1.100:5055`).
pub fn normalize_lan_url(input: &str) -> Result<String, AuthError> {
    let clean = input.trim().trim_end_matches('/');
    if clean.is_empty() {
        return Err(AuthError::InvalidUrl("NAS 访问地址不能为空".to_string()));
    }

    let has_scheme = clean.starts_with("http://") || clean.starts_with("https://");
    let full = if has_scheme {
        clean.to_string()
    } else {
        format!("http://{}", clean)
    };

    // Parse URL components
    let parts: Vec<&str> = full.split("://").collect();
    if parts.len() != 2 {
        return Err(AuthError::InvalidUrl(format!("非法 URL 格式: {}", input)));
    }
    let scheme = parts[0];
    let rest = parts[1];

    // If rest has a path, extract host_port only
    let host_port = rest.split('/').next().unwrap_or(rest);
    if host_port.is_empty() {
        return Err(AuthError::InvalidUrl(format!(
            "未识别到主机或 IP: {}",
            input
        )));
    }

    // Check if port is specified
    let normalized = if host_port.contains(':') {
        format!("{}://{}", scheme, host_port)
    } else {
        // Default to port 5055 for LAN HTTP
        let default_port = if scheme == "https" { 5050 } else { 5055 };
        format!("{}://{}:{}", scheme, host_port, default_port)
    };

    Ok(normalized)
}

fn append_request_context_form(form: &mut Vec<(String, String)>, context: &NasRequestContext) {
    form.push(("token".to_string(), context.token.clone()));
    if let Some(nas_id) = context
        .nas_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        form.push(("nasid".to_string(), nas_id.to_string()));
    }
    form.push(("app".to_string(), context.app.to_string()));
    form.push(("plat".to_string(), context.platform.to_string()));
    append_optional_form_field(form, "version", context.device.version.as_deref());
    append_optional_form_field(form, "device_id", context.device.device_id.as_deref());
    append_optional_form_field(form, "device", context.device.device.as_deref());
    append_optional_form_field(
        form,
        "clientPublicIp",
        context.device.client_public_ip.as_deref(),
    );
    append_optional_form_field(form, "_l", context.device.locale.as_deref());
    append_optional_form_field(form, "uuid", context.device.uuid.as_deref());
}

fn append_optional_form_field(form: &mut Vec<(String, String)>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        form.push((key.to_string(), value.to_string()));
    }
}

fn build_collection_list_form(
    context: &NasRequestContext,
    classification_id: &str,
    start: usize,
    limit: usize,
) -> Vec<(String, String)> {
    build_collection_list_form_for_system(context, classification_id, start, limit, 7)
}

fn build_collection_list_form_for_system(
    context: &NasRequestContext,
    classification_id: &str,
    start: usize,
    limit: usize,
    system: u32,
) -> Vec<(String, String)> {
    let mut form = vec![
        ("classification_id".to_string(), classification_id.to_string()),
        ("start".to_string(), start.to_string()),
        ("limit".to_string(), limit.to_string()),
        ("system".to_string(), system.to_string()),
    ];
    append_request_context_form(&mut form, context);
    form
}

fn build_post_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}?&drnd={}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/'),
        HttpNasClient::generate_drnd()
    )
}

fn build_nas_cookie(context: &NasRequestContext) -> String {
    let mut fields = vec![
        format!("app={}", encode_cookie_value(context.app)),
        format!("token={}", encode_cookie_value(&context.token)),
        format!("plat={}", encode_cookie_value(context.platform)),
    ];
    if let Some(nas_id) = context
        .nas_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fields.push(format!("nas_id={}", encode_cookie_value(nas_id)));
    }
    if let Some(nas_sign) = context
        .nas_sign
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fields.push(format!("sign={}", encode_cookie_value(nas_sign)));
    }
    append_optional_cookie_field(&mut fields, "version", context.device.version.as_deref());
    append_optional_cookie_field(&mut fields, "device_id", context.device.device_id.as_deref());
    append_optional_cookie_field(&mut fields, "device", context.device.device.as_deref());
    append_optional_cookie_field(
        &mut fields,
        "clientPublicIp",
        context.device.client_public_ip.as_deref(),
    );
    append_optional_cookie_field(&mut fields, "_l", context.device.locale.as_deref());
    append_optional_cookie_field(&mut fields, "uuid", context.device.uuid.as_deref());
    fields.join("; ")
}

fn append_optional_cookie_field(fields: &mut Vec<String>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        fields.push(format!("{}={}", key, encode_cookie_value(value)));
    }
}

fn encode_cookie_value(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{:02X}", byte));
        }
    }
    encoded
}

fn map_nas_request_error(operation: &str, error: ureq::Error) -> NasError {
    match error {
        ureq::Error::Status(status, _) => map_nas_http_status(operation, status),
        ureq::Error::Transport(error) => NasError::Network(format!(
            "{}: {}",
            operation,
            sanitize_log_message(&error.to_string())
        )),
    }
}

fn map_nas_http_status(operation: &str, status: u16) -> NasError {
    if status == 401 || status == 403 {
        NasError::Unauthorized
    } else {
        NasError::Http {
            status,
            message: format!("{} HTTP {}", operation, status),
        }
    }
}

fn auth_error_class(error: &AuthError) -> &'static str {
    match error {
        AuthError::Network(_) => "network",
        AuthError::Http { .. } => "http",
        AuthError::Crypto(_) => "crypto",
        AuthError::MfaRequired { .. } => "mfa_required",
        AuthError::AuthFailed { .. } => "auth_failed",
        AuthError::InvalidUrl(_) => "invalid_url",
        AuthError::MalformedResponse(_) => "parse",
    }
}

fn auth_error_code(error: &AuthError) -> Option<&str> {
    match error {
        AuthError::MfaRequired { code, .. } | AuthError::AuthFailed { code, .. } => {
            Some(code.as_str())
        }
        AuthError::Network(_)
        | AuthError::Http { .. }
        | AuthError::Crypto(_)
        | AuthError::InvalidUrl(_)
        | AuthError::MalformedResponse(_) => None,
    }
}

fn nas_error_code(error: &NasError) -> Option<&str> {
    match error {
        NasError::Business { code, .. } => Some(code.as_str()),
        NasError::Auth(error) => auth_error_code(error),
        NasError::Unauthorized
        | NasError::Network(_)
        | NasError::Http { .. }
        | NasError::MalformedResponse(_) => None,
    }
}

fn nas_error_class(error: &NasError) -> &'static str {
    match error {
        NasError::Unauthorized => "unauthorized",
        NasError::Network(_) => "network",
        NasError::Http { .. } => "http",
        NasError::Business { .. } => "business",
        NasError::MalformedResponse(_) => "parse",
        NasError::Auth(auth_error) => auth_error_class(auth_error),
    }
}

fn record_auth_request<T>(
    operation: &str,
    method: &str,
    path: &str,
    status: Option<u16>,
    started_at: Instant,
    result: &Result<T, AuthError>,
    parse_result: &str,
    business_result: &str,
) {
    diagnostics::record_nas_request_with_code(
        operation,
        method,
        path,
        status,
        started_at.elapsed(),
        if result.is_ok() { "success" } else { "error" },
        parse_result,
        business_result,
        result
            .as_ref()
            .err()
            .map(auth_error_class)
            .or_else(|| (business_result == "error").then_some("business")),
        result.as_ref().err().and_then(auth_error_code),
    );
}

fn record_nas_result<T>(
    operation: &str,
    method: &str,
    path: &str,
    status: Option<u16>,
    started_at: Instant,
    result: &Result<T, NasError>,
    parse_result: &str,
    business_result: &str,
) {
    diagnostics::record_nas_request_with_code(
        operation,
        method,
        path,
        status,
        started_at.elapsed(),
        if result.is_ok() { "success" } else { "error" },
        parse_result,
        business_result,
        result.as_ref().err().map(nas_error_class),
        result.as_ref().err().and_then(nas_error_code),
    );
}

/// Real HTTP implementation of `NasClient` using `ureq`.
pub struct HttpNasClient {
    timeout: Duration,
    agent: ureq::Agent,
}

#[derive(Debug, Default, Deserialize)]
struct NasHelperStateData {
    #[serde(default, alias = "nasid", alias = "nasId")]
    nas_id: Option<Value>,
}

impl Default for HttpNasClient {
    fn default() -> Self {
        Self::new(Duration::from_secs(10))
    }
}

impl HttpNasClient {
    pub fn new(timeout: Duration) -> Self {
        let agent = ureq::AgentBuilder::new().timeout(timeout).build();
        Self { timeout, agent }
    }

    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    fn generate_drnd() -> String {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let rnd = rand::random::<u32>() % 10000;
        format!("{}_{}", millis, rnd)
    }

    /// Reads the NAS identity that the official client refreshes after login.
    /// The login response does not reliably contain this value, while the
    /// library endpoints use it as part of the request identity.
    fn fetch_nas_helper_state(
        &self,
        base_url: &str,
        token: &str,
        nas_sign: Option<&str>,
    ) -> Result<Option<String>, AuthError> {
        let context = NasRequestContext {
            token: token.to_string(),
            nas_id: None,
            nas_sign: nas_sign.map(str::to_string),
            app: NAS_APP,
            platform: NAS_PLATFORM,
            device: NasDeviceMetadata::client_defaults(),
        };
        let url = format!(
            "{}/zhelper/state?&drnd={}",
            base_url.trim_end_matches('/'),
            Self::generate_drnd()
        );
        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = self
                .agent
                .get(&url)
                .query("token", &context.token)
                .query("plat", context.platform)
                .query("version", context.device.version.as_deref().unwrap_or_default())
                .query(
                    "device_id",
                    context.device.device_id.as_deref().unwrap_or_default(),
                )
                .query("device", context.device.device.as_deref().unwrap_or_default())
                .set("token", &context.token)
                .set("Cookie", &build_nas_cookie(&context))
                .call()
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    AuthError::Network("请求 /zhelper/state 失败".to_string())
                })?;

            status = Some(resp.status());
            if status != Some(200) {
                return Err(AuthError::Http {
                    status: status.unwrap_or_default(),
                    message: format!("HTTP {}", status.unwrap_or_default()),
                });
            }

            let body: ApiResponse<NasHelperStateData> = resp.into_json().map_err(|error| {
                AuthError::MalformedResponse(format!(
                    "解析 /zhelper/state 响应失败: {}",
                    error
                ))
            })?;
            parse_result = "success";
            if !body.is_success() {
                business_result = "error";
                return Err(AuthError::AuthFailed {
                    code: body.code_str(),
                    message: body.error_message(),
                });
            }

            let data = body.data.ok_or_else(|| {
                AuthError::MalformedResponse("/zhelper/state 响应缺少 data".to_string())
            })?;
            let nas_id = data.nas_id.and_then(|value| match value {
                Value::String(value) => {
                    let value = value.trim().to_string();
                    (!value.is_empty()).then_some(value)
                }
                Value::Number(value) => Some(value.to_string()),
                _ => None,
            });
            business_result = "success";
            Ok(nas_id)
        })();
        record_auth_request(
            "auth.nas_helper_state",
            "GET",
            "/zhelper/state",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn fetch_cloud_public_key(&self) -> Result<CloudPubKeyData, AuthError> {
        let url = format!("{}/key/pub?signme=1", MFA_CLOUD_BASE_URL);
        info!("Fetching cloud public key for MFA");
        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = self
                .agent
                .get(&url)
                .call()
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    AuthError::Network("连接云端公钥服务失败".to_string())
                })?;

            status = Some(resp.status());
            if status != Some(200) {
                return Err(AuthError::Http {
                    status: status.unwrap_or_default(),
                    message: format!("HTTP {}", status.unwrap_or_default()),
                });
            }

            let body: ApiResponse<CloudPubKeyData> = resp.into_json().map_err(|e| {
                AuthError::MalformedResponse(format!("解析云端 /key/pub 响应失败: {}", e))
            })?;
            parse_result = "success";
            if !body.is_success() {
                business_result = "error";
                return Err(AuthError::AuthFailed {
                    code: body.code_str(),
                    message: body.error_message(),
                });
            }

            let data = body.data.ok_or_else(|| {
                AuthError::MalformedResponse("云端 /key/pub 响应缺少公钥数据".to_string())
            })?;
            if data.key.trim().is_empty() || data.key_id.trim().is_empty() {
                return Err(AuthError::MalformedResponse(
                    "云端 /key/pub 响应缺少 key 或 key_id".to_string(),
                ));
            }
            business_result = "success";
            Ok(data)
        })();
        record_auth_request(
            "auth.mfa.cloud_public_key",
            "GET",
            "/key/pub",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn fetch_nas_sign(&self, base_url: &str) -> Result<String, AuthError> {
        self.fetch_public_key(base_url)?
            .sign
            .filter(|sign| !sign.trim().is_empty())
            .ok_or_else(|| {
                AuthError::MalformedResponse("NAS /key/pub 响应缺少用于短信验证的 sign".to_string())
            })
    }

    fn post_cloud_form(
        &self,
        path: &str,
        form_params: &[(&str, &str)],
    ) -> Result<ApiResponse<Value>, AuthError> {
        let url = format!(
            "{}{}?&drnd={}",
            MFA_CLOUD_BASE_URL,
            path,
            Self::generate_drnd()
        );
        info!("Submitting MFA request to {}", path);
        let mut request_params = form_params.to_vec();
        request_params.extend([
            ("plat", "pc"),
            ("version", "2.3.0"),
            ("device", "z-video-desktop"),
            ("device_id", "z-video-client-01"),
        ]);
        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = self
                .agent
                .post(&url)
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send_form(&request_params)
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    AuthError::Network(format!("请求 {} 失败", path))
                })?;

            status = Some(resp.status());
            if status != Some(200) {
                return Err(AuthError::Http {
                    status: status.unwrap_or_default(),
                    message: format!("HTTP {}", status.unwrap_or_default()),
                });
            }

            let body: ApiResponse<Value> = resp.into_json().map_err(|e| {
                AuthError::MalformedResponse(format!("解析 {} 响应失败: {}", path, e))
            })?;
            parse_result = "success";
            business_result = if body.is_success() { "success" } else { "error" };
            Ok(body)
        })();
        record_auth_request(
            "auth.mfa.cloud_form",
            "POST",
            path,
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn get_playback_stream_via_playaddr(
        &self,
        base_url: &str,
        context: &NasRequestContext,
        episode: &Episode,
    ) -> Result<PlaybackStream, NasError> {
        let encrypted_path = episode
            .encrypted_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let route = if encrypted_path.is_some() {
            "/transcode/decrypt/playaddr"
        } else {
            "/transcode/playaddr"
        };
        let url = format!("{}{}", base_url.trim_end_matches('/'), route);
        let drnd = Self::generate_drnd();
        let mut request = self
            .agent
            .get(&url)
            .query("drnd", &drnd)
            .query("plat", context.platform)
            .query("file_path", episode.file_path.trim())
            .query("play_env", "1")
            .query("video_codec", PLAYBACK_VIDEO_CODECS)
            .query("support_format", PLAYBACK_SUPPORT_FORMAT)
            .set("token", &context.token)
            .set("Cookie", &build_nas_cookie(context));
        request = append_playback_context_query(request, context);
        if let Some(encrypted_path) = encrypted_path {
            request = request.query("encrypted_path", encrypted_path);
        }
        let from = episode
            .from
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(PLAYBACK_SOURCE);
        request = request.query("from", from);

        let response = request
            .call()
            .map_err(|error| map_nas_request_error("获取旧版播放地址失败", error))?;
        let status = response.status();
        if status == 401 || status == 403 {
            return Err(NasError::Unauthorized);
        }
        if status != 200 {
            return Err(NasError::Http {
                status,
                message: "旧版播放地址服务返回异常".to_string(),
            });
        }
        let body: ApiResponse<PlaybackResponseData> = response
            .into_json()
            .map_err(|_| NasError::MalformedResponse("无法解析旧版播放地址响应".to_string()))?;
        if !body.is_success() {
            return Err(NasError::Business {
                code: body.code_str(),
                message: body.error_message(),
            });
        }
        let data = body
            .data
            .ok_or_else(|| NasError::MalformedResponse("旧版播放地址响应缺少 data".to_string()))?;
        let uri = data
            .uri
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| NasError::MalformedResponse("旧版播放地址缺少有效 URI".to_string()))?;
        Ok(PlaybackStream {
            uri: resolve_playback_uri(base_url, &uri)?,
            audio_tracks: data.audio_list,
            subtitle_tracks: data.subtitle_list,
            extra_fields: data.extra_fields,
        })
    }

    fn get_collections_for_system(
        &self,
        session: &NasSession,
        classification_id: &str,
        start: usize,
        limit: usize,
        system: u32,
    ) -> Result<CollectionPage, NasError> {
        let base_url = session.base_url();
        let context = session
            .request_context()
            .ok_or(NasError::Unauthorized)?;
        let url = build_post_url(&base_url, "/zvideo/video/v2/list");

        let form_params = build_collection_list_form_for_system(
            &context,
            classification_id,
            start,
            limit,
            system,
        );
        diagnostics::record_event(
            "nas.request",
            "library.collections.context",
            "complete",
            "observed",
            Duration::ZERO,
            &[
                ("classification_id", classification_id.to_string()),
                ("start", start.to_string()),
                ("limit", limit.to_string()),
                ("system", system.to_string()),
                ("token_present", (!context.token.is_empty()).to_string()),
                (
                    "nas_id_present",
                    context.nas_id.as_ref().is_some_and(|value| !value.is_empty()).to_string(),
                ),
                (
                    "nas_sign_present",
                    context
                        .nas_sign
                        .as_ref()
                        .is_some_and(|value| !value.is_empty())
                        .to_string(),
                ),
            ],
        );
        let form_params: Vec<(&str, &str)> = form_params
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = self
                .agent
                .post(&url)
                .set("token", &context.token)
                .set("Cookie", &build_nas_cookie(&context))
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send_form(&form_params)
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    map_nas_request_error("获取影视列表失败", error)
                })?;

            status = Some(resp.status());
            if status == Some(401) || status == Some(403) {
                return Err(NasError::Unauthorized);
            }
            if status != Some(200) {
                return Err(NasError::Http {
                    status: status.unwrap_or_default(),
                    message: format!("HTTP {}", status.unwrap_or_default()),
                });
            }

            let body: ApiResponse<Value> = resp
                .into_json()
                .map_err(|e| NasError::MalformedResponse(format!("解析影视列表失败: {}", e)))?;
            parse_result = "success";

            if !body.is_success() {
                business_result = "error";
                return Err(NasError::Business {
                    code: body.code_str(),
                    message: body.error_message(),
                });
            }

            let data = body
                .data
                .ok_or_else(|| NasError::MalformedResponse("响应缺少影片列表数据".to_string()))?;
            let response_keys = data
                .as_object()
                .map(|object| {
                    let mut keys = object.keys().cloned().collect::<Vec<_>>();
                    keys.sort();
                    keys.join("/")
                })
                .unwrap_or_else(|| "non_object".to_string());
            let response_list_count = data
                .get("list")
                .and_then(Value::as_array)
                .map(|list| list.len())
                .unwrap_or(0);
            diagnostics::record_event(
                "nas.response",
                "library.collections.shape",
                "complete",
                "observed",
                Duration::ZERO,
                &[
                    ("item_count", response_list_count.to_string()),
                    ("response_keys", response_keys),
                ],
            );
            let has_list_field = data
                .as_object()
                .map(|object| object.contains_key("list"))
                .unwrap_or(false);
            if !has_list_field {
                return Err(NasError::MalformedResponse(
                    "影视列表响应缺少 data.list，未将其静默视为空片库".to_string(),
                ));
            }
            let page: CollectionPage = serde_json::from_value(data)
                .map_err(|e| NasError::MalformedResponse(format!("解析影视列表数据失败: {}", e)))?;
            business_result = "success";
            Ok(page)
        })();
        record_nas_result(
            "library.collections",
            "POST",
            "/zvideo/video/v2/list",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }
}

impl NasClient for HttpNasClient {
    fn fetch_public_key(&self, base_url: &str) -> Result<NasPubKeyData, AuthError> {
        let normalized_base = normalize_lan_url(base_url)?;
        let url = format!("{}/key/pub?signme=1", normalized_base);
        info!(
            "Fetching NAS public key from: {}",
            sanitize_log_message(&url)
        );

        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = self
                .agent
                .get(&url)
                .call()
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    AuthError::Network("连接 /key/pub 失败".to_string())
                })?;

            status = Some(resp.status());
            if status != Some(200) {
                return Err(AuthError::Http {
                    status: status.unwrap_or_default(),
                    message: format!("HTTP {}", status.unwrap_or_default()),
                });
            }

            let body: ApiResponse<NasPubKeyData> = resp.into_json().map_err(|e| {
                AuthError::MalformedResponse(format!("解析 /key/pub 响应失败: {}", e))
            })?;
            parse_result = "success";
            if !body.is_success() {
                business_result = "error";
                let code = body.code_str();
                let msg = body.error_message();
                return Err(AuthError::AuthFailed { code, message: msg });
            }

            let data = body.data.ok_or_else(|| {
                AuthError::MalformedResponse("响应成功但缺少 public key 数据".to_string())
            })?;
            business_result = "success";
            Ok(data)
        })();
        record_auth_request(
            "auth.nas_public_key",
            "GET",
            "/key/pub",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn login(
        &self,
        base_url: &str,
        username: &str,
        password: &str,
        sms_proof: Option<&MfaProof>,
    ) -> Result<LoginResponseData, AuthError> {
        let normalized_base = normalize_lan_url(base_url)?;

        // 1. Fetch public key
        let pubkey_data = self.fetch_public_key(&normalized_base)?;
        let rsa_pubkey = parse_public_key(&pubkey_data.key)
            .map_err(|e| AuthError::Crypto(format!("公钥解析失败: {}", e)))?;

        // 2. RSA encrypt username and password
        let username_enc = encrypt_credential(&rsa_pubkey, username)
            .map_err(|e| AuthError::Crypto(format!("用户名加密失败: {}", e)))?;
        let password_enc = encrypt_credential(&rsa_pubkey, password)
            .map_err(|e| AuthError::Crypto(format!("密码加密失败: {}", e)))?;

        // 3. Compose URL with cache buster
        let drnd = Self::generate_drnd();
        let login_url = format!("{}/auth/login?&drnd={}", normalized_base, drnd);
        info!(
            "Submitting credentials to: {}/auth/login",
            sanitize_log_message(&normalized_base)
        );

        // 4. Form payload
        let mut form_params: Vec<(&str, &str)> = vec![
            ("username", &username_enc),
            ("password", &password_enc),
            ("plat", "pc"),
            ("version", "2.3.0"),
            ("device", "z-video-desktop"),
            ("device_id", "z-video-client-01"),
        ];

        let proof_str;
        if let Some(proof) = sms_proof {
            proof_str = proof.as_str().to_string();
            form_params.push(("sms_proof", &proof_str));
        }

        // 5. POST request
        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = self
                .agent
                .post(&login_url)
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send_form(&form_params)
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    AuthError::Network("请求 /auth/login 失败".to_string())
                })?;

            status = Some(resp.status());
            if status != Some(200) {
                return Err(AuthError::Http {
                    status: status.unwrap_or_default(),
                    message: format!("HTTP {}", status.unwrap_or_default()),
                });
            }

            let body: ApiResponse<LoginResponseData> = resp.into_json().map_err(|e| {
                AuthError::MalformedResponse(format!("解析 /auth/login 响应失败: {}", e))
            })?;
            parse_result = "success";

            let code = body.code_str();
            if body.is_success() {
                let mut data = body.data.ok_or_else(|| {
                    AuthError::MalformedResponse("登录成功但缺少用户会话数据".to_string())
                })?;
                // Supplement metadata from pubkey response if absent
                if data.nas_name.is_none() {
                    data.nas_name = pubkey_data.name.clone();
                }
                // `/key/pub`'s sign is the opaque cloud/MFA value. It must
                // never be substituted for the NAS identity returned by login.
                data.nas_sign = pubkey_data.sign.clone();
                match self.fetch_nas_helper_state(
                    &normalized_base,
                    &data.token,
                    data.nas_sign.as_deref(),
                ) {
                    Ok(Some(nas_id)) => data.nas_id = Some(nas_id),
                    Ok(None) => debug!("/zhelper/state returned no NAS identity"),
                    Err(error) => warn!(
                        "Could not refresh NAS identity after login: {}",
                        sanitize_log_message(&error.to_string())
                    ),
                }
                business_result = "success";
                Ok(data)
            } else {
                let msg = body.error_message();
                if code == "N001204" || code == "N001414" {
                    business_result = "mfa_required";
                    Err(AuthError::MfaRequired { code, message: msg })
                } else {
                    business_result = "error";
                    Err(AuthError::AuthFailed { code, message: msg })
                }
            }
        })();
        record_auth_request(
            "auth.login",
            "POST",
            "/auth/login",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn send_mfa_code(
        &self,
        base_url: &str,
        username: &str,
        challenge_type: Option<&str>,
    ) -> Result<(), AuthError> {
        let nas_sign = self.fetch_nas_sign(base_url)?;
        let cloud_key = self.fetch_cloud_public_key()?;
        let cloud_rsa_key = parse_public_key(&cloud_key.key)
            .map_err(|e| AuthError::Crypto(format!("云端公钥解析失败: {}", e)))?;
        let encrypted_username = encrypt_credential(&cloud_rsa_key, username)
            .map_err(|e| AuthError::Crypto(format!("云端用户名加密失败: {}", e)))?;
        let key_id = cloud_key.key_id.trim().to_string();

        let mut form_params = vec![
            ("username", encrypted_username.as_str()),
            ("key_id", key_id.as_str()),
            // This is the opaque NAS sign from the NAS /key/pub response,
            // not the discovered NAS id.
            ("nasid", nas_sign.as_str()),
        ];
        if let Some(value) = challenge_type
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            form_params.push(("type", value));
        }

        let body = self.post_cloud_form("/sms/usend", &form_params)?;
        if body.is_success() {
            Ok(())
        } else {
            Err(AuthError::AuthFailed {
                code: body.code_str(),
                message: body.error_message(),
            })
        }
    }

    fn verify_mfa_code(
        &self,
        base_url: &str,
        username: &str,
        code: &str,
    ) -> Result<MfaProof, AuthError> {
        let code = code.trim();
        let code_length = code.chars().count();
        if code_length != 4 && code_length != 6 {
            return Err(AuthError::AuthFailed {
                code: "MFA_INVALID_CODE".to_string(),
                message: "验证码格式无效，请输入 4 位或 6 位验证码".to_string(),
            });
        }

        let nas_sign = self.fetch_nas_sign(base_url)?;
        let cloud_key = self.fetch_cloud_public_key()?;
        let cloud_rsa_key = parse_public_key(&cloud_key.key)
            .map_err(|e| AuthError::Crypto(format!("云端公钥解析失败: {}", e)))?;
        let encrypted_username = encrypt_credential(&cloud_rsa_key, username)
            .map_err(|e| AuthError::Crypto(format!("云端用户名加密失败: {}", e)))?;
        let key_id = cloud_key.key_id.trim().to_string();
        let form_params = [
            ("username", encrypted_username.as_str()),
            ("key_id", key_id.as_str()),
            // Keep the protocol's opaque NAS sign distinct from nas_id.
            ("nasid", nas_sign.as_str()),
            ("sms_code", code),
        ];

        let body = self.post_cloud_form("/sms/ucheck", &form_params)?;
        if !body.is_success() {
            return Err(AuthError::AuthFailed {
                code: body.code_str(),
                message: body.error_message(),
            });
        }

        let proof = body
            .data
            .as_ref()
            .and_then(|data| data.get("sms_proof"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|proof| !proof.is_empty())
            .ok_or_else(|| {
                AuthError::MalformedResponse("短信验证成功但响应缺少 sms_proof".to_string())
            })?;
        Ok(MfaProof::new(proof.to_string()))
    }

    fn get_classifications(
        &self,
        session: &NasSession,
    ) -> Result<Vec<ClassificationItem>, NasError> {
        let base_url = session.base_url();
        let mut context = session
            .request_context()
            .ok_or(NasError::Unauthorized)?;
        if context.nas_id.is_none() {
            match self.fetch_nas_helper_state(
                &base_url,
                &context.token,
                context.nas_sign.as_deref(),
            ) {
                Ok(Some(nas_id)) => {
                    session.set_nas_id(Some(nas_id));
                    context = session.request_context().ok_or(NasError::Unauthorized)?;
                }
                Ok(None) => debug!("/zhelper/state returned no NAS identity before library load"),
                Err(error) => warn!(
                    "Could not refresh NAS identity before library load: {}",
                    sanitize_log_message(&error.to_string())
                ),
            }
        }
        let url = build_post_url(&base_url, "/zvideo/classification/list");
        diagnostics::record_event(
            "nas.request",
            "library.classifications.context",
            "complete",
            "observed",
            Duration::ZERO,
            &[
                ("token_present", (!context.token.is_empty()).to_string()),
                (
                    "nas_id_present",
                    context.nas_id.as_ref().is_some_and(|value| !value.is_empty()).to_string(),
                ),
                (
                    "nas_sign_present",
                    context
                        .nas_sign
                        .as_ref()
                        .is_some_and(|value| !value.is_empty())
                        .to_string(),
                ),
            ],
        );
        let mut form = Vec::new();
        append_request_context_form(&mut form, &context);
        let form_params: Vec<(&str, &str)> = form
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        let cookie = build_nas_cookie(&context);
        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = self
                .agent
                .post(&url)
                .set("token", &context.token)
                .set("Cookie", &cookie)
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send_form(&form_params)
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    map_nas_request_error("获取分类列表失败", error)
                })?;

            status = Some(resp.status());
            if status == Some(401) || status == Some(403) {
                return Err(NasError::Unauthorized);
            }
            if status != Some(200) {
                return Err(NasError::Http {
                    status: status.unwrap_or_default(),
                    message: format!("HTTP {}", status.unwrap_or_default()),
                });
            }

            let body: ApiResponse<Value> = resp
                .into_json()
                .map_err(|e| NasError::MalformedResponse(format!("解析分类列表失败: {}", e)))?;
            parse_result = "success";

            if !body.is_success() {
                business_result = "error";
                return Err(NasError::Business {
                    code: body.code_str(),
                    message: body.error_message(),
                });
            }

            let data = body.data.ok_or_else(|| {
                NasError::MalformedResponse("分类列表响应缺少 data".to_string())
            })?;
            let response_keys = data
                .as_array()
                .and_then(|items| items.first())
                .and_then(Value::as_object)
                .map(|object| {
                    let mut keys = object.keys().cloned().collect::<Vec<_>>();
                    keys.sort();
                    keys.join("/")
                })
                .unwrap_or_else(|| "non_object_item".to_string());
            diagnostics::record_event(
                "nas.response",
                "library.classifications.shape",
                "complete",
                "observed",
                Duration::ZERO,
                &[
                    (
                        "category_count",
                        data.as_array().map(|items| items.len()).unwrap_or(0).to_string(),
                    ),
                    ("response_keys", response_keys),
                ],
            );
            let mut list: Vec<ClassificationItem> = serde_json::from_value(data)
                .map_err(|error| NasError::MalformedResponse(format!("解析分类列表数据失败: {}", error)))?;
            list.retain(|item| item.is_visible());
            business_result = "success";
            Ok(list)
        })();
        record_nas_result(
            "library.classifications",
            "POST",
            "/zvideo/classification/list",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn get_collections(
        &self,
        session: &NasSession,
        classification_id: &str,
        start: usize,
        limit: usize,
    ) -> Result<CollectionPage, NasError> {
        // The normal library page uses system=94 in the current official
        // web client. Older NAS page bundles use system=7 for a series-list
        // path, so retain it as a compatibility fallback when the normal
        // page is accepted but empty.
        let primary = self.get_collections_for_system(
            session,
            classification_id,
            start,
            limit,
            94,
        )?;
        if !primary.list.is_empty() {
            return Ok(primary);
        }

        diagnostics::record_event(
            "nas.request",
            "library.collections.system_fallback",
            "complete",
            "started",
            Duration::ZERO,
            &[
                ("classification_id", classification_id.to_string()),
                ("system", "7".to_string()),
                ("reason", "primary_empty".to_string()),
            ],
        );
        match self.get_collections_for_system(session, classification_id, start, limit, 7) {
            Ok(fallback) if !fallback.list.is_empty() => Ok(fallback),
            Ok(_) | Err(_) => Ok(primary),
        }
    }

    fn get_collection_detail(
        &self,
        session: &NasSession,
        collection_id: &str,
        classification_id: &str,
    ) -> Result<CollectionDetail, NasError> {
        let base_url = session.base_url();
        let context = session
            .request_context()
            .ok_or(NasError::Unauthorized)?;
        let url = build_post_url(&base_url, "/zvideo/collection/v2/info");
        let mut form_params = vec![
            ("collection_id".to_string(), collection_id.to_string()),
            ("get_type".to_string(), "all".to_string()),
            ("classification_id".to_string(), classification_id.to_string()),
        ];
        append_request_context_form(&mut form_params, &context);
        let form_params: Vec<(&str, &str)> = form_params
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = self
                .agent
                .post(&url)
                .set("token", &context.token)
                .set("Cookie", &build_nas_cookie(&context))
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send_form(&form_params)
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    map_nas_request_error("获取影视详情失败", error)
                })?;

            status = Some(resp.status());
            if status == Some(401) || status == Some(403) {
                return Err(NasError::Unauthorized);
            }
            if status != Some(200) {
                return Err(NasError::Http {
                    status: status.unwrap_or_default(),
                    message: format!("HTTP {}", status.unwrap_or_default()),
                });
            }

            let body: ApiResponse<CollectionDetail> = resp
                .into_json()
                .map_err(|e| NasError::MalformedResponse(format!("解析影视详情失败: {}", e)))?;
            parse_result = "success";

            if !body.is_success() {
                business_result = "error";
                return Err(NasError::Business {
                    code: body.code_str(),
                    message: body.error_message(),
                });
            }

            let detail = body
                .data
                .ok_or_else(|| NasError::MalformedResponse("响应缺少影视详情数据".to_string()))?;
            business_result = "success";
            Ok(detail)
        })();
        record_nas_result(
            "library.collection_detail",
            "POST",
            "/zvideo/collection/v2/info",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn get_playback_stream(
        &self,
        session: &NasSession,
        episode: &Episode,
    ) -> Result<PlaybackStream, NasError> {
        let base_url = session.base_url();
        let context = session
            .request_context()
            .ok_or(NasError::Unauthorized)?;
        let file_path = episode.file_path.trim();
        if file_path.is_empty() {
            return Err(NasError::MalformedResponse(
                "Episode 缺少 file_path，无法请求播放地址".to_string(),
            ));
        }

        let encrypted_path = episode
            .encrypted_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let route = if encrypted_path.is_some() {
            "/transcode/decrypt/play"
        } else {
            "/transcode/play"
        };
        let url = format!("{}{}", base_url.trim_end_matches('/'), route);
        let drnd = Self::generate_drnd();
        let from = episode
            .from
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(PLAYBACK_SOURCE);

        diagnostics::record_event(
            "nas.request",
            "playback.stream.context",
            "complete",
            "observed",
            Duration::ZERO,
            &[
                ("route", route.to_string()),
                ("file_path_present", (!file_path.is_empty()).to_string()),
                (
                    "encrypted_path_present",
                    encrypted_path.is_some().to_string(),
                ),
                ("from_present", (!from.is_empty()).to_string()),
                ("nas_id_present", context.nas_id.is_some().to_string()),
                ("nas_sign_present", context.nas_sign.is_some().to_string()),
                (
                    "device_metadata_present",
                    (context.device.version.is_some()
                        || context.device.device_id.is_some()
                        || context.device.device.is_some())
                        .to_string(),
                ),
            ],
        );

        let mut request = self
            .agent
            .get(&url)
            .query("drnd", &drnd)
            .query("plat", context.platform)
            .query("file_path", file_path)
            .query("play_env", "1")
            .query("video_codec", PLAYBACK_VIDEO_CODECS)
            .query("support_format", PLAYBACK_SUPPORT_FORMAT)
            .set("token", &context.token)
            .set("Cookie", &build_nas_cookie(&context));
        request = append_playback_context_query(request, &context);

        if let Some(encrypted_path) = encrypted_path {
            request = request.query("encrypted_path", encrypted_path);
        }
        request = request.query("from", from);
        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let primary_result = (|| {
            let response = request
                .call()
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    map_nas_request_error("获取播放地址失败", error)
                })?;

            status = Some(response.status());
            if status == Some(401) || status == Some(403) {
                return Err(NasError::Unauthorized);
            }
            if status != Some(200) {
                return Err(NasError::Http {
                    status: status.unwrap_or_default(),
                    message: "播放地址服务返回异常".to_string(),
                });
            }

            let body: ApiResponse<PlaybackResponseData> = response
                .into_json()
                .map_err(|_| NasError::MalformedResponse("无法解析播放地址响应".to_string()))?;
            parse_result = "success";

            if !body.is_success() {
                business_result = "error";
                return Err(NasError::Business {
                    code: body.code_str(),
                    message: body.error_message(),
                });
            }

            let data = body
                .data
                .ok_or_else(|| NasError::MalformedResponse("播放地址响应缺少 data".to_string()))?;
            let uri = data
                .uri
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    NasError::MalformedResponse("播放地址响应缺少有效 URI".to_string())
                })?;
            let stream = PlaybackStream {
                uri: resolve_playback_uri(&base_url, &uri)?,
                audio_tracks: data.audio_list,
                subtitle_tracks: data.subtitle_list,
                extra_fields: data.extra_fields,
            };
            business_result = "success";
            Ok(stream)
        })();
        let should_try_legacy = matches!(
            &primary_result,
            Err(NasError::Business { code, .. }) if code == "404"
        ) || matches!(
            &primary_result,
            Err(NasError::Http { status: 404, .. })
        );
        let result = if should_try_legacy {
            match self.get_playback_stream_via_playaddr(&base_url, &context, episode) {
                Ok(stream) => {
                    business_result = "success";
                    Ok(stream)
                }
                Err(_) => primary_result,
            }
        } else {
            primary_result
        };
        record_nas_result(
            "playback.stream",
            "GET",
            &url,
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn update_playback_progress(
        &self,
        session: &NasSession,
        progress: &PlaybackProgressUpdate,
    ) -> Result<(), NasError> {
        let base_url = session.base_url();
        let context = session
            .request_context()
            .ok_or(NasError::Unauthorized)?;
        let url = build_post_url(&base_url, "/zvideo/video/updateplaytime");
        let mut form = vec![
            ("collection_id".to_string(), progress.collection_id.clone()),
            ("classification_id".to_string(), progress.classification_id.clone()),
            ("video_id".to_string(), progress.video_id.clone()),
            ("sec".to_string(), progress.sec.to_string()),
            ("chapter".to_string(), progress.chapter.to_string()),
            ("audio_index".to_string(), progress.audio_index.to_string()),
            ("subtitle_index".to_string(), progress.subtitle_index.to_string()),
            ("subtitle_hash".to_string(), progress.subtitle_hash.clone()),
            (
                "video_duration".to_string(),
                progress.video_duration.to_string(),
            ),
            (
                "subtitle_setting".to_string(),
                progress.subtitle_setting.clone(),
            ),
        ];
        append_request_context_form(&mut form, &context);
        let form: Vec<(&str, &str)> = form
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();

        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let response = self
                .agent
                .post(&url)
                .set("token", &context.token)
                .set("Cookie", &build_nas_cookie(&context))
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send_form(&form)
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    map_nas_request_error("上报播放进度失败", error)
                })?;

            status = Some(response.status());
            if status == Some(401) || status == Some(403) {
                return Err(NasError::Unauthorized);
            }
            if status != Some(200) {
                return Err(NasError::Http {
                    status: status.unwrap_or_default(),
                    message: "播放进度服务返回异常".to_string(),
                });
            }

            let body: ApiResponse<Value> = response
                .into_json()
                .map_err(|_| NasError::MalformedResponse("无法解析播放进度响应".to_string()))?;
            parse_result = "success";
            if !body.is_success() {
                business_result = "error";
                return Err(NasError::Business {
                    code: body.code_str(),
                    message: body.error_message(),
                });
            }
            business_result = "success";
            Ok(())
        })();
        record_nas_result(
            "playback.progress",
            "POST",
            "/zvideo/video/updateplaytime",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }

    fn fetch_image(&self, session: &NasSession, image_path: &str) -> Result<Vec<u8>, NasError> {
        let base_url = session.base_url();
        let context = session
            .request_context()
            .ok_or(NasError::Unauthorized)?;
        let full_url = if image_path.starts_with("http://") || image_path.starts_with("https://") {
            image_path.to_string()
        } else {
            let p = if image_path.starts_with('/') {
                image_path.to_string()
            } else {
                format!("/{}", image_path)
            };
            format!("{}{}", base_url, p)
        };

        let req = self
            .agent
            .get(&full_url)
            .query("app", context.app)
            .query("plat", context.platform)
            .set("token", &context.token)
            .set("Cookie", &build_nas_cookie(&context));

        let started_at = Instant::now();
        let mut status = None;
        let mut parse_result = "not_attempted";
        let mut business_result = "not_attempted";
        let result = (|| {
            let resp = req
                .call()
                .map_err(|error| {
                    if let ureq::Error::Status(http_status, _) = &error {
                        status = Some(*http_status);
                    }
                    map_nas_request_error("下载图片失败", error)
                })?;

            status = Some(resp.status());
            if status == Some(401) || status == Some(403) {
                return Err(NasError::Unauthorized);
            }
            if status != Some(200) {
                return Err(NasError::Http {
                    status: status.unwrap_or_default(),
                    message: "图片服务返回异常".to_string(),
                });
            }

            let mut bytes = Vec::new();
            use std::io::Read;
            resp.into_reader()
                .read_to_end(&mut bytes)
                .map_err(|_| NasError::Network("读取图片流失败".to_string()))?;
            parse_result = "binary_read";
            business_result = "success";
            Ok(bytes)
        })();
        record_nas_result(
            "library.image",
            "GET",
            "/image",
            status,
            started_at,
            &result,
            parse_result,
            business_result,
        );
        result
    }
}

fn append_playback_context_query(
    mut request: ureq::Request,
    context: &NasRequestContext,
) -> ureq::Request {
    if let Some(version) = context.device.version.as_deref() {
        request = request.query("version", version);
    }
    if let Some(device_id) = context.device.device_id.as_deref() {
        request = request.query("device_id", device_id);
    }
    if let Some(device) = context.device.device.as_deref() {
        request = request.query("device", device);
    }
    if let Some(client_public_ip) = context.device.client_public_ip.as_deref() {
        request = request.query("clientPublicIp", client_public_ip);
    }
    request
}

/// Configurable mock client for unit and integration testing without requiring real hardware.
#[derive(Debug, Clone)]
pub struct MockNasClient {
    pub expected_username: String,
    pub expected_password: String,
    pub require_mfa: bool,
    pub mfa_code: String,
    pub mfa_error_code: String,
    mfa_proof: String,
    mfa_code_sent: Arc<Mutex<bool>>,
    pub network_error: bool,
    pub mock_token: String,
    pub mock_nas_name: String,
    pub mock_classifications: Vec<ClassificationItem>,
    pub mock_collections: Vec<CollectionItem>,
    pub mock_collection_details: HashMap<String, CollectionDetail>,
    pub mock_playback_uri: Option<String>,
    progress_receipts: Arc<Mutex<Vec<PlaybackProgressUpdate>>>,
}

impl Default for MockNasClient {
    fn default() -> Self {
        let classifications = vec![
            ClassificationItem {
                id: "1".to_string(),
                name: "电影".to_string(),
                is_system: 1,
                is_enable: 1,
                count: 4,
            },
            ClassificationItem {
                id: "2".to_string(),
                name: "电视剧".to_string(),
                is_system: 1,
                is_enable: 1,
                count: 2,
            },
            ClassificationItem {
                id: "3".to_string(),
                name: "动漫".to_string(),
                is_system: 0,
                is_enable: 1,
                count: 1,
            },
        ];

        let collections = vec![
            CollectionItem {
                collection_id: "c01".to_string(),
                title: "星际穿越".to_string(),
                cover: "/zvideo/cover/interstellar.jpg".to_string(),
                release_year: "2014".to_string(),
                video_type: "movie".to_string(),
                score: Some("9.4".to_string()),
                rating: None,
                episode_count: Some(1),
                storyline: Some(
                    "近未来的地球黄沙遍野，前NASA宇航员库珀穿过虫洞寻找人类新家园。".to_string(),
                ),
            },
            CollectionItem {
                collection_id: "c02".to_string(),
                title: "奥本海默".to_string(),
                cover: "/zvideo/cover/oppenheimer.jpg".to_string(),
                release_year: "2023".to_string(),
                video_type: "movie".to_string(),
                score: Some("8.8".to_string()),
                rating: None,
                episode_count: Some(1),
                storyline: Some(
                    "讲述美国“原子弹之父”罗伯特·奥本海默主导曼哈顿计划的故事。".to_string(),
                ),
            },
            CollectionItem {
                collection_id: "c03".to_string(),
                title: "黑客帝国".to_string(),
                cover: "/zvideo/cover/matrix.jpg".to_string(),
                release_year: "1999".to_string(),
                video_type: "movie".to_string(),
                score: Some("9.1".to_string()),
                rating: None,
                episode_count: Some(1),
                storyline: Some("程序员尼奥发现现实世界是由机器控制的虚拟Matrix。".to_string()),
            },
            CollectionItem {
                collection_id: "c04".to_string(),
                title: "盗梦空间".to_string(),
                cover: "/zvideo/cover/inception.jpg".to_string(),
                release_year: "2010".to_string(),
                video_type: "movie".to_string(),
                score: Some("9.3".to_string()),
                rating: None,
                episode_count: Some(1),
                storyline: Some("盗梦者柯布带队进入目标潜意识植入一个意念。".to_string()),
            },
        ];

        let mut mock_collection_details = HashMap::new();
        mock_collection_details.insert(
            "c01".to_string(),
            CollectionDetail {
                collection_id: "c01".to_string(),
                title: "星际穿越".to_string(),
                cover: "/zvideo/cover/interstellar.jpg".to_string(),
                background: "/zvideo/background/interstellar.jpg".to_string(),
                release_year: "2014".to_string(),
                video_type: "movie".to_string(),
                score: Some("9.4".to_string()),
                rating: None,
                storyline: Some(
                    "近未来的地球黄沙遍野，前NASA宇航员库珀穿过虫洞寻找人类新家园。".to_string(),
                ),
                seasons: vec![Season {
                    season_number: 1,
                    title: "正片".to_string(),
                    episodes: vec![Episode {
                        video_id: "c01-video".to_string(),
                        episode_number: 1,
                        title: "正片".to_string(),
                        file_path: "/media/interstellar.mkv".to_string(),
                        version_id: "c01-version".to_string(),
                        duration: Some("169m".to_string()),
                        encrypted_path: None,
                        from: None,
                    }],
                }],
            },
        );
        mock_collection_details.insert(
            "series-demo".to_string(),
            CollectionDetail {
                collection_id: "series-demo".to_string(),
                title: "测试剧集".to_string(),
                cover: "/zvideo/cover/series.jpg".to_string(),
                background: "/zvideo/background/series.jpg".to_string(),
                release_year: "2024".to_string(),
                video_type: "tv".to_string(),
                score: Some("8.8".to_string()),
                rating: None,
                storyline: Some("一段用于验证选集的测试剧情。".to_string()),
                seasons: vec![
                    Season {
                        season_number: 1,
                        title: "第一季".to_string(),
                        episodes: vec![
                            Episode {
                                video_id: "series-s1e1".to_string(),
                                episode_number: 1,
                                title: "第一季·第1集".to_string(),
                                file_path: "/media/series-s1e1.mkv".to_string(),
                                version_id: "series-s1e1-v1".to_string(),
                                duration: None,
                                encrypted_path: None,
                                from: None,
                            },
                            Episode {
                                video_id: "series-s1e2".to_string(),
                                episode_number: 2,
                                title: "第一季·第2集".to_string(),
                                file_path: "/media/series-s1e2.mkv".to_string(),
                                version_id: "series-s1e2-v1".to_string(),
                                duration: None,
                                encrypted_path: None,
                                from: None,
                            },
                        ],
                    },
                    Season {
                        season_number: 2,
                        title: "第二季".to_string(),
                        episodes: vec![Episode {
                            video_id: "series-s2e1".to_string(),
                            episode_number: 1,
                            title: "第二季·第1集".to_string(),
                            file_path: "/media/series-s2e1.mkv".to_string(),
                            version_id: "series-s2e1-v1".to_string(),
                            duration: None,
                            encrypted_path: None,
                            from: None,
                        }],
                    },
                ],
            },
        );

        Self {
            expected_username: "admin".to_string(),
            expected_password: "password123".to_string(),
            require_mfa: false,
            mfa_code: "123456".to_string(),
            mfa_error_code: "N001204".to_string(),
            mfa_proof: "mock_sms_proof_opaque".to_string(),
            mfa_code_sent: Arc::new(Mutex::new(false)),
            network_error: false,
            mock_token: "mock_session_token_xyz_888".to_string(),
            mock_nas_name: "极空间-私有存储".to_string(),
            mock_classifications: classifications,
            mock_collections: collections,
            mock_collection_details,
            mock_playback_uri: Some("/mock/playback/stream".to_string()),
            progress_receipts: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl MockNasClient {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn progress_receipts(&self) -> Vec<PlaybackProgressUpdate> {
        self.progress_receipts.lock().unwrap().clone()
    }

    pub fn with_mfa(mut self, require_mfa: bool) -> Self {
        self.require_mfa = require_mfa;
        self
    }

    pub fn with_mfa_error_code(mut self, code: impl Into<String>) -> Self {
        self.mfa_error_code = code.into();
        self
    }

    pub fn with_network_error(mut self, fail: bool) -> Self {
        self.network_error = fail;
        self
    }

    pub fn with_empty_library(mut self) -> Self {
        self.mock_collections.clear();
        self
    }

    pub fn with_playback_uri(mut self, uri: impl Into<String>) -> Self {
        self.mock_playback_uri = Some(uri.into());
        self
    }

    pub fn without_playback_uri(mut self) -> Self {
        self.mock_playback_uri = None;
        self
    }
}

impl NasClient for MockNasClient {
    fn fetch_public_key(&self, base_url: &str) -> Result<NasPubKeyData, AuthError> {
        if self.network_error {
            return Err(AuthError::Network("网络不可达: 连接超时".to_string()));
        }
        let _ = normalize_lan_url(base_url)?;

        // Return standard sample public key
        Ok(NasPubKeyData {
            key: "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6\nHscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==".to_string(),
            sign: Some("mock_opaque_sign_abc".to_string()),
            name: Some(self.mock_nas_name.clone()),
        })
    }

    fn login(
        &self,
        base_url: &str,
        username: &str,
        password: &str,
        sms_proof: Option<&MfaProof>,
    ) -> Result<LoginResponseData, AuthError> {
        if self.network_error {
            return Err(AuthError::Network(
                "无法连接到指定 NAS，请检查网络".to_string(),
            ));
        }
        let _ = normalize_lan_url(base_url)?;

        let trim_user = username.trim();
        let trim_pass = password.trim();

        if trim_user != self.expected_username || trim_pass != self.expected_password {
            return Err(AuthError::AuthFailed {
                code: "N150061".to_string(),
                message: "用户名或密码错误".to_string(),
            });
        }

        if self.require_mfa {
            match sms_proof {
                Some(proof) if proof.as_str() == self.mfa_proof => {
                    // Only the opaque proof returned by verify_mfa_code passes.
                }
                Some(_) => {
                    return Err(AuthError::AuthFailed {
                        code: "N001205".to_string(),
                        message: "短信验证码错误或已失效".to_string(),
                    });
                }
                None => {
                    return Err(AuthError::MfaRequired {
                        code: self.mfa_error_code.clone(),
                        message: "检测到新设备或需二次验证，请获取并输入短信验证码".to_string(),
                    });
                }
            }
        }

        Ok(LoginResponseData {
            token: self.mock_token.clone(),
            username: Some(trim_user.to_string()),
            qcname: Some("极空间管理员".to_string()),
            avatar: None,
            is_local: Some(true),
            userinfo: None,
            nas_id: Some("mock_nas_id_001".to_string()),
            nas_sign: Some("mock_opaque_sign_abc".to_string()),
            nas_name: Some(self.mock_nas_name.clone()),
        })
    }

    fn send_mfa_code(
        &self,
        base_url: &str,
        username: &str,
        _challenge_type: Option<&str>,
    ) -> Result<(), AuthError> {
        if self.network_error {
            return Err(AuthError::Network("短信服务不可用".to_string()));
        }
        let _ = normalize_lan_url(base_url)?;
        if !self.require_mfa {
            return Err(AuthError::AuthFailed {
                code: "MFA_NOT_REQUIRED".to_string(),
                message: "当前账号不需要短信验证".to_string(),
            });
        }
        if username.trim() != self.expected_username {
            return Err(AuthError::AuthFailed {
                code: "N150061".to_string(),
                message: "用户名或密码错误".to_string(),
            });
        }
        *self.mfa_code_sent.lock().unwrap() = true;
        Ok(())
    }

    fn verify_mfa_code(
        &self,
        base_url: &str,
        username: &str,
        code: &str,
    ) -> Result<MfaProof, AuthError> {
        if self.network_error {
            return Err(AuthError::Network("短信服务不可用".to_string()));
        }
        let _ = normalize_lan_url(base_url)?;
        if !self.require_mfa {
            return Err(AuthError::AuthFailed {
                code: "MFA_NOT_REQUIRED".to_string(),
                message: "当前账号不需要短信验证".to_string(),
            });
        }
        if username.trim() != self.expected_username {
            return Err(AuthError::AuthFailed {
                code: "N150061".to_string(),
                message: "用户名或密码错误".to_string(),
            });
        }
        if !*self.mfa_code_sent.lock().unwrap() {
            return Err(AuthError::AuthFailed {
                code: "MFA_NOT_REQUESTED".to_string(),
                message: "请先发送验证码".to_string(),
            });
        }

        let code = code.trim();
        if code != self.mfa_code {
            return Err(AuthError::AuthFailed {
                code: "N001205".to_string(),
                message: "短信验证码错误或已失效".to_string(),
            });
        }
        Ok(MfaProof::new(self.mfa_proof.clone()))
    }

    fn get_classifications(
        &self,
        session: &NasSession,
    ) -> Result<Vec<ClassificationItem>, NasError> {
        if self.network_error {
            return Err(NasError::Network(
                "无法连接至 NAS 片库，网络断开".to_string(),
            ));
        }
        if session.token().is_none() {
            return Err(NasError::Unauthorized);
        }

        let mut list = self.mock_classifications.clone();
        list.retain(|i| i.is_visible());
        Ok(list)
    }

    fn get_collections(
        &self,
        session: &NasSession,
        classification_id: &str,
        start: usize,
        limit: usize,
    ) -> Result<CollectionPage, NasError> {
        if self.network_error {
            return Err(NasError::Network("无法获取影视列表，网络断开".to_string()));
        }
        if session.token().is_none() {
            return Err(NasError::Unauthorized);
        }
        if !self
            .mock_classifications
            .iter()
            .any(|item| item.id == classification_id && item.is_visible())
        {
            return Err(NasError::Business {
                code: "T000001".to_string(),
                message: "分类参数无效".to_string(),
            });
        }

        let total = self.mock_collections.len();
        let skip = if start > 0 {
            start.saturating_sub(1)
        } else {
            0
        };
        let slice = self
            .mock_collections
            .iter()
            .skip(skip)
            .take(limit)
            .cloned()
            .collect();

        Ok(CollectionPage {
            count: total,
            classification_name: Some("默认分类".to_string()),
            list: slice,
        })
    }

    fn get_collection_detail(
        &self,
        session: &NasSession,
        collection_id: &str,
        _classification_id: &str,
    ) -> Result<CollectionDetail, NasError> {
        if self.network_error {
            return Err(NasError::Network("无法获取影视详情，网络断开".to_string()));
        }
        if session.token().is_none() {
            return Err(NasError::Unauthorized);
        }

        if let Some(detail) = self.mock_collection_details.get(collection_id) {
            return Ok(detail.clone());
        }

        let collection = self
            .mock_collections
            .iter()
            .find(|item| item.collection_id == collection_id)
            .ok_or_else(|| NasError::Business {
                code: "NOT_FOUND".to_string(),
                message: "未找到该影视集合".to_string(),
            })?;

        Ok(CollectionDetail {
            collection_id: collection.collection_id.clone(),
            title: collection.title.clone(),
            cover: collection.cover.clone(),
            release_year: collection.release_year.clone(),
            video_type: collection.video_type.clone(),
            score: collection.score.clone(),
            rating: collection.rating.clone(),
            storyline: collection.storyline.clone(),
            seasons: vec![Season {
                season_number: 1,
                title: "正片".to_string(),
                episodes: vec![Episode {
                    video_id: collection.collection_id.clone(),
                    episode_number: 1,
                    title: collection.title.clone(),
                    ..Episode::default()
                }],
            }],
            ..CollectionDetail::default()
        })
    }

    fn get_playback_stream(
        &self,
        session: &NasSession,
        episode: &Episode,
    ) -> Result<PlaybackStream, NasError> {
        if self.network_error {
            return Err(NasError::Network("无法获取播放地址，网络断开".to_string()));
        }
        if !session.is_authenticated() {
            return Err(NasError::Unauthorized);
        }
        if episode.file_path.trim().is_empty() {
            return Err(NasError::MalformedResponse(
                "Episode 缺少 file_path，无法请求播放地址".to_string(),
            ));
        }

        let uri = self
            .mock_playback_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| NasError::MalformedResponse("播放地址响应缺少有效 URI".to_string()))?;
        Ok(PlaybackStream {
            uri: uri.to_string(),
            audio_tracks: Vec::new(),
            subtitle_tracks: Vec::new(),
            extra_fields: Map::new(),
        })
    }

    fn update_playback_progress(
        &self,
        session: &NasSession,
        progress: &PlaybackProgressUpdate,
    ) -> Result<(), NasError> {
        if self.network_error {
            return Err(NasError::Network("播放进度上报失败，网络断开".to_string()));
        }
        if !session.is_authenticated() {
            return Err(NasError::Unauthorized);
        }
        self.progress_receipts
            .lock()
            .unwrap()
            .push(progress.clone());
        Ok(())
    }

    fn fetch_image(&self, session: &NasSession, _image_path: &str) -> Result<Vec<u8>, NasError> {
        if self.network_error {
            return Err(NasError::Network("图片下载失败，网络中断".to_string()));
        }
        if session.token().is_none() {
            return Err(NasError::Unauthorized);
        }

        // Return a valid minimal 1x1 PNG pixel for mock testing
        let dummy_png = vec![
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00,
            0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78,
            0xda, 0x63, 0x64, 0x60, 0x00, 0x00, 0x00, 0x06, 0x00, 0x02, 0x30, 0x81, 0xd0, 0x2f,
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];
        Ok(dummy_png)
    }
}

#[derive(Debug, Default, Deserialize)]
struct PlaybackResponseData {
    #[serde(
        default,
        alias = "url",
        alias = "play_addr",
        alias = "play_url",
        alias = "address"
    )]
    uri: Option<String>,
    #[serde(default)]
    audio_list: Vec<Value>,
    #[serde(default)]
    subtitle_list: Vec<Value>,
    #[serde(flatten)]
    extra_fields: Map<String, Value>,
}

fn resolve_playback_uri(base_url: &str, uri: &str) -> Result<String, NasError> {
    let uri = uri.trim();
    if uri.is_empty() {
        return Err(NasError::MalformedResponse(
            "播放地址响应缺少有效 URI".to_string(),
        ));
    }
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return Ok(uri.to_string());
    }
    let base_url = base_url.trim_end_matches('/');
    if base_url.is_empty() {
        return Err(NasError::MalformedResponse(
            "NAS 会话缺少有效地址".to_string(),
        ));
    }
    let path = if uri.starts_with('/') {
        uri.to_string()
    } else {
        format!("/{}", uri)
    };
    Ok(format!("{}{}", base_url, path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nas::session::{NasDeviceMetadata, NasRequestContext};

    fn read_http_request_line(stream: &mut std::net::TcpStream) -> String {
        use std::io::Read;

        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        let header_end;
        loop {
            let read = stream.read(&mut buffer).expect("read test request");
            assert!(read > 0, "client closed before sending test request");
            request.extend_from_slice(&buffer[..read]);
            if let Some(position) = request
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
            {
                header_end = position + 4;
                break;
            }
        }

        let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        while request.len() < header_end + content_length {
            let read = stream.read(&mut buffer).expect("read test request body");
            assert!(read > 0, "client closed before sending test request body");
            request.extend_from_slice(&buffer[..read]);
        }

        headers.lines().next().expect("test request line").to_string()
    }

    #[test]
    fn collection_list_form_matches_nas_contract() {
        let context = NasRequestContext {
            token: "session-token".to_string(),
            nas_id: Some("real-nas-id".to_string()),
            nas_sign: Some("opaque-sign".to_string()),
            app: "video",
            platform: "pc",
            device: NasDeviceMetadata::default(),
        };
        let form = build_collection_list_form(&context, "classification-01", 1, 50);
        let normal_form =
            build_collection_list_form_for_system(&context, "classification-01", 1, 50, 94);

        assert!(form.contains(&("classification_id".to_string(), "classification-01".to_string())));
        assert!(form.contains(&("start".to_string(), "1".to_string())));
        assert!(form.contains(&("limit".to_string(), "50".to_string())));
        assert!(form.contains(&("system".to_string(), "7".to_string())));
        assert!(normal_form.contains(&("system".to_string(), "94".to_string())));
        assert!(form.contains(&("token".to_string(), "session-token".to_string())));
        assert!(form.contains(&("nasid".to_string(), "real-nas-id".to_string())));
        assert!(!form.contains(&("nasid".to_string(), "opaque-sign".to_string())));

        let cookie = build_nas_cookie(&context);
        assert!(cookie.contains("nas_id=real-nas-id"));
        assert!(cookie.contains("sign=opaque-sign"));
        assert!(!cookie.contains("nas_id=opaque-sign"));
    }

    #[test]
    fn login_keeps_pubkey_sign_out_of_nas_id() {
        use std::io::Write;
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
        let address = listener.local_addr().expect("read local test address");
        let server = thread::spawn(move || {
            let public_key = "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6HscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";

            for _ in 0..3 {
                let (mut stream, _) = listener.accept().expect("accept login request");
                let request_line = read_http_request_line(&mut stream);
                let response_body = if request_line.starts_with("GET /key/pub?signme=1") {
                    serde_json::json!({
                        "code": 200,
                        "data": {
                            "key": public_key,
                            "sign": "opaque-pubkey-sign",
                            "name": "测试 NAS"
                        }
                    })
                    .to_string()
                } else if request_line.starts_with("POST /auth/login?&drnd=") {
                    serde_json::json!({
                        "code": 200,
                        "data": { "token": "login-token" }
                    })
                    .to_string()
                } else {
                    assert!(request_line.starts_with("GET /zhelper/state?&drnd="));
                    serde_json::json!({
                        "code": 200,
                        "data": { "nasid": "resolved-nas-id" }
                    })
                    .to_string()
                };

                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                )
                .expect("write login response");
            }
        });

        let response = HttpNasClient::new(Duration::from_secs(2))
            .login(
                &format!("http://{}", address),
                "admin",
                "password123",
                None,
            )
            .expect("login response should parse");
        server.join().expect("login server should finish");

        assert_eq!(response.nas_id.as_deref(), Some("resolved-nas-id"));
        assert_eq!(response.nas_sign.as_deref(), Some("opaque-pubkey-sign"));
    }

    #[test]
    fn http_login_refines_nas_id_from_zhelper_state() {
        use std::io::Write;
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
        listener
            .set_nonblocking(true)
            .expect("configure nonblocking login server");
        let address = listener.local_addr().expect("read local test address");
        let server = thread::spawn(move || {
            let public_key = "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6HscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            let mut request_lines = Vec::new();

            while request_lines.len() < 3 && std::time::Instant::now() < deadline {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(error) => panic!("accept login request: {error}"),
                };

                let request_line = read_http_request_line(&mut stream);
                request_lines.push(request_line);
                let request_line = request_lines.last().expect("request line");
                let response_body = if request_line.starts_with("GET /key/pub?signme=1") {
                    serde_json::json!({
                        "code": 200,
                        "data": {
                            "key": public_key,
                            "sign": "opaque-pubkey-sign",
                            "name": "测试 NAS"
                        }
                    })
                    .to_string()
                } else if request_line.starts_with("POST /auth/login?&drnd=") {
                    serde_json::json!({
                        "code": 200,
                        "data": { "token": "login-token" }
                    })
                    .to_string()
                } else {
                    assert!(request_line.starts_with("GET /zhelper/state?&drnd="));
                    serde_json::json!({
                        "code": 200,
                        "data": { "nasid": "resolved-nas-id" }
                    })
                    .to_string()
                };

                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                )
                .expect("write login response");
            }

            request_lines
        });

        let response = HttpNasClient::new(Duration::from_secs(2)).login(
            &format!("http://{}", address),
            "admin",
            "password123",
            None,
        );
        let request_lines = server.join().expect("login server should finish");

        let response = response.expect("login response should parse");
        assert_eq!(request_lines.len(), 3, "login must refine NAS identity after auth");
        assert_eq!(response.nas_id.as_deref(), Some("resolved-nas-id"));
    }

    #[test]
    fn library_request_errors_preserve_http_status_and_auth_semantics() {
        assert!(matches!(
            map_nas_http_status("获取影视列表失败", 401),
            NasError::Unauthorized
        ));
        assert!(matches!(
            map_nas_http_status("获取影视列表失败", 403),
            NasError::Unauthorized
        ));

        let error = map_nas_http_status("获取影视列表失败", 400);
        assert!(matches!(
            error,
            NasError::Http { status: 400, message } if message == "获取影视列表失败 HTTP 400"
        ));
    }

    #[test]
    fn test_normalize_lan_url() {
        assert_eq!(
            normalize_lan_url("192.168.1.100").unwrap(),
            "http://192.168.1.100:5055"
        );
        assert_eq!(
            normalize_lan_url("192.168.1.100:5055").unwrap(),
            "http://192.168.1.100:5055"
        );
        assert_eq!(
            normalize_lan_url("http://192.168.1.100").unwrap(),
            "http://192.168.1.100:5055"
        );
        assert_eq!(
            normalize_lan_url("http://192.168.1.100:8080/").unwrap(),
            "http://192.168.1.100:8080"
        );
        assert_eq!(
            normalize_lan_url("https://192.168.1.100").unwrap(),
            "https://192.168.1.100:5050"
        );
        assert!(normalize_lan_url("   ").is_err());
    }

    #[test]
    fn test_mock_client_login_success() {
        let client = MockNasClient::new();
        let res = client
            .login("192.168.1.50", "admin", "password123", None)
            .expect("login should succeed");
        assert_eq!(res.token, "mock_session_token_xyz_888");
        assert_eq!(res.username.unwrap(), "admin");
    }

    #[test]
    fn test_mock_client_password_error() {
        let client = MockNasClient::new();
        let err = client
            .login("192.168.1.50", "admin", "wrong_pass", None)
            .expect_err("should fail with bad password");
        match err {
            AuthError::AuthFailed { code, .. } => assert_eq!(code, "N150061"),
            other => panic!("Unexpected error type: {:?}", other),
        }
    }

    #[test]
    fn test_mock_client_mfa_flow() {
        let client = MockNasClient::new().with_mfa(true);

        // 1. First attempt without sms_proof -> MfaRequired
        let err = client
            .login("192.168.1.50", "admin", "password123", None)
            .expect_err("should require MFA");
        match err {
            AuthError::MfaRequired { code, .. } => assert_eq!(code, "N001204"),
            other => panic!("Unexpected error: {:?}", other),
        }

        // 2. Verification cannot happen before the code has been sent.
        let err_without_send = client
            .verify_mfa_code("192.168.1.50", "admin", "123456")
            .expect_err("verification should require a prior send");
        match err_without_send {
            AuthError::AuthFailed { code, .. } => assert_eq!(code, "MFA_NOT_REQUESTED"),
            other => panic!("Unexpected error: {:?}", other),
        }

        // 3. Send and verify the user-entered code through the cloud flow.
        client
            .send_mfa_code("192.168.1.50", "admin", None)
            .expect("sending MFA code should succeed");
        let err_bad_mfa = client
            .verify_mfa_code("192.168.1.50", "admin", "999999")
            .expect_err("should reject invalid MFA code");
        match err_bad_mfa {
            AuthError::AuthFailed { code, .. } => assert_eq!(code, "N001205"),
            other => panic!("Unexpected error: {:?}", other),
        }

        let proof = client
            .verify_mfa_code("192.168.1.50", "admin", "123456")
            .expect("verification should return an opaque proof");
        assert_ne!(proof.as_str(), "123456");

        // 4. Final NAS login accepts only the returned proof, never the raw code.
        let res = client
            .login("192.168.1.50", "admin", "password123", Some(&proof))
            .expect("should succeed with valid MFA code");
        assert_eq!(res.token, "mock_session_token_xyz_888");
    }

    #[test]
    fn test_mock_client_network_error() {
        let client = MockNasClient::new().with_network_error(true);
        let err = client
            .login("192.168.1.50", "admin", "password123", None)
            .expect_err("should fail on network error");
        match err {
            AuthError::Network(_) => {}
            other => panic!("Expected Network error, got: {:?}", other),
        }
    }

    #[test]
    fn mock_client_returns_movie_and_multi_season_collection_details() {
        let client = MockNasClient::new();
        let session = NasSession::new("http://192.168.1.50:5055".to_string());
        session.set_authenticated(
            "mock-token".to_string(),
            "admin".to_string(),
            None,
            None,
            None,
        );

        let movie = client
            .get_collection_detail(&session, "c01", "1")
            .expect("mock movie detail should be available");
        assert!(movie.is_movie());
        assert_eq!(movie.seasons.len(), 1);
        assert_eq!(movie.seasons[0].episodes.len(), 1);

        let series = client
            .get_collection_detail(&session, "series-demo", "2")
            .expect("mock series detail should be available");
        assert_eq!(series.seasons.len(), 2);
        assert_eq!(series.seasons[0].episodes.len(), 2);
        assert_eq!(series.seasons[1].episodes[0].title, "第二季·第1集");
    }

    #[test]
    fn mock_client_rejects_unknown_classification_id_in_collection_owner() {
        let client = MockNasClient::new();
        let session = NasSession::new("http://192.168.1.50:5055".to_string());
        session.set_authenticated(
            "mock-token".to_string(),
            "admin".to_string(),
            None,
            None,
            None,
        );

        let valid_page = client
            .get_collections(&session, "1", 1, 50)
            .expect("known classification should keep the happy path");
        assert_eq!(valid_page.list.len(), 4);

        let error = client
            .get_collections(&session, "not-a-real-category", 1, 50)
            .expect_err("unknown classification must not reuse the success page");
        assert!(matches!(
            error,
            NasError::Business { code, .. } if code == "T000001"
        ));
    }

    #[test]
    fn http_client_posts_collection_detail_with_session_auth_and_expected_parameters() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
        let address = listener.local_addr().expect("read local test address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept detail request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let header_end;
            loop {
                let read = stream.read(&mut buffer).expect("read detail request");
                assert!(read > 0, "client closed before sending request");
                request.extend_from_slice(&buffer[..read]);
                if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n")
                {
                    header_end = position + 4;
                    break;
                }
            }

            let headers = String::from_utf8_lossy(&request[..header_end]);
            assert!(headers.starts_with("POST /zvideo/collection/v2/info?&drnd="));
            assert!(headers.to_ascii_lowercase().contains("token: detail-token"));
            assert!(headers
                .to_ascii_lowercase()
                .contains("cookie: app=video; token=detail-token; plat=pc; nas_id=detail-nas-id"));
            assert!(headers
                .to_ascii_lowercase()
                .contains("content-type: application/x-www-form-urlencoded"));

            let content_length = headers
                .lines()
                .find_map(|line| line.strip_prefix("Content-Length: "))
                .and_then(|value| value.trim().parse::<usize>().ok())
                .expect("request should include content length");
            while request.len() < header_end + content_length {
                let read = stream.read(&mut buffer).expect("read detail request body");
                assert!(read > 0, "client closed before sending request body");
                request.extend_from_slice(&buffer[..read]);
            }

            let payload = String::from_utf8_lossy(&request[header_end..header_end + content_length]);
            assert!(payload.contains("collection_id=movie-01"));
            assert!(payload.contains("get_type=all"));
            assert!(payload.contains("classification_id=classification-01"));
            assert!(payload.contains("token=detail-token"));
            assert!(payload.contains("nasid=detail-nas-id"));
            assert!(payload.contains("app=video"));
            assert!(payload.contains("plat=pc"));

            let response = r#"{"code":200,"data":{"collection_id":"movie-01","title":"本地测试电影","type":"movie","list":[{"version_list":[{"video_id":"movie-video","episode":1,"file_path":"/media/movie.mkv"}]}]}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .expect("write detail response");
        });

        let session = NasSession::new(format!("http://{}", address));
        session.set_authenticated(
            "detail-token".to_string(),
            "test-user".to_string(),
            None,
            None,
            Some("detail-nas-id".to_string()),
        );
        let client = HttpNasClient::new(Duration::from_secs(2));
        let detail = client
            .get_collection_detail(&session, "movie-01", "classification-01")
            .expect("HTTP detail response should parse");
        server.join().expect("detail server should finish");

        assert_eq!(detail.title, "本地测试电影");
        assert_eq!(detail.seasons[0].episodes[0].video_id, "movie-video");
    }

    #[test]
    fn http_client_posts_playback_progress_as_nas_form() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
        let address = listener.local_addr().expect("read local test address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept progress request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let header_end;
            loop {
                let read = stream.read(&mut buffer).expect("read progress request");
                assert!(read > 0, "client closed before sending request");
                request.extend_from_slice(&buffer[..read]);
                if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    header_end = position + 4;
                    break;
                }
            }

            let headers = String::from_utf8_lossy(&request[..header_end]);
            assert!(headers.starts_with("POST /zvideo/video/updateplaytime?&drnd="));
            assert!(headers
                .to_ascii_lowercase()
                .contains("cookie: app=video; token=progress-token; plat=pc; nas_id=progress-nas-id"));
            assert!(headers
                .to_ascii_lowercase()
                .contains("content-type: application/x-www-form-urlencoded"));

            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("Content-Length").then_some(value.trim())
                })
                .and_then(|value| value.parse::<usize>().ok())
                .expect("request should include content length");
            while request.len() < header_end + content_length {
                let read = stream.read(&mut buffer).expect("read progress request body");
                assert!(read > 0, "client closed before sending request body");
                request.extend_from_slice(&buffer[..read]);
            }

            let payload = String::from_utf8_lossy(&request[header_end..header_end + content_length]);
            for field in [
                "collection_id=collection-01",
                "classification_id=classification-01",
                "video_id=video-01",
                "sec=42",
                "chapter=2",
                "audio_index=1",
                "subtitle_index=3",
                "subtitle_hash=hash-01",
                "video_duration=3600",
                "subtitle_setting=default",
                "token=progress-token",
                "nasid=progress-nas-id",
                "app=video",
                "plat=pc",
            ] {
                assert!(payload.contains(field), "missing form field: {field}");
            }

            let response = r#"{"code":200,"data":{}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .expect("write progress response");
        });

        let session = NasSession::new(format!("http://{}", address));
        session.set_authenticated(
            "progress-token".to_string(),
            "test-user".to_string(),
            None,
            None,
            Some("progress-nas-id".to_string()),
        );
        let progress = PlaybackProgressUpdate {
            collection_id: "collection-01".to_string(),
            classification_id: "classification-01".to_string(),
            video_id: "video-01".to_string(),
            sec: 42,
            chapter: 2,
            audio_index: 1,
            subtitle_index: 3,
            subtitle_hash: "hash-01".to_string(),
            video_duration: 3600,
            subtitle_setting: "default".to_string(),
        };
        HttpNasClient::new(Duration::from_secs(2))
            .update_playback_progress(&session, &progress)
            .expect("HTTP progress response should succeed");
        server.join().expect("progress server should finish");
    }
}
