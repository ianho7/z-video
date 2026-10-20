use log::{error, info, warn};
use raw_window_handle::HasWindowHandle;
use slint::{ComponentHandle, Model, ModelRc, VecModel};
use std::cmp::Ordering as SortOrdering;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::continue_watching::build_continue_watching_item;
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
use crate::nas::models::{
    CollectionDetail, CollectionItem, CollectionPage, Episode, NasError, PlaybackHistory,
};
use crate::nas::session::{NasDeviceMetadata, NasSession};
#[cfg(windows)]
use crate::platform::{apply_native_backdrop, NativeBackdropOutcome, Win32VideoSurface};
use crate::playback::{PlaybackProgressUpdate, PlaybackSession, PlaybackStream};
use crate::player::state::{PlaybackControlState, PlaybackProgress, PlaybackState, PlayerEvent};
use crate::player::traits::Player;
use crate::storage::credentials::{
    CredentialStore, KeyringCredentialStore, LastPlaybackContext, SavedCredentials,
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
    continue_watching_image_request_gate: ImageRequestGate,
    last_poster_range: Arc<Mutex<PosterRangeRequestState>>,
    loaded_collections: Arc<Mutex<Vec<CollectionItem>>>,
    browse_context: Arc<Mutex<BrowseContext>>,
    browse_restore_notice: Arc<Mutex<Option<String>>>,
    search_generation: Arc<AtomicU64>,
    detail_state: Arc<Mutex<Option<CollectionDetail>>>,
    detail_request_generation: Arc<AtomicU64>,
    playback_request_generation: Arc<AtomicU64>,
    playback_session: Arc<Mutex<Option<PlaybackSession>>>,
    pending_progress_requests: Arc<AtomicUsize>,
    progress_report_gate: Arc<Mutex<ProgressReportGate>>,
    pending_resume: Arc<Mutex<Option<PendingResume>>>,
    startup_last_playback: Arc<Mutex<Option<LastPlaybackContext>>>,
    continue_watching_generation: Arc<AtomicU64>,
    playback_controls: Arc<Mutex<PlaybackControlState>>,
    #[cfg(windows)]
    video_surface: Arc<Mutex<Option<Win32VideoSurface>>>,
    timer: slint::Timer,
}

const NORMAL_PROGRESS_REPORT_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Default)]
struct ProgressReportGate {
    last_report_at: Option<Instant>,
}

#[derive(Clone, Copy)]
struct PendingResume {
    request_generation: u64,
    position_secs: f64,
}

const SEARCH_DEBOUNCE: Duration = Duration::from_millis(180);

fn environment_flag_enabled(name: &str) -> bool {
    environment_flag_value_enabled(std::env::var(name).ok().as_deref())
}

fn environment_flag_value_enabled(value: Option<&str>) -> bool {
    matches!(value, Some("1" | "true" | "yes" | "on"))
}

fn shell_transparency_disabled() -> bool {
    environment_flag_enabled("Z_VIDEO_REDUCED_TRANSPARENCY")
        || environment_flag_enabled("Z_VIDEO_HIGH_CONTRAST")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NativeBackdropMode {
    Disabled,
    Requested,
    BlockedByTransparency,
}

fn native_backdrop_mode(native_requested: bool, transparency_disabled: bool) -> NativeBackdropMode {
    if !native_requested {
        NativeBackdropMode::Disabled
    } else if transparency_disabled {
        NativeBackdropMode::BlockedByTransparency
    } else {
        NativeBackdropMode::Requested
    }
}

fn native_backdrop_requested() -> bool {
    environment_flag_enabled("Z_VIDEO_NATIVE_BACKDROP")
}

#[cfg(windows)]
fn try_get_window_hwnd(window: &slint::Window) -> Option<isize> {
    let window_handle = window.window_handle();
    let handle = window_handle.window_handle().ok()?;
    match handle.as_raw() {
        raw_window_handle::RawWindowHandle::Win32(win32_handle) => {
            Some(win32_handle.hwnd.get() as isize)
        }
        _ => None,
    }
}

#[cfg(windows)]
fn record_native_backdrop_event(result: &str, fallback: bool, handle_present: bool, reason: &str) {
    diagnostics::record_event(
        "ui",
        "native_backdrop",
        "complete",
        result,
        Duration::ZERO,
        &[
            ("backend", "dwm".to_string()),
            ("fallback", fallback.to_string()),
            ("handle_present", handle_present.to_string()),
            ("reason", reason.to_string()),
        ],
    );
}

const MEDIA_TYPE_ALL: &str = "all";
const MEDIA_TYPE_MOVIE: &str = "movie";
const MEDIA_TYPE_TV: &str = "tv";
const SORT_DEFAULT: &str = "default";
const SORT_TITLE_ASC: &str = "title_asc";
const SORT_SCORE_DESC: &str = "score_desc";
const SORT_RELEASE_YEAR_DESC: &str = "release_year_desc";
const COLLECTION_PAGE_SIZE: usize = 50;

const POSTER_GRID_GAP: f32 = 14.0;
const POSTER_METADATA_HEIGHT: f32 = 48.0;
const POSTER_FRAME_RATIO: f32 = 1.5;
const POSTER_PREFETCH_ROWS: usize = 1;
const POSTER_INITIAL_WINDOW: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PosterLoadRange {
    start: usize,
    end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PosterRangeSource {
    Fallback,
    Layout,
}

#[derive(Debug, Default)]
struct PosterRangeRequestState {
    last: Option<(PosterLoadRange, PosterRangeSource)>,
}

impl PosterRangeRequestState {
    fn reset(&mut self) {
        self.last = None;
    }

    fn should_request(&mut self, range: PosterLoadRange, layout_ready: bool) -> bool {
        let source = if layout_ready {
            PosterRangeSource::Layout
        } else {
            PosterRangeSource::Fallback
        };
        if self.last == Some((range, source)) {
            return false;
        }
        self.last = Some((range, source));
        true
    }

    fn begin_if_needed(
        &mut self,
        image_request_gate: &ImageRequestGate,
        range: PosterLoadRange,
        layout_ready: bool,
    ) -> Option<u64> {
        self.should_request(range, layout_ready)
            .then(|| image_request_gate.begin())
    }
}

#[derive(Debug, Clone)]
struct PosterFetchItem {
    item: CollectionItem,
    collection_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct BrowseContext {
    classification_id: String,
    query: String,
    media_type: String,
    sort_order: String,
    page: usize,
    scroll_offset: f32,
    focused_collection_id: String,
    focused_collection_index: Option<usize>,
}

/// Returns the loaded model slice that can affect the current viewport.
///
/// The grid is still backed by the known loaded Collection model, but image
/// work is bounded to the visible rows plus one row on either side. When the
/// native window has not laid out yet, the first bounded window is used so a
/// full loaded page is never treated as a visible range.
fn visible_poster_range(
    total: usize,
    columns: usize,
    scroll_offset: f32,
    viewport_height: f32,
    grid_top: f32,
    card_width: f32,
) -> PosterLoadRange {
    if total == 0 {
        return PosterLoadRange { start: 0, end: 0 };
    }

    if columns == 0 || viewport_height <= 0.0 || card_width <= 0.0 {
        return PosterLoadRange {
            start: 0,
            end: total.min(POSTER_INITIAL_WINDOW),
        };
    }

    let row_height = card_width * POSTER_FRAME_RATIO + POSTER_METADATA_HEIGHT + POSTER_GRID_GAP;
    if !row_height.is_finite() || row_height <= 0.0 {
        return PosterLoadRange {
            start: 0,
            end: total.min(POSTER_INITIAL_WINDOW),
        };
    }

    let total_rows = (total + columns - 1) / columns;
    let top = scroll_offset.max(0.0);
    let content_top = grid_top.max(0.0);
    let first_visible_row = ((top - content_top).max(0.0) / row_height).floor() as usize;
    let bottom = top + viewport_height;
    let last_visible_row_exclusive = (((bottom - content_top).max(0.0) / row_height).ceil()
        as usize)
        .max(first_visible_row + 1);

    let first_row = first_visible_row
        .saturating_sub(POSTER_PREFETCH_ROWS)
        .min(total_rows);
    let last_row = last_visible_row_exclusive
        .saturating_add(POSTER_PREFETCH_ROWS)
        .min(total_rows);
    let start = (first_row * columns).min(total);
    let end = (last_row * columns).min(total).max(start);

    PosterLoadRange { start, end }
}

fn collection_ui_items(items: &[CollectionItem]) -> Vec<CollectionUiItem> {
    items
        .iter()
        .map(|item| CollectionUiItem {
            collection_id: item.collection_id.clone().into(),
            title: item.title.clone().into(),
            release_year: item.release_year.clone().into(),
            video_type: item.display_type().to_string().into(),
            score: item.display_score().into(),
            cover_image: slint::Image::default(),
            has_cover: false,
            cover_status: if item.cover.is_empty() {
                "missing".into()
            } else {
                "loading".into()
            },
        })
        .collect()
}

fn collection_matches_query(item: &CollectionItem, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }

    [
        item.title.as_str(),
        item.video_type.as_str(),
        item.display_type(),
        item.release_year.as_str(),
        item.score.as_deref().unwrap_or_default(),
        item.rating.as_deref().unwrap_or_default(),
        item.storyline.as_deref().unwrap_or_default(),
    ]
    .iter()
    .any(|value| value.to_lowercase().contains(&query))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CollectionQueryError {
    UnsupportedMediaType,
    UnsupportedSortOrder,
}

impl CollectionQueryError {
    fn user_message(self) -> &'static str {
        match self {
            Self::UnsupportedMediaType => {
                "该类型筛选没有已确认的数据契约；当前只支持全部、电影和剧集。"
            }
            Self::UnsupportedSortOrder => {
                "该排序方式没有已确认的数据字段；当前只支持默认、片名、评分和上映年份。"
            }
        }
    }
}

fn media_type_matches(item: &CollectionItem, media_type: &str) -> Result<bool, CollectionQueryError> {
    let normalized = item.video_type.trim().to_ascii_lowercase();
    match media_type {
        MEDIA_TYPE_ALL => Ok(true),
        MEDIA_TYPE_MOVIE => Ok(matches!(
            normalized.as_str(),
            "movie" | "film" | "100" | "电影"
        )),
        MEDIA_TYPE_TV => Ok(matches!(
            normalized.as_str(),
            "tv" | "series" | "电视剧" | "剧集"
        )),
        _ => Err(CollectionQueryError::UnsupportedMediaType),
    }
}

fn score_value(item: &CollectionItem) -> Option<f32> {
    item.display_score().trim().parse::<f32>().ok()
}

fn release_year_value(item: &CollectionItem) -> Option<i32> {
    item.release_year.trim().parse::<i32>().ok()
}

fn compare_text(left: &CollectionItem, right: &CollectionItem) -> SortOrdering {
    left.title
        .to_lowercase()
        .cmp(&right.title.to_lowercase())
        .then_with(|| left.collection_id.cmp(&right.collection_id))
}

fn compare_optional_number<T: PartialOrd>(
    left: Option<T>,
    right: Option<T>,
    descending: bool,
) -> SortOrdering {
    match (left, right) {
        (Some(left), Some(right)) => {
            let ordering = left.partial_cmp(&right).unwrap_or(SortOrdering::Equal);
            if descending {
                ordering.reverse()
            } else {
                ordering
            }
        }
        (Some(_), None) => SortOrdering::Less,
        (None, Some(_)) => SortOrdering::Greater,
        (None, None) => SortOrdering::Equal,
    }
}

fn apply_collection_query(
    items: &[CollectionItem],
    query: &str,
    media_type: &str,
    sort_order: &str,
) -> Result<Vec<CollectionItem>, CollectionQueryError> {
    if !matches!(media_type, MEDIA_TYPE_ALL | MEDIA_TYPE_MOVIE | MEDIA_TYPE_TV) {
        return Err(CollectionQueryError::UnsupportedMediaType);
    }
    if !matches!(
        sort_order,
        SORT_DEFAULT | SORT_TITLE_ASC | SORT_SCORE_DESC | SORT_RELEASE_YEAR_DESC
    ) {
        return Err(CollectionQueryError::UnsupportedSortOrder);
    }

    let mut matches: Vec<CollectionItem> = items
        .iter()
        .filter(|item| collection_matches_query(item, query))
        .filter(|item| media_type_matches(item, media_type).unwrap_or(false))
        .cloned()
        .collect();

    match sort_order {
        SORT_DEFAULT => {}
        SORT_TITLE_ASC => matches.sort_by(compare_text),
        SORT_SCORE_DESC => matches.sort_by(|left, right| {
            compare_optional_number(score_value(left), score_value(right), true)
                .then_with(|| compare_text(left, right))
        }),
        SORT_RELEASE_YEAR_DESC => matches.sort_by(|left, right| {
            compare_optional_number(release_year_value(left), release_year_value(right), true)
            .then_with(|| compare_text(left, right))
        }),
        _ => unreachable!("sort order validated above"),
    }

    Ok(matches)
}

fn media_type_label(media_type: &str) -> &'static str {
    match media_type {
        MEDIA_TYPE_ALL => "全部类型",
        MEDIA_TYPE_MOVIE => "电影",
        MEDIA_TYPE_TV => "剧集",
        _ => "未知类型",
    }
}

fn sort_order_label(sort_order: &str) -> &'static str {
    match sort_order {
        SORT_DEFAULT => "默认顺序",
        SORT_TITLE_ASC => "片名 A-Z",
        SORT_SCORE_DESC => "评分高到低",
        SORT_RELEASE_YEAR_DESC => "上映年份新到旧",
        _ => "未知排序",
    }
}

