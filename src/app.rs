use log::{error, info, warn};
use raw_window_handle::HasWindowHandle;
use slint::{ComponentHandle, Model, ModelRc, VecModel};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::media::image_cache::{
    decode_image_pixels, slint_image_from_decoded, DecodedImage, ImageCache, ImageRequestGate,
};
use crate::diagnostics;
use crate::nas::auth::sanitize_log_message;
use crate::nas::auth::{AuthError, MfaProof};
use crate::nas::client::{normalize_lan_url, HttpNasClient, NasClient};
use crate::nas::discovery::{
    discover_local_nas, DiscoveryCancellation, DiscoveryConfig, DiscoveryError,
    NasDiscoveryResult,
};
use crate::nas::models::{CollectionDetail, CollectionItem, Episode, NasError};
use crate::nas::session::NasSession;
#[cfg(windows)]
use crate::platform::Win32VideoSurface;
use crate::playback::{PlaybackSession, PlaybackStream};
use crate::player::state::{PlaybackControlState, PlaybackProgress, PlaybackState, PlayerEvent};
use crate::player::traits::Player;
use crate::storage::credentials::{
    CredentialStore, KeyringCredentialStore, SavedCredentials,
};

slint::include_modules!();

pub struct AppCoordinator {
    ui: AppWindow,
    player: Arc<dyn Player>,
    nas_client: Arc<dyn NasClient>,
    session: Arc<NasSession>,
    credential_store: Arc<dyn CredentialStore>,
    startup_restore_pending: Arc<AtomicBool>,
    discovery_cancellation: Arc<Mutex<Option<DiscoveryCancellation>>>,
    image_cache: ImageCache,
    image_request_gate: ImageRequestGate,
    detail_state: Arc<Mutex<Option<CollectionDetail>>>,
    detail_request_generation: Arc<AtomicU64>,
    playback_request_generation: Arc<AtomicU64>,
    playback_session: Arc<Mutex<Option<PlaybackSession>>>,
    playback_controls: Arc<Mutex<PlaybackControlState>>,
    #[cfg(windows)]
    video_surface: Arc<Mutex<Option<Win32VideoSurface>>>,
    timer: slint::Timer,
}

impl AppCoordinator {
    /// Creates a new AppCoordinator with standard HTTP NAS client and OS keyring storage.
    pub fn new(
        player: Arc<dyn Player>,
        is_native: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
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
        let startup = diagnostics::start_event("app", "coordinator.init");
        let ui = AppWindow::new()?;

        let engine_label = if is_native {
            "libmpv 2.6 (D3D11 / hwdec=auto-safe; runtime unverified)"
        } else {
            "MockPlayer (Fallback / Verification)"
        };
        ui.set_engine_name(engine_label.into());

        #[cfg(windows)]
        let video_surface: Arc<Mutex<Option<Win32VideoSurface>>> = Arc::new(Mutex::new(None));

        let session = Arc::new(NasSession::default());
        let startup_restore_pending = Arc::new(AtomicBool::new(false));
        let image_cache =
            ImageCache::with_disk_cache(default_image_cache_dir(), 100, 64 * 1024 * 1024);
        let detail_state = Arc::new(Mutex::new(None));

        let coordinator = Self {
            ui,
            player,
            nas_client,
            session,
            credential_store,
            startup_restore_pending,
            discovery_cancellation: Arc::new(Mutex::new(None)),
            image_cache,
            image_request_gate: ImageRequestGate::new(),
            detail_state,
            detail_request_generation: Arc::new(AtomicU64::new(0)),
            playback_request_generation: Arc::new(AtomicU64::new(0)),
            playback_session: Arc::new(Mutex::new(None)),
            playback_controls: Arc::new(Mutex::new(PlaybackControlState::default())),
            #[cfg(windows)]
            video_surface,
            timer: slint::Timer::default(),
        };

        coordinator.setup_auth_callbacks();
        coordinator.setup_discovery_callbacks();
        coordinator.setup_library_callbacks();
        coordinator.setup_player_events();
        coordinator.setup_ui_callbacks();
        coordinator.setup_lifecycle();
        coordinator.autoload_credentials();
        startup.finish("success", &[]);

        Ok(coordinator)
    }

    pub fn window(&self) -> &AppWindow {
        &self.ui
    }

    pub fn session(&self) -> Arc<NasSession> {
        Arc::clone(&self.session)
    }

    pub fn image_cache(&self) -> &ImageCache {
        &self.image_cache
    }

    pub fn playback_session(&self) -> Option<PlaybackSession> {
        self.playback_session.lock().unwrap().clone()
    }

    /// Synchronously performs login and updates session & UI state.
    pub fn perform_login(
        &self,
        server_url: &str,
        username: &str,
        password: &str,
        sms_proof: Option<&MfaProof>,
        remember: bool,
    ) -> Result<crate::nas::auth::LoginResponseData, AuthError> {
        let operation = diagnostics::start_event("ui", "auth.login");
        self.ui.set_login_loading(true);
        self.ui.set_login_error_message("".into());

        let res = self
            .nas_client
            .login(server_url, username, password, sms_proof);
        self.ui.set_login_loading(false);
        self.apply_login_result(server_url, username, password, remember, &res);

        if res.is_ok() {
            let _ = self.load_classifications_sync();
        }

        operation.finish(
            if res.is_ok() { "success" } else { "error" },
            &[("remember", remember.to_string())],
        );

        res
    }

    /// Synchronously requests the SMS code for a pending MFA challenge.
    /// UI callbacks use the same client operation from a background thread.
    pub fn perform_send_mfa_code(
        &self,
        server_url: &str,
        username: &str,
        challenge_type: Option<&str>,
    ) -> Result<(), AuthError> {
        let operation = diagnostics::start_event("ui", "auth.mfa.send_code");
        self.ui.set_mfa_code_sending(true);
        self.ui.set_mfa_code_sent(false);
        self.ui.set_login_error_message("".into());
        self.ui
            .set_mfa_status_hint("正在发送验证码，请稍候...".into());

        let result = self
            .nas_client
            .send_mfa_code(server_url, username, challenge_type);
        self.ui.set_mfa_code_sending(false);
        match &result {
            Ok(()) => {
                self.ui.set_mfa_code_sent(true);
                self.ui.set_mfa_status_hint(
                    "验证码已发送，请输入收到的验证码，再点击“验证登录”。".into(),
                );
            }
            Err(error) => {
                self.ui.set_mfa_code_sent(false);
                self.ui
                    .set_login_error_message(error.user_recovery_hint().into());
                self.ui
                    .set_mfa_status_hint("验证码发送失败，请检查网络后重试。".into());
            }
        }
        operation.finish(
            if result.is_ok() { "success" } else { "error" },
            &[(
                "challenge_type",
                challenge_type.unwrap_or("default").to_string(),
            )],
        );
        result
    }

    /// Synchronously verifies the user-entered code and retries NAS login
    /// with only the opaque proof returned by `/sms/ucheck`.
    pub fn perform_mfa_login(
        &self,
        server_url: &str,
        username: &str,
        password: &str,
        code: &str,
        remember: bool,
    ) -> Result<crate::nas::auth::LoginResponseData, AuthError> {
        let operation = diagnostics::start_event("ui", "auth.mfa.login");
        self.ui.set_login_loading(true);
        self.ui.set_mfa_verifying(true);
        self.ui.set_login_error_message("".into());
        self.ui
            .set_mfa_status_hint("正在验证验证码并登录 NAS...".into());

        let result = self
            .nas_client
            .verify_mfa_code(server_url, username, code)
            .and_then(|proof| {
                self.nas_client
                    .login(server_url, username, password, Some(&proof))
            });

        self.ui.set_login_loading(false);
        self.ui.set_mfa_verifying(false);
        apply_login_result_to_ui(
            &self.ui,
            &self.session,
            self.credential_store.as_ref(),
            server_url,
            username,
            password,
            remember,
            &result,
        );

        if result.is_ok() {
            let _ = self.load_classifications_sync();
        } else {
            self.ui
                .set_mfa_status_hint("验证码验证失败，请检查验证码后重试。".into());
        }

        operation.finish(
            if result.is_ok() { "success" } else { "error" },
            &[("remember", remember.to_string())],
        );

        result
    }

    /// Logs out from the active session, stopping playback and returning to login view.
    pub fn perform_logout(&self) {
        let operation = diagnostics::start_event("ui", "session.logout");
        let _ = self.player.stop();
        self.session.clear();
        self.detail_request_generation
            .fetch_add(1, Ordering::SeqCst);
        self.playback_request_generation
            .fetch_add(1, Ordering::SeqCst);
        self.image_request_gate.cancel();
        *self.detail_state.lock().unwrap() = None;
        *self.playback_session.lock().unwrap() = None;

        self.ui.set_is_logged_in(false);
        self.ui
            .set_login_status_hint("已安全退出会话。可重新输入凭据登录。".into());
        self.ui
            .set_classifications(ModelRc::new(VecModel::default()));
        self.ui.set_collections(ModelRc::new(VecModel::default()));
        self.ui.set_playback_loading(false);
        self.ui.set_playback_error("".into());
        self.ui.set_requires_relogin(false);
        self.ui.set_show_sms_field(false);
        self.ui.set_mfa_challenge_type("".into());
        self.ui.set_mfa_code_sent(false);
        self.ui.set_mfa_code_sending(false);
        self.ui.set_mfa_verifying(false);
        self.ui.set_mfa_status_hint("".into());
        self.ui.set_sms_code_input("".into());

        #[cfg(windows)]
        if let Some(surface) = self.video_surface.lock().unwrap().as_ref() {
            surface.set_bounds(-9999, -9999, 0, 0);
        }

        operation.finish("success", &[]);
    }

