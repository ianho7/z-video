use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const NAS_APP: &str = "video";
pub const NAS_PLATFORM: &str = "pc";

/// Optional device fields observed in the official Windows request envelope.
/// Unknown values stay absent instead of being fabricated.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NasDeviceMetadata {
    pub version: Option<String>,
    pub device_id: Option<String>,
    pub device: Option<String>,
    pub client_public_ip: Option<String>,
    pub locale: Option<String>,
    pub uuid: Option<String>,
}

impl NasDeviceMetadata {
    /// Returns the client identity already used by the LAN login protocol.
    ///
    /// These values are also part of the official Windows request envelope.
    /// Unknown per-installation values (public IP and UUID) remain absent.
    pub fn client_defaults() -> Self {
        Self {
            version: Some("2.3.0".to_string()),
            device_id: Some("z-video-client-01".to_string()),
            device: Some("z-video-desktop".to_string()),
            locale: Some("zh_cn".to_string()),
            ..Self::default()
        }
    }
}

/// Snapshot of the identity and metadata used to build a NAS request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NasRequestContext {
    pub token: String,
    pub nas_id: Option<String>,
    pub nas_sign: Option<String>,
    pub app: &'static str,
    pub platform: &'static str,
    pub device: NasDeviceMetadata,
}

/// Thread-safe NAS authentication session.
/// Maintains the active session token, NAS identity, opaque sign, and request metadata.
#[derive(Debug, Clone)]
pub struct NasSession {
    base_url: Arc<Mutex<String>>,
    token: Arc<Mutex<Option<String>>>,
    username: Arc<Mutex<Option<String>>>,
    qcname: Arc<Mutex<Option<String>>>,
    nas_name: Arc<Mutex<Option<String>>>,
    nas_id: Arc<Mutex<Option<String>>>,
    nas_sign: Arc<Mutex<Option<String>>>,
    device: Arc<Mutex<NasDeviceMetadata>>,
    authenticated_at: Arc<Mutex<Option<Instant>>>,
}

impl Default for NasSession {
    fn default() -> Self {
        Self::new("".to_string())
    }
}