fn collection_page_count(total_count: usize, page_size: usize) -> usize {
    if total_count == 0 || page_size == 0 {
        0
    } else {
        (total_count + page_size - 1) / page_size
    }
}

fn collection_page_start(page: usize, page_size: usize) -> usize {
    page.max(1)
        .saturating_sub(1)
        .saturating_mul(page_size)
        .saturating_add(1)
}

fn collection_page_scope(
    page: usize,
    total_pages: usize,
    loaded_count: usize,
    result_count: usize,
    total_count: usize,
    query: &str,
    media_type: &str,
    sort_order: &str,
) -> String {
    let page_label = format!("第 {} 页 / 共 {} 页", page.max(1), total_pages);
    if query.trim().is_empty() && media_type == MEDIA_TYPE_ALL && sort_order == SORT_DEFAULT {
        return format!(
            "{} · 当前已加载范围：本页 {} 部 / 共 {} 部",
            page_label, loaded_count, total_count
        );
    }

    format!(
        "{} · 仅当前页 {} 部 · 类型：{} · 排序：{} · 匹配 {} 部",
        page_label,
        loaded_count,
        media_type_label(media_type),
        sort_order_label(sort_order),
        result_count,
    )
}

fn remember_browse_context(
    browse_context: &Arc<Mutex<BrowseContext>>,
    ui: &AppWindow,
    scroll_offset: Option<f32>,
    focused_collection_id: Option<&str>,
) {
    let mut context = browse_context.lock().unwrap();
    context.classification_id = ui.get_selected_classification_id().to_string();
    context.query = ui.get_apple_search_input().to_string();
    context.media_type = ui.get_media_type_filter().to_string();
    context.sort_order = ui.get_sort_order().to_string();
    context.page = ui.get_library_page().max(1) as usize;
    if let Some(scroll_offset) = scroll_offset {
        context.scroll_offset = scroll_offset.max(0.0);
    }
    if let Some(collection_id) = focused_collection_id {
        context.focused_collection_id = collection_id.to_string();
        context.focused_collection_index = (0..ui.get_collections().row_count()).find(|index| {
            ui.get_collections()
                .row_data(*index)
                .is_some_and(|item| item.collection_id.as_str() == collection_id)
        });
    }
}

fn reset_browse_context(browse_context: &Arc<Mutex<BrowseContext>>, ui: &AppWindow) {
    let mut context = browse_context.lock().unwrap();
    context.classification_id = ui.get_selected_classification_id().to_string();
    context.query.clear();
    context.media_type = MEDIA_TYPE_ALL.to_string();
    context.sort_order = SORT_DEFAULT.to_string();
    context.page = 1;
    context.scroll_offset = 0.0;
    context.focused_collection_id.clear();
    context.focused_collection_index = None;
}

fn initial_poster_range_for_ui(ui: &AppWindow) -> PosterLoadRange {
    visible_poster_range(
        ui.get_collections().row_count(),
        0,
        0.0,
        0.0,
        0.0,
        0.0,
    )
}

fn current_library_layout_for_ui(ui: &AppWindow) -> Option<(f32, f32, f32, f32, usize)> {
    if ui.get_current_view() != "library" {
        return None;
    }
    let viewport_height = ui.get_library_viewport_height();
    let grid_top = ui.get_library_grid_top();
    let card_width = ui.get_library_card_width();
    let columns = ui.get_library_columns();
    if viewport_height <= 0.0 || card_width <= 0.0 || columns <= 0 {
        return None;
    }

    Some((
        ui.get_library_layout_scroll_offset().max(0.0),
        viewport_height,
        grid_top,
        card_width,
        columns as usize,
    ))
}

fn poster_items_for_range(
    ui: &AppWindow,
    source_items: &[CollectionItem],
    range: PosterLoadRange,
) -> Vec<PosterFetchItem> {
    let model = ui.get_collections();
    let mut items = Vec::new();

    for index in range.start..range.end.min(model.row_count()) {
        let Some(row) = model.row_data(index) else {
            continue;
        };
        if row.cover_status == "ready" || row.cover_status == "missing" {
            continue;
        }

        let Some(item) = source_items
            .iter()
            .find(|item| item.collection_id == row.collection_id.as_str())
        else {
            continue;
        };
        if item.cover.is_empty() {
            continue;
        }
        items.push(item.clone());
    }

    group_poster_items(items)
}

fn group_poster_items(items: Vec<CollectionItem>) -> Vec<PosterFetchItem> {
    let mut groups: Vec<PosterFetchItem> = Vec::new();
    let mut cover_to_group = HashMap::<String, usize>::new();

    for item in items {
        let cover_path = item.cover.clone();
        if let Some(group_index) = cover_to_group.get(&cover_path).copied() {
            groups[group_index].collection_ids.push(item.collection_id);
        } else {
            cover_to_group.insert(cover_path, groups.len());
            groups.push(PosterFetchItem {
                collection_ids: vec![item.collection_id.clone()],
                item,
            });
        }
    }

    groups
}

fn set_cover_status(ui: &AppWindow, collection_id: &str, status: &str) {
    let model = ui.get_collections();
    for index in 0..model.row_count() {
        let Some(mut row) = model.row_data(index) else {
            continue;
        };
        if row.collection_id.as_str() == collection_id {
            row.cover_status = status.into();
            row.has_cover = status == "ready";
            model.set_row_data(index, row);
            break;
        }
    }
}

impl ProgressReportGate {
    fn reset(&mut self) {
        self.last_report_at = None;
    }

    fn should_report(&mut self, sec: u64, force: bool) -> bool {
        if sec <= 1 {
            return false;
        }
        if force
            || self
                .last_report_at
                .map(|last| last.elapsed() >= NORMAL_PROGRESS_REPORT_INTERVAL)
                .unwrap_or(true)
        {
            self.last_report_at = Some(Instant::now());
            true
        } else {
            false
        }
    }
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
        ui.set_reduced_transparency(shell_transparency_disabled());

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
        let loaded_collections = Arc::new(Mutex::new(Vec::new()));
        let browse_context = Arc::new(Mutex::new(BrowseContext::default()));
        let browse_restore_notice = Arc::new(Mutex::new(None));
        let search_generation = Arc::new(AtomicU64::new(0));
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
            continue_watching_image_request_gate: ImageRequestGate::new(),
            last_poster_range: Arc::new(Mutex::new(PosterRangeRequestState::default())),
            loaded_collections,
            browse_context,
            browse_restore_notice,
            search_generation,
            detail_state,
            detail_request_generation: Arc::new(AtomicU64::new(0)),
            playback_request_generation: Arc::new(AtomicU64::new(0)),
            playback_session: Arc::new(Mutex::new(None)),
            pending_progress_requests: Arc::new(AtomicUsize::new(0)),
            progress_report_gate: Arc::new(Mutex::new(ProgressReportGate::default())),
            pending_resume: Arc::new(Mutex::new(None)),
            startup_last_playback: Arc::new(Mutex::new(None)),
            continue_watching_generation: Arc::new(AtomicU64::new(0)),
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
        self.continue_watching_image_request_gate.cancel();
        self.continue_watching_generation
            .fetch_add(1, Ordering::SeqCst);
        *self.startup_last_playback.lock().unwrap() = None;
        self.search_generation.fetch_add(1, Ordering::SeqCst);
        self.loaded_collections.lock().unwrap().clear();
        *self.detail_state.lock().unwrap() = None;
        *self.playback_session.lock().unwrap() = None;

