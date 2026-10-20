use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SERVICE_NAME: &str = "z-video";
pub const DEFAULT_KEYRING_USER: &str = "default_user";

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("系统密钥环 (Keyring) 错误: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("凭证数据序列化失败: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("存储操作失败: {0}")]
    Other(String),
}

impl StorageError {
    /// Stable, secret-free classification for diagnostics and recovery UI.
    pub fn class(&self) -> &'static str {
        match self {
            Self::Keyring(_) => "keyring",
            Self::Serialization(_) => "serialization",
            Self::Other(_) => "other",
        }
    }

    /// Actionable guidance that never includes the underlying OS error text.
    pub fn user_recovery_hint(&self, operation: &str) -> String {
        match self {
            Self::Keyring(_) => format!(
                "无法{}系统安全凭据。请检查 Windows 凭据管理器权限后重试。",
                operation
            ),
            Self::Serialization(_) => format!(
                "无法{}保存的登录信息。请删除损坏的 z-video 凭据后重试。",
                operation
            ),
            Self::Other(_) => format!(
                "无法{}登录信息。请检查系统存储权限后重试。",
                operation
            ),
        }
    }
}

/// Persisted login credentials saved into the OS secure storage (Windows Credential Manager / macOS Keychain).
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
pub struct LastPlaybackContext {
    pub collection_id: String,
    pub classification_id: String,
    pub episode_id: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedCredentials {
    pub server_url: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nas_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nas_sign: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_playback: Option<LastPlaybackContext>,
}

// Custom Debug implementation ensuring sensitive fields (password, raw token) are NEVER logged
impl std::fmt::Debug for SavedCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SavedCredentials")
            .field("server_url", &self.server_url)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "[REDACTED_PASSWORD]"))
            .field("token", &self.token.as_ref().map(|t| mask_token(t)))
            .field("nas_id", &self.nas_id.as_ref().map(|id| mask_token(id)))
            .field("nas_sign", &self.nas_sign.as_ref().map(|sign| mask_token(sign)))
            .finish()
    }
}

/// Masks a sensitive session token for safe display or logging.
pub fn mask_token(token: &str) -> String {
    let len = token.len();
    if len <= 8 {
        "***[TOKEN]***".to_string()
    } else {
        let prefix = &token[..4];
        let suffix = &token[len - 4..];
        format!("{}****{} (len:{})", prefix, suffix, len)
    }
}

/// Masks a password string for safe display or logging.
pub fn mask_password(_password: &str) -> &'static str {
    "[REDACTED_PASSWORD]"
}

/// A wrapper for sensitive text preventing inadvertent logging or printing.
#[derive(Clone, PartialEq, Eq)]
pub struct SensitiveString(String);

impl SensitiveString {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }

    pub fn expose_secret(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for SensitiveString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[PROTECTED]")
    }
}

impl std::fmt::Display for SensitiveString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[PROTECTED]")
    }
}

/// Trait abstracting credential storage backend.
pub trait CredentialStore: Send + Sync {
    fn save(&self, creds: &SavedCredentials) -> Result<(), StorageError>;
    fn load(&self) -> Result<Option<SavedCredentials>, StorageError>;
    fn delete(&self) -> Result<(), StorageError>;
}

/// Standard OS keyring credential store backed by Windows Credential Manager or macOS Keychain.
pub struct KeyringCredentialStore {
    service: String,
    user: String,
}

impl Default for KeyringCredentialStore {
    fn default() -> Self {
        Self::new(SERVICE_NAME, DEFAULT_KEYRING_USER)
    }
}

impl KeyringCredentialStore {
    pub fn new(service: impl Into<String>, user: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            user: user.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new(&self.service, &self.user)
    }
}

impl CredentialStore for KeyringCredentialStore {
    fn save(&self, creds: &SavedCredentials) -> Result<(), StorageError> {
        let entry = self.entry()?;
        let json = serde_json::to_string(creds)?;
        entry.set_password(&json)?;
        info!("Saved credentials to secure OS storage (username: {})", creds.username);
        Ok(())
    }

