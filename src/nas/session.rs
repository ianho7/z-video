use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Thread-safe NAS authentication session.
/// Maintains the active session token, base URL, user profile, and sign info.
#[derive(Debug, Clone)]
pub struct NasSession {
    base_url: Arc<Mutex<String>>,
    token: Arc<Mutex<Option<String>>>,
    username: Arc<Mutex<Option<String>>>,
    qcname: Arc<Mutex<Option<String>>>,
    nas_name: Arc<Mutex<Option<String>>>,
    nas_sign: Arc<Mutex<Option<String>>>,
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
            nas_sign: Arc::new(Mutex::new(None)),
            authenticated_at: Arc::new(Mutex::new(None)),
        }
    }

    /// Sets the active authenticated credentials and session metadata.
    pub fn set_authenticated(
        &self,
        token: String,
        username: String,
        qcname: Option<String>,
        nas_name: Option<String>,
        nas_sign: Option<String>,
    ) {
        *self.token.lock().unwrap() = Some(token);
        *self.username.lock().unwrap() = Some(username);
        *self.qcname.lock().unwrap() = qcname;
        *self.nas_name.lock().unwrap() = nas_name;
        *self.nas_sign.lock().unwrap() = nas_sign;
        *self.authenticated_at.lock().unwrap() = Some(Instant::now());
    }

    /// Clears the active session (logout).
    pub fn clear(&self) {
        *self.token.lock().unwrap() = None;
        *self.username.lock().unwrap() = None;
        *self.qcname.lock().unwrap() = None;
        *self.nas_name.lock().unwrap() = None;
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

    pub fn nas_sign(&self) -> Option<String> {
        self.nas_sign.lock().unwrap().clone()
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
            Some("sign_123".to_string()),
        );

        assert!(session.is_authenticated());
        assert_eq!(session.token().unwrap(), "test_token_xyz");
        assert_eq!(session.username().unwrap(), "admin_user");
        assert_eq!(session.qcname().unwrap(), "Admin");
        assert_eq!(session.nas_name().unwrap(), "MyZspace");
        assert_eq!(session.nas_sign().unwrap(), "sign_123");
        assert!(session.authenticated_at().is_some());

        session.clear();
        assert!(!session.is_authenticated());
        assert_eq!(session.token(), None);
        assert_eq!(session.username(), None);
    }
}
