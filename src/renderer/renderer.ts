import { coverData, generatedCover } from "./cover.js";
import { AppListbox, type AppListboxOption } from "./menu.js";
import { paginationModel, parseJumpTarget, countLabel } from "./pagination.js";
import { captureFlightSource, fadeIn, motionAllowsTransform, motionDuration, skipFlight, startFlight } from "./motion.js";
import { initAppTooltips } from "./tooltip.js";
document.querySelectorAll<HTMLButtonElement>("[data-window-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.windowAction;
    if (action === "minimize" || action === "maximize" || action === "close") window.zVideo.windowAction(action);
  });
});
window.zVideo.onWindowMaximized((maximized) => {
  const button = document.querySelector<HTMLButtonElement>('[data-window-action="maximize"]');
  if (!button) return;
  button.setAttribute("aria-label", maximized ? "还原窗口" : "最大化窗口");
  button.textContent = maximized ? "❐" : "□";
});
initAppTooltips();
import { applyTone, posterTone } from "./tone.js";
import { escapeHtml, formatTime, kindLabel, formatBytes, artworkKind } from "./views/shared.js";
import { card, collectionAsMediaItem, collectionCard } from "./views/all.js";
import { renderSources } from "./views/sources.js";
import { episodeRows, renderMovieFileInfo, renderSeasonTabs, renderViewingRecord } from "./views/detail.js";
import { renderContinueCards } from "./views/home.js";
import { cleanupSettingsSummary, renderCleanupCandidate, renderCleanupDeleteItem } from "./views/cleanup.js";
import { reviewDecisionNotice, reviewFactsText } from "./views/review.js";
import { biscuitPath, wavePath } from "./shapes.js";
import type {
  LocalArtworkReference,
  LocalCollectionQuery,
  LocalCollectionSummary,
  LocalContinueWatchingItem,
  LocalLibraryFilter,
  LocalLibraryQuery,
  LocalLibrarySort,
  LocalLibraryState,
  LocalMediaDetail,
  LocalMediaItem,
  LocalPlaybackState,
  LocalScanProgress,
  LocalScanResult,
  LocalViewingHistory,
} from "../shared/local-library-contracts";
import { isLocalLibrarySort } from "../shared/app-preferences-contracts.js";
import {
  CLEANUP_PRESET_LABELS,
  CLEANUP_RULE_LABELS,
  CLEANUP_RULE_ORDER,
  CLEANUP_STATE_LABELS,
  CLEANUP_THRESHOLD_FIELDS,
  defaultCleanupSettings,
  parseCleanupSettings,
  resolveCleanupPreset,
  type CleanupPreset,
  type CleanupRuleId,
  type CleanupRuleToggles,
  type CleanupSettings,
  type CleanupState,
  type CleanupThresholds,
  type LocalCleanupCandidate,
  type LocalCleanupQueue,
  type LocalCleanupQueueQuery,
} from "../shared/cleanup-contracts.js";
import type { LocalPlaybackEvent } from "../shared/local-playback-contracts";

const PAGE_SIZE = 24;
const ARTWORK_CONCURRENCY = 4;

const chooseFolderButton = document.querySelector<HTMLButtonElement>("#choose-folder-button");
const appShell = document.querySelector<HTMLElement>(".app-shell");
const openVideoButton = document.querySelector<HTMLButtonElement>("#open-video-button");
const rescanAllButton = document.querySelector<HTMLButtonElement>("#rescan-all-button");
const sourceList = document.querySelector<HTMLElement>("#source-list");
const libraryMessage = document.querySelector<HTMLElement>("#library-message");
const libraryGrid = document.querySelector<HTMLElement>("#library-grid");
const libraryEmpty = document.querySelector<HTMLElement>("#library-empty");
const libraryEmptyTitle = document.querySelector<HTMLElement>("#library-empty-title");
const libraryEmptyMessage = document.querySelector<HTMLElement>("#library-empty-message");
const searchAllTypesButton = document.querySelector<HTMLButtonElement>("#search-all-types-button");
const libraryErrorTitle = document.querySelector<HTMLElement>("#library-error-title");
const libraryErrorRetry = document.querySelector<HTMLButtonElement>("#library-error-retry");
const libraryErrorRetryNote = document.querySelector<HTMLElement>("#library-error-retry-note");
const libraryErrorCopy = document.querySelector<HTMLButtonElement>("#library-error-copy");
const libraryErrorFolders = document.querySelector<HTMLButtonElement>("#library-error-folders");
const libraryPageError = document.querySelector<HTMLElement>("#library-page-error");
const libraryPageErrorTitle = document.querySelector<HTMLElement>("#library-page-error-title");
const libraryPageErrorMessage = document.querySelector<HTMLElement>("#library-page-error-message");
const libraryPageErrorCode = document.querySelector<HTMLElement>("#library-page-error-code");
const libraryPageErrorRetry = document.querySelector<HTMLButtonElement>("#library-page-error-retry");
const libraryPageErrorBack = document.querySelector<HTMLButtonElement>("#library-page-error-back");
const libraryOfflineNotice = document.querySelector<HTMLElement>("#library-offline-notice");
const libraryOfflineText = document.querySelector<HTMLElement>("#library-offline-text");
const libraryOfflineFolders = document.querySelector<HTMLButtonElement>("#library-offline-folders");
const emptyAddFolder = document.querySelector<HTMLButtonElement>("#empty-add-folder");
const emptyAddVideo = document.querySelector<HTMLButtonElement>("#empty-add-video");
const emptyRescan = document.querySelector<HTMLButtonElement>("#empty-rescan");
const emptyViewAll = document.querySelector<HTMLButtonElement>("#empty-view-all");
const emptyClearSearch = document.querySelector<HTMLButtonElement>("#empty-clear-search");
const emptyFormats = document.querySelector<HTMLDetailsElement>("#empty-formats");
const sourceFilters = document.querySelector<HTMLElement>("#library-source-filters");
const libraryPagination = document.querySelector<HTMLElement>("#library-pagination");
const pageScope = document.querySelector<HTMLElement>("#page-scope");
const searchForm = document.querySelector<HTMLFormElement>("#library-search-form");
const searchInput = document.querySelector<HTMLInputElement>("#library-search-input");
const searchClear = document.querySelector<HTMLButtonElement>("#library-search-clear");
const detailSearchEntry = document.querySelector<HTMLButtonElement>("#detail-search-entry");
const searchSection = document.querySelector<HTMLElement>("#search-section");
const searchTitle = document.querySelector<HTMLElement>("#search-title");
const searchCount = document.querySelector<HTMLElement>("#search-count");
const searchBackPath = document.querySelector<HTMLElement>("#search-back-path");
const searchBackButton = document.querySelector<HTMLButtonElement>("#search-back");
const searchGrid = document.querySelector<HTMLElement>("#search-grid");
const searchPagination = document.querySelector<HTMLElement>("#search-pagination");
const searchEmpty = document.querySelector<HTMLElement>("#search-empty");
const searchEmptyTitle = document.querySelector<HTMLElement>("#search-empty-title");
const searchEmptyMessage = document.querySelector<HTMLElement>("#search-empty-message");
const searchEmptyRetry = document.querySelector<HTMLButtonElement>("#search-empty-retry");
const searchFilterButtons = document.querySelector<HTMLElement>("#search-filter-buttons");
const searchEmptyClear = document.querySelector<HTMLButtonElement>("#search-empty-clear");
const scanStatus = document.querySelector<HTMLElement>("#scan-status");
const scanStatusText = document.querySelector<HTMLElement>("#scan-status-text");
const homeScanCard = document.querySelector<HTMLElement>("#home-scan-card");
const homeScanStatus = document.querySelector<HTMLElement>("#home-scan-status");
const homeScanFolder = document.querySelector<HTMLElement>("#home-scan-folder");
const homeScanScanned = document.querySelector<HTMLElement>("#home-scan-scanned");
const homeScanAdded = document.querySelector<HTMLElement>("#home-scan-added");
const homeScanElapsed = document.querySelector<HTMLElement>("#home-scan-elapsed");
const homeScanNote = document.querySelector<HTMLElement>("#home-scan-note");
const appNotice = document.querySelector<HTMLElement>("#app-notice");
const appNoticeTitle = document.querySelector<HTMLElement>("#app-notice-title");
const appNoticeBody = document.querySelector<HTMLElement>("#app-notice-body");
const appNoticeClose = document.querySelector<HTMLButtonElement>("#app-notice-close");
const continueSection = document.querySelector<HTMLElement>("#continue-section");
const continueRow = document.querySelector<HTMLElement>("#continue-row");
const continueScope = document.querySelector<HTMLElement>("#continue-scope");
const collectionSection = document.querySelector<HTMLElement>("#collection-section");
const detail = document.querySelector<HTMLElement>("#media-detail");
const detailBack = document.querySelector<HTMLButtonElement>("#media-detail-back");
const detailPoster = document.querySelector<HTMLElement>("#detail-poster");
const detailTitle = document.querySelector<HTMLElement>("#media-detail-title");
const detailMeta = document.querySelector<HTMLElement>("#media-detail-meta");
const detailPlot = document.querySelector<HTMLElement>("#media-detail-plot");
const detailPlotToggle = document.querySelector<HTMLButtonElement>("#media-detail-plot-toggle");
const detailOpen = document.querySelector<HTMLButtonElement>("#media-detail-open");
const detailRestart = document.querySelector<HTMLButtonElement>("#media-detail-restart");
const detailResume = document.querySelector<HTMLElement>("#media-detail-resume");
const detailPlotSection = document.querySelector<HTMLElement>("#media-detail-plot-section");
const detailOfflineBanner = document.querySelector<HTMLElement>("#detail-offline-banner");
const detailPlotEmpty = document.querySelector<HTMLElement>("#detail-plot-empty");
const detailEpisodesSection = document.querySelector<HTMLElement>("#detail-episodes-section");
const detailEpisodes = document.querySelector<HTMLElement>("#detail-episodes");
const detailSeasonTabs = document.querySelector<HTMLElement>("#detail-season-tabs");
const detailFileSection = document.querySelector<HTMLElement>("#detail-file-section");
const detailViewingSection = document.querySelector<HTMLElement>("#detail-viewing-section");
const detailContent = document.querySelector<HTMLElement>("#detail-content");
const detailSkeleton = document.querySelector<HTMLElement>("#detail-skeleton");
const detailError = document.querySelector<HTMLElement>("#detail-error");
const detailErrorTitle = document.querySelector<HTMLElement>("#detail-error-title");
const detailErrorMessage = document.querySelector<HTMLElement>("#detail-error-message");
const detailErrorRetry = document.querySelector<HTMLButtonElement>("#detail-error-retry");
const detailErrorBack = document.querySelector<HTMLButtonElement>("#detail-error-back");
const detailPlaybackNote = document.querySelector<HTMLElement>("#detail-playback-note");
const playerView = document.querySelector<HTMLElement>('[data-view="player"]');
const playerSurface = document.querySelector<HTMLElement>(".player-surface");
const playerSurfaceMessage = document.querySelector<HTMLElement>("#player-surface-message");
const playerCurrentTitle = document.querySelector<HTMLElement>("#player-current-title");
const playerCloseButton = document.querySelector<HTMLButtonElement>("#player-close-button");
const playerToggleButton = document.querySelector<HTMLButtonElement>("#player-toggle-button");
const playerSeek = document.querySelector<HTMLInputElement>("#player-seek");
const playerTime = document.querySelector<HTMLElement>("#player-time");
const playerFullscreenButton = document.querySelector<HTMLButtonElement>("#player-fullscreen-button");
const playerSubtitleFileButton = document.querySelector<HTMLButtonElement>("#player-subtitle-file-button");
const playerVolume = document.querySelector<HTMLInputElement>("#player-volume");
const playerMuteButton = document.querySelector<HTMLButtonElement>("#player-mute-button");
const playerStatus = document.querySelector<HTMLElement>("#player-status");
const playerControlNotice = document.querySelector<HTMLElement>("#player-control-notice");
const playerControlNoticeText = document.querySelector<HTMLElement>("#player-control-notice-text");
const playerError = document.querySelector<HTMLElement>("#player-error");
const playerErrorMessage = document.querySelector<HTMLElement>("#player-error-message");
const playerErrorRetry = document.querySelector<HTMLButtonElement>("#player-error-retry");
const playerErrorBack = document.querySelector<HTMLButtonElement>("#player-error-back");

let homeItems: LocalContinueWatchingItem[] = [];
let recentItems: LocalMediaItem[] = [];
let homeEpoch = 0;
const hero = document.querySelector<HTMLElement>("#home-hero");
const recentSection = document.querySelector<HTMLElement>("#recent-section");
const showsSection = document.querySelector<HTMLElement>("#shows-section");
const recentRow = document.querySelector<HTMLElement>("#recent-row");
const showsRow = document.querySelector<HTMLElement>("#shows-row");
const sidebar = document.querySelector<HTMLElement>("#sources-page");
const libraryContent = document.querySelector<HTMLElement>(".library-content");
const onboarding = document.querySelector<HTMLElement>("#onboarding");
const scanPanel = document.querySelector<HTMLElement>("#scan-panel");
const removeDialog = document.querySelector<HTMLDialogElement>("#remove-source-dialog");
const removeDialogTitle = document.querySelector<HTMLElement>("#remove-source-title");
const removeDialogCopy = document.querySelector<HTMLElement>("#remove-source-copy");
const removeDialogError = document.querySelector<HTMLElement>("#remove-source-error");
const removeCancelButton = document.querySelector<HTMLButtonElement>("#remove-source-cancel");
const removeConfirmButton = document.querySelector<HTMLButtonElement>("#remove-source-confirm");
const offlineDialog = document.querySelector<HTMLDialogElement>("#offline-source-dialog");
const offlineDialogTitle = document.querySelector<HTMLElement>("#offline-source-title");
const offlineDialogCopy = document.querySelector<HTMLElement>("#offline-source-copy");
const offlineDialogError = document.querySelector<HTMLElement>("#offline-source-error");
const offlineKeepButton = document.querySelector<HTMLButtonElement>("#offline-source-keep");
const offlineDeleteButton = document.querySelector<HTMLButtonElement>("#offline-source-delete");
const cleanupEntry = document.querySelector<HTMLButtonElement>("#cleanup-entry");
const cleanupSection = document.querySelector<HTMLElement>("#cleanup-section");
const cleanupSummary = document.querySelector<HTMLElement>("#cleanup-summary");
const cleanupMessage = document.querySelector<HTMLElement>("#cleanup-message");
const cleanupCandidates = document.querySelector<HTMLElement>("#cleanup-candidates");
const cleanupEmpty = document.querySelector<HTMLElement>("#cleanup-empty");
const cleanupEmptyTitle = document.querySelector<HTMLElement>("#cleanup-empty-title");
const cleanupEmptyMessage = document.querySelector<HTMLElement>("#cleanup-empty-message");
const cleanupQueueBar = document.querySelector<HTMLElement>("#cleanup-queue-bar");
const cleanupDeleteSummary = document.querySelector<HTMLElement>("#cleanup-delete-summary");
const cleanupViewDelete = document.querySelector<HTMLButtonElement>("#cleanup-view-delete");
const cleanupPagination = document.querySelector<HTMLElement>("#cleanup-pagination");
const cleanupRuleFilters = document.querySelector<HTMLElement>("#cleanup-rule-filters");
const cleanupStateFilters = document.querySelector<HTMLElement>("#cleanup-state-filters");
const cleanupSettingsDialog = document.querySelector<HTMLDialogElement>("#cleanup-settings-dialog");
const cleanupSettingsError = document.querySelector<HTMLElement>("#cleanup-settings-error");
const cleanupSettingsPreview = document.querySelector<HTMLElement>("#cleanup-preview");
const cleanupSettingsSummaryHost = document.querySelector<HTMLElement>("#cleanup-settings-summary");
const cleanupDeleteDialog = document.querySelector<HTMLDialogElement>("#cleanup-delete-dialog");
const cleanupDeleteDialogSummary = document.querySelector<HTMLElement>("#cleanup-delete-dialog-summary");
const cleanupDeleteList = document.querySelector<HTMLElement>("#cleanup-delete-list");
const cleanupDeleteMessage = document.querySelector<HTMLElement>("#cleanup-delete-message");
const reviewDecisionDialog = document.querySelector<HTMLDialogElement>("#review-decision-dialog");
const reviewDecisionTitle = document.querySelector<HTMLElement>("#review-decision-title");
const reviewDecisionFacts = document.querySelector<HTMLElement>("#review-decision-facts");
const reviewDecisionError = document.querySelector<HTMLElement>("#review-decision-error");
const reviewKeepButton = document.querySelector<HTMLButtonElement>("#review-keep");
const reviewSnoozeButton = document.querySelector<HTMLButtonElement>("#review-snooze");
const reviewDeleteButton = document.querySelector<HTMLButtonElement>("#review-delete");
const reviewBackButton = document.querySelector<HTMLButtonElement>("#review-back");
const reviewRetryButton = document.querySelector<HTMLButtonElement>("#review-retry");
let removingSourceId: string | undefined;
let offlineSourceId: string | undefined;
let sourceDialogBusy = false;
const singleVideoSourceIds = new Set<string>();
let state: LocalLibraryState | undefined;
type LibraryPageView =
  | { mode: "collection"; items: LocalCollectionSummary[]; totalCount: number; page: number; pageSize: number }
  | { mode: "media"; items: LocalMediaItem[]; totalCount: number; page: number; pageSize: number };
let activePage: LibraryPageView | undefined;
let libraryLoadedOnce = false;
/** Ticket 20 / F-04: one in-flight initialization retry and its failed attempts. */
let libraryRetryBusy = false;
let libraryRetryAttempts = 0;
let activeDetail: LocalMediaDetail | undefined;
let selectedMediaId: string | undefined;
type DetailOriginKind = "home" | "library" | "episodes" | "search";
interface DetailOrigin {
  kind: DetailOriginKind;
  nav: string | undefined;
  scrollTop: number;
  windowScrollY: number;
  focusMediaId: string | undefined;
  focusContainerId: "#library-grid" | "#recent-row" | "#shows-row" | "#search-grid" | "#continue-row" | undefined;
  focusControlId: string | undefined;
}
let detailOrigin: DetailOrigin | undefined;
let detailSearchFormOpen = false;
let detailRequestMediaId: string | undefined;
let detailFlightStarted = false;
let detailRenderCount = 0;
let previousWatchedIds = new Set<string>();
let firstContentMotionPlayed = false;
type SearchOriginKind = "home" | "library" | "episodes" | "sources" | "detail";
interface SearchOrigin {
  kind: SearchOriginKind;
  nav: string | undefined;
  libraryQuery: LocalLibraryQuery;
  /** The base surface search was entered from, restored when search is left. */
  base: BaseView;
  scrollTop: number;
  windowScrollY: number;
  focusMediaId: string | undefined;
  focusControlId: string | undefined;
  detail: { mediaId: string; episodeId: string | undefined; origin: DetailOrigin | undefined } | undefined;
}
let searchQuery: string | undefined;
let searchFilter: LocalLibraryFilter = "all";
let searchPage = 1;
/** Ticket 12: the last rendered search page, so the pager knows its total. */
let searchPageView: { totalCount: number; page: number; pageSize: number } | undefined;
let searchOrigin: SearchOrigin | undefined;
/**
 * Ticket 18: one request generation per semantic domain. Opening a detail must
 * not discard an in-flight list load, closing one must not discard a search, and
 * a scan refresh may only replace the list it was queued for. `requestEpoch`
 * guarded all three domains at once and made them invalidate each other.
 */
let libraryEpoch = 0;
let searchEpoch = 0;
let detailEpoch = 0;
/** In-flight requests per domain, so a discarded request cannot latch `aria-busy`. */
type RequestDomain = "library" | "search" | "detail";
const inFlightRequests: Record<RequestDomain, number> = { library: 0, search: 0, detail: 0 };
function finishRequest(domain: RequestDomain): number {
  inFlightRequests[domain] = Math.max(0, inFlightRequests[domain] - 1);
  return inFlightRequests[domain];
}
let continueEpoch = 0;
let scanId: string | undefined;
let scanProgress: LocalScanProgress | undefined;
/**
 * Ticket 08: a finished scan stops owning `scanProgress`; the last result stays
 * on the home card instead of keeping the scan panel mounted.
 */
let lastScanSummary: { progress: LocalScanProgress & { error?: string }; elapsedMs: number | undefined } | undefined;
/**
 * The terminal scan notice owns the status and counts while it is on screen, so
 * the home result card only takes over after that notice is dismissed. This
 * keeps one summary on one surface instead of two.
 */
let pendingScanSummary = false;
let scanStartedAtMs: number | undefined;
let scanStartedScanId: string | undefined;
let scanElapsedTimer: number | undefined;
let scanRefreshTimer: number | undefined;
let scanRefreshInFlight = false;
let scanRefreshQueued = false;
let scanCommit = 0;
let scanRenderedCommit = -1;
let sourceBusy = false;
const playerNextButton = document.querySelector<HTMLButtonElement>("#player-next-button");
const playerEnded = document.querySelector<HTMLElement>("#player-ended");
const playerEndedTitle = document.querySelector<HTMLElement>("#player-ended-title");
const playerNextTitle = document.querySelector<HTMLElement>("#player-next-title");
const playerNextMeta = document.querySelector<HTMLElement>("#player-next-meta");
const playerCountdown = document.querySelector<HTMLElement>("#player-countdown");
const playerCountdownRing = document.querySelector<HTMLElement>("#player-countdown-ring");
const playerCountdownAnnouncement = document.querySelector<HTMLElement>("#player-countdown-announcement");
const playerPlayNext = document.querySelector<HTMLButtonElement>("#player-play-next");
const playerCancelNext = document.querySelector<HTMLButtonElement>("#player-cancel-next");
const playerReplay = document.querySelector<HTMLButtonElement>("#player-replay");
const playerReturnList = document.querySelector<HTMLButtonElement>("#player-return-list");
const playerSettings = document.querySelector<HTMLElement>("#player-settings");
const playerSettingsButton = document.querySelector<HTMLButtonElement>("#player-settings-button");
let nextTimer: number | undefined;
/**
 * Ticket 06: one playback session has exactly one exit. `playerSessionOpen`
 * marks a live session, `playerClosing` marks a close that awaits main's
 * `closed`, and the fallback timer tears the view down once if that event is
 * lost. `handlePlayerClosed()` is the only teardown and is idempotent.
 */
let playerSessionOpen = false;
let playerClosing = false;
let playerCloseFallback: number | undefined;
let playerState: "playing" | "paused" | "buffering" | "ended" = "paused";
let playerDurationSec = 0;
/**
 * Ticket 20 / P-07: the last position main reported. A failed seek rolls the
 * slider back to this value instead of leaving an optimistic position on screen.
 */
let playerPositionSec = 0;
let playerControlNoticeTimer: number | undefined;
let playerFullscreen = false;
let playerMuted = false;
let playerMuteCommandValue: boolean | undefined;
let playerVolumeLevel = 100;
let playerVolumeDragging = false;
let playerVolumeRestoreAfterDrag = false;
let playerSpeedValue = 1;
type PlayerMenuKind = "speed" | "audio" | "subtitle";
interface PlayerMenuTrack { id: string; label: string; selected?: boolean }
const PLAYER_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
let playerAudioTracks: PlayerMenuTrack[] = [];
let playerSubtitleTracks: PlayerMenuTrack[] = [];
let activePlaybackTitle = "";
let activeDetailPlayback: LocalPlaybackState | undefined;
let selectedSeason: number | undefined;
const continuePlaybackByMediaId = new Map<string, LocalPlaybackState>();

let currentQuery: LocalLibraryQuery = { page: 1, pageSize: PAGE_SIZE, filter: "all", sort: "recent" };

/**
 * Desktop feel: the app is not a web page. Suppress the browser context menu,
 * native drag and block text selection outside editable controls.
 */
function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, [contenteditable='true']"));
}
document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("dragstart", (event) => event.preventDefault());
document.addEventListener("selectstart", (event) => {
  if (!isTextEntry(event.target)) event.preventDefault();
});

const LIBRARY_SORT_OPTIONS: Array<{ value: LocalSort; label: string }> = [
  { value: "recent", label: "最近观看" },
  { value: "added_desc", label: "最近加入" },
  { value: "released_desc", label: "最近发布" },
  { value: "title", label: "标题" },
  { value: "year_desc", label: "年份" },
  { value: "score_desc", label: "评分" },
];
const sortMenuContainer = document.querySelector<HTMLElement>("#library-sort-menu");
const sortMenuTrigger = document.querySelector<HTMLButtonElement>("#library-sort-trigger");
const sortMenuPopover = document.querySelector<HTMLElement>("#library-sort-options");
const sortMenuValue = document.querySelector<HTMLElement>("#library-sort-value");
const sortListbox = sortMenuContainer && sortMenuTrigger && sortMenuPopover ? new AppListbox({
  container: sortMenuContainer,
  trigger: sortMenuTrigger,
  popover: sortMenuPopover,
  getOptions: (): AppListboxOption[] => {
    const active = currentQuery.sort ?? "recent";
    return LIBRARY_SORT_OPTIONS.map((option) => ({
      id: `library-sort-option-${option.value}`,
      label: option.label,
      value: option.value,
      selected: option.value === active,
    }));
  },
  hooks: {
    onSelect: (value) => {
      const sort = value as LocalSort;
      applyQuery({ sort, page: 1 });
      // Ticket 12: ordering is part of the result identity, so an active search
      // restarts at page 1 with the new order.
      if (isSearchBase()) { searchPage = 1; void loadSearch(); }
      void window.zVideo.appPreferences.setSort(sort).catch(() => setMessage("排序偏好保存失败，本次排序仍已应用。", true));
    },
  },
}) : undefined;
sortListbox?.render();

interface ArtworkTask {
  element: HTMLElement;
  mediaId: string;
  kind: LocalArtworkReference["kind"];
  priority: number;
  generation: string;
}

