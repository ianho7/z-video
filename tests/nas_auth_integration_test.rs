use std::sync::Arc;
use std::time::Duration;
use slint::Timer;
use z_video::app::AppCoordinator;
use z_video::nas::client::{MockNasClient, NasClient};
use z_video::player::MockPlayer;
use z_video::storage::credentials::{
    CredentialStore, MemoryCredentialStore, SavedCredentials, StorageError,
};

fn pump_event_loop() {
    Timer::single_shot(Duration::from_millis(250), || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("auth event loop should exit cleanly");
}

#[derive(Default)]
struct FailingCredentialStore;

impl CredentialStore for FailingCredentialStore {
    fn save(&self, _creds: &SavedCredentials) -> Result<(), StorageError> {
        Err(StorageError::Other("secure store unavailable".to_string()))
    }

    fn load(&self) -> Result<Option<SavedCredentials>, StorageError> {
        Err(StorageError::Other("secure store unavailable".to_string()))
    }

    fn delete(&self) -> Result<(), StorageError> {
        Err(StorageError::Other("secure store unavailable".to_string()))
    }
}

#[test]
fn test_nas_auth_integration_comprehensive_suite() {
    // -------------------------------------------------------------
    // Scenario 1: Auto-load saved credentials on startup
    // -------------------------------------------------------------
    {
        let mock_player = Arc::new(MockPlayer::new());
        let mock_client = Arc::new(MockNasClient::new());
        let mock_store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::new());

        let preloaded = SavedCredentials {
            server_url: "192.168.5.88:5055".to_string(),
            username: "stored_admin".to_string(),
            password: Some("saved_pwd_123".to_string()),
            token: Some("existing_token_xyz".to_string()),
            nas_id: Some("stored_nas_id".to_string()),
            nas_sign: Some("stored_nas_sign".to_string()),
        };
        mock_store.save(&preloaded).expect("pre-seed credentials");

        let coordinator = AppCoordinator::with_deps(mock_player, false, mock_client, mock_store)
            .expect("Initialize AppCoordinator with saved credentials");

        let ui = coordinator.window();
        assert_eq!(ui.get_server_url_input(), "192.168.5.88:5055");
        assert_eq!(ui.get_username_input(), "stored_admin");
        assert_eq!(ui.get_password_input(), "saved_pwd_123");
        assert!(ui.get_remember_credentials());
        assert!(
            ui.get_is_logged_in(),
            "saved token should restore the logged-in view"
        );
        assert!(coordinator.session().is_authenticated());
        assert_eq!(
            coordinator.session().token().as_deref(),
            Some("existing_token_xyz")
        );
        assert_eq!(
            coordinator.session().nas_id().as_deref(),
            Some("stored_nas_id")
        );
        assert_eq!(coordinator.session().nas_sign().as_deref(), Some("stored_nas_sign"));
    }

    // -------------------------------------------------------------
    // Scenario 2: Successful programmatic/coordinator login and logout
    // -------------------------------------------------------------
    {
        let mock_player = Arc::new(MockPlayer::new());
        let mock_client = Arc::new(MockNasClient::new());
        let mock_store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::new());

        let coordinator = AppCoordinator::with_deps(
            mock_player,
            false,
            Arc::clone(&mock_client) as Arc<dyn NasClient>,
            Arc::clone(&mock_store),
        )
        .expect("Initialize AppCoordinator");

        let ui = coordinator.window();
        assert!(!ui.get_is_logged_in());
        assert!(!coordinator.session().is_authenticated());

        // Perform login
        let res = coordinator.perform_login("192.168.1.50", "admin", "password123", None, true);
        assert!(res.is_ok(), "Login should succeed: {:?}", res.err());

        // Verify UI & Session state transitions
        assert!(ui.get_is_logged_in(), "UI should be in logged-in view");
        assert_eq!(ui.get_session_user(), "admin");
        assert!(ui.get_login_error_message().is_empty());

        let session = coordinator.session();
        assert!(session.is_authenticated());
        assert_eq!(session.username().as_deref(), Some("admin"));
        assert_eq!(
            session.token().as_deref(),
            Some("mock_session_token_xyz_888")
        );

        // Verify credentials persisted to store
        let saved = mock_store.load().unwrap().expect("creds should be saved");
        assert_eq!(saved.username, "admin");
        assert_eq!(saved.password.as_deref(), Some("password123"));
        assert_eq!(saved.nas_id.as_deref(), Some("mock_nas_id_001"));
        assert_eq!(saved.nas_sign.as_deref(), Some("mock_opaque_sign_abc"));

        // Perform logout
        coordinator.perform_logout();
        assert!(!ui.get_is_logged_in(), "UI should return to login view");
        assert!(!coordinator.session().is_authenticated());
        assert_eq!(coordinator.session().token(), None);
    }

    // -------------------------------------------------------------
    // Scenario 3: Invalid credentials error handling and guidance
    // -------------------------------------------------------------
    {
        let mock_player = Arc::new(MockPlayer::new());
        let mock_client = Arc::new(MockNasClient::new());
        let mock_store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::new());

        let coordinator = AppCoordinator::with_deps(
            mock_player,
            false,
            Arc::clone(&mock_client) as Arc<dyn NasClient>,
            Arc::clone(&mock_store),
        )
        .expect("Initialize AppCoordinator");

        let ui = coordinator.window();

        let res =
            coordinator.perform_login("192.168.1.50", "admin", "wrong_password_999", None, false);
        assert!(res.is_err());
        assert!(!ui.get_is_logged_in());
        assert!(!coordinator.session().is_authenticated());

        let err_msg = ui.get_login_error_message().to_string();
        assert!(
            err_msg.contains("密码错误"),
            "Error message should explain password error: {}",
            err_msg
        );
    }

    // -------------------------------------------------------------
    // Scenario 4: MFA two-step verification flow
    // -------------------------------------------------------------
    {
        let mock_player = Arc::new(MockPlayer::new());
        let mock_client = Arc::new(MockNasClient::new().with_mfa(true));
        let mock_store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::new());

        let coordinator = AppCoordinator::with_deps(
            mock_player,
            false,
            Arc::clone(&mock_client) as Arc<dyn NasClient>,
            Arc::clone(&mock_store),
        )
        .expect("Initialize AppCoordinator");

        let ui = coordinator.window();

        // Step 1: Login without MFA code -> should require MFA
        let res_no_mfa =
            coordinator.perform_login("192.168.1.50", "admin", "password123", None, true);
        assert!(res_no_mfa.is_err());
        assert!(
            ui.get_show_sms_field(),
            "UI should activate the SMS input field"
        );
        assert!(!ui.get_is_logged_in());
        assert!(!coordinator.session().is_authenticated());

        // Step 2: Request the code through the cloud-facing MFA operation.
        let res_send = coordinator.perform_send_mfa_code("192.168.1.50", "admin", None);
        assert!(
            res_send.is_ok(),
            "MFA code request should succeed: {:?}",
            res_send.err()
        );
        assert!(coordinator
            .window()
            .get_mfa_status_hint()
            .contains("验证码已发送"));
        assert!(coordinator.window().get_mfa_code_sent());

        // Step 3: Invalid user-entered code must fail before NAS login.
        let res_bad_mfa =
            coordinator.perform_mfa_login("192.168.1.50", "admin", "password123", "000000", true);
        assert!(res_bad_mfa.is_err());
        assert!(!ui.get_is_logged_in());

        // Step 4: Verification returns an opaque proof, then the final NAS
        // login succeeds with that proof rather than the raw code.
        let res_good_mfa =
            coordinator.perform_mfa_login("192.168.1.50", "admin", "password123", "123456", true);
        assert!(res_good_mfa.is_ok());
        assert!(ui.get_is_logged_in());
        assert!(coordinator.session().is_authenticated());
    }

    // -------------------------------------------------------------
    // Scenario 5: Network failure recovery guidance
    // -------------------------------------------------------------
    {
        let mock_player = Arc::new(MockPlayer::new());
        let mock_client = Arc::new(MockNasClient::new().with_network_error(true));
        let mock_store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::new());

        let coordinator = AppCoordinator::with_deps(
            mock_player,
            false,
            Arc::clone(&mock_client) as Arc<dyn NasClient>,
            Arc::clone(&mock_store),
        )
        .expect("Initialize AppCoordinator");

        let ui = coordinator.window();

        let res = coordinator.perform_login("192.168.99.99", "admin", "password123", None, false);
        assert!(res.is_err());
        assert!(!ui.get_is_logged_in());
        assert!(!coordinator.session().is_authenticated());

        let err_msg = ui.get_login_error_message().to_string();
        assert!(
            err_msg.contains("网络") || err_msg.contains("连接"),
            "Error message should explain network issue: {}",
            err_msg
        );
    }

    // -------------------------------------------------------------
    // Scenario 6: Bare IP login stores a normalized session base URL
    // -------------------------------------------------------------
    successful_bare_ip_login_stores_normalized_session_base_url();

    // N001414 is the new-device variant and must expose the cloud request
    // type required by the SMS endpoint.
    {
        let coordinator = AppCoordinator::with_deps(
            Arc::new(MockPlayer::new()),
            false,
            Arc::new(
                MockNasClient::new()
                    .with_mfa(true)
                    .with_mfa_error_code("N001414"),
            ),
            Arc::new(MemoryCredentialStore::new()),
        )
        .expect("coordinator should initialize");

        let result = coordinator.perform_login("192.168.1.50", "admin", "password123", None, false);
        assert!(result.is_err());
        assert!(coordinator.window().get_show_sms_field());
        assert_eq!(coordinator.window().get_mfa_challenge_type(), "new_device");
        assert!(coordinator
            .window()
            .get_mfa_status_hint()
            .contains("新设备"));
    }
}
fn successful_bare_ip_login_stores_normalized_session_base_url() {
    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new()),
        Arc::new(MemoryCredentialStore::new()),
    )
    .expect("coordinator should initialize");

    coordinator
        .perform_login("192.168.1.50", "admin", "password123", None, false)
        .expect("mock login should succeed");

    assert_eq!(coordinator.session().base_url(), "http://192.168.1.50:5055");
    assert_eq!(
        coordinator.window().get_session_base_url(),
        "http://192.168.1.50:5055"
    );
}