    fn apply_login_result(
        &self,
        server_url: &str,
        username: &str,
        password: &str,
        remember: bool,
        result: &Result<crate::nas::auth::LoginResponseData, AuthError>,
    ) {
        apply_login_result_to_ui(
            &self.ui,
            &self.session,
            self.credential_store.as_ref(),
            server_url,
            username,
            password,
            remember,
            result,
        );
    }

    pub fn run(self) -> Result<(), slint::PlatformError> {
        self.ui.run()
    }

    /// Automatically restores saved credentials from secure storage on launch if present.
    fn autoload_credentials(&self) {
        let operation = diagnostics::start_event("session", "session.restore");
        match self.credential_store.load() {
            Ok(Some(creds)) => {
                info!("Auto-loaded saved credentials for user: {}", creds.username);
                self.ui
                    .set_server_url_input(creds.server_url.clone().into());
                self.ui.set_username_input(creds.username.clone().into());
                if let Some(pass) = creds.password.as_deref() {
                    self.ui.set_password_input(pass.into());
                }
                self.ui.set_remember_credentials(true);

                let Some(token) = creds
                    .token
                    .as_deref()
                    .map(str::trim)
                    .filter(|token| !token.is_empty())
                else {
                    self.ui.set_login_status_hint(
                        "已从系统安全凭证库载入账号信息。点击登录直连 NAS。".into(),
                    );
                    operation.finish(
                        "partial",
                        &[("authenticated", "false".to_string()), ("storage", "secure_store".to_string())],
                    );
                    return;
                };

                let normalized_base_url = normalized_session_base_url(&creds.server_url);
                self.session.set_base_url(normalized_base_url.clone());
                self.session.set_authenticated_with_identity(
                    token.to_string(),
                    creds.username.clone(),
                    None,
                    None,
                    creds.nas_id.clone(),
                    creds.nas_sign.clone(),
                );
                self.ui.set_session_user(creds.username.into());
                self.ui.set_session_nas_name("极空间 NAS".into());
                self.ui
                    .set_session_base_url(normalized_base_url.into());
                self.ui.set_login_error_message("".into());
                self.ui.set_requires_relogin(false);
                self.ui.set_is_logged_in(true);
                self.ui.set_current_view("library".into());
                self.ui.set_login_status_hint("已恢复保存的 NAS 会话。".into());
                self.ui
                    .set_status_message("正在恢复保存的 NAS 会话并加载片库...".into());
                self.startup_restore_pending.store(true, Ordering::SeqCst);

                let ui_weak = self.ui.as_weak();
                slint::Timer::single_shot(Duration::from_millis(0), move || {
                    if let Some(ui) = ui_weak.upgrade() {
                        ui.invoke_refresh_library_clicked();
                    }
                });
                operation.finish(
                    "success",
                    &[("authenticated", "true".to_string()), ("storage", "secure_store".to_string())],
                );
            }
            Ok(None) => {
                info!("No previous credentials stored in keyring");
                operation.finish("skipped", &[("authenticated", "false".to_string())]);
            }
            Err(e) => {
                warn!("Could not read credentials from secure storage: {}", e);
                let hint = format!(
                    "系统安全凭据读取失败。{}",
                    e.user_recovery_hint("读取")
                );
                self.ui.set_login_error_message(hint.clone().into());
                self.ui.set_login_status_hint(hint.into());
                operation.finish("error", &[("storage", "secure_store".to_string())]);
            }
        }
    }

