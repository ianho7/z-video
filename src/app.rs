use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use log::{error, info, warn};
use raw_window_handle::HasWindowHandle;
use slint::ComponentHandle;

use crate::player::state::{PlaybackState, PlayerEvent};
use crate::player::traits::Player;
#[cfg(windows)]
use crate::platform::Win32VideoSurface;

slint::include_modules!();

pub struct AppCoordinator {
    ui: AppWindow,
    player: Arc<dyn Player>,
    #[cfg(windows)]
    video_surface: Arc<Mutex<Option<Win32VideoSurface>>>,
    timer: slint::Timer,
}

impl AppCoordinator {
    pub fn new(player: Arc<dyn Player>, is_native: bool) -> Result<Self, Box<dyn std::error::Error>> {
        let ui = AppWindow::new()?;

        let engine_label = if is_native {
            "libmpv 2.6 (Direct3D 11 / HWDEC)"
        } else {
            "MockPlayer (Fallback / Verification)"
        };
        ui.set_engine_name(engine_label.into());

        #[cfg(windows)]
        let video_surface: Arc<Mutex<Option<Win32VideoSurface>>> = Arc::new(Mutex::new(None));

        let coordinator = Self {
            ui,
            player,
            #[cfg(windows)]
            video_surface,
            timer: slint::Timer::default(),
        };

        coordinator.setup_player_events();
        coordinator.setup_ui_callbacks();
        coordinator.setup_lifecycle();

        Ok(coordinator)
    }

    pub fn window(&self) -> &AppWindow {
        &self.ui
    }

    pub fn run(self) -> Result<(), slint::PlatformError> {
        self.ui.run()
    }

    fn setup_player_events(&self) {
        let ui_weak = self.ui.as_weak();

        self.player.add_event_listener(Box::new(move |event| {
            let ui_weak = ui_weak.clone();
            let _ = slint::invoke_from_event_loop(move || {
                if let Some(ui) = ui_weak.upgrade() {
                    match event {
                        PlayerEvent::StateChanged(state) => {
                            ui.set_playback_status(state.to_string().into());
                            ui.set_is_playing(state == PlaybackState::Playing);
                            match state {
                                PlaybackState::Playing => {
                                    ui.set_status_message("正在播放测试视频... UI 交互保持完全非阻塞".into());
                                }
                                PlaybackState::Paused => {
                                    ui.set_status_message("已暂停播放。可点击继续播放。".into());
                                }
                                PlaybackState::Stopped => {
                                    ui.set_status_message("播放已停止。".into());
                                    ui.set_progress_value(0.0);
                                }
                                PlaybackState::Idle => {
                                    ui.set_status_message("空闲状态。".into());
                                }
                            }
                        }
                        PlayerEvent::ProgressChanged(prog) => {
                            ui.set_progress_value(prog.position_secs as f32);
                            if prog.duration_secs > 0.0 {
                                ui.set_duration_value(prog.duration_secs as f32);
                            }
                            ui.set_time_label(prog.formatted_time().into());
                        }
                        PlayerEvent::MediaLoaded { path, duration_secs } => {
                            ui.set_media_path(path.into());
                            ui.set_duration_value(duration_secs as f32);
                            ui.set_status_message("媒体已成功载入并在原生窗口渲染。".into());
                        }
                        PlayerEvent::PlaybackFinished => {
                            ui.set_status_message("视频播放完毕。".into());
                        }
                        PlayerEvent::Error(err) => {
                            ui.set_status_message(format!("播放器错误: {}", err).into());
                        }
                    }
                }
            });
        }));
    }

