use crate::player::state::{PlaybackProgress, PlaybackState, PlayerError, PlayerEvent};

pub type PlayerEventListener = Box<dyn Fn(PlayerEvent) + Send + Sync + 'static>;

pub trait Player: Send + Sync {
    fn load_media(&self, path: &str) -> Result<(), PlayerError>;
    fn play(&self) -> Result<(), PlayerError>;
    fn pause(&self) -> Result<(), PlayerError>;
    fn toggle_pause(&self) -> Result<(), PlayerError>;
    fn stop(&self) -> Result<(), PlayerError>;
    fn seek(&self, position_secs: f64) -> Result<(), PlayerError>;
    fn state(&self) -> PlaybackState;
    fn progress(&self) -> PlaybackProgress;
    fn set_video_surface(&self, surface_id: isize) -> Result<(), PlayerError>;
    fn add_event_listener(&self, listener: PlayerEventListener);
    fn backend_name(&self) -> &'static str;
}
