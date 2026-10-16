use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use log::info;
use serde::Deserialize;

use crate::nas::auth::{ApiResponse, AuthError, LoginResponseData, NasPubKeyData};
use crate::nas::crypto::{encrypt_credential, parse_public_key};
use crate::nas::models::{
    ClassificationItem, CollectionDetail, CollectionItem, CollectionPage, Episode, NasError, Season,
};
use crate::nas::session::NasSession;
use crate::playback::PlaybackStream;

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
        sms_proof: Option<&str>,
    ) -> Result<LoginResponseData, AuthError>;

    /// Fetches the classification categories of the Z-Video library (`POST /zvideo/classification/list`).
    fn get_classifications(&self, session: &NasSession) -> Result<Vec<ClassificationItem>, NasError>;

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
        return Err(AuthError::InvalidUrl(format!("未识别到主机或 IP: {}", input)));
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

/// Real HTTP implementation of `NasClient` using `ureq`.
pub struct HttpNasClient {
    timeout: Duration,
    agent: ureq::Agent,
}

impl Default for HttpNasClient {
    fn default() -> Self {
        Self::new(Duration::from_secs(10))
    }
}

impl HttpNasClient {
    pub fn new(timeout: Duration) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout(timeout)
            .build();
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
}

impl NasClient for HttpNasClient {
    fn fetch_public_key(&self, base_url: &str) -> Result<NasPubKeyData, AuthError> {
        let normalized_base = normalize_lan_url(base_url)?;
        let url = format!("{}/key/pub?signme=1", normalized_base);
        info!("Fetching NAS public key from: {}", url);

        let resp = self
            .agent
            .get(&url)
            .call()
            .map_err(|e| AuthError::Network(format!("连接 /key/pub 失败: {}", e)))?;

        let status = resp.status();
        if status != 200 {
            return Err(AuthError::Http {
                status,
                message: format!("HTTP {}", status),
            });
        }

        let body: ApiResponse<NasPubKeyData> = resp
            .into_json()
            .map_err(|e| AuthError::MalformedResponse(format!("解析 /key/pub 响应失败: {}", e)))?;

        if !body.is_success() {
            let code = body.code_str();
            let msg = body.error_message();
            return Err(AuthError::AuthFailed { code, message: msg });
        }

        body.data.ok_or_else(|| {
            AuthError::MalformedResponse("响应成功但缺少 public key 数据".to_string())
        })
    }

    fn login(
        &self,
        base_url: &str,
        username: &str,
        password: &str,
        sms_proof: Option<&str>,
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
        info!("Submitting credentials to: {}/auth/login", normalized_base);

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
            proof_str = proof.trim().to_string();
            form_params.push(("sms_proof", &proof_str));
        }

        // 5. POST request
        let resp = self
            .agent
            .post(&login_url)
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send_form(&form_params)
            .map_err(|e| AuthError::Network(format!("请求 /auth/login 失败: {}", e)))?;

        let status = resp.status();
        if status != 200 {
            return Err(AuthError::Http {
                status,
                message: format!("HTTP {}", status),
            });
        }

        let body: ApiResponse<LoginResponseData> = resp
            .into_json()
            .map_err(|e| AuthError::MalformedResponse(format!("解析 /auth/login 响应失败: {}", e)))?;

