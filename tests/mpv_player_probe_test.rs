use std::sync::{Arc, Mutex};
use std::time::Duration;
use z_video::player::mpv_sys::MpvApi;
use z_video::player::{MpvPlayer, PlaybackState, Player, PlayerEvent};

#[test]
fn test_mpv_dynamic_library_loading() {
    let load_res = MpvApi::auto_load();
    assert!(
        load_res.is_ok(),
        "Failed to find and load libmpv dynamic library: {:?}",
        load_res.err()
    );

    let (api, lib_path) = load_res.unwrap();
    println!("Found and loaded libmpv from: {}", lib_path.display());

    let version = unsafe { (api.client_api_version)() };
    let major = version >> 16;
    let minor = version & 0xFFFF;
    println!("mpv client API version: {}.{}", major, minor);
    assert!(major >= 2, "Expected libmpv API version >= 2, got {}", major);
}

#[test]
fn test_mpv_player_instance_lifecycle() {
    let player_res = MpvPlayer::new(None);
    assert!(
        player_res.is_ok(),
        "Failed to instantiate MpvPlayer: {:?}",
        player_res.err()
    );

    let player = player_res.unwrap();
    assert_eq!(player.backend_name(), "libmpv");
    assert_eq!(player.state(), PlaybackState::Idle);

    // Drop will automatically shut down mpv instance and join event thread
    drop(player);
}

#[test]
fn test_mpv_player_playback_flow_with_sample_video() {
    let player_res = MpvPlayer::new(None);
    assert!(player_res.is_ok(), "MpvPlayer creation failed");
    let player = Arc::new(player_res.unwrap());

    let events = Arc::new(Mutex::new(Vec::<PlayerEvent>::new()));
    let events_clone = Arc::clone(&events);

    player.add_event_listener(Box::new(move |ev| {
        events_clone.lock().unwrap().push(ev);
    }));

    // Find sample video
    let sample_path = z_video::app::find_sample_video_path();
    assert!(
        sample_path.exists(),
        "Sample video '{}' must exist",
        sample_path.display()
    );

    let path_str = sample_path.to_str().unwrap();
    println!("Loading sample video for probe: {}", path_str);

    let load_res = player.load_media(path_str);
    assert!(load_res.is_ok(), "load_media failed: {:?}", load_res.err());

    // Give mpv background event loop a moment to parse file header
    std::thread::sleep(Duration::from_millis(600));

    // Verify playback state
    let state = player.state();
    println!("State after loading media: {:?}", state);
    assert!(
        state == PlaybackState::Playing || state == PlaybackState::Idle,
        "Expected Playing or Idle during load, got {:?}",
        state
    );

    // Test pause
    let pause_res = player.pause();
    assert!(pause_res.is_ok(), "pause failed: {:?}", pause_res.err());
    std::thread::sleep(Duration::from_millis(300));

    println!("State after pause: {:?}", player.state());
    assert_eq!(player.state(), PlaybackState::Paused);

    // Test resume (play)
    let play_res = player.play();
    assert!(play_res.is_ok(), "play failed: {:?}", play_res.err());
    std::thread::sleep(Duration::from_millis(300));
    println!("State after play: {:?}", player.state());
    assert_eq!(player.state(), PlaybackState::Playing);

    // Test seek
    let seek_res = player.seek(0.5);
    assert!(seek_res.is_ok(), "seek failed: {:?}", seek_res.err());

    // Test stop
    let stop_res = player.stop();
    assert!(stop_res.is_ok(), "stop failed: {:?}", stop_res.err());
    assert_eq!(player.state(), PlaybackState::Stopped);

    // Check collected events
    let collected = events.lock().unwrap().clone();
    println!("Collected {} events from mpv during test", collected.len());
    assert!(!collected.is_empty(), "Expected to receive mpv events");
}
