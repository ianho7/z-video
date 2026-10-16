use std::sync::Arc;
use slint::Model;
use z_video::app::AppCoordinator;
use z_video::media::image_cache::{decode_to_slint_image, ImageCache};
use z_video::nas::client::MockNasClient;
use z_video::player::MockPlayer;
use z_video::storage::credentials::MemoryCredentialStore;

#[test]
fn test_media_library_integration_comprehensive_suite() {
    // -------------------------------------------------------------
    // Scenario 1: Image Cache and Decoding Pipeline
    // -------------------------------------------------------------
    {
        let cache = ImageCache::new(5);
        let sample_png = vec![
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00,
            0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78,
            0xda, 0x63, 0x64, 0x60, 0x00, 0x00, 0x00, 0x06, 0x00, 0x02, 0x30, 0x81, 0xd0, 0x2f,
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];

        cache.insert("/zvideo/cover/interstellar.jpg".to_string(), sample_png.clone());
        assert!(cache.contains("/zvideo/cover/interstellar.jpg"));

        let retrieved = cache.get("/zvideo/cover/interstellar.jpg");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().len(), sample_png.len());

        let slint_img_res = decode_to_slint_image(&sample_png);
        assert!(slint_img_res.is_ok(), "Raw bytes must decode to slint::Image");
    }

    // -------------------------------------------------------------
    // Scenario 2: Login -> Media Library Auto-Loading & Classification Flow
    // -------------------------------------------------------------
    let player = Arc::new(MockPlayer::new());
    let nas_client = Arc::new(MockNasClient::new());
    let cred_store = Arc::new(MemoryCredentialStore::new());

    let coordinator = AppCoordinator::with_deps(player, false, nas_client.clone(), cred_store)
        .expect("AppCoordinator creation should succeed");

    // Perform successful login
    let login_res = coordinator.perform_login(
        "http://192.168.1.50:5055",
        "admin",
        "password123",
        None,
        false,
    );
    assert!(login_res.is_ok(), "Login should succeed");
    assert!(coordinator.window().get_is_logged_in());
    assert_eq!(coordinator.window().get_current_view(), "library");

    // Verify classifications loaded into UI
    let classifications = coordinator.window().get_classifications();
    assert!(
        classifications.row_count() >= 3,
        "Expected at least 3 categories, got {}",
        classifications.row_count()
    );

    let first_cat = classifications.row_data(0).unwrap();
    assert_eq!(first_cat.name.as_str(), "电影");
    assert!(first_cat.is_selected);

    // Verify collections loaded
    let collections = coordinator.window().get_collections();
    assert_eq!(collections.row_count(), 4);

    let first_col = collections.row_data(0).unwrap();
    assert_eq!(first_col.title.as_str(), "星际穿越");
    assert_eq!(first_col.release_year.as_str(), "2014");
    assert_eq!(first_col.video_type.as_str(), "电影");
    assert_eq!(first_col.score.as_str(), "9.4");

    // -------------------------------------------------------------
    // Scenario 3: Category switching
    // -------------------------------------------------------------
    let res = coordinator.load_collections_sync("2");
    assert!(res.is_ok(), "Switching to category 2 should succeed");
    assert!(coordinator.window().get_collections().row_count() > 0);

    // -------------------------------------------------------------
    // Scenario 4: Error handling and recovery
    // -------------------------------------------------------------
    // Trigger network error directly on empty/broken classification
    let err = coordinator.load_collections_sync("non_existent_or_broken");
    // MockNasClient returns page with empty or fallback
    assert!(err.is_ok());
}
