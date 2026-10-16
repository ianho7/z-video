use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum PlaybackState {
    #[default]
    Idle,
    Playing,
    Paused,
    Stopped,
}

impl std::fmt::Display for PlaybackState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlaybackState::Idle => write!(f, "Idle"),
            PlaybackState::Playing => write!(f, "Playing"),
            PlaybackState::Paused => write!(f, "Paused"),
            PlaybackState::Stopped => write!(f, "Stopped"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct PlaybackProgress {
    pub position_secs: f64,
    pub duration_secs: f64,
}

impl PlaybackProgress {
    pub fn new(position_secs: f64, duration_secs: f64) -> Self {
        Self {
            position_secs: position_secs.max(0.0),
            duration_secs: duration_secs.max(0.0),
        }
    }

    pub fn formatted_time(&self) -> String {
        let pos_m = (self.position_secs as u64) / 60;
        let pos_s = (self.position_secs as u64) % 60;
        let dur_m = (self.duration_secs as u64) / 60;
        let dur_s = (self.duration_secs as u64) % 60;
        format!("{:02}:{:02} / {:02}:{:02}", pos_m, pos_s, dur_m, dur_s)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum PlayerEvent {
    StateChanged(PlaybackState),
    ProgressChanged(PlaybackProgress),
    MediaLoaded {
        path: String,
        duration_secs: f64,
    },
    PlaybackFinished,
    Error(String),
}

#[derive(Debug, Error)]
pub enum PlayerError {
    #[error("Player is not initialized: {0}")]
    NotInitialized(String),

    #[error("Failed to load media at '{0}': {1}")]
    MediaLoadFailed(String, String),

    #[error("Operation invalid in current state ({0:?}): {1}")]
    InvalidState(PlaybackState, String),

    #[error("Native backend error ({0}): {1}")]
    Native(i32, String),

    #[error("Dynamic library loading error: {0}")]
    LibraryLoad(String),
}
