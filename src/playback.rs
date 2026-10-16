use serde::{Deserialize, Serialize};

use crate::player::state::PlaybackState;

/// A media URI returned by the NAS playback endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlaybackStream {
    pub uri: String,
}

/// The minimum state needed to associate a loaded stream with its Episode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlaybackSession {
    pub collection_id: String,
    pub classification_id: String,
    pub episode_id: String,
    pub stream: PlaybackStream,
    pub state: PlaybackState,
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
        }
    }
}
