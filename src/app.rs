use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use log::{error, info, warn};
use raw_window_handle::HasWindowHandle;
use slint::ComponentHandle;

use crate::nas::auth::AuthError;
use crate::nas::client::{HttpNasClient, NasClient};
use crate::nas::session::NasSession;
use crate::player::state::{PlaybackState, PlayerEvent};
use crate::player::traits::Player;
use crate::storage::credentials::{
    KeyringCredentialStore, CredentialStore, SavedCredentials,
};
#[cfg(windows)]
use crate::platform::Win32VideoSurface;

slint::include_modules!();

pub struct AppCoordinator {
    ui: AppWindow,
    player: Arc<dyn Player>,
    nas_client: Arc<dyn NasClient>,
    session: Arc<NasSession>,
    credential_store: Arc<dyn CredentialStore>,
    #[cfg(windows)]
    video_surface: Arc<Mutex<Option<Win32VideoSurface>>>,
    timer: slint::Timer,
}

impl AppCoordinator {
    /// Creates a new AppCoordinator with standard HTTP NAS client and OS keyring storage.
    pub fn new(player: Arc<dyn Player>, is_native: bool) -> Result<Self, Box<dyn std::error::Error>> {
        let client = Arc::new(HttpNasClient::default());
        let store = Arc::new(KeyringCredentialStore::default());
        Self::with_deps(player, is_native, client, store)
    }

    /// Creates an AppCoordinator with custom/mockable NAS client and credential store.
    pub fn with_deps(
        player: Arc<dyn Player>,
        is_native: bool,
        nas_client: Arc<dyn NasClient>,
        credential_store: Arc<dyn CredentialStore>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let ui = AppWindow::new()?;

        let engine_label = if is_native {
            "libmpv 2.6 (Direct3D 11 / HWDEC)"
        } else {
            "MockPlayer (Fallback / Verification)"
        };
        ui.set_engine_name(engine_label.into());

        #[cfg(windows)]
        let video_surface: Arc<Mutex<Option<Win32VideoSurface>>> = Arc::new(Mutex::new(None));

        let session = Arc::new(NasSession::default());

        let coordinator = Self {
            ui,
            player,
            nas_client,
            session,
            credential_store,
            #[cfg(windows)]
            video_surface,
            timer: slint::Timer::default(),
        };

        coordinator.autoload_credentials();
        coordinator.setup_auth_callbacks();
        coordinator.setup_player_events();
        coordinator.setup_ui_callbacks();
        coordinator.setup_lifecycle();

        Ok(coordinator)
    }

    pub fn window(&self) -> &AppWindow {
        &self.ui
    }

    pub fn session(&self) -> Arc<NasSession> {
        Arc::clone(&self.session)
    }

    /// Synchronously performs login and updates session & UI state.
    /// Useful for programmatic coordination and integration tests.
    pub fn perform_login(
        &self,
        server_url: &str,
        username: &str,
        password: &str,
        sms_proof: Option<&str>,
        remember: bool,
    ) -> Result<crate::nas::auth::LoginResponseData, AuthError> {
        self.ui.set_login_loading(true);
        self.ui.set_login_error_message("".into());

        let res = self.nas_client.login(server_url, username, password, sms_proof);
        self.ui.set_login_loading(false);
        self.apply_login_result(server_url, username, password, remember, &res);
        res
    }

    /// Logs out from the active session, stopping playback and returning to login view.
    pub fn perform_logout(&self) {
        let _ = self.player.stop();
        self.session.clear();

        self.ui.set_is_logged_in(false);
        self.ui.set_login_status_hint("已安全退出会话。可重新输入凭据登录。".into());

        #[cfg(windows)]
        if let Some(surface) = self.video_surface.lock().unwrap().as_ref() {
            surface.set_bounds(-9999, -9999, 0, 0);
        }
    }

    fn apply_login_result(
        &self,
        server_url: &str,
        username: &str,
        password: &str,
        remember: bool,
        result: &Result<crate::nas::auth::LoginResponseData, AuthError>,
    ) {
        match result {
            Ok(data) => {
                info!("NAS authentication successful for user: {}", username);

                self.session.set_base_url(server_url.to_string());
                self.session.set_authenticated(
                    data.token.clone(),
                    username.to_string(),
                    data.qcname.clone(),
                    data.nas_name.clone(),
                    data.nas_id.clone(),
                );

                if remember {
                    let creds = SavedCredentials {
                        server_url: server_url.to_string(),
                        username: username.to_string(),
                        password: Some(password.to_string()),
                        token: Some(data.token.clone()),
                    };
                    if let Err(e) = self.credential_store.save(&creds) {
                        warn!("Failed to persist credentials to secure storage: {}", e);
                    }
                } else {
                    let _ = self.credential_store.delete();
                }

                let nas_display_name = data.nas_name.clone().unwrap_or_else(|| "极空间 NAS".to_string());
                self.ui.set_session_user(username.into());
                self.ui.set_session_nas_name(nas_display_name.into());
                self.ui.set_session_base_url(server_url.into());
                self.ui.set_show_sms_field(false);
                self.ui.set_login_error_message("".into());
                self.ui.set_is_logged_in(true);
                self.ui.set_status_message("局域网鉴权成功，已建立安全会话。".into());
            }
            Err(err) => {
                warn!("NAS login error: {}", err);
                let recovery_hint = err.user_recovery_hint();
                self.ui.set_login_error_message(recovery_hint.into());

                if let AuthError::MfaRequired { .. } = err {
                    self.ui.set_show_sms_field(true);
                    self.ui.set_login_status_hint("安全两步验证：请输入极空间验证码后点击登录。".into());
                }
            }
        }
    }