    /// Synchronously loads classifications from the NAS client into UI state.
    pub fn load_classifications_sync(&self) -> Result<(), NasError> {
        let operation = diagnostics::start_event("ui", "library.refresh");
        self.ui.set_library_loading(true);
        self.ui.set_library_error("".into());
        self.ui.set_requires_relogin(false);

        let res = self.nas_client.get_classifications(&self.session);
        match res {
            Ok(cats) => {
                let first_id = cats.first().map(|c| c.id.clone()).unwrap_or_default();
                let first_name = cats
                    .first()
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| "全部".to_string());

                let ui_items: Vec<ClassificationUiItem> = cats
                    .iter()
                    .enumerate()
                    .map(|(idx, c)| ClassificationUiItem {
                        id: c.id.clone().into(),
                        name: c.name.clone().into(),
                        count: c.count as i32,
                        is_selected: idx == 0,
                    })
                    .collect();

                let model = Rc::new(VecModel::from(ui_items));
                self.ui.set_classifications(ModelRc::from(model));
                self.ui
                    .set_selected_classification_id(first_id.clone().into());
                self.ui.set_selected_classification_name(first_name.into());

                if !first_id.is_empty() {
                    let result = self.load_collections_sync(&first_id);
                    operation.finish(
                        if result.is_ok() { "success" } else { "error" },
                        &[("category_count", cats.len().to_string())],
                    );
                    result
                } else {
                    self.ui.set_library_loading(false);
                    operation.finish("success", &[("category_count", cats.len().to_string())]);
                    Ok(())
                }
            }
            Err(err) => {
                self.ui.set_library_loading(false);
                self.ui.set_library_error(err.user_recovery_hint().into());
                let requires_relogin = err.requires_reauthentication();
                self.ui.set_requires_relogin(requires_relogin);
                record_reauthentication_required("library.refresh", requires_relogin);
                operation.finish("error", &[]);
                Err(err)
            }
        }
    }

    /// Synchronously loads collections for a specific classification into UI state.
    pub fn load_collections_sync(&self, classification_id: &str) -> Result<(), NasError> {
        let operation = diagnostics::start_event("ui", "library.collections");
        let request_id = self.image_request_gate.begin();
        self.ui.set_library_loading(true);
        self.ui.set_library_error("".into());
        self.ui.set_requires_relogin(false);

        let res = self
            .nas_client
            .get_collections(&self.session, classification_id, 1, 50);
        self.ui.set_library_loading(false);

        match res {
            Ok(page) => {
                if !self.image_request_gate.is_current(request_id) {
                    return Ok(());
                }
                let count = page.list.len();
                self.ui.set_collection_count(count as i32);

                let ui_items: Vec<CollectionUiItem> = page
                    .list
                    .iter()
                    .map(|item| CollectionUiItem {
                        collection_id: item.collection_id.clone().into(),
                        title: item.title.clone().into(),
                        release_year: item.release_year.clone().into(),
                        video_type: item.display_type().to_string().into(),
                        score: item.display_score().into(),
                        cover_image: slint::Image::default(),
                        has_cover: false,
                    })
                    .collect();

                let model = Rc::new(VecModel::from(ui_items));
                self.ui.set_collections(ModelRc::from(model));
                self.ui
                    .set_status_message(format!("片库已就绪，已加载 {} 部影片", count).into());

                // Trigger background poster fetching for items without cover in cache
                Self::spawn_poster_fetching(
                    self.ui.as_weak(),
                    Arc::clone(&self.nas_client),
                    Arc::clone(&self.session),
                    self.image_cache.clone(),
                    self.image_request_gate.clone(),
                    request_id,
                    page.list,
                );

                operation.finish("success", &[("item_count", count.to_string())]);

                Ok(())
            }
            Err(err) => {
                self.ui.set_library_error(err.user_recovery_hint().into());
                let requires_relogin = err.requires_reauthentication();
                self.ui.set_requires_relogin(requires_relogin);
                record_reauthentication_required("library.collections", requires_relogin);
                operation.finish("error", &[]);
                Err(err)
            }
        }
    }

    fn start_collection_detail_load(
        ui_weak: slint::Weak<AppWindow>,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        detail_state: Arc<Mutex<Option<CollectionDetail>>>,
        detail_request_generation: Arc<AtomicU64>,
        playback_request_generation: Arc<AtomicU64>,
        playback_session: Arc<Mutex<Option<PlaybackSession>>>,
        collection_id: String,
        classification_id: String,
    ) {
        let operation = diagnostics::start_event("ui", "library.collection_detail");
        let request_generation = detail_request_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let image_request_id = image_request_gate.begin();
        playback_request_generation.fetch_add(1, Ordering::SeqCst);
        *detail_state.lock().unwrap() = None;
        *playback_session.lock().unwrap() = None;

        if let Some(ui) = ui_weak.upgrade() {
            ui.set_current_view("detail".into());
            ui.set_detail_collection_id(collection_id.clone().into());
            ui.set_detail_title("".into());
            ui.set_detail_release_year("".into());
            ui.set_detail_video_type("".into());
            ui.set_detail_score("".into());
            ui.set_detail_storyline("".into());
            ui.set_detail_cover_image(slint::Image::default());
            ui.set_detail_background_image(slint::Image::default());
            ui.set_detail_has_cover(false);
            ui.set_detail_has_background(false);
            ui.set_detail_is_movie(false);
            ui.set_detail_seasons(ModelRc::new(VecModel::default()));
            ui.set_selected_episode_id("".into());
            ui.set_detail_loading(true);
            ui.set_detail_error("".into());
            ui.set_playback_loading(false);
            ui.set_playback_error("".into());
            ui.set_status_message("正在后台加载影视详情...".into());
        }

        let request_id = collection_id.clone();
        let ui_weak_bg = ui_weak.clone();
        let detail_state_bg = Arc::clone(&detail_state);
        let detail_request_generation_bg = Arc::clone(&detail_request_generation);
        let image_request_gate_bg = image_request_gate.clone();
        std::thread::spawn(move || {
            let detail_result =
                nas_client.get_collection_detail(&session, &collection_id, &classification_id);
            operation.finish(
                if detail_result.is_ok() { "success" } else { "error" },
                &[
                    ("collection_id", collection_id.clone()),
                    ("classification_id", classification_id.clone()),
                ],
            );

            // Fetch and CPU-decode images in this worker. The event loop only
            // creates the Slint image object from already-decoded pixels.
            let (cover_image, background_image) = if let Ok(detail) = &detail_result {
                (
                    fetch_detail_image(
                        &nas_client,
                        &session,
                        &image_cache,
                        &image_request_gate_bg,
                        image_request_id,
                        &detail.cover,
                    ),
                    fetch_detail_image(
                        &nas_client,
                        &session,
                        &image_cache,
                        &image_request_gate_bg,
                        image_request_id,
                        &detail.background,
                    ),
                )
            } else {
                (None, None)
            };

            let _ = slint::invoke_from_event_loop(move || {
                let Some(ui) = ui_weak_bg.upgrade() else {
                    return;
                };
                if detail_request_generation_bg.load(Ordering::SeqCst) != request_generation
                    || !image_request_gate_bg.is_current(image_request_id)
                    || ui.get_current_view() != "detail"
                    || ui.get_detail_collection_id().as_str() != request_id
                {
                    return;
                }

                ui.set_detail_loading(false);
                match detail_result {
                    Ok(detail) => {
                        *detail_state_bg.lock().unwrap() = Some(detail.clone());
                        apply_collection_detail(&ui, detail, cover_image, background_image);
                    }
                    Err(err) => {
                        *detail_state_bg.lock().unwrap() = None;
                        ui.set_detail_error(err.user_recovery_hint().into());
                        let requires_relogin = err.requires_reauthentication();
                        ui.set_requires_relogin(requires_relogin);
                        record_reauthentication_required(
                            "library.collection_detail",
                            requires_relogin,
                        );
                        ui.set_status_message("影视详情加载失败，请返回片库后重试。".into());
                    }
                }
            });
        });
    }

    fn find_episode(
        detail_state: &Arc<Mutex<Option<CollectionDetail>>>,
        episode_id: &str,
    ) -> Option<Episode> {
        let detail = detail_state.lock().ok()?;
        detail
            .as_ref()?
            .seasons
            .iter()
            .flat_map(|season| season.episodes.iter())
            .find(|episode| episode.selection_id() == episode_id)
            .cloned()
    }

    fn start_playback_load(
        ui_weak: slint::Weak<AppWindow>,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        player: Arc<dyn Player>,
        detail_state: Arc<Mutex<Option<CollectionDetail>>>,
        playback_session: Arc<Mutex<Option<PlaybackSession>>>,
        playback_request_generation: Arc<AtomicU64>,
        collection_id: String,
        classification_id: String,
        episode_id: String,
    ) {
        let operation = diagnostics::start_event("ui", "playback.start");
        let Some(ui) = ui_weak.upgrade() else {
            operation.finish("cancelled", &[]);
            return;
        };
        let Some(episode) = Self::find_episode(&detail_state, &episode_id) else {
            ui.set_playback_loading(false);
            ui.set_playback_error("当前详情没有可播放的 Episode。".into());
            operation.finish(
                "error",
                &[("reason", "episode_not_found".to_string())],
            );
            return;
        };

        let request_generation = playback_request_generation.fetch_add(1, Ordering::SeqCst) + 1;
        *playback_session.lock().unwrap() = None;
        ui.set_playback_loading(true);
        ui.set_playback_error("".into());
        ui.set_playback_track_status("".into());
        ui.set_status_message("正在后台获取媒体流地址...".into());

        let ui_weak_bg = ui_weak.clone();
        let playback_request_generation_bg = Arc::clone(&playback_request_generation);
        std::thread::spawn(move || {
            let playback_result = match nas_client.get_playback_stream(&session, &episode) {
                Ok(stream) => {
                    if playback_request_generation_bg.load(Ordering::SeqCst) != request_generation {
                        return;
                    }

                    match player.load_media(&stream.uri) {
                        Ok(()) => {
                            let state = player.state();
                            if playback_request_generation_bg.load(Ordering::SeqCst)
                                != request_generation
                            {
                                return;
                            }
                            Ok((stream, state))
                        }
                        Err(_) => Err("播放器加载媒体失败，请重试。".to_string()),
                    }
                }
                Err(err) => {
                    record_reauthentication_required(
                        "playback.stream",
                        err.requires_reauthentication(),
                    );
                    Err(format!("播放地址加载失败：{}", err.user_recovery_hint()))
                }
            };

            operation.finish(
                if playback_result.is_ok() { "success" } else { "error" },
                &[
                    ("collection_id", collection_id.clone()),
                    ("classification_id", classification_id.clone()),
                    ("episode_id", episode_id.clone()),
                ],
            );

            if playback_request_generation_bg.load(Ordering::SeqCst) != request_generation {
                return;
            }

            let _ = slint::invoke_from_event_loop(move || {
                let Some(ui) = ui_weak_bg.upgrade() else {
                    return;
                };
                if playback_request_generation_bg.load(Ordering::SeqCst) != request_generation
                    || ui.get_current_view() != "detail"
                    || ui.get_detail_collection_id().as_str() != collection_id
                    || ui.get_selected_episode_id().as_str() != episode_id
                {
                    return;
                }

                ui.set_playback_loading(false);
                match playback_result {
                    Ok((stream, state)) => {
                        let track_status = playback_track_status(&stream);
                        *playback_session.lock().unwrap() = Some(PlaybackSession::new(
                            collection_id,
                            classification_id,
                            episode_id,
                            stream,
                            state,
                        ));
                        ui.set_playback_error("".into());
                        ui.set_playback_track_status(track_status.into());
                        ui.set_current_view("player".into());
                        ui.set_status_message("媒体流已加载，已进入播放器。".into());
                    }
                    Err(error) => {
                        *playback_session.lock().unwrap() = None;
                        ui.set_playback_error(error.into());
                        ui.set_playback_track_status("".into());
                        ui.set_status_message("播放加载失败，请重试。".into());
                    }
                }
            });
        });
    }

    fn select_episode_in_ui(ui: &AppWindow, episode_id: &str) {
        ui.set_selected_episode_id(episode_id.to_string().into());
        let seasons = ui.get_detail_seasons();
        for season_index in 0..seasons.row_count() {
            let Some(season) = seasons.row_data(season_index) else {
                continue;
            };
            let episodes = season.episodes;
            for episode_index in 0..episodes.row_count() {
                if let Some(mut episode) = episodes.row_data(episode_index) {
                    episode.is_selected = episode.episode_id.as_str() == episode_id;
                    episodes.set_row_data(episode_index, episode);
                }
            }
        }
    }

    /// Spawns background threads to asynchronously fetch missing poster images.
    fn spawn_poster_fetching(
        ui_weak: slint::Weak<AppWindow>,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        request_id: u64,
        items: Vec<CollectionItem>,
    ) {
        std::thread::spawn(move || {
            for item in items {
                if !image_request_gate.is_current(request_id) {
                    return;
                }
                if item.cover.is_empty() {
                    continue;
                }

                let cover_path = item.cover.clone();
                let image_result = if let Some(bytes) = image_cache.get(&cover_path) {
                    Ok(bytes)
                } else {
                    nas_client.fetch_image(&session, &cover_path)
                };
                match image_result {
                    Ok(raw_bytes) => {
                        if !image_request_gate.is_current(request_id) {
                            return;
                        }
                        if !image_cache.contains(&cover_path) {
                            image_cache.insert(cover_path.clone(), raw_bytes.clone());
                        }
                        let decoded = match decode_image_pixels(&raw_bytes) {
                            Ok(decoded) => decoded,
                            Err(error) => {
                                warn!("Failed to decode cover image: {}", error);
                                continue;
                            }
                        };

                        let cid = item.collection_id.clone();
                        let ui_weak = ui_weak.clone();
                        let image_request_gate = image_request_gate.clone();

                        let _ = slint::invoke_from_event_loop(move || {
                            if !image_request_gate.is_current(request_id) {
                                return;
                            }
                            if let Some(ui) = ui_weak.upgrade() {
                                let slint_img = slint_image_from_decoded(decoded);
                                if !image_request_gate.is_current(request_id) {
                                    return;
                                }
                                let model = ui.get_collections();
                                for i in 0..model.row_count() {
                                    if let Some(mut row) = model.row_data(i) {
                                        if row.collection_id.as_str() == cid {
                                            row.cover_image = slint_img;
                                            row.has_cover = true;
                                            model.set_row_data(i, row);
                                            break;
                                        }
                                    }
                                }
                            }
                        });
                    }
                    Err(e) => {
                        warn!(
                            "Failed to fetch cover image: {}",
                            sanitize_log_message(&e.to_string())
                        );
                        if e.requires_reauthentication() {
                            let ui_weak = ui_weak.clone();
                            let image_request_gate = image_request_gate.clone();
                            let hint = e.user_recovery_hint();
                            let _ = slint::invoke_from_event_loop(move || {
                                if !image_request_gate.is_current(request_id) {
                                    return;
                                }
                                if let Some(ui) = ui_weak.upgrade() {
                                    ui.set_library_error(hint.into());
                                    ui.set_requires_relogin(true);
                                    record_reauthentication_required(
                                        "library.image",
                                        true,
                                    );
                                }
                            });
                        }
                    }
                }
            }
        });
    }

    /// Sets up library interaction callbacks: classification selection, refresh, collection clicks.
    fn setup_library_callbacks(&self) {
        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        let session = Arc::clone(&self.session);
        let image_cache = self.image_cache.clone();
        let image_request_gate = self.image_request_gate.clone();

        self.ui.on_select_classification(move |class_id_slint| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let target_id = class_id_slint.to_string();

            let cat_model = ui.get_classifications();
            let count = cat_model.row_count();
            let mut target_name = "全部影片".to_string();

            for i in 0..count {
                if let Some(mut item) = cat_model.row_data(i) {
                    let is_sel = item.id.as_str() == target_id;
                    item.is_selected = is_sel;
                    if is_sel {
                        target_name = item.name.to_string();
                    }
                    cat_model.set_row_data(i, item);
                }
            }

            ui.set_selected_classification_id(target_id.clone().into());
            ui.set_selected_classification_name(target_name.into());
            ui.set_library_loading(true);
            ui.set_library_error("".into());
            ui.set_requires_relogin(false);
            let request_id = image_request_gate.begin();

            let client_for_thread = Arc::clone(&nas_client);
            let session_for_thread = Arc::clone(&session);
            let image_cache_for_thread = image_cache.clone();
            let image_request_gate_for_thread = image_request_gate.clone();
            let nas_client_for_posters = Arc::clone(&nas_client);
            let session_for_posters = Arc::clone(&session);
            let ui_weak_bg = ui_weak.clone();
            let operation = diagnostics::start_event("ui", "library.select_classification");
            let selected_id_for_log = target_id.clone();

            std::thread::spawn(move || {
                let res = client_for_thread.get_collections(&session_for_thread, &target_id, 1, 50);
                let result = if res.is_ok() { "success" } else { "error" };
                let item_count = res
                    .as_ref()
                    .map(|page| page.list.len().to_string())
                    .unwrap_or_else(|_| "0".to_string());
                operation.finish(
                    result,
                    &[
                        ("classification_id", selected_id_for_log),
                        ("item_count", item_count),
                    ],
                );

                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = ui_weak_bg.upgrade() else {
                        return;
                    };
                    if !image_request_gate_for_thread.is_current(request_id) {
                        return;
                    }
                    ui.set_library_loading(false);

                    match res {
                        Ok(page) => {
                            let total = page.list.len();
                            ui.set_collection_count(total as i32);

                            let ui_items: Vec<CollectionUiItem> = page
                                .list
                                .iter()
                                .map(|col| CollectionUiItem {
                                    collection_id: col.collection_id.clone().into(),
                                    title: col.title.clone().into(),
                                    release_year: col.release_year.clone().into(),
                                    video_type: col.display_type().to_string().into(),
                                    score: col.display_score().into(),
                                    cover_image: slint::Image::default(),
                                    has_cover: false,
                                })
                                .collect();

                            let model = Rc::new(VecModel::from(ui_items));
                            ui.set_collections(ModelRc::from(model));
                            ui.set_status_message(
                                format!("分类切换完成，加载 {} 部影视作品", total).into(),
                            );
                            AppCoordinator::spawn_poster_fetching(
                                ui.as_weak(),
                                nas_client_for_posters,
                                session_for_posters,
                                image_cache_for_thread.clone(),
                                image_request_gate_for_thread.clone(),
                                request_id,
                                page.list,
                            );
                        }
                        Err(err) => {
                            ui.set_library_error(err.user_recovery_hint().into());
                            let requires_relogin = err.requires_reauthentication();
                            ui.set_requires_relogin(requires_relogin);
                            record_reauthentication_required(
                                "library.select_classification",
                                requires_relogin,
                            );
                        }
                    }
                });
            });
        });

        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        let session = Arc::clone(&self.session);
        let credential_store = Arc::clone(&self.credential_store);
        let startup_restore_pending = Arc::clone(&self.startup_restore_pending);
        let image_cache = self.image_cache.clone();
        let image_request_gate = self.image_request_gate.clone();

        self.ui.on_refresh_library_clicked(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let sel_id = ui.get_selected_classification_id().to_string();
            ui.set_library_loading(true);
            ui.set_library_error("".into());
            ui.set_requires_relogin(false);
            let request_id = image_request_gate.begin();

            let client_for_thread = Arc::clone(&nas_client);
            let session_for_thread = Arc::clone(&session);
            let credential_store_for_thread = Arc::clone(&credential_store);
            let startup_restore_attempt = startup_restore_pending.load(Ordering::SeqCst);
            let image_cache_for_thread = image_cache.clone();
            let image_request_gate_for_thread = image_request_gate.clone();
            let ui_weak_bg = ui_weak.clone();
            let startup_restore_pending_for_thread = Arc::clone(&startup_restore_pending);
            let operation = diagnostics::start_event("ui", "library.refresh");

            std::thread::spawn(move || {
                let cat_res = client_for_thread.get_classifications(&session_for_thread);
                let effective_sel_id = cat_res
                    .as_ref()
                    .ok()
                    .and_then(|cats| {
                        cats.iter()
                            .find(|cat| cat.id == sel_id)
                            .or_else(|| cats.first())
                    })
                    .map(|cat| cat.id.clone())
                    .unwrap_or_default();
                let col_res = match cat_res.as_ref() {
                    Err(_) => Err(NasError::MalformedResponse(
                        "分类列表请求失败，未请求影视列表".to_string(),
                    )),
                    Ok(_) if effective_sel_id.is_empty() => Err(NasError::MalformedResponse(
                        "NAS 未返回可用分类，未请求影视列表".to_string(),
                    )),
                    Ok(_) => client_for_thread.get_collections(
                        &session_for_thread,
                        &effective_sel_id,
                        1,
                        50,
                    ),
                };
                let selected_id_for_ui = effective_sel_id.clone();
                let category_count = cat_res
                    .as_ref()
                    .map(|categories| categories.len())
                    .unwrap_or(0);
                let item_count = col_res
                    .as_ref()
                    .map(|page| page.list.len())
                    .unwrap_or(0);
                let total_count = col_res.as_ref().map(|page| page.count).unwrap_or(0);
                let category_item_count = cat_res
                    .as_ref()
                    .ok()
                    .and_then(|categories| {
                        categories
                            .iter()
                            .find(|category| category.id == effective_sel_id)
                    })
                    .map(|category| category.count.max(0) as usize)
                    .unwrap_or(0);
                let operation_result = if cat_res.is_ok() && col_res.is_ok() {
                    "success"
                } else {
                    "error"
                };
                operation.finish(
                    operation_result,
                    &[
                        ("selected_id", effective_sel_id.clone()),
                        ("category_count", category_count.to_string()),
                        ("category_item_count", category_item_count.to_string()),
                        ("count", total_count.to_string()),
                        ("item_count", item_count.to_string()),
                    ],
                );

                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = ui_weak_bg.upgrade() else {
                        return;
                    };
                    if !image_request_gate_for_thread.is_current(request_id) {
                        return;
                    }
                    startup_restore_pending_for_thread.store(false, Ordering::SeqCst);
                    ui.set_library_loading(false);

                    if let Err(err) = &cat_res {
                        ui.set_library_error(err.user_recovery_hint().into());
                        let requires_relogin = err.requires_reauthentication();
                        if startup_restore_attempt && matches!(err, NasError::Unauthorized) {
                            session_for_thread.clear();
                            let _ = credential_store_for_thread.delete();
                            ui.set_is_logged_in(false);
                            ui.set_current_view("login".into());
                            ui.set_requires_relogin(false);
                            ui.set_login_error_message(
                                "保存的登录凭据已失效，请重新输入凭据登录。".into(),
                            );
                            ui.set_login_status_hint(
                                "已清除失效的保存凭据，请重新输入账号密码登录。".into(),
                            );
                            record_reauthentication_required("library.refresh", true);
                            return;
                        }
                        ui.set_requires_relogin(requires_relogin);
                        record_reauthentication_required(
                            "library.refresh.classifications",
                            requires_relogin,
                        );
                        return;
                    }

                    if let Ok(cats) = cat_res {
                        let ui_cats: Vec<ClassificationUiItem> = cats
                            .iter()
                            .map(|c| ClassificationUiItem {
                                id: c.id.clone().into(),
                                name: c.name.clone().into(),
                                count: c.count as i32,
                                is_selected: c.id == selected_id_for_ui,
                            })
                            .collect();
                        ui.set_classifications(ModelRc::from(Rc::new(VecModel::from(ui_cats))));
                        let selected_name = cats
                            .iter()
                            .find(|cat| cat.id == selected_id_for_ui)
                            .map(|cat| cat.name.clone())
                            .unwrap_or_else(|| "全部".to_string());
                        ui.set_selected_classification_id(selected_id_for_ui.clone().into());
                        ui.set_selected_classification_name(selected_name.into());
                    }

                    match col_res {
                        Ok(page) => {
                            let ui_cols: Vec<CollectionUiItem> = page
                                .list
                                .iter()
                                .map(|c| CollectionUiItem {
                                    collection_id: c.collection_id.clone().into(),
                                    title: c.title.clone().into(),
                                    release_year: c.release_year.clone().into(),
                                    video_type: c.display_type().to_string().into(),
                                    score: c.display_score().into(),
                                    cover_image: slint::Image::default(),
                                    has_cover: false,
                                })
                                .collect();
                            ui.set_collections(ModelRc::from(Rc::new(VecModel::from(ui_cols))));
                            ui.set_collection_count(page.list.len() as i32);
                            ui.set_status_message("片库已刷新完成。".into());
                            AppCoordinator::spawn_poster_fetching(
                                ui.as_weak(),
                                Arc::clone(&client_for_thread),
                                Arc::clone(&session_for_thread),
                                image_cache_for_thread.clone(),
                                image_request_gate_for_thread.clone(),
                                request_id,
                                page.list,
                            );
                            ui.set_requires_relogin(false);
                        }
                        Err(err) => {
                            ui.set_library_error(err.user_recovery_hint().into());
                            let requires_relogin = err.requires_reauthentication();
                            if startup_restore_attempt && matches!(err, NasError::Unauthorized) {
                                session_for_thread.clear();
                                let _ = credential_store_for_thread.delete();
                                ui.set_is_logged_in(false);
                                ui.set_current_view("login".into());
                                ui.set_requires_relogin(false);
                                ui.set_login_error_message(
                                    "保存的登录凭据已失效，请重新输入凭据登录。".into(),
                                );
                                ui.set_login_status_hint(
                                    "已清除失效的保存凭据，请重新输入账号密码登录。".into(),
                                );
                            } else {
                                ui.set_requires_relogin(requires_relogin);
                            }
                            record_reauthentication_required("library.refresh", requires_relogin);
                        }
                    }
                });
            });
        });

        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        let session = Arc::clone(&self.session);
        let image_cache = self.image_cache.clone();
        let detail_state = Arc::clone(&self.detail_state);
        let detail_request_generation = Arc::clone(&self.detail_request_generation);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        let playback_session = Arc::clone(&self.playback_session);
        let image_request_gate = self.image_request_gate.clone();
        self.ui.on_collection_clicked(move |col_id| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let classification_id = ui.get_selected_classification_id().to_string();
            info!("User clicked collection card; opening detail view");
            AppCoordinator::start_collection_detail_load(
                ui_weak.clone(),
                Arc::clone(&nas_client),
                Arc::clone(&session),
                image_cache.clone(),
                image_request_gate.clone(),
                Arc::clone(&detail_state),
                Arc::clone(&detail_request_generation),
                Arc::clone(&playback_request_generation),
                Arc::clone(&playback_session),
                col_id.to_string(),
                classification_id,
            );
        });

        let ui_weak = self.ui.as_weak();
        let detail_state = Arc::clone(&self.detail_state);
        let detail_request_generation = Arc::clone(&self.detail_request_generation);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        let playback_session = Arc::clone(&self.playback_session);
        let image_request_gate = self.image_request_gate.clone();
        let player = Arc::clone(&self.player);
        self.ui.on_switch_view(move |view_name| {
            let Some(ui) = ui_weak.upgrade() else { return };
            info!("Switching workspace view to: {}", view_name);
            if view_name.as_str() != "detail" {
                detail_request_generation.fetch_add(1, Ordering::SeqCst);
                playback_request_generation.fetch_add(1, Ordering::SeqCst);
                image_request_gate.cancel();
                *detail_state.lock().unwrap() = None;
                *playback_session.lock().unwrap() = None;
                ui.set_playback_loading(false);
                ui.set_playback_error("".into());
            }
            if view_name.as_str() != "player" && ui.get_current_view() == "player" {
                let _ = player.stop();
            }
            ui.set_current_view(view_name);
        });

        let ui_weak = self.ui.as_weak();
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        let playback_session = Arc::clone(&self.playback_session);
        let player = Arc::clone(&self.player);
        self.ui.on_return_to_detail_clicked(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            if ui.get_current_view() != "player" {
                return;
            }

            let _ = player.stop();
            playback_request_generation.fetch_add(1, Ordering::SeqCst);
            *playback_session.lock().unwrap() = None;
            ui.set_playback_loading(false);
            ui.set_playback_error("".into());
            ui.set_playback_track_status("".into());
            ui.set_current_view("detail".into());
            ui.set_status_message("已停止播放并返回影视详情。".into());
        });

        let ui_weak = self.ui.as_weak();
        let detail_state = Arc::clone(&self.detail_state);
        let detail_request_generation = Arc::clone(&self.detail_request_generation);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        let playback_session = Arc::clone(&self.playback_session);
        let image_request_gate = self.image_request_gate.clone();
        self.ui.on_detail_back_clicked(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            detail_request_generation.fetch_add(1, Ordering::SeqCst);
            playback_request_generation.fetch_add(1, Ordering::SeqCst);
            image_request_gate.cancel();
            *detail_state.lock().unwrap() = None;
            *playback_session.lock().unwrap() = None;
            ui.set_playback_loading(false);
            ui.set_playback_error("".into());
            ui.set_current_view("library".into());
            ui.set_status_message("已返回片库，保留当前分类和浏览位置。".into());
        });

        let ui_weak = self.ui.as_weak();
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        self.ui.on_episode_selected(move |episode_id| {
            let Some(ui) = ui_weak.upgrade() else { return };
            playback_request_generation.fetch_add(1, Ordering::SeqCst);
            AppCoordinator::select_episode_in_ui(&ui, episode_id.as_str());
            ui.set_playback_loading(false);
            ui.set_playback_error("".into());
            ui.set_status_message("已切换选中剧集，可从详情页播放入口继续。".into());
        });

        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        let session = Arc::clone(&self.session);
        let player = Arc::clone(&self.player);
        let detail_state = Arc::clone(&self.detail_state);
        let playback_session = Arc::clone(&self.playback_session);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        self.ui.on_play_episode_clicked(move |episode_id| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let episode_id = episode_id.to_string();
            let collection_id = ui.get_detail_collection_id().to_string();
            let classification_id = ui.get_selected_classification_id().to_string();
            AppCoordinator::start_playback_load(
                ui_weak.clone(),
                Arc::clone(&nas_client),
                Arc::clone(&session),
                Arc::clone(&player),
                Arc::clone(&detail_state),
                Arc::clone(&playback_session),
                Arc::clone(&playback_request_generation),
                collection_id,
                classification_id,
                episode_id,
            );
        });
    }

    /// Sets up authentication and session management callbacks.
    fn setup_auth_callbacks(&self) {
        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        let session = Arc::clone(&self.session);
        let credential_store = Arc::clone(&self.credential_store);

        self.ui.on_login_requested(
            move |server_url_slint, username_slint, password_slint, _sms_code_slint, remember| {
                let Some(ui) = ui_weak.upgrade() else { return };

                let server_url = server_url_slint.to_string();
                let username = username_slint.to_string();
                let password = password_slint.to_string();

                ui.set_login_loading(true);
                ui.set_login_error_message("".into());
                ui.set_requires_relogin(false);
                ui.set_show_sms_field(false);
                ui.set_mfa_challenge_type("".into());
                ui.set_mfa_code_sent(false);
                ui.set_mfa_status_hint("".into());
                let operation = diagnostics::start_event("ui", "auth.login");

                info!("Initiating LAN NAS authentication for user: {}", username);

                let nas_client = Arc::clone(&nas_client);
                let session = Arc::clone(&session);
                let credential_store = Arc::clone(&credential_store);
                let ui_weak_bg = ui_weak.clone();

                std::thread::spawn(move || {
                    let login_result = nas_client.login(&server_url, &username, &password, None);
                    operation.finish(
                        if login_result.is_ok() { "success" } else { "error" },
                        &[("remember", remember.to_string())],
                    );

                    let _ = slint::invoke_from_event_loop(move || {
                        let Some(ui) = ui_weak_bg.upgrade() else {
                            return;
                        };
                        ui.set_login_loading(false);
                        apply_login_result_to_ui(
                            &ui,
                            &session,
                            credential_store.as_ref(),
                            &server_url,
                            &username,
                            &password,
                            remember,
                            &login_result,
                        );
                        if login_result.is_ok() {
                            ui.invoke_refresh_library_clicked();
                        }
                    });
                });
            },
        );

        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        self.ui.on_send_mfa_code_requested(
            move |server_url_slint, username_slint, challenge_type_slint| {
                let Some(ui) = ui_weak.upgrade() else { return };
                let server_url = server_url_slint.to_string();
                let username = username_slint.to_string();
                let challenge_type = challenge_type_slint.to_string();

                ui.set_mfa_code_sending(true);
                ui.set_mfa_code_sent(false);
                ui.set_login_error_message("".into());
                ui.set_mfa_status_hint("正在发送验证码，请稍候...".into());
                let operation = diagnostics::start_event("ui", "auth.mfa.send_code");

                let nas_client = Arc::clone(&nas_client);
                let ui_weak_bg = ui_weak.clone();
                std::thread::spawn(move || {
                    let challenge_type_for_log = challenge_type.clone();
                    let challenge_type = if challenge_type.trim().is_empty() {
                        None
                    } else {
                        Some(challenge_type.as_str())
                    };
                    let result = nas_client.send_mfa_code(&server_url, &username, challenge_type);
                    operation.finish(
                        if result.is_ok() { "success" } else { "error" },
                        &[("challenge_type", challenge_type_for_log)],
                    );

                    let _ = slint::invoke_from_event_loop(move || {
                        let Some(ui) = ui_weak_bg.upgrade() else {
                            return;
                        };
                        ui.set_mfa_code_sending(false);
                        match result {
                            Ok(()) => {
                                ui.set_mfa_code_sent(true);
                                ui.set_mfa_status_hint(
                                    "验证码已发送，请输入收到的验证码，再点击“验证登录”。".into(),
                                )
                            }
                            Err(error) => {
                                ui.set_mfa_code_sent(false);
                                ui.set_login_error_message(error.user_recovery_hint().into());
                                ui.set_mfa_status_hint("验证码发送失败，请检查网络后重试。".into());
                            }
                        }
                    });
                });
            },
        );

        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        let session = Arc::clone(&self.session);
        let credential_store = Arc::clone(&self.credential_store);
        self.ui.on_verify_mfa_login_requested(
            move |server_url_slint, username_slint, password_slint, code_slint, remember| {
                let Some(ui) = ui_weak.upgrade() else { return };
                let server_url = server_url_slint.to_string();
                let username = username_slint.to_string();
                let password = password_slint.to_string();
                let code = code_slint.to_string();

                if code.trim().is_empty() {
                    ui.set_login_error_message("请输入收到的验证码。".into());
                    ui.set_mfa_status_hint("验证码不能为空。".into());
                    return;
                }

                ui.set_login_loading(true);
                ui.set_mfa_verifying(true);
                ui.set_login_error_message("".into());
                ui.set_mfa_status_hint("正在验证验证码并登录 NAS...".into());
                let operation = diagnostics::start_event("ui", "auth.mfa.login");

                let nas_client = Arc::clone(&nas_client);
                let session = Arc::clone(&session);
                let credential_store = Arc::clone(&credential_store);
                let ui_weak_bg = ui_weak.clone();
                std::thread::spawn(move || {
                    let result = nas_client
                        .verify_mfa_code(&server_url, &username, &code)
                        .and_then(|proof| {
                            nas_client.login(&server_url, &username, &password, Some(&proof))
                        });
                    operation.finish(
                        if result.is_ok() { "success" } else { "error" },
                        &[("remember", remember.to_string())],
                    );

                    let _ = slint::invoke_from_event_loop(move || {
                        let Some(ui) = ui_weak_bg.upgrade() else {
                            return;
                        };
                        ui.set_login_loading(false);
                        ui.set_mfa_verifying(false);
                        apply_login_result_to_ui(
                            &ui,
                            &session,
                            credential_store.as_ref(),
                            &server_url,
                            &username,
                            &password,
                            remember,
                            &result,
                        );
                        if result.is_ok() {
                            ui.invoke_refresh_library_clicked();
                        } else {
                            ui.set_show_sms_field(true);
                            ui.set_mfa_status_hint("验证码验证失败，请检查验证码后重试。".into());
                        }
                    });
                });
            },
        );

        let ui_weak = self.ui.as_weak();
        let session = Arc::clone(&self.session);
        let player = Arc::clone(&self.player);
        let detail_state = Arc::clone(&self.detail_state);
        let detail_request_generation = Arc::clone(&self.detail_request_generation);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        let playback_session = Arc::clone(&self.playback_session);
        let image_request_gate = self.image_request_gate.clone();

        #[cfg(windows)]
        let surface_mutex = Arc::clone(&self.video_surface);

        self.ui.on_logout_requested(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let operation = diagnostics::start_event("ui", "session.logout");
            info!("User requested logout, clearing active session");

            let _ = player.stop();
            session.clear();
            detail_request_generation.fetch_add(1, Ordering::SeqCst);
            playback_request_generation.fetch_add(1, Ordering::SeqCst);
            image_request_gate.cancel();
            *detail_state.lock().unwrap() = None;
            *playback_session.lock().unwrap() = None;

            ui.set_is_logged_in(false);
            ui.set_login_status_hint("已安全退出会话。可重新输入凭据登录。".into());
            ui.set_classifications(ModelRc::new(VecModel::default()));
            ui.set_collections(ModelRc::new(VecModel::default()));
            ui.set_playback_loading(false);
            ui.set_playback_error("".into());
            ui.set_requires_relogin(false);
            ui.set_show_sms_field(false);
            ui.set_mfa_challenge_type("".into());
            ui.set_mfa_code_sent(false);
            ui.set_mfa_code_sending(false);
            ui.set_mfa_verifying(false);
            ui.set_mfa_status_hint("".into());
            ui.set_sms_code_input("".into());

            #[cfg(windows)]
            if let Some(surface) = surface_mutex.lock().unwrap().as_ref() {
                surface.set_bounds(-9999, -9999, 0, 0);
            }

            operation.finish("success", &[]);
        });

        let ui_weak = self.ui.as_weak();
        let session = Arc::clone(&self.session);
        let credential_store = Arc::clone(&self.credential_store);
        let player = Arc::clone(&self.player);
        let detail_state = Arc::clone(&self.detail_state);
        let detail_request_generation = Arc::clone(&self.detail_request_generation);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        let playback_session = Arc::clone(&self.playback_session);
        let image_request_gate = self.image_request_gate.clone();
        self.ui.on_relogin_requested(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            diagnostics::record_event(
                "recovery",
                "session.relogin_requested",
                "complete",
                "success",
                Duration::ZERO,
                &[("reason", "reauthentication_required".to_string())],
            );
            let _ = player.stop();
            session.clear();
            let _ = credential_store.delete();
            detail_request_generation.fetch_add(1, Ordering::SeqCst);
            playback_request_generation.fetch_add(1, Ordering::SeqCst);
            image_request_gate.cancel();
            *detail_state.lock().unwrap() = None;
            *playback_session.lock().unwrap() = None;
            ui.set_is_logged_in(false);
            ui.set_requires_relogin(false);
            ui.set_login_error_message("".into());
            ui.set_login_status_hint("会话已失效，请重新输入凭据登录。".into());
            ui.set_classifications(ModelRc::new(VecModel::default()));
            ui.set_collections(ModelRc::new(VecModel::default()));
            ui.set_playback_loading(false);
            ui.set_playback_error("".into());
            ui.set_show_sms_field(false);
            ui.set_mfa_challenge_type("".into());
            ui.set_mfa_code_sent(false);
            ui.set_mfa_code_sending(false);
            ui.set_mfa_verifying(false);
            ui.set_mfa_status_hint("".into());
            ui.set_sms_code_input("".into());
        });
    }

    fn setup_discovery_callbacks(&self) {
        let ui_weak = self.ui.as_weak();
        let cancellation_slot = Arc::clone(&self.discovery_cancellation);
        self.ui.on_discover_nas_requested(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            if cancellation_slot.lock().unwrap().is_some() {
                return;
            }

            let cancellation = DiscoveryCancellation::new();
            *cancellation_slot.lock().unwrap() = Some(cancellation.clone());
            ui.set_discovery_loading(true);
            ui.set_discovery_error("".into());
            ui.set_discovery_results(ModelRc::new(VecModel::default()));
            ui.set_login_status_hint(
                "正在扫描本机私有局域网，仅验证 NAS 的 5055 端口响应...".into(),
            );

            let ui_weak_bg = ui_weak.clone();
            let cancellation_slot_bg = Arc::clone(&cancellation_slot);
            std::thread::spawn(move || {
                let result = discover_local_nas(DiscoveryConfig::default(), cancellation.clone());
                *cancellation_slot_bg.lock().unwrap() = None;

                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = ui_weak_bg.upgrade() else {
                        return;
                    };
                    ui.set_discovery_loading(false);
                    match result {
                        Ok(report) => {
                            let rows: Vec<NasDiscoveryUiItem> = report
                                .results
                                .iter()
                                .map(discovery_result_to_ui)
                                .collect();
                            let count = rows.len();
                            ui.set_discovery_results(ModelRc::from(Rc::new(VecModel::from(rows))));
                            if count == 0 {
                                let suffix = if report.truncated {
                                    "（网段过大，已达到扫描上限）"
                                } else {
                                    ""
                                };
                                ui.set_discovery_error(
                                    format!(
                                        "未发现可用 NAS{}。可手动输入地址继续登录。",
                                        suffix
                                    )
                                    .into(),
                                );
                                ui.set_login_status_hint(
                                    format!(
                                        "已扫描 {} 个本机局域网地址，未发现 NAS。",
                                        report.candidate_count
                                    )
                                    .into(),
                                );
                            } else {
                                ui.set_discovery_error("".into());
                                ui.set_login_status_hint(
                                    format!("发现 {} 台 NAS，请选择后登录。", count).into(),
                                );
                            }
                        }
                        Err(DiscoveryError::Cancelled) => {
                            ui.set_discovery_error("".into());
                            ui.set_login_status_hint("已取消 NAS 扫描。".into());
                        }
                        Err(error) => {
                            ui.set_discovery_error(error.user_recovery_hint().into());
                            ui.set_login_status_hint(
                                "NAS 自动发现不可用，可手动输入局域网地址。".into(),
                            );
                        }
                    }
                });
            });
        });

        let cancellation_slot = Arc::clone(&self.discovery_cancellation);
        self.ui.on_cancel_discovery_requested(move || {
            if let Some(cancellation) = cancellation_slot.lock().unwrap().as_ref() {
                cancellation.cancel();
            }
        });

        let ui_weak = self.ui.as_weak();
        self.ui.on_select_discovery_result(move |ip_slint| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let ip = ip_slint.to_string();
            match normalize_lan_url(&ip) {
                Ok(base_url) => {
                    ui.set_server_url_input(base_url.into());
                    ui.set_discovery_error("".into());
                    ui.set_login_status_hint(
                        "已填入发现的 NAS 地址，请输入账号密码后登录。".into(),
                    );
                }
                Err(error) => {
                    ui.set_discovery_error(error.user_recovery_hint().into());
                }
            }
        });
    }

    fn setup_player_events(&self) {
        let ui_weak = self.ui.as_weak();
        let playback_session = Arc::clone(&self.playback_session);
        let playback_controls = Arc::clone(&self.playback_controls);
        let nas_client = Arc::clone(&self.nas_client);
        let nas_session = Arc::clone(&self.session);

        self.player.add_event_listener(Box::new(move |event| {
            let ui_weak = ui_weak.clone();
            let playback_session = Arc::clone(&playback_session);
            let playback_controls = Arc::clone(&playback_controls);
            let nas_client = Arc::clone(&nas_client);
            let nas_session = Arc::clone(&nas_session);
            let _ = slint::invoke_from_event_loop(move || {
                if let Some(ui) = ui_weak.upgrade() {
                    match event {
                        PlayerEvent::StateChanged(state) => {
                            if let Some(session) = playback_session.lock().unwrap().as_mut() {
                                session.state = state;
                            }
                            ui.set_playback_status(state.to_string().into());
                            ui.set_is_playing(state == PlaybackState::Playing);
                            diagnostics::record_event(
                                "ui",
                                "playback.state",
                                "complete",
                                "success",
                                Duration::ZERO,
                                &[("media_state", state.to_string())],
                            );
                            match state {
                                PlaybackState::Playing => {
                                    ui.set_status_message(
                                        "正在播放当前媒体... UI 交互保持完全非阻塞".into(),
                                    );
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
                            let progress_update = {
                                let mut session = playback_session.lock().unwrap();
                                session.as_mut().map(|session| {
                                    session.update_progress(prog);
                                    session.progress_update()
                                })
                            };
                            if let Some(progress_update) = progress_update {
                                let nas_client = Arc::clone(&nas_client);
                                let nas_session = Arc::clone(&nas_session);
                                std::thread::spawn(move || {
                                    let sec = progress_update.sec.to_string();
                                    let duration_sec = progress_update.video_duration.to_string();
                                    let result = nas_client
                                        .update_playback_progress(&nas_session, &progress_update);
                                    diagnostics::record_event(
                                        "ui",
                                        "playback.progress",
                                        "complete",
                                        if result.is_ok() { "success" } else { "error" },
                                        Duration::ZERO,
                                        &[("sec", sec), ("duration_sec", duration_sec)],
                                    );
                                    if let Err(error) = result {
                                        record_reauthentication_required(
                                            "playback.progress",
                                            error.requires_reauthentication(),
                                        );
                                        warn!(
                                            "Failed to report playback progress: {}",
                                            sanitize_log_message(&error.to_string())
                                        );
                                    }
                                });
                            }
                            if prog.duration_secs > 0.0 {
                                ui.set_duration_value(prog.duration_secs as f32);
                            }
                            let progress_is_current = {
                                let mut controls = playback_controls.lock().unwrap();
                                controls.finish_seek_from_progress(prog.position_secs)
                                    || controls.accepts_progress_event()
                            };
                            if progress_is_current {
                                ui.set_progress_value(prog.position_secs as f32);
                                ui.set_time_label(prog.formatted_time().into());
                            }
                        }
                        PlayerEvent::MediaLoaded {
                            path,
                            duration_secs,
                        } => {
                            playback_controls.lock().unwrap().cancel_seek();
                            ui.set_media_path(path.into());
                            ui.set_duration_value(duration_secs as f32);
                            diagnostics::record_event(
                                "ui",
                                "playback.media_loaded",
                                "complete",
                                "success",
                                Duration::ZERO,
                                &[("duration_sec", duration_secs.to_string())],
                            );
                            ui.set_status_message("媒体已成功载入并在原生窗口渲染。".into());
                        }
                        PlayerEvent::PlaybackFinished => {
                            playback_controls.lock().unwrap().cancel_seek();
                            diagnostics::record_event(
                                "ui",
                                "playback.finished",
                                "complete",
                                "success",
                                Duration::ZERO,
                                &[],
                            );
                            ui.set_status_message("视频播放完毕。".into());
                        }
                        PlayerEvent::Error(err) => {
                            diagnostics::record_event(
                                "ui",
                                "playback.player_error",
                                "complete",
                                "error",
                                Duration::ZERO,
                                &[("reason", "player_error".to_string())],
                            );
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

        let controls = Arc::clone(&self.playback_controls);
        let ui_weak = self.ui.as_weak();
        self.ui.on_fullscreen_clicked(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let is_fullscreen = controls.lock().unwrap().toggle_fullscreen();
            ui.window().set_fullscreen(is_fullscreen);
            ui.set_status_message(
                if is_fullscreen {
                    "已进入全屏模式。视频表面和控制层会随窗口尺寸更新。"
                } else {
                    "已退出全屏模式。"
                }
                .into(),
            );
        });

        let controls = Arc::clone(&self.playback_controls);
        let ui_weak = self.ui.as_weak();
        self.ui.on_seek_preview(move |target| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let duration = ui.get_duration_value() as f64;
            let mut controls = controls.lock().unwrap();
            controls.preview_seek(target as f64, duration);
            let target = controls.seek_target_secs().unwrap_or(0.0);
            drop(controls);
            ui.set_progress_value(target as f32);
            ui.set_time_label(
                PlaybackProgress::new(target, duration)
                    .formatted_time()
                    .into(),
            );
        });

        let player = Arc::clone(&self.player);
        let controls = Arc::clone(&self.playback_controls);
        let ui_weak = self.ui.as_weak();
        self.ui.on_seek_relative(move |offset| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let cur = ui.get_progress_value() as f64;
            let duration = ui.get_duration_value() as f64;
            let target = (cur + offset as f64).max(0.0);
            info!("UI: seek relative by {}, target: {}", offset, target);
            let target = request_seek(&player, &controls, ui_weak.clone(), target, duration);
            ui.set_progress_value(target as f32);
            ui.set_time_label(
                PlaybackProgress::new(target, duration)
                    .formatted_time()
                    .into(),
            );
        });

        let player = Arc::clone(&self.player);
        let controls = Arc::clone(&self.playback_controls);
        let ui_weak = self.ui.as_weak();
        self.ui.on_seek_absolute(move |target| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let duration = ui.get_duration_value() as f64;
            info!("UI: seek absolute to {}", target);
            request_seek(&player, &controls, ui_weak.clone(), target as f64, duration);
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
                    let current_view = ui.get_current_view();
                    let scale = ui.window().scale_factor();
                    let area_x = (ui.get_video_area_x() * scale) as i32;
                    let area_y = (ui.get_video_area_y() * scale) as i32;
                    let area_w = (ui.get_video_area_width() * scale) as i32;
                    let area_h = (ui.get_video_area_height() * scale) as i32;

                    if is_logged_in && current_view == "player" {
                        if !surface_initialized && area_w > 10 && area_h > 10 {
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
                            if let Some(surface) = surface_mutex.lock().unwrap().as_ref() {
                                surface.set_bounds(area_x, area_y, area_w, area_h);
                            }
                        }
                    } else if surface_initialized {
                        if let Some(surface) = surface_mutex.lock().unwrap().as_ref() {
                            surface.set_bounds(-9999, -9999, 0, 0);
                        }
                    }
                }
            },
        );
    }
}

fn fetch_detail_image(
    nas_client: &Arc<dyn NasClient>,
    session: &Arc<NasSession>,
    image_cache: &ImageCache,
    image_request_gate: &ImageRequestGate,
    request_id: u64,
    image_path: &str,
) -> Option<DecodedImage> {
    if image_path.is_empty() || !image_request_gate.is_current(request_id) {
        return None;
    }
    let bytes = match image_cache.get(image_path) {
        Some(bytes) => bytes,
        None => match nas_client.fetch_image(session, image_path) {
            Ok(bytes) => {
                if !image_request_gate.is_current(request_id) {
                    return None;
                }
                image_cache.insert(image_path.to_string(), bytes.clone());
                bytes
            }
            Err(err) => {
                warn!(
                    "Failed to fetch detail image: {}",
                    sanitize_log_message(&err.to_string())
                );
                return None;
            }
        },
    };
    if !image_request_gate.is_current(request_id) {
        return None;
    }
    match decode_image_pixels(&bytes) {
        Ok(decoded) => Some(decoded),
        Err(err) => {
            warn!("Failed to decode detail image: {}", err);
            None
        }
    }
}

fn request_seek(
    player: &Arc<dyn Player>,
    controls: &Arc<Mutex<PlaybackControlState>>,
    ui_weak: slint::Weak<AppWindow>,
    position_secs: f64,
    duration_secs: f64,
) -> f64 {
    let (generation, target) = {
        let mut controls = controls.lock().unwrap();
        let generation = controls.preview_seek(position_secs, duration_secs);
        let target = controls.seek_target_secs().unwrap_or(0.0);
        (generation, target)
    };

    let player = Arc::clone(player);
    let controls = Arc::clone(controls);
    std::thread::spawn(move || {
        let seek_result = player.seek(target);
        let _ = slint::invoke_from_event_loop(move || match seek_result {
            Ok(()) => {
                let controls = Arc::clone(&controls);
                // The target ProgressChanged normally ends the guard. This fixed
                // timer is only a fallback for engines that never report it.
                slint::Timer::single_shot(Duration::from_millis(150), move || {
                    controls.lock().unwrap().finish_seek(generation);
                });
            }
            Err(error) => {
                // Only the current generation may clear the guard or report an error.
                if controls.lock().unwrap().finish_seek(generation) {
                    if let Some(ui) = ui_weak.upgrade() {
                        ui.set_status_message(format!("seek error: {}", error).into());
                    }
                }
            }
        });
    });

    target
}

fn apply_collection_detail(
    ui: &AppWindow,
    detail: CollectionDetail,
    cover_image: Option<DecodedImage>,
    background_image: Option<DecodedImage>,
) {
    let display_type = detail.display_type().to_string();
    let is_movie = detail.is_movie();
    ui.set_detail_title(detail.title.clone().into());
    ui.set_detail_release_year(detail.release_year.clone().into());
    ui.set_detail_video_type(display_type.into());
    ui.set_detail_score(detail.display_score().into());
    ui.set_detail_storyline(detail.storyline.clone().unwrap_or_default().into());
    ui.set_detail_is_movie(is_movie);

    if let Some(decoded) = cover_image {
        ui.set_detail_cover_image(slint_image_from_decoded(decoded));
        ui.set_detail_has_cover(true);
    }
    if let Some(decoded) = background_image {
        ui.set_detail_background_image(slint_image_from_decoded(decoded));
        ui.set_detail_has_background(true);
    }

    let first_episode_id = detail
        .seasons
        .iter()
        .flat_map(|season| season.episodes.iter())
        .map(|episode| episode.selection_id().to_string())
        .find(|episode_id| !episode_id.is_empty())
        .unwrap_or_default();

    let ui_seasons: Vec<SeasonUiItem> = detail
        .seasons
        .iter()
        .map(|season| {
            let episodes: Vec<EpisodeUiItem> = season
                .episodes
                .iter()
                .map(|episode| EpisodeUiItem {
                    episode_id: episode.selection_id().to_string().into(),
                    episode_number: episode.episode_number as i32,
                    title: episode.title.clone().into(),
                    duration: episode.duration.clone().unwrap_or_default().into(),
                    is_selected: episode.selection_id() == first_episode_id,
                })
                .collect();

            SeasonUiItem {
                season_number: season.season_number as i32,
                title: season.title.clone().into(),
                episodes: ModelRc::from(Rc::new(VecModel::from(episodes))),
            }
        })
        .collect();

    ui.set_detail_seasons(ModelRc::from(Rc::new(VecModel::from(ui_seasons))));
    ui.set_selected_episode_id(first_episode_id.into());
    ui.set_status_message("影视详情已加载，可选择剧集。".into());
}

fn playback_track_status(stream: &PlaybackStream) -> String {
    let audio_count = stream.audio_tracks.len();
    let subtitle_count = stream.subtitle_tracks.len();
    if audio_count > 1 || subtitle_count > 1 {
        format!(
            "服务端提供 {} 条音轨、{} 条字幕；轨道切换暂未支持。",
            audio_count, subtitle_count
        )
    } else if audio_count > 0 || subtitle_count > 0 {
        "已保留服务端音轨/字幕信息；轨道切换暂未支持。".to_string()
    } else {
        "服务端未提供音轨/字幕列表；未猜测切换能力。".to_string()
    }
}

fn apply_login_result_to_ui(
    ui: &AppWindow,
    session: &NasSession,
    credential_store: &dyn CredentialStore,
    server_url: &str,
    username: &str,
    password: &str,
    remember: bool,
    result: &Result<crate::nas::auth::LoginResponseData, AuthError>,
) {
    match result {
        Ok(data) => {
            info!("NAS authentication successful for user: {}", username);

            let normalized_base_url = normalized_session_base_url(server_url);
            session.set_base_url(normalized_base_url.clone());
            session.set_authenticated_with_identity(
                data.token.clone(),
                username.to_string(),
                data.qcname.clone(),
                data.nas_name.clone(),
                data.nas_id.clone(),
                data.nas_sign.clone(),
            );

            if remember {
                let creds = SavedCredentials {
                    server_url: server_url.to_string(),
                    username: username.to_string(),
                    password: Some(password.to_string()),
                    token: Some(data.token.clone()),
                    nas_id: data.nas_id.clone(),
                    nas_sign: data.nas_sign.clone(),
                };
                if let Err(e) = credential_store.save(&creds) {
                    warn!("Failed to persist credentials to secure storage: {}", e);
                }
            } else {
                let _ = credential_store.delete();
            }

            let nas_display_name = data
                .nas_name
                .clone()
                .unwrap_or_else(|| "极空间 NAS".to_string());
            ui.set_session_user(username.into());
            ui.set_session_nas_name(nas_display_name.into());
            ui.set_session_base_url(normalized_base_url.into());
            ui.set_show_sms_field(false);
            ui.set_mfa_challenge_type("".into());
            ui.set_mfa_code_sent(false);
            ui.set_mfa_status_hint("".into());
            ui.set_sms_code_input("".into());
            ui.set_login_error_message("".into());
            ui.set_is_logged_in(true);
            ui.set_current_view("library".into());
            ui.set_status_message("局域网鉴权成功，正在拉取极影视片库...".into());
        }
        Err(err) => {
            warn!(
                "NAS login error: {}",
                sanitize_log_message(&err.to_string())
            );
            let recovery_hint = err.user_recovery_hint();
            ui.set_login_error_message(recovery_hint.into());
            ui.set_requires_relogin(false);

            if let AuthError::MfaRequired { code, .. } = err {
                let is_new_device = code == "N001414";
                ui.set_show_sms_field(true);
                ui.set_mfa_challenge_type(if is_new_device {
                    "new_device".into()
                } else {
                    "".into()
                });
                ui.set_mfa_code_sent(false);
                ui.set_mfa_status_hint(if is_new_device {
                    "检测到新设备，请先发送验证码，再输入验证码验证登录。".into()
                } else {
                    "检测到安全验证，请先发送验证码，再输入验证码验证登录。".into()
                });
                ui.set_login_status_hint("安全两步验证已开启，请按下方步骤完成登录。".into());
            }
        }
    }
}

fn normalized_session_base_url(input: &str) -> String {
    match normalize_lan_url(input) {
        Ok(url) => url,
        Err(error) => {
            // Real login implementations validate this first; keep a mock or
            // future client from turning a successful result into a panic.
            warn!("Successful login returned an invalid base URL: {}", error);
            input.trim().trim_end_matches('/').to_string()
        }
    }
}

fn discovery_result_to_ui(result: &NasDiscoveryResult) -> NasDiscoveryUiItem {
    NasDiscoveryUiItem {
        ip: result.ip.to_string().into(),
        name: result
            .name
            .clone()
            .unwrap_or_else(|| "未命名 NAS".to_string())
            .into(),
        availability: if result.available {
            "可用（5055 已响应）".into()
        } else {
            "不可用".into()
        },
        available: result.available,
    }
}

fn record_reauthentication_required(operation: &str, required: bool) {
    if required {
        diagnostics::record_event(
            "recovery",
            "session.reauthentication_required",
            "complete",
            "required",
            Duration::ZERO,
            &[("reason", operation.to_string())],
        );
    }
}

fn default_image_cache_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);
    base.join("z-video").join("image-cache")
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
