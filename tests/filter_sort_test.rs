use std::sync::Arc;
use std::time::Duration;

use slint::{Model, Timer};
use z_video::app::AppCoordinator;
use z_video::nas::client::MockNasClient;
use z_video::player::MockPlayer;
use z_video::storage::credentials::MemoryCredentialStore;

fn pump_filter_sort_event_loop(duration: Duration) {
    Timer::single_shot(duration, || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("filter/sort event loop should exit cleanly");
}

#[test]
fn local_filter_sort_combines_with_search_and_clears_to_loaded_scope() {
    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new().with_mixed_media_types()),
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

    assert_eq!(coordinator.window().get_collections().row_count(), 5);

    coordinator.window().invoke_filter_changed("movie".into());
    pump_filter_sort_event_loop(Duration::from_millis(120));
    assert_eq!(coordinator.window().get_collections().row_count(), 4);
    assert!(coordinator.window().get_search_active());
    assert!(coordinator.window().get_search_scope().contains("类型：电影"));

    coordinator.window().invoke_sort_changed("score_desc".into());
    pump_filter_sort_event_loop(Duration::from_millis(120));
    let sorted = coordinator.window().get_collections();
    assert_eq!(sorted.row_data(0).unwrap().title, "星际穿越");
    assert!(coordinator
        .window()
        .get_search_scope()
        .contains("评分高到低"));

    // A delayed query becomes stale when a newer filter arrives. The final
    // model must reflect the latest query + filter + sort combination only.
    coordinator.window().set_apple_search_input("脱敏".into());
    coordinator.window().invoke_search_changed("脱敏".into());
    coordinator.window().invoke_filter_changed("tv".into());
    pump_filter_sort_event_loop(Duration::from_millis(500));
    let combined = coordinator.window().get_collections();
    assert_eq!(combined.row_count(), 1);
    assert_eq!(combined.row_data(0).unwrap().title, "脱敏剧集样本");
    assert!(coordinator.window().get_search_error().is_empty());
    assert!(coordinator.window().get_search_scope().contains("类型：剧集"));

    coordinator.window().set_apple_search_input("不存在".into());
    coordinator
        .window()
        .invoke_search_submitted("不存在".into());
    pump_filter_sort_event_loop(Duration::from_millis(120));
    assert_eq!(coordinator.window().get_collections().row_count(), 0);
    assert!(coordinator.window().get_search_active());
    assert!(!coordinator.window().get_search_scope().is_empty());
    assert!(coordinator.window().get_search_error().is_empty());
    assert!(!coordinator.window().get_search_loading());

    coordinator.window().invoke_clear_query();
    assert_eq!(coordinator.window().get_collections().row_count(), 5);
    assert!(!coordinator.window().get_search_active());
    assert_eq!(coordinator.window().get_media_type_filter().as_str(), "all");
    assert_eq!(coordinator.window().get_sort_order().as_str(), "default");

    // Favorite state is not part of the confirmed CollectionItem contract;
    // an unsupported entry is surfaced as an error instead of a fake result.
    coordinator
        .window()
        .invoke_filter_changed("favorite".into());
    assert!(!coordinator.window().get_search_error().is_empty());
    assert!(!coordinator.window().get_search_loading());
}
