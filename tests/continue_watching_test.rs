use std::sync::Arc;
use std::time::Duration;

use slint::{Model, Timer};
use z_video::app::AppCoordinator;
use z_video::continue_watching::build_continue_watching_item;
use z_video::nas::client::MockNasClient;
use z_video::nas::models::{CollectionDetail, Episode, PlaybackHistory, Season};
use z_video::player::MockPlayer;
use z_video::storage::credentials::{
    CredentialStore, LastPlaybackContext, MemoryCredentialStore, SavedCredentials,
};

fn context(episode_id: &str) -> LastPlaybackContext {
    LastPlaybackContext {
        collection_id: "collection-fixture".to_string(),
        classification_id: "classification-fixture".to_string(),
        episode_id: episode_id.to_string(),
    }
}

fn detail(history: Option<PlaybackHistory>, duration: Option<&str>) -> CollectionDetail {
    CollectionDetail {
        collection_id: "collection-fixture".to_string(),
        title: "脱敏片名".to_string(),
        cover: "/zvideo/cover/redacted.jpg".to_string(),
        history,
        seasons: vec![Season {
            season_number: 1,
            title: "第一季".to_string(),
            episodes: vec![
                Episode {
                    video_id: "episode-one".to_string(),
                    episode_number: 1,
                    title: "第一集".to_string(),
                    duration: Some("00:10:00".to_string()),
                    ..Episode::default()
                },
                Episode {
                    video_id: "episode-two".to_string(),
                    episode_number: 2,
                    title: "第二集".to_string(),
                    duration: duration.map(str::to_string),
                    ..Episode::default()
                },
            ],
        }],
        ..CollectionDetail::default()
    }
}

#[test]
fn continue_item_uses_the_context_episode_and_real_history() {
    let history = PlaybackHistory {
        last_video_id: Some("episode-two".to_string()),
        play_duration: Some(90),
        ..PlaybackHistory::default()
    };

    let item = build_continue_watching_item(
        &context("episode-two"),
        &detail(Some(history), Some("00:10:00")),
    )
    .expect("matching history should produce one continue item");

    assert_eq!(item.collection_id, "collection-fixture");
    assert_eq!(item.episode_id, "episode-two");
    assert_eq!(item.episode_title, "第二集");
    assert_eq!(item.watched_seconds, 90);
    assert_eq!(item.duration_seconds, Some(600));
    assert_eq!(item.progress_percent, Some(15));
    assert_eq!(item.progress_label, "已看 15%");
}

#[test]
fn continue_item_uses_watched_time_when_duration_is_missing() {
    let history = PlaybackHistory {
        last_video_id: Some("episode-two".to_string()),
        play_duration: Some(90),
        ..PlaybackHistory::default()
    };

    let item = build_continue_watching_item(&context("episode-two"), &detail(Some(history), None))
        .expect("history without duration is still resumable");

    assert_eq!(item.duration_seconds, None);
    assert_eq!(item.progress_percent, None);
    assert_eq!(item.progress_label, "已看 01:30");
}

#[test]
fn continue_item_hides_missing_or_wrong_episode_history() {
    let no_history = detail(None, Some("00:10:00"));
    assert!(build_continue_watching_item(&context("episode-two"), &no_history).is_none());

    let wrong_episode = PlaybackHistory {
        last_video_id: Some("episode-one".to_string()),
        play_duration: Some(90),
        ..PlaybackHistory::default()
    };
    assert!(build_continue_watching_item(
        &context("episode-two"),
        &detail(Some(wrong_episode), Some("00:10:00"))
    )
    .is_none());
}

#[test]
fn continue_watching_ui_integration_suite() {
    let mut nas_client = MockNasClient::new();
    nas_client
        .mock_collection_details
        .get_mut("c01")
        .expect("movie fixture should exist")
        .history = Some(PlaybackHistory {
            last_video_id: Some("c01-video".to_string()),
            play_duration: Some(42),
            ..PlaybackHistory::default()
        });

    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
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
    coordinator
        .window()
        .invoke_continue_watching_clicked("c01".into(), "c01-video".into());
    Timer::single_shot(Duration::from_millis(300), || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("continue card event loop should run");
    assert_eq!(coordinator.window().get_current_view(), "detail");
    assert_eq!(coordinator.window().get_detail_collection_id(), "c01");
    assert_eq!(coordinator.window().get_selected_episode_id(), "c01-video");

    let store = Arc::new(MemoryCredentialStore::new());
    store
        .save(&SavedCredentials {
            server_url: "http://192.168.1.50:5055".to_string(),
            username: "admin".to_string(),
            password: None,
            token: Some("fixture-token".to_string()),
            nas_id: Some("fixture-nas".to_string()),
            nas_sign: Some("fixture-sign".to_string()),
            last_playback: Some(LastPlaybackContext {
                collection_id: "c01".to_string(),
                classification_id: "1".to_string(),
                episode_id: "c01-video".to_string(),
            }),
        })
        .expect("fixture credentials should be stored");

    let coordinator = AppCoordinator::with_deps(
        Arc::new(MockPlayer::new()),
        false,
        Arc::new(MockNasClient::new().with_collection_detail_error(true)),
        store,
    )
    .expect("coordinator should initialize");

    coordinator
        .load_collections_sync("1")
        .expect("library fixture should load before history failure");
    Timer::single_shot(Duration::from_millis(500), || {
        let _ = slint::quit_event_loop();
    });
    slint::run_event_loop_until_quit().expect("continue history event loop should run");

    assert!(!coordinator.window().get_continue_watching_loading());
    assert!(
        coordinator
            .window()
            .get_continue_watching_items()
            .row_count()
            == 0
    );
    assert!(coordinator
        .window()
        .get_continue_watching_error()
        .contains("重试"));
}

