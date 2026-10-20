use std::sync::Arc;
use std::time::Duration;

use slint::{Model, Timer};
use z_video::app::AppCoordinator;
use z_video::nas::client::MockNasClient;
use z_video::player::MockPlayer;
use z_video::storage::credentials::MemoryCredentialStore;

fn pump_library_event_loop() {
    Timer::single_shot(Duration::from_millis(250), || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("pagination event loop should exit cleanly");
}

fn paged_coordinator() -> AppCoordinator {
    let mut client = MockNasClient::new();
    let template = client
        .mock_collections
        .first()
        .cloned()
        .expect("mock client must provide one collection");
    for index in 4..105 {
        let mut item = template.clone();
        item.collection_id = format!("page-{index:03}");
        item.title = format!("分页影片 {index:03}");
        client.mock_collections.push(item);
    }
    client.mock_classifications[0].count = client.mock_collections.len() as i64;

    AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(client),
        Arc::new(MemoryCredentialStore::new()),
    )
    .expect("coordinator should initialize")
}

#[test]
fn library_pagination_covers_first_middle_last_and_query_reset() {
    let coordinator = paged_coordinator();
    coordinator
        .perform_login(
            "http://192.168.1.50:5055",
            "admin",
            "password123",
            None,
            false,
        )
        .expect("mock login should succeed");

    let window = coordinator.window();
    assert_eq!(window.get_library_page(), 1);
    assert_eq!(window.get_library_total_pages(), 3);
    assert_eq!(window.get_library_total_count(), 105);
    assert_eq!(window.get_collections().row_count(), 50);

    window.invoke_library_page_changed(2);
    pump_library_event_loop();
    assert_eq!(window.get_library_page(), 2);
    assert_eq!(window.get_collections().row_count(), 50);
    assert_eq!(
        window.get_collections().row_data(0).unwrap().collection_id,
        "page-050"
    );

    window.invoke_library_page_changed(3);
    pump_library_event_loop();
    assert_eq!(window.get_library_page(), 3);
    assert_eq!(window.get_collections().row_count(), 5);
    assert_eq!(
        window.get_collections().row_data(0).unwrap().collection_id,
        "page-100"
    );

    // The search/filter path must return to page one before applying the
    // condition to the newly loaded page model.
    window.set_apple_search_input("分页影片".into());
    window.invoke_search_submitted("分页影片".into());
    pump_library_event_loop();
    assert_eq!(window.get_library_page(), 1);
    assert_eq!(window.get_collections().row_count(), 46);
    assert!(window.get_search_scope().contains("第 1 页 / 共 3 页"));

    window.invoke_library_page_changed(3);
    pump_library_event_loop();
    window.invoke_filter_changed("movie".into());
    pump_library_event_loop();
    assert_eq!(window.get_library_page(), 1);
    assert_eq!(window.get_collections().row_count(), 46);
}