    fn setup_ui_callbacks(&self) {
        let player = Arc::clone(&self.player);
        self.ui.on_toggle_pause_clicked(move || {
            info!("UI: toggle pause clicked");
            if let Err(e) = player.toggle_pause() {
                warn!("toggle_pause error: {}", e);
            }
        });

        let player = Arc::clone(&self.player);
        self.ui.on_play_clicked(move || {
            info!("UI: play clicked");
            if let Err(e) = player.play() {
                warn!("play error: {}", e);
            }
        });

        let player = Arc::clone(&self.player);
        self.ui.on_pause_clicked(move || {
            info!("UI: pause clicked");
            if let Err(e) = player.pause() {
                warn!("pause error: {}", e);
            }
        });

        let player = Arc::clone(&self.player);
        self.ui.on_stop_clicked(move || {
            info!("UI: stop clicked");
            if let Err(e) = player.stop() {
                warn!("stop error: {}", e);
            }
        });

        let player = Arc::clone(&self.player);
        self.ui.on_seek_relative(move |offset| {
            let cur = player.progress().position_secs;
            let target = (cur + offset as f64).max(0.0);
            info!("UI: seek relative by {}, target: {}", offset, target);
            if let Err(e) = player.seek(target) {
                warn!("seek error: {}", e);
            }
        });

        let player = Arc::clone(&self.player);
        self.ui.on_seek_absolute(move |target| {
            info!("UI: seek absolute to {}", target);
            if let Err(e) = player.seek(target as f64) {
                warn!("seek error: {}", e);
            }
        });

        let player = Arc::clone(&self.player);
        self.ui.on_load_sample_clicked(move || {
            let sample_path = find_sample_video_path();
            info!("UI: load sample clicked, path: {}", sample_path.display());
            if let Err(e) = player.load_media(&sample_path.to_string_lossy()) {
                error!("Failed to load sample media: {}", e);
            }
        });
    }

    fn setup_lifecycle(&self) {
        let ui_weak = self.ui.as_weak();
        let player = Arc::clone(&self.player);

        #[cfg(windows)]
        let surface_mutex = Arc::clone(&self.video_surface);

        let mut heartbeat = 0;
        let mut surface_initialized = false;

        self.timer.start(
            slint::TimerMode::Repeated,
            Duration::from_millis(100),
            move || {
                heartbeat += 1;
                let Some(ui) = ui_weak.upgrade() else { return };
                ui.set_ui_heartbeat_count(heartbeat);

                #[cfg(windows)]
                {
                    let scale = ui.window().scale_factor();
                    let area_x = (ui.get_video_area_x() * scale) as i32;
                    let area_y = (ui.get_video_area_y() * scale) as i32;
                    let area_w = (ui.get_video_area_width() * scale) as i32;
                    let area_h = (ui.get_video_area_height() * scale) as i32;

                    if !surface_initialized && area_w > 10 && area_h > 10 {
                        // Attempt to obtain native HWND and mount child video surface
                        let window_handle_holder = ui.window().window_handle();
                        let rwh_res = window_handle_holder.window_handle();
                        if let Ok(handle) = rwh_res {
                            if let raw_window_handle::RawWindowHandle::Win32(win32_handle) = handle.as_raw() {
                                let parent_hwnd = win32_handle.hwnd.get();
                                info!("Attaching native Win32 child surface to parent HWND: {:#x}", parent_hwnd);

                                match Win32VideoSurface::create(parent_hwnd, area_x, area_y, area_w, area_h) {
                                    Ok(surface) => {
                                        let child_hwnd = surface.hwnd();
                                        info!("Win32 child surface created with HWND: {:#x}", child_hwnd);

                                        if let Err(e) = player.set_video_surface(child_hwnd) {
                                            warn!("Failed to set video surface on player: {}", e);
                                        }

                                        *surface_mutex.lock().unwrap() = Some(surface);
                                        surface_initialized = true;
                                    }
                                    Err(err) => {
                                        error!("Failed to create Win32VideoSurface: {}", err);
                                    }
                                }
                            }
                        }
                    } else if surface_initialized {
                        // Synchronize surface geometry with Slint layout
                        if let Some(surface) = surface_mutex.lock().unwrap().as_ref() {
                            surface.set_bounds(area_x, area_y, area_w, area_h);
                        }
                    }
                }
            },
        );
    }
}

pub fn find_sample_video_path() -> PathBuf {
    let candidates = [
        "assets/test_video.mp4",
        "../assets/test_video.mp4",
        "../../assets/test_video.mp4",
    ];

    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            if let Ok(abs) = p.canonicalize() {
                return abs;
            }
            return p;
        }
    }

    PathBuf::from("assets/test_video.mp4")
}
