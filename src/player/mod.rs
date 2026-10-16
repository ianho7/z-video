pub mod mock;
pub mod mpv_backend;
pub mod mpv_sys;
pub mod state;
pub mod traits;

pub use mock::MockPlayer;
pub use mpv_backend::MpvPlayer;
pub use state::{PlaybackProgress, PlaybackState, PlayerError, PlayerEvent};
pub use traits::{Player, PlayerEventListener};

use std::sync::Arc;
use log::{info, warn};

pub fn create_player_probe(wid: Option<isize>) -> (Arc<dyn Player>, bool) {
    match MpvPlayer::new(wid) {
        Ok(mpv) => {
            info!("Successfully initialized native libmpv player probe");
            (Arc::new(mpv), true)
        }
        Err(e) => {
            warn!("Native libmpv player probe unavailable: {}. Falling back to mock player backend for verification.", e);
            (Arc::new(MockPlayer::new()), false)
        }
    }
}