const artworkQueue: ArtworkTask[] = [];
const artworkRequests = new Map<string, Promise<Awaited<ReturnType<typeof window.zVideo.localLibrary.getArtwork>>>>();
let artworkActive = 0;
let artworkObserver: IntersectionObserver | undefined;

type LocalSort = LocalLibrarySort;

function setMessage(message: string, error = false): void {
  if (!libraryMessage) return;
  libraryMessage.textContent = message;
  libraryMessage.dataset.state = error ? "error" : "normal";
  const sourcesMessage = document.querySelector<HTMLElement>("#sources-message");
  if (sourcesMessage) { sourcesMessage.textContent = message; sourcesMessage.dataset.state = error ? "error" : "normal"; }
}

/**
 * Ticket 15: one view model instead of fourteen navigation functions each
 * writing `hidden`. `baseView` is the mutually exclusive page surface;
 * `layers` stack on top of it. `player` is the modal layer: it hides the app
 * shell and keeps the base surface and the other layers mounted underneath.
 * `applyView()` is the only writer of these containers; navigation functions
 * only change `baseView`/`layers`.
 */
type BaseView = "home" | "library" | "sources" | "search";
interface ViewLayers { cleanup: boolean; detail: boolean; player: boolean }

let baseView: BaseView = "home";
let layers: ViewLayers = { cleanup: false, detail: false, player: false };

function isHomeBase(): boolean { return baseView === "home"; }
function isSearchBase(): boolean { return baseView === "search"; }
function isDetailLayerOpen(): boolean { return layers.detail; }
function isPlayerLayerOpen(): boolean { return layers.player; }
function isCleanupLayerOpen(): boolean { return layers.cleanup; }
function isDetailOrPlayerVisible(): boolean { return layers.detail || layers.player; }

function setView(next: { baseView?: BaseView; layers?: Partial<ViewLayers> }): void {
  if (next.baseView) baseView = next.baseView;
  if (next.layers) layers = { ...layers, ...next.layers };
}

function hasRowContent(row: HTMLElement | null): boolean {
  return Boolean(row && row.childElementCount > 0);
}

/**
 * The only place that derives a `hidden` value for a view container. Everything
 * below is a pure read of `baseView`, `layers` and the loaded data, so a cleared
 * error state can restore the home blocks without another navigation.
 */
function applyView(): void {
  const error = state?.status === "error";
  const detailOpen = layers.detail;
  const cleanupOpen = layers.cleanup;
  const playerOpen = layers.player;

  // The player is modal: the shell is hidden but never unmounted.
  if (appShell) appShell.hidden = playerOpen;
  if (playerView) playerView.hidden = !playerOpen;

  // Base surfaces are mutually exclusive.
  if (sidebar) sidebar.hidden = baseView !== "sources";
  if (libraryContent) libraryContent.hidden = baseView === "sources";

  // Layers stack above the base surface.
  if (detail) detail.hidden = !detailOpen;
  if (searchSection) searchSection.hidden = baseView !== "search" || detailOpen;
  if (cleanupSection) cleanupSection.hidden = !cleanupOpen;
  if (collectionSection) collectionSection.hidden = baseView !== "library" || detailOpen || cleanupOpen || error;

  // Home chrome is derived, so clearing the error state restores it by itself.
  const homeSurface = isHomeBase() && !error && !detailOpen && !cleanupOpen;
  const heroItem = homeItems[0]?.item ?? recentItems[0];
  if (hero) hero.hidden = !homeSurface || !heroItem;
  if (continueSection) continueSection.hidden = !homeSurface || homeItems.length === 0 || Boolean(currentQuery.sourceId);
  if (recentSection) recentSection.hidden = !homeSurface || !hasRowContent(recentRow);
  if (showsSection) showsSection.hidden = !homeSurface || !hasRowContent(showsRow);
  if (onboarding) onboarding.hidden = !(homeSurface && activePage?.totalCount === 0 && !currentQuery.query);
  updateOfflineNotice();
}

/**
 * Ticket 08: a degraded source read some of its directories, so its indexed
 * entries still play. Only `available === false` means offline.
 */
function updateOfflineNotice(): void {
  if (!libraryOfflineNotice) return;
  const sources = state?.status !== "error" ? (state?.sources ?? []) : [];
  const offline = sources.filter((source) => !source.available);
  const degraded = sources.filter((source) => source.available && source.degraded);
  const visible = (offline.length > 0 || degraded.length > 0) && !isHomeBase() && !layers.detail && !layers.player && !layers.cleanup;
  libraryOfflineNotice.hidden = !visible;
  if (!visible) return;
  if (libraryOfflineText) {
    if (offline.length > 0) {
      libraryOfflineText.textContent = offline.length === 1
        ? `「${offline[0].label}」文件夹离线，其中的作品暂时不能播放。重新连接驱动器或网络位置后，在文件夹页重新扫描。`
        : `${offline.length} 个文件夹离线，其中的作品暂时不能播放。重新连接驱动器或网络位置后，在文件夹页重新扫描。`;
    } else {
      // Degraded is not offline: playback still works, only the unread
      // directories are missing from the index.
      libraryOfflineText.textContent = degraded.length === 1
        ? `「${degraded[0].label}」中有部分目录这次没读到；已加入的作品仍可播放，接回这些目录后在文件夹页重新扫描可补齐。`
        : `${degraded.length} 个文件夹中有部分目录这次没读到；已加入的作品仍可播放，接回这些目录后在文件夹页重新扫描可补齐。`;
    }
  }
}

function detailPlayback(detailValue: LocalMediaDetail): LocalPlaybackState | undefined {
  const candidate = detailValue.playback;
  if (candidate?.mediaId === detailValue.item.mediaId) return candidate;
  const perEpisode = detailValue.episodePlayback?.find((state) => state.mediaId === detailValue.item.mediaId);
  return perEpisode ?? continuePlaybackByMediaId.get(detailValue.item.mediaId);
}

function hasResume(playback: LocalPlaybackState | undefined): playback is LocalPlaybackState {
  return Boolean(playback && playback.positionSec > 0 && !playback.watched);
}

/** The only shared-element source allowed by B6b: a work card on the home view. */
function detailFlightSource(target: HTMLElement | undefined): HTMLElement | undefined {
  if (!target || !isHomeBase()) return undefined;
  if (target.id === "hero-detail") return document.querySelector<HTMLElement>("#hero-poster") ?? undefined;
  if (!target.closest("#recent-row, #shows-row, #continue-row")) return undefined;
  return target.querySelector<HTMLElement>(".media-poster, .continue-image") ?? undefined;
}

/** Resolve the home card after the shelves have re-rendered on return. */
function detailReturnTarget(origin: DetailOrigin): HTMLElement | null {
  if (origin.focusControlId === "#hero-detail") return document.querySelector<HTMLElement>("#hero-poster");
  if (!origin.focusMediaId || !origin.focusContainerId) return null;
  const selector = `${origin.focusContainerId} [data-media-id="${cssEscape(origin.focusMediaId)}"]`;
  const card = document.querySelector<HTMLElement>(selector);
  return card?.querySelector<HTMLElement>(".media-poster, .continue-image") ?? null;
}

/** B6b ⑤ · the first work of a session enters once for 420ms, never per card. */
function playFirstContentMotion(element: HTMLElement | null | undefined): void {
  if (!element || firstContentMotionPlayed || !motionAllowsTransform() || scanProgress?.status === "running") return;
  firstContentMotionPlayed = true;
  element.classList.add("mo-first-content");
  const cleanup = () => {
    element.classList.remove("mo-first-content");
    element.removeEventListener("animationend", cleanup);
  };
  element.addEventListener("animationend", cleanup);
}

/** B6b ② · a count rises 6px and fades in; the surrounding row never reflows. */
function animateCount(element: HTMLElement | null | undefined): void {
  if (!element || !motionAllowsTransform()) return;
  element.classList.remove("mo-count-rise");
  void element.offsetWidth;
  element.classList.add("mo-count-rise");
  const cleanup = () => {
    element.classList.remove("mo-count-rise");
    element.removeEventListener("animationend", cleanup);
  };
  element.addEventListener("animationend", cleanup);
}

type EmptyAction = "add-folder" | "add-video" | "rescan" | "view-all" | "clear-search" | "formats";

function currentEmptyState(totalCount: number): { title: string; message: string; actions: Set<EmptyAction> } {
  const filter = currentQuery.filter ?? "all";
  if (currentQuery.query) {
    return {
      title: "没有匹配结果",
      // B5a's search view owns cross-type search; a library-scoped query only needs clearing here.
      message: filter !== "all"
        ? `当前只在「${filterLabel(filter)}」里搜索。缩短关键词或清除搜索。`
        : "换一个更短的关键词，或清除搜索。搜索会检查作品名、剧名与单集名，不会改动你的文件。",
      actions: new Set<EmptyAction>(["clear-search"]),
    };
  }
  if (filter !== "all") {
    return { title: "当前类型没有媒体", message: "切换类型或查看全部媒体。", actions: new Set<EmptyAction>(["view-all"]) };
  }
  if (scanProgress?.status === "running") {
    return {
      title: "正在扫描本地来源",
      message: `已提交 ${scanProgress.importedFiles + scanProgress.updatedFiles} 项，新条目会在扫描中陆续显示。`,
      actions: new Set<EmptyAction>(),
    };
  }
  if (state?.sources.length === 0) {
    return {
      title: "还没有本地来源",
      message: "选择一个文件夹开始索引，或直接打开一个视频文件。",
      actions: new Set<EmptyAction>(["add-folder", "add-video"]),
    };
  }
  if (totalCount === 0) {
    return {
      title: "这个文件夹还没有支持的视频",
      message: "重新扫描这个文件夹、添加其他文件夹，或先查看支持的格式。",
      actions: new Set<EmptyAction>(["rescan", "add-folder", "formats"]),
    };
  }
  return { title: "暂无内容", message: "选择一个本地来源开始索引。", actions: new Set<EmptyAction>(["add-folder"]) };
}

function filterLabel(filter: NonNullable<LocalLibraryQuery["filter"]>): string {
  return ({ all: "全部类型", movie: "电影", show: "剧集", episode: "单集", unclassified: "未分类" })[filter];
}

/** "单集" keeps the file-level list; every other filter is work-level. */
function usesCollectionList(): boolean {
  return (currentQuery.filter ?? "all") !== "episode";
}

function currentCollectionQuery(): LocalCollectionQuery {
  const { filter, ...rest } = currentQuery;
  return { ...rest, ...(filter && filter !== "episode" ? { filter } : {}) };
}

function updateEmptyState(totalCount: number): void {
  const copy = currentEmptyState(totalCount);
  if (libraryEmptyTitle) libraryEmptyTitle.textContent = copy.title;
  if (libraryEmptyMessage) libraryEmptyMessage.textContent = copy.message;
  const has = (action: EmptyAction) => copy.actions.has(action);
  if (emptyAddFolder) emptyAddFolder.hidden = !has("add-folder");
  if (emptyAddVideo) emptyAddVideo.hidden = !has("add-video");
  if (emptyRescan) emptyRescan.hidden = !has("rescan");
  if (emptyViewAll) emptyViewAll.hidden = !has("view-all");
  if (emptyClearSearch) emptyClearSearch.hidden = !has("clear-search");
  if (emptyFormats) {
    emptyFormats.hidden = !has("formats");
    if (emptyFormats.hidden) emptyFormats.open = false;
  }
}

/** B5a: one explicit search destination instead of filtering the current page. */
function setNavCurrent(nav: string | undefined): void {
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    if (nav && button.dataset.nav === nav) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function searchOriginLabel(kind: SearchOriginKind | undefined): string {
  return kind === "home" ? "首页" : kind === "episodes" ? "单集列表" : kind === "sources" ? "文件夹" : kind === "detail" ? "详情" : "片库";
}

function updateHeaderSearch(): void {
  const detailVisible = isDetailLayerOpen();
  const showForm = !detailVisible || detailSearchFormOpen;
  if (searchForm) searchForm.hidden = !showForm;
  if (detailSearchEntry) detailSearchEntry.hidden = !detailVisible || detailSearchFormOpen;
}

function updateSearchFilterPressed(): void {
  searchFilterButtons?.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === searchFilter));
  });
}

function updateSearchChrome(): void {
  if (searchTitle) searchTitle.textContent = `搜索「${searchQuery ?? ""}」`;
  if (searchBackButton) searchBackButton.textContent = `返回${searchOriginLabel(searchOrigin?.kind)} · 清空搜索`;
  if (searchBackPath) {
    const originQuery = searchOrigin?.libraryQuery;
    const filter = originQuery?.filter ?? "all";
    const page = originQuery?.page ?? 1;
    const parts = [searchOriginLabel(searchOrigin?.kind), filter !== "all" ? filterLabel(filter) : "", page > 1 ? `第 ${page} 页` : ""].filter(Boolean);
    searchBackPath.textContent = `搜索前：${parts.join(" · ")}`;
  }
  updateSearchFilterPressed();
}

function captureSearchOrigin(): SearchOrigin {
  const focused = document.activeElement;
  const detailVisible = isDetailLayerOpen();
  const kind: SearchOriginKind = detailVisible
    ? "detail"
    : baseView === "sources"
      ? "sources"
      : isHomeBase()
        ? "home"
        : (currentQuery.filter ?? "all") === "episode"
          ? "episodes"
          : "library";
  return {
    kind,
    nav: document.querySelector<HTMLButtonElement>("[data-nav][aria-current='page']")?.dataset.nav,
    libraryQuery: { ...currentQuery },
    base: baseView,
    scrollTop: libraryContent?.scrollTop ?? 0,
    windowScrollY: document.scrollingElement?.scrollTop ?? window.scrollY,
    focusMediaId: focused instanceof HTMLElement && focused.dataset.mediaId ? focused.dataset.mediaId : undefined,
    focusControlId: focused instanceof HTMLElement && focused.id ? `#${CSS.escape(focused.id)}` : undefined,
    detail: detailVisible
      ? { mediaId: activeDetail?.item.mediaId ?? selectedMediaId ?? "", episodeId: selectedMediaId, origin: detailOrigin }
      : undefined,
  };
}

function showSearchView(): void {
  setView({ baseView: "search", layers: { detail: false, cleanup: false } });
  cleanupRequestEpoch += 1;
  detailSearchFormOpen = false;
  applyView();
  updateHeaderSearch();
  updateScanUi();
}

function showSearchFailure(message: string): void {
  if (searchGrid) searchGrid.replaceChildren();
  if (searchPagination) {
    searchPagination.replaceChildren();
    searchPagination.hidden = true;
  }
  searchPageView = undefined;
  if (searchEmpty) searchEmpty.hidden = false;
  if (searchEmptyTitle) searchEmptyTitle.textContent = "搜索暂时不可用";
  if (searchEmptyMessage) searchEmptyMessage.textContent = `${message} 结果已清空；这是读取失败，不代表没有匹配作品。`;
  if (searchAllTypesButton) searchAllTypesButton.hidden = true;
  // Ticket 20 / F-05: a read failure is not a result count. Saying "共 0 部作品"
  // next to "暂时不可用" reads as "the search really found nothing", and the
  // only retry was pressing Enter again with no hint.
  if (searchEmptyRetry) searchEmptyRetry.hidden = false;
  if (searchCount) searchCount.textContent = `读取失败，未得到结果数 · ${filterLabel(searchFilter)}`;
  setMessage(message, true);
}

function renderSearchPage(page: { mode: "collection"; items: LocalCollectionSummary[]; totalCount: number; page: number; pageSize: number } | { mode: "media"; items: LocalMediaItem[]; totalCount: number; page: number; pageSize: number }): void {
  if (!searchGrid) return;
  artworkObserver?.disconnect();
  searchPage = page.page;
  const includeReleaseDate = currentQuery.sort === "released_desc";
  const cards = page.mode === "collection"
    ? page.items.map((collection) => collectionCard(collection, includeReleaseDate, { showMatchedEpisode: true }))
    : page.items.map((item) => card(item, includeReleaseDate));
  searchGrid.replaceChildren(...cards);
  if (searchCount) searchCount.textContent = `${countLabel(page.totalCount, page.mode === "collection" ? "部作品" : "集", page.page, page.pageSize)} · ${filterLabel(searchFilter)}`;
  animateCount(searchCount);
  // Ticket 12: the search result set pages through the same control as the list.
  searchPageView = { totalCount: page.totalCount, page: page.page, pageSize: page.pageSize };
  renderPager("search", searchPageView);
  const empty = page.items.length === 0;
  if (searchEmpty) searchEmpty.hidden = !empty;
  if (empty) {
    if (searchEmptyTitle) searchEmptyTitle.textContent = `搜索「${searchQuery ?? ""}」没有找到作品`;
    if (searchEmptyMessage) {
      searchEmptyMessage.textContent = searchFilter !== "all"
        ? `当前只在「${filterLabel(searchFilter)}」里搜索。可以扩大到全部类型，或清空搜索回到${searchOriginLabel(searchOrigin?.kind)}。`
        : `试试更短的关键词，或清空搜索回到${searchOriginLabel(searchOrigin?.kind)}。`;
    }
  }
  if (searchAllTypesButton) searchAllTypesButton.hidden = !(empty && searchFilter !== "all");
  if (searchEmptyRetry) searchEmptyRetry.hidden = true;
  observeArtworkGrid(searchGrid);
}

async function loadSearch(): Promise<void> {
  if (!isSearchBase() || !searchQuery) return;
  const epoch = ++searchEpoch;
  inFlightRequests.search += 1;
  const filter = searchFilter;
  if (searchGrid) {
    searchGrid.replaceChildren();
    searchGrid.setAttribute("aria-busy", "true");
  }
  if (searchEmpty) searchEmpty.hidden = true;
  // Ticket 12: the pager never mirrors a page that is no longer on screen.
  searchPageView = undefined;
  if (searchPagination) {
    searchPagination.replaceChildren();
    searchPagination.hidden = true;
  }
  if (searchCount) searchCount.textContent = `正在搜索「${searchQuery}」…`;
  try {
    if (filter === "episode") {
      const result = await window.zVideo.localLibrary.list({ page: searchPage, pageSize: PAGE_SIZE, query: searchQuery, filter, sort: currentQuery.sort ?? "recent" });
      if (epoch !== searchEpoch) return;
      renderState(result.state);
      if (!result.page) {
        showSearchFailure("搜索暂时不可用，请稍后重试。");
        return;
      }
      renderSearchPage({ mode: "media", ...result.page });
      return;
    }
    const result = await window.zVideo.localLibrary.listCollections({ page: searchPage, pageSize: PAGE_SIZE, query: searchQuery, ...(filter !== "all" ? { filter } : {}), sort: currentQuery.sort ?? "recent" });
    if (epoch !== searchEpoch) return;
    renderState(result.state);
    if (!result.page) {
      showSearchFailure("搜索暂时不可用，请稍后重试。");
      return;
    }
    renderSearchPage({ mode: "collection", ...result.page });
  } catch (error) {
    if (epoch === searchEpoch) showSearchFailure(error instanceof Error ? error.message : "搜索暂时不可用，请稍后重试。");
  } finally {
    // Ticket 18: a discarded search still clears its own busy carrier.
    if (finishRequest("search") === 0) searchGrid?.removeAttribute("aria-busy");
  }
}

async function enterSearch(query: string): Promise<void> {
  const text = query.trim();
  if (!text) return;
  const detailVisible = isDetailLayerOpen();
  if (!isSearchBase() || detailVisible) {
    searchOrigin = captureSearchOrigin();
    searchFilter = searchOrigin.libraryQuery.filter ?? "all";
  }
  // Ticket 12: a new term starts at page 1 even when a search view is already open.
  if (text !== searchQuery) searchPage = 1;
  searchQuery = text;
  if (searchInput) searchInput.value = text;
  if (searchClear) searchClear.hidden = false;
  showSearchView();
  updateSearchChrome();
  if (libraryContent) libraryContent.scrollTop = 0;
  const scroller = document.scrollingElement;
  if (scroller) scroller.scrollTop = 0;
  else window.scrollTo(0, 0);
  await loadSearch();
}

function exitSearchState(): void {
  // Ticket 18: leaving search invalidates only the search domain, and the
  // busy carrier is cleared here instead of being left for a discarded request.
  searchEpoch += 1;
  // Leaving search restores the base surface it was entered from.
  setView({ baseView: searchOrigin?.base ?? "library" });
  searchQuery = undefined;
  searchOrigin = undefined;
  searchPage = 1;
  searchPageView = undefined;
  if (searchGrid) {
    searchGrid.replaceChildren();
    searchGrid.removeAttribute("aria-busy");
  }
  if (searchPagination) {
    searchPagination.replaceChildren();
    searchPagination.hidden = true;
  }
  if (searchEmpty) searchEmpty.hidden = true;
  if (searchInput) searchInput.value = "";
  if (searchClear) searchClear.hidden = true;
  detailSearchFormOpen = false;
  applyView();
  updateHeaderSearch();
}

async function clearSearch(): Promise<void> {
  if (!isSearchBase()) {
    if (searchInput) searchInput.value = "";
    if (searchClear) searchClear.hidden = true;
    return;
  }
  const origin = searchOrigin;
  exitSearchState();
  if (!origin) {
    navigateHomeOrLibrary("all");
    return;
  }
  currentQuery = { ...origin.libraryQuery };
  syncQueryControls();
  if (origin.kind === "detail" && origin.detail?.mediaId) {
    await openDetail(origin.detail.mediaId, undefined, origin.detail.origin);
    if (origin.detail.episodeId && activeDetail?.episodes.some((episode) => episode.mediaId === origin.detail?.episodeId)) {
      selectedMediaId = origin.detail.episodeId;
      renderDetail(activeDetail);
    }
    return;
  }
  if (origin.kind === "sources") {
    showSources();
    currentQuery = { ...origin.libraryQuery };
    syncQueryControls();
  } else if (origin.kind === "home") {
    setView({ baseView: "home" });
    applyView();
    setNavCurrent(origin.nav ?? "home");
    await Promise.all([loadContinueWatching(), loadHomeShelves()]);
  } else {
    setView({ baseView: "library" });
    applyView();
    setNavCurrent(origin.nav ?? "all");
    await loadLibrary();
  }
  if (libraryContent) libraryContent.scrollTop = origin.scrollTop;
  const scroller = document.scrollingElement;
  if (scroller) scroller.scrollTop = origin.windowScrollY;
  else window.scrollTo(0, origin.windowScrollY);
  const focusTarget = origin.focusControlId
    ? document.querySelector<HTMLElement>(origin.focusControlId)
    : origin.focusMediaId
      ? document.querySelector<HTMLElement>(`#library-grid [data-media-id="${cssEscape(origin.focusMediaId)}"]`)
      : undefined;
  focusTarget?.focus({ preventScroll: true });
}

function preserveGridFocus(): string | undefined {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && focused.closest("#library-grid") ? focused.dataset.mediaId : undefined;
}

