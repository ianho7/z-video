use z_video::storage::credentials::{
    mask_password, mask_token, CredentialStore, MemoryCredentialStore, SavedCredentials,
    SensitiveString,
};

#[test]
fn test_credential_storage_crud_lifecycle() {
    let store = MemoryCredentialStore::new();

    // 1. Initial state empty
    assert!(store.load().unwrap().is_none());

    // 2. Save credentials
    let creds = SavedCredentials {
        server_url: "192.168.5.2:5055".to_string(),
        username: "master_user".to_string(),
        password: Some("p@ssword_xyz_2026".to_string()),
        token: Some("zenith_token_live_abcdef123456789".to_string()),
        nas_id: Some("nas-id-123".to_string()),
        nas_sign: Some("opaque-sign-123".to_string()),
        last_playback: None,
    };
    store.save(&creds).expect("save should succeed");

    // 3. Load credentials and verify equality
    let loaded = store.load().unwrap().expect("creds must exist");
    assert_eq!(loaded.server_url, "192.168.5.2:5055");
    assert_eq!(loaded.username, "master_user");
    assert_eq!(loaded.password.as_deref(), Some("p@ssword_xyz_2026"));
    assert_eq!(
        loaded.token.as_deref(),
        Some("zenith_token_live_abcdef123456789")
    );
    assert_eq!(loaded.nas_id.as_deref(), Some("nas-id-123"));
    assert_eq!(loaded.nas_sign.as_deref(), Some("opaque-sign-123"));

    // 4. Delete credentials
    store.delete().expect("delete should succeed");
    assert!(store.load().unwrap().is_none());
}

#[test]
fn test_legacy_saved_credentials_default_nas_id_to_none() {
    let legacy_json = r#"{
        "server_url": "192.168.5.2:5055",
        "username": "legacy_user",
        "token": "legacy-token"
    }"#;

    let loaded: SavedCredentials =
        serde_json::from_str(legacy_json).expect("legacy credentials should remain readable");
    assert_eq!(loaded.nas_id, None);
}

#[test]
fn test_sanitization_rules_never_expose_plaintext_secrets() {
    let raw_pass = "UltraSecret#Password888";
    let masked_p = mask_password(raw_pass);
    assert_eq!(masked_p, "[REDACTED_PASSWORD]");
    assert!(!masked_p.contains(raw_pass));

    let short_token = "abc123";
    assert_eq!(mask_token(short_token), "***[TOKEN]***");

    let long_token = "zenith_session_token_xyz9999";
    let masked_t = mask_token(long_token);
    assert!(masked_t.starts_with("zeni****9999"));
    assert!(!masked_t.contains("session_token"));

    // Verify Debug formatting of SavedCredentials
    let creds = SavedCredentials {
        server_url: "http://192.168.1.100:5055".to_string(),
        username: "security_auditor".to_string(),
        password: Some(raw_pass.to_string()),
        token: Some(long_token.to_string()),
        nas_id: None,
        nas_sign: None,
        last_playback: None,
    };

    let debug_output = format!("{:?}", creds);
    assert!(!debug_output.contains(raw_pass));
    assert!(!debug_output.contains("session_token_xyz"));
    assert!(debug_output.contains("[REDACTED_PASSWORD]"));
    assert!(debug_output.contains("zeni****9999"));
}

#[test]
fn test_sensitive_string_wrapper_protection() {
    let sensitive = SensitiveString::new("my_unencrypted_secret");
    assert_eq!(format!("{}", sensitive), "[PROTECTED]");
    assert_eq!(format!("{:?}", sensitive), "[PROTECTED]");
    // Real value only accessible via explicit method
    assert_eq!(sensitive.expose_secret(), "my_unencrypted_secret");
}