        self.ui.set_is_logged_in(false);
        self.ui
            .set_login_status_hint("已安全退出会话。可重新输入凭据登录。".into());
        self.ui
            .set_classifications(ModelRc::new(VecModel::default()));
        self.ui.set_collections(ModelRc::new(VecModel::default()));
        Self::clear_continue_watching(&self.ui);
        self.ui.set_collection_count(0);
        self.ui.set_library_total_count(0);
        self.ui.set_library_total_pages(0);
        self.ui.set_library_page(1);
        self.ui.set_library_page_size(COLLECTION_PAGE_SIZE as i32);
        self.ui.set_apple_search_input("".into());
        self.ui.set_media_type_filter(MEDIA_TYPE_ALL.into());
        self.ui.set_sort_order(SORT_DEFAULT.into());
        self.ui.set_search_active(false);
        self.ui.set_search_loading(false);
        self.ui.set_search_error("".into());
        self.ui.set_search_scope("当前已加载范围：0 部".into());
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
        let result = self.ui.run();
        wait_for_progress_flush(&self.pending_progress_requests);
        diagnostics::flush();
        result
    }

    /// Automatically restores saved credentials from secure storage on launch if present.
    fn autoload_credentials(&self) {
        let operation = diagnostics::start_event("session", "session.restore");
        match self.credential_store.load() {
            Ok(Some(creds)) => {
                let last_playback_present = creds.last_playback.is_some();
                info!(
                    "Auto-loaded saved credentials for user: {} (last_playback_context_present={})",
                    creds.username, last_playback_present
                );
                *self.startup_last_playback.lock().unwrap() = creds.last_playback.clone();
                diagnostics::record_event(
                    "session",
                    "session.restore_context",
                    "complete",
                    if last_playback_present { "success" } else { "skipped" },
                    Duration::ZERO,
                    &[("last_playback_present", last_playback_present.to_string())],
                );
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
                self.session
                    .set_device_metadata(NasDeviceMetadata::client_defaults());
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
        self.search_generation.fetch_add(1, Ordering::SeqCst);
        self.loaded_collections.lock().unwrap().clear();
        self.ui.set_apple_search_input("".into());
        self.ui.set_media_type_filter(MEDIA_TYPE_ALL.into());
        self.ui.set_sort_order(SORT_DEFAULT.into());
        self.ui.set_search_active(false);
        self.ui.set_search_loading(false);
        self.ui.set_search_error("".into());
        self.ui.set_search_scope("当前已加载范围：0 部".into());
        self.ui.set_collection_count(0);
        self.ui.set_library_total_count(0);
        self.ui.set_library_total_pages(0);
        self.ui.set_library_page(1);
        self.ui.set_library_page_size(COLLECTION_PAGE_SIZE as i32);
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
                    record_request_not_sent(
                        "library.collections",
                        "no_valid_classification_id",
                    );
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
        self.last_poster_range.lock().unwrap().reset();
        self.continue_watching_image_request_gate.cancel();
        self.continue_watching_generation
            .fetch_add(1, Ordering::SeqCst);
        Self::clear_continue_watching(&self.ui);
        self.search_generation.fetch_add(1, Ordering::SeqCst);
        self.loaded_collections.lock().unwrap().clear();
        self.ui.set_apple_search_input("".into());
        self.ui.set_media_type_filter(MEDIA_TYPE_ALL.into());
        self.ui.set_sort_order(SORT_DEFAULT.into());
        self.ui.set_search_active(false);
        self.ui.set_search_loading(false);
        self.ui.set_search_error("".into());
        self.ui.set_search_scope("当前已加载范围：0 部".into());
        self.ui.set_collection_count(0);
        self.ui.set_library_total_count(0);
        self.ui.set_library_total_pages(0);
        self.ui.set_library_page(1);
        self.ui.set_library_page_size(COLLECTION_PAGE_SIZE as i32);
        self.ui.set_collections(ModelRc::new(VecModel::default()));
        self.ui.set_library_loading(true);
        self.ui.set_library_error("".into());
        self.ui.set_requires_relogin(false);

        let res = self
            .nas_client
            .get_collections(
                &self.session,
                classification_id,
                collection_page_start(1, COLLECTION_PAGE_SIZE),
                COLLECTION_PAGE_SIZE,
            );
        self.ui.set_library_loading(false);

        match res {
            Ok(page) => {
                if !self.image_request_gate.is_current(request_id) {
                    return Ok(());
                }
                let count = page.list.len();
                let total_count = page.count.max(count);
                *self.loaded_collections.lock().unwrap() = page.list.clone();
                self.ui.set_collection_count(count as i32);
                Self::set_library_page_state(&self.ui, 1, total_count);
                self.ui
                    .set_search_scope(
                        collection_page_scope(
                            1,
                            self.ui.get_library_total_pages().max(0) as usize,
                            count,
                            count,
                            total_count,
                            "",
                            MEDIA_TYPE_ALL,
                            SORT_DEFAULT,
                        )
                        .into(),
                    );

                let ui_items = collection_ui_items(&page.list);

                let model = Rc::new(VecModel::from(ui_items));
                self.ui.set_collections(ModelRc::from(model));
                self.ui
                    .set_status_message(format!("片库已就绪，已加载 {} 部影片", count).into());

                Self::start_continue_watching_load(
                    self.ui.as_weak(),
                    Arc::clone(&self.nas_client),
                    Arc::clone(&self.session),
                    self.image_cache.clone(),
                    self.continue_watching_image_request_gate.clone(),
                    Arc::clone(&self.continue_watching_generation),
                    self.startup_last_playback.lock().unwrap().clone(),
                    classification_id.to_string(),
                );

                // Trigger background poster fetching only for the current
                // viewport and a bounded row-sized prefetch window.
                Self::request_poster_range_for_current_layout(
                    &self.ui,
                    Arc::clone(&self.nas_client),
                    Arc::clone(&self.session),
                    self.image_cache.clone(),
                    self.image_request_gate.clone(),
                    request_id,
                    &page.list,
                    &self.last_poster_range,
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

    fn set_library_page_state(
        ui: &AppWindow,
        requested_page: usize,
        total_count: usize,
    ) -> usize {
        let total_pages = collection_page_count(total_count, COLLECTION_PAGE_SIZE);
        let page = if total_pages == 0 {
            1
        } else {
            requested_page.max(1).min(total_pages)
        };
        ui.set_library_page(page as i32);
        ui.set_library_total_pages(total_pages as i32);
        ui.set_library_total_count(total_count as i32);
        ui.set_library_page_size(COLLECTION_PAGE_SIZE as i32);
        page
    }

    fn apply_collection_page_to_ui(
        ui: &AppWindow,
        page: CollectionPage,
        requested_page: usize,
        loaded_collections: &Arc<Mutex<Vec<CollectionItem>>>,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        request_id: u64,
        last_poster_range: &Arc<Mutex<PosterRangeRequestState>>,
    ) {
        let page_items = page.list;
        let total_count = page.count.max(page_items.len());
        let effective_page = Self::set_library_page_state(ui, requested_page, total_count);
        *loaded_collections.lock().unwrap() = page_items.clone();

        let query = ui.get_apple_search_input().to_string();
        let media_type = ui.get_media_type_filter().to_string();
        let sort_order = ui.get_sort_order().to_string();
        match apply_collection_query(&page_items, &query, &media_type, &sort_order) {
            Ok(matches) => {
                let result_count = matches.len();
                ui.set_collections(ModelRc::from(Rc::new(VecModel::from(
                    collection_ui_items(&matches),
                ))));
                ui.set_collection_count(result_count as i32);
                ui.set_search_active(
                    !query.trim().is_empty()
                        || media_type != MEDIA_TYPE_ALL
                        || sort_order != SORT_DEFAULT,
                );
                ui.set_search_loading(false);
                ui.set_library_loading(false);
                ui.set_search_error("".into());
                ui.set_search_scope(
                    collection_page_scope(
                        effective_page,
                        ui.get_library_total_pages().max(0) as usize,
                        page_items.len(),
                        result_count,
                        total_count,
                        &query,
                        &media_type,
                        &sort_order,
                    )
                    .into(),
                );
                AppCoordinator::request_poster_range_for_current_layout(
                    ui,
                    nas_client,
                    session,
                    image_cache,
                    image_request_gate,
                    request_id,
                    &matches,
                    last_poster_range,
                );
            }
            Err(error) => {
                ui.set_collections(ModelRc::from(Rc::new(VecModel::default())));
                ui.set_collection_count(0);
                ui.set_search_active(true);
                ui.set_search_loading(false);
                ui.set_library_loading(false);
                ui.set_search_error(error.user_message().into());
                ui.set_search_scope(
                    collection_page_scope(
                        effective_page,
                        ui.get_library_total_pages().max(0) as usize,
                        page_items.len(),
                        0,
                        total_count,
                        &query,
                        &media_type,
                        &sort_order,
                    )
                    .into(),
                );
            }
        }
    }

    fn start_library_page_load(
        ui_weak: slint::Weak<AppWindow>,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        loaded_collections: Arc<Mutex<Vec<CollectionItem>>>,
        search_generation: Arc<AtomicU64>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        last_poster_range: Arc<Mutex<PosterRangeRequestState>>,
        classification_id: String,
        requested_page: usize,
    ) {
        let mut page = requested_page.max(1);
        search_generation.fetch_add(1, Ordering::SeqCst);
        let request_id = image_request_gate.begin();
        last_poster_range.lock().unwrap().reset();
        loaded_collections.lock().unwrap().clear();

        if let Some(ui) = ui_weak.upgrade() {
            let current_total_pages = ui.get_library_total_pages().max(0) as usize;
            if current_total_pages > 0 {
                page = page.min(current_total_pages);
            }
            ui.set_library_page(page as i32);
            ui.set_library_loading(true);
            ui.set_search_loading(false);
            ui.set_library_error("".into());
            ui.set_search_error("".into());
            ui.set_collections(ModelRc::from(Rc::new(VecModel::default())));
            ui.set_collection_count(0);
            ui.set_library_scroll_offset(0.0);
            ui.set_library_restore_scroll_offset(0.0);
            ui.set_library_focus_collection_id("".into());
        }

        if classification_id.trim().is_empty() {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_library_loading(false);
                ui.set_library_error("没有可用的片库分类，未请求影视列表。".into());
            }
            return;
        }

        let start = collection_page_start(page, COLLECTION_PAGE_SIZE);
        let operation = diagnostics::start_event("ui", "library.page");
        let ui_weak_bg = ui_weak.clone();
        let nas_client_for_posters = Arc::clone(&nas_client);
        let session_for_posters = Arc::clone(&session);
        let image_cache_for_posters = image_cache.clone();
        let image_request_gate_for_posters = image_request_gate.clone();
        let last_poster_range_for_posters = Arc::clone(&last_poster_range);
        std::thread::spawn(move || {
            let result = nas_client.get_collections(
                &session,
                &classification_id,
                start,
                COLLECTION_PAGE_SIZE,
            );
            let item_count = result
                .as_ref()
                .map(|page| page.list.len().to_string())
                .unwrap_or_else(|_| "0".to_string());
            operation.finish(
                if result.is_ok() { "success" } else { "error" },
                &[
                    ("classification_id", classification_id.clone()),
                    ("page", page.to_string()),
                    ("start", start.to_string()),
                    ("limit", COLLECTION_PAGE_SIZE.to_string()),
                    ("item_count", item_count),
                ],
            );

            let _ = slint::invoke_from_event_loop(move || {
                let Some(ui) = ui_weak_bg.upgrade() else {
                    return;
                };
                if !image_request_gate_for_posters.is_current(request_id) {
                    return;
                }
                match result {
                    Ok(page_data) => {
                        AppCoordinator::apply_collection_page_to_ui(
                            &ui,
                            page_data,
                            page,
                            &loaded_collections,
                            nas_client_for_posters,
                            session_for_posters,
                            image_cache_for_posters,
                            image_request_gate_for_posters,
                            request_id,
                            &last_poster_range_for_posters,
                        );
                        ui.set_status_message(format!("已切换到第 {} 页。", page).into());
                    }
                    Err(error) => {
                        ui.set_library_loading(false);
                        ui.set_library_total_count(0);
                        ui.set_library_total_pages(0);
                        ui.set_search_scope("当前页加载失败".into());
                        ui.set_library_error(error.user_recovery_hint().into());
                        ui.set_requires_relogin(error.requires_reauthentication());
                    }
                }
            });
        });
    }

    fn clear_continue_watching(ui: &AppWindow) {
        ui.set_continue_watching_items(ModelRc::from(Rc::new(VecModel::default())));
        ui.set_continue_watching_loading(false);
        ui.set_continue_watching_error("".into());
    }

    fn start_continue_watching_load(
        ui_weak: slint::Weak<AppWindow>,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        continue_watching_generation: Arc<AtomicU64>,
        context: Option<LastPlaybackContext>,
        classification_id: String,
    ) {
        let image_request_id = image_request_gate.begin();
        let request_generation = continue_watching_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let Some(context) = context.filter(|context| {
            context.collection_id.trim() != ""
                && context.classification_id.trim() == classification_id.trim()
                && context.episode_id.trim() != ""
        }) else {
            if let Some(ui) = ui_weak.upgrade() {
                Self::clear_continue_watching(&ui);
            }
            return;
        };

        if let Some(ui) = ui_weak.upgrade() {
            ui.set_continue_watching_items(ModelRc::from(Rc::new(VecModel::default())));
            ui.set_continue_watching_loading(true);
            ui.set_continue_watching_error("".into());
        }

        let ui_weak_bg = ui_weak.clone();
        let generation_bg = Arc::clone(&continue_watching_generation);
        let collection_id = context.collection_id.clone();
        let classification_id_bg = classification_id.clone();
        std::thread::spawn(move || {
            let detail_result =
                nas_client.get_collection_detail(&session, &collection_id, &classification_id_bg);
            let (item, cover_image) = match &detail_result {
                Ok(detail) => {
                    let item = build_continue_watching_item(&context, detail);
                    let cover_image = item.as_ref().and_then(|item| {
                        fetch_detail_image(
                            &nas_client,
                            &session,
                            &image_cache,
                            &image_request_gate,
                            image_request_id,
                            &item.cover,
                        )
                    });
                    (item, cover_image)
                }
                Err(_) => (None, None),
            };
            let _ = slint::invoke_from_event_loop(move || {
                let Some(ui) = ui_weak_bg.upgrade() else {
                    return;
                };
                if generation_bg.load(Ordering::SeqCst) != request_generation
                    || !image_request_gate.is_current(image_request_id)
                    || (!ui.get_selected_classification_id().is_empty()
                        && ui.get_selected_classification_id().as_str() != classification_id_bg)
                {
                    return;
                }

                ui.set_continue_watching_loading(false);
                match detail_result {
                    Ok(_) => {
                        if let Some(item) = item {
                            let has_cover = cover_image.is_some();
                            let ui_item = ContinueWatchingUiItem {
                                collection_id: item.collection_id.into(),
                                episode_id: item.episode_id.into(),
                                title: item.title.into(),
                                episode_title: item.episode_title.into(),
                                progress_label: item.progress_label.into(),
                                duration_label: item.duration_label.into(),
                                progress_percent: item
                                    .progress_percent
                                    .map(|percent| percent as i32)
                                    .unwrap_or(-1),
                                cover_image: cover_image
                                    .map(slint_image_from_decoded)
                                    .unwrap_or_default(),
                                has_cover,
                            };
                            ui.set_continue_watching_items(ModelRc::from(Rc::new(VecModel::from(
                                vec![ui_item],
                            ))));
                        } else {
                            ui.set_continue_watching_items(ModelRc::from(Rc::new(
                                VecModel::default(),
                            )));
                        }
                        ui.set_continue_watching_error("".into());
                    }
                    Err(err) => {
                        ui.set_continue_watching_items(ModelRc::from(Rc::new(VecModel::default())));
                        ui.set_continue_watching_error("继续观看加载失败，请点击重试。".into());
                        ui.set_requires_relogin(err.requires_reauthentication());
                        record_reauthentication_required(
                            "library.continue_watching",
                            err.requires_reauthentication(),
                        );
                    }
                }
            });
        });
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
        preferred_episode_id: Option<String>,
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
                        apply_collection_detail(
                            &ui,
                            detail,
                            cover_image,
                            background_image,
                            preferred_episode_id.as_deref(),
                        );
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
            .find(|episode| Self::episode_matches_identifier(episode, episode_id))
            .cloned()
    }

    fn episode_matches_identifier(episode: &Episode, identifier: &str) -> bool {
        let identifier = identifier.trim();
        !identifier.is_empty()
            && [
                episode.selection_id(),
                episode.video_id.as_str(),
                episode.version_id.as_str(),
                episode.file_path.as_str(),
            ]
            .iter()
            .any(|candidate| !candidate.is_empty() && *candidate == identifier)
    }

    fn history_matches_episode(history: &PlaybackHistory, episode: &Episode) -> bool {
        let Some(last_video_id) = history.last_video_id.as_deref() else {
            return true;
        };

        Self::episode_matches_identifier(episode, last_video_id)
    }

    fn find_resume_history(
        detail_state: &Arc<Mutex<Option<CollectionDetail>>>,
        episode: &Episode,
    ) -> Option<PlaybackHistory> {
        let detail = detail_state.lock().ok()?;
        let history = detail.as_ref()?.history.clone()?;
        if Self::history_matches_episode(&history, episode) {
            return Some(history);
        }

        // A movie detail normally contains exactly one playable item. Some NAS
        // versions return a history video id from a different identifier field
        // than the detail item, so an ID mismatch is safe to fall back only for
        // an unambiguous single-episode detail, never for a multi-episode show.
        let episode_count = detail
            .as_ref()
            .map(|detail| {
                detail
                    .seasons
                    .iter()
                    .map(|season| season.episodes.len())
                    .sum::<usize>()
            })
            .unwrap_or_default();
        (episode_count == 1).then_some(history)
    }

    fn start_playback_load(
        ui_weak: slint::Weak<AppWindow>,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        credential_store: Arc<dyn CredentialStore>,
        startup_last_playback: Arc<Mutex<Option<LastPlaybackContext>>>,
        player: Arc<dyn Player>,
        detail_state: Arc<Mutex<Option<CollectionDetail>>>,
        playback_session: Arc<Mutex<Option<PlaybackSession>>>,
        playback_request_generation: Arc<AtomicU64>,
        pending_resume: Arc<Mutex<Option<PendingResume>>>,
        collection_id: String,
        classification_id: String,
        episode_id: String,
    ) {
        let operation = diagnostics::start_event("ui", "playback.start");
        let Some(ui) = ui_weak.upgrade() else {
            operation.finish("cancelled", &[]);
            return;
        };
        let request_generation = playback_request_generation.fetch_add(1, Ordering::SeqCst) + 1;
        *pending_resume.lock().unwrap() = None;

        let Some(episode) = Self::find_episode(&detail_state, &episode_id) else {
            ui.set_playback_loading(false);
            ui.set_playback_error("当前详情没有可播放的 Episode。".into());
            record_request_not_sent("playback.stream", "episode_not_found");
            operation.finish(
                "error",
                &[("reason", "episode_not_found".to_string())],
            );
            return;
        };
        let resume_history = Self::find_resume_history(&detail_state, &episode);
        let resume_position = resume_history
            .as_ref()
            .and_then(|history| history.play_duration)
            .filter(|seconds| *seconds > 0)
            .unwrap_or_default() as f64;
        let history_present = detail_state
            .lock()
            .ok()
            .and_then(|detail| detail.as_ref().map(|detail| detail.history.is_some()))
            .unwrap_or(false);
        info!(
            "Playback resume lookup: history_present={}, matched={}, position_sec={}",
            history_present,
            resume_history.is_some(),
            resume_position.round()
        );
        diagnostics::record_event(
            "ui",
            "playback.resume_lookup",
            "complete",
            if resume_history.is_some() { "success" } else { "skipped" },
            Duration::ZERO,
            &[
                ("history_present", history_present.to_string()),
                ("history_matched", resume_history.is_some().to_string()),
                ("sec", resume_position.round().to_string()),
            ],
        );
        if resume_position > 0.0 {
            *pending_resume.lock().unwrap() = Some(PendingResume {
                request_generation,
                position_secs: resume_position,
            });
        }
        *playback_session.lock().unwrap() = None;
        ui.set_playback_loading(true);
        ui.set_playback_error("".into());
        ui.set_playback_track_status("".into());
        ui.set_status_message("正在后台获取媒体流地址...".into());

        let ui_weak_bg = ui_weak.clone();
        let playback_request_generation_bg = Arc::clone(&playback_request_generation);
        let pending_resume_bg = Arc::clone(&pending_resume);
        let startup_last_playback_bg = Arc::clone(&startup_last_playback);
        std::thread::spawn(move || {
            let playback_result = match nas_client.get_playback_stream(&session, &episode) {
                Ok(stream) => {
                    if playback_request_generation_bg.load(Ordering::SeqCst) != request_generation {
                        return;
                    }

                    match player.load_media(&stream.uri) {
                        Ok(()) => {
                            *startup_last_playback_bg.lock().unwrap() = Some(LastPlaybackContext {
                                collection_id: collection_id.clone(),
                                classification_id: classification_id.clone(),
                                episode_id: episode_id.clone(),
                            });
                            persist_last_playback_context(
                                credential_store.as_ref(),
                                &collection_id,
                                &classification_id,
                                &episode_id,
                            );
                            let state = player.state();
                            if playback_request_generation_bg.load(Ordering::SeqCst)
                                != request_generation
                            {
                                return;
                            }
                            Ok((stream, state, resume_history))
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

            if playback_result.is_err() {
                let mut pending = pending_resume_bg.lock().unwrap();
                if pending
                    .as_ref()
                    .is_some_and(|resume| resume.request_generation == request_generation)
                {
                    *pending = None;
                }
            }

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
                    Ok((stream, state, resume_history)) => {
                        let track_status = playback_track_status(&stream);
                        let mut new_playback_session = PlaybackSession::new(
                            collection_id,
                            classification_id,
                            episode_id,
                            stream,
                            state,
                        );
                        if let Some(history) = &resume_history {
                            new_playback_session.audio_index = history
                                .audio_index
                                .and_then(|index| i32::try_from(index).ok())
                                .unwrap_or_default();
                            new_playback_session.subtitle_index = history
                                .subtitle_index
                                .and_then(|index| i32::try_from(index).ok())
                                .unwrap_or_default();
                        }
                        new_playback_session.position_secs = resume_position;
                        *playback_session.lock().unwrap() = Some(new_playback_session);
                        ui.set_playback_error("".into());
                        ui.set_playback_track_status(track_status.into());
                        if resume_position > 0.0 {
                            ui.set_progress_value(resume_position as f32);
                            diagnostics::record_event(
                                "ui",
                                "playback.resume",
                                "complete",
                                "success",
                                Duration::ZERO,
                                &[("sec", resume_position.round().to_string())],
                            );
                        }
                        ui.set_current_view("player".into());
                        ui.set_status_message(
                            if resume_position > 0.0 {
                                "媒体流已加载，已从 NAS 保存的位置继续播放。"
                            } else {
                                "媒体流已加载，已进入播放器。"
                            }
                            .into(),
                        );
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

    fn restore_loaded_collections(
        ui: &AppWindow,
        items: Vec<CollectionItem>,
        nas_client: &Arc<dyn NasClient>,
        session: &Arc<NasSession>,
        image_cache: &ImageCache,
        image_request_gate: &ImageRequestGate,
        last_poster_range: &Arc<Mutex<PosterRangeRequestState>>,
    ) {
        let count = items.len();
        let request_id = image_request_gate.begin();
        last_poster_range.lock().unwrap().reset();
        ui.set_collections(ModelRc::from(Rc::new(VecModel::from(collection_ui_items(&items)))));
        ui.set_collection_count(count as i32);
        ui.set_media_type_filter(MEDIA_TYPE_ALL.into());
        ui.set_sort_order(SORT_DEFAULT.into());
        ui.set_search_active(false);
        ui.set_search_loading(false);
        ui.set_search_error("".into());
        let total_count = ui.get_library_total_count().max(count as i32) as usize;
        let page = ui.get_library_page().max(1) as usize;
        ui.set_search_scope(
            collection_page_scope(
                page,
                ui.get_library_total_pages().max(0) as usize,
                count,
                count,
                total_count,
                "",
                MEDIA_TYPE_ALL,
                SORT_DEFAULT,
            )
            .into(),
        );
        AppCoordinator::request_poster_range_for_current_layout(
            ui,
            Arc::clone(nas_client),
            Arc::clone(session),
            image_cache.clone(),
            image_request_gate.clone(),
            request_id,
            &items,
            last_poster_range,
        );
    }

    fn restore_browse_context(
        ui: &AppWindow,
        context: BrowseContext,
        source_items: Vec<CollectionItem>,
        nas_client: &Arc<dyn NasClient>,
        session: &Arc<NasSession>,
        image_cache: &ImageCache,
        image_request_gate: &ImageRequestGate,
        last_poster_range: &Arc<Mutex<PosterRangeRequestState>>,
    ) {
        let classifications = ui.get_classifications();
        let mut classification_name = None;
        for index in 0..classifications.row_count() {
            if let Some(mut item) = classifications.row_data(index) {
                let selected = item.id.as_str() == context.classification_id;
                item.is_selected = selected;
                if selected {
                    classification_name = Some(item.name.to_string());
                }
                classifications.set_row_data(index, item);
            }
        }
        if let Some(classification_name) = classification_name {
            ui.set_selected_classification_id(context.classification_id.clone().into());
            ui.set_selected_classification_name(classification_name.into());
        }

        let matches = apply_collection_query(
            &source_items,
            &context.query,
            &context.media_type,
            &context.sort_order,
        )
        .unwrap_or_else(|_| source_items.clone());
        let expected_ids: Vec<String> = matches
            .iter()
            .map(|item| item.collection_id.clone())
            .collect();
        let current_ids: Vec<String> = (0..ui.get_collections().row_count())
            .filter_map(|index| ui.get_collections().row_data(index))
            .map(|item| item.collection_id.to_string())
            .collect();
        let model_changed = current_ids != expected_ids;

        ui.set_apple_search_input(context.query.clone().into());
        ui.set_media_type_filter(context.media_type.clone().into());
        ui.set_sort_order(context.sort_order.clone().into());
        ui.set_library_page(context.page.max(1) as i32);
        ui.set_collection_count(matches.len() as i32);
        ui.set_search_active(
            !context.query.trim().is_empty()
                || context.media_type != MEDIA_TYPE_ALL
                || context.sort_order != SORT_DEFAULT,
        );
        ui.set_search_loading(false);
        ui.set_search_error("".into());
        ui.set_search_scope(
            collection_page_scope(
                context.page.max(1),
                ui.get_library_total_pages().max(0) as usize,
                source_items.len(),
                matches.len(),
                ui.get_library_total_count().max(source_items.len() as i32) as usize,
                &context.query,
                &context.media_type,
                &context.sort_order,
            )
            .into(),
        );

        if model_changed {
            let request_id = image_request_gate.begin();
            last_poster_range.lock().unwrap().reset();
            ui.set_collections(ModelRc::from(Rc::new(VecModel::from(
                collection_ui_items(&matches),
            ))));
            AppCoordinator::request_poster_range_for_current_layout(
                ui,
                Arc::clone(nas_client),
                Arc::clone(session),
                image_cache.clone(),
                image_request_gate.clone(),
                request_id,
                &matches,
                last_poster_range,
            );
        }

        let focus_target = matches
            .iter()
            .find(|item| item.collection_id == context.focused_collection_id)
            .map(|item| item.collection_id.clone())
            .or_else(|| {
                context
                    .focused_collection_index
                    .and_then(|index| matches.get(index.min(matches.len().saturating_sub(1))))
                    .map(|item| item.collection_id.clone())
            });
        let focus_was_restored = focus_target
            .as_deref()
            .is_some_and(|id| id == context.focused_collection_id);
        let has_focus_target = focus_target.is_some();

        ui.set_library_scroll_offset(context.scroll_offset.max(0.0));
        ui.set_library_restore_scroll_offset(context.scroll_offset.max(0.0));
        ui.set_library_focus_collection_id("".into());
        ui.set_current_view("library".into());
        if let Some(focus_target) = focus_target.as_deref() {
            ui.set_library_focus_collection_id(focus_target.into());
        }

        ui.set_status_message(
            if focus_was_restored {
                "已返回片库，恢复查询、筛选、排序、滚动位置和焦点。"
            } else if context.focused_collection_id.trim().is_empty() {
                "已返回片库，恢复查询、筛选、排序和滚动位置。"
            } else if has_focus_target {
                "打开的影视已不在当前结果中，已将焦点移到邻近内容。"
            } else {
                "打开的影视已不在当前结果中，已返回当前片库内容区。"
            }
            .into(),
        );
    }

    fn start_local_collection_query(
        ui_weak: slint::Weak<AppWindow>,
        snapshot: Vec<CollectionItem>,
        query: String,
        media_type: String,
        sort_order: String,
        source_count: usize,
        generation: u64,
        generation_gate: Arc<AtomicU64>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        last_poster_range: Arc<Mutex<PosterRangeRequestState>>,
        delayed: bool,
    ) {
        let execute = move || {
            if generation_gate.load(Ordering::SeqCst) != generation {
                return;
            }

            let ui_weak = ui_weak.clone();
            let generation_gate = Arc::clone(&generation_gate);
            let image_cache = image_cache.clone();
            let image_request_gate = image_request_gate.clone();
            let nas_client = Arc::clone(&nas_client);
            let session = Arc::clone(&session);
            let last_poster_range = Arc::clone(&last_poster_range);
            let query_for_thread = query.clone();
            let query_for_ui = query_for_thread.clone();
            let media_type_for_thread = media_type.clone();
            let media_type_for_ui = media_type_for_thread.clone();
            let sort_order_for_thread = sort_order.clone();
            let sort_order_for_ui = sort_order_for_thread.clone();

            std::thread::spawn(move || {
                let matches = apply_collection_query(
                    &snapshot,
                    &query_for_thread,
                    &media_type_for_thread,
                    &sort_order_for_thread,
                );

                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = ui_weak.upgrade() else { return };
                    if generation_gate.load(Ordering::SeqCst) != generation
                        || ui.get_apple_search_input().trim() != query_for_ui
                        || ui.get_media_type_filter().as_str() != media_type_for_ui
                        || ui.get_sort_order().as_str() != sort_order_for_ui
                    {
                        return;
                    }

                    match matches {
                        Ok(matches) => {
                            let count = matches.len();
                            let request_id = image_request_gate.begin();
                            last_poster_range.lock().unwrap().reset();
                            ui.set_collections(ModelRc::from(Rc::new(VecModel::from(
                                collection_ui_items(&matches),
                            ))));
                            ui.set_collection_count(count as i32);
                            ui.set_search_active(
                                !query_for_ui.is_empty()
                                    || media_type_for_ui != MEDIA_TYPE_ALL
                                    || sort_order_for_ui != SORT_DEFAULT,
                            );
                            ui.set_search_loading(false);
                            ui.set_search_error("".into());
                            ui.set_search_scope(
                                collection_page_scope(
                                    ui.get_library_page().max(1) as usize,
                                    ui.get_library_total_pages().max(0) as usize,
                                    source_count,
                                    count,
                                    ui.get_library_total_count().max(source_count as i32) as usize,
                                    &query_for_ui,
                                    &media_type_for_ui,
                                    &sort_order_for_ui,
                                )
                                .into(),
                            );
                            ui.set_status_message(
                                format!(
                                    "已应用{}、{}：当前范围匹配 {} 部影视作品。",
                                    media_type_label(&media_type_for_ui),
                                    sort_order_label(&sort_order_for_ui),
                                    count
                                )
                                .into(),
                            );
                            AppCoordinator::request_poster_range_for_current_layout(
                                &ui,
                                nas_client,
                                session,
                                image_cache,
                                image_request_gate,
                                request_id,
                                &matches,
                                &last_poster_range,
                            );
                        }
                        Err(error) => {
                            ui.set_search_loading(false);
                            ui.set_search_active(true);
                            ui.set_search_error(error.user_message().into());
                            ui.set_search_scope(
                                format!("仅当前已加载 {} 部 · 条件不可用", source_count).into(),
                            );
                            ui.set_status_message("当前组合条件不可用，请调整筛选或排序。".into());
                        }
                    }
                });
            });
        };

        if delayed {
            slint::Timer::single_shot(SEARCH_DEBOUNCE, execute);
        } else {
            execute();
        }
    }

    fn handle_local_query_input(
        ui: &AppWindow,
        query: String,
        media_type: String,
        sort_order: String,
        delayed: bool,
        loaded_collections: &Arc<Mutex<Vec<CollectionItem>>>,
        search_generation: &Arc<AtomicU64>,
        image_cache: &ImageCache,
        image_request_gate: &ImageRequestGate,
        nas_client: &Arc<dyn NasClient>,
        session: &Arc<NasSession>,
        last_poster_range: &Arc<Mutex<PosterRangeRequestState>>,
    ) {
        let generation = search_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let query = query.trim().to_string();
        let media_type = media_type.trim().to_string();
        let sort_order = sort_order.trim().to_string();
        ui.set_search_error("".into());

        if ui.get_library_page() > 1 {
            ui.invoke_library_page_changed(1);
            return;
        }

        let snapshot = loaded_collections.lock().unwrap().clone();
        if query.is_empty() && media_type == MEDIA_TYPE_ALL && sort_order == SORT_DEFAULT {
            AppCoordinator::restore_loaded_collections(
                ui,
                snapshot,
                nas_client,
                session,
                image_cache,
                image_request_gate,
                last_poster_range,
            );
            ui.set_status_message("已清空搜索，恢复当前已加载片库。".into());
            return;
        }

        if let Err(error) = apply_collection_query(&[], &query, &media_type, &sort_order) {
            ui.set_search_active(true);
            ui.set_search_loading(false);
            ui.set_search_error(error.user_message().into());
            ui.set_search_scope(format!("仅当前已加载 {} 部 · 条件不可用", snapshot.len()).into());
            ui.set_status_message("当前组合条件不可用，请调整筛选或排序。".into());
            return;
        }

        let source_count = snapshot.len();
        ui.set_search_active(true);
        ui.set_search_loading(true);
        ui.set_search_scope(
            format!("仅当前已加载 {} 部 · 正在应用筛选和排序", source_count).into(),
        );
        ui.set_status_message(if delayed {
            "正在等待搜索输入稳定..."
        } else {
            "正在应用当前已加载范围的筛选和排序..."
        }
        .into());
        AppCoordinator::start_local_collection_query(
            ui.as_weak(),
            snapshot,
            query,
            media_type,
            sort_order,
            source_count,
            generation,
            Arc::clone(search_generation),
            image_cache.clone(),
            image_request_gate.clone(),
            Arc::clone(nas_client),
            Arc::clone(session),
            Arc::clone(last_poster_range),
            delayed,
        );
    }

    fn request_poster_range_for_current_layout(
        ui: &AppWindow,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        request_id: u64,
        source_items: &[CollectionItem],
        last_poster_range: &Arc<Mutex<PosterRangeRequestState>>,
    ) {
        if ui.get_collections().row_count() == 0 {
            return;
        }

        let (range, layout_ready) = if let Some((scroll_offset, viewport_height, grid_top, card_width, columns)) =
            current_library_layout_for_ui(ui)
        {
            (
                visible_poster_range(
                    ui.get_collections().row_count(),
                    columns,
                    scroll_offset,
                    viewport_height,
                    grid_top,
                    card_width,
                ),
                true,
            )
        } else {
            (initial_poster_range_for_ui(ui), false)
        };

        if !last_poster_range
            .lock()
            .unwrap()
            .should_request(range, layout_ready)
        {
            return;
        }

        Self::spawn_visible_poster_fetching(
            ui,
            nas_client,
            session,
            image_cache,
            image_request_gate,
            request_id,
            range,
            source_items,
        );
    }

    fn spawn_visible_poster_fetching(
        ui: &AppWindow,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        request_id: u64,
        range: PosterLoadRange,
        source_items: &[CollectionItem],
    ) {
        let items = poster_items_for_range(ui, source_items, range);
        diagnostics::record_event(
            "ui",
            "library.poster_range",
            "complete",
            "success",
            Duration::ZERO,
            &[
                ("start", range.start.to_string()),
                ("end", range.end.to_string()),
                ("loaded_count", ui.get_collections().row_count().to_string()),
                ("request_count", items.len().to_string()),
            ],
        );
        Self::spawn_poster_fetching(
            ui.as_weak(),
            nas_client,
            session,
            image_cache,
            image_request_gate,
            request_id,
            items,
        );
    }

    /// Spawns background threads to asynchronously fetch only the current
    /// visible poster range. Network and CPU decoding stay off the UI thread.
    fn spawn_poster_fetching(
        ui_weak: slint::Weak<AppWindow>,
        nas_client: Arc<dyn NasClient>,
        session: Arc<NasSession>,
        image_cache: ImageCache,
        image_request_gate: ImageRequestGate,
        request_id: u64,
        items: Vec<PosterFetchItem>,
    ) {
        std::thread::spawn(move || {
            for PosterFetchItem {
                item,
                collection_ids,
            } in items
            {
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
                                let ui_weak = ui_weak.clone();
                                let image_request_gate = image_request_gate.clone();
                                let _ = slint::invoke_from_event_loop(move || {
                                    if !image_request_gate.is_current(request_id) {
                                        return;
                                    }
                                    if let Some(ui) = ui_weak.upgrade() {
                                        for collection_id in collection_ids {
                                            set_cover_status(&ui, &collection_id, "failed");
                                        }
                                    }
                                });
                                continue;
                            }
                        };

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
                                for collection_id in collection_ids {
                                    for i in 0..model.row_count() {
                                        if let Some(mut row) = model.row_data(i) {
                                            if row.collection_id.as_str() == collection_id {
                                                row.cover_image = slint_img.clone();
                                                row.has_cover = true;
                                                row.cover_status = "ready".into();
                                                model.set_row_data(i, row);
                                                break;
                                            }
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
                        let ui_weak_for_failure = ui_weak.clone();
                        let image_request_gate_for_failure = image_request_gate.clone();
                        let _ = slint::invoke_from_event_loop(move || {
                            if !image_request_gate_for_failure.is_current(request_id) {
                                return;
                            }
                            if let Some(ui) = ui_weak_for_failure.upgrade() {
                                for collection_id in collection_ids {
                                    set_cover_status(&ui, &collection_id, "failed");
                                }
                            }
                        });
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
        let continue_watching_image_request_gate =
            self.continue_watching_image_request_gate.clone();
        let loaded_collections = Arc::clone(&self.loaded_collections);
        let browse_context = Arc::clone(&self.browse_context);
        let browse_restore_notice = Arc::clone(&self.browse_restore_notice);
        let search_generation = Arc::clone(&self.search_generation);
        let last_poster_range = Arc::clone(&self.last_poster_range);
        let startup_last_playback = Arc::clone(&self.startup_last_playback);
        let continue_watching_generation = Arc::clone(&self.continue_watching_generation);

        let ui_weak_search = self.ui.as_weak();
        let loaded_collections_for_search = Arc::clone(&loaded_collections);
        let search_generation_for_search = Arc::clone(&search_generation);
        let image_cache_for_search = image_cache.clone();
        let image_request_gate_for_search = image_request_gate.clone();
        let nas_client_for_search = Arc::clone(&nas_client);
        let session_for_search = Arc::clone(&session);
        let last_poster_range_for_search = Arc::clone(&last_poster_range);
        let browse_context_for_search = Arc::clone(&browse_context);
        self.ui.on_search_changed(move |query| {
            let Some(ui) = ui_weak_search.upgrade() else {
                return;
            };
            remember_browse_context(&browse_context_for_search, &ui, None, None);
            AppCoordinator::handle_local_query_input(
                &ui,
                query.to_string(),
                ui.get_media_type_filter().to_string(),
                ui.get_sort_order().to_string(),
                true,
                &loaded_collections_for_search,
                &search_generation_for_search,
                &image_cache_for_search,
                &image_request_gate_for_search,
                &nas_client_for_search,
                &session_for_search,
                &last_poster_range_for_search,
            );
        });

        let ui_weak_search = self.ui.as_weak();
        let loaded_collections_for_search = Arc::clone(&loaded_collections);
        let search_generation_for_search = Arc::clone(&search_generation);
        let image_cache_for_search = image_cache.clone();
        let image_request_gate_for_search = image_request_gate.clone();
        let nas_client_for_search = Arc::clone(&nas_client);
        let session_for_search = Arc::clone(&session);
        let last_poster_range_for_search = Arc::clone(&last_poster_range);
        let browse_context_for_search = Arc::clone(&browse_context);
        self.ui.on_search_submitted(move |query| {
            let Some(ui) = ui_weak_search.upgrade() else {
                return;
            };
            remember_browse_context(&browse_context_for_search, &ui, None, None);
            AppCoordinator::handle_local_query_input(
                &ui,
                query.to_string(),
                ui.get_media_type_filter().to_string(),
                ui.get_sort_order().to_string(),
                false,
                &loaded_collections_for_search,
                &search_generation_for_search,
                &image_cache_for_search,
                &image_request_gate_for_search,
                &nas_client_for_search,
                &session_for_search,
                &last_poster_range_for_search,
            );
        });

        let ui_weak_search = self.ui.as_weak();
        let loaded_collections_for_search = Arc::clone(&loaded_collections);
        let search_generation_for_search = Arc::clone(&search_generation);
        let image_cache_for_search = image_cache.clone();
        let image_request_gate_for_search = image_request_gate.clone();
        let nas_client_for_search = Arc::clone(&nas_client);
        let session_for_search = Arc::clone(&session);
        let last_poster_range_for_search = Arc::clone(&last_poster_range);
        let browse_context_for_search = Arc::clone(&browse_context);
        self.ui.on_retry_search(move || {
            let Some(ui) = ui_weak_search.upgrade() else {
                return;
            };
            let query = ui.get_apple_search_input().to_string();
            remember_browse_context(&browse_context_for_search, &ui, None, None);
            AppCoordinator::handle_local_query_input(
                &ui,
                query,
                ui.get_media_type_filter().to_string(),
                ui.get_sort_order().to_string(),
                false,
                &loaded_collections_for_search,
                &search_generation_for_search,
                &image_cache_for_search,
                &image_request_gate_for_search,
                &nas_client_for_search,
                &session_for_search,
                &last_poster_range_for_search,
            );
        });

        let ui_weak_filter = self.ui.as_weak();
        let loaded_collections_for_filter = Arc::clone(&loaded_collections);
        let search_generation_for_filter = Arc::clone(&search_generation);
        let image_cache_for_filter = image_cache.clone();
        let image_request_gate_for_filter = image_request_gate.clone();
        let nas_client_for_filter = Arc::clone(&nas_client);
        let session_for_filter = Arc::clone(&session);
        let last_poster_range_for_filter = Arc::clone(&last_poster_range);
        let browse_context_for_filter = Arc::clone(&browse_context);
        self.ui.on_filter_changed(move |media_type| {
            let Some(ui) = ui_weak_filter.upgrade() else {
                return;
            };
            ui.set_media_type_filter(media_type.clone());
            remember_browse_context(&browse_context_for_filter, &ui, None, None);
            AppCoordinator::handle_local_query_input(
                &ui,
                ui.get_apple_search_input().to_string(),
                media_type.to_string(),
                ui.get_sort_order().to_string(),
                false,
                &loaded_collections_for_filter,
                &search_generation_for_filter,
                &image_cache_for_filter,
                &image_request_gate_for_filter,
                &nas_client_for_filter,
                &session_for_filter,
                &last_poster_range_for_filter,
            );
        });

        let ui_weak_sort = self.ui.as_weak();
        let loaded_collections_for_sort = Arc::clone(&loaded_collections);
        let search_generation_for_sort = Arc::clone(&search_generation);
        let image_cache_for_sort = image_cache.clone();
        let image_request_gate_for_sort = image_request_gate.clone();
        let nas_client_for_sort = Arc::clone(&nas_client);
        let session_for_sort = Arc::clone(&session);
        let last_poster_range_for_sort = Arc::clone(&last_poster_range);
        let browse_context_for_sort = Arc::clone(&browse_context);
        self.ui.on_sort_changed(move |sort_order| {
            let Some(ui) = ui_weak_sort.upgrade() else {
                return;
            };
            ui.set_sort_order(sort_order.clone());
            remember_browse_context(&browse_context_for_sort, &ui, None, None);
            AppCoordinator::handle_local_query_input(
                &ui,
                ui.get_apple_search_input().to_string(),
                ui.get_media_type_filter().to_string(),
                sort_order.to_string(),
                false,
                &loaded_collections_for_sort,
                &search_generation_for_sort,
                &image_cache_for_sort,
                &image_request_gate_for_sort,
                &nas_client_for_sort,
                &session_for_sort,
                &last_poster_range_for_sort,
            );
        });

        let ui_weak_clear = self.ui.as_weak();
        let loaded_collections_for_clear = Arc::clone(&loaded_collections);
        let search_generation_for_clear = Arc::clone(&search_generation);
        let image_cache_for_clear = image_cache.clone();
        let image_request_gate_for_clear = image_request_gate.clone();
        let nas_client_for_clear = Arc::clone(&nas_client);
        let session_for_clear = Arc::clone(&session);
        let last_poster_range_for_clear = Arc::clone(&last_poster_range);
        let browse_context_for_clear = Arc::clone(&browse_context);
        self.ui.on_clear_query(move || {
            let Some(ui) = ui_weak_clear.upgrade() else {
                return;
            };
            ui.set_apple_search_input("".into());
            ui.set_media_type_filter(MEDIA_TYPE_ALL.into());
            ui.set_sort_order(SORT_DEFAULT.into());
            remember_browse_context(&browse_context_for_clear, &ui, None, None);
            AppCoordinator::handle_local_query_input(
                &ui,
                "".to_string(),
                MEDIA_TYPE_ALL.to_string(),
                SORT_DEFAULT.to_string(),
                false,
                &loaded_collections_for_clear,
                &search_generation_for_clear,
                &image_cache_for_clear,
                &image_request_gate_for_clear,
                &nas_client_for_clear,
                &session_for_clear,
                &last_poster_range_for_clear,
            );
        });

        let ui_weak_page = self.ui.as_weak();
        let loaded_collections_for_page = Arc::clone(&loaded_collections);
        let search_generation_for_page = Arc::clone(&search_generation);
        let image_cache_for_page = image_cache.clone();
        let image_request_gate_for_page = image_request_gate.clone();
        let last_poster_range_for_page = Arc::clone(&last_poster_range);
        let nas_client_for_page = Arc::clone(&nas_client);
        let session_for_page = Arc::clone(&session);
        let browse_context_for_page = Arc::clone(&browse_context);
        self.ui.on_library_page_changed(move |requested_page| {
            let Some(ui) = ui_weak_page.upgrade() else {
                return;
            };
            let requested_page = requested_page.max(1) as usize;
            let current_total_pages = ui.get_library_total_pages().max(0) as usize;
            let page = if current_total_pages == 0 {
                requested_page
            } else {
                requested_page.min(current_total_pages)
            };
            ui.set_library_page(page as i32);
            remember_browse_context(&browse_context_for_page, &ui, None, None);
            AppCoordinator::start_library_page_load(
                ui.as_weak(),
                Arc::clone(&nas_client_for_page),
                Arc::clone(&session_for_page),
                Arc::clone(&loaded_collections_for_page),
                Arc::clone(&search_generation_for_page),
                image_cache_for_page.clone(),
                image_request_gate_for_page.clone(),
                Arc::clone(&last_poster_range_for_page),
                ui.get_selected_classification_id().to_string(),
                page,
            );
        });

        let ui_weak_scroll = self.ui.as_weak();
        let loaded_collections_for_scroll = Arc::clone(&loaded_collections);
        let nas_client_for_scroll = Arc::clone(&nas_client);
        let session_for_scroll = Arc::clone(&session);
        let image_cache_for_scroll = image_cache.clone();
        let image_request_gate_for_scroll = image_request_gate.clone();
        let last_poster_range_for_scroll = Arc::clone(&last_poster_range);
        let browse_context_for_scroll = Arc::clone(&browse_context);
        self.ui
            .on_library_scrolled(move |scroll_offset, viewport_height, grid_top, card_width, columns| {
            let Some(ui) = ui_weak_scroll.upgrade() else {
                return;
            };
            if ui.get_current_view() != "library"
                || ui.get_library_loading()
                || ui.get_collections().row_count() == 0
            {
                return;
            }

            let scroll_offset = scroll_offset.max(0.0);
            let layout_ready = columns > 0 && viewport_height > 0.0 && card_width > 0.0;
            remember_browse_context(
                &browse_context_for_scroll,
                &ui,
                Some(scroll_offset),
                None,
            );
            ui.set_library_scroll_offset(scroll_offset);
            ui.set_library_restore_scroll_offset(scroll_offset);

            let range = visible_poster_range(
                ui.get_collections().row_count(),
                columns.max(0) as usize,
                scroll_offset,
                viewport_height,
                grid_top,
                card_width,
            );
            let Some(request_id) = last_poster_range_for_scroll
                .lock()
                .unwrap()
                .begin_if_needed(&image_request_gate_for_scroll, range, layout_ready)
            else {
                return;
            };
            let source_items = loaded_collections_for_scroll.lock().unwrap().clone();
            AppCoordinator::spawn_visible_poster_fetching(
                &ui,
                Arc::clone(&nas_client_for_scroll),
                Arc::clone(&session_for_scroll),
                image_cache_for_scroll.clone(),
                image_request_gate_for_scroll.clone(),
                request_id,
                range,
                &source_items,
            );
        });

        let loaded_collections_for_classification = Arc::clone(&loaded_collections);
        let browse_context_for_classification = Arc::clone(&browse_context);
        let search_generation_for_classification = Arc::clone(&search_generation);
        let last_poster_range_for_classification = Arc::clone(&last_poster_range);
        self.ui.on_select_classification(move |class_id_slint| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let target_id = class_id_slint.to_string();

            search_generation_for_classification.fetch_add(1, Ordering::SeqCst);
            loaded_collections_for_classification.lock().unwrap().clear();
            ui.set_apple_search_input("".into());
            ui.set_media_type_filter(MEDIA_TYPE_ALL.into());
            ui.set_sort_order(SORT_DEFAULT.into());
            ui.set_search_active(false);
            ui.set_search_loading(false);
            ui.set_search_error("".into());
            ui.set_search_scope("当前已加载范围：0 部".into());
            ui.set_collection_count(0);
            ui.set_library_total_count(0);
            ui.set_library_total_pages(0);
            ui.set_library_page(1);
            ui.set_library_page_size(COLLECTION_PAGE_SIZE as i32);

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
            reset_browse_context(&browse_context_for_classification, &ui);
            ui.set_library_scroll_offset(0.0);
            ui.set_library_restore_scroll_offset(0.0);
            ui.set_library_focus_collection_id("".into());
            continue_watching_image_request_gate.cancel();
            continue_watching_generation.fetch_add(1, Ordering::SeqCst);
            AppCoordinator::clear_continue_watching(&ui);
            ui.set_library_loading(true);
            ui.set_library_error("".into());
            ui.set_requires_relogin(false);
            let request_id = image_request_gate.begin();
            last_poster_range_for_classification.lock().unwrap().reset();

            let client_for_thread = Arc::clone(&nas_client);
            let session_for_thread = Arc::clone(&session);
            let image_cache_for_thread = image_cache.clone();
            let image_request_gate_for_thread = image_request_gate.clone();
            let last_poster_range_for_thread = Arc::clone(&last_poster_range_for_classification);
            let nas_client_for_posters = Arc::clone(&nas_client);
            let session_for_posters = Arc::clone(&session);
            let loaded_collections_for_thread = Arc::clone(&loaded_collections_for_classification);
            let ui_weak_bg = ui_weak.clone();
            let startup_last_playback_for_thread = Arc::clone(&startup_last_playback);
            let continue_watching_generation_for_thread =
                Arc::clone(&continue_watching_generation);
            let continue_watching_image_request_gate_for_thread =
                continue_watching_image_request_gate.clone();
            let browse_restore_notice_for_thread = Arc::clone(&browse_restore_notice);
            let operation = diagnostics::start_event("ui", "library.select_classification");
            let selected_id_for_log = target_id.clone();

            std::thread::spawn(move || {
                let res = client_for_thread.get_collections(
                    &session_for_thread,
                    &target_id,
                    collection_page_start(1, COLLECTION_PAGE_SIZE),
                    COLLECTION_PAGE_SIZE,
                );
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
                            let total_count = page.count.max(total);
                            *loaded_collections_for_thread.lock().unwrap() = page.list.clone();
                            ui.set_collection_count(total as i32);
                            Self::set_library_page_state(&ui, 1, total_count);
                            ui.set_search_scope(
                                collection_page_scope(
                                    1,
                                    ui.get_library_total_pages().max(0) as usize,
                                    total,
                                    total,
                                    total_count,
                                    "",
                                    MEDIA_TYPE_ALL,
                                    SORT_DEFAULT,
                                )
                                .into(),
                            );

                            let ui_items = collection_ui_items(&page.list);

                            let model = Rc::new(VecModel::from(ui_items));
                            ui.set_collections(ModelRc::from(model));
                            ui.set_status_message(
                                format!("分类切换完成，加载 {} 部影视作品", total).into(),
                            );
                            AppCoordinator::start_continue_watching_load(
                                ui.as_weak(),
                                Arc::clone(&nas_client_for_posters),
                                Arc::clone(&session_for_posters),
                                image_cache_for_thread.clone(),
                                continue_watching_image_request_gate_for_thread.clone(),
                                Arc::clone(&continue_watching_generation_for_thread),
                                startup_last_playback_for_thread.lock().unwrap().clone(),
                                target_id.clone(),
                            );
                            AppCoordinator::request_poster_range_for_current_layout(
                                &ui,
                                nas_client_for_posters,
                                session_for_posters,
                                image_cache_for_thread.clone(),
                                image_request_gate_for_thread.clone(),
                                request_id,
                                &page.list,
                                &last_poster_range_for_thread,
                            );
                            if let Some(notice) = browse_restore_notice_for_thread
                                .lock()
                                .unwrap()
                                .take()
                            {
                                ui.set_status_message(notice.into());
                            }
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
        let startup_last_playback = Arc::clone(&self.startup_last_playback);
        let image_cache = self.image_cache.clone();
        let image_request_gate = self.image_request_gate.clone();
        let continue_watching_image_request_gate =
            self.continue_watching_image_request_gate.clone();
        let continue_watching_generation = Arc::clone(&self.continue_watching_generation);
        let loaded_collections = Arc::clone(&loaded_collections);
        let browse_context_for_refresh = Arc::clone(&browse_context);
        let search_generation = Arc::clone(&search_generation);
        let last_poster_range_for_refresh = Arc::clone(&last_poster_range);

        self.ui.on_refresh_library_clicked(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let sel_id = ui.get_selected_classification_id().to_string();
            continue_watching_image_request_gate.cancel();
            continue_watching_generation.fetch_add(1, Ordering::SeqCst);
            AppCoordinator::clear_continue_watching(&ui);
            search_generation.fetch_add(1, Ordering::SeqCst);
            loaded_collections.lock().unwrap().clear();
            ui.set_apple_search_input("".into());
            ui.set_media_type_filter(MEDIA_TYPE_ALL.into());
            ui.set_sort_order(SORT_DEFAULT.into());
            reset_browse_context(&browse_context_for_refresh, &ui);
            ui.set_library_scroll_offset(0.0);
            ui.set_library_restore_scroll_offset(0.0);
            ui.set_library_focus_collection_id("".into());
            ui.set_search_active(false);
            ui.set_search_loading(false);
            ui.set_search_error("".into());
            ui.set_search_scope("当前已加载范围：0 部".into());
            ui.set_collection_count(0);
            ui.set_library_total_count(0);
            ui.set_library_total_pages(0);
            ui.set_library_page(1);
            ui.set_library_page_size(COLLECTION_PAGE_SIZE as i32);
            ui.set_library_loading(true);
            ui.set_library_error("".into());
            ui.set_requires_relogin(false);
            let request_id = image_request_gate.begin();
            last_poster_range_for_refresh.lock().unwrap().reset();

            let client_for_thread = Arc::clone(&nas_client);
            let session_for_thread = Arc::clone(&session);
            let credential_store_for_thread = Arc::clone(&credential_store);
            let startup_restore_attempt = startup_restore_pending.load(Ordering::SeqCst);
            let startup_resume_context = if startup_restore_attempt {
                startup_last_playback.lock().unwrap().clone()
            } else {
                None
            };
            let requested_classification_id = startup_resume_context
                .as_ref()
                .map(|context| context.classification_id.clone())
                .filter(|classification_id| !classification_id.trim().is_empty())
                .unwrap_or(sel_id);
            let image_cache_for_thread = image_cache.clone();
            let image_request_gate_for_thread = image_request_gate.clone();
            let last_poster_range_for_thread = Arc::clone(&last_poster_range_for_refresh);
            let loaded_collections_for_thread = Arc::clone(&loaded_collections);
            let ui_weak_bg = ui_weak.clone();
            let startup_last_playback_for_thread = Arc::clone(&startup_last_playback);
            let continue_watching_generation_for_thread =
                Arc::clone(&continue_watching_generation);
            let continue_watching_image_request_gate_for_thread =
                continue_watching_image_request_gate.clone();
            let startup_restore_pending_for_thread = Arc::clone(&startup_restore_pending);
            let operation = diagnostics::start_event("ui", "library.refresh");

            std::thread::spawn(move || {
                let cat_res = client_for_thread.get_classifications(&session_for_thread);
                let effective_sel_id = cat_res
                    .as_ref()
                    .ok()
                    .and_then(|cats| {
                        cats.iter()
                            .find(|cat| cat.id == requested_classification_id)
                            .or_else(|| cats.first())
                    })
                    .map(|cat| cat.id.clone())
                    .unwrap_or_default();
                let col_res = match cat_res.as_ref() {
                    Err(_) => {
                        record_request_not_sent(
                            "library.collections",
                            "classifications_failed",
                        );
                        Err(NasError::MalformedResponse(
                            "分类列表请求失败，未请求影视列表".to_string(),
                        ))
                    }
                    Ok(_) if effective_sel_id.is_empty() => {
                        record_request_not_sent(
                            "library.collections",
                            "no_valid_classification_id",
                        );
                        Err(NasError::MalformedResponse(
                            "NAS 未返回可用分类，未请求影视列表".to_string(),
                        ))
                    }
                    Ok(_) => client_for_thread.get_collections(
                        &session_for_thread,
                        &effective_sel_id,
                        collection_page_start(1, COLLECTION_PAGE_SIZE),
                        COLLECTION_PAGE_SIZE,
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
                            let page_item_count = page.list.len();
                            let total_count = page.count.max(page_item_count);
                            *loaded_collections_for_thread.lock().unwrap() = page.list.clone();
                            let ui_cols = collection_ui_items(&page.list);
                            ui.set_collections(ModelRc::from(Rc::new(VecModel::from(ui_cols))));
                            ui.set_collection_count(page_item_count as i32);
                            Self::set_library_page_state(&ui, 1, total_count);
                            ui.set_search_scope(
                                collection_page_scope(
                                    1,
                                    ui.get_library_total_pages().max(0) as usize,
                                    page_item_count,
                                    page_item_count,
                                    total_count,
                                    "",
                                    MEDIA_TYPE_ALL,
                                    SORT_DEFAULT,
                                )
                                .into(),
                            );
                            ui.set_status_message("片库已刷新完成。".into());
                            AppCoordinator::start_continue_watching_load(
                                ui.as_weak(),
                                Arc::clone(&client_for_thread),
                                Arc::clone(&session_for_thread),
                                image_cache_for_thread.clone(),
                                continue_watching_image_request_gate_for_thread.clone(),
                                Arc::clone(&continue_watching_generation_for_thread),
                                startup_last_playback_for_thread.lock().unwrap().clone(),
                                selected_id_for_ui.clone(),
                            );
                            AppCoordinator::request_poster_range_for_current_layout(
                                &ui,
                                Arc::clone(&client_for_thread),
                                Arc::clone(&session_for_thread),
                                image_cache_for_thread.clone(),
                                image_request_gate_for_thread.clone(),
                                request_id,
                                &page.list,
                                &last_poster_range_for_thread,
                            );
                            ui.set_requires_relogin(false);

                            if startup_restore_attempt {
                                if let Some(context) = startup_resume_context.as_ref().filter(|context| {
                                    context.classification_id == selected_id_for_ui
                                        && !context.collection_id.trim().is_empty()
                                        && !context.episode_id.trim().is_empty()
                                }) {
                                    info!("Restoring last playback collection from saved context");
                                    let collection_id = context.collection_id.clone();
                                    let classification_id = context.classification_id.clone();
                                    let episode_id = context.episode_id.clone();
                                    diagnostics::record_event(
                                        "ui",
                                        "playback.restore_context",
                                        "complete",
                                        "success",
                                        Duration::ZERO,
                                        &[
                                            ("collection_id", collection_id.clone()),
                                            ("classification_id", classification_id),
                                            ("episode_id", episode_id),
                                        ],
                                    );
                                    ui.set_status_message("正在打开上次观看内容...".into());
                                    let ui_weak_restore = ui.as_weak();
                                    slint::Timer::single_shot(Duration::from_millis(0), move || {
                                        if let Some(ui) = ui_weak_restore.upgrade() {
                                            ui.invoke_collection_clicked(collection_id.into());
                                        }
                                    });
                                } else if startup_resume_context.is_some() {
                                    info!("Saved playback context could not be matched to the refreshed classification");
                                    diagnostics::record_event(
                                        "ui",
                                        "playback.restore_context",
                                        "complete",
                                        "skipped",
                                        Duration::ZERO,
                                        &[("reason", "classification_not_found".to_string())],
                                    );
                                }
                            }
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
        let startup_last_playback = Arc::clone(&self.startup_last_playback);
        let browse_context_for_collection = Arc::clone(&browse_context);
        self.ui.on_collection_clicked(move |col_id| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let classification_id = ui.get_selected_classification_id().to_string();
            let collection_id = col_id.to_string();
            remember_browse_context(
                &browse_context_for_collection,
                &ui,
                None,
                Some(&collection_id),
            );
            let preferred_episode_id = startup_last_playback
                .lock()
                .unwrap()
                .as_ref()
                .filter(|context| {
                    context.collection_id == collection_id
                        && context.classification_id == classification_id
                })
                .map(|context| context.episode_id.clone());
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
                collection_id,
                classification_id,
                preferred_episode_id,
            );
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
        self.ui
            .on_continue_watching_clicked(move |collection_id_slint, episode_id_slint| {
                let Some(ui) = ui_weak.upgrade() else { return };
                let collection_id = collection_id_slint.to_string();
                let episode_id = episode_id_slint.to_string();
                let classification_id = ui.get_selected_classification_id().to_string();
                if collection_id.trim().is_empty()
                    || episode_id.trim().is_empty()
                    || classification_id.trim().is_empty()
                {
                    return;
                }
                info!("User clicked local continue-watching item; opening its collection detail");
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
                    collection_id,
                    classification_id,
                    Some(episode_id),
                );
            });

        let ui_weak = self.ui.as_weak();
        self.ui.on_continue_watching_retry(move || {
            if let Some(ui) = ui_weak.upgrade() {
                ui.invoke_refresh_library_clicked();
            }
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
        let last_poster_range = Arc::clone(&self.last_poster_range);
        let browse_context_for_back = Arc::clone(&self.browse_context);
        let loaded_collections_for_back = Arc::clone(&self.loaded_collections);
        let nas_client_for_back = Arc::clone(&self.nas_client);
        let session_for_back = Arc::clone(&self.session);
        let image_cache_for_back = self.image_cache.clone();
        let browse_restore_notice_for_back = Arc::clone(&self.browse_restore_notice);
        self.ui.on_detail_back_clicked(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            detail_request_generation.fetch_add(1, Ordering::SeqCst);
            playback_request_generation.fetch_add(1, Ordering::SeqCst);
            image_request_gate.cancel();
            last_poster_range.lock().unwrap().reset();
            *detail_state.lock().unwrap() = None;
            *playback_session.lock().unwrap() = None;
            ui.set_playback_loading(false);
            ui.set_playback_error("".into());

            let context = browse_context_for_back.lock().unwrap().clone();
            let source_classification_exists = (0..ui.get_classifications().row_count()).any(|index| {
                ui.get_classifications()
                    .row_data(index)
                    .is_some_and(|item| item.id.as_str() == context.classification_id)
            });

            if source_classification_exists {
                let source_items = loaded_collections_for_back.lock().unwrap().clone();
                AppCoordinator::restore_browse_context(
                    &ui,
                    context,
                    source_items,
                    &nas_client_for_back,
                    &session_for_back,
                    &image_cache_for_back,
                    &image_request_gate,
                    &last_poster_range,
                );
            } else {
                let fallback = (0..ui.get_classifications().row_count()).find_map(|index| {
                    ui.get_classifications().row_data(index).and_then(|item| {
                        (!item.id.trim().is_empty()).then(|| (item.id.to_string(), item.name.to_string()))
                    })
                });
                ui.set_current_view("library".into());
                ui.set_library_focus_collection_id("".into());
                if let Some((fallback_id, fallback_name)) = fallback {
                    *browse_restore_notice_for_back.lock().unwrap() = Some(format!(
                        "原分类已不可用，已切换到有效分类「{}」。",
                        fallback_name
                    ));
                    ui.invoke_select_classification(fallback_id.into());
                } else {
                    ui.set_status_message("原分类已不可用，当前没有可用片库分类。".into());
                }
            }
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
        let credential_store = Arc::clone(&self.credential_store);
        let startup_last_playback = Arc::clone(&self.startup_last_playback);
        let detail_state = Arc::clone(&self.detail_state);
        let playback_session = Arc::clone(&self.playback_session);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);
        let pending_resume = Arc::clone(&self.pending_resume);
        self.ui.on_play_episode_clicked(move |episode_id| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let episode_id = episode_id.to_string();
            let collection_id = ui.get_detail_collection_id().to_string();
            let classification_id = ui.get_selected_classification_id().to_string();
            AppCoordinator::start_playback_load(
                ui_weak.clone(),
                Arc::clone(&nas_client),
                Arc::clone(&session),
                Arc::clone(&credential_store),
                Arc::clone(&startup_last_playback),
                Arc::clone(&player),
                Arc::clone(&detail_state),
                Arc::clone(&playback_session),
                Arc::clone(&playback_request_generation),
                Arc::clone(&pending_resume),
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
        let continue_watching_image_request_gate =
            self.continue_watching_image_request_gate.clone();
        let continue_watching_generation = Arc::clone(&self.continue_watching_generation);
        let startup_last_playback = Arc::clone(&self.startup_last_playback);

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
            continue_watching_image_request_gate.cancel();
            continue_watching_generation.fetch_add(1, Ordering::SeqCst);
            *startup_last_playback.lock().unwrap() = None;
            *detail_state.lock().unwrap() = None;
            *playback_session.lock().unwrap() = None;

            ui.set_is_logged_in(false);
            ui.set_login_status_hint("已安全退出会话。可重新输入凭据登录。".into());
            ui.set_classifications(ModelRc::new(VecModel::default()));
            ui.set_collections(ModelRc::new(VecModel::default()));
            AppCoordinator::clear_continue_watching(&ui);
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
        let continue_watching_image_request_gate =
            self.continue_watching_image_request_gate.clone();
        let continue_watching_generation = Arc::clone(&self.continue_watching_generation);
        let startup_last_playback = Arc::clone(&self.startup_last_playback);
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
            continue_watching_image_request_gate.cancel();
            continue_watching_generation.fetch_add(1, Ordering::SeqCst);
            *startup_last_playback.lock().unwrap() = None;
            *detail_state.lock().unwrap() = None;
            *playback_session.lock().unwrap() = None;
            ui.set_is_logged_in(false);
            ui.set_requires_relogin(false);
            ui.set_login_error_message("".into());
            ui.set_login_status_hint("会话已失效，请重新输入凭据登录。".into());
            ui.set_classifications(ModelRc::new(VecModel::default()));
            ui.set_collections(ModelRc::new(VecModel::default()));
            AppCoordinator::clear_continue_watching(&ui);
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
        let pending_progress_requests = Arc::clone(&self.pending_progress_requests);
        let progress_report_gate = Arc::clone(&self.progress_report_gate);
        let player = Arc::clone(&self.player);
        let pending_resume = Arc::clone(&self.pending_resume);
        let playback_request_generation = Arc::clone(&self.playback_request_generation);

        self.player.add_event_listener(Box::new(move |event| {
            let ui_weak = ui_weak.clone();
            let playback_session = Arc::clone(&playback_session);
            let playback_controls = Arc::clone(&playback_controls);
            let nas_client = Arc::clone(&nas_client);
            let nas_session = Arc::clone(&nas_session);
            let pending_progress_requests = Arc::clone(&pending_progress_requests);
            let progress_report_gate = Arc::clone(&progress_report_gate);
            let player = Arc::clone(&player);
            let pending_resume = Arc::clone(&pending_resume);
            let playback_request_generation = Arc::clone(&playback_request_generation);
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
                                    let final_progress = playback_session
                                        .lock()
                                        .unwrap()
                                        .as_ref()
                                        .map(PlaybackSession::progress_update);
                                    if let Some(progress_update) = final_progress {
                                        let should_report = progress_report_gate
                                            .lock()
                                            .unwrap()
                                            .should_report(progress_update.sec, true);
                                        if should_report {
                                            spawn_playback_progress_report(
                                                progress_update,
                                                Arc::clone(&nas_client),
                                                Arc::clone(&nas_session),
                                                Arc::clone(&pending_progress_requests),
                                            );
                                        }
                                    }
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
                                let should_report = progress_report_gate
                                    .lock()
                                    .unwrap()
                                    .should_report(progress_update.sec, false);
                                if should_report {
                                    spawn_playback_progress_report(
                                        progress_update,
                                        Arc::clone(&nas_client),
                                        Arc::clone(&nas_session),
                                        Arc::clone(&pending_progress_requests),
                                    );
                                }
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
                            progress_report_gate.lock().unwrap().reset();
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

                            let current_generation =
                                playback_request_generation.load(Ordering::SeqCst);
                            let pending = {
                                let mut pending_slot = pending_resume.lock().unwrap();
                                if pending_slot
                                    .as_ref()
                                    .is_some_and(|resume| {
                                        resume.request_generation == current_generation
                                    })
                                {
                                    pending_slot.take()
                                } else {
                                    None
                                }
                            };
                            if let Some(pending) = pending {
                                info!(
                                    "Applying saved playback position after media loaded: {} sec",
                                    pending.position_secs.round()
                                );
                                let player = Arc::clone(&player);
                                let playback_request_generation =
                                    Arc::clone(&playback_request_generation);
                                std::thread::spawn(move || {
                                    if playback_request_generation.load(Ordering::SeqCst)
                                        != pending.request_generation
                                    {
                                        diagnostics::record_event(
                                            "ui",
                                            "playback.resume_seek",
                                            "complete",
                                            "skipped",
                                            Duration::ZERO,
                                            &[("reason", "stale_playback_request".to_string())],
                                        );
                                        return;
                                    }

                                    let result = player.seek(pending.position_secs);
                                    info!(
                                        "Saved playback position seek result: success={}, sec={}",
                                        result.is_ok(),
                                        pending.position_secs.round()
                                    );
                                    diagnostics::record_event(
                                        "ui",
                                        "playback.resume_seek",
                                        "complete",
                                        if result.is_ok() { "success" } else { "error" },
                                        Duration::ZERO,
                                        &[
                                            ("sec", pending.position_secs.round().to_string()),
                                            (
                                                "reason",
                                                if result.is_ok() {
                                                    "media_loaded"
                                                } else {
                                                    "player_seek_failed"
                                                }
                                                .to_string(),
                                            ),
                                        ],
                                    );
                                    if let Err(error) = result {
                                        warn!(
                                            "Failed to seek to the saved playback position: {}",
                                            error
                                        );
                                    }
                                });
                            }
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
        #[cfg(windows)]
        let mut native_backdrop_checked = false;

        self.timer.start(
            slint::TimerMode::Repeated,
            Duration::from_millis(100),
            move || {
                heartbeat += 1;
                let Some(ui) = ui_weak.upgrade() else { return };
                ui.set_ui_heartbeat_count(heartbeat);

                #[cfg(windows)]
                {
                    if !native_backdrop_checked {
                        match native_backdrop_mode(
                            native_backdrop_requested(),
                            shell_transparency_disabled(),
                        ) {
                            NativeBackdropMode::Disabled => {
                                native_backdrop_checked = true;
                                record_native_backdrop_event(
                                    "disabled",
                                    false,
                                    false,
                                    "feature-disabled",
                                );
                            }
                            NativeBackdropMode::BlockedByTransparency => {
                                native_backdrop_checked = true;
                                ui.set_native_backdrop_enabled(false);
                                record_native_backdrop_event(
                                    "fallback",
                                    true,
                                    false,
                                    "reduced-transparency",
                                );
                            }
                            NativeBackdropMode::Requested => {
                                if let Some(hwnd) = try_get_window_hwnd(ui.window()) {
                                    native_backdrop_checked = true;
                                    match apply_native_backdrop(hwnd) {
                                        NativeBackdropOutcome::Applied => {
                                            ui.set_native_backdrop_enabled(true);
                                            record_native_backdrop_event(
                                                "applied",
                                                false,
                                                true,
                                                "system-backdrop-applied",
                                            );
                                        }
                                        NativeBackdropOutcome::Fallback { reason } => {
                                            ui.set_native_backdrop_enabled(false);
                                            record_native_backdrop_event(
                                                "fallback",
                                                true,
                                                true,
                                                reason,
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }

                    let is_logged_in = ui.get_is_logged_in();
                    let current_view = ui.get_current_view();
                    let scale = ui.window().scale_factor();
                    let area_x = (ui.get_video_area_x() * scale) as i32;
                    let area_y = (ui.get_video_area_y() * scale) as i32;
                    let area_w = (ui.get_video_area_width() * scale) as i32;
                    let area_h = (ui.get_video_area_height() * scale) as i32;

                    if is_logged_in && current_view == "player" {
                        if !surface_initialized && area_w > 10 && area_h > 10 {
                            if let Some(parent_hwnd) = try_get_window_hwnd(ui.window()) {
                                info!(
                                    "Attaching native Win32 child surface to parent HWND: {:#x}",
                                    parent_hwnd
                                );

                                match Win32VideoSurface::create(
                                    parent_hwnd,
                                    area_x,
                                    area_y,
                                    area_w,
                                    area_h,
                                ) {
                                    Ok(surface) => {
                                        let child_hwnd = surface.hwnd();
                                        info!(
                                            "Win32 child surface created with HWND: {:#x}",
                                            child_hwnd
                                        );

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
    preferred_episode_id: Option<&str>,
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

    let first_episode_id = preferred_episode_id
        .and_then(|preferred_id| {
            detail
                .seasons
                .iter()
                .flat_map(|season| season.episodes.iter())
                .find(|episode| AppCoordinator::episode_matches_identifier(episode, preferred_id))
                .map(|episode| episode.selection_id().to_string())
        })
        .or_else(|| {
            detail
                .history
                .as_ref()
                .and_then(|history| history.last_video_id.as_deref())
                .and_then(|last_video_id| {
                    detail
                        .seasons
                        .iter()
                        .flat_map(|season| season.episodes.iter())
                        .find(|episode| {
                            AppCoordinator::episode_matches_identifier(episode, last_video_id)
                        })
                        .map(|episode| episode.selection_id().to_string())
                })
        })
        .or_else(|| {
            detail
                .seasons
                .iter()
                .flat_map(|season| season.episodes.iter())
                .map(|episode| episode.selection_id().to_string())
                .find(|episode_id| !episode_id.is_empty())
        })
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
            session.set_device_metadata(NasDeviceMetadata::client_defaults());
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
                    last_playback: None,
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

fn record_request_not_sent(operation: &str, reason: &str) {
    diagnostics::record_event(
        "nas.request",
        operation,
        "complete",
        "not_sent",
        Duration::ZERO,
        &[("reason", reason.to_string())],
    );
}

fn spawn_playback_progress_report(
    progress_update: PlaybackProgressUpdate,
    nas_client: Arc<dyn NasClient>,
    nas_session: Arc<NasSession>,
    pending_progress_requests: Arc<AtomicUsize>,
) {
    pending_progress_requests.fetch_add(1, Ordering::SeqCst);
    std::thread::spawn(move || {
        let sec = progress_update.sec.to_string();
        let duration_sec = progress_update.video_duration.to_string();
        let result = nas_client.update_playback_progress(&nas_session, &progress_update);
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
        pending_progress_requests.fetch_sub(1, Ordering::SeqCst);
    });
}

fn persist_last_playback_context(
    credential_store: &dyn CredentialStore,
    collection_id: &str,
    classification_id: &str,
    episode_id: &str,
) {
    let context = LastPlaybackContext {
        collection_id: collection_id.to_string(),
        classification_id: classification_id.to_string(),
        episode_id: episode_id.to_string(),
    };

    match credential_store.load() {
        Ok(Some(mut credentials)) => {
            credentials.last_playback = Some(context);
            match credential_store.save(&credentials) {
                Ok(()) => {
                    info!("Saved last playback context to secure OS storage");
                    diagnostics::record_event(
                        "storage",
                        "playback.context",
                        "complete",
                        "success",
                        Duration::ZERO,
                        &[
                            ("collection_id", collection_id.to_string()),
                            ("classification_id", classification_id.to_string()),
                            ("episode_id", episode_id.to_string()),
                        ],
                    )
                }
                Err(error) => {
                    warn!(
                        "Failed to persist last playback context ({}): {}",
                        error.class(),
                        sanitize_log_message(&error.to_string())
                    );
                    diagnostics::record_event(
                        "storage",
                        "playback.context",
                        "complete",
                        "error",
                        Duration::ZERO,
                        &[("storage", error.class().to_string())],
                    );
                }
            }
        }
        Ok(None) => diagnostics::record_event(
            "storage",
            "playback.context",
            "complete",
            "skipped",
            Duration::ZERO,
            &[("reason", "no_saved_credentials".to_string())],
        ),
        Err(error) => {
            warn!(
                "Failed to load credentials for playback context ({}): {}",
                error.class(),
                sanitize_log_message(&error.to_string())
            );
            diagnostics::record_event(
                "storage",
                "playback.context",
                "complete",
                "error",
                Duration::ZERO,
                &[("storage", error.class().to_string())],
            );
        }
    }
}

fn wait_for_progress_flush(pending: &AtomicUsize) {
    for _ in 0..200 {
        if pending.load(Ordering::SeqCst) == 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    let remaining = pending.load(Ordering::SeqCst);
    diagnostics::record_event(
        "app",
        "shutdown.progress_flush",
        "complete",
        if remaining == 0 { "success" } else { "partial" },
        Duration::from_millis(2000),
        &[("pending", remaining.to_string())],
    );
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

#[cfg(test)]
mod poster_loading_tests {
    use super::{
        collection_page_count, collection_page_start, environment_flag_value_enabled,
        native_backdrop_mode, visible_poster_range, PosterLoadRange,
        NativeBackdropMode, PosterLoadRange, PosterRangeRequestState,
    };
    use crate::media::image_cache::ImageRequestGate;

    #[test]
    fn visible_poster_range_stays_within_loaded_rows() {
        let range = visible_poster_range(50, 4, 500.0, 300.0, 0.0, 140.0);

        assert_eq!(
            range,
            PosterLoadRange {
                start: 0,
                end: 16,
            }
        );
    }

    #[test]
    fn missing_viewport_uses_a_bounded_initial_window() {
        let range = visible_poster_range(50, 7, 0.0, 0.0, 0.0, 0.0);

        assert_eq!(
            range,
            PosterLoadRange {
                start: 0,
                end: 24,
            }
        );
    }

    #[test]
    fn wide_logical_viewport_requests_more_than_initial_window() {
        // Ticket #9's 2560x1351 logical client leaves 12 columns at about
        // 176.83px per card and enough height for four visible rows.
        let range = visible_poster_range(50, 12, 0.0, 1_287.0, 0.0, 176.83);

        assert!(range.end > 24, "wide viewport must load beyond the fallback window");
        assert!(range.end <= 50);
    }

    #[test]
    fn model_replacement_promotes_fallback_and_deduplicates_layout_requests() {
        // The model still contains the same 50 items when valid geometry
        // arrives. The fallback request must be superseded by the real range.
        let gate = ImageRequestGate::new();
        let mut state = PosterRangeRequestState::default();
        let fallback = visible_poster_range(50, 0, 0.0, 0.0, 0.0, 0.0);
        let fallback_id = state
            .begin_if_needed(&gate, fallback, false)
            .expect("model replacement should issue one bounded fallback request");

        let wide = visible_poster_range(50, 12, 0.0, 1_287.0, 0.0, 176.83);
        let wide_id = state
            .begin_if_needed(&gate, wide, true)
            .expect("valid geometry should replace the fallback request");
        assert!(wide.end > 24);
        assert!(!gate.is_current(fallback_id));
        assert!(gate.is_current(wide_id));
        assert!(
            state
                .begin_if_needed(&gate, wide, true)
                .is_none(),
            "repeated layout events must not cancel and restart the same request"
        );
        assert!(gate.is_current(wide_id));

        let small = visible_poster_range(8, 4, 0.0, 220.0, 0.0, 100.0);
        let small_id = state
            .begin_if_needed(&gate, small, true)
            .expect("a changed small-window range should issue one request");
        assert!(
            state
                .begin_if_needed(&gate, small, true)
                .is_none(),
            "repeated small-window events must remain deduplicated"
        );
        assert!(gate.is_current(small_id));
    }

    #[test]
    fn scrolling_moves_poster_range_without_touching_unloaded_rows() {
        let range = visible_poster_range(100, 4, 1_000.0, 300.0, 0.0, 140.0);

        assert_eq!(
            range,
            PosterLoadRange {
                start: 8,
                end: 24,
            }
        );
    }

    #[test]
    fn collection_page_math_handles_empty_single_and_last_page() {
        assert_eq!(collection_page_count(0, 50), 0);
        assert_eq!(collection_page_count(1, 50), 1);
        assert_eq!(collection_page_count(50, 50), 1);
        assert_eq!(collection_page_count(51, 50), 2);
        assert_eq!(collection_page_count(101, 50), 3);

        assert_eq!(collection_page_start(1, 50), 1);
        assert_eq!(collection_page_start(2, 50), 51);
        assert_eq!(collection_page_start(3, 50), 101);
    }

    #[test]
    fn page_change_resets_poster_range_state() {
        let gate = ImageRequestGate::new();
        let mut state = PosterRangeRequestState::default();
        let range = PosterLoadRange { start: 0, end: 24 };

        let first_id = state
            .begin_if_needed(&gate, range, false)
            .expect("first page must issue an initial poster request");
        state.reset();
        let second_id = state
            .begin_if_needed(&gate, range, false)
            .expect("new page must issue a fresh initial poster request");

        assert!(!gate.is_current(first_id));
        assert!(gate.is_current(second_id));
    }

    #[test]
    fn native_backdrop_is_explicit_and_transparency_safe() {
        assert!(!environment_flag_value_enabled(None));
        assert!(!environment_flag_value_enabled(Some("0")));
        assert!(environment_flag_value_enabled(Some("1")));

        assert_eq!(
            native_backdrop_mode(false, false),
            NativeBackdropMode::Disabled
        );
        assert_eq!(
            native_backdrop_mode(true, false),
            NativeBackdropMode::Requested
        );
        assert_eq!(
            native_backdrop_mode(true, true),
            NativeBackdropMode::BlockedByTransparency
        );
    }
}