function restoreGridFocus(mediaId: string | undefined): void {
  if (!mediaId) return;
  document.querySelector<HTMLButtonElement>(`#library-grid [data-media-id="${cssEscape(mediaId)}"]`)?.focus({ preventScroll: true });
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

async function restoreSortPreference(): Promise<void> {
  try {
    const result = await window.zVideo.appPreferences.get();
    if (isLocalLibrarySort(result.sort)) setQuery({ sort: result.sort, page: 1 });
  } catch {
    // Missing or malformed settings fall back to the local recent sort.
  }
}

function showPlayer(visible: boolean): void {
  const wasVisible = isPlayerLayerOpen();
  if (visible) {
    // Ticket 06: showing the player always starts (or restarts) one session, so
    // a late event from a torn-down session can never reopen this view.
    playerSessionOpen = true;
    playerClosing = false;
    clearPlayerCloseFallback();
  }
  setView({ layers: { player: visible } });
  applyView();
  const nextTitle = visible ? activePlaybackTitle : "";
  if (playerCurrentTitle && playerCurrentTitle.textContent !== nextTitle) playerCurrentTitle.textContent = nextTitle;
  if (visible && !wasVisible) {
    // Playback never waits for a transition: a click during the home → detail
    // flight drops the flight and shows the player immediately.
    skipFlight();
    playerSurface?.focus();
    fadeIn(document.querySelector<HTMLElement>(".player-shell"), motionDuration("--mo-2", 140));
  }
  if (wasVisible !== visible) {
    window.zVideo.overlay.visible(visible);
    if (visible) {
      // Ticket 06: the overlay document is cleared while it is hidden, so every
      // reopen needs one full structural push instead of a values-only diff.
      markPlayerUiStructureChanged();
      sendOverlayState();
    }
  }
  // Ticket 18: the player is the overlay that can hide the list from a finished
  // scan; closing it consumes the refresh that scan queued.
  if (wasVisible && !visible) consumeScanRefresh();
  updateScanUi();
}

type PlayerOrigin = "detail" | "home" | "cleanup";
let playerOrigin: PlayerOrigin = "detail";
let playerOriginScroll = 0;
let playerReturnToDetail = false;
let playerUiRevision = 0;
let playerOverlayFocusId: string | undefined;

/**
 * A3 review mode: one candidate opened from the cleanup queue. The snapshot is
 * the A1 ledger record carried by the queue card; the renderer never derives
 * counts or accumulated time from playback events.
 */
interface ReviewTarget {
  mediaId: `media_${string}`;
  title: string;
  viewing?: LocalViewingHistory;
  returnQuery: LocalCleanupQueueQuery;
}
let reviewTarget: ReviewTarget | undefined;
let reviewPendingState: ReviewDecision | undefined;

function playerOriginLabel(origin: PlayerOrigin = playerOrigin): string {
  if (origin === "cleanup") return "返回整理";
  return origin === "detail" ? "返回详情" : "返回首页";
}

function markPlayerUiStructureChanged(): void {
  playerUiRevision += 1;
}

function setPlayerOverlayFocus(id: string | undefined): void {
  playerOverlayFocusId = id;
  sendOverlayState();
}

/** A3: the strip lives in the mirrored player heading, so the overlay sees it too. */
function updateReviewBar(): void {
  const bar = document.getElementById("player-review-bar");
  const facts = document.getElementById("player-review-facts");
  if (!bar || !facts) return;
  const target = reviewTarget;
  bar.hidden = !target || !isPlayerLayerOpen();
  facts.textContent = target ? reviewFactsText(target.viewing, Date.now()) : "";
  if (isPlayerLayerOpen()) {
    markPlayerUiStructureChanged();
    sendOverlayState();
  }
}

/** Remember whether playback started from the detail view, home or cleanup. */
function recordPlayerOrigin(): void {
  playerOrigin = reviewTarget ? "cleanup" : isDetailLayerOpen() ? "detail" : "home";
  playerOriginScroll = document.scrollingElement?.scrollTop ?? window.scrollY;
  const label = playerOriginLabel();
  const closeLabel = document.getElementById("player-close-label");
  if (closeLabel) closeLabel.textContent = label;
  playerCloseButton?.setAttribute("aria-label", label);
  const errorBackLabel = document.getElementById("player-error-back-label");
  if (errorBackLabel) errorBackLabel.textContent = label;
  markPlayerUiStructureChanged();
}

function restorePlayerOriginScroll(): void {
  const scroller = document.scrollingElement;
  if (scroller) scroller.scrollTop = playerOriginScroll;
  else window.scrollTo(0, playerOriginScroll);
}

const overlayIds = ["player-current-title", "player-close-button", "player-close-label", "player-elapsed", "player-time", "player-seek", "player-toggle-button", "player-next-button", "player-back-10", "player-forward-10", "player-volume", "player-mute-button", "player-settings-button", "player-fullscreen-button", "player-settings", "player-settings-close", "player-speed-trigger", "player-audio-trigger", "player-subtitle-trigger", "player-speed-value", "player-audio-value", "player-subtitle-value", "player-subtitle-file-button", "player-status", "player-control-notice", "player-control-notice-text", "player-ended", "player-ended-title", "player-next-title", "player-next-meta", "player-countdown", "player-countdown-ring", "player-countdown-announcement", "player-play-next", "player-cancel-next", "player-replay", "player-return-list", "player-error", "player-error-message", "player-error-retry", "player-error-back"];
const overlayActions = new Set(overlayIds);
let overlayActivity = 0;
function sendOverlayState(): void {
  if (!isPlayerLayerOpen()) return;
  const elements: Record<string, Record<string, unknown>> = {};
  for (const id of overlayIds) {
    const element = document.getElementById(id);
    if (!element) continue;
    const value: Record<string, unknown> = { hidden: element.hidden, style: element.getAttribute("style") ?? "" };
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement) value.disabled = element.disabled;
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) value.value = element.value;
    if (element instanceof HTMLInputElement) { value.max = element.max; value.min = element.min; }
    if (["player-current-title", "player-elapsed", "player-time", "player-toggle-button", "player-mute-button", "player-fullscreen-button", "player-status", "player-control-notice", "player-control-notice-text", "player-countdown", "player-speed-value", "player-audio-value", "player-subtitle-value", "player-close-label", "player-ended-title", "player-next-title", "player-next-meta", "player-replay", "player-return-list"].includes(id)) value.html = element.innerHTML;
    for (const attribute of ["expanded", "pressed", "label"]) if (element.hasAttribute(`aria-${attribute}`)) value[attribute] = element.getAttribute(`aria-${attribute}`);
    elements[id] = value;
  }
  for (const chip of Array.from(document.querySelectorAll<HTMLButtonElement>("#player-settings .player-chip"))) {
    elements[chip.id] = { pressed: chip.getAttribute("aria-pressed") ?? "false", disabled: chip.disabled };
  }
  window.zVideo.overlay.state({ heading: document.querySelector(".player-heading")?.outerHTML, controls: document.querySelector(".player-controls")?.outerHTML, stage: playerError && !playerError.hidden ? playerError.outerHTML : "", elements, progress: playerSeek?.parentElement?.getAttribute("style") ?? "", fullscreen: playerFullscreen, playing: playerState === "playing", error: Boolean(playerError && !playerError.hidden), activity: overlayActivity, revision: playerUiRevision, ...(playerOverlayFocusId ? { focusId: playerOverlayFocusId } : {}) });
}
window.zVideo.overlay.onReady(sendOverlayState);
window.addEventListener("keydown", () => { if (isPlayerLayerOpen()) { overlayActivity += 1; sendOverlayState(); } });
setInterval(sendOverlayState, 250);
window.zVideo.overlay.onAction((action) => {
  if (!action || typeof action !== "object" || !isPlayerLayerOpen()) return;
  if (action.type === "key" && typeof action.key === "string" && typeof action.code === "string") {
    handlePlayerShortcut(new KeyboardEvent("keydown", { key: action.key, code: action.code }));
    return;
  }
  if ((typeof action.id !== "string" || !(overlayActions.has(action.id) || action.id.startsWith("player-"))) || !["click", "input", "change"].includes(action.type)) return;
  const element = document.getElementById(action.id);
  if (!element) return;
  if ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement) && element.disabled) return;
  if (action.type === "click" && !(element instanceof HTMLButtonElement)) return;
  if (action.type !== "click" && !(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return;
  if ((element instanceof HTMLInputElement || element instanceof HTMLSelectElement) && typeof action.value === "string") element.value = action.value;
  element.dispatchEvent(new Event(action.type, { bubbles: true }));
  sendOverlayState();
});

function setPlayerStatus(message: string, error = false): void {
  if (!playerStatus) return;
  playerStatus.textContent = message;
  playerStatus.dataset.state = error ? "error" : "normal";
}

/**
 * Ticket 20 / P-07: `#player-status` is sr-only, so a failed play/pause/seek was
 * invisible on screen. This strip lives in the mirrored player heading, which
 * means the fullscreen overlay window gets it too, and it never blocks playback.
 */
function showPlayerControlNotice(message: string): void {
  if (playerControlNoticeTimer !== undefined) window.clearTimeout(playerControlNoticeTimer);
  if (playerControlNoticeText) playerControlNoticeText.textContent = message;
  if (playerControlNotice) playerControlNotice.hidden = false;
  markPlayerUiStructureChanged();
  sendOverlayState();
  playerControlNoticeTimer = window.setTimeout(() => clearPlayerControlNotice(), 6_000);
}

function clearPlayerControlNotice(): void {
  if (playerControlNoticeTimer !== undefined) {
    window.clearTimeout(playerControlNoticeTimer);
    playerControlNoticeTimer = undefined;
  }
  if (!playerControlNotice || playerControlNotice.hidden) return;
  playerControlNotice.hidden = true;
  if (playerControlNoticeText) playerControlNoticeText.textContent = "";
  markPlayerUiStructureChanged();
  sendOverlayState();
}

/** One render path for the seek slider, its progress fill and the elapsed label. */
function renderPlayerPosition(positionSec: number, force = false): void {
  // A duration the player only learned after `ready` still makes the slider usable.
  if (playerSeek && playerDurationSec > 0) playerSeek.max = String(playerDurationSec);
  // Position events never fight a drag (the slider keeps focus while dragged);
  // a rollback after a rejected seek must move the thumb even then.
  if (playerSeek && (force || document.activeElement !== playerSeek)) playerSeek.value = String(positionSec);
  playerSeek?.parentElement?.style.setProperty("--progress", `${playerDurationSec > 0 ? Math.min(100, positionSec / playerDurationSec * 100) : 0}%`);
  const elapsed = document.querySelector<HTMLElement>("#player-elapsed");
  if (elapsed) elapsed.textContent = formatTime(positionSec);
  if (playerTime) playerTime.textContent = formatTime(playerDurationSec);
}

function setPlayerControlsEnabled(enabled: boolean): void {
  if (playerToggleButton) playerToggleButton.disabled = !enabled;
  if (playerSeek) playerSeek.disabled = !enabled;
  if (playerFullscreenButton) playerFullscreenButton.disabled = !enabled;
  for (const kind of ["speed", "audio", "subtitle"] as const) {
    const trigger = document.getElementById(`player-${kind}-trigger`);
    if (trigger instanceof HTMLButtonElement) trigger.disabled = !enabled;
  }
  if (playerSubtitleFileButton) playerSubtitleFileButton.disabled = !enabled;
  if (playerVolume) playerVolume.disabled = !enabled;
  if (playerMuteButton) playerMuteButton.disabled = !enabled;
  if (playerReplay) playerReplay.disabled = !enabled;
  if (playerNextButton) { playerNextButton.hidden = !nextEpisode(); playerNextButton.disabled = !enabled || playerNextButton.hidden; }
}

function renderMuteButton(): void {
  if (!playerMuteButton) return;
  playerMuteButton.textContent = playerMuted ? "取消静音" : "静音";
  playerMuteButton.setAttribute("aria-pressed", String(playerMuted));
}

function speedLabel(speed: number): string {
  return `${Number.isInteger(speed) ? speed : String(speed)}×`;
}

function renderPlayerMenuValue(kind: PlayerMenuKind): void {
  const value = document.getElementById(`player-${kind}-value`);
  if (!value) return;
  if (kind === "speed") {
    value.textContent = speedLabel(playerSpeedValue);
    return;
  }
  const tracks = kind === "audio" ? playerAudioTracks : playerSubtitleTracks;
  const selected = tracks.find((track) => track.selected);
  value.textContent = selected?.label ?? (kind === "audio" ? "自动" : "关闭");
}

function playerMenuOptions(kind: PlayerMenuKind): Array<{ id: string; label: string; value: string; selected: boolean }> {
  if (kind === "speed") {
    return PLAYER_SPEEDS.map((speed, index) => ({ id: `player-speed-option-${index}`, label: speedLabel(speed), value: String(speed), selected: Math.abs(playerSpeedValue - speed) < 0.001 }));
  }
  const tracks = kind === "audio" ? playerAudioTracks : playerSubtitleTracks;
  const emptyValue = kind === "audio" ? "自动" : "关闭";
  const options = [{ id: `player-${kind}-option-0`, label: emptyValue, value: "", selected: !tracks.some((track) => track.selected) }];
  tracks.forEach((track, index) => {
    options.push({ id: `player-${kind}-option-${index + 1}`, label: track.label, value: track.id, selected: Boolean(track.selected) });
  });
  return options;
}

function renderPlayerMenu(kind: PlayerMenuKind): void {
  playerListboxes[kind]?.render();
  renderPlayerMenuValue(kind);
}

/** Mirror the current option values as inline chips inside the settings panel. */
function renderPlayerChips(kind: PlayerMenuKind): void {
  const container = document.getElementById(`player-${kind}-chips`);
  if (!container) return;
  container.replaceChildren(...playerMenuOptions(kind).map((option, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.id = `player-${kind}-chip-${index}`;
    chip.className = "chip player-chip";
    chip.dataset.kind = kind;
    chip.dataset.value = option.value;
    chip.setAttribute("aria-pressed", String(option.selected));
    chip.textContent = option.label;
    chip.addEventListener("click", () => {
      chip.focus();
      applyPlayerMenuValue(kind, option.value);
    });
    return chip;
  }));
}

function syncPlayerChipSelection(kind: PlayerMenuKind): void {
  const options = playerMenuOptions(kind);
  containerChips(kind).forEach((chip, index) => chip.setAttribute("aria-pressed", String(Boolean(options[index]?.selected))));
}

function containerChips(kind: PlayerMenuKind): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(`#player-${kind}-chips .player-chip`));
}

/** Re-draw one menu mirror after its optimistic value changed. */
function syncPlayerMenuUi(kind: PlayerMenuKind): void {
  renderPlayerMenuValue(kind);
  syncPlayerChipSelection(kind);
  playerListboxes[kind]?.syncSelection();
  sendOverlayState();
}

/**
 * Ticket 09: a rejected speed/track command rolls the optimistic UI back to the
 * value the player last reported, the same way volume and mute already do.
 */
function restorePlayerPreferenceUi(): void {
  renderPlayerSettings(true);
  for (const kind of ["speed", "audio", "subtitle"] as const) {
    if (playerListboxes[kind]?.isOpen) renderPlayerMenu(kind);
  }
  markPlayerUiStructureChanged();
  sendOverlayState();
  setPlayerStatus("播放设置没有生效，已恢复为播放器当前的设置。", true);
}

function applyPlayerMenuValue(kind: PlayerMenuKind, value: string): void {
  if (kind === "speed") {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed <= 0) return;
    const previous = playerSpeedValue;
    playerSpeedValue = speed;
    syncPlayerMenuUi(kind);
    void sendLocalPlaybackCommand({ type: "set-speed", speed }).then((sent) => {
      if (sent) return;
      playerSpeedValue = previous;
      restorePlayerPreferenceUi();
    });
    return;
  }
  if (kind === "audio") {
    const previous = playerAudioTracks;
    playerAudioTracks = playerAudioTracks.map((track) => ({ ...track, selected: track.id === value }));
    syncPlayerMenuUi(kind);
    if (!value) return;
    void sendLocalPlaybackCommand({ type: "set-audio-track", trackId: value }).then((sent) => {
      if (sent) return;
      playerAudioTracks = previous;
      restorePlayerPreferenceUi();
    });
    return;
  }
  const previous = playerSubtitleTracks;
  playerSubtitleTracks = playerSubtitleTracks.map((track) => ({ ...track, selected: track.id === value }));
  syncPlayerMenuUi(kind);
  void sendLocalPlaybackCommand({ type: "set-subtitle-track", trackId: value || null }).then((sent) => {
    if (sent) return;
    playerSubtitleTracks = previous;
    restorePlayerPreferenceUi();
  });
}

function openPlayerMenuKind(): PlayerMenuKind | undefined {
  return (["speed", "audio", "subtitle"] as const).find((kind) => playerListboxes[kind]?.isOpen);
}

function closeOpenPlayerMenu(returnFocus = true): void {
  const kind = openPlayerMenuKind();
  if (kind) playerListboxes[kind]?.close(returnFocus);
}

function createPlayerListbox(kind: PlayerMenuKind): AppListbox | undefined {
  const trigger = document.getElementById(`player-${kind}-trigger`);
  const popover = document.getElementById(`player-${kind}-options`);
  const container = trigger?.closest<HTMLElement>(".app-menu");
  if (!(trigger instanceof HTMLButtonElement) || !popover || !container) return undefined;
  return new AppListbox({
    container,
    trigger,
    popover,
    getOptions: () => playerMenuOptions(kind),
    hooks: {
      onSelect: (value) => applyPlayerMenuValue(kind, value),
      onOpen: () => { markPlayerUiStructureChanged(); sendOverlayState(); },
      onClose: () => { markPlayerUiStructureChanged(); sendOverlayState(); },
      onFocusChange: (id) => setPlayerOverlayFocus(id),
    },
  });
}

const playerListboxes: Record<PlayerMenuKind, AppListbox | undefined> = {
  speed: createPlayerListbox("speed"),
  audio: createPlayerListbox("audio"),
  subtitle: createPlayerListbox("subtitle"),
};
for (const kind of ["speed", "audio", "subtitle"] as const) {
  renderPlayerMenu(kind);
  renderPlayerChips(kind);
}

function openPlayerSettings(): void {
  if (!playerSettings) return;
  closeOpenPlayerMenu(false);
  playerSettings.hidden = false;
  playerSettingsButton?.setAttribute("aria-expanded", "true");
  const first = document.getElementById("player-settings-close");
  first?.focus();
  setPlayerOverlayFocus(first?.id);
  markPlayerUiStructureChanged();
  sendOverlayState();
}

function closePlayerSettings(returnFocus = true): void {
  closeOpenPlayerMenu(false);
  if (playerSettings) playerSettings.hidden = true;
  playerSettingsButton?.setAttribute("aria-expanded", "false");
  markPlayerUiStructureChanged();
  if (returnFocus) {
    playerSettingsButton?.focus();
    setPlayerOverlayFocus("player-settings-button");
  } else {
    setPlayerOverlayFocus(undefined);
  }
  sendOverlayState();
}

function renderPlayerSettings(force = false): void {
  if (playerVolume && (force || !playerVolumeDragging)) playerVolume.value = String(playerVolumeLevel);
  renderMuteButton();
  for (const kind of ["speed", "audio", "subtitle"] as const) {
    renderPlayerMenuValue(kind);
    syncPlayerChipSelection(kind);
  }
}

function restorePlayerSettingsAfterFailure(): void {
  if (playerVolumeDragging) {
    playerVolumeRestoreAfterDrag = true;
    return;
  }
  renderPlayerSettings(true);
}

function finishPlayerVolumeDrag(): void {
  playerVolumeDragging = false;
  if (!playerVolumeRestoreAfterDrag) return;
  playerVolumeRestoreAfterDrag = false;
  renderPlayerSettings(true);
}

function setPlayerFullscreen(enabled: boolean): void {
  playerFullscreen = enabled;
  if (playerFullscreenButton) playerFullscreenButton.textContent = playerFullscreen ? "退出全屏" : "全屏";
  void sendLocalPlaybackCommand({ type: "fullscreen", enabled: playerFullscreen });
}

function togglePlayerFullscreen(): void {
  setPlayerFullscreen(!playerFullscreen);
}

function isPlayerFormControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, select, textarea, [contenteditable='true']"));
}

function isPlayerButton(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button"));
}

function handlePlayerShortcut(event: KeyboardEvent): void {
  if (!isPlayerLayerOpen() || event.isComposing) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.defaultPrevented) return;
  if (isPlayerFormControl(event.target) || isPlayerFormControl(document.activeElement)) return;
  const menuKind = openPlayerMenuKind();
  if (menuKind) {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      playerListboxes[menuKind]?.close(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      playerListboxes[menuKind]?.moveFocus(event.key);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      playerListboxes[menuKind]?.activateFocused();
      return;
    }
  }
  if (playerSettings && !playerSettings.hidden && event.key === "Escape") {
    event.preventDefault();
    closePlayerSettings(true);
    return;
  }
  if (playerToggleButton?.disabled) return;

  const shortcut = event.key === " " ? "Space" : event.key && event.key !== "Unidentified" ? event.key : event.code;
  if (shortcut === "Escape" && playerFullscreen) {
    event.preventDefault();
    setPlayerFullscreen(false);
    return;
  }
  if (shortcut === "Space" && (isPlayerButton(event.target) || isPlayerButton(document.activeElement))) return;

  switch (shortcut) {
    case "Space":
      event.preventDefault();
      void sendLocalPlaybackCommand({ type: playerState === "playing" ? "pause" : "play" });
      return;
    case "ArrowLeft":
    case "ArrowRight": {
      event.preventDefault();
      const current = Number(playerSeek?.value ?? 0);
      const direction = shortcut === "ArrowRight" ? 1 : -1;
      const next = Math.max(0, current + direction * 5);
      const positionSec = playerDurationSec > 0 ? Math.min(playerDurationSec, next) : next;
      void sendLocalPlaybackCommand({ type: "seek", positionSec }, { rollback: () => renderPlayerPosition(playerPositionSec, true) });
      return;
    }
    case "ArrowUp":
    case "ArrowDown": {
      event.preventDefault();
      const current = Number(playerVolume?.value ?? 100);
      const direction = shortcut === "ArrowUp" ? 1 : -1;
      const volume = Math.max(0, Math.min(100, current + direction * 5));
      if (playerVolume) playerVolume.value = String(volume);
      void sendLocalPlaybackCommand({ type: "set-volume", volume }).then((sent) => {
        if (!sent) restorePlayerSettingsAfterFailure();
      });
      return;
    }
    default:
      break;
  }

  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    const muted = !(playerMuteCommandValue ?? playerMuted);
    playerMuteCommandValue = muted;
    void sendLocalPlaybackCommand({ type: "set-muted", muted }).then((sent) => {
      if (!sent) {
        playerMuteCommandValue = undefined;
        renderPlayerSettings();
      }
    });
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    togglePlayerFullscreen();
  }
}

function clearNextTimer(): void {
  if (nextTimer !== undefined) window.clearInterval(nextTimer);
  nextTimer = undefined;
}

function nextEpisode(): LocalMediaItem | undefined {
  const episodes = activeDetail?.episodes ?? [];
  const index = episodes.findIndex((episode) => episode.mediaId === selectedMediaId);
  const next = index >= 0 ? episodes[index + 1] : undefined;
  return next?.kind === "episode" && next.available ? next : undefined;
}

async function playNextEpisode(): Promise<void> {
  const next = nextEpisode();
  clearNextTimer();
  if (!next || !activeDetail) return;
  selectedMediaId = next.mediaId;
  activeDetail = { ...activeDetail, item: next };
  if (playerEnded) playerEnded.hidden = true;
  if (playerReplay) playerReplay.hidden = true;
  await openSelectedLocalMedia();
}

function currentItemIsMovie(): boolean {
  return activeDetail?.collectionKind === "movie" || activeDetail?.item.kind === "movie";
}

function episodeWithTitle(item: LocalMediaItem): string {
  const episode = episodeLabel(item);
  return episode ? `${episode} · ${item.title}` : item.title;
}

function formatDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "时长未知";
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  }
  if (seconds >= 60) return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
  return `${Math.round(seconds)} 秒`;
}

function nextEpisodeMeta(item: LocalMediaItem): string {
  const playback = activeDetail?.episodePlayback?.find((state) => state.mediaId === item.mediaId)
    ?? (activeDetail?.playback?.mediaId === item.mediaId ? activeDetail.playback : undefined);
  const duration = formatDurationLabel(playback?.durationSec ?? 0);
  const state = playback?.watched ? "已看完" : playback && playback.positionSec > 0 ? `已看 ${formatTime(playback.positionSec)}` : "未看";
  return `${duration} · ${state}`;
}

function showPlayerError(message: string): void {
  if (playerErrorMessage) playerErrorMessage.textContent = message;
  if (playerError) playerError.hidden = false;
  if (playerSurfaceMessage) playerSurfaceMessage.hidden = true;
  markPlayerUiStructureChanged();
  sendOverlayState();
}

function hidePlayerError(): void {
  if (playerSurfaceMessage) playerSurfaceMessage.hidden = false;
  if (!playerError || playerError.hidden) return;
  playerError.hidden = true;
  markPlayerUiStructureChanged();
  sendOverlayState();
}

function resetPlaybackEndedPanel(): void {
  clearNextTimer();
  if (playerEnded) playerEnded.hidden = true;
  if (playerCountdownAnnouncement) playerCountdownAnnouncement.textContent = "";
}

function showPlaybackEnded(): void {
  clearNextTimer();
  const next = nextEpisode();
  const movie = currentItemIsMovie();
  if (playerEnded) { playerEnded.hidden = false; playerEnded.style.setProperty("--remaining", "1"); }
  if (playerEndedTitle) playerEndedTitle.textContent = movie ? "电影已看完" : "本集已看完";
  if (playerNextTitle) {
    playerNextTitle.hidden = !next;
    playerNextTitle.textContent = next ? `下一集：${episodeWithTitle(next)}` : "";
  }
  if (playerNextMeta) {
    playerNextMeta.hidden = !next;
    playerNextMeta.textContent = next ? nextEpisodeMeta(next) : "";
  }
  if (playerCountdownRing) playerCountdownRing.hidden = !next;
  if (playerPlayNext) playerPlayNext.hidden = !next;
  if (playerCancelNext) playerCancelNext.hidden = !next;
  if (playerReplay) playerReplay.hidden = Boolean(next);
  if (playerReturnList) playerReturnList.textContent = reviewTarget || movie ? playerOriginLabel() : "返回详情";
  if (playerCountdown) playerCountdown.textContent = next ? "10 秒后自动播放下一集" : "";
  if (playerCountdownAnnouncement) playerCountdownAnnouncement.textContent = next ? `10 秒后播放下一集：${episodeWithTitle(next)}。` : "";
  markPlayerUiStructureChanged();
  if (!next) return;
  let seconds = 10;
  nextTimer = window.setInterval(() => {
    seconds -= 1;
    if (playerCountdown) playerCountdown.textContent = `${seconds} 秒后自动播放下一集`;
    playerEnded?.style.setProperty("--remaining", String(seconds / 10));
    if (seconds <= 0) void playNextEpisode();
  }, 1000);
}

const PLAYER_CLOSE_FALLBACK_MS = 1_500;

function clearPlayerCloseFallback(): void {
  if (playerCloseFallback === undefined) return;
  window.clearTimeout(playerCloseFallback);
  playerCloseFallback = undefined;
}

/**
 * Ticket 06: every close entry (close button, return-to-list, error return)
 * enters the same "closing" state. Main emits exactly one `closed`; if that
 * event is lost, the local teardown still runs once after 1.5s so the player
 * view can never stay stuck in front of the library.
 */
function requestPlayerClose(returnToDetail = false): void {
  if (!playerSessionOpen || playerClosing) return;
  playerReturnToDetail = returnToDetail;
  playerClosing = true;
  clearNextTimer();
  setPlayerControlsEnabled(false);
  setPlayerStatus("正在关闭播放器…");
  playerCloseFallback = window.setTimeout(() => {
    playerCloseFallback = undefined;
    if (playerClosing) handlePlayerClosed();
  }, PLAYER_CLOSE_FALLBACK_MS);
  void sendLocalPlaybackCommand({ type: "close" });
}

/** A failed open never became a session, so its markers must not survive. */
function discardPlayerSession(): void {
  playerSessionOpen = false;
  playerClosing = false;
  clearPlayerCloseFallback();
}

function resetPlayerSessionMirror(): void {
  // Ticket 06: the next session starts from a clean mirror instead of showing
  // the previous session's state until its first event arrives.
  playerState = "paused";
  playerDurationSec = 0;
  playerPositionSec = 0;
  playerVolumeLevel = 100;
  playerMuted = false;
  playerMuteCommandValue = undefined;
  playerSpeedValue = 1;
  renderPlayerSettings();
}

