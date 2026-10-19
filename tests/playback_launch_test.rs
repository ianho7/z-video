use std::sync::Arc;
use std::time::Duration;

use slint::Timer;
use z_video::app::AppCoordinator;
use z_video::nas::client::MockNasClient;
use z_video::nas::models::PlaybackHistory;
use z_video::player::{MockPlayer, PlaybackState, Player};
use z_video::storage::credentials::MemoryCredentialStore;

fn pump_event_loop() {
    Timer::single_shot(Duration::from_millis(200), || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("playback event loop should run");
}

fn wait_for_media_load(player: &MockPlayer) {
    for _ in 0..100 {
        if !player.call_history().is_empty() {
            return;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    panic!("playback worker did not call load_media");
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
    wait_for_media_load(&player);
    assert!(coordinator.playback_session().is_none());
    assert_eq!(coordinator.window().get_current_view(), "detail");
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

fn playback_returns_to_preserved_detail_and_can_start_again() {
    let (coordinator, player) = logged_in_coordinator(MockNasClient::new());
    coordinator
        .window()
        .invoke_collection_clicked("series-demo".into());
    pump_event_loop();

    coordinator
        .window()
        .invoke_play_episode_clicked("series-s1e1".into());
    wait_for_media_load(&player);
    pump_event_loop();
    assert_eq!(coordinator.window().get_current_view(), "player");

    coordinator.window().invoke_return_to_detail_clicked();
    assert_eq!(coordinator.window().get_current_view(), "detail");
    assert_eq!(coordinator.window().get_detail_title(), "测试剧集");
    assert!(coordinator.playback_session().is_none());
    assert!(player.call_history().iter().any(|call| call == "stop"));

    coordinator
        .window()
        .invoke_play_episode_clicked("series-s1e1".into());
    assert!(coordinator.window().get_playback_loading());
    wait_for_media_load(&player);
    pump_event_loop();
    assert_eq!(coordinator.window().get_current_view(), "player");
}

fn playback_progress_updates_session_and_emits_mock_receipt() {
    let player = Arc::new(MockPlayer::new());
    let nas_client = Arc::new(MockNasClient::new());
    let coordinator = AppCoordinator::with_deps(
        player.clone(),
        false,
        nas_client.clone(),
        Arc::new(MemoryCredentialStore::new()),
    )
    .expect("coordinator should initialize");
    coordinator
        .perform_login("192.168.1.50", "admin", "password123", None, false)
        .expect("mock login should succeed");
    coordinator
        .window()
        .invoke_collection_clicked("series-demo".into());
    pump_event_loop();
    coordinator
        .window()
        .invoke_play_episode_clicked("series-s1e1".into());
    wait_for_media_load(&player);
    pump_event_loop();

    player.seek(42.0).expect("mock seek should succeed");
    pump_event_loop();

    let session = coordinator
        .playback_session()
        .expect("playback session should remain active");
    assert_eq!(session.position_secs, 42.0);
    assert_eq!(session.duration_secs, 120.0);
    assert_eq!(session.state, PlaybackState::Playing);

    for _ in 0..100 {
        if !nas_client.progress_receipts().is_empty() {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    let receipt = nas_client
        .progress_receipts()
        .pop()
        .expect("progress should be sent through the mock receipt");
    assert_eq!(receipt.collection_id, "series-demo");
    assert_eq!(receipt.classification_id, "1");
    assert_eq!(receipt.video_id, "series-s1e1");
    assert_eq!(receipt.sec, 42);
    assert_eq!(receipt.audio_index, 0);
    assert_eq!(receipt.subtitle_index, 0);
    assert_eq!(receipt.video_duration, 120);
}

fn playback_uses_detail_history_to_resume_episode_and_position() {
    let mut nas_client = MockNasClient::new();
    nas_client
        .mock_collection_details
        .get_mut("series-demo")
        .expect("mock series detail should exist")
        .history = Some(PlaybackHistory {
            last_video_id: Some("series-s1e2".to_string()),
            play_duration: Some(42),
            audio_index: Some(1),
            subtitle_index: Some(2),
            subtitle_hash: Some("fixture-hash".to_string()),
            subtitle_setting: Some("default".to_string()),
            play_chapter: Some(0),
        });

    let player = Arc::new(MockPlayer::new());
    let coordinator = AppCoordinator::with_deps(
        player.clone(),
        false,
        Arc::new(nas_client),
        Arc::new(MemoryCredentialStore::new()),
    )
    .expect("coordinator should initialize");
    coordinator
        .perform_login("192.168.1.50", "admin", "password123", None, false)
        .expect("mock login should succeed");
    coordinator
        .window()
        .invoke_collection_clicked("series-demo".into());
    pump_event_loop();

    assert_eq!(coordinator.window().get_selected_episode_id(), "series-s1e2");
    coordinator
        .window()
        .invoke_play_episode_clicked("series-s1e2".into());
    wait_for_media_load(&player);
    pump_event_loop();

    assert!(player
        .call_history()
        .iter()
        .any(|call| call == "seek:42"));
    let session = coordinator
        .playback_session()
        .expect("resumed playback should create a session");
    assert_eq!(session.episode_id, "series-s1e2");
    assert_eq!(session.position_secs, 42.0);
    assert_eq!(session.audio_index, 1);
    assert_eq!(session.subtitle_index, 2);
}

#[test]
fn playback_launch_integration_suite() {
    coordinator_launches_playback_and_reports_stream_failure();
    playback_returns_to_preserved_detail_and_can_start_again();
    playback_progress_updates_session_and_emits_mock_receipt();
    playback_uses_detail_history_to_resume_episode_and_position();
}
