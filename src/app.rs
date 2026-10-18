use log::{error, info, warn};
use raw_window_handle::HasWindowHandle;
use slint::{ComponentHandle, Model, ModelRc, VecModel};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::media::image_cache::{
    decode_image_pixels, slint_image_from_decoded, DecodedImage, ImageCache, ImageRequestGate,
};
use crate::nas::auth::sanitize_log_message;
use crate::nas::auth::AuthError;
use crate::nas::client::{normalize_lan_url, HttpNasClient, NasClient};
use crate::nas::models::{CollectionDetail, CollectionItem, Episode, NasError};
use crate::nas::session::NasSession;
#[cfg(windows)]
use crate::platform::Win32VideoSurface;
use crate::playback::{PlaybackSession, PlaybackStream};
use crate::player::state::{
    PlaybackControlState, PlaybackProgress, PlaybackState, PlayerError, PlayerEvent,
};
use crate::player::traits::Player;
use crate::storage::credentials::{CredentialStore, KeyringCredentialStore, SavedCredentials};

slint::include_modules!();

pub struct AppCoordinator {
    ui: AppWindow,
    player: Arc<dyn Player>,
    nas_client: Arc<dyn NasClient>,
    session: Arc<NasSession>,
    credential_store: Arc<dyn CredentialStore>,
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
        let image_cache =
            ImageCache::with_disk_cache(default_image_cache_dir(), 100, 64 * 1024 * 1024);
        let detail_state = Arc::new(Mutex::new(None));

        let coordinator = Self {
            ui,
            player,
            nas_client,
            session,
            credential_store,
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

        coordinator.autoload_credentials();
        coordinator.setup_auth_callbacks();
        coordinator.setup_library_callbacks();
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
        sms_proof: Option<&str>,
        remember: bool,
    ) -> Result<crate::nas::auth::LoginResponseData, AuthError> {
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

        res
    }