/**
 * The single teardown for one playback session. It is idempotent: the normal
 * `closed` event and the 1.5s fallback both call it, and only the first call
 * dismantles the view or reloads library data.
 */
function handlePlayerClosed(): void {
  if (!playerSessionOpen && !playerClosing) return;
  playerSessionOpen = false;
  playerClosing = false;
  clearPlayerCloseFallback();
  resetPlayerSessionMirror();
  clearNextTimer();
  if (playerEnded) playerEnded.hidden = true;
  if (playerCountdownAnnouncement) playerCountdownAnnouncement.textContent = "";
  playerFullscreen = false;
  if (playerFullscreenButton) playerFullscreenButton.textContent = "全屏";
  showPlayer(false);
  hidePlayerError();
  clearPlayerControlNotice();
  setPlayerControlsEnabled(false);
  setPlayerStatus("");
  if (playerSurfaceMessage) playerSurfaceMessage.textContent = "正在准备原生播放器…";
  activePlaybackTitle = "";
  if (playerCurrentTitle) playerCurrentTitle.textContent = "";
  reviewPendingState = undefined;
  if (reviewTarget) {
    // A3: closing an inspection never falls back to detail/home. The cleanup
    // queue is still underneath; closing asks for the keep/snooze/delete mark.
    activeDetail = undefined;
    activeDetailPlayback = undefined;
    selectedMediaId = undefined;
    selectedSeason = undefined;
    playerReturnToDetail = false;
    setView({ layers: { detail: false } });
    applyView();
    updateReviewBar();
    openReviewDecision();
    return;
  }
  const returnKind: PlayerOrigin = playerReturnToDetail ? "detail" : playerOrigin;
  const mediaId = selectedMediaId;
  playerReturnToDetail = false;
  if (returnKind === "detail" && mediaId) {
    // Refresh the detail in place: it stays open behind the player, so the
    // selected episode, season and scroll position survive playback.
    void openDetail(mediaId);
    return;
  }
  activeDetail = undefined;
  activeDetailPlayback = undefined;
  selectedMediaId = undefined;
  selectedSeason = undefined;
  setView({ layers: { detail: false } });
  applyView();
  restorePlayerOriginScroll();
  void Promise.all([loadContinueWatching(), loadHomeShelves()]).then(() => restorePlayerOriginScroll());
}