    fn load(&self) -> Result<Option<SavedCredentials>, StorageError> {
        let entry = self.entry()?;
        match entry.get_password() {
            Ok(json) => {
                let creds: SavedCredentials = serde_json::from_str(&json)?;
                info!(
                    "Loaded saved credentials from secure storage (server: {}, user: {})",
                    creds.server_url, creds.username
                );
                Ok(Some(creds))
            }
            Err(keyring::Error::NoEntry) => {
                debug!("No saved credentials found in OS secure storage");
                Ok(None)
            }
            Err(e) => {
                warn!("Failed to read from OS keyring: {}", e);
                Err(StorageError::Keyring(e))
            }
        }
    }

    fn delete(&self) -> Result<(), StorageError> {
        let entry = self.entry()?;
        match entry.delete_credential() {
            Ok(_) => {
                info!("Deleted credentials from secure OS storage");
                Ok(())
            }
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(StorageError::Keyring(e)),
        }
    }
}

/// In-memory credential store for unit tests or headless test environments.
#[derive(Default)]
pub struct MemoryCredentialStore {
    storage: std::sync::Mutex<Option<SavedCredentials>>,
}

impl MemoryCredentialStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CredentialStore for MemoryCredentialStore {
    fn save(&self, creds: &SavedCredentials) -> Result<(), StorageError> {
        *self.storage.lock().unwrap() = Some(creds.clone());
        Ok(())
    }

    fn load(&self) -> Result<Option<SavedCredentials>, StorageError> {
        Ok(self.storage.lock().unwrap().clone())
    }

    fn delete(&self) -> Result<(), StorageError> {
        *self.storage.lock().unwrap() = None;
        Ok(())
    }
}

/// Convenience functions using standard KeyringCredentialStore
pub fn save_credentials(creds: &SavedCredentials) -> Result<(), StorageError> {
    KeyringCredentialStore::default().save(creds)
}

pub fn load_credentials() -> Result<Option<SavedCredentials>, StorageError> {
    KeyringCredentialStore::default().load()
}

pub fn delete_credentials() -> Result<(), StorageError> {
    KeyringCredentialStore::default().delete()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_credential_store() {
        let store = MemoryCredentialStore::new();
        assert_eq!(store.load().unwrap(), None);

        let creds = SavedCredentials {
            server_url: "192.168.1.100".to_string(),
            username: "admin".to_string(),
            password: Some("secret123".to_string()),
            token: Some("token_abc_xyz_123456".to_string()),
            nas_id: None,
            nas_sign: None,
            last_playback: None,
        };

        store.save(&creds).unwrap();
        let loaded = store.load().unwrap().expect("should find creds");
        assert_eq!(loaded.server_url, "192.168.1.100");
        assert_eq!(loaded.username, "admin");
        assert_eq!(loaded.password.unwrap(), "secret123");
        assert_eq!(loaded.token.unwrap(), "token_abc_xyz_123456");

        store.delete().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }

    #[test]
    fn test_debug_formatting_does_not_leak_secrets() {
        let creds = SavedCredentials {
            server_url: "http://192.168.1.100:5055".to_string(),
            username: "alice".to_string(),
            password: Some("SuperSecretPassword999!".to_string()),
            token: Some("zenith_token_live_abcdef123456".to_string()),
            nas_id: None,
            nas_sign: None,
            last_playback: None,
        };

        let debug_str = format!("{:?}", creds);
        assert!(!debug_str.contains("SuperSecretPassword999!"));
        assert!(!debug_str.contains("zenith_token_live_abcdef123456"));
        assert!(debug_str.contains("[REDACTED_PASSWORD]"));
        assert!(debug_str.contains("zeni****3456"));
    }

    #[test]
    fn test_sensitive_string_wrapper() {
        let secret = SensitiveString::new("super_confidential_token");
        assert_eq!(format!("{}", secret), "[PROTECTED]");
        assert_eq!(format!("{:?}", secret), "[PROTECTED]");
        assert_eq!(secret.expose_secret(), "super_confidential_token");
    }
}
