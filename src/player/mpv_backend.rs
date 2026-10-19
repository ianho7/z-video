use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use log::{debug, info};

use crate::player::mpv_sys::{
    str_to_cstring, MpvApi, MpvEventProperty, MpvHandle, MPV_EVENT_END_FILE,
    MPV_EVENT_FILE_LOADED, MPV_EVENT_NONE, MPV_EVENT_PROPERTY_CHANGE,
    MPV_EVENT_SHUTDOWN, MPV_EVENT_START_FILE, MPV_FORMAT_DOUBLE, MPV_FORMAT_FLAG,
};
use crate::player::state::{PlaybackProgress, PlaybackState, PlayerError, PlayerEvent};
use crate::player::traits::{Player, PlayerEventListener};

struct InnerState {
    state: PlaybackState,
    progress: PlaybackProgress,
    current_media: Option<String>,
    surface_id: Option<isize>,
    listeners: Vec<PlayerEventListener>,
}

pub struct MpvPlayer {
    api: Arc<MpvApi>,
    handle: MpvHandle,
    state: Arc<Mutex<InnerState>>,
    running: Arc<AtomicBool>,
    event_thread: Option<JoinHandle<()>>,
    lib_path: PathBuf,
}

unsafe impl Send for MpvPlayer {}
unsafe impl Sync for MpvPlayer {}

impl MpvPlayer {
    pub fn new(wid: Option<isize>) -> Result<Self, PlayerError> {
        let (api, lib_path) = MpvApi::auto_load().map_err(PlayerError::LibraryLoad)?;
        Self::new_with_api(Arc::new(api), lib_path, wid)
    }

    pub fn new_with_api(
        api: Arc<MpvApi>,
        lib_path: PathBuf,
        wid: Option<isize>,
    ) -> Result<Self, PlayerError> {
        info!("Initializing mpv player from: {}", lib_path.display());

        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err(PlayerError::NotInitialized("mpv_create returned NULL".to_string()));
        }

        // Configure options before mpv_initialize
        unsafe {
            let set_opt = |opt: &str, val: &str| {
                let opt_c = str_to_cstring(opt);
                let val_c = str_to_cstring(val);
                (api.set_option_string)(handle, opt_c.as_ptr(), val_c.as_ptr())
            };

            // Set video output and hardware decoding options
            set_opt("vo", "gpu");
            set_opt("gpu-api", "d3d11");
            set_opt("hwdec", "auto-safe");
            set_opt("keep-open", "yes");
            set_opt("ytdl", "no");
            set_opt("terminal", "no");

            if let Some(w) = wid {
                let wid_str = format!("{}", w);
                set_opt("wid", &wid_str);
            }

            let init_res = (api.initialize)(handle);
            if init_res < 0 {
                let err_msg = api.get_error_message(init_res);
                (api.terminate_destroy)(handle);
                return Err(PlayerError::Native(init_res, format!("mpv_initialize failed: {}", err_msg)));
            }

            // Observe properties
            let obs = |id: u64, prop: &str, fmt: i32| {
                let prop_c = str_to_cstring(prop);
                (api.observe_property)(handle, id, prop_c.as_ptr(), fmt);
            };

            obs(1, "pause", MPV_FORMAT_FLAG);
            obs(2, "time-pos", MPV_FORMAT_DOUBLE);
            obs(3, "duration", MPV_FORMAT_DOUBLE);
            obs(4, "eof-reached", MPV_FORMAT_FLAG);
            obs(5, "idle-active", MPV_FORMAT_FLAG);
        }

        let state = Arc::new(Mutex::new(InnerState {
            state: PlaybackState::Idle,
            progress: PlaybackProgress::default(),
            current_media: None,
            surface_id: wid,
            listeners: Vec::new(),
        }));

        let running = Arc::new(AtomicBool::new(true));

        // Start background event loop
        let thread_api = Arc::clone(&api);
        let thread_handle = handle as usize;
        let thread_state = Arc::clone(&state);
        let thread_running = Arc::clone(&running);

        let event_thread = thread::Builder::new()
            .name("mpv-event-loop".to_string())
            .spawn(move || {
                Self::event_loop_worker(
                    thread_api,
                    thread_handle as MpvHandle,
                    thread_state,
                    thread_running,
                );
            })
            .map_err(|e| PlayerError::NotInitialized(format!("Failed to spawn event loop: {}", e)))?;

