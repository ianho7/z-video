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

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlaybackControlState {
    seek_generation: u64,
    seek_in_progress: bool,
    seek_target_secs: Option<f64>,
    fullscreen: bool,
}

impl Default for PlaybackControlState {
    fn default() -> Self {
        Self {
            seek_generation: 0,
            seek_in_progress: false,
            seek_target_secs: None,
            fullscreen: false,
        }
    }
}

impl PlaybackControlState {
    pub fn preview_seek(&mut self, position_secs: f64, duration_secs: f64) -> u64 {
        self.seek_generation = self.seek_generation.wrapping_add(1);
        self.seek_in_progress = true;

        let position_secs = clamp_seek_position(position_secs, duration_secs);
        self.seek_target_secs = Some(position_secs);
        self.seek_generation
    }

    pub fn seek_target_secs(&self) -> Option<f64> {
        self.seek_target_secs
    }

    pub fn is_seek_in_progress(&self) -> bool {
        self.seek_in_progress
    }

    pub fn accepts_progress_event(&self) -> bool {
        !self.seek_in_progress
    }

    pub fn finish_seek(&mut self, generation: u64) -> bool {
        if self.seek_in_progress && self.seek_generation == generation {
            self.seek_in_progress = false;
            self.seek_target_secs = None;
            true
        } else {
            false
        }
    }

    pub fn cancel_seek(&mut self) {
        self.seek_in_progress = false;
        self.seek_target_secs = None;
    }

    pub fn toggle_fullscreen(&mut self) -> bool {
        self.fullscreen = !self.fullscreen;
        self.fullscreen
    }

    pub fn is_fullscreen(&self) -> bool {
        self.fullscreen
    }
}

fn clamp_seek_position(position_secs: f64, duration_secs: f64) -> f64 {
    let position_secs = if position_secs.is_finite() {
        position_secs.max(0.0)
    } else {
        0.0
    };

    if duration_secs.is_finite() && duration_secs > 0.0 {
        position_secs.min(duration_secs)
    } else {
        position_secs
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
