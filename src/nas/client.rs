use std::time::{Duration, SystemTime, UNIX_EPOCH};
use log::info;

use crate::nas::auth::{ApiResponse, AuthError, LoginResponseData, NasPubKeyData};
use crate::nas::crypto::{encrypt_credential, parse_public_key};

/// Trait defining the core LAN authentication protocol with a Z-Space NAS.
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
}

impl Default for MockNasClient {
    fn default() -> Self {
        Self {
            expected_username: "admin".to_string(),
            expected_password: "password123".to_string(),
            require_mfa: false,
            mfa_code: "123456".to_string(),
            network_error: false,
            mock_token: "mock_session_token_xyz_888".to_string(),
            mock_nas_name: "极空间-私有存储".to_string(),
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
}
