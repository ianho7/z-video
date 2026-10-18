use std::sync::Arc;
use z_video::app::AppCoordinator;
use z_video::nas::client::{MockNasClient, NasClient};
use z_video::player::MockPlayer;
use z_video::storage::credentials::{CredentialStore, MemoryCredentialStore, SavedCredentials};

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
        };
        mock_store.save(&preloaded).expect("pre-seed credentials");

        let coordinator = AppCoordinator::with_deps(mock_player, false, mock_client, mock_store)
            .expect("Initialize AppCoordinator with saved credentials");

        let ui = coordinator.window();
        assert_eq!(ui.get_server_url_input(), "192.168.5.88:5055");
        assert_eq!(ui.get_username_input(), "stored_admin");
        assert_eq!(ui.get_password_input(), "saved_pwd_123");
        assert!(ui.get_remember_credentials());
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

        // Step 2: Login with incorrect MFA code -> should fail
        let res_bad_mfa =
            coordinator.perform_login("192.168.1.50", "admin", "password123", Some("000000"), true);
        assert!(res_bad_mfa.is_err());
        assert!(!ui.get_is_logged_in());

        // Step 3: Login with correct MFA code "123456" -> should succeed
        let res_good_mfa =
            coordinator.perform_login("192.168.1.50", "admin", "password123", Some("123456"), true);
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