    pub fn run(self) -> Result<(), slint::PlatformError> {
        self.ui.run()
    }

    /// Automatically restores saved credentials from secure storage on launch if present.
    fn autoload_credentials(&self) {
        match self.credential_store.load() {
            Ok(Some(creds)) => {
                info!("Auto-loaded saved credentials for user: {}", creds.username);
                self.ui.set_server_url_input(creds.server_url.into());
                self.ui.set_username_input(creds.username.into());
                if let Some(pass) = creds.password {
                    self.ui.set_password_input(pass.into());
                }
                self.ui.set_remember_credentials(true);
                self.ui.set_login_status_hint("已从系统安全凭证库载入账号信息。点击登录直连 NAS。".into());
            }
            Ok(None) => {
                info!("No previous credentials stored in keyring");
            }
            Err(e) => {
                warn!("Could not read credentials from secure storage: {}", e);
            }
        }
    }

    /// Sets up authentication and session management callbacks.
    fn setup_auth_callbacks(&self) {
        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        let session = Arc::clone(&self.session);
        let credential_store = Arc::clone(&self.credential_store);

        self.ui.on_login_requested(move |server_url_slint, username_slint, password_slint, sms_code_slint, remember| {
            let Some(ui) = ui_weak.upgrade() else { return };

            let server_url = server_url_slint.to_string();
            let username = username_slint.to_string();
            let password = password_slint.to_string();
            let sms_code_str = sms_code_slint.to_string();
            let sms_proof = if sms_code_str.trim().is_empty() {
                None
            } else {
                Some(sms_code_str.trim().to_string())
            };

            ui.set_login_loading(true);
            ui.set_login_error_message("".into());

            info!("Initiating LAN NAS authentication for user: {}", username);

            let nas_client = Arc::clone(&nas_client);
            let session = Arc::clone(&session);
            let credential_store = Arc::clone(&credential_store);
            let ui_weak_bg = ui_weak.clone();

            // Run network authentication in a dedicated background worker thread to keep Slint UI responsive
            std::thread::spawn(move || {
                let login_result = nas_client.login(
                    &server_url,
                    &username,
                    &password,
                    sms_proof.as_deref(),
                );

                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = ui_weak_bg.upgrade() else { return };
                    ui.set_login_loading(false);

                    match login_result {
                        Ok(data) => {
                            info!("NAS authentication successful for user: {}", username);

                            session.set_base_url(server_url.clone());
                            session.set_authenticated(
                                data.token.clone(),
                                username.clone(),
                                data.qcname.clone(),
                                data.nas_name.clone(),
                                data.nas_id.clone(),
                            );

                            if remember {
                                let creds = SavedCredentials {
                                    server_url: server_url.clone(),
                                    username: username.clone(),
                                    password: Some(password),
                                    token: Some(data.token),
                                };
                                if let Err(e) = credential_store.save(&creds) {
                                    warn!("Failed to persist credentials to secure storage: {}", e);
                                }
                            } else {
                                let _ = credential_store.delete();
                            }

                            let nas_display_name = data.nas_name.unwrap_or_else(|| "极空间 NAS".to_string());
                            ui.set_session_user(username.into());
                            ui.set_session_nas_name(nas_display_name.into());
                            ui.set_session_base_url(server_url.into());
                            ui.set_show_sms_field(false);
                            ui.set_login_error_message("".into());
                            ui.set_is_logged_in(true);
                            ui.set_status_message("局域网鉴权成功，已建立安全会话。".into());
                        }
                        Err(err) => {
                            warn!("NAS login error: {}", err);
                            let recovery_hint = err.user_recovery_hint();
                            ui.set_login_error_message(recovery_hint.into());

                            if let AuthError::MfaRequired { .. } = err {
                                ui.set_show_sms_field(true);
                                ui.set_login_status_hint("安全两步验证：请输入极空间验证码后点击登录。".into());
                            }
                        }
                    }
                });
            });
        });

        let ui_weak = self.ui.as_weak();
        let session = Arc::clone(&self.session);
        let player = Arc::clone(&self.player);

        #[cfg(windows)]
        let surface_mutex = Arc::clone(&self.video_surface);

        self.ui.on_logout_requested(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            info!("User requested logout, clearing active session");

            let _ = player.stop();
            session.clear();

            ui.set_is_logged_in(false);
            ui.set_login_status_hint("已安全退出会话。可重新输入凭据登录。".into());

            #[cfg(windows)]
            if let Some(surface) = surface_mutex.lock().unwrap().as_ref() {
                surface.set_bounds(-9999, -9999, 0, 0);
            }
        });
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
                    let is_logged_in = ui.get_is_logged_in();
                    let scale = ui.window().scale_factor();
                    let area_x = (ui.get_video_area_x() * scale) as i32;
                    let area_y = (ui.get_video_area_y() * scale) as i32;
                    let area_w = (ui.get_video_area_width() * scale) as i32;
                    let area_h = (ui.get_video_area_height() * scale) as i32;

                    if is_logged_in {
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
                    } else if surface_initialized {
                        // Move surface out of view when on login screen
                        if let Some(surface) = surface_mutex.lock().unwrap().as_ref() {
                            surface.set_bounds(-9999, -9999, 0, 0);
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
