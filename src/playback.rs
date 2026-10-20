use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::player::state::PlaybackState;

/// A media URI returned by the NAS playback endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaybackStream {
    pub uri: String,
    #[serde(default)]
    pub audio_tracks: Vec<Value>,
    #[serde(default)]
    pub subtitle_tracks: Vec<Value>,
    #[serde(default)]
    pub extra_fields: serde_json::Map<String, Value>,
}

/// The smallest public contract for the known NAS personal progress endpoint.
/// A receipt means that the client attempted this request; it is not proof of
/// NAS persistence or successful resume on a later launch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaybackProgressUpdate {
    pub collection_id: String,
    pub classification_id: String,
    pub video_id: String,
    pub sec: u64,
    pub chapter: u32,
    pub audio_index: i32,
    pub subtitle_index: i32,
    pub subtitle_hash: String,
    pub video_duration: u64,
    pub subtitle_setting: String,
}

/// The minimum state needed to associate a loaded stream with its Episode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaybackSession {
    pub collection_id: String,
    pub classification_id: String,
    pub episode_id: String,
    pub stream: PlaybackStream,
    pub state: PlaybackState,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub audio_index: i32,
    pub subtitle_index: i32,
}

impl PlaybackSession {
    pub fn new(
        collection_id: String,
        classification_id: String,
        episode_id: String,
        stream: PlaybackStream,
        state: PlaybackState,
    ) -> Self {
        Self {
            collection_id,
            classification_id,
            episode_id,
            stream,
            state,
            position_secs: 0.0,
            duration_secs: 0.0,
            audio_index: 0,
            subtitle_index: 0,
        }
    }

    pub fn update_progress(&mut self, progress: crate::player::state::PlaybackProgress) {
        self.position_secs = progress.position_secs;
        self.duration_secs = progress.duration_secs;
    }

    pub fn progress_update(&self) -> PlaybackProgressUpdate {
        PlaybackProgressUpdate {
            collection_id: self.collection_id.clone(),
            classification_id: self.classification_id.clone(),
            video_id: self.episode_id.clone(),
            sec: self.position_secs.max(0.0).round() as u64,
            chapter: 0,
            audio_index: self.audio_index,
            subtitle_index: self.subtitle_index,
            subtitle_hash: String::new(),
            video_duration: self.duration_secs.max(0.0).round() as u64,
            subtitle_setting: String::new(),
        }
    }
}
