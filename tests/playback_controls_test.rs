use z_video::player::PlaybackControlState;

#[test]
fn seek_guard_clamps_preview_and_rejects_progress_until_current_seek_finishes() {
    let mut controls = PlaybackControlState::default();

    let token = controls.preview_seek(150.0, 120.0);

    assert_eq!(controls.seek_target_secs(), Some(120.0));
    assert!(controls.is_seek_in_progress());
    assert!(!controls.accepts_progress_event());
    assert!(!controls.finish_seek(token + 1));
    assert!(controls.is_seek_in_progress());

    assert!(controls.finish_seek(token));
    assert!(!controls.is_seek_in_progress());
    assert!(controls.accepts_progress_event());
}

#[test]
fn stale_seek_release_cannot_clear_a_new_seek() {
    let mut controls = PlaybackControlState::default();

    let first_token = controls.preview_seek(10.0, 120.0);
    let second_token = controls.preview_seek(80.0, 120.0);
    assert_ne!(first_token, second_token);
    assert!(!controls.finish_seek(first_token));
    assert!(controls.is_seek_in_progress());
    assert!(controls.finish_seek(second_token));
}

#[test]
fn fullscreen_state_toggles_without_creating_another_window() {
    let mut controls = PlaybackControlState::default();

    assert!(!controls.is_fullscreen());
    assert!(controls.toggle_fullscreen());
    assert!(controls.is_fullscreen());
    assert!(!controls.toggle_fullscreen());
    assert!(!controls.is_fullscreen());
}
