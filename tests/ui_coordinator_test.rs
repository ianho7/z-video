use std::sync::Arc;
use z_video::app::AppCoordinator;
use z_video::player::MockPlayer;

#[test]
fn test_app_coordinator_initialization() {
    let mock_player = Arc::new(MockPlayer::new());
    let coordinator_res = AppCoordinator::new(mock_player, false);
    assert!(coordinator_res.is_ok(), "Failed to initialize AppCoordinator: {:?}", coordinator_res.err());

    let coordinator = coordinator_res.unwrap();
    let window = coordinator.window();

    assert_eq!(window.get_playback_status(), "Idle");
    assert_eq!(window.get_is_playing(), false);
    assert_eq!(window.get_engine_name(), "MockPlayer (Fallback / Verification)");
}