        let code = body.code_str();
        if body.is_success() {
            let mut data = body.data.ok_or_else(|| {
                AuthError::MalformedResponse("登录成功但缺少用户会话数据".to_string())
            })?;
            // Supplement metadata from pubkey response if absent
            if data.nas_name.is_none() {
                data.nas_name = pubkey_data.name;
            }
            if data.nas_id.is_none() {
                data.nas_id = pubkey_data.sign;
            }
            Ok(data)
        } else {
            let msg = body.error_message();
            if code == "N001204" || code == "N001414" {
                Err(AuthError::MfaRequired { code, message: msg })
            } else {
                Err(AuthError::AuthFailed { code, message: msg })
            }
        }
    }

    fn get_classifications(&self, session: &NasSession) -> Result<Vec<ClassificationItem>, NasError> {
        let base_url = session.base_url();
        let token = session.token().ok_or(NasError::Unauthorized)?;
        let url = format!("{}/zvideo/classification/list?token={}", base_url, token);

        let resp = self
            .agent
            .post(&url)
            .set("token", &token)
            .set("Cookie", &format!("token={}", token))
            .send_json(serde_json::json!({}))
            .map_err(|e| NasError::Network(format!("获取分类列表失败: {}", e)))?;

        let status = resp.status();
        if status != 200 {
            return Err(NasError::Http {
                status,
                message: format!("HTTP {}", status),
            });
        }

        let body: ApiResponse<Vec<ClassificationItem>> = resp
            .into_json()
            .map_err(|e| NasError::MalformedResponse(format!("解析分类列表失败: {}", e)))?;

        if !body.is_success() {
            return Err(NasError::Business {
                code: body.code_str(),
                message: body.error_message(),
            });
        }

        let mut list = body.data.unwrap_or_default();
        list.retain(|item| item.is_visible());
        Ok(list)
    }

    fn get_collections(
        &self,
        session: &NasSession,
        classification_id: &str,
        start: usize,
        limit: usize,
    ) -> Result<CollectionPage, NasError> {
        let base_url = session.base_url();
        let token = session.token().ok_or(NasError::Unauthorized)?;
        let url = format!("{}/zvideo/video/v2/list?token={}", base_url, token);

        let payload = serde_json::json!({
            "classification_id": classification_id,
            "start": start,
            "limit": limit,
            "system": 7
        });

        let resp = self
            .agent
            .post(&url)
            .set("token", &token)
            .set("Cookie", &format!("token={}", token))
            .send_json(payload)
            .map_err(|e| NasError::Network(format!("获取影视列表失败: {}", e)))?;

        let status = resp.status();
        if status != 200 {
            return Err(NasError::Http {
                status,
                message: format!("HTTP {}", status),
            });
        }

        let body: ApiResponse<CollectionPage> = resp
            .into_json()
            .map_err(|e| NasError::MalformedResponse(format!("解析影视列表失败: {}", e)))?;

        if !body.is_success() {
            return Err(NasError::Business {
                code: body.code_str(),
                message: body.error_message(),
            });
        }

        body.data.ok_or_else(|| NasError::MalformedResponse("响应缺少影片列表数据".to_string()))
    }

    fn get_collection_detail(
        &self,
        session: &NasSession,
        collection_id: &str,
        classification_id: &str,
    ) -> Result<CollectionDetail, NasError> {
        let base_url = session.base_url();
        let token = session.token().ok_or(NasError::Unauthorized)?;
        let url = format!("{}/zvideo/collection/v2/info?token={}", base_url, token);
        let payload = serde_json::json!({
            "collection_id": collection_id,
            "get_type": "all",
            "classification_id": classification_id,
        });

        let resp = self
            .agent
            .post(&url)
            .set("token", &token)
            .set("Cookie", &format!("token={}", token))
            .send_json(payload)
            .map_err(|e| NasError::Network(format!("获取影视详情失败: {}", e)))?;

        let status = resp.status();
        if status != 200 {
            return Err(NasError::Http {
                status,
                message: format!("HTTP {}", status),
            });
        }

        let body: ApiResponse<CollectionDetail> = resp
            .into_json()
            .map_err(|e| NasError::MalformedResponse(format!("解析影视详情失败: {}", e)))?;

        if !body.is_success() {
            return Err(NasError::Business {
                code: body.code_str(),
                message: body.error_message(),
            });
        }

        body.data
            .ok_or_else(|| NasError::MalformedResponse("响应缺少影视详情数据".to_string()))
    }

    fn get_playback_stream(
        &self,
        session: &NasSession,
        episode: &Episode,
    ) -> Result<PlaybackStream, NasError> {
        let base_url = session.base_url();
        let token = session.token().filter(|value| !value.trim().is_empty()).ok_or(NasError::Unauthorized)?;
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

        let mut request = self
            .agent
            .get(&url)
            .query("token", &token)
            .query("file_path", file_path)
            .query("play_env", "1")
            .query("video_codec", "hevc,h264,mpeg4")
            .query("support_format", "3")
            .query("audio_index", "0")
            .query("subtitle_index", "0")
            .query("dest_fmt", "OP")
            .set("token", &token)
            .set("Cookie", &format!("token={}", token));

        if let Some(encrypted_path) = encrypted_path {
            request = request.query("encrypted_path", encrypted_path);
        }
        if let Some(from) = episode.from.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            request = request.query("from", from);
        }

        let response = request
            .call()
            .map_err(|_| NasError::Network("获取播放地址请求失败".to_string()))?;

        let status = response.status();
        if status != 200 {
            return Err(NasError::Http {
                status,
                message: "播放地址服务返回异常".to_string(),
            });
        }

        let body: ApiResponse<PlaybackResponseData> = response
            .into_json()
            .map_err(|_| NasError::MalformedResponse("无法解析播放地址响应".to_string()))?;

        if !body.is_success() {
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
            .ok_or_else(|| NasError::MalformedResponse("播放地址响应缺少有效 URI".to_string()))?;
        Ok(PlaybackStream {
            uri: resolve_playback_uri(&base_url, &uri)?,
        })
    }

    fn fetch_image(&self, session: &NasSession, image_path: &str) -> Result<Vec<u8>, NasError> {
        let base_url = session.base_url();
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

        let mut req = self.agent.get(&full_url);
        if let Some(token) = session.token() {
            req = req
                .set("token", &token)
                .set("Cookie", &format!("token={}", token));
        }

        let resp = req
            .call()
            .map_err(|e| NasError::Network(format!("下载图片失败: {}", e)))?;

        let mut bytes = Vec::new();
        use std::io::Read;
        resp.into_reader()
            .read_to_end(&mut bytes)
            .map_err(|e| NasError::Network(format!("读取图片流失败: {}", e)))?;

        Ok(bytes)
    }
}

