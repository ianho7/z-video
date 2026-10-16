use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Public key response data returned by `/key/pub`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct NasPubKeyData {
    pub key: String,
    #[serde(default)]
    pub sign: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

/// Generic wrapper for Z-Space API responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub code: serde_json::Value,
    #[serde(default)]
    pub msg: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub data: Option<T>,
}

impl<T> ApiResponse<T> {
    /// Extracts the response code as a normalized string.
    pub fn code_str(&self) -> String {
        match &self.code {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }

    /// Checks if the response signifies business success (code == 200 or "S000200").
    pub fn is_success(&self) -> bool {
        match &self.code {
            serde_json::Value::Number(n) => n.as_i64() == Some(200),
            serde_json::Value::String(s) => s == "200" || s == "S000200",
            _ => false,
        }
    }

    /// Resolves the descriptive error message from `message`, `msg`, or `reason`.
    pub fn error_message(&self) -> String {
        if let Some(msg) = &self.message {
            if !msg.is_empty() {
                return msg.clone();
            }
        }
        if let Some(msg) = &self.msg {
            if !msg.is_empty() {
                return msg.clone();
            }
        }
        if let Some(reason) = &self.reason {
            if !reason.is_empty() {
                return reason.clone();
            }
        }
        "未知错误 (Unknown error)".to_string()
    }
}

/// Account & session data returned upon successful `/auth/login`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LoginResponseData {
    pub token: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub qcname: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub is_local: Option<bool>,
    #[serde(default)]
    pub userinfo: Option<serde_json::Value>,
    #[serde(default)]
    pub nas_id: Option<String>,
    #[serde(default)]
    pub nas_name: Option<String>,
}

/// Detailed error categories encountered during NAS authentication.
#[derive(Debug, Error)]
pub enum AuthError {
    #[error("网络连接失败，请检查 NAS 地址和局域网连接: {0}")]
    Network(String),

    #[error("HTTP 服务请求失败 (状态码 {status}): {message}")]
    Http { status: u16, message: String },

    #[error("安全加密运算错误: {0}")]
    Crypto(String),

    #[error("需要输入短信验证码 (MFA): {message}")]
    MfaRequired { code: String, message: String },

    #[error("认证失败 [{code}]: {message}")]
    AuthFailed { code: String, message: String },

    #[error("无效的 NAS 局域网地址: {0}")]
    InvalidUrl(String),

    #[error("NAS 返回报文格式无效: {0}")]
    MalformedResponse(String),
}

/// Removes secrets and query strings from text that may be written to logs.
pub fn sanitize_log_message(message: &str) -> String {
    message
        .split_whitespace()
        .map(sanitize_log_token)
        .collect::<Vec<_>>()
        .join(" ")
}

fn sanitize_log_token(token: &str) -> String {
    if token.starts_with("http://") || token.starts_with("https://") {
        return token
            .split('?')
            .next()
            .map(|base| format!("{} [REDACTED_QUERY]", base.trim_end_matches(',')))
            .unwrap_or_else(|| "[REDACTED_URL]".to_string());
    }

    let lower = token.to_ascii_lowercase();
    for key in ["token=", "password=", "cookie=", "authorization="] {
        if let Some(start) = lower.find(key) {
            let value_start = start + key.len();
            let value_end = token[value_start..]
                .find(['&', ';', ','])
                .map(|offset| value_start + offset)
                .unwrap_or(token.len());
            return format!(
                "{}{}[REDACTED]{}",
                &token[..value_start],
                "",
                &token[value_end..]
            );
        }
    }
    token.to_string()
}

impl AuthError {
    /// Formats a user-friendly recovery guidance string for UI display.
    pub fn user_recovery_hint(&self) -> String {
        match self {
            AuthError::MfaRequired { message, .. } => {
                format!(
                    "安全验证: {}。请输入短信/安全验证码后重试。",
                    sanitize_log_message(message)
                )
            }
            AuthError::AuthFailed { code, message } => {
                if code == "N150061" {
                    format!(
                        "密码错误: {}。请仔细核对账号和密码。",
                        sanitize_log_message(message)
                    )
                } else if code == "N001100" {
                    format!(
                        "账号状态异常: {}。请先在极空间官方移动 App 中确认。",
                        sanitize_log_message(message)
                    )
                } else {
                    format!(
                        "登录失败: {} (错误码: {})",
                        sanitize_log_message(message),
                        code
                    )
                }
            }
            AuthError::Network(err) => {
                format!(
                    "网络连接超时或无法访问 NAS ({})。请检查局域网是否畅通、端口 5055 是否开启。",
                    sanitize_log_message(err)
                )
            }
            AuthError::InvalidUrl(err) => {
                format!(
                    "NAS 地址格式错误: {}。示例: 192.168.1.100 或 http://192.168.1.100:5055",
                    sanitize_log_message(err)
                )
            }
            AuthError::Http { status, message } => {
                format!("NAS HTTP 服务异常 [{status}]: {}", sanitize_log_message(message))
            }
            AuthError::Crypto(err) => {
                format!("安全加密协商失败: {}", sanitize_log_message(err))
            }
            AuthError::MalformedResponse(err) => {
                format!("无法解析 NAS 响应: {}", sanitize_log_message(err))
            }
        }
    }
}