#[test]
fn remember_false_removes_previous_saved_credentials() {
    let store = Arc::new(MemoryCredentialStore::new());
    store
        .save(&SavedCredentials {
            server_url: "192.168.1.50:5055".to_string(),
            username: "admin".to_string(),
            password: Some("old-password".to_string()),
            token: Some("old-token".to_string()),
            nas_id: Some("old-nas-id".to_string()),
            nas_sign: Some("old-nas-sign".to_string()),
        })
        .expect("pre-seed credentials");

    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new()),
        store.clone(),
    )
    .expect("coordinator should initialize");

    coordinator
        .perform_login("192.168.1.50", "admin", "password123", None, false)
        .expect("mock login should succeed");

    assert!(store.load().expect("store load should succeed").is_none());
}

#[test]
fn credential_restore_failure_is_visible_and_does_not_fake_a_session() {
    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new()),
        Arc::new(FailingCredentialStore),
    )
    .expect("coordinator should initialize");

    assert!(!coordinator.window().get_is_logged_in());
    assert!(coordinator
        .window()
        .get_login_error_message()
        .contains("安全凭据"));
    assert!(coordinator
        .window()
        .get_login_status_hint()
        .contains("凭据"));
}

#[test]
fn expired_restored_session_returns_to_login_and_clears_saved_credentials() {
    let store = Arc::new(MemoryCredentialStore::new());
    store
        .save(&SavedCredentials {
            server_url: "192.168.1.50:5055".to_string(),
            username: "admin".to_string(),
            password: Some("password123".to_string()),
            token: Some("expired-token".to_string()),
            nas_id: Some("expired-nas-id".to_string()),
            nas_sign: Some("expired-nas-sign".to_string()),
        })
        .expect("pre-seed credentials");

    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new()),
        store.clone(),
    )
    .expect("coordinator should initialize");

    assert!(coordinator.window().get_is_logged_in());
    coordinator.session().clear();
    coordinator.window().invoke_refresh_library_clicked();
    pump_event_loop();

    assert!(!coordinator.window().get_is_logged_in());
    assert!(!coordinator.session().is_authenticated());
    assert!(store.load().expect("store load should succeed").is_none());
    assert!(coordinator
        .window()
        .get_login_error_message()
        .contains("会话已失效"));
}