/// Configurable mock client for unit and integration testing without requiring real hardware.
#[derive(Debug, Clone)]
pub struct MockNasClient {
    pub expected_username: String,
    pub expected_password: String,
    pub require_mfa: bool,
    pub mfa_code: String,
    pub network_error: bool,
    pub mock_token: String,
    pub mock_nas_name: String,
    pub mock_classifications: Vec<ClassificationItem>,
    pub mock_collections: Vec<CollectionItem>,
    pub mock_collection_details: HashMap<String, CollectionDetail>,
    pub mock_playback_uri: Option<String>,
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
                storyline: Some("近未来的地球黄沙遍野，前NASA宇航员库珀穿过虫洞寻找人类新家园。".to_string()),
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
                storyline: Some("讲述美国“原子弹之父”罗伯特·奥本海默主导曼哈顿计划的故事。".to_string()),
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
                storyline: Some("近未来的地球黄沙遍野，前NASA宇航员库珀穿过虫洞寻找人类新家园。".to_string()),
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
            network_error: false,
            mock_token: "mock_session_token_xyz_888".to_string(),
            mock_nas_name: "极空间-私有存储".to_string(),
            mock_classifications: classifications,
            mock_collections: collections,
            mock_collection_details,
            mock_playback_uri: Some("/mock/playback/stream".to_string()),
        }
    }
}

impl MockNasClient {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_mfa(mut self, require_mfa: bool) -> Self {
        self.require_mfa = require_mfa;
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
        sms_proof: Option<&str>,
    ) -> Result<LoginResponseData, AuthError> {
        if self.network_error {
            return Err(AuthError::Network("无法连接到指定 NAS，请检查网络".to_string()));
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
                Some(code) if code.trim() == self.mfa_code => {
                    // MFA passed
                }
                Some(_) => {
                    return Err(AuthError::AuthFailed {
                        code: "N001205".to_string(),
                        message: "短信验证码错误或已失效".to_string(),
                    });
                }
                None => {
                    return Err(AuthError::MfaRequired {
                        code: "N001204".to_string(),
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
            nas_id: Some("mock_opaque_sign_abc".to_string()),
            nas_name: Some(self.mock_nas_name.clone()),
        })
    }

    fn get_classifications(&self, session: &NasSession) -> Result<Vec<ClassificationItem>, NasError> {
        if self.network_error {
            return Err(NasError::Network("无法连接至 NAS 片库，网络断开".to_string()));
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
        _classification_id: &str,
        start: usize,
        limit: usize,
    ) -> Result<CollectionPage, NasError> {
        if self.network_error {
            return Err(NasError::Network("无法获取影视列表，网络断开".to_string()));
        }
        if session.token().is_none() {
            return Err(NasError::Unauthorized);
        }

        let total = self.mock_collections.len();
        let skip = if start > 0 { start.saturating_sub(1) } else { 0 };
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
        })
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
    #[serde(default, alias = "url", alias = "play_addr", alias = "play_url", alias = "address")]
    uri: Option<String>,
}

fn resolve_playback_uri(base_url: &str, uri: &str) -> Result<String, NasError> {
    let uri = uri.trim();
    if uri.is_empty() {
        return Err(NasError::MalformedResponse("播放地址响应缺少有效 URI".to_string()));
    }
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return Ok(uri.to_string());
    }
    let base_url = base_url.trim_end_matches('/');
    if base_url.is_empty() {
        return Err(NasError::MalformedResponse("NAS 会话缺少有效地址".to_string()));
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

        // 2. Second attempt with invalid sms_proof -> AuthFailed
        let err_bad_mfa = client
            .login("192.168.1.50", "admin", "password123", Some("999999"))
            .expect_err("should reject invalid MFA code");
        match err_bad_mfa {
            AuthError::AuthFailed { code, .. } => assert_eq!(code, "N001205"),
            other => panic!("Unexpected error: {:?}", other),
        }

        // 3. Third attempt with correct sms_proof -> Success
        let res = client
            .login("192.168.1.50", "admin", "password123", Some("123456"))
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
                if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    header_end = position + 4;
                    break;
                }
            }

            let headers = String::from_utf8_lossy(&request[..header_end]);
            assert!(headers.starts_with(&format!(
                "POST /zvideo/collection/v2/info?token=detail-token HTTP/1.1"
            )));
            assert!(headers.to_ascii_lowercase().contains("token: detail-token"));
            assert!(headers.to_ascii_lowercase().contains("cookie: token=detail-token"));

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

            let payload: serde_json::Value = serde_json::from_slice(
                &request[header_end..header_end + content_length],
            )
            .expect("detail request body should be JSON");
            assert_eq!(payload["collection_id"], "movie-01");
            assert_eq!(payload["get_type"], "all");
            assert_eq!(payload["classification_id"], "classification-01");

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
            None,
        );
        let client = HttpNasClient::new(Duration::from_secs(2));
        let detail = client
            .get_collection_detail(&session, "movie-01", "classification-01")
            .expect("HTTP detail response should parse");
        server.join().expect("detail server should finish");

        assert_eq!(detail.title, "本地测试电影");
        assert_eq!(detail.seasons[0].episodes[0].video_id, "movie-video");
    }
}
