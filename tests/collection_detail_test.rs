use std::sync::Arc;
use std::time::Duration;

use slint::{platform::{Key, WindowEvent}, ComponentHandle, Model, Timer};
use z_video::app::AppCoordinator;
use z_video::nas::client::MockNasClient;
use z_video::player::MockPlayer;
use z_video::storage::credentials::MemoryCredentialStore;

fn pump_detail_event_loop() {
    Timer::single_shot(Duration::from_millis(150), || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("detail event loop should run");
}

#[test]
fn coordinator_navigates_selects_episode_and_returns_without_reloading_library() {
    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new()),
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

    let classification_id = coordinator.window().get_selected_classification_id();
    let collection_count = coordinator.window().get_collections().row_count();

    coordinator
        .window()
        .invoke_collection_clicked("series-demo".into());
    assert_eq!(coordinator.window().get_current_view(), "detail");
    assert!(coordinator.window().get_detail_loading());
    assert_eq!(coordinator.window().get_collections().row_count(), collection_count);

    pump_detail_event_loop();

    assert!(!coordinator.window().get_detail_loading());
    assert_eq!(coordinator.window().get_detail_title(), "测试剧集");
    assert_eq!(coordinator.window().get_detail_seasons().row_count(), 2);
    assert_eq!(coordinator.window().get_selected_episode_id(), "series-s1e1");

    coordinator
        .window()
        .window()
        .dispatch_event_with_result(WindowEvent::KeyPressed {
            text: Key::Escape.into(),
        })
        .expect("Escape should dispatch to the detail view");
    assert_eq!(coordinator.window().get_current_view(), "library");

    coordinator
        .window()
        .invoke_collection_clicked("series-demo".into());
    pump_detail_event_loop();

    coordinator
        .window()
        .invoke_episode_selected("series-s2e1".into());
    assert_eq!(coordinator.window().get_selected_episode_id(), "series-s2e1");
    let seasons = coordinator.window().get_detail_seasons();
    let second_season = seasons.row_data(1).expect("second season should exist");
    assert!(second_season.episodes.row_data(0).unwrap().is_selected);
    let first_season = seasons.row_data(0).expect("first season should exist");
    assert!(!first_season.episodes.row_data(0).unwrap().is_selected);

    coordinator.window().invoke_detail_back_clicked();
    assert_eq!(coordinator.window().get_current_view(), "library");
    assert_eq!(coordinator.window().get_selected_classification_id(), classification_id);
    assert_eq!(coordinator.window().get_collections().row_count(), collection_count);
}