function renderLocalPlaybackEvent(event: LocalPlaybackEvent): void {
  if (event.type === "closed") {
    handlePlayerClosed();
    return;
  }
  // Ticket 06: a session that was torn down (or is closing) must not reopen the
  // player view through a late event from main.
  if (!playerSessionOpen || playerClosing) return;
  showPlayer(true);
  switch (event.type) {
    case "loading":
      clearNextTimer();
      clearPlayerControlNotice();
      if (playerEnded) playerEnded.hidden = true;
      if (playerCountdownAnnouncement) playerCountdownAnnouncement.textContent = "";
      hidePlayerError();
      playerState = "buffering";
      setPlayerControlsEnabled(false);
      setPlayerStatus("正在加载本地媒体…");
      if (playerSurfaceMessage) playerSurfaceMessage.textContent = "正在加载原生媒体…";
      break;
    case "ready":
      hidePlayerError();
      clearPlayerControlNotice();
      playerDurationSec = event.durationSec ?? 0;
      playerPositionSec = 0;
      setPlayerControlsEnabled(true);
      setPlayerStatus("视频区域快捷键：Space 暂停 · ←/→ ±5秒 · ↑/↓ 音量±5 · M 静音 · F 全屏 · Esc 退出");
      if (playerSurfaceMessage) playerSurfaceMessage.textContent = "";
      // Ticket 20 / P-07: the first frame may not know the duration yet. The
      // slider is reset here so no previous session's range leaks in, and the
      // `position` handler updates max as soon as the duration is known.
      if (playerSeek) {
        playerSeek.max = String(playerDurationSec);
        playerSeek.value = "0";
      }
      break;
    case "state":
      const wasEnded = playerState === "ended";
      playerState = event.state;
      if (event.state === "ended" && !wasEnded) showPlaybackEnded();
      else if (event.state !== "ended") { clearNextTimer(); if (playerEnded) playerEnded.hidden = true; }
      if (playerNextButton) { playerNextButton.hidden = !nextEpisode(); playerNextButton.disabled = playerNextButton.hidden; }
      if (playerToggleButton) {
        const playing = event.state === "playing";
        const label = playing ? "暂停" : "播放";
        playerToggleButton.setAttribute("aria-label", label);
        playerToggleButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${playing ? '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>'}</svg><span class="sr-only">${label}</span>`;
      }
      if (event.state === "playing") setPlayerStatus("视频区域快捷键：Space 暂停 · ←/→ ±5秒 · ↑/↓ 音量±5 · M 静音 · F 全屏 · Esc 退出");
      else if (event.state === "paused") setPlayerStatus("已暂停 · Space 继续播放");
      else if (event.state === "buffering") setPlayerStatus("缓冲中…");
      else setPlayerStatus("播放结束。");
      break;
    case "position": {
      const reportedDuration = Number(event.durationSec);
      if (Number.isFinite(reportedDuration) && reportedDuration > 0) playerDurationSec = reportedDuration;
      playerPositionSec = event.positionSec;
      renderPlayerPosition(event.positionSec);
      break;
    }
    case "tracks":
      playerAudioTracks = event.audio;
      playerSubtitleTracks = event.subtitles;
      for (const kind of ["audio", "subtitle"] as const) {
        if (playerListboxes[kind]?.isOpen) renderPlayerMenu(kind);
        renderPlayerChips(kind);
        renderPlayerMenuValue(kind);
      }
      markPlayerUiStructureChanged();
      sendOverlayState();
      break;
    case "settings":
      if (Number.isFinite(event.volume)) playerVolumeLevel = Math.max(0, Math.min(100, event.volume));
      playerMuted = event.muted;
      playerMuteCommandValue = undefined;
      if (Number.isFinite(event.speed)) playerSpeedValue = event.speed;
      renderPlayerSettings();
      sendOverlayState();
      break;
    case "control-error":
      playerMuteCommandValue = undefined;
      restorePlayerSettingsAfterFailure();
      showPlayerControlNotice(event.message);
      setPlayerStatus(event.message, true);
      break;
    case "error":
      setPlayerControlsEnabled(false);
      setPlayerStatus(event.message, true);
      showPlayerError(event.message);
      break;
  }
}

const playerCommandLabels: Record<Parameters<typeof window.zVideo.localPlayback.command>[0]["type"], string> = {
  play: "播放",
  pause: "暂停",
  seek: "调整进度",
  "set-volume": "调整音量",
  "set-muted": "切换静音",
  "set-speed": "调整播放速度",
  "set-audio-track": "切换音轨",
  "set-subtitle-track": "切换字幕",
  fullscreen: "切换全屏",
  close: "关闭播放器",
};

/**
 * Ticket 20 / P-07: a rejected control command used to write only to the
 * sr-only status line, so nothing on screen changed and the user believed the
 * command worked. Every failure now shows the visible heading strip and lets the
 * caller roll back optimistic UI (the seek slider).
 */
async function sendLocalPlaybackCommand(
  command: Parameters<typeof window.zVideo.localPlayback.command>[0],
  options: { rollback?: () => void } = {},
): Promise<boolean> {
  try {
    await window.zVideo.localPlayback.command(command);
    return true;
  } catch {
    options.rollback?.();
    showPlayerControlNotice(`${playerCommandLabels[command.type]}没有生效，界面已恢复到上一次状态。`);
    setPlayerStatus("播放控制失败，请重试。", true);
    return false;
  }
}

function renderState(next: LocalLibraryState): void {
  state = next;
  if (next.status !== "error" && libraryErrorRetryNote && !libraryErrorRetryNote.hidden) {
    libraryErrorRetryNote.hidden = true;
    libraryErrorRetryNote.textContent = "";
    libraryRetryAttempts = 0;
  }
  const errorCard = document.querySelector<HTMLElement>("#library-error");
  if (errorCard) errorCard.hidden = next.status !== "error";
  if (next.status === "error") {
    const message = document.querySelector<HTMLElement>("#library-error-message");
    const code = document.querySelector<HTMLElement>("#library-error-code");
    if (libraryErrorTitle) {
      libraryErrorTitle.textContent = next.error?.code === "storage" || next.error?.code === "sqlite-unavailable"
        ? "片库文件暂时无法读写"
        : "片库加载失败";
    }
    if (message) message.textContent = next.error?.message ?? "本地片库不可用。";
    if (code) code.textContent = `错误代码：${next.error?.code ?? "unknown"}`;
    if (libraryPageError) libraryPageError.hidden = true;
    if (libraryEmpty) libraryEmpty.hidden = true;
    if (libraryPagination) libraryPagination.hidden = true;
    setView({ layers: { cleanup: false } });
    cleanupRequestEpoch += 1;
    // Ticket 14: the cleanup view is hidden here, so a pending close-time
    // decision must not pop up over a hidden page once playback closes.
    if (reviewTarget) clearReviewTarget();
  }
  renderSources(next, scanProgress, sourceList, { singleVideoSourceIds });
  renderSourceFilters();
  applyView();
  if (next.status === "error") setMessage(next.error?.message ?? "本地片库不可用。", true);
}

/**
 * Ticket 18 / F-10: the content signature decides whether a card may be reused.
 * File-level cards used to reuse on `mediaId` alone, so a rescan that changed
 * the title, size or availability left stale DOM (including artwork state) on
 * screen forever. Artwork identity is part of the signature because the poster
 * element carries its own `dataset.artwork*` contract.
 */
function artworkSignature(artwork: LocalArtworkReference[] | undefined): string {
  return artwork?.map((entry) => `${entry.kind}:${entry.cacheKey}`).join(",") ?? "";
}

function mediaCardSignature(item: LocalMediaItem): string {
  return [item.title, item.kind, item.year ?? "", item.rating ?? "", item.premieredDate ?? "", item.sizeBytes, item.modifiedAtMs, item.available ? 1 : 0, artworkSignature(item.artwork)].join(":");
}

function collectionCardSignature(item: LocalCollectionSummary): string {
  return [item.title, item.kind, item.year ?? "", item.rating ?? "", item.premieredDate ?? "", item.episodeCount, item.watchedEpisodeCount, item.availableEpisodeCount, item.available ? 1 : 0, item.resume?.mediaId ?? "", item.resume?.updatedAtMs ?? 0, item.coverMediaId, artworkSignature(item.artwork)].join(":");
}

/**
 * Ticket 18: a reused card keeps its poster element, so its artwork contract is
 * re-derived from the item on screen now. A `artworkLoading` flag left behind by
 * a request discarded with an earlier render would otherwise latch the frame
 * forever, because the queue skips cards that already look busy.
 */
function reconcileCardArtwork(card: HTMLElement, mediaId: string | undefined, kind: LocalArtworkReference["kind"] | undefined): void {
  const poster = card.querySelector<HTMLElement>(".media-poster");
  if (!poster) return;
  const sameReference = Boolean(mediaId && kind) && poster.dataset.artworkMediaId === mediaId && poster.dataset.artworkKind === kind;
  // An unchanged frame that is already loaded is done, and one the observer has
  // not reached yet must stay lazy. Only a frame whose previous attempt was
  // discarded mid-flight (`artworkLoading` latched true) is re-armed here.
  if (sameReference && (poster.dataset.artworkLoaded === "true" || poster.dataset.artworkLoading !== "true")) return;
  delete poster.dataset.artworkMediaId;
  delete poster.dataset.artworkKind;
  delete poster.dataset.artworkLoaded;
  delete poster.dataset.artworkLoading;
  if (!mediaId || !kind) return;
  poster.dataset.artworkMediaId = mediaId;
  poster.dataset.artworkKind = kind;
  poster.dataset.artworkGeneration = String(Number(poster.dataset.artworkGeneration ?? 0) + 1);
  enqueueArtwork(poster, 1);
}

function renderPage(page: LibraryPageView): void {
  const pagination = paginationModel(page.totalCount, page.pageSize, page.page);
  if (page.page > pagination.totalPages) {
    // A removal or rescan can shrink the list under the current page. Ask for
    // the nearest valid page instead of showing an empty "page 334" screen.
    if (currentQuery.page !== pagination.totalPages) {
      setQuery({ page: pagination.totalPages });
      void loadLibrary();
      return;
    }
  }
  if (page.page !== currentQuery.page) currentQuery = { ...currentQuery, page: page.page };
  activePage = page;
  if (libraryPageError) libraryPageError.hidden = true;
  applyView();
  const focusedMediaId = preserveGridFocus();
  if (!libraryGrid || !libraryEmpty) return;
  artworkObserver?.disconnect();
  const includeReleaseDate = currentQuery.sort === "released_desc";
  const existingCards = new Map<string, HTMLElement>();
  libraryGrid.querySelectorAll<HTMLElement>("[data-media-id]").forEach((button) => {
    const article = button.closest<HTMLElement>(".media-card");
    if (article && button.dataset.mediaId) existingCards.set(button.dataset.mediaId, article);
  });
  const keptCards = new Set<HTMLElement>();
  if (page.mode === "collection") {
    for (const item of page.items) {
      const cached = existingCards.get(item.representativeMediaId);
      const signature = collectionCardSignature(item);
      const reused = Boolean(cached
        && cached.dataset.cardMode === "collection"
        && cached.dataset.releaseDate === String(includeReleaseDate)
        && cached.dataset.collectionSignature === signature);
      const node = reused ? cached! : collectionCard(item, includeReleaseDate);
      node.dataset.cardMode = "collection";
      node.dataset.releaseDate = String(includeReleaseDate);
      node.dataset.collectionSignature = signature;
      libraryGrid.append(node);
      keptCards.add(node);
      if (reused) reconcileCardArtwork(node, item.coverMediaId, item.artwork?.find((entry) => entry.kind === "poster")?.kind);
    }
  } else {
    for (const item of page.items) {
      const cached = existingCards.get(item.mediaId);
      const signature = mediaCardSignature(item);
      const reused = Boolean(cached
        && cached.dataset.cardMode === "media"
        && cached.dataset.releaseDate === String(includeReleaseDate)
        && cached.dataset.cardSignature === signature);
      const node = reused ? cached! : card(item, includeReleaseDate);
      node.dataset.cardMode = "media";
      node.dataset.releaseDate = String(includeReleaseDate);
      node.dataset.cardSignature = signature;
      libraryGrid.append(node);
      keptCards.add(node);
      if (reused) reconcileCardArtwork(node, item.mediaId, artworkKind(item));
    }
  }
  libraryGrid.querySelectorAll<HTMLElement>(":scope > *").forEach((child) => {
    if (!keptCards.has(child)) child.remove();
  });
  libraryEmpty.hidden = page.items.length > 0;
  if (page.items.length === 0) updateEmptyState(page.totalCount);
  if (pageScope) {
    if (page.totalCount) pageScope.textContent = page.mode === "collection" ? `共 ${page.totalCount} 部作品 · 第 ${page.page} 页` : `共 ${page.totalCount} 集 · 第 ${page.page} 页`;
    else pageScope.textContent = "";
  }
  renderPager("library", page);
  observeArtworkGrid(libraryGrid);
  // Ticket 18: an in-flight list load now finishes behind an open detail or
  // player layer; it must not pull focus out of the visible overlay.
  if (!isDetailOrPlayerVisible() && !isCleanupLayerOpen() && !isSearchBase()) restoreGridFocus(focusedMediaId);
  playFirstContentMotion(libraryGrid.querySelector<HTMLElement>(".media-card"));
  updateScanUi();
}

function observeArtworkGrid(container: HTMLElement): void {
  artworkObserver?.disconnect();
  artworkObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        artworkObserver?.unobserve(entry.target);
        const element = entry.target as HTMLElement;
        enqueueArtwork(element, element.closest(".media-card") ? 1 : 0);
      }
    }
  }, { rootMargin: "320px" });
  container.querySelectorAll<HTMLElement>("[data-artwork-media-id]").forEach((element) => artworkObserver?.observe(element));
}

function renderSourceFilters(): void {
  if (!sourceFilters || !state) return;
  const add = (label: string, sourceId?: string, availability: "ok" | "degraded" | "offline" = "ok") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip source-filter-chip";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(currentQuery.sourceId === sourceId));
    if (sourceId) button.dataset.sourceFilterId = sourceId;
    if (availability === "offline") button.dataset.available = "false";
    else if (availability === "degraded") button.dataset.degraded = "true";
    sourceFilters.append(button);
  };
  sourceFilters.replaceChildren();
  add("全部来源");
  for (const source of state.sources) {
    const availability = !source.available ? "offline" : source.degraded ? "degraded" : "ok";
    const suffix = availability === "offline" ? " · 离线" : availability === "degraded" ? " · 部分目录未读取" : "";
    add(`${source.label}${suffix}`, source.sourceId, availability);
  }
}

type PagerTarget = "library" | "search";
interface PagerView { totalCount: number; page: number; pageSize: number }

function pagerHost(target: PagerTarget): HTMLElement | null {
  return target === "search" ? searchPagination : libraryPagination;
}

/** The list pager keeps its historical `pagination-*` ids; search uses its own. */
function pagerId(target: PagerTarget, suffix: string): string {
  return target === "search" ? `search-pagination-${suffix}` : `pagination-${suffix}`;
}

function pagerView(target: PagerTarget): PagerView | undefined {
  return target === "search" ? searchPageView : activePage;
}

/**
 * One pager implementation for the library list and (Ticket 12) the search
 * results. Only the host element, the page-button attribute and the control ids
 * differ, so both lists share the same keyboard and clamping behaviour.
 */
function renderPager(target: PagerTarget, view: PagerView): void {
  const host = pagerHost(target);
  if (!host) return;
  const model = paginationModel(view.totalCount, view.pageSize, view.page);
  host.replaceChildren();
  if (view.totalCount === 0) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const pageAttribute = target === "search" ? "data-search-page" : "data-page";
  const addButton = (label: string, pageTarget: number, options: { disabled?: boolean; current?: boolean; role?: string; ariaLabel?: string } = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute(pageAttribute, String(pageTarget));
    if (options.role) button.dataset.pageRole = options.role;
    if (options.ariaLabel) button.setAttribute("aria-label", options.ariaLabel);
    button.disabled = Boolean(options.disabled);
    if (options.current) button.setAttribute("aria-current", "page");
    host.append(button);
  };
  addButton("首页", 1, { disabled: model.firstDisabled, role: "first", ariaLabel: "首页" });
  addButton("上一页", model.page - 1, { disabled: model.previousDisabled, role: "previous", ariaLabel: "上一页" });
  for (const candidate of model.pages) addButton(String(candidate), candidate, { current: candidate === model.page, role: candidate === model.page ? "current" : "page" });
  addButton("下一页", model.page + 1, { disabled: model.nextDisabled, role: "next", ariaLabel: "下一页" });
  addButton("末页", model.totalPages, { disabled: model.lastDisabled, role: "last", ariaLabel: `末页，第 ${model.totalPages} 页` });

  const status = document.createElement("span");
  status.id = pagerId(target, "status");
  status.className = "page-status";
  status.textContent = model.status;
  status.setAttribute("aria-live", "polite");

  const form = document.createElement("form");
  form.id = pagerId(target, "jump");
  form.className = "jump-form";
  const label = document.createElement("label");
  label.htmlFor = pagerId(target, "jump-input");
  label.textContent = "跳至";
  const input = document.createElement("input");
  input.id = pagerId(target, "jump-input");
  input.className = "jump-input";
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.placeholder = "页码";
  input.setAttribute("aria-label", `跳转到第几页，共 ${model.totalPages} 页`);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "secondary-button";
  submit.textContent = "前往";
  const jumpError = document.createElement("span");
  jumpError.id = pagerId(target, "jump-error");
  jumpError.className = "jump-error";
  jumpError.setAttribute("role", "alert");
  jumpError.hidden = true;
  form.append(label, input, submit);
  host.append(status, form, jumpError);
  animateCount(status);
}

function showPaginationJumpError(target: PagerTarget, message: string | undefined): void {
  const host = pagerHost(target);
  if (!host) return;
  const error = host.querySelector<HTMLElement>(`#${pagerId(target, "jump-error")}`);
  const input = host.querySelector<HTMLInputElement>(`#${pagerId(target, "jump-input")}`);
  if (message) {
    input?.setAttribute("aria-invalid", "true");
    if (error) { error.textContent = message; error.hidden = false; }
  } else {
    input?.removeAttribute("aria-invalid");
    if (error) { error.textContent = ""; error.hidden = true; }
  }
}

function submitPaginationJump(target: PagerTarget): void {
  const host = pagerHost(target);
  const view = pagerView(target);
  if (!host || !view) return;
  const input = host.querySelector<HTMLInputElement>(`#${pagerId(target, "jump-input")}`);
  const totalPages = paginationModel(view.totalCount, view.pageSize, view.page).totalPages;
  const next = parseJumpTarget(input?.value ?? "", totalPages);
  if (next === undefined) {
    showPaginationJumpError(target, `请输入 1–${totalPages} 之间的页码。`);
    input?.focus();
    return;
  }
  showPaginationJumpError(target, undefined);
  if (input) input.value = "";
  if (next === view.page) return;
  scrollResultsToTop();
  if (target === "search") {
    searchPage = next;
    void loadSearch();
    return;
  }
  setQuery({ page: next });
  void loadLibrary();
}

function renderHomeHero(): void {
  if (!hero) return;
  const entry = homeItems[0];
  const item = entry?.item ?? recentItems[0];
  if (!item) return;
  // The poster, tone and title follow the work, never the episode file name.
  const heroItem: LocalMediaItem = entry
    ? { ...item, title: entry.collectionTitle, kind: entry.collectionKind }
    : item;
  const title = hero.querySelector<HTMLElement>("#hero-title");
  const label = hero.querySelector<HTMLElement>("#hero-label");
  const meta = hero.querySelector<HTMLElement>("#hero-meta");
  const progress = hero.querySelector<SVGPathElement>("#hero-progress-fill");
  const track = hero.querySelector<SVGPathElement>("#hero-progress-track");
  const episode = hero.querySelector<HTMLElement>("#hero-episode");
  const restart = hero.querySelector<HTMLButtonElement>("#hero-restart");
  const play = hero.querySelector<HTMLButtonElement>("#hero-play");
  const poster = hero.querySelector<HTMLElement>("#hero-poster");
  if (title) title.textContent = heroItem.title;
  if (label) label.textContent = entry ? "继续观看" : "最近加入";
  const heroEpisodeNumber = entry?.episodeNumber ?? item.episodeNumber;
  if (episode) episode.textContent = heroEpisodeNumber !== undefined ? `E${String(heroEpisodeNumber).padStart(2, "0")}` : "";
  if (meta) {
    const parts = entry
      ? [kindLabel(entry.collectionKind), entry.seasonNumber !== undefined ? `第 ${entry.seasonNumber} 季` : "", `已观看 ${formatTime(entry.playback.positionSec)}`]
      : [kindLabel(item.kind), item.year !== undefined ? String(item.year) : ""];
    meta.textContent = parts.filter(Boolean).join(" · ");
  }
  const percent = entry?.playback.durationSec ? Math.min(100, entry.playback.positionSec / entry.playback.durationSec * 100) : 0;
  track?.setAttribute("d", wavePath(360, 9, 4, 6));
  progress?.setAttribute("d", wavePath(360, 9, 4, 6));
  progress?.setAttribute("stroke-dasharray", `${percent} 100`);
  if (restart) { restart.hidden = !entry; restart.disabled = !item.available; }
  if (play) { play.textContent = entry ? "继续观看" : "播放"; play.disabled = !item.available; }
  applyTone(hero, coverData(heroItem).tone);
  if (poster) {
    poster.className = `hero-poster cover-shape-${coverData(heroItem).shape}`;
    poster.replaceChildren(generatedCover(heroItem));
    poster.dataset.artworkGeneration = String(Number(poster.dataset.artworkGeneration ?? 0) + 1);
    delete poster.dataset.artworkMediaId; delete poster.dataset.artworkKind; delete poster.dataset.artworkLoaded; delete poster.dataset.artworkLoading;
    if (item.artwork?.some((art) => art.kind === "poster")) { poster.dataset.artworkMediaId = item.mediaId; poster.dataset.artworkKind = "poster"; enqueueArtwork(poster, 2); }
  }
}

async function loadHomeShelves(): Promise<void> {
  const epoch = ++homeEpoch;
  try {
    const [recent, shows] = await Promise.all([
      window.zVideo.localLibrary.listCollections({ page: 1, pageSize: 12, sort: "added_desc" }),
      window.zVideo.localLibrary.listCollections({ page: 1, pageSize: 12, filter: "show" }),
    ]);
    if (epoch !== homeEpoch) return;
    const recentCollections = recent.page?.items ?? [];
    const showCollections = shows.page?.items ?? [];
    recentItems = recentCollections.map(collectionAsMediaItem);
    for (const [row, items] of [[recentRow, recentCollections], [showsRow, showCollections]] as const) {
      if (!row) continue;
      row.replaceChildren(...items.map((item) => collectionCard(item)));
      row.querySelectorAll<HTMLElement>("[data-artwork-media-id]").forEach((element) => enqueueArtwork(element, 1));
    }
    renderHomeHero();
    applyView();
    playFirstContentMotion(hero && !hero.hidden ? hero : document.querySelector<HTMLElement>("#recent-row .media-card"));
  } catch { if (epoch === homeEpoch) setMessage("首页片架加载失败，请重试。", true); }
}

function renderContinue(items: LocalContinueWatchingItem[]): void {
  if (!continueSection || !continueRow) return;
  homeItems = items;
  renderHomeHero();
  continueRow.replaceChildren();
  continuePlaybackByMediaId.clear();
  for (const entry of items) continuePlaybackByMediaId.set(entry.item.mediaId, entry.playback);
  applyView();
  if (continueSection.hidden) return;
  if (continueScope) continueScope.textContent = `${items.length} 部作品`;
  renderContinueCards(items, continueRow, enqueueArtwork);
}

function enqueueArtwork(element: HTMLElement, priority: number): void {
  const mediaId = element.dataset.artworkMediaId;
  const kind = element.dataset.artworkKind as LocalArtworkReference["kind"] | undefined;
  if (!mediaId || !kind || element.dataset.artworkLoading === "true" || element.dataset.artworkLoaded === "true") return;
  element.dataset.artworkLoading = "true";
  const generation = String(Number(element.dataset.artworkGeneration ?? 0) + 1);
  element.dataset.artworkGeneration = generation;
  artworkQueue.push({ element, mediaId, kind, priority, generation });
  artworkQueue.sort((left, right) => right.priority - left.priority);
  void pumpArtwork();
}

async function pumpArtwork(): Promise<void> {
  while (artworkActive < ARTWORK_CONCURRENCY && artworkQueue.length > 0) {
    const task = artworkQueue.shift();
    if (!task) return;
    const current = () => task.element.isConnected && task.element.dataset.artworkMediaId === task.mediaId && task.element.dataset.artworkKind === task.kind && task.element.dataset.artworkGeneration === task.generation;
    const key = `${task.mediaId}:${task.kind}`;
    let request = artworkRequests.get(key);
    if (!request) {
      artworkActive += 1;
      request = window.zVideo.localLibrary.getArtwork(task.mediaId, task.kind);
      artworkRequests.set(key, request);
      void request.finally(() => {
        artworkRequests.delete(key);
        artworkActive -= 1;
        void pumpArtwork();
      }).catch(() => undefined);
    }
    void request.then(async (result) => {
      if (!result.dataUrl || !current()) return;
      const image = document.createElement("img");
      image.alt = "本地封面";
      image.decoding = "async";
      image.src = result.dataUrl;
      await image.decode();
      if (!current()) return;
      const fallback = coverData({ mediaId: task.mediaId as LocalMediaItem["mediaId"], title: "", sourceId: "", collectionId: "", kind: "movie", sizeBytes: 0, modifiedAtMs: 0, available: true }).tone;
      const tone = posterTone(task.mediaId, image, fallback);
      task.element.replaceChildren(image);
      task.element.dataset.artworkLoaded = "true";
      applyTone(task.element, tone);
      if (task.element.id === "hero-poster" && hero) applyTone(hero, tone);
      if (selectedMediaId === task.mediaId && detail && isDetailLayerOpen()) {
        applyTone(detail, tone);
        if (playerView) applyTone(playerView, tone);
      }
    }).catch(() => undefined).finally(() => {
      if (current()) task.element.dataset.artworkLoading = "false";
    });

  }
}

function scheduleScanRefresh(): void {
  if (scanProgress?.status !== "running" || scanCommit <= scanRenderedCommit) return;
  if (isDetailOrPlayerVisible()) {
    scanRefreshQueued = true;
    return;
  }
  if (scanRefreshTimer !== undefined || scanRefreshInFlight) {
    scanRefreshQueued = true;
    return;
  }
  scanRefreshTimer = window.setTimeout(() => {
    scanRefreshTimer = undefined;
    if (scanProgress?.status !== "running") return;
    if (isDetailOrPlayerVisible()) {
      scanRefreshQueued = true;
      return;
    }
    scanRefreshInFlight = true;
    scanRefreshQueued = false;
    const renderedCommit = scanCommit;
    void loadLibrary().then((applied) => {
      if (applied) scanRenderedCommit = Math.max(scanRenderedCommit, renderedCommit);
    }).finally(() => {
      scanRefreshInFlight = false;
      if (scanProgress?.status === "running" && scanCommit > scanRenderedCommit) scheduleScanRefresh();
    });
  }, 350);
}

/**
 * Ticket 18: a scan refresh queued while the detail or player covered the list
 * must be consumed by the teardown that uncovers it, otherwise the finished
 * scan never reaches the list until the next navigation.
 */
function consumeScanRefresh(): void {
  if (!scanRefreshQueued) return;
  scanRefreshQueued = false;
  const renderedCommit = scanCommit;
  void loadLibrary().then((applied) => {
    if (applied) scanRenderedCommit = Math.max(scanRenderedCommit, renderedCommit);
  });
}

async function loadLibrary(): Promise<boolean> {
  if (isDetailOrPlayerVisible() || isSearchBase() || isCleanupLayerOpen()) {
    scanRefreshQueued = true;
    return false;
  }
  const epoch = ++libraryEpoch;
  inFlightRequests.library += 1;
  const query = { ...currentQuery };
  if (libraryGrid && libraryEmpty) {
    if (!libraryLoadedOnce) {
      libraryEmpty.hidden = true;
      libraryGrid.replaceChildren(...Array.from({ length: 8 }, () => {
        const skeleton = document.createElement("div");
        skeleton.className = "media-skeleton";
        skeleton.setAttribute("aria-hidden", "true");
        return skeleton;
      }));
    }
    libraryGrid.setAttribute("aria-busy", "true");
    setMessage("正在加载片库…");
  }
  try {
    if (usesCollectionList()) {
      const result = await window.zVideo.localLibrary.listCollections(currentCollectionQuery());
      if (epoch !== libraryEpoch || !result.page) return false;
      libraryLoadedOnce = true;
      renderState(result.state);
      renderPage({ mode: "collection", ...result.page });
      libraryGrid?.removeAttribute("aria-busy");
      if (scanProgress?.status === "running") {
        setMessage(`正在扫描：已索引 ${result.page.totalCount} 部作品，已提交 ${scanProgress.importedFiles + scanProgress.updatedFiles} 项。`, false);
      } else if (result.page.totalCount) {
        setMessage(`已索引 ${result.page.totalCount} 部作品。`, false);
      } else {
        setMessage(currentEmptyState(0).message, false);
      }
      return true;
    }
    const result = await window.zVideo.localLibrary.list(query);
    if (epoch !== libraryEpoch || !result.page) return false;
    libraryLoadedOnce = true;
    renderState(result.state);
    renderPage({ mode: "media", ...result.page });
    libraryGrid?.removeAttribute("aria-busy");
    if (scanProgress?.status === "running") {
      setMessage(`正在扫描：已索引 ${result.page.totalCount} 集，已提交 ${scanProgress.importedFiles + scanProgress.updatedFiles} 项。`, false);
    } else if (result.page.totalCount) {
      setMessage(`已索引 ${result.page.totalCount} 集。`, false);
    } else {
      setMessage(currentEmptyState(0).message, false);
    }
    return true;
  } catch (error) {
    if (epoch === libraryEpoch) {
      if (state?.status === "error") {
        libraryGrid?.removeAttribute("aria-busy");
        libraryGrid?.replaceChildren();
        if (libraryPageError) libraryPageError.hidden = true;
        return false;
      }
      const message = error instanceof Error ? error.message : "本地片库加载失败。";
      setMessage(message, true);
      if (libraryGrid) { libraryGrid.removeAttribute("aria-busy"); libraryGrid.replaceChildren(); }
      if (libraryEmpty) libraryEmpty.hidden = true;
      if (libraryPagination) libraryPagination.hidden = true;
      if (libraryOfflineNotice) libraryOfflineNotice.hidden = true;
      if (libraryPageError) libraryPageError.hidden = false;
      if (libraryPageErrorMessage) libraryPageErrorMessage.textContent = "这一页没有读取成功。这不是空片库，现有作品没有被删除。可以重试当前页，或返回首页稍后继续。";
      if (libraryPageErrorCode) libraryPageErrorCode.textContent = `collection_page_read_failed · page=${currentQuery.page} · pageSize=${currentQuery.pageSize} · ${message}`;
      libraryPageErrorTitle?.focus({ preventScroll: true });
    }
    return false;
  } finally {
    // Ticket 18: the list's busy carrier belongs to the domain, not to one
    // request, so a discarded load still clears it.
    if (finishRequest("library") === 0) libraryGrid?.removeAttribute("aria-busy");
  }
}

/**
 * Ticket 20 / F-04: the error card's retry used to call loadLibrary(), which
 * returned silently while the owner was in `error` — nothing initialized and
 * the card never changed. This retries the owner itself (the next owner call
 * re-runs initialization), reports progress, and counts failed attempts so a
 * click can never look like it did nothing.
 */
async function retryLocalLibrary(): Promise<void> {
  if (libraryRetryBusy) return;
  libraryRetryBusy = true;
  setLibraryRetryBusy(true);
  if (libraryErrorRetryNote) {
    libraryErrorRetryNote.hidden = true;
    libraryErrorRetryNote.textContent = "";
  }
  setMessage("正在重新初始化本地片库服务…");
  try {
    const result = await window.zVideo.localLibrary.list({ page: 1, pageSize: PAGE_SIZE });
    renderState(result.state);
    if (result.state.status === "ready") {
      libraryRetryAttempts = 0;
      await loadLibrary();
      await loadContinueWatching();
      await loadHomeShelves();
      setMessage("本地片库服务已恢复。");
    } else {
      reportLibraryRetryFailure();
    }
  } catch (error) {
    reportLibraryRetryFailure(error);
  } finally {
    libraryRetryBusy = false;
    setLibraryRetryBusy(false);
  }
}

function setLibraryRetryBusy(busy: boolean): void {
  if (libraryErrorRetry) {
    libraryErrorRetry.disabled = busy;
    libraryErrorRetry.textContent = busy ? "正在重试…" : "重试";
  }
  document.querySelector("#library-error")?.setAttribute("aria-busy", busy ? "true" : "false");
}

function reportLibraryRetryFailure(error?: unknown): void {
  libraryRetryAttempts += 1;
  const stamp = new Date();
  const clock = [stamp.getHours(), stamp.getMinutes(), stamp.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
  if (libraryErrorRetryNote) {
    libraryErrorRetryNote.textContent = `第 ${libraryRetryAttempts} 次重试仍失败（${clock}）。片库服务没有启动，错误码见下方技术详情。`;
    libraryErrorRetryNote.hidden = false;
  }
  setMessage(error instanceof Error && error.message ? error.message : "重试仍失败：本地片库服务没有启动。", true);
}

async function loadContinueWatching(): Promise<void> {
  const epoch = ++continueEpoch;
  try {
    const result = await window.zVideo.localLibrary.listContinueWatching();
    if (epoch !== continueEpoch) return;
    renderContinue(result.items);
  } catch {
    if (epoch === continueEpoch) renderContinue([]);
  }
}

/* A2 · cleanup view -------------------------------------------------------- */

let cleanupSettings: CleanupSettings = defaultCleanupSettings();
let cleanupQueue: LocalCleanupQueue | undefined;
let cleanupQuery: LocalCleanupQueueQuery = { page: 1, pageSize: 50, rule: "all", state: "none" };
let cleanupSettingsDraft: CleanupSettings | undefined;
let cleanupRequestEpoch = 0;
/**
 * Ticket 14: card marks and close-time decisions write the same column, so they
 * share one mutex. A second mark cannot start while either path is in flight.
 */
let cleanupMarkBusy = false;

function cleanupRuleText(rule: CleanupRuleId): string {
  return `${rule} · ${CLEANUP_RULE_LABELS[rule]}`;
}

function renderCleanupFilters(): void {
  const rule = cleanupQuery.rule ?? "all";
  const state = cleanupQuery.state ?? "none";
  if (cleanupRuleFilters) {
    const buttons: HTMLButtonElement[] = [];
    const makeRule = (value: "all" | CleanupRuleId, label: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.cleanupRule = value;
      button.setAttribute("aria-pressed", String(rule === value));
      button.textContent = label;
      buttons.push(button);
    };
    makeRule("all", "全部规则");
    for (const ruleId of CLEANUP_RULE_ORDER) makeRule(ruleId, cleanupRuleText(ruleId));
    cleanupRuleFilters.replaceChildren(...buttons);
  }
  if (cleanupStateFilters) {
    const states: CleanupState[] = ["none", "keep", "snooze", "delete-candidate"];
    cleanupStateFilters.replaceChildren(...states.map((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.cleanupState = value;
      button.setAttribute("aria-pressed", String(state === value));
      button.textContent = value === "none" ? "待整理" : CLEANUP_STATE_LABELS[value];
      return button;
    }));
  }
}

function setCleanupQuery(patch: Partial<LocalCleanupQueueQuery>): void {
  cleanupQuery = { ...cleanupQuery, ...patch, page: patch.page ?? 1 };
  renderCleanupFilters();
  void loadCleanupQueue();
}

function renderCleanupPagination(queue: LocalCleanupQueue): void {
  if (!cleanupPagination) return;
  cleanupPagination.replaceChildren();
  const totalPages = Math.max(1, Math.ceil(queue.totalCount / queue.query.pageSize));
  cleanupPagination.hidden = totalPages <= 1;
  if (totalPages <= 1) return;
  const add = (label: string, target: number, disabled: boolean, ariaLabel?: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cleanupPage = String(target);
    button.textContent = label;
    button.disabled = disabled;
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    cleanupPagination?.append(button);
  };
  add("上一页", queue.query.page - 1, queue.query.page <= 1, "上一页");
  const status = document.createElement("span");
  status.className = "page-status";
  status.textContent = `第 ${queue.query.page} / ${totalPages} 页`;
  cleanupPagination.append(status);
  add("下一页", queue.query.page + 1, queue.query.page >= totalPages, "下一页");
}

function renderCleanupQueue(queue: LocalCleanupQueue): void {
  cleanupQueue = queue;
  const active = (queue.query.state ?? "none") === "none";
  if (cleanupSummary) {
    cleanupSummary.textContent = active
      ? `候选 ${queue.totalCount} 部 · 约 ${formatBytes(queue.totalBytes)}`
      : `${CLEANUP_STATE_LABELS[queue.query.state ?? "none"]} ${queue.totalCount} 部 · 约 ${formatBytes(queue.totalBytes)}`;
  }
  if (cleanupMessage) {
    cleanupMessage.textContent = active
      ? "按 C → D → A → B → E 排序，同规则按可释放空间从大到小；每条候选都写出命中的规则和当前阈值。"
      : "这些是你手动标记过的文件；可以撤销标记让它重新进入待整理。";
  }
  if (cleanupCandidates) {
    cleanupCandidates.replaceChildren(...queue.candidates.map((candidate) => renderCleanupCandidate({
      candidate,
      settings: cleanupSettings,
      nowMs: queue.nowMs,
      ...(queue.relativeLargeBytes === undefined ? {} : { relativeLargeBytes: queue.relativeLargeBytes }),
      artworkReady: true,
    })));
    cleanupCandidates.querySelectorAll<HTMLElement>("[data-artwork-media-id]").forEach((element) => enqueueArtwork(element, 1));
  }
  if (cleanupEmpty) {
    cleanupEmpty.hidden = queue.totalCount > 0;
    if (cleanupEmptyTitle) {
      cleanupEmptyTitle.textContent = active ? "当前没有候选" : `没有“${CLEANUP_STATE_LABELS[queue.query.state ?? "none"]}”标记`;
    }
    if (cleanupEmptyMessage) {
      cleanupEmptyMessage.textContent = active
        ? "当前规则和阈值下没有需要整理的文件。可以打开“规则”调整预设或阈值，或返回片库继续浏览。"
        : "标记过的文件会留在这里；撤销标记后它会重新进入待整理。";
    }
  }
  if (cleanupQueueBar) cleanupQueueBar.hidden = false;
  if (cleanupDeleteSummary) cleanupDeleteSummary.textContent = `待删清单 ${queue.deleteCount} 项 · ${formatBytes(queue.deleteBytes)}`;
  if (cleanupViewDelete) cleanupViewDelete.disabled = queue.deleteCount === 0;
  renderCleanupPagination(queue);
}

async function loadCleanupQueue(): Promise<void> {
  if (!isCleanupLayerOpen()) return;
  const epoch = ++cleanupRequestEpoch;
  if (cleanupMessage) cleanupMessage.textContent = "正在读取整理候选…";
  try {
    const result = await window.zVideo.localLibrary.getCleanupQueue(cleanupQuery);
    if (epoch !== cleanupRequestEpoch || !isCleanupLayerOpen()) return;
    renderCleanupQueue(result.queue);
  } catch (error) {
    if (epoch !== cleanupRequestEpoch) return;
    if (cleanupMessage) cleanupMessage.textContent = error instanceof Error ? error.message : "整理候选读取失败，请重试。";
    cleanupCandidates?.replaceChildren();
    if (cleanupEmpty) cleanupEmpty.hidden = true;
    if (cleanupQueueBar) cleanupQueueBar.hidden = true;
    if (cleanupPagination) cleanupPagination.hidden = true;
  }
}

async function showCleanup(): Promise<void> {
  if (isSearchBase()) exitSearchState();
  setView({ layers: { cleanup: true, detail: false } });
  // Ticket 18: the cleanup layer only drops the list and detail requests it
  // covers; an in-flight search or a queued refresh is not its business.
  libraryEpoch += 1;
  detailEpoch += 1;
  applyView();
  if (libraryEmpty) libraryEmpty.hidden = true;
  if (libraryPagination) libraryPagination.hidden = true;
  cleanupQuery = { page: 1, pageSize: 50, rule: "all", state: "none" };
  renderCleanupFilters();
  updateScanUi();
  try {
    const preferences = await window.zVideo.appPreferences.get();
    cleanupSettings = preferences.cleanup;
  } catch {
    cleanupSettings = defaultCleanupSettings();
  }
  if (!isCleanupLayerOpen()) return;
  await loadCleanupQueue();
  document.querySelector<HTMLElement>("#cleanup-title")?.focus({ preventScroll: true });
}

function hideCleanup(returnFocus = true): void {
  if (!isCleanupLayerOpen()) return;
  setView({ layers: { cleanup: false } });
  cleanupRequestEpoch += 1;
  cleanupQueue = undefined;
  applyView();
  updateScanUi();
  void loadLibrary();
  void loadContinueWatching();
  if (isHomeBase()) void loadHomeShelves();
  if (returnFocus) cleanupEntry?.focus({ preventScroll: true });
}

async function setCleanupMark(mediaId: string, state: CleanupState): Promise<void> {
  if (cleanupMarkBusy) return;
  cleanupMarkBusy = true;
  if (cleanupMessage) cleanupMessage.textContent = "正在更新标记…";
  try {
    await window.zVideo.localLibrary.setCleanupState({ mediaId: mediaId as `media_${string}`, state });
    const notice = state === "keep"
      // Ticket 14: "保留" is terminal. It never names an expiry, because there is none.
      ? "已保留；不会再回到整理候选，也没有到期时间。"
      : state === "snooze"
        ? `已标记稍后；${cleanupSettings.snoozeDays} 天内不再出现。`
        : state === "delete-candidate"
          ? "已加入待删清单。应用不会删除文件，请在资源管理器中确认后手动删除。"
          : "已移回候选。";
    await loadCleanupQueue();
    if (cleanupMessage) cleanupMessage.textContent = notice;
    if (cleanupDeleteDialog?.open) renderCleanupDeleteDialog();
  } catch (error) {
    if (cleanupMessage) cleanupMessage.textContent = error instanceof Error ? error.message : "标记失败，请重试。";
  } finally {
    cleanupMarkBusy = false;
  }
}

/** The close-time decision can only be one of the three real marks. */
type ReviewDecision = Exclude<CleanupState, "none">;

function reviewMarkNotice(target: ReviewTarget, state: ReviewDecision): string {
  return reviewDecisionNotice(target.title, state, cleanupSettings.snoozeDays);
}

function setReviewDialogBusy(busy: boolean): void {
  for (const button of [reviewKeepButton, reviewSnoozeButton, reviewDeleteButton, reviewBackButton, reviewRetryButton]) {
    if (button) button.disabled = busy;
  }
  reviewDecisionDialog?.setAttribute("aria-busy", busy ? "true" : "false");
}

function focusCleanupCard(mediaId: string): boolean {
  const card = document.querySelector<HTMLElement>(`#cleanup-candidates [data-cleanup-media-id="${cssEscape(mediaId)}"]`);
  if (!card) return false;
  card.scrollIntoView({ block: "center" });
  card.focus({ preventScroll: true });
  return true;
}

function openReviewDecision(): void {
  const target = reviewTarget;
  if (!target) return;
  if (reviewDecisionTitle) reviewDecisionTitle.textContent = `《${target.title}》要保留吗？`;
  if (reviewDecisionFacts) reviewDecisionFacts.textContent = reviewFactsText(target.viewing, Date.now());
  if (reviewDecisionError) {
    reviewDecisionError.textContent = "";
    reviewDecisionError.hidden = true;
  }
  if (reviewRetryButton) reviewRetryButton.hidden = true;
  reviewPendingState = undefined;
  setReviewDialogBusy(false);
  if (!reviewDecisionDialog) return;
  if (!reviewDecisionDialog.open) reviewDecisionDialog.showModal();
  reviewKeepButton?.focus({ preventScroll: true });
}

/**
 * Ticket 14: drop a pending decision without touching the cleanup page. The
 * library error state hides that page, so clearing the target here is enough to
 * keep a late player close from opening the decision dialog over it.
 */
function clearReviewTarget(): void {
  reviewTarget = undefined;
  reviewPendingState = undefined;
  if (reviewDecisionError) {
    reviewDecisionError.textContent = "";
    reviewDecisionError.hidden = true;
  }
  if (reviewDecisionDialog?.open) reviewDecisionDialog.close();
}

/** Escape or “返回队列”: keep the old mark and focus the candidate that started the check. */
function returnToReviewQueue(): void {
  const target = reviewTarget;
  clearReviewTarget();
  if (!target) return;
  // Keep the card DOM that opened the review. This playback has just changed
  // the A1 facts (open count / last-open time), so a reload could legitimately
  // drop the candidate; focus would then have nowhere to return. The queue
  // recalculates on the next filter/page/refresh action.
  cleanupQuery = { ...target.returnQuery };
  renderCleanupFilters();
  if (cleanupMessage) cleanupMessage.textContent = "已返回整理队列；没有修改标记。本次播放已记入观看记录，候选数字会在下次刷新时重算。";
  if (!focusCleanupCard(target.mediaId)) cleanupCandidates?.querySelector<HTMLElement>("[data-cleanup-action]")?.focus();
}

/** Persist one close-time decision, then show the marked state with the card focused. */
async function markReviewDecision(state: ReviewDecision): Promise<void> {
  const target = reviewTarget;
  if (!target || cleanupMarkBusy) return;
  cleanupMarkBusy = true;
  reviewPendingState = state;
  setReviewDialogBusy(true);
  if (reviewDecisionError) {
    reviewDecisionError.textContent = "";
    reviewDecisionError.hidden = true;
  }
  try {
    await window.zVideo.localLibrary.setCleanupState({ mediaId: target.mediaId, state });
    reviewTarget = undefined;
    reviewPendingState = undefined;
    if (reviewDecisionDialog?.open) reviewDecisionDialog.close();
    setReviewDialogBusy(false);
    cleanupQuery = { ...target.returnQuery, rule: "all", state, page: 1 };
    renderCleanupFilters();
    await loadCleanupQueue();
    if (cleanupMessage) cleanupMessage.textContent = reviewMarkNotice(target, state);
    focusCleanupCard(target.mediaId);
  } catch (error) {
    if (reviewDecisionError) {
      reviewDecisionError.textContent = error instanceof Error ? error.message : "标记保存失败，请重试。";
      reviewDecisionError.hidden = false;
    }
    if (reviewRetryButton) reviewRetryButton.hidden = false;
    setReviewDialogBusy(false);
    // Keep the chosen decision under the keyboard so Enter retries directly.
    const chosen = state === "keep" ? reviewKeepButton : state === "snooze" ? reviewSnoozeButton : reviewDeleteButton;
    chosen?.focus({ preventScroll: true });
  } finally {
    cleanupMarkBusy = false;
  }
}

/** Open the candidate through the only playback bridge; the review header uses A1 facts. */
async function openReviewMedia(restart = false): Promise<void> {
  const target = reviewTarget;
  if (!target) return;
  recordPlayerOrigin();
  activePlaybackTitle = target.title;
  showPlayer(true);
  updateReviewBar();
  setPlayerStatus("正在打开检查播放…");
  try {
    const result = await window.zVideo.localPlayback.open(target.mediaId, restart ? { restart: true } : undefined);
    if (!result?.opened) throw new Error("播放器没有接受这次打开请求，已退出加载状态，请重试。");
  } catch (error) {
    discardPlayerSession();
    showPlayer(false);
    updateReviewBar();
    setMessage(error instanceof Error ? error.message : "检查播放失败，请重试。", true);
    openReviewDecision();
  }
}

function startReview(candidate: LocalCleanupCandidate): void {
  if (reviewTarget || isPlayerLayerOpen() || cleanupMarkBusy) return;
  if (!isCleanupLayerOpen()) return;
  reviewTarget = {
    mediaId: candidate.item.mediaId,
    title: candidate.item.title,
    ...(candidate.viewing ? { viewing: candidate.viewing } : {}),
    returnQuery: { ...cleanupQuery },
  };
  reviewPendingState = undefined;
  void openReviewMedia();
}

function openReviewForMedia(mediaId: string | undefined): void {
  if (!mediaId) return;
  const candidate = cleanupQueue?.candidates.find((entry) => entry.item.mediaId === mediaId);
  if (candidate) startReview(candidate);
}

function cleanupFieldDisplay(field: (typeof CLEANUP_THRESHOLD_FIELDS)[number], value: number): string {
  if (field.displayScale === 1) return String(value);
  const display = value * field.displayScale;
  return String(Math.round(display * 10) / 10);
}

function prepareCleanupDraft(settings: CleanupSettings): void {
  cleanupSettingsDraft = {
    preset: settings.preset,
    thresholds: { ...settings.thresholds },
    rules: { ...settings.rules },
    snoozeDays: settings.snoozeDays,
    keepDays: settings.keepDays,
  };
}

function syncCleanupSettingsSummary(): void {
  const draft = cleanupSettingsDraft;
  if (!draft) return;
  document.querySelectorAll<HTMLButtonElement>("#cleanup-preset-buttons [data-cleanup-preset]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.cleanupPreset === draft.preset));
  });
  if (cleanupSettingsSummaryHost) cleanupSettingsSummaryHost.textContent = `${CLEANUP_PRESET_LABELS[draft.preset]}预设 · ${cleanupSettingsSummary(draft)}`;
  if (cleanupSettingsPreview) cleanupSettingsPreview.textContent = `保存后按当前设置重新计算候选：${cleanupSettingsSummary(draft)}。`;
}

function renderCleanupSettingsForm(): void {
  const draft = cleanupSettingsDraft;
  if (!draft) return;
  const presetHost = document.querySelector<HTMLElement>("#cleanup-preset-buttons");
  if (presetHost) {
    const presets: Array<Exclude<CleanupPreset, "custom">> = ["conservative", "standard", "aggressive"];
    presetHost.replaceChildren(...presets.map((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.cleanupPreset = preset;
      button.setAttribute("aria-pressed", String(draft.preset === preset));
      button.textContent = CLEANUP_PRESET_LABELS[preset];
      return button;
    }));
  }
  const toggleHost = document.querySelector<HTMLElement>("#cleanup-rule-toggles");
  if (toggleHost) {
    toggleHost.replaceChildren(...(["A", "B", "C", "D", "E"] as const).map((rule) => {
      const label = document.createElement("label");
      label.className = "cleanup-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.cleanupToggle = rule;
      input.checked = draft.rules[rule];
      const text = document.createElement("span");
      text.textContent = `${rule} · ${CLEANUP_RULE_LABELS[rule]}`;
      label.append(input, text);
      return label;
    }));
  }
  const thresholdHost = document.querySelector<HTMLElement>("#cleanup-threshold-fields");
  if (thresholdHost) {
    thresholdHost.replaceChildren(...CLEANUP_THRESHOLD_FIELDS.map((field) => {
      const wrapper = document.createElement("div");
      wrapper.className = "cleanup-field";
      const label = document.createElement("label");
      label.htmlFor = `cleanup-threshold-${field.key}`;
      label.textContent = field.label;
      const control = document.createElement("div");
      control.className = "cleanup-field-control";
      const input = document.createElement("input");
      input.id = `cleanup-threshold-${field.key}`;
      input.type = "number";
      input.inputMode = "decimal";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      input.value = cleanupFieldDisplay(field, draft.thresholds[field.key]);
      input.dataset.cleanupThreshold = field.key;
      input.dataset.cleanupScale = String(field.displayScale);
      const unit = document.createElement("span");
      unit.className = "cleanup-field-unit";
      unit.textContent = field.unit;
      control.append(input, unit);
      wrapper.append(label, control);
      return wrapper;
    }));
  }
  const dayHost = document.querySelector<HTMLElement>("#cleanup-day-fields");
  if (dayHost) {
    const dayField = (key: "snooze", labelText: string, value: number): HTMLElement => {
      const wrapper = document.createElement("div");
      wrapper.className = "cleanup-field";
      const label = document.createElement("label");
      label.htmlFor = `cleanup-days-${key}`;
      label.textContent = labelText;
      const control = document.createElement("div");
      control.className = "cleanup-field-control";
      const input = document.createElement("input");
      input.id = `cleanup-days-${key}`;
      input.type = "number";
      input.inputMode = "numeric";
      input.min = "1";
      input.max = "3650";
      input.step = "1";
      input.value = String(value);
      input.dataset.cleanupDays = key;
      const unit = document.createElement("span");
      unit.className = "cleanup-field-unit";
      unit.textContent = "天";
      control.append(input, unit);
      wrapper.append(label, control);
      return wrapper;
    };
    dayHost.replaceChildren(dayField("snooze", "稍后默认天数", draft.snoozeDays));
    // Ticket 14: "保留" is terminal, so `keepDays` expires nothing. The stored
    // preference still round-trips through a hidden control so saving this dialog
    // does not reset a value the settings contract still requires.
    const keepDays = document.createElement("input");
    keepDays.type = "hidden";
    keepDays.id = "cleanup-days-keep";
    keepDays.value = String(draft.keepDays);
    keepDays.dataset.cleanupDays = "keep";
    const keepNote = document.createElement("p");
    keepNote.className = "cleanup-field-note muted";
    keepNote.textContent = "“保留”是终态，不再需要天数；只有“稍后”会在到期后回到候选。";
    dayHost.append(keepDays, keepNote);
  }
  syncCleanupSettingsSummary();
}

function openCleanupSettings(): void {
  if (!cleanupSettingsDialog || cleanupSettingsDialog.open) return;
  prepareCleanupDraft(cleanupSettings);
  if (cleanupSettingsError) {
    cleanupSettingsError.textContent = "";
    cleanupSettingsError.hidden = true;
  }
  renderCleanupSettingsForm();
  cleanupSettingsDialog.showModal();
  document.querySelector<HTMLButtonElement>("#cleanup-settings-close")?.focus();
}

function applyCleanupDraftPreset(preset: Exclude<CleanupPreset, "custom">): void {
  const draft = cleanupSettingsDraft;
  if (!draft) return;
  cleanupSettingsDraft = { ...draft, preset, thresholds: resolveCleanupPreset(preset) };
  renderCleanupSettingsForm();
}

function applyCleanupDraftInputs(): void {
  const draft = cleanupSettingsDraft;
  if (!draft) return;
  const next: CleanupSettings = {
    preset: draft.preset,
    thresholds: { ...draft.thresholds },
    rules: { ...draft.rules },
    snoozeDays: draft.snoozeDays,
    keepDays: draft.keepDays,
  };
  document.querySelectorAll<HTMLInputElement>("#cleanup-threshold-fields input[data-cleanup-threshold]").forEach((input) => {
    const key = input.dataset.cleanupThreshold as keyof CleanupThresholds | undefined;
    const scale = Number(input.dataset.cleanupScale ?? "1");
    const display = Number(input.value);
    if (!key || !(key in next.thresholds) || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(display)) return;
    next.thresholds[key] = Math.round(display / scale);
    if (next.thresholds[key] !== draft.thresholds[key]) next.preset = "custom";
  });
  document.querySelectorAll<HTMLInputElement>("#cleanup-day-fields input[data-cleanup-days]").forEach((input) => {
    const days = Number(input.value);
    if (!Number.isInteger(days)) return;
    if (input.dataset.cleanupDays === "snooze") next.snoozeDays = days;
    else next.keepDays = days;
  });
  document.querySelectorAll<HTMLInputElement>("#cleanup-rule-toggles input[data-cleanup-toggle]").forEach((input) => {
    const rule = input.dataset.cleanupToggle as keyof CleanupRuleToggles | undefined;
    if (rule && rule in next.rules) next.rules[rule] = input.checked;
  });
  cleanupSettingsDraft = next;
  syncCleanupSettingsSummary();
}

async function saveCleanupSettings(): Promise<void> {
  if (!cleanupSettingsDraft) return;
  applyCleanupDraftInputs();
  const draft = cleanupSettingsDraft;
  if (!draft) return;
  if (cleanupSettingsError) {
    cleanupSettingsError.textContent = "";
    cleanupSettingsError.hidden = true;
  }
  try {
    const settings = parseCleanupSettings(draft);
    const preferences = await window.zVideo.appPreferences.setCleanup(settings);
    cleanupSettings = preferences.cleanup;
    cleanupSettingsDialog?.close();
    await loadCleanupQueue();
    if (cleanupMessage) cleanupMessage.textContent = "整理规则已保存；候选已按新阈值重新计算。";
  } catch (error) {
    if (cleanupSettingsError) {
      cleanupSettingsError.textContent = error instanceof Error ? error.message : "整理规则保存失败，请检查阈值。";
      cleanupSettingsError.hidden = false;
    }
  }
}

function renderCleanupDeleteDialog(): void {
  const queue = cleanupQueue;
  if (!cleanupDeleteList) return;
  if (cleanupDeleteDialogSummary) {
    cleanupDeleteDialogSummary.textContent = queue
      ? `${queue.deleteCount} 项 · ${formatBytes(queue.deleteBytes)}。删除后重新扫描，观看记录会一起消失。`
      : "";
  }
  cleanupDeleteList.replaceChildren();
  if (!queue || queue.deleteCount === 0) {
    const empty = document.createElement("li");
    empty.className = "cleanup-delete-empty";
    empty.textContent = "待删清单为空。在候选卡上点“待删”会把文件加入清单。";
    cleanupDeleteList.append(empty);
    return;
  }
  cleanupDeleteList.append(...queue.deleteQueue.map(renderCleanupDeleteItem));
}

function openCleanupDeleteDialog(): void {
  if (!cleanupDeleteDialog || cleanupDeleteDialog.open) return;
  if (cleanupDeleteMessage) cleanupDeleteMessage.textContent = "";
  renderCleanupDeleteDialog();
  cleanupDeleteDialog.showModal();
  document.querySelector<HTMLButtonElement>("#cleanup-delete-close")?.focus();
}

async function revealCleanupMedia(mediaId: string): Promise<void> {
  const host = cleanupDeleteMessage ?? cleanupMessage;
  try {
    const result = await window.zVideo.localLibrary.revealCleanupMedia(mediaId);
    if (host) host.textContent = result.revealed ? "已在资源管理器中定位文件；应用没有删除它。" : "无法定位文件，可能已移动、删除或来源离线。";
  } catch (error) {
    if (host) host.textContent = error instanceof Error ? error.message : "无法在资源管理器中定位文件。";
  }
}

function cleanupCardAction(element: HTMLElement): void {
  const card = element.closest<HTMLElement>("[data-cleanup-media-id]");
  const action = element.dataset.cleanupAction as "review" | "keep" | "snooze" | "delete" | "none" | undefined;
  const mediaId = card?.dataset.cleanupMediaId;
  if (!mediaId || !action) return;
  if (action === "review") {
    openReviewForMedia(mediaId);
    return;
  }
  const state: CleanupState = action === "delete" ? "delete-candidate" : action;
  void setCleanupMark(mediaId, state);
}

function syncQueryControls(): void {
  const sort = currentQuery.sort ?? "recent";
  const sortLabel = LIBRARY_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "最近观看";
  if (sortMenuValue) sortMenuValue.textContent = sortLabel;
  if (sortMenuTrigger) sortMenuTrigger.dataset.value = sort;
  sortListbox?.syncSelection();
  document.querySelectorAll<HTMLButtonElement>("#library-filter-buttons [data-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.filter === (currentQuery.filter ?? "all"))));
  renderSourceFilters();
}

function setQuery(patch: Partial<LocalLibraryQuery>): void {
  currentQuery = { ...currentQuery, ...patch, page: patch.page ?? 1 };
  syncQueryControls();
}

/** Page, filter, sort and new-search changes start the result area at the top. */
function scrollResultsToTop(): void {
  if (libraryContent) libraryContent.scrollTop = 0;
  const scroller = document.scrollingElement;
  if (scroller) scroller.scrollTop = 0;
  window.scrollTo(0, 0);
}

function applyQuery(patch: Partial<LocalLibraryQuery>): void {
  setQuery(patch);
  scrollResultsToTop();
  void loadLibrary();
}

function currentDetailOriginKind(): DetailOriginKind {
  if (isSearchBase()) return "search";
  if ((currentQuery.filter ?? "all") === "episode") return "episodes";
  return isHomeBase() ? "home" : "library";
}

function detailOriginLabel(kind: DetailOriginKind): string {
  return kind === "home" ? "返回首页" : kind === "search" ? "返回搜索结果" : kind === "episodes" ? "返回单集列表" : "返回片库";
}

function applyDetailNav(nav: string | undefined): void {
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    if (nav && button.dataset.nav === nav) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function captureDetailOrigin(focusTarget?: HTMLElement): DetailOrigin {
  const focused = focusTarget ?? document.activeElement;
  return {
    kind: currentDetailOriginKind(),
    nav: document.querySelector<HTMLButtonElement>("[data-nav][aria-current='page']")?.dataset.nav,
    scrollTop: libraryContent?.scrollTop ?? 0,
    windowScrollY: document.scrollingElement?.scrollTop ?? window.scrollY,
    focusMediaId: focused instanceof HTMLElement && focused.dataset.mediaId ? focused.dataset.mediaId : undefined,
    focusContainerId: focused instanceof HTMLElement
      ? focused.closest("#library-grid") ? "#library-grid"
        : focused.closest("#search-grid") ? "#search-grid"
          : focused.closest("#recent-row") ? "#recent-row" : focused.closest("#shows-row") ? "#shows-row" : focused.closest("#continue-row") ? "#continue-row" : undefined
      : undefined,
    focusControlId: focused instanceof HTMLElement && focused.id ? `#${CSS.escape(focused.id)}` : undefined,
  };
}

function applyDetailOriginChrome(origin: DetailOrigin): void {
  if (detailBack) detailBack.textContent = `← ${detailOriginLabel(origin.kind)}`;
  if (detailErrorBack) detailErrorBack.textContent = detailOriginLabel(origin.kind);
  applyDetailNav(origin.nav);
}

function setDetailScroll(top: number): void {
  if (libraryContent) libraryContent.scrollTop = top;
  const scroller = document.scrollingElement;
  if (scroller) scroller.scrollTop = top;
  else window.scrollTo(0, top);
}

function restoreDetailScroll(origin: DetailOrigin): void {
  if (libraryContent) libraryContent.scrollTop = origin.scrollTop;
  const scroller = document.scrollingElement;
  if (scroller) scroller.scrollTop = origin.windowScrollY;
  else window.scrollTo(0, origin.windowScrollY);
}

function clearDetailContent(): void {
  if (detailTitle) detailTitle.textContent = "";
  detailMeta?.replaceChildren();
  if (detailPlot) {
    detailPlot.textContent = "";
    detailPlot.classList.remove("collapsed");
  }
  if (detailPlotToggle) {
    detailPlotToggle.hidden = true;
    detailPlotToggle.setAttribute("aria-expanded", "false");
  }
  if (detailPlotEmpty) detailPlotEmpty.hidden = true;
  if (detailPlotSection) detailPlotSection.hidden = true;
  if (detailPoster) {
    detailPoster.replaceChildren();
    delete detailPoster.dataset.artworkMediaId;
    delete detailPoster.dataset.artworkKind;
    delete detailPoster.dataset.artworkLoaded;
    delete detailPoster.dataset.artworkLoading;
  }
  if (detailOpen) {
    detailOpen.textContent = "播放";
    detailOpen.disabled = true;
    detailOpen.dataset.playbackMode = "play";
  }
  if (detailRestart) {
    detailRestart.hidden = true;
    detailRestart.disabled = true;
  }
  if (detailResume) {
    detailResume.hidden = true;
    detailResume.textContent = "";
  }
  if (detailPlaybackNote) {
    detailPlaybackNote.hidden = true;
    detailPlaybackNote.textContent = "";
  }
  if (detailOfflineBanner) detailOfflineBanner.hidden = true;
  detailEpisodes?.replaceChildren();
  detailSeasonTabs?.replaceChildren();
  if (detailEpisodesSection) detailEpisodesSection.hidden = true;
  if (detailFileSection) detailFileSection.hidden = true;
  document.querySelector("#detail-file-info")?.replaceChildren();
  if (detailViewingSection) detailViewingSection.hidden = true;
  document.querySelector("#detail-viewing")?.replaceChildren();
  const viewingEmpty = document.querySelector<HTMLElement>("#detail-viewing-empty");
  if (viewingEmpty) {
    viewingEmpty.hidden = true;
    viewingEmpty.textContent = "";
  }
}

/**
 * Ticket 18: `re-opening` is a real detail state, not a silent re-render. An
 * episode switch shows the same loading carrier as the first open while the
 * previous episode's content is already gone.
 */
type DetailViewState = "loading" | "re-opening" | "ready" | "error" | "unavailable";

function setDetailViewState(viewState: DetailViewState): void {
  const loading = viewState === "loading" || viewState === "re-opening";
  if (detail) {
    detail.dataset.state = viewState;
    if (loading) detail.setAttribute("aria-busy", "true");
    else detail.removeAttribute("aria-busy");
  }
  if (detailSkeleton) detailSkeleton.hidden = !loading;
  if (detailError) detailError.hidden = viewState !== "error" && viewState !== "unavailable";
  if (detailContent) detailContent.hidden = viewState !== "ready";
}

function showDetailError(message: string): void {
  clearDetailContent();
  if (detailErrorTitle) detailErrorTitle.textContent = "详情加载失败";
  if (detailErrorMessage) detailErrorMessage.textContent = message;
  if (detailErrorRetry) detailErrorRetry.hidden = false;
  setDetailViewState("error");
  detailErrorTitle?.focus({ preventScroll: true });
}

/**
 * A tombstoned or stale `mediaId` no longer resolves to a detail (the owner
 * returns nothing). That is one item being gone, not the page failing: show a
 * readable state with a way back instead of the retryable load error.
 */
function showDetailUnavailable(): void {
  clearDetailContent();
  if (detailErrorTitle) detailErrorTitle.textContent = "该文件已不可用";
  if (detailErrorMessage) detailErrorMessage.textContent = "它可能已被移动、删除或从来源移除，片库已没有这条记录。重新扫描来源后，列表会按索引结果更新。";
  if (detailErrorRetry) detailErrorRetry.hidden = true;
  setDetailViewState("unavailable");
  detailErrorTitle?.focus({ preventScroll: true });
}

async function openDetail(mediaId: string, returnFocusTarget?: HTMLElement, restoringOrigin?: DetailOrigin): Promise<void> {
  const entering = !isDetailLayerOpen();
  const retrying = detail?.dataset.state === "error";
  // Ticket 18 / P-03: an episode switch re-opens the same detail surface for a
  // different media. It is neither the first open nor a retry, so it used to
  // leave the previous episode's title, cover and play action on screen while
  // the new request was in flight.
  const displayedMediaId = activeDetail?.item.mediaId ?? detailRequestMediaId;
  const switching = !entering && !retrying && mediaId !== displayedMediaId;
  if (entering) {
    skipFlight();
    detailFlightStarted = false;
    detailRenderCount = 0;
    previousWatchedIds = new Set();
  }
  // Measure and clone the source poster before the home view is hidden; the
  // flight itself starts once the detail has real geometry.
  const flightSource = entering ? captureFlightSource(detailFlightSource(returnFocusTarget)) : undefined;
  if (entering) {
    detailOrigin = restoringOrigin ?? captureDetailOrigin(returnFocusTarget);
    applyDetailOriginChrome(detailOrigin);
    setDetailScroll(0);
  } else if ((retrying || switching) && detailOrigin) {
    applyDetailOriginChrome(detailOrigin);
  }
  if (entering || retrying) {
    clearDetailContent();
    setDetailViewState("loading");
  } else if (switching) {
    clearDetailContent();
    setDetailViewState("re-opening");
    setMessage("正在切换剧集…");
  }
  // Ticket 18: the detail domain owns this generation; opening or closing a
  // detail no longer cancels an in-flight list load or search.
  const epoch = ++detailEpoch;
  inFlightRequests.detail += 1;
  activeDetail = undefined;
  activeDetailPlayback = undefined;
  selectedMediaId = mediaId;
  detailRequestMediaId = mediaId;
  detailSearchFormOpen = false;
  setView({ layers: { detail: true } });
  applyView();
  updateHeaderSearch();
  updateScanUi();
  if (!switching) setMessage("正在打开详情…");
  try {
    const result = await window.zVideo.localLibrary.get(mediaId);
    if (epoch !== detailEpoch) return;
    const loaded = result.detail ?? (result.item ? { item: result.item, episodes: [result.item] } : undefined);
    if (!loaded) {
      // Ticket 11 owner contract: a tombstoned media id resolves to nothing.
      activeDetail = undefined;
      activeDetailPlayback = undefined;
      detailFlightStarted = false;
      showDetailUnavailable();
      setMessage("该文件已不可用。", true);
      return;
    }
    activeDetail = loaded;
    // Reveal the content before measuring text so the plot disclosure sees a
    // real layout box instead of a hidden ancestor with no computed line height.
    setDetailViewState("ready");
    renderDetail(loaded);
    if (entering) {
      fadeIn(detailContent, motionDuration("--mo-3", 200));
      if (flightSource) detailFlightStarted = startFlight(flightSource, detailPoster, motionDuration("--mo-3", 200));
    }
    if (entering || retrying) detailTitle?.focus({ preventScroll: true });
    setMessage(loaded.item.available ? "" : "来源离线；播放和从头播放已禁用。", !loaded.item.available);
  } catch (error) {
    if (epoch === detailEpoch) {
      const message = error instanceof Error ? error.message : "详情加载失败。";
      activeDetail = undefined;
      activeDetailPlayback = undefined;
      detailFlightStarted = false;
      showDetailError(message);
      setMessage(message, true);
    }
  } finally {
    // Ticket 18: a detail request discarded by closing the layer or leaving the
    // page must not leave the (hidden) detail region busy forever.
    if (finishRequest("detail") === 0 && epoch !== detailEpoch && detail) {
      delete detail.dataset.state;
      detail.removeAttribute("aria-busy");
    }
  }
}

function episodeLabel(item: LocalMediaItem): string {
  if (item.kind !== "episode") return "";
  if (item.seasonNumber !== undefined && item.episodeNumber !== undefined) return `第 ${item.seasonNumber} 季 第 ${item.episodeNumber} 集`;
  if (item.episodeNumber !== undefined) return `第 ${item.episodeNumber} 集`;
  return "";
}

function renderDetail(detailValue: LocalMediaDetail): void {
  const item = detailValue.item;
  selectedMediaId = item.mediaId;
  activeDetailPlayback = detailPlayback(detailValue);
  activePlaybackTitle = item.title;
  if (playerCurrentTitle) playerCurrentTitle.textContent = activePlaybackTitle;
  if (detailTitle) detailTitle.textContent = detailValue.collectionTitle?.trim() || item.title;
  if (detailMeta) {
    const parts: HTMLElement[] = [];
    for (const value of [kindLabel(item.kind), ...(item.year === undefined ? [] : [String(item.year)]), item.premieredDate ? `发布日期 ${item.premieredDate}` : "发布日期未知", ...(item.seasonNumber !== undefined && item.episodeNumber !== undefined ? [`S${String(item.seasonNumber).padStart(2, "0")}E${String(item.episodeNumber).padStart(2, "0")}`] : [])]) {
      const part = document.createElement("span");
      part.textContent = value;
      parts.push(part);
    }
    if (item.rating !== undefined) {
      const score = item.rating.toFixed(1);
      const badge = document.createElement("span");
      badge.className = "detail-rating-badge";
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", `评分 ${score}`);
      const shape = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      shape.setAttribute("viewBox", "0 0 96 96");
      shape.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", biscuitPath(42, 6, 8));
      shape.append(path);
      const value = document.createElement("span");
      value.textContent = score;
      badge.append(shape, value);
      parts.push(badge);
    }
    detailMeta.replaceChildren(...parts);
  }
  const plot = item.plot?.trim() ?? "";
  if (detailPlotSection) detailPlotSection.hidden = !plot;
  let plotNeedsDisclosure = false;
  if (detailPlot) {
    detailPlot.textContent = plot;
    detailPlot.classList.remove("collapsed");
    if (plot) {
      const lineHeight = Number.parseFloat(getComputedStyle(detailPlot).lineHeight);
      plotNeedsDisclosure = Number.isFinite(lineHeight) && detailPlot.scrollHeight > lineHeight * 3 + 1;
    }
    detailPlot.classList.toggle("collapsed", plotNeedsDisclosure);
  }
  if (detailPlotSection) {
    detailPlotSection.hidden = !plot;
    if (detailPlotToggle) {
      detailPlotToggle.hidden = !plotNeedsDisclosure;
      detailPlotToggle.setAttribute("aria-expanded", "false");
      const label = detailPlotToggle.querySelector("span");
      if (label) label.textContent = "展开";
    }
  }
  if (detailPlotEmpty) detailPlotEmpty.hidden = Boolean(plot);
  if (detailOfflineBanner) detailOfflineBanner.hidden = item.available;
  if (detailPlaybackNote) {
    detailPlaybackNote.hidden = item.available;
    detailPlaybackNote.textContent = item.available ? "" : "来源离线：播放和从头播放已禁用。重新连接驱动器或网络位置后，在文件夹页重新扫描。";
  }
  const playback = activeDetailPlayback;
  const resume = hasResume(playback);
  const restartAfterCompletion = Boolean(playback?.watched);
  const episode = episodeLabel(item);
  if (detailOpen) {
    detailOpen.textContent = resume
      ? episode ? `继续播放 · ${episode}` : `继续播放 · ${formatTime(playback.positionSec)}`
      : restartAfterCompletion ? "重新播放" : "播放";
    detailOpen.dataset.playbackMode = resume ? "resume" : restartAfterCompletion ? "restart" : "play";
    detailOpen.disabled = !item.available;
    detailOpen.setAttribute("aria-label", resume && episode ? `继续播放《${detailValue.collectionTitle?.trim() || item.title}》${episode}` : detailOpen.textContent);
  }
  if (detailRestart) {
    detailRestart.hidden = !resume;
    detailRestart.disabled = !item.available;
    detailRestart.dataset.playbackMode = "restart";
    detailRestart.setAttribute("aria-label", "从头播放（会清除当前观看进度）");
  }
  if (detailResume) {
    detailResume.hidden = !playback;
    detailResume.textContent = playback
      ? item.available
        ? playback.watched
          ? `已保存进度 ${formatTime(playback.positionSec)} · 已看完`
          : `已保存进度 ${formatTime(playback.positionSec)} · 可继续或从头开始`
        : `已保存进度 ${formatTime(playback.positionSec)} · 来源离线，暂时无法继续播放`
      : "";
  }
  if (detailEpisodesSection && detailEpisodes) {
    const episodes = detailValue.episodes.filter((candidate) => candidate.kind === "episode");
    detailEpisodesSection.hidden = episodes.length === 0;
    const seasons = [...new Set(episodes.map((episode) => episode.seasonNumber).filter((season): season is number => season !== undefined))];
    if (!seasons.includes(selectedSeason ?? -1)) selectedSeason = seasons[0];
    const visibleEpisodes = seasons.length > 1 ? episodes.filter((episode) => episode.seasonNumber === selectedSeason) : episodes;
    detailEpisodes.replaceChildren(...episodeRows(visibleEpisodes, selectedMediaId, playback, detailValue.episodePlayback ?? []));
    detailEpisodes.querySelectorAll<HTMLElement>("[data-artwork-media-id]").forEach((element) => enqueueArtwork(element, 1));
    detailSeasonTabs?.replaceChildren(...renderSeasonTabs(episodes, selectedSeason));
    // B6b ② · crossfade only the mark that actually became watched; a re-render
    // of the list never animates every watched row.
    const playbackByMediaId = new Map((detailValue.episodePlayback ?? []).map((entry) => [entry.mediaId, entry]));
    const watchedIds = new Set(visibleEpisodes.filter((episode) => {
      const entry = playbackByMediaId.get(episode.mediaId) ?? (episode.mediaId === selectedMediaId ? playback : undefined);
      return Boolean(entry?.watched);
    }).map((episode) => episode.mediaId));
    detailRenderCount += 1;
    if (detailRenderCount > 1) {
      const newlyWatched = [...watchedIds].find((mediaId) => !previousWatchedIds.has(mediaId));
      const mark = newlyWatched ? detailEpisodes.querySelector<HTMLElement>(`[data-media-id="${cssEscape(newlyWatched)}"] .episode-watched-mark`) : null;
      if (mark) {
        mark.classList.add("mo-watched-in");
        const cleanup = () => {
          mark.classList.remove("mo-watched-in");
          mark.removeEventListener("animationend", cleanup);
        };
        mark.addEventListener("animationend", cleanup);
      }
    }
    previousWatchedIds = watchedIds;
  }
  if (detailFileSection) {
    const isMovie = item.kind === "movie" || detailValue.collectionKind === "movie";
    detailFileSection.hidden = !isMovie;
    const sourceLabel = state?.sources.find((source) => source.sourceId === item.sourceId)?.label ?? "本地来源";
    const fileInfo = renderMovieFileInfo(item, sourceLabel, playback);
    fileInfo.id = "detail-file-info";
    detailFileSection.querySelector("#detail-file-info")?.replaceWith(fileInfo);
  }
  if (detailViewingSection) {
    const viewingHost = document.querySelector<HTMLElement>("#detail-viewing");
    const emptyHost = document.querySelector<HTMLElement>("#detail-viewing-empty");
    if (viewingHost && emptyHost) {
      detailViewingSection.hidden = false;
      const viewing = renderViewingRecord({
        history: detailValue.viewing,
        legacyPlayback: detailValue.viewing ? undefined : playback,
        fileSizeBytes: item.sizeBytes,
      });
      viewing.list.id = "detail-viewing";
      viewing.empty.id = "detail-viewing-empty";
      viewingHost.replaceWith(viewing.list);
      emptyHost.replaceWith(viewing.empty);
    }
  }
  if (detailPoster) {
    detailPoster.replaceChildren(generatedCover(item, detailValue.episodes.filter((episode) => episode.kind === "episode").length));
    const tone = coverData(item).tone;
    if (detail) applyTone(detail, tone);
    if (playerView) applyTone(playerView, tone);
    detailPoster.dataset.artworkGeneration = String(Number(detailPoster.dataset.artworkGeneration ?? 0) + 1);
    delete detailPoster.dataset.artworkLoaded;
    delete detailPoster.dataset.artworkLoading;
    delete detailPoster.dataset.artworkKind;
    detailPoster.dataset.artworkMediaId = item.mediaId;
    const kind = artworkKind(item);
    if (kind) {
      detailPoster.dataset.artworkKind = kind;
      enqueueArtwork(detailPoster, 2);
    }
  }
}

function closeDetail(): void {
  // Ticket 18: closing the detail drops only the detail domain. An in-flight
  // search or list load keeps running and reports its own result.
  detailEpoch += 1;
  const origin = detailOrigin;
  detailOrigin = undefined;
  detailRequestMediaId = undefined;
  activeDetail = undefined;
  activeDetailPlayback = undefined;
  selectedMediaId = undefined;
  detailSearchFormOpen = false;
  if (detailFlightStarted) skipFlight();
  const returnFlight = detailFlightStarted && detailPoster && origin?.kind === "home" ? captureFlightSource(detailPoster) : undefined;
  detailFlightStarted = false;
  setView({ layers: { detail: false } });
  if (detail) {
    delete detail.dataset.state;
    detail.removeAttribute("aria-busy");
  }
  applyView();
  updateHeaderSearch();
  updateScanUi();
  if (origin?.kind === "search") {
    if (isSearchBase() && searchQuery) {
      if (origin) applyDetailNav(origin.nav);
      void loadSearch().then(() => {
        if (!origin) return;
        const target = origin.focusMediaId && origin.focusContainerId
          ? document.querySelector<HTMLButtonElement>(`${origin.focusContainerId} [data-media-id="${cssEscape(origin.focusMediaId)}"]`)
          : origin.focusMediaId ? document.querySelector<HTMLButtonElement>(`#search-grid [data-media-id="${cssEscape(origin.focusMediaId)}"]`) : null;
        target?.focus({ preventScroll: true });
        restoreDetailScroll(origin);
      });
      return;
    }
    // Ticket 12: a detail opened from search must never leave a visible but
    // unloaded search page behind; drop back to the list instead.
    if (searchGrid) searchGrid.replaceChildren();
    if (searchPagination) {
      searchPagination.replaceChildren();
      searchPagination.hidden = true;
    }
    searchPageView = undefined;
  }
  if (origin) applyDetailNav(origin.nav);
  // Ticket 18: this list load is what consumes a refresh queued while the
  // detail covered the list; a successful load settles the scan commit.
  void Promise.all([loadLibrary(), isHomeBase() ? loadHomeShelves() : Promise.resolve()]).then(([applied]) => {
    if (applied) {
      scanRenderedCommit = Math.max(scanRenderedCommit, scanCommit);
      scanRefreshQueued = false;
    }
    if (!origin) return;
    const target = origin.focusControlId ? document.querySelector<HTMLButtonElement>(origin.focusControlId)
      : origin.focusMediaId && origin.focusContainerId ? document.querySelector<HTMLButtonElement>(`${origin.focusContainerId} [data-media-id="${cssEscape(origin.focusMediaId)}"]`)
        : origin.focusMediaId ? document.querySelector<HTMLButtonElement>(`#library-grid [data-media-id="${cssEscape(origin.focusMediaId)}"]`) : null;
    target?.focus({ preventScroll: true });
    restoreDetailScroll(origin);
    if (returnFlight) {
      const returnTarget = detailReturnTarget(origin);
      if (returnTarget) startFlight(returnFlight, returnTarget, motionDuration("--mo-return", 160));
    }
  });
  void loadContinueWatching();
}

async function openSelectedLocalMedia(restart = false): Promise<void> {
  if (!selectedMediaId) {
    // Ticket 20 / CL-08: this entry is reachable from visible actions, so an
    // empty target must say why instead of returning silently.
    setMessage("没有选中的播放目标；请从详情页或整理队列重新打开。", true);
    setPlayerStatus("没有选中的播放目标。", true);
    return;
  }
  if (!isPlayerLayerOpen()) recordPlayerOrigin();
  activePlaybackTitle = activeDetail?.item.title ?? "本地媒体";
  showPlayer(true);
  setPlayerStatus(restart ? "正在从头打开本地媒体…" : "正在打开本地媒体…");
  try {
    const result = await window.zVideo.localPlayback.open(selectedMediaId, restart ? { restart: true } : undefined);
    // Ticket 20 / P-12: main answers `{opened:false}` when the player host or its
    // window is gone. Ignoring it left the view on "正在加载" forever with no
    // event coming; leaving the loading state and reporting is the only exit.
    if (!result?.opened) throw new Error("播放器没有接受这次打开请求，已退出加载状态，请重试。");
  } catch (error: unknown) {
    discardPlayerSession();
    showPlayer(false);
    setMessage(error instanceof Error ? error.message : "本地播放请求失败。", true);
  }
}

async function handleImport(operation: () => Promise<Awaited<ReturnType<typeof window.zVideo.localLibrary.openVideo>>>): Promise<void> {
  if (sourceBusy) return;
  sourceBusy = true;
  chooseFolderButton?.setAttribute("disabled", "true");
  openVideoButton?.setAttribute("disabled", "true");
  setMessage("正在索引本地媒体…");
  try {
    const outcome = await operation();
    sourceBusy = false;
    if (outcome.status === "cancelled") setMessage("已取消。" );
    else if (outcome.status === "empty") setMessage("所选文件夹没有找到支持的视频文件。", true);
    else {
      singleVideoSourceIds.add(outcome.item.sourceId);
      setMessage(`已加入《${outcome.item.title}》。`);
      showAppNotice("已加入单个视频", `只加入了《${outcome.item.title}》，并把它所在的文件夹登记为片库文件夹。以后重新扫描，会把整个文件夹里的其他支持视频也加入片库。`);
    }
    renderState(outcome.state);
    await loadLibrary();
    await loadContinueWatching();
    await loadHomeShelves();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "导入失败。", true);
  } finally {
    sourceBusy = false;
    chooseFolderButton?.removeAttribute("disabled");
    openVideoButton?.removeAttribute("disabled");
  }
}

async function runScan(operation: () => Promise<LocalScanResult | LocalScanResult[]>): Promise<void> {
  if (sourceBusy) return;
  sourceBusy = true;
  rescanAllButton?.setAttribute("disabled", "true");
  chooseFolderButton?.setAttribute("disabled", "true");
  openVideoButton?.setAttribute("disabled", "true");
  scanId = undefined;
  scanStartedAtMs = undefined;
  scanStartedScanId = undefined;
  stopScanElapsedTimer();
  document.querySelector("#scan-warnings")?.replaceChildren();
  scanProgress = { scanId: "pending", sourceId: "", status: "running", scannedFiles: 0, importedFiles: 0, updatedFiles: 0, warningCount: 0 };
  scanCommit = 0;
  scanRenderedCommit = -1;
  scanRefreshQueued = false;
  updateScanUi();
  setMessage("正在扫描本地来源…");
  try {
    const raw = await operation();
    // The scan is no longer running once the main process resolves it; keep the
    // refresh work below from blocking a follow-up rescan click.
    sourceBusy = false;
    const results = Array.isArray(raw) ? raw : [raw];
    const result = results.length === 1 ? results[0] : aggregateScanResults(results);
    renderScanResult(result);
    await loadLibrary();
    await loadContinueWatching();
    await loadHomeShelves();
    const unavailable = results.find((entry) => entry.status === "unavailable");
    if (unavailable) offerOfflineSource(unavailable);
  } catch (error) {
    scanProgress = undefined;
    if (!isDetailOrPlayerVisible()) libraryEpoch += 1;
    scanCommit = scanRenderedCommit;
    scanRefreshQueued = false;
    stopScanElapsedTimer();
    updateScanUi();
    const message = error instanceof Error ? error.message : "扫描失败。";
    showAppNotice("扫描失败", message, "error");
    setMessage(message, true);
  } finally {
    sourceBusy = false;
    scanId = undefined;
    if (scanProgress?.status === "running") {
      scanProgress = undefined;
      scanCommit = scanRenderedCommit;
      scanRefreshQueued = false;
    }
    stopScanElapsedTimer();
    if (scanRefreshTimer !== undefined) {
      window.clearTimeout(scanRefreshTimer);
      scanRefreshTimer = undefined;
    }
    updateScanUi();
    rescanAllButton?.removeAttribute("disabled");
    chooseFolderButton?.removeAttribute("disabled");
    openVideoButton?.removeAttribute("disabled");
  }
}

function aggregateScanResults(results: LocalScanResult[]): LocalScanResult {
  const status: LocalScanResult["status"] = results.some((result) => result.status === "unavailable")
    ? "unavailable"
    : results.some((result) => result.status === "partial")
      ? "partial"
      : results.some((result) => result.status === "cancelled")
        ? "cancelled"
        : "completed";
  return {
    scanId: results[0]?.scanId ?? "scan_all",
    sourceId: results[0]?.sourceId ?? "",
    sourceLabel: `全部 ${results.length} 个文件夹`,
    status,
    scannedFiles: results.reduce((sum, result) => sum + result.scannedFiles, 0),
    importedFiles: results.reduce((sum, result) => sum + result.importedFiles, 0),
    updatedFiles: results.reduce((sum, result) => sum + result.updatedFiles, 0),
    warningCount: results.reduce((sum, result) => sum + result.warningCount, 0),
    warnings: results.flatMap((result) => result.warnings),
    ...(results.find((result) => result.status === "unavailable")?.error ? { error: results.find((result) => result.status === "unavailable")?.error } : {}),
  };
}

function setDialogError(element: HTMLElement | null, message: string | undefined): void {
  if (!element) return;
  element.textContent = message ?? "";
  element.hidden = !message;
}

function setSourceDialogBusy(busy: boolean): void {
  sourceDialogBusy = busy;
  for (const button of [removeCancelButton, removeConfirmButton, offlineKeepButton, offlineDeleteButton]) {
    if (button) button.disabled = busy;
  }
}

/**
 * Ticket 20 / B-06: an already-issued removal keeps running, so Esc must not
 * dismiss the dialog that is going to report its result. The refusal is written
 * into the dialog that stays open.
 */
function refuseBusyDialogClose(errorElement: HTMLElement | null, action: string): void {
  setDialogError(errorElement, `正在${action}，请稍候；操作完成前不能关闭这个对话框。`);
}

async function refreshAfterSourceChange(): Promise<void> {
  setQuery({ sourceId: undefined, page: 1 });
  scrollResultsToTop();
  await Promise.all([loadLibrary(), loadContinueWatching(), loadHomeShelves()]);
}

function openRemoveDialog(source: { sourceId: string; label: string; collectionCount: number; itemCount: number }): void {
  if (!removeDialog || sourceDialogBusy) return;
  removingSourceId = source.sourceId;
  if (removeDialogTitle) removeDialogTitle.textContent = `移除「${source.label}」？`;
  if (removeDialogCopy) removeDialogCopy.textContent = `将从片库移除 ${source.collectionCount} 部作品、${source.itemCount} 集，并删除这些视频的观看进度。不会删除源文件。`;
  setDialogError(removeDialogError, undefined);
  if (removeConfirmButton) removeConfirmButton.textContent = "移除并删除进度";
  setSourceDialogBusy(false);
  removeDialog.showModal();
  removeCancelButton?.focus();
}

async function confirmRemoveSource(): Promise<void> {
  const sourceId = removingSourceId;
  if (!sourceId || sourceDialogBusy) return;
  const source = state?.sources.find((candidate) => candidate.sourceId === sourceId);
  setSourceDialogBusy(true);
  setDialogError(removeDialogError, undefined);
  if (removeConfirmButton) removeConfirmButton.textContent = "正在移除…";
  try {
    const next = await window.zVideo.localLibrary.removeSource(sourceId);
    removingSourceId = undefined;
    removeDialog?.close();
    renderState(next);
    await refreshAfterSourceChange();
    showAppNotice("已移除文件夹", `已移除「${source?.label ?? "所选文件夹"}」的作品和观看进度，源文件没有被删除。`, "info");
    setMessage(`已移除「${source?.label ?? "所选文件夹"}」。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "移除失败，请重试。文件夹、作品和观看进度均未改变。";
    setDialogError(removeDialogError, message);
    // B-06: if the dialog is somehow gone, the failure still has to land on a
    // surface the user can see instead of dying inside a closed dialog.
    if (!removeDialog?.open) showAppNotice("移除失败", message, "error");
    if (removeConfirmButton) removeConfirmButton.textContent = "重试移除";
    removeConfirmButton?.focus();
  } finally {
    setSourceDialogBusy(false);
  }
}

function offerOfflineSource(result: LocalScanResult): void {
  if (!offlineDialog || sourceDialogBusy) return;
  const source = state?.sources.find((candidate) => candidate.sourceId === result.sourceId);
  if (!source) return;
  offlineSourceId = source.sourceId;
  if (offlineDialogTitle) offlineDialogTitle.textContent = `「${source.label}」现在不可用`;
  if (offlineDialogCopy) offlineDialogCopy.textContent = `可能只是驱动器或网络位置暂时断开，也可能是文件夹已经被删除。选择“暂时断开”会保留 ${source.collectionCount} 部作品、${source.itemCount} 集和观看进度；只有确认已删除才会清理这些记录。`;
  setDialogError(offlineDialogError, undefined);
  if (offlineDeleteButton) offlineDeleteButton.textContent = "已删除（清理记录）";
  setSourceDialogBusy(false);
  offlineDialog.showModal();
  offlineKeepButton?.focus();
}

function keepOfflineSource(): void {
  const source = state?.sources.find((candidate) => candidate.sourceId === offlineSourceId);
  offlineSourceId = undefined;
  offlineDialog?.close();
  setDialogError(offlineDialogError, undefined);
  if (source) {
    showAppNotice("文件夹暂时断开", `已保留「${source.label}」的作品、集数和观看进度。重新连接驱动器或网络位置后，在文件夹页重新扫描即可恢复播放。`, "warning");
    setMessage(`「${source.label}」暂时不可用；记录和观看进度已保留。`, true);
  }
}

async function deleteOfflineSource(): Promise<void> {
  const sourceId = offlineSourceId;
  if (!sourceId || sourceDialogBusy) return;
  const source = state?.sources.find((candidate) => candidate.sourceId === sourceId);
  setSourceDialogBusy(true);
  setDialogError(offlineDialogError, undefined);
  if (offlineDeleteButton) offlineDeleteButton.textContent = "正在清理…";
  try {
    const next = await window.zVideo.localLibrary.removeSource(sourceId);
    offlineSourceId = undefined;
    offlineDialog?.close();
    renderState(next);
    await refreshAfterSourceChange();
    showAppNotice("已清理文件夹记录", `已确认「${source?.label ?? "所选文件夹"}」被删除，相关作品、集数和观看进度已从片库清理；源文件未被改动。`, "info");
    setMessage(`已清理「${source?.label ?? "所选文件夹"}」的记录。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "清理失败，请重试。记录和观看进度均未改变。";
    setDialogError(offlineDialogError, message);
    if (!offlineDialog?.open) showAppNotice("清理失败", message, "error");
    if (offlineDeleteButton) offlineDeleteButton.textContent = "重试清理";
    offlineDeleteButton?.focus();
  } finally {
    setSourceDialogBusy(false);
  }
}

function formatScanElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function scanSourceLabel(progress: LocalScanProgress): string {
  if (progress.sourceLabel) return progress.sourceLabel;
  return state?.sources.find((source) => source.sourceId === progress.sourceId)?.label || "所选文件夹";
}

function showAppNotice(title: string, body: string, tone: "info" | "warning" | "error" = "info", motionOnce = false): void {
  if (!appNotice) return;
  const wasHidden = appNotice.hidden;
  if (appNoticeTitle) appNoticeTitle.textContent = title;
  if (appNoticeBody) appNoticeBody.textContent = body;
  appNotice.dataset.state = tone;
  appNotice.hidden = false;
  // B6b ④ · a completed scan summary unfolds once, then stays still.
  if (motionOnce && wasHidden && motionAllowsTransform()) {
    appNotice.classList.add("mo-notice-in");
    const cleanup = () => {
      appNotice.classList.remove("mo-notice-in");
      appNotice.removeEventListener("animationend", cleanup);
    };
    appNotice.addEventListener("animationend", cleanup);
  }
}

function hideAppNotice(): void {
  if (appNotice) appNotice.hidden = true;
  if (!pendingScanSummary) return;
  // Ticket 08: the dismissed summary hands over to the home result card.
  pendingScanSummary = false;
  updateScanUi();
}

function stopScanElapsedTimer(): void {
  if (scanElapsedTimer === undefined) return;
  window.clearInterval(scanElapsedTimer);
  scanElapsedTimer = undefined;
}

function noteScanStarted(progress: LocalScanProgress): void {
  if (scanStartedScanId !== progress.scanId) {
    scanStartedScanId = progress.scanId;
    scanStartedAtMs = Date.now();
  }
  if (scanElapsedTimer !== undefined) return;
  scanElapsedTimer = window.setInterval(() => {
    if (scanProgress?.status !== "running") {
      stopScanElapsedTimer();
      return;
    }
    updateScanUi();
  }, 1_000);
}

/** Folder-page scan panel title and the home result card use different wording. */
function scanStatusLabel(status: LocalScanProgress["status"]): string {
  return ({ running: "正在扫描", completed: "扫描完成", cancelled: "扫描已取消", partial: "扫描部分完成", unavailable: "来源不可用" })[status];
}

function scanResultLabel(status: LocalScanProgress["status"]): string {
  // Ticket 08: `partial` means degraded — some directories were not read, and
  // the indexed entries stay playable. Only `unavailable` is a real offline.
  return ({ running: "扫描中", completed: "扫描完成", cancelled: "扫描已取消", partial: "部分完成 · 部分目录未读取", unavailable: "来源离线" })[status];
}

function updateScanUi(): void {
  const running = scanProgress?.status === "running";
  if (scanStatus) {
    scanStatus.hidden = !running;
    if (running && scanStatusText) {
      const text = `扫描中 · ${scanProgress?.scannedFiles ?? 0}`;
      if (scanStatusText.textContent !== text) scanStatusText.textContent = text;
    }
  }
  const homeIdle = isHomeBase() && !isCleanupLayerOpen() && !isDetailOrPlayerVisible();
  const lastSummary = running || pendingScanSummary ? undefined : lastScanSummary;
  const showCard = Boolean(homeIdle && (running || lastSummary));
  if (homeScanCard) {
    homeScanCard.hidden = !showCard;
    // Ticket 08: only a running scan pulses; the kept result card stays still.
    homeScanCard.dataset.state = running ? "running" : "done";
  }
  onboarding?.classList.toggle("is-compact", Boolean(showCard && running));
  if (showCard && running && scanProgress) {
    const label = scanSourceLabel(scanProgress);
    const pending = scanProgress.scanId === "pending";
    if (homeScanStatus) homeScanStatus.textContent = pending ? "正在准备扫描…" : `正在扫描「${label}」`;
    if (homeScanFolder) homeScanFolder.textContent = pending ? "选择文件夹后开始只读扫描；不会移动、改名或上传文件。" : `当前文件夹：${label} · 只读取，不移动、不改名、不上传文件。`;
    if (homeScanNote) homeScanNote.textContent = "数量未知时不显示百分比；已加入的内容会原地出现，不反复替换整页骨架。";
    if (homeScanScanned) homeScanScanned.textContent = String(scanProgress.scannedFiles);
    if (homeScanAdded) homeScanAdded.textContent = String(scanProgress.importedFiles);
    if (homeScanElapsed) homeScanElapsed.textContent = scanStartedAtMs === undefined ? "计算中" : formatScanElapsed(Date.now() - scanStartedAtMs);
  } else if (showCard && lastSummary) {
    // Ticket 08: the finished scan keeps a result card with its status and counts.
    const label = scanSourceLabel(lastSummary.progress);
    const warnings = lastSummary.progress.warningCount ? ` · ${lastSummary.progress.warningCount} 条警告` : "";
    if (homeScanStatus) homeScanStatus.textContent = `上次扫描：${scanResultLabel(lastSummary.progress.status)}`;
    if (homeScanFolder) homeScanFolder.textContent = `「${label}」· 新增 ${lastSummary.progress.importedFiles} · 更新 ${lastSummary.progress.updatedFiles}${warnings}`;
    if (homeScanNote) homeScanNote.textContent = "结果保留到下一次扫描；重新扫描不会删除已有作品和观看进度。";
    if (homeScanScanned) homeScanScanned.textContent = String(lastSummary.progress.scannedFiles);
    if (homeScanAdded) homeScanAdded.textContent = String(lastSummary.progress.importedFiles);
    if (homeScanElapsed) homeScanElapsed.textContent = lastSummary.elapsedMs === undefined ? "未知" : formatScanElapsed(lastSummary.elapsedMs);
  }
  const canCancel = Boolean(running && scanId);
  document.querySelectorAll<HTMLButtonElement>("[data-cancel-scan]").forEach((button) => {
    button.hidden = !running;
    button.disabled = !canCancel;
  });
}

function requestScanCancel(): void {
  if (!scanId || scanProgress?.status !== "running") return;
  document.querySelectorAll<HTMLButtonElement>("[data-cancel-scan]").forEach((button) => { button.disabled = true; });
  void window.zVideo.localLibrary.cancelScan(scanId).catch(() => {
    document.querySelectorAll<HTMLButtonElement>("[data-cancel-scan]").forEach((button) => { button.disabled = false; });
  });
}

function renderScanProgress(progress: LocalScanProgress): void {
  scanProgress = progress;
  if (state) renderSources(state, progress, sourceList, { singleVideoSourceIds });
  if (scanPanel) scanPanel.hidden = false;
  const panelTitle = document.querySelector<HTMLElement>("#scan-panel-title");
  const counts = document.querySelector<HTMLElement>("#scan-counts");
  if (panelTitle) panelTitle.textContent = scanStatusLabel(progress.status);
  if (counts) counts.textContent = "已扫描 " + progress.scannedFiles + " · 新增 " + progress.importedFiles + " · 更新 " + progress.updatedFiles + " · 警告 " + progress.warningCount;
  const commit = progress.importedFiles + progress.updatedFiles;
  if (progress.status === "running") {
    if (progress.scanId !== "pending") scanId = progress.scanId;
    noteScanStarted(progress);
    scanCommit = Math.max(scanCommit, commit);
    scheduleScanRefresh();
  } else {
    if (scanRefreshTimer !== undefined) {
      window.clearTimeout(scanRefreshTimer);
      scanRefreshTimer = undefined;
    }
    scanRefreshQueued = false;
    stopScanElapsedTimer();
    if (!isDetailOrPlayerVisible()) libraryEpoch += 1;
    const notice = scanNotice(progress);
    if (notice) showAppNotice(notice.title, notice.body, notice.tone, progress.status === "completed");
    // Ticket 08: a terminal scan hands its status and counts to the home result
    // card, releases `scanProgress` and collapses the folder-page panel. While
    // its summary notice is up, that notice is the one visible summary.
    lastScanSummary = {
      progress,
      elapsedMs: scanStartedAtMs === undefined ? undefined : Math.max(0, Date.now() - scanStartedAtMs),
    };
    pendingScanSummary = Boolean(notice);
    scanProgress = undefined;
    scanId = undefined;
    scanStartedAtMs = undefined;
    scanStartedScanId = undefined;
    if (scanPanel) scanPanel.hidden = true;
  }
  updateScanUi();
}

function scanNotice(result: LocalScanProgress & { error?: string }): { title: string; body: string; tone: "info" | "warning" | "error" } | undefined {
  if (!result.sourceId) return undefined;
  if (result.status === "completed") {
    const warnings = result.warningCount ? `${result.warningCount} 条警告` : "无警告";
    return { title: "扫描完成", body: `新增 ${result.importedFiles} 项 · 更新 ${result.updatedFiles} 项 · ${warnings}。摘要会保留到你主动关闭，列表刷新不会覆盖它。`, tone: result.warningCount ? "warning" : "info" };
  }
  if (result.status === "cancelled") {
    return { title: "扫描已取消", body: `已扫描 ${result.scannedFiles} 个视频，已保留此前索引和播放进度。`, tone: "warning" };
  }
  if (result.status === "unavailable") {
    return { title: "来源离线", body: "已保留此前索引和播放进度；重新连接后在文件夹页重新扫描。", tone: "error" };
  }
  return { title: "扫描部分完成", body: `已扫描 ${result.scannedFiles} 个视频 · 新增 ${result.importedFiles} · 更新 ${result.updatedFiles} · ${result.warningCount} 条警告。${result.error ?? "部分目录无法读取，已保留此前索引。"}`, tone: "warning" };
}

function renderScanResult(result: LocalScanResult): void {
  renderScanProgress(result);
  const warnings = document.querySelector<HTMLElement>("#scan-warnings");
  if (warnings) warnings.replaceChildren(...result.warnings.map((warning) => { const item = document.createElement("li"); item.textContent = warning; return item; }));
  const notice = scanNotice(result);
  if (notice) showAppNotice(notice.title, notice.body, notice.tone, result.status === "completed");
  if (result.status === "completed") setMessage(`扫描完成：新增 ${result.importedFiles}，更新 ${result.updatedFiles}。`);
  else if (result.status === "cancelled") setMessage("扫描已取消，已保留此前索引和播放历史。", false);
  else if (result.status === "unavailable") setMessage("来源离线，已保留此前索引和播放历史。", true);
  else setMessage(result.error ?? "扫描部分完成，部分条目保留此前索引。", true);
}

function navigateHomeOrLibrary(target: string): void {
  if (isSearchBase()) exitSearchState();
  setView({ baseView: target === "home" ? "home" : "library", layers: { detail: false, cleanup: false } });
  // Ticket 18: top navigation drops the list and detail requests it navigates
  // away from; an unrelated search was already dropped by exitSearchState.
  libraryEpoch += 1;
  detailEpoch += 1;
  detailSearchFormOpen = false;
  applyView();
  updateHeaderSearch();
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    if (button.dataset.nav === target) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (isHomeBase()) { setQuery({ query: undefined, sourceId: undefined, filter: "all" }); void loadContinueWatching(); void loadHomeShelves(); }
  else { setQuery({ sourceId: undefined, query: undefined, filter: target === "movie" || target === "show" ? target : "all", sort: target === "recent" ? "added_desc" : currentQuery.sort }); void loadLibrary(); }
  updateScanUi();
}
document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.nav === "folder") showSources();
  else navigateHomeOrLibrary(button.dataset.nav ?? "home");
}));
document.querySelectorAll<HTMLButtonElement>("[data-shelf]").forEach((button) => button.addEventListener("click", () => navigateHomeOrLibrary(button.dataset.shelf ?? "all")));
function showSources(): void {
  if (isSearchBase()) exitSearchState();
  setView({ baseView: "sources", layers: { detail: false, cleanup: false } });
  libraryEpoch += 1;
  detailEpoch += 1;
  detailSearchFormOpen = false;
  applyView();
  updateHeaderSearch();
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    if (button.dataset.nav === "folder") button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  setQuery({ query: undefined, sourceId: undefined, page: 1 });
  if (state) renderSources(state, scanProgress, sourceList, { singleVideoSourceIds });
  updateScanUi();
}
document.querySelector<HTMLAnchorElement>('#detail-offline-banner a')?.addEventListener("click", (event) => { event.preventDefault(); showSources(); });
document.querySelectorAll<HTMLButtonElement>('[data-import="folder"]').forEach((button) => button.addEventListener("click", () => chooseFolderButton?.click()));
document.querySelectorAll<HTMLButtonElement>('[data-import="video"]').forEach((button) => button.addEventListener("click", () => openVideoButton?.click()));
document.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-cancel-scan]")) requestScanCancel();
});
appNoticeClose?.addEventListener("click", hideAppNotice);
document.querySelector<HTMLButtonElement>("#library-filter-buttons")?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-filter]");
  const filter = button?.dataset.filter as LocalLibraryQuery["filter"] | undefined;
  if (!filter) return;
  applyQuery({ filter, page: 1 });
});
sourceFilters?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-source-filter-id]");
  if (!button) {
    if ((event.target as HTMLElement).closest(".source-filter-chip")) applyQuery({ sourceId: undefined, page: 1 });
    return;
  }
  applyQuery({ sourceId: button.dataset.sourceFilterId, page: 1 });
});
emptyAddFolder?.addEventListener("click", () => chooseFolderButton?.click());
emptyAddVideo?.addEventListener("click", () => openVideoButton?.click());
emptyRescan?.addEventListener("click", () => rescanAllButton?.click());
emptyViewAll?.addEventListener("click", () => {
  applyQuery({ filter: "all", page: 1 });
});
emptyClearSearch?.addEventListener("click", () => {
  clearLibrarySearch();
});
/** B5a routes typed search to its own view; this only clears a library-scoped query. */
function clearLibrarySearch(): void {
  if (searchInput) searchInput.value = "";
  applyQuery({ query: undefined, page: 1 });
  searchInput?.focus();
}
function copyDiagnostics(): void {
  const lines = [
    "z-video 本地片库诊断",
    `时间：${new Date().toISOString()}`,
    `状态：${state?.status ?? "unknown"}`,
    `错误代码：${state?.error?.code ?? "unknown"}`,
    `错误信息：${state?.error?.message ?? ""}`,
    `来源数：${state?.sources.length ?? 0}`,
  ];
  const text = lines.join("\n");
  const done = (copied: boolean) => setMessage(copied ? "诊断信息已复制。" : "无法自动复制，请手动记录错误代码。", !copied);
  const fallback = () => {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      done(copied);
    } catch {
      done(false);
    }
  };
  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(() => done(true)).catch(fallback);
  else fallback();
}
libraryErrorCopy?.addEventListener("click", copyDiagnostics);
libraryErrorFolders?.addEventListener("click", () => showSources());
libraryOfflineFolders?.addEventListener("click", () => showSources());
libraryPageErrorRetry?.addEventListener("click", () => void loadLibrary());
libraryPageErrorBack?.addEventListener("click", () => navigateHomeOrLibrary("home"));
libraryErrorRetry?.addEventListener("click", () => void retryLocalLibrary());
for (const row of [document.querySelector<HTMLElement>("#recent-row"), document.querySelector<HTMLElement>("#shows-row")]) row?.addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]"); if (button?.dataset.mediaId) void openDetail(button.dataset.mediaId, button); });
document.querySelector<HTMLButtonElement>("#hero-detail")?.addEventListener("click", (event) => { const item = homeItems[0]?.item ?? recentItems[0]; if (item) void openDetail(item.mediaId, event.currentTarget as HTMLElement); });
for (const [id, restart] of [["#hero-play", false], ["#hero-restart", true]] as const) document.querySelector<HTMLButtonElement>(id)?.addEventListener("click", () => { const item = homeItems[0]?.item ?? recentItems[0]; if (!item || !item.available) return; selectedMediaId = item.mediaId; activeDetail = { item, episodes: [item] }; void openSelectedLocalMedia(restart); });
chooseFolderButton?.addEventListener("click", () => void runScan(() => window.zVideo.localLibrary.chooseFolder()));
openVideoButton?.addEventListener("click", () => void handleImport(() => window.zVideo.localLibrary.openVideo()));
rescanAllButton?.addEventListener("click", () => {
  if (!state?.sources.length) { setMessage("还没有可重新扫描的文件夹。", true); return; }
  void runScan(() => window.zVideo.localLibrary.rescanAll());
});
sourceList?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-refresh-source-id], [data-remove-source-id], [data-cancel-source-scan]");
  if (!target) return;
  if (target.dataset.cancelSourceScan) { requestScanCancel(); return; }
  const refreshId = target.dataset.refreshSourceId;
  const removeId = target.dataset.removeSourceId;
  if (refreshId) {
    void runScan(() => window.zVideo.localLibrary.refreshSource(refreshId));
    return;
  }
  if (removeId) {
    const source = state?.sources.find((candidate) => candidate.sourceId === removeId);
    if (!source || !removeDialog || sourceBusy) return;
    openRemoveDialog(source);
  }
});
removeCancelButton?.addEventListener("click", () => removeDialog?.close());
removeConfirmButton?.addEventListener("click", () => void confirmRemoveSource());
removeDialog?.addEventListener("cancel", (event) => {
  if (!sourceDialogBusy) return;
  event.preventDefault();
  refuseBusyDialogClose(removeDialogError, "移除");
});
removeDialog?.addEventListener("close", () => {
  // Native dialog close events are queued asynchronously. If the dialog was
  // reopened before this event arrives, it belongs to the previous dialog
  // instance and must not reset the state of the one that is open now.
  if (removeDialog?.open) return;
  // Ticket 20 / B-06: while the write is still in flight the dialog state (busy
  // markers, captured source id, error text) belongs to that operation.
  if (sourceDialogBusy) return;
  removingSourceId = undefined;
  setDialogError(removeDialogError, undefined);
  if (removeConfirmButton) removeConfirmButton.textContent = "移除并删除进度";
  setSourceDialogBusy(false);
});
offlineKeepButton?.addEventListener("click", keepOfflineSource);
offlineDeleteButton?.addEventListener("click", () => void deleteOfflineSource());
offlineDialog?.addEventListener("cancel", (event) => {
  if (!sourceDialogBusy) return;
  event.preventDefault();
  refuseBusyDialogClose(offlineDialogError, "清理");
});
offlineDialog?.addEventListener("close", () => {
  // Same async close race as the remove dialog: a queued close from a previous
  // offline prompt must not clear a dialog that has already been reopened.
  if (offlineDialog?.open) return;
  if (sourceDialogBusy) return;
  offlineSourceId = undefined;
  setDialogError(offlineDialogError, undefined);
  if (offlineDeleteButton) offlineDeleteButton.textContent = "已删除（清理记录）";
  setSourceDialogBusy(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (removeDialog?.open) {
    event.preventDefault();
    if (sourceDialogBusy) { refuseBusyDialogClose(removeDialogError, "移除"); return; }
    removeDialog.close();
  }
  else if (offlineDialog?.open) {
    event.preventDefault();
    if (sourceDialogBusy) { refuseBusyDialogClose(offlineDialogError, "清理"); return; }
    offlineDialog.close();
  }
  else if (reviewDecisionDialog?.open) { event.preventDefault(); returnToReviewQueue(); }
  else if (cleanupSettingsDialog?.open || cleanupDeleteDialog?.open) { /* the native dialog consumes Escape */ }
  else if (isCleanupLayerOpen() && !isPlayerLayerOpen()) { event.preventDefault(); hideCleanup(); }
});
libraryGrid?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]");
  if (button?.dataset.mediaId) void openDetail(button.dataset.mediaId, button);
});
continueRow?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]");
  if (button?.dataset.mediaId) void openDetail(button.dataset.mediaId, button);
});
detailEpisodes?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]");
  const mediaId = button?.dataset.mediaId;
  if (mediaId) void openDetail(mediaId, button);
});
detailSeasonTabs?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-season-number]");
  const season = Number(button?.dataset.seasonNumber);
  if (!activeDetail || !Number.isInteger(season)) return;
  selectedSeason = season;
  renderDetail(activeDetail);
});
detailBack?.addEventListener("click", closeDetail);
detailErrorRetry?.addEventListener("click", () => { if (detailRequestMediaId) void openDetail(detailRequestMediaId); });
detailErrorBack?.addEventListener("click", closeDetail);
detailPlotToggle?.addEventListener("click", () => {
  const expanded = detailPlotToggle.getAttribute("aria-expanded") !== "true";
  detailPlotToggle.setAttribute("aria-expanded", String(expanded));
  detailPlot?.classList.toggle("collapsed", !expanded);
  const label = detailPlotToggle.querySelector("span");
  if (label) label.textContent = expanded ? "收起" : "展开";
});
detailOpen?.addEventListener("click", () => { void openSelectedLocalMedia(detailOpen.dataset.playbackMode === "restart"); });
detailRestart?.addEventListener("click", () => { void openSelectedLocalMedia(true); });
playerCloseButton?.addEventListener("click", () => requestPlayerClose());
playerToggleButton?.addEventListener("click", () => {
  void sendLocalPlaybackCommand({ type: playerState === "playing" ? "pause" : "play" });
});
playerSeek?.addEventListener("change", () => {
  const requested = Number(playerSeek.value);
  void sendLocalPlaybackCommand({ type: "seek", positionSec: requested }, {
    // P-07: a rejected seek must snap the slider back to the last reported position.
    rollback: () => renderPlayerPosition(playerPositionSec, true),
  });
});
playerFullscreenButton?.addEventListener("click", () => {
  togglePlayerFullscreen();
});
playerSettingsButton?.addEventListener("click", () => {
  if (!playerSettings) return;
  if (playerSettings.hidden) openPlayerSettings();
  else closePlayerSettings(true);
});
document.querySelector<HTMLButtonElement>("#player-settings-close")?.addEventListener("click", () => closePlayerSettings(true));
document.addEventListener("pointerdown", (event) => {
  if (!isPlayerLayerOpen()) return;
  const target = event.target instanceof Node ? event.target : undefined;
  const element = target instanceof Element ? target : undefined;
  if (playerSettings && !playerSettings.hidden) {
    const inside = Boolean(target && playerSettings.contains(target));
    const onSettingsTrigger = Boolean(element?.closest("#player-settings-button"));
    if (!inside && !onSettingsTrigger) closePlayerSettings(true);
  }
});
playerNextButton?.addEventListener("click", () => { void playNextEpisode(); });
playerPlayNext?.addEventListener("click", () => { void playNextEpisode(); });
playerCancelNext?.addEventListener("click", () => {
  // Ticket 06: cancel goes through the one ended-panel exit instead of clearing
  // the countdown inline.
  resetPlaybackEndedPanel();
  if (playerCountdown) playerCountdown.textContent = "已取消自动播放";
  setPlayerStatus("已取消自动播放下一集。");
  sendOverlayState();
});
playerReplay?.addEventListener("click", () => {
  resetPlaybackEndedPanel();
  // Ticket 20 / CL-08: review playback never sets `selectedMediaId`, so the
  // generic replay entry returned silently. An inspection replay restarts the
  // inspected candidate from the beginning.
  if (reviewTarget) void openReviewMedia(true);
  else void openSelectedLocalMedia(true);
});
playerReturnList?.addEventListener("click", () => {
  requestPlayerClose(!reviewTarget && !currentItemIsMovie());
});
playerErrorRetry?.addEventListener("click", () => {
  hidePlayerError();
  if (reviewTarget) void openReviewMedia();
  else void openSelectedLocalMedia();
});
playerErrorBack?.addEventListener("click", () => requestPlayerClose());
for (const [selector, offset] of [["#player-back-10", -10], ["#player-forward-10", 10]] as const) {
  document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", () => {
    const positionSec = Math.max(0, Math.min(playerDurationSec, Number(playerSeek?.value ?? 0) + offset));
    void sendLocalPlaybackCommand({ type: "seek", positionSec }, { rollback: () => renderPlayerPosition(playerPositionSec, true) });
  });
}
playerSubtitleFileButton?.addEventListener("click", () => {
  void window.zVideo.localPlayback.chooseSubtitleFile().then(({ loaded }) => {
    if (loaded) setPlayerStatus("已加载外部字幕。");
  }).catch((error: unknown) => {
    setPlayerStatus(error instanceof Error ? error.message : "外部字幕加载失败。", true);
  });
});
playerVolume?.addEventListener("input", () => {
  void sendLocalPlaybackCommand({ type: "set-volume", volume: Number(playerVolume.value) }).then((sent) => {
    if (!sent) restorePlayerSettingsAfterFailure();
  });
});
playerVolume?.addEventListener("pointerdown", () => { playerVolumeDragging = true; });
window.addEventListener("pointerup", finishPlayerVolumeDrag);
window.addEventListener("pointercancel", finishPlayerVolumeDrag);
playerMuteButton?.addEventListener("click", () => {
  const muted = !(playerMuteCommandValue ?? playerMuted);
  playerMuteCommandValue = muted;
  void sendLocalPlaybackCommand({ type: "set-muted", muted }).then((sent) => {
    if (!sent) {
      playerMuteCommandValue = undefined;
      renderPlayerSettings();
    }
  });
});
window.addEventListener("keydown", handlePlayerShortcut);
searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = searchInput?.value.trim() ?? "";
  if (!text) {
    if (isSearchBase()) void clearSearch();
    else if (detailSearchFormOpen) {
      detailSearchFormOpen = false;
      updateHeaderSearch();
    }
    return;
  }
  void enterSearch(text);
});
searchInput?.addEventListener("input", () => {
  if (searchClear) searchClear.hidden = !Boolean(searchInput.value);
});
searchClear?.addEventListener("click", () => { void clearSearch(); });
detailSearchEntry?.addEventListener("click", () => {
  detailSearchFormOpen = true;
  updateHeaderSearch();
  searchInput?.focus();
  searchInput?.select();
});
searchFilterButtons?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-filter]");
  const filter = button?.dataset.filter as LocalLibraryFilter | undefined;
  if (!filter || !isSearchBase() || filter === searchFilter) return;
  searchFilter = filter;
  searchPage = 1;
  updateSearchFilterPressed();
  void loadSearch();
});
searchBackButton?.addEventListener("click", () => { void clearSearch(); });
searchEmptyClear?.addEventListener("click", () => { void clearSearch(); });
searchEmptyRetry?.addEventListener("click", () => { if (isSearchBase() && searchQuery) void loadSearch(); });
searchAllTypesButton?.addEventListener("click", () => {
  if (!isSearchBase()) return;
  searchFilter = "all";
  searchPage = 1;
  updateSearchChrome();
  void loadSearch();
});
searchGrid?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]");
  if (button?.dataset.mediaId) void openDetail(button.dataset.mediaId, button);
});
libraryPagination?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-page]");
  const page = Number(button?.dataset.page);
  if (!button || !Number.isInteger(page) || page < 1 || button.disabled || page === currentQuery.page) return;
  applyQuery({ page });
});
libraryPagination?.addEventListener("submit", (event) => {
  if ((event.target as HTMLElement).id !== "pagination-jump") return;
  event.preventDefault();
  submitPaginationJump("library");
});
libraryPagination?.addEventListener("input", (event) => {
  if ((event.target as HTMLElement).id === "pagination-jump-input") showPaginationJumpError("library", undefined);
});
/* Ticket 12 · the search result set pages through the same control. */
searchPagination?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-search-page]");
  const page = Number(button?.dataset.searchPage);
  if (!button || !Number.isInteger(page) || page < 1 || button.disabled || page === searchPage) return;
  searchPage = page;
  scrollResultsToTop();
  void loadSearch();
});
searchPagination?.addEventListener("submit", (event) => {
  if ((event.target as HTMLElement).id !== "search-pagination-jump") return;
  event.preventDefault();
  submitPaginationJump("search");
});
searchPagination?.addEventListener("input", (event) => {
  if ((event.target as HTMLElement).id === "search-pagination-jump-input") showPaginationJumpError("search", undefined);
});
/* A2 · cleanup view wiring. */
cleanupEntry?.addEventListener("click", () => { void showCleanup(); });
document.querySelector<HTMLButtonElement>("#cleanup-back")?.addEventListener("click", () => hideCleanup());
cleanupRuleFilters?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-cleanup-rule]");
  const rule = button?.dataset.cleanupRule as "all" | CleanupRuleId | undefined;
  if (rule) setCleanupQuery({ rule });
});
cleanupStateFilters?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-cleanup-state]");
  const state = button?.dataset.cleanupState as CleanupState | undefined;
  if (state) setCleanupQuery({ state });
});
cleanupCandidates?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cleanup-action]");
  if (target) cleanupCardAction(target);
});
cleanupCandidates?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.defaultPrevented) return;
  const target = event.target as HTMLElement | null;
  const actionButton = target?.closest<HTMLElement>("[data-cleanup-action]");
  if (actionButton) {
    event.preventDefault();
    cleanupCardAction(actionButton);
    return;
  }
  const card = target?.closest<HTMLElement>("[data-cleanup-media-id]");
  if (!card) return;
  event.preventDefault();
  openReviewForMedia(card.dataset.cleanupMediaId);
});
cleanupPagination?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-cleanup-page]");
  const page = Number(button?.dataset.cleanupPage);
  if (!button || button.disabled || !Number.isInteger(page) || page < 1) return;
  setCleanupQuery({ page });
});
document.querySelector<HTMLButtonElement>("#cleanup-settings-button")?.addEventListener("click", openCleanupSettings);
document.querySelector<HTMLButtonElement>("#cleanup-settings-close")?.addEventListener("click", () => cleanupSettingsDialog?.close());
document.querySelector<HTMLButtonElement>("#cleanup-settings-cancel")?.addEventListener("click", () => cleanupSettingsDialog?.close());
document.querySelector<HTMLElement>("#cleanup-preset-buttons")?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-cleanup-preset]");
  const preset = button?.dataset.cleanupPreset;
  if (preset === "conservative" || preset === "standard" || preset === "aggressive") applyCleanupDraftPreset(preset);
});
cleanupSettingsDialog?.addEventListener("input", applyCleanupDraftInputs);
cleanupSettingsDialog?.addEventListener("change", applyCleanupDraftInputs);
cleanupSettingsDialog?.addEventListener("close", () => {
  cleanupSettingsDraft = undefined;
  if (cleanupSettingsError) {
    cleanupSettingsError.textContent = "";
    cleanupSettingsError.hidden = true;
  }
});
document.querySelector<HTMLButtonElement>("#cleanup-settings-defaults")?.addEventListener("click", () => {
  prepareCleanupDraft(defaultCleanupSettings());
  renderCleanupSettingsForm();
});
document.querySelector<HTMLButtonElement>("#cleanup-settings-save")?.addEventListener("click", () => { void saveCleanupSettings(); });
cleanupViewDelete?.addEventListener("click", openCleanupDeleteDialog);
document.querySelector<HTMLButtonElement>("#cleanup-delete-close")?.addEventListener("click", () => cleanupDeleteDialog?.close());
cleanupDeleteDialog?.addEventListener("close", () => {
  if (cleanupDeleteMessage) cleanupDeleteMessage.textContent = "";
});
cleanupDeleteList?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cleanup-reveal], [data-cleanup-unmark]");
  if (!target) return;
  if (target.dataset.cleanupReveal) void revealCleanupMedia(target.dataset.cleanupReveal);
  else if (target.dataset.cleanupUnmark) void setCleanupMark(target.dataset.cleanupUnmark, "none");
});
/* A3 · close-time review decision. */
reviewKeepButton?.addEventListener("click", () => { void markReviewDecision("keep"); });
reviewSnoozeButton?.addEventListener("click", () => { void markReviewDecision("snooze"); });
reviewDeleteButton?.addEventListener("click", () => { void markReviewDecision("delete-candidate"); });
reviewBackButton?.addEventListener("click", () => returnToReviewQueue());
reviewRetryButton?.addEventListener("click", () => {
  if (reviewPendingState) void markReviewDecision(reviewPendingState);
});
reviewDecisionDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  returnToReviewQueue();
});
reviewDecisionDialog?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.defaultPrevented || cleanupMarkBusy) return;
  const active = document.activeElement;
  if (!(active instanceof HTMLButtonElement) || !reviewDecisionDialog?.contains(active) || active.disabled) return;
  event.preventDefault();
  active.click();
});
window.zVideo.localLibrary.onState(renderState);
window.zVideo.localLibrary.onScanProgress(renderScanProgress);
window.zVideo.localPlayback.onEvent(renderLocalPlaybackEvent);

void (async () => {
  try {
    const next = await window.zVideo.localLibrary.getState();
    await restoreSortPreference();
    renderState(next);
    updateHeaderSearch();
    applyView();
    await Promise.all([loadLibrary(), loadContinueWatching(), loadHomeShelves()]);
  } catch (error: unknown) {
    setMessage(error instanceof Error ? error.message : "本地片库加载失败。", true);
  }
})();