    /// Logs out from the active session, stopping playback and returning to login view.
    pub fn perform_logout(&self) {
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

                let normalized_base_url = normalized_session_base_url(server_url);
                self.session.set_base_url(normalized_base_url.clone());
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

                let nas_display_name = data
                    .nas_name
                    .clone()
                    .unwrap_or_else(|| "极空间 NAS".to_string());
                self.ui.set_session_user(username.into());
                self.ui.set_session_nas_name(nas_display_name.into());
                self.ui.set_session_base_url(normalized_base_url.into());
                self.ui.set_show_sms_field(false);
                self.ui.set_login_error_message("".into());
                self.ui.set_is_logged_in(true);
                self.ui.set_current_view("library".into());
                self.ui
                    .set_status_message("局域网鉴权成功，正在拉取极影视片库...".into());
            }
            Err(err) => {
                warn!(
                    "NAS login error: {}",
                    sanitize_log_message(&err.to_string())
                );
                let recovery_hint = err.user_recovery_hint();
                self.ui.set_login_error_message(recovery_hint.into());
                self.ui.set_requires_relogin(false);

                if let AuthError::MfaRequired { .. } = err {
                    self.ui.set_show_sms_field(true);
                    self.ui.set_login_status_hint(
                        "安全两步验证：请输入极空间验证码后点击登录。".into(),
                    );
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
                self.ui.set_login_status_hint(
                    "已从系统安全凭证库载入账号信息。点击登录直连 NAS。".into(),
                );
            }
            Ok(None) => {
                info!("No previous credentials stored in keyring");
            }
            Err(e) => {
                warn!("Could not read credentials from secure storage: {}", e);
            }
        }
    }

    /// Synchronously loads classifications from the NAS client into UI state.
    pub fn load_classifications_sync(&self) -> Result<(), NasError> {
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
                    self.load_collections_sync(&first_id)?;
                } else {
                    self.ui.set_library_loading(false);
                }
                Ok(())
            }
            Err(err) => {
                self.ui.set_library_loading(false);
                self.ui.set_library_error(err.user_recovery_hint().into());
                self.ui
                    .set_requires_relogin(err.requires_reauthentication());
                Err(err)
            }
        }
    }

    /// Synchronously loads collections for a specific classification into UI state.
    pub fn load_collections_sync(&self, classification_id: &str) -> Result<(), NasError> {
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

                Ok(())
            }
            Err(err) => {
                self.ui.set_library_error(err.user_recovery_hint().into());
                self.ui
                    .set_requires_relogin(err.requires_reauthentication());
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
                        ui.set_requires_relogin(err.requires_reauthentication());
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
        let Some(ui) = ui_weak.upgrade() else { return };
        let Some(episode) = Self::find_episode(&detail_state, &episode_id) else {
            ui.set_playback_loading(false);
            ui.set_playback_error("当前详情没有可播放的 Episode。".into());
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
                Err(err) => Err(format!("播放地址加载失败：{}", err.user_recovery_hint())),
            };

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

            std::thread::spawn(move || {
                let res = client_for_thread.get_collections(&session_for_thread, &target_id, 1, 50);

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
                            ui.set_requires_relogin(err.requires_reauthentication());
                        }
                    }
                });
            });
        });

        let ui_weak = self.ui.as_weak();
        let nas_client = Arc::clone(&self.nas_client);
        let session = Arc::clone(&self.session);
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
            let image_cache_for_thread = image_cache.clone();
            let image_request_gate_for_thread = image_request_gate.clone();
            let ui_weak_bg = ui_weak.clone();

            std::thread::spawn(move || {
                let cat_res = client_for_thread.get_classifications(&session_for_thread);
                let col_res = if !sel_id.is_empty() {
                    client_for_thread.get_collections(&session_for_thread, &sel_id, 1, 50)
                } else {
                    Ok(crate::nas::models::CollectionPage::default())
                };

                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = ui_weak_bg.upgrade() else {
                        return;
                    };
                    if !image_request_gate_for_thread.is_current(request_id) {
                        return;
                    }
                    ui.set_library_loading(false);

                    if let Ok(cats) = cat_res {
                        let ui_cats: Vec<ClassificationUiItem> = cats
                            .iter()
                            .map(|c| ClassificationUiItem {
                                id: c.id.clone().into(),
                                name: c.name.clone().into(),
                                count: c.count as i32,
                                is_selected: c.id == sel_id,
                            })
                            .collect();
                        ui.set_classifications(ModelRc::from(Rc::new(VecModel::from(ui_cats))));
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
                            ui.set_requires_relogin(err.requires_reauthentication());
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
            move |server_url_slint, username_slint, password_slint, sms_code_slint, remember| {
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
                ui.set_requires_relogin(false);

                info!("Initiating LAN NAS authentication for user: {}", username);

                let nas_client = Arc::clone(&nas_client);
                let session = Arc::clone(&session);
                let credential_store = Arc::clone(&credential_store);
                let ui_weak_bg = ui_weak.clone();

                std::thread::spawn(move || {
                    let login_result =
                        nas_client.login(&server_url, &username, &password, sms_proof.as_deref());

                    let _ = slint::invoke_from_event_loop(move || {
                        let Some(ui) = ui_weak_bg.upgrade() else {
                            return;
                        };
                        ui.set_login_loading(false);

                        match login_result {
                            Ok(data) => {
                                info!("NAS authentication successful for user: {}", username);

                                let normalized_base_url = normalized_session_base_url(&server_url);
                                session.set_base_url(normalized_base_url.clone());
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
                                        warn!(
                                            "Failed to persist credentials to secure storage: {}",
                                            e
                                        );
                                    }
                                } else {
                                    let _ = credential_store.delete();
                                }

                                let nas_display_name =
                                    data.nas_name.unwrap_or_else(|| "极空间 NAS".to_string());
                                ui.set_session_user(username.into());
                                ui.set_session_nas_name(nas_display_name.into());
                                ui.set_session_base_url(normalized_base_url.into());
                                ui.set_show_sms_field(false);
                                ui.set_login_error_message("".into());
                                ui.set_requires_relogin(false);
                                ui.set_is_logged_in(true);
                                ui.set_current_view("library".into());
                                ui.set_status_message(
                                    "局域网鉴权成功，正在拉取极影视片库...".into(),
                                );

                                ui.invoke_refresh_library_clicked();
                            }
                            Err(err) => {
                                warn!(
                                    "NAS login error: {}",
                                    sanitize_log_message(&err.to_string())
                                );
                                let recovery_hint = err.user_recovery_hint();
                                ui.set_login_error_message(recovery_hint.into());
                                ui.set_requires_relogin(false);

                                if let AuthError::MfaRequired { .. } = err {
                                    ui.set_show_sms_field(true);
                                    ui.set_login_status_hint(
                                        "安全两步验证：请输入极空间验证码后点击登录。".into(),
                                    );
                                }
                            }
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

            #[cfg(windows)]
            if let Some(surface) = surface_mutex.lock().unwrap().as_ref() {
                surface.set_bounds(-9999, -9999, 0, 0);
            }
        });

        let ui_weak = self.ui.as_weak();
        let session = Arc::clone(&self.session);
        let player = Arc::clone(&self.player);
        let detail_state = Arc::clone(&self.detail_state);
        let detail_request_generation = Arc::clone(&self.detail_request_generation);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        let playback_session = Arc::clone(&self.playback_session);
        let image_request_gate = self.image_request_gate.clone();
        self.ui.on_relogin_requested(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let _ = player.stop();
            session.clear();
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
                                    if let Err(error) = nas_client
                                        .update_playback_progress(&nas_session, &progress_update)
                                    {
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
                            ui.set_status_message("媒体已成功载入并在原生窗口渲染。".into());
                        }
                        PlayerEvent::PlaybackFinished => {
                            playback_controls.lock().unwrap().cancel_seek();
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
            match request_seek(&player, &controls, target, duration) {
                Ok(target) => {
                    ui.set_progress_value(target as f32);
                    ui.set_time_label(
                        PlaybackProgress::new(target, duration)
                            .formatted_time()
                            .into(),
                    );
                }
                Err(e) => {
                    warn!("seek error: {}", e);
                }
            }
        });

        let player = Arc::clone(&self.player);
        let controls = Arc::clone(&self.playback_controls);
        let ui_weak = self.ui.as_weak();
        self.ui.on_seek_absolute(move |target| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let duration = ui.get_duration_value() as f64;
            info!("UI: seek absolute to {}", target);
            if let Err(e) = request_seek(&player, &controls, target as f64, duration) {
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
    position_secs: f64,
    duration_secs: f64,
) -> Result<f64, PlayerError> {
    let (generation, target) = {
        let mut controls = controls.lock().unwrap();
        let generation = controls.preview_seek(position_secs, duration_secs);
        let target = controls.seek_target_secs().unwrap_or(0.0);
        (generation, target)
    };

    match player.seek(target) {
        Ok(()) => {
            let controls = Arc::clone(controls);
            // The target ProgressChanged normally ends the guard. This fixed
            // timer is only a fallback for engines that never report it.
            slint::Timer::single_shot(Duration::from_millis(150), move || {
                controls.lock().unwrap().finish_seek(generation);
            });
            Ok(target)
        }
        Err(err) => {
            controls.lock().unwrap().finish_seek(generation);
            Err(err)
        }
    }
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
