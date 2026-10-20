use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use std::sync::Arc;
use z_video::app::AppCoordinator;
use z_video::media::image_cache::{ImageCache, ImageRequestGate};
use z_video::nas::client::MockNasClient;
use z_video::nas::models::NasError;
use z_video::nas::auth::sanitize_log_message;
use z_video::player::MockPlayer;
use z_video::storage::credentials::MemoryCredentialStore;

fn unique_cache_dir() -> PathBuf {
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be available")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "z-video-ticket07-{}-{}-{}",
        std::process::id(),
        nonce,
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    ))
}

#[test]
fn disk_image_cache_is_bounded_lru_and_survives_restart() {
    let cache_dir = unique_cache_dir();
    let cache = ImageCache::with_disk_cache(&cache_dir, 1, 6);

    cache.insert("poster-a".to_string(), b"aaa".to_vec());
    cache.insert("poster-b".to_string(), b"bbb".to_vec());
    assert_eq!(cache.disk_usage_bytes(), 6);

    assert_eq!(cache.get("poster-a"), Some(b"aaa".to_vec()));
    cache.insert("poster-c".to_string(), b"ccc".to_vec());

    let restarted = ImageCache::with_disk_cache(&cache_dir, 1, 6);
    assert_eq!(restarted.get("poster-a"), Some(b"aaa".to_vec()));
    assert_eq!(restarted.get("poster-b"), None);
    assert_eq!(restarted.get("poster-c"), Some(b"ccc".to_vec()));
    assert!(restarted.disk_usage_bytes() <= 6);

    fs::remove_dir_all(cache_dir).expect("test cache directory should be removable");
}

#[test]
fn stale_image_request_cannot_apply_after_a_new_request_starts() {
    let gate = ImageRequestGate::new();
    let old_request = gate.begin();
    let new_request = gate.begin();

    assert!(!gate.is_current(old_request));
    assert!(gate.is_current(new_request));

    gate.cancel();
    assert!(!gate.is_current(new_request));
}

#[test]
fn expired_session_shows_an_actionable_relogin_state() {
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
    coordinator.session().clear();

    let error = coordinator
        .load_collections_sync("1")
        .expect_err("cleared session should be rejected");
    assert!(matches!(error, NasError::Unauthorized));
    assert!(coordinator.window().get_requires_relogin());
    assert!(coordinator
        .window()
        .get_library_error()
        .to_string()
        .contains("重新登录"));

    coordinator.window().invoke_relogin_requested();
    assert!(!coordinator.window().get_is_logged_in());
    assert!(!coordinator.window().get_requires_relogin());
}

#[test]
fn sensitive_transport_details_are_removed_from_log_text() {
    let raw = "POST https://nas.example/auth/login?token=secret-token&password=secret-password Cookie: token=secret-token";
    let safe = sanitize_log_message(raw);

    assert!(!safe.contains("secret-token"));
    assert!(!safe.contains("secret-password"));
    assert!(!safe.contains("/auth/login?"));
    assert!(safe.contains("[REDACTED]"));
}
