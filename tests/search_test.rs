use std::sync::Arc;
use std::time::Duration;

use slint::{Model, Timer};
use z_video::app::AppCoordinator;
use z_video::nas::client::MockNasClient;
use z_video::player::MockPlayer;
use z_video::storage::credentials::MemoryCredentialStore;

fn pump_search_event_loop(duration: Duration) {
    Timer::single_shot(duration, || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("search event loop should exit cleanly");
}

fn search_filters_loaded_scope_and_clear_restores_browse() {
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

    assert_eq!(coordinator.window().get_collections().row_count(), 4);
    assert!(coordinator.window().get_search_scope().contains("4"));

    // Two edits arrive before the debounce window. Only the latest query may
    // update the visible model.
    coordinator.window().set_apple_search_input("黑客".into());
    coordinator.window().invoke_search_changed("黑客".into());
    coordinator
        .window()
        .set_apple_search_input("奥本海默".into());
    coordinator
        .window()
        .invoke_search_changed("奥本海默".into());
    assert!(coordinator.window().get_search_loading());

    pump_search_event_loop(Duration::from_millis(500));

    let results = coordinator.window().get_collections();
    assert_eq!(results.row_count(), 1);
    assert_eq!(results.row_data(0).unwrap().title, "奥本海默");
    assert!(coordinator.window().get_search_active());
    assert!(coordinator.window().get_search_scope().contains("已加载"));

    // Enter bypasses the debounce and an empty match set remains distinct from
    // a failed library request.
    coordinator.window().set_apple_search_input("不存在".into());
    coordinator
        .window()
        .invoke_search_submitted("不存在".into());
    pump_search_event_loop(Duration::from_millis(80));
    assert!(!coordinator.window().get_search_loading());
    assert!(coordinator.window().get_search_active());
    assert_eq!(coordinator.window().get_collections().row_count(), 0);
    assert!(coordinator.window().get_library_error().is_empty());

    // Clearing the field restores the original loaded page and its range.
    coordinator.window().set_apple_search_input("".into());
    coordinator.window().invoke_search_changed("".into());
    assert!(!coordinator.window().get_search_active());
    assert_eq!(coordinator.window().get_collection_count(), 4);
    assert_eq!(coordinator.window().get_collections().row_count(), 4);
    assert!(coordinator.window().get_search_error().is_empty());
}

fn assert_library_empty_and_error_states_remain_distinct_from_search_empty() {
    let empty = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new().with_empty_library()),
        Arc::new(MemoryCredentialStore::new()),
    )
    .expect("empty coordinator should initialize");
    empty
        .perform_login(
            "http://192.168.1.50:5055",
            "admin",
            "password123",
            None,
            false,
        )
        .expect("empty mock login should succeed");
    assert_eq!(empty.window().get_collections().row_count(), 0);
    assert!(empty.window().get_library_error().is_empty());
    assert!(!empty.window().get_search_active());

    let failed = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new().with_network_error(true)),
        Arc::new(MemoryCredentialStore::new()),
    )
    .expect("failed coordinator should initialize");
    assert!(failed.load_collections_sync("1").is_err());
    assert!(!failed.window().get_library_error().is_empty());
    assert!(failed.window().get_collections().row_count() == 0);
}

#[test]
fn search_and_library_state_regressions() {
    search_filters_loaded_scope_and_clear_restores_browse();
    assert_library_empty_and_error_states_remain_distinct_from_search_empty();
}
