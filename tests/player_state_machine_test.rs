use std::sync::{Arc, Mutex};
use std::thread;
use z_video::player::{
    MockPlayer, PlaybackState, Player, PlayerError, PlayerEvent,
};

#[test]
fn test_mock_player_initial_state() {
    let player = MockPlayer::new();
    assert_eq!(player.state(), PlaybackState::Idle);
    assert_eq!(player.progress().position_secs, 0.0);
    assert_eq!(player.progress().duration_secs, 0.0);
    assert_eq!(player.backend_name(), "MockPlayer");
}

#[test]
fn test_mock_player_state_transitions() {
    let player = MockPlayer::new();
    let events = Arc::new(Mutex::new(Vec::<PlayerEvent>::new()));
    let events_clone = Arc::clone(&events);

    player.add_event_listener(Box::new(move |ev| {
        events_clone.lock().unwrap().push(ev);
    }));

    // 1. Loading media transitions to Playing
    let load_res = player.load_media("assets/test_video.mp4");
    assert!(load_res.is_ok());
    assert_eq!(player.state(), PlaybackState::Playing);
    assert_eq!(player.progress().duration_secs, 120.0);

    // 2. Pause transitions to Paused
    let pause_res = player.pause();
    assert!(pause_res.is_ok());
    assert_eq!(player.state(), PlaybackState::Paused);

    // 3. Play transitions back to Playing
    let play_res = player.play();
    assert!(play_res.is_ok());
    assert_eq!(player.state(), PlaybackState::Playing);

    // 4. Toggle pause transitions to Paused
    let toggle_res = player.toggle_pause();
    assert!(toggle_res.is_ok());
    assert_eq!(player.state(), PlaybackState::Paused);

    // 5. Toggle pause again transitions to Playing
    let toggle_res2 = player.toggle_pause();
    assert!(toggle_res2.is_ok());
    assert_eq!(player.state(), PlaybackState::Playing);

    // 6. Stop transitions to Stopped
    let stop_res = player.stop();
    assert!(stop_res.is_ok());
    assert_eq!(player.state(), PlaybackState::Stopped);
    assert_eq!(player.progress().position_secs, 0.0);

    // Verify event stream
    let recorded_events = events.lock().unwrap().clone();
    assert!(!recorded_events.is_empty());

    let state_changes: Vec<PlaybackState> = recorded_events
        .iter()
        .filter_map(|ev| match ev {
            PlayerEvent::StateChanged(s) => Some(*s),
            _ => None,
        })
        .collect();

    assert_eq!(
        state_changes,
        vec![
            PlaybackState::Playing,
            PlaybackState::Paused,
            PlaybackState::Playing,
            PlaybackState::Paused,
            PlaybackState::Playing,
            PlaybackState::Stopped,
        ]
    );
}

#[test]
fn test_mock_player_seek_and_progress() {
    let player = MockPlayer::new();
    player.load_media("assets/test_video.mp4").unwrap();

    let seek_res = player.seek(45.5);
    assert!(seek_res.is_ok());
    assert_eq!(player.progress().position_secs, 45.5);

    let formatted = player.progress().formatted_time();
    assert_eq!(formatted, "00:45 / 02:00");
}

#[test]
fn test_mock_player_error_on_unloaded_play() {
    let player = MockPlayer::new();
    let res = player.play();
    assert!(res.is_err());
    match res {
        Err(PlayerError::InvalidState(PlaybackState::Idle, _)) => {}
        other => panic!("Expected InvalidState error, got {:?}", other),
    }
}

#[test]
fn test_mock_player_surface_assignment() {
    let player = MockPlayer::new();
    let res = player.set_video_surface(0x123456);
    assert!(res.is_ok());
    let history = player.call_history();
    assert!(history.contains(&"set_video_surface:1193046".to_string()));
}

#[test]
fn test_mock_player_multithreaded_non_blocking_events() {
    let player = Arc::new(MockPlayer::new());
    let event_count = Arc::new(Mutex::new(0));

    let count_clone = Arc::clone(&event_count);
    player.add_event_listener(Box::new(move |_| {
        let mut count = count_clone.lock().unwrap();
        *count += 1;
    }));

    // Trigger operations across different background threads
    let p1 = Arc::clone(&player);
    let h1 = thread::spawn(move || {
        p1.load_media("assets/test_video.mp4").unwrap();
        p1.pause().unwrap();
    });

    let p2 = Arc::clone(&player);
    let h2 = thread::spawn(move || {
        p2.seek(10.0).unwrap();
    });

    h1.join().unwrap();
    h2.join().unwrap();

    let count = *event_count.lock().unwrap();
    assert!(count >= 3, "Expected at least 3 events recorded, got {}", count);
}
