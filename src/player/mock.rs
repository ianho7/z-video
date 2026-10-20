use std::sync::{Arc, Mutex};
use crate::player::state::{PlaybackProgress, PlaybackState, PlayerError, PlayerEvent};
use crate::player::traits::{Player, PlayerEventListener};

#[derive(Default)]
struct Inner {
    state: PlaybackState,
    progress: PlaybackProgress,
    current_media: Option<String>,
    surface_id: Option<isize>,
    listeners: Vec<PlayerEventListener>,
    history: Vec<String>,
    defer_media_loaded: bool,
}

#[derive(Clone, Default)]
pub struct MockPlayer {
    inner: Arc<Mutex<Inner>>,
}

impl MockPlayer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn call_history(&self) -> Vec<String> {
        self.inner.lock().unwrap().history.clone()
    }

    /// Delays the load events so tests can model an asynchronous native player.
    pub fn defer_media_loaded(&self) {
        self.inner.lock().unwrap().defer_media_loaded = true;
    }

    /// Delivers the load events after a deferred media load is ready.
    pub fn emit_media_loaded(&self) {
        let (path, duration_secs) = {
            let inner = self.inner.lock().unwrap();
            (inner.current_media.clone().unwrap_or_default(), inner.progress.duration_secs)
        };
        self.dispatch_event(PlayerEvent::MediaLoaded {
            path,
            duration_secs,
        });
        self.dispatch_event(PlayerEvent::StateChanged(PlaybackState::Playing));
        self.dispatch_event(PlayerEvent::ProgressChanged(PlaybackProgress::new(
            0.0,
            duration_secs,
        )));
    }

    fn dispatch_event(&self, event: PlayerEvent) {
        let inner = self.inner.lock().unwrap();
        for listener in &inner.listeners {
            listener(event.clone());
        }
    }
}

impl Player for MockPlayer {
    fn load_media(&self, path: &str) -> Result<(), PlayerError> {
        let mut inner = self.inner.lock().unwrap();
        inner.history.push(format!("load_media:{}", path));
        inner.current_media = Some(path.to_string());
        inner.state = PlaybackState::Playing;
        inner.progress = PlaybackProgress::new(0.0, 120.0);
        let defer_media_loaded = inner.defer_media_loaded;
        drop(inner);

        if defer_media_loaded {
            return Ok(());
        }

        self.dispatch_event(PlayerEvent::MediaLoaded {
            path: path.to_string(),
            duration_secs: 120.0,
        });
        self.dispatch_event(PlayerEvent::StateChanged(PlaybackState::Playing));
        self.dispatch_event(PlayerEvent::ProgressChanged(PlaybackProgress::new(0.0, 120.0)));
        Ok(())
    }

    fn play(&self) -> Result<(), PlayerError> {
        let mut inner = self.inner.lock().unwrap();
        inner.history.push("play".to_string());
        if inner.current_media.is_none() {
            return Err(PlayerError::InvalidState(inner.state, "No media loaded".to_string()));
        }
        inner.state = PlaybackState::Playing;
        drop(inner);

        self.dispatch_event(PlayerEvent::StateChanged(PlaybackState::Playing));
        Ok(())
    }

    fn pause(&self) -> Result<(), PlayerError> {
        let mut inner = self.inner.lock().unwrap();
        inner.history.push("pause".to_string());
        if inner.current_media.is_none() {
            return Err(PlayerError::InvalidState(inner.state, "No media loaded".to_string()));
        }
        inner.state = PlaybackState::Paused;
        drop(inner);

        self.dispatch_event(PlayerEvent::StateChanged(PlaybackState::Paused));
        Ok(())
    }

    fn toggle_pause(&self) -> Result<(), PlayerError> {
        let current_state = self.state();
        match current_state {
            PlaybackState::Playing => self.pause(),
            PlaybackState::Paused => self.play(),
            PlaybackState::Idle | PlaybackState::Stopped => {
                let inner = self.inner.lock().unwrap();
                if let Some(media) = inner.current_media.clone() {
                    drop(inner);
                    self.load_media(&media)
                } else {
                    Err(PlayerError::InvalidState(current_state, "Cannot toggle pause: no media".to_string()))
                }
            }
        }
    }

    fn stop(&self) -> Result<(), PlayerError> {
        let mut inner = self.inner.lock().unwrap();
        inner.history.push("stop".to_string());
        inner.state = PlaybackState::Stopped;
        inner.progress.position_secs = 0.0;
        drop(inner);

        self.dispatch_event(PlayerEvent::StateChanged(PlaybackState::Stopped));
        Ok(())
    }

    fn seek(&self, position_secs: f64) -> Result<(), PlayerError> {
        let mut inner = self.inner.lock().unwrap();
        inner.history.push(format!("seek:{}", position_secs));
        inner.progress.position_secs = position_secs;
        let progress = inner.progress;
        drop(inner);

        self.dispatch_event(PlayerEvent::ProgressChanged(progress));
        Ok(())
    }

    fn state(&self) -> PlaybackState {
        self.inner.lock().unwrap().state
    }

    fn progress(&self) -> PlaybackProgress {
        self.inner.lock().unwrap().progress
    }

    fn set_video_surface(&self, surface_id: isize) -> Result<(), PlayerError> {
        let mut inner = self.inner.lock().unwrap();
        inner.history.push(format!("set_video_surface:{}", surface_id));
        inner.surface_id = Some(surface_id);
        Ok(())
    }

    fn add_event_listener(&self, listener: PlayerEventListener) {
        let mut inner = self.inner.lock().unwrap();
        inner.listeners.push(listener);
    }

    fn backend_name(&self) -> &'static str {
        "MockPlayer"
    }
}
