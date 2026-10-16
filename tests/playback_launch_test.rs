use std::sync::Arc;
use std::time::Duration;

use slint::Timer;
use z_video::app::AppCoordinator;
use z_video::nas::client::MockNasClient;
use z_video::player::{MockPlayer, PlaybackState};
use z_video::storage::credentials::MemoryCredentialStore;

fn pump_event_loop() {
    Timer::single_shot(Duration::from_millis(200), || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("playback event loop should run");
}

fn logged_in_coordinator(nas_client: MockNasClient) -> (AppCoordinator, Arc<MockPlayer>) {
    let player = Arc::new(MockPlayer::new());
    let coordinator = AppCoordinator::with_deps(
        player.clone(),
        false,
        Arc::new(nas_client),
        Arc::new(MemoryCredentialStore::new()),
    )
    .expect("coordinator should initialize");

    coordinator
        .perform_login(
            "http://192.168.1.50:5055",
            "admin",
            "password123",
            None,
            false,
        )
        .expect("mock login should succeed");

    (coordinator, player)
}

#[test]
fn coordinator_launches_playback_and_reports_stream_failure() {
    let (coordinator, player) = logged_in_coordinator(MockNasClient::new());
    coordinator
        .window()
        .invoke_collection_clicked("series-demo".into());
    pump_event_loop();

    assert_eq!(
        coordinator.window().get_selected_episode_id(),
        "series-s1e1"
    );

    coordinator
        .window()
        .invoke_play_episode_clicked("series-s1e1".into());
    assert!(coordinator.window().get_playback_loading());
    pump_event_loop();

    assert_eq!(coordinator.window().get_current_view(), "player");
    assert_eq!(
        player.call_history(),
        vec!["load_media:/mock/playback/stream"]
    );
    let playback = coordinator
        .playback_session()
        .expect("successful playback should create a session");
    assert_eq!(playback.collection_id, "series-demo");
    assert_eq!(playback.episode_id, "series-s1e1");
    assert_eq!(playback.stream.uri, "/mock/playback/stream");
    assert_eq!(playback.state, PlaybackState::Playing);

    let (coordinator, player) = logged_in_coordinator(MockNasClient::new().without_playback_uri());
    coordinator
        .window()
        .invoke_collection_clicked("series-demo".into());
    pump_event_loop();
    coordinator
        .window()
        .invoke_play_episode_clicked("series-s1e1".into());
    pump_event_loop();

    assert_eq!(coordinator.window().get_current_view(), "detail");
    assert!(!coordinator.window().get_playback_loading());
    assert!(coordinator
        .window()
        .get_playback_error()
        .contains("播放地址"));
    assert!(player.call_history().is_empty());
    assert!(coordinator.playback_session().is_none());
}