        Ok(Self {
            api,
            handle,
            state,
            running,
            event_thread: Some(event_thread),
            lib_path,
        })
    }

    pub fn lib_path(&self) -> &Path {
        &self.lib_path
    }

    fn dispatch_event(state: &Arc<Mutex<InnerState>>, event: PlayerEvent) {
        let inner = state.lock().unwrap();
        for listener in &inner.listeners {
            listener(event.clone());
        }
    }

    fn event_loop_worker(
        api: Arc<MpvApi>,
        handle: MpvHandle,
        state: Arc<Mutex<InnerState>>,
        running: Arc<AtomicBool>,
    ) {
        debug!("mpv event loop started");
        while running.load(Ordering::Acquire) {
            let event_ptr = unsafe { (api.wait_event)(handle, 0.1) };
            if event_ptr.is_null() {
                continue;
            }

            let event = unsafe { &*event_ptr };
            match event.event_id {
                MPV_EVENT_NONE => continue,
                MPV_EVENT_SHUTDOWN => {
                    info!("mpv reported shutdown event");
                    break;
                }
                MPV_EVENT_START_FILE => {
                    debug!("mpv START_FILE");
                }
                MPV_EVENT_FILE_LOADED => {
                    let mut inner = state.lock().unwrap();
                    inner.state = PlaybackState::Playing;
                    let media_path = inner.current_media.clone().unwrap_or_default();
                    let duration = inner.progress.duration_secs;
                    drop(inner);

                    Self::dispatch_event(&state, PlayerEvent::MediaLoaded {
                        path: media_path,
                        duration_secs: duration,
                    });
                    Self::dispatch_event(&state, PlayerEvent::StateChanged(PlaybackState::Playing));
                }
                MPV_EVENT_END_FILE => {
                    let mut inner = state.lock().unwrap();
                    inner.state = PlaybackState::Stopped;
                    drop(inner);

                    Self::dispatch_event(&state, PlayerEvent::PlaybackFinished);
                    Self::dispatch_event(&state, PlayerEvent::StateChanged(PlaybackState::Stopped));
                }
                MPV_EVENT_PROPERTY_CHANGE => {
                    if !event.data.is_null() {
                        let prop = unsafe { &*(event.data as *const MpvEventProperty) };
                        let name = if prop.name.is_null() {
                            ""
                        } else {
                            unsafe { CStr::from_ptr(prop.name).to_str().unwrap_or("") }
                        };

                        match name {
                            "time-pos" => {
                                if prop.format == MPV_FORMAT_DOUBLE && !prop.data.is_null() {
                                    let pos = unsafe { *(prop.data as *const f64) };
                                    let mut inner = state.lock().unwrap();
                                    inner.progress.position_secs = pos;
                                    let progress = inner.progress;
                                    drop(inner);

                                    Self::dispatch_event(&state, PlayerEvent::ProgressChanged(progress));
                                }
                            }
                            "duration" => {
                                if prop.format == MPV_FORMAT_DOUBLE && !prop.data.is_null() {
                                    let dur = unsafe { *(prop.data as *const f64) };
                                    let mut inner = state.lock().unwrap();
                                    inner.progress.duration_secs = dur;
                                    let progress = inner.progress;
                                    drop(inner);

                                    Self::dispatch_event(&state, PlayerEvent::ProgressChanged(progress));
                                }
                            }
                            "pause" => {
                                if prop.format == MPV_FORMAT_FLAG && !prop.data.is_null() {
                                    let is_paused = unsafe { *(prop.data as *const i32) != 0 };
                                    let mut inner = state.lock().unwrap();
                                    let old_state = inner.state;
                                    if is_paused {
                                        if old_state != PlaybackState::Stopped && old_state != PlaybackState::Idle {
                                            inner.state = PlaybackState::Paused;
                                            drop(inner);
                                            Self::dispatch_event(&state, PlayerEvent::StateChanged(PlaybackState::Paused));
                                        }
                                    } else {
                                        if old_state == PlaybackState::Paused {
                                            inner.state = PlaybackState::Playing;
                                            drop(inner);
                                            Self::dispatch_event(&state, PlayerEvent::StateChanged(PlaybackState::Playing));
                                        }
                                    }
                                }
                            }
                            "idle-active" => {
                                if prop.format == MPV_FORMAT_FLAG && !prop.data.is_null() {
                                    let is_idle = unsafe { *(prop.data as *const i32) != 0 };
                                    if is_idle {
                                        let mut inner = state.lock().unwrap();
                                        if inner.state != PlaybackState::Stopped {
                                            inner.state = PlaybackState::Idle;
                                            drop(inner);
                                            Self::dispatch_event(&state, PlayerEvent::StateChanged(PlaybackState::Idle));
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        debug!("mpv event loop exited cleanly");
    }

    fn execute_command(&self, cmd: &[&str]) -> Result<(), PlayerError> {
        let c_strings: Vec<CString> = cmd.iter().map(|s| str_to_cstring(s)).collect();
        let mut pointers: Vec<*const std::ffi::c_char> = c_strings.iter().map(|cs| cs.as_ptr()).collect();
        pointers.push(std::ptr::null());

        let res = unsafe { (self.api.command)(self.handle, pointers.as_mut_ptr()) };
        if res < 0 {
            let msg = self.api.get_error_message(res);
            return Err(PlayerError::Native(res, format!("Command '{:?}' failed: {}", cmd, msg)));
        }
        Ok(())
    }

    fn set_property_string_val(&self, name: &str, value: &str) -> Result<(), PlayerError> {
        let name_c = str_to_cstring(name);
        let val_c = str_to_cstring(value);
        let res = unsafe { (self.api.set_property_string)(self.handle, name_c.as_ptr(), val_c.as_ptr()) };
        if res < 0 {
            let msg = self.api.get_error_message(res);
            return Err(PlayerError::Native(res, format!("set_property '{}'='{}' failed: {}", name, value, msg)));
        }
        Ok(())
    }
}

impl Player for MpvPlayer {
    fn load_media(&self, path: &str) -> Result<(), PlayerError> {
        info!("Loading media stream");
        let mut inner = self.state.lock().unwrap();
        inner.current_media = Some(path.to_string());
        inner.progress.position_secs = 0.0;
        drop(inner);

        // Escape path or load directly
        self.execute_command(&["loadfile", path, "replace"])?;
        Ok(())
    }

    fn play(&self) -> Result<(), PlayerError> {
        self.set_property_string_val("pause", "no")
    }

    fn pause(&self) -> Result<(), PlayerError> {
        self.set_property_string_val("pause", "yes")
    }

    fn toggle_pause(&self) -> Result<(), PlayerError> {
        self.execute_command(&["cycle", "pause"])
    }

    fn stop(&self) -> Result<(), PlayerError> {
        info!("Stopping playback");
        let res = self.execute_command(&["stop"]);
        let mut inner = self.state.lock().unwrap();
        inner.state = PlaybackState::Stopped;
        inner.progress.position_secs = 0.0;
        drop(inner);

        Self::dispatch_event(&self.state, PlayerEvent::StateChanged(PlaybackState::Stopped));
        res
    }

    fn seek(&self, position_secs: f64) -> Result<(), PlayerError> {
        let pos_str = format!("{:.2}", position_secs);
        self.execute_command(&["seek", &pos_str, "absolute"])
    }

    fn state(&self) -> PlaybackState {
        self.state.lock().unwrap().state
    }

    fn progress(&self) -> PlaybackProgress {
        self.state.lock().unwrap().progress
    }

    fn set_video_surface(&self, surface_id: isize) -> Result<(), PlayerError> {
        info!("Setting mpv video surface WID: {}", surface_id);
        let wid_str = format!("{}", surface_id);
        self.set_property_string_val("wid", &wid_str)?;
        let mut inner = self.state.lock().unwrap();
        inner.surface_id = Some(surface_id);
        Ok(())
    }

    fn add_event_listener(&self, listener: PlayerEventListener) {
        let mut inner = self.state.lock().unwrap();
        inner.listeners.push(listener);
    }

    fn backend_name(&self) -> &'static str {
        "libmpv"
    }
}

impl Drop for MpvPlayer {
    fn drop(&mut self) {
        info!("Shutting down MpvPlayer");
        self.running.store(false, Ordering::Release);

        unsafe {
            (self.api.wakeup)(self.handle);
        }

        if let Some(thread) = self.event_thread.take() {
            let _ = thread.join();
        }

        unsafe {
            (self.api.terminate_destroy)(self.handle);
        }
    }
}