impl NasSession {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url: Arc::new(Mutex::new(base_url)),
            token: Arc::new(Mutex::new(None)),
            username: Arc::new(Mutex::new(None)),
            qcname: Arc::new(Mutex::new(None)),
            nas_name: Arc::new(Mutex::new(None)),
            nas_id: Arc::new(Mutex::new(None)),
            nas_sign: Arc::new(Mutex::new(None)),
            device: Arc::new(Mutex::new(NasDeviceMetadata::default())),
            authenticated_at: Arc::new(Mutex::new(None)),
        }
    }

    /// Sets authenticated credentials and the real NAS identity returned by login.
    ///
    /// The final argument is deliberately `nas_id`; `/key/pub`'s opaque `sign`
    /// is stored separately with [`Self::set_nas_sign`].
    pub fn set_authenticated(
        &self,
        token: String,
        username: String,
        qcname: Option<String>,
        nas_name: Option<String>,
        nas_id: Option<String>,
    ) {
        self.set_authenticated_with_identity(token, username, qcname, nas_name, nas_id, None);
    }

    /// Sets both identity values when a caller has independently observed them.
    pub fn set_authenticated_with_identity(
        &self,
        token: String,
        username: String,
        qcname: Option<String>,
        nas_name: Option<String>,
        nas_id: Option<String>,
        nas_sign: Option<String>,
    ) {
        *self.token.lock().unwrap() = Some(token);
        *self.username.lock().unwrap() = Some(username);
        *self.qcname.lock().unwrap() = qcname;
        *self.nas_name.lock().unwrap() = nas_name;
        *self.nas_id.lock().unwrap() = nas_id;
        *self.nas_sign.lock().unwrap() = nas_sign;
        *self.authenticated_at.lock().unwrap() = Some(Instant::now());
    }

    /// Clears the active session (logout).
    pub fn clear(&self) {
        *self.token.lock().unwrap() = None;
        *self.username.lock().unwrap() = None;
        *self.qcname.lock().unwrap() = None;
        *self.nas_name.lock().unwrap() = None;
        *self.nas_id.lock().unwrap() = None;
        *self.nas_sign.lock().unwrap() = None;
        *self.authenticated_at.lock().unwrap() = None;
    }

    /// Checks if a valid non-empty token exists in this session.
    pub fn is_authenticated(&self) -> bool {
        self.token.lock().unwrap().as_ref().map_or(false, |t| !t.is_empty())
    }

    pub fn token(&self) -> Option<String> {
        self.token.lock().unwrap().clone()
    }

    pub fn username(&self) -> Option<String> {
        self.username.lock().unwrap().clone()
    }

    pub fn qcname(&self) -> Option<String> {
        self.qcname.lock().unwrap().clone()
    }

    pub fn nas_name(&self) -> Option<String> {
        self.nas_name.lock().unwrap().clone()
    }

    pub fn nas_id(&self) -> Option<String> {
        self.nas_id.lock().unwrap().clone()
    }

    pub fn set_nas_id(&self, nas_id: Option<String>) {
        *self.nas_id.lock().unwrap() = nas_id;
    }

    pub fn nas_sign(&self) -> Option<String> {
        self.nas_sign.lock().unwrap().clone()
    }

    pub fn set_nas_sign(&self, nas_sign: Option<String>) {
        *self.nas_sign.lock().unwrap() = nas_sign;
    }

    pub fn set_device_metadata(&self, device: NasDeviceMetadata) {
        *self.device.lock().unwrap() = device;
    }

    pub fn device_metadata(&self) -> NasDeviceMetadata {
        self.device.lock().unwrap().clone()
    }

    /// Creates a consistent request snapshot without exposing a partial token.
    pub fn request_context(&self) -> Option<NasRequestContext> {
        let token = self
            .token()
            .filter(|token| !token.trim().is_empty())?;
        Some(NasRequestContext {
            token,
            nas_id: self.nas_id(),
            nas_sign: self.nas_sign(),
            app: NAS_APP,
            platform: NAS_PLATFORM,
            device: self.device_metadata(),
        })
    }

    pub fn base_url(&self) -> String {
        self.base_url.lock().unwrap().clone()
    }

    pub fn set_base_url(&self, url: String) {
        *self.base_url.lock().unwrap() = url;
    }

    pub fn authenticated_at(&self) -> Option<Instant> {
        *self.authenticated_at.lock().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nas_session_lifecycle() {
        let session = NasSession::new("http://192.168.1.50:5055".to_string());
        assert!(!session.is_authenticated());
        assert_eq!(session.token(), None);

        session.set_authenticated(
            "test_token_xyz".to_string(),
            "admin_user".to_string(),
            Some("Admin".to_string()),
            Some("MyZspace".to_string()),
            Some("nas_id_123".to_string()),
        );
        session.set_nas_sign(Some("sign_123".to_string()));

        assert!(session.is_authenticated());
        assert_eq!(session.token().unwrap(), "test_token_xyz");
        assert_eq!(session.username().unwrap(), "admin_user");
        assert_eq!(session.qcname().unwrap(), "Admin");
        assert_eq!(session.nas_name().unwrap(), "MyZspace");
        assert_eq!(session.nas_id().unwrap(), "nas_id_123");
        assert_eq!(session.nas_sign().unwrap(), "sign_123");
        assert!(session.authenticated_at().is_some());

        session.clear();
        assert!(!session.is_authenticated());
        assert_eq!(session.token(), None);
        assert_eq!(session.username(), None);
    }

    #[test]
    fn request_context_keeps_nas_id_and_nas_sign_separate() {
        let session = NasSession::new("http://192.168.1.50:5055".to_string());
        session.set_authenticated(
            "session-token".to_string(),
            "admin_user".to_string(),
            None,
            None,
            None,
        );
        session.set_nas_id(Some("real-nas-id".to_string()));
        session.set_nas_sign(Some("opaque-sign".to_string()));

        let context = session.request_context().expect("authenticated context");
        assert_eq!(context.nas_id.as_deref(), Some("real-nas-id"));
        assert_eq!(context.nas_sign.as_deref(), Some("opaque-sign"));
    }
}
