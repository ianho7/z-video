import { coverData, generatedCover } from "./cover.js";
import { applyTone, posterTone } from "./tone.js";
import { escapeHtml, formatTime, kindLabel, formatBytes, artworkKind } from "./views/shared.js";
import { card } from "./views/all.js";
import { renderSources } from "./views/sources.js";
import { episodeRows, renderMovieFileInfo, renderSeasonTabs } from "./views/detail.js";
import { renderTrackOptions } from "./views/player.js";
import { renderContinueCards } from "./views/home.js";
import { wavePath } from "./shapes.js";
import type {
  LocalArtworkReference,
  LocalContinueWatchingItem,
  LocalLibraryQuery,
  LocalLibrarySort,
  LocalLibraryState,
  LocalMediaDetail,
  LocalMediaItem,
  LocalPlaybackState,
  LocalScanProgress,
  LocalScanResult,
} from "../shared/local-library-contracts";
import { isLocalLibrarySort } from "../shared/app-preferences-contracts.js";
import type { LocalPlaybackEvent } from "../shared/local-playback-contracts";

const PAGE_SIZE = 24;
const ARTWORK_CONCURRENCY = 4;

const chooseFolderButton = document.querySelector<HTMLButtonElement>("#choose-folder-button");
const appShell = document.querySelector<HTMLElement>(".app-shell");
const scanFolderButton = document.querySelector<HTMLButtonElement>("#scan-folder-button");
const openVideoButton = document.querySelector<HTMLButtonElement>("#open-video-button");
const allSourcesButton = document.querySelector<HTMLButtonElement>("#all-sources-button");
const allSourceCount = document.querySelector<HTMLElement>("#all-source-count");
const sourceList = document.querySelector<HTMLElement>("#source-list");
const libraryMessage = document.querySelector<HTMLElement>("#library-message");
const libraryGrid = document.querySelector<HTMLElement>("#library-grid");
const libraryEmpty = document.querySelector<HTMLElement>("#library-empty");
const libraryEmptyTitle = document.querySelector<HTMLElement>("#library-empty-title");
const libraryEmptyMessage = document.querySelector<HTMLElement>("#library-empty-message");
const libraryPagination = document.querySelector<HTMLElement>("#library-pagination");
const pageScope = document.querySelector<HTMLElement>("#page-scope");
const searchForm = document.querySelector<HTMLFormElement>("#library-search-form");
const searchInput = document.querySelector<HTMLInputElement>("#library-search-input");
const searchClear = document.querySelector<HTMLButtonElement>("#library-search-clear");
const filterSelect = document.querySelector<HTMLSelectElement>("#library-filter");
const sortSelect = document.querySelector<HTMLSelectElement>("#library-sort");
const scanStatus = document.querySelector<HTMLElement>("#scan-status");
const cancelScanButton = document.querySelector<HTMLButtonElement>("#cancel-scan-button");
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
const playerView = document.querySelector<HTMLElement>('[data-view="player"]');
const playerSurface = document.querySelector<HTMLElement>(".player-surface");
const playerSurfaceMessage = document.querySelector<HTMLElement>("#player-surface-message");
const playerCurrentTitle = document.querySelector<HTMLElement>("#player-current-title");
const playerCloseButton = document.querySelector<HTMLButtonElement>("#player-close-button");
const playerToggleButton = document.querySelector<HTMLButtonElement>("#player-toggle-button");
const playerSeek = document.querySelector<HTMLInputElement>("#player-seek");
const playerTime = document.querySelector<HTMLElement>("#player-time");
const playerFullscreenButton = document.querySelector<HTMLButtonElement>("#player-fullscreen-button");
const playerAudioTrack = document.querySelector<HTMLSelectElement>("#player-audio-track");
const playerSubtitleTrack = document.querySelector<HTMLSelectElement>("#player-subtitle-track");
const playerSubtitleFileButton = document.querySelector<HTMLButtonElement>("#player-subtitle-file-button");
const playerVolume = document.querySelector<HTMLInputElement>("#player-volume");
const playerMuteButton = document.querySelector<HTMLButtonElement>("#player-mute-button");
const playerSpeed = document.querySelector<HTMLSelectElement>("#player-speed");
const playerStatus = document.querySelector<HTMLElement>("#player-status");

let homeVisible = true;
let homeItems: LocalContinueWatchingItem[] = [];
let recentItems: LocalMediaItem[] = [];
let homeEpoch = 0;
const hero = document.querySelector<HTMLElement>("#home-hero");
const recentSection = document.querySelector<HTMLElement>("#recent-section");
const showsSection = document.querySelector<HTMLElement>("#shows-section");
const sidebar = document.querySelector<HTMLElement>(".source-sidebar");
let state: LocalLibraryState | undefined;
let activePage: { items: LocalMediaItem[]; totalCount: number; page: number; pageSize: number } | undefined;
let activeDetail: LocalMediaDetail | undefined;
let selectedMediaId: string | undefined;
let requestEpoch = 0;
let continueEpoch = 0;
let searchTimer: number | undefined;
let scanId: string | undefined;
let scanProgress: LocalScanProgress | undefined;
let scanRefreshTimer: number | undefined;
let scanRefreshInFlight = false;
let scanRefreshQueued = false;
let scanCommit = 0;
let scanRenderedCommit = -1;
let sourceBusy = false;
const playerNextButton = document.querySelector<HTMLButtonElement>("#player-next-button");
const playerEnded = document.querySelector<HTMLElement>("#player-ended");
const playerCountdown = document.querySelector<HTMLElement>("#player-countdown");
const playerPlayNext = document.querySelector<HTMLButtonElement>("#player-play-next");
const playerCancelNext = document.querySelector<HTMLButtonElement>("#player-cancel-next");
const playerSettings = document.querySelector<HTMLElement>("#player-settings");
const playerSettingsButton = document.querySelector<HTMLButtonElement>("#player-settings-button");
let nextTimer: number | undefined;
let returnToEpisodes = false;
let playerState: "playing" | "paused" | "buffering" | "ended" = "paused";
let playerDurationSec = 0;
let playerFullscreen = false;
let playerMuted = false;
let playerMuteCommandValue: boolean | undefined;
let playerVolumeLevel = 100;
let playerVolumeDragging = false;
let playerVolumeRestoreAfterDrag = false;
let playerSpeedValue = 1;
let activePlaybackTitle = "";
let activeDetailPlayback: LocalPlaybackState | undefined;
let returnFocusMediaId: string | undefined;
let returnFocusContainerId: "#library-grid" | "#recent-row" | "#shows-row" | undefined;
let returnFocusControlId: string | undefined;
let selectedSeason: number | undefined;
const continuePlaybackByMediaId = new Map<string, LocalPlaybackState>();

let currentQuery: LocalLibraryQuery = { page: 1, pageSize: PAGE_SIZE, filter: "all", sort: "recent" };

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
}

function isDetailOrPlayerVisible(): boolean {
  return detail?.hidden === false || playerView?.hidden === false;
}

function detailPlayback(detailValue: LocalMediaDetail): LocalPlaybackState | undefined {
  const candidate = detailValue.playback;
  return candidate?.mediaId === detailValue.item.mediaId ? candidate : continuePlaybackByMediaId.get(detailValue.item.mediaId);
}

function hasResume(playback: LocalPlaybackState | undefined): playback is LocalPlaybackState {
  return Boolean(playback && playback.positionSec > 0 && !playback.watched);
}

function currentEmptyCopy(totalCount: number): { title: string; message: string } {
  if (currentQuery.query) return { title: "没有匹配结果", message: "换一个关键词，或清除搜索条件。" };
  if (currentQuery.filter && currentQuery.filter !== "all") {
    return { title: "当前类型没有媒体", message: "切换类型或查看全部媒体。" };
  }
  if (scanProgress?.status === "running") {
    return {
      title: "正在扫描本地来源",
      message: `已提交 ${scanProgress.importedFiles + scanProgress.updatedFiles} 项，新条目会在扫描中陆续显示。`,
    };
  }
  if (state?.sources.length === 0) return { title: "还没有本地来源", message: "选择一个文件夹开始索引，或直接打开一个视频文件。" };
  if (totalCount === 0) return { title: "来源中没有可播放视频", message: "扫描其他目录，或确认来源中包含支持的视频文件。" };
  return { title: "暂无内容", message: "选择一个本地来源开始索引。" };
}

function updateEmptyCopy(totalCount: number): void {
  const copy = currentEmptyCopy(totalCount);
  if (libraryEmptyTitle) libraryEmptyTitle.textContent = copy.title;
  if (libraryEmptyMessage) libraryEmptyMessage.textContent = copy.message;
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
  const wasVisible = playerView ? !playerView.hidden : false;
  if (appShell) appShell.hidden = visible;
  if (playerView) playerView.hidden = !visible;
  const nextTitle = visible ? activePlaybackTitle : "";
  if (playerCurrentTitle && playerCurrentTitle.textContent !== nextTitle) playerCurrentTitle.textContent = nextTitle;
  if (visible && !wasVisible) playerSurface?.focus();
}

function setPlayerStatus(message: string, error = false): void {
  if (!playerStatus) return;
  playerStatus.textContent = message;
  playerStatus.title = message;
  playerStatus.dataset.state = error ? "error" : "normal";
}

function setPlayerControlsEnabled(enabled: boolean): void {
  if (playerToggleButton) playerToggleButton.disabled = !enabled;
  if (playerSeek) playerSeek.disabled = !enabled;
  if (playerFullscreenButton) playerFullscreenButton.disabled = !enabled;
  if (playerAudioTrack) playerAudioTrack.disabled = !enabled;
  if (playerSubtitleTrack) playerSubtitleTrack.disabled = !enabled;
  if (playerSubtitleFileButton) playerSubtitleFileButton.disabled = !enabled;
  if (playerVolume) playerVolume.disabled = !enabled;
  if (playerMuteButton) playerMuteButton.disabled = !enabled;
  if (playerSpeed) playerSpeed.disabled = !enabled;
  if (playerNextButton) playerNextButton.disabled = !enabled || !nextEpisode();
}

function renderMuteButton(): void {
  if (!playerMuteButton) return;
  playerMuteButton.textContent = playerMuted ? "取消静音" : "静音";
  playerMuteButton.setAttribute("aria-pressed", String(playerMuted));
}

function renderPlayerSettings(force = false): void {
  if (playerVolume && (force || !playerVolumeDragging)) playerVolume.value = String(playerVolumeLevel);
  renderMuteButton();
  if (playerSpeed && (force || document.activeElement !== playerSpeed)) playerSpeed.value = String(playerSpeedValue);
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
  if (playerView?.hidden || playerToggleButton?.disabled || event.defaultPrevented || event.isComposing) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (isPlayerFormControl(event.target) || isPlayerFormControl(document.activeElement)) return;

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
      void sendLocalPlaybackCommand({ type: "seek", positionSec });
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
  await openSelectedLocalMedia();
}

function showPlaybackEnded(): void {
  clearNextTimer();
  const next = nextEpisode();
  if (playerEnded) { playerEnded.hidden = false; playerEnded.style.setProperty("--remaining", "1"); }
  if (playerPlayNext) playerPlayNext.hidden = !next;
  if (playerCancelNext) playerCancelNext.hidden = !next;
  if (playerCountdown) playerCountdown.textContent = next ? "10 秒后播放下一集" : "";
  if (!next) return;
  let seconds = 10;
  nextTimer = window.setInterval(() => {
    seconds -= 1;
    if (playerCountdown) playerCountdown.textContent = `${seconds} 秒后播放下一集`;
    playerEnded?.style.setProperty("--remaining", String(seconds / 10));
    if (seconds <= 0) void playNextEpisode();
  }, 1000);
}

function renderLocalPlaybackEvent(event: LocalPlaybackEvent): void {
  if (event.type === "closed") {
    playerFullscreen = false;
    if (playerFullscreenButton) playerFullscreenButton.textContent = "全屏";
    showPlayer(false);
    setPlayerControlsEnabled(false);
    setPlayerStatus("");
    if (playerSurfaceMessage) playerSurfaceMessage.textContent = "正在准备原生播放器…";
    activePlaybackTitle = "";
    if (playerCurrentTitle) playerCurrentTitle.textContent = "";
    closeDetail();
    setMessage("本地播放已关闭。");
    return;
  }
  showPlayer(true);
  switch (event.type) {
    case "loading":
      playerState = "buffering";
      setPlayerControlsEnabled(false);
      setPlayerStatus("正在加载本地媒体…");
      if (playerSurfaceMessage) playerSurfaceMessage.textContent = "正在加载原生媒体…";
      break;
    case "ready":
      playerDurationSec = event.durationSec ?? 0;
      setPlayerControlsEnabled(true);
      setPlayerStatus("视频区域快捷键：Space 暂停 · ←/→ ±5秒 · ↑/↓ 音量±5 · M 静音 · F 全屏 · Esc 退出");
      if (playerSurfaceMessage) playerSurfaceMessage.textContent = "";
      if (playerSeek) {
        playerSeek.max = String(playerDurationSec);
        playerSeek.value = "0";
      }
      break;
    case "state":
      playerState = event.state;
      if (playerToggleButton) playerToggleButton.textContent = event.state === "playing" ? "暂停" : "播放";
      if (event.state === "playing") setPlayerStatus("视频区域快捷键：Space 暂停 · ←/→ ±5秒 · ↑/↓ 音量±5 · M 静音 · F 全屏 · Esc 退出");
      else if (event.state === "paused") setPlayerStatus("已暂停 · Space 继续播放");
      else if (event.state === "buffering") setPlayerStatus("缓冲中…");
      else setPlayerStatus("播放结束。");
      break;
    case "position":
      playerDurationSec = event.durationSec ?? playerDurationSec;
      if (playerSeek && document.activeElement !== playerSeek) playerSeek.value = String(event.positionSec);
      if (playerSeek) playerSeek.style.setProperty("--progress", `${playerDurationSec > 0 ? Math.min(100, event.positionSec / playerDurationSec * 100) : 0}%`);
      if (playerTime) playerTime.textContent = `${formatTime(event.positionSec)} / ${formatTime(playerDurationSec)}`;
      break;
    case "tracks":
      renderTrackOptions(playerAudioTrack, event.audio, "自动");
      renderTrackOptions(playerSubtitleTrack, event.subtitles, "关闭");
      break;
    case "settings":
      if (Number.isFinite(event.volume)) playerVolumeLevel = Math.max(0, Math.min(100, event.volume));
      playerMuted = event.muted;
      playerMuteCommandValue = undefined;
      if (Number.isFinite(event.speed)) playerSpeedValue = event.speed;
      renderPlayerSettings();
      break;
    case "control-error":
      playerMuteCommandValue = undefined;
      restorePlayerSettingsAfterFailure();
      setPlayerStatus(event.message, true);
      break;
    case "error":
      setPlayerControlsEnabled(false);
      setPlayerStatus(event.message, true);
      if (playerSurfaceMessage) playerSurfaceMessage.textContent = event.message;
      break;
  }
}

async function sendLocalPlaybackCommand(command: Parameters<typeof window.zVideo.localPlayback.command>[0]): Promise<boolean> {
  try {
    await window.zVideo.localPlayback.command(command);
    return true;
  } catch {
    setPlayerStatus("播放控制失败，请重试。", true);
    return false;
  }
}

function renderState(next: LocalLibraryState): void {
  state = next;
  renderSources(next, currentQuery.sourceId, allSourceCount, sourceList);
  if (next.status === "error") setMessage(next.error?.message ?? "本地片库不可用。", true);
}

function renderPage(page: { items: LocalMediaItem[]; totalCount: number; page: number; pageSize: number }): void {
  activePage = page;
  const focusedMediaId = preserveGridFocus();
  if (!libraryGrid || !libraryEmpty) return;
  artworkObserver?.disconnect();
  libraryGrid.replaceChildren(...page.items.map(card));
  libraryEmpty.hidden = page.items.length > 0;
  updateEmptyCopy(page.totalCount);
  if (pageScope) pageScope.textContent = page.totalCount ? `${page.totalCount} 项 · 第 ${page.page} 页` : "";
  renderPagination(page);
  artworkObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        artworkObserver?.unobserve(entry.target);
        const element = entry.target as HTMLElement;
        enqueueArtwork(element, element.closest(".media-card") ? 1 : 0);
      }
    }
  }, { rootMargin: "320px" });
  libraryGrid.querySelectorAll<HTMLElement>("[data-artwork-media-id]").forEach((element) => artworkObserver?.observe(element));
  restoreGridFocus(focusedMediaId);
}

function renderPagination(page: { totalCount: number; page: number; pageSize: number }): void {
  if (!libraryPagination) return;
  const totalPages = Math.max(1, Math.ceil(page.totalCount / page.pageSize));
  libraryPagination.replaceChildren();
  if (totalPages <= 1) return;
  const add = (label: string, target: number, disabled = false, current = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.page = String(target);
    button.disabled = disabled;
    if (current) button.setAttribute("aria-current", "page");
    libraryPagination.append(button);
  };
  add("上一页", page.page - 1, page.page <= 1);
  const start = Math.max(1, page.page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let current = start; current <= end; current += 1) add(String(current), current, false, current === page.page);
  add("下一页", page.page + 1, page.page >= totalPages);
}

function renderHomeHero(): void {
  if (!hero) return;
  const entry = homeItems[0];
  const item = entry?.item ?? recentItems[0];
  hero.hidden = !homeVisible || !item || detail?.hidden === false;
  if (!item) return;
  const title = hero.querySelector<HTMLElement>("#hero-title");
  const label = hero.querySelector<HTMLElement>("#hero-label");
  const meta = hero.querySelector<HTMLElement>("#hero-meta");
  const progress = hero.querySelector<SVGPathElement>("#hero-progress-fill");
  const track = hero.querySelector<SVGPathElement>("#hero-progress-track");
  const episode = hero.querySelector<HTMLElement>("#hero-episode");
  const restart = hero.querySelector<HTMLButtonElement>("#hero-restart");
  const play = hero.querySelector<HTMLButtonElement>("#hero-play");
  const background = hero.querySelector<HTMLElement>("#hero-artwork");
  if (title) title.textContent = item.title;
  if (label) label.textContent = entry ? "继续观看" : "最近添加";
  if (episode) episode.textContent = item.episodeNumber !== undefined ? `E${String(item.episodeNumber).padStart(2, "0")}` : "";
  if (meta) meta.textContent = [item.seasonNumber !== undefined ? `第 ${item.seasonNumber} 季` : kindLabel(item.kind), entry ? `已观看 ${formatTime(entry.playback.positionSec)}` : ""].filter(Boolean).join(" · ");
  const percent = entry?.playback.durationSec ? Math.min(100, entry.playback.positionSec / entry.playback.durationSec * 100) : 0;
  track?.setAttribute("d", wavePath(360, 9, 4, 6));
  progress?.setAttribute("d", wavePath(360, 9, 4, 6));
  progress?.setAttribute("stroke-dasharray", `${percent} 100`);
  if (restart) { restart.hidden = !entry; restart.disabled = !item.available; }
  if (play) { play.textContent = entry ? "继续观看" : "播放"; play.disabled = !item.available; }
  applyTone(hero, coverData(item).tone);
  if (background) {
    background.replaceChildren();
    delete background.dataset.artworkMediaId; delete background.dataset.artworkKind; delete background.dataset.artworkLoaded; delete background.dataset.artworkLoading;
    if (item.artwork?.some((art) => art.kind === "fanart")) { background.dataset.artworkMediaId = item.mediaId; background.dataset.artworkKind = "fanart"; enqueueArtwork(background, 2); }
  }
}

async function loadHomeShelves(): Promise<void> {
  const epoch = ++homeEpoch;
  try {
    const [recent, shows] = await Promise.all([
      window.zVideo.localLibrary.list({ page: 1, pageSize: 12, sort: "added_desc", filter: "all" }),
      window.zVideo.localLibrary.list({ page: 1, pageSize: 12, filter: "show" }),
    ]);
    if (epoch !== homeEpoch) return;
    recentItems = recent.page?.items ?? [];
    for (const [section, selector, items] of [[recentSection, "#recent-row", recentItems], [showsSection, "#shows-row", shows.page?.items ?? []]] as const) {
      const row = document.querySelector<HTMLElement>(selector);
      if (!row || !section) continue;
      row.replaceChildren(...items.map(card));
      row.querySelectorAll<HTMLElement>("[data-artwork-media-id]").forEach((element) => enqueueArtwork(element, 1));
      section.hidden = !homeVisible || items.length === 0 || detail?.hidden === false;
    }
    renderHomeHero();
  } catch { if (epoch === homeEpoch) setMessage("首页片架加载失败，请重试。", true); }
}

function renderContinue(items: LocalContinueWatchingItem[]): void {
  if (!continueSection || !continueRow) return;
  homeItems = items;
  renderHomeHero();
  continueRow.replaceChildren();
  continuePlaybackByMediaId.clear();
  for (const entry of items) continuePlaybackByMediaId.set(entry.item.mediaId, entry.playback);
  if (!homeVisible || items.length === 0 || currentQuery.query || currentQuery.sourceId || detail?.hidden === false || playerView?.hidden === false) {
    continueSection.hidden = true;
    return;
  }
  continueSection.hidden = false;
  if (continueScope) continueScope.textContent = `${items.length} 项`;
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
      if (selectedMediaId === task.mediaId && detail && !detail.hidden) {
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

async function loadLibrary(): Promise<boolean> {
  if (isDetailOrPlayerVisible()) {
    scanRefreshQueued = true;
    return false;
  }
  const epoch = ++requestEpoch;
  const query = { ...currentQuery };
  try {
    const result = await window.zVideo.localLibrary.list(query);
    if (epoch !== requestEpoch || !result.page) return false;
    renderState(result.state);
    renderPage(result.page);
    if (scanProgress?.status === "running") {
      setMessage(`正在扫描：已索引 ${result.page.totalCount} 项，已提交 ${scanProgress.importedFiles + scanProgress.updatedFiles} 项。`, false);
    } else if (result.page.totalCount) {
      setMessage(`已索引 ${result.page.totalCount} 项媒体。`, false);
    } else {
      setMessage(currentEmptyCopy(0).message, false);
    }
    return true;
  } catch (error) {
    if (epoch === requestEpoch) setMessage(error instanceof Error ? error.message : "本地片库加载失败。", true);
    return false;
  }
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

function setQuery(patch: Partial<LocalLibraryQuery>): void {
  currentQuery = { ...currentQuery, ...patch, page: patch.page ?? 1 };
  if (searchInput) searchInput.value = currentQuery.query ?? "";
  if (searchClear) searchClear.hidden = !Boolean(currentQuery.query);
  if (filterSelect) filterSelect.value = currentQuery.filter ?? "all";
  if (sortSelect) sortSelect.value = currentQuery.sort ?? "recent";
}

async function openDetail(mediaId: string, returnFocusTarget?: HTMLElement): Promise<void> {
  if (detail?.hidden !== false) {
    const focused = returnFocusTarget ?? document.activeElement;
    returnFocusMediaId = focused instanceof HTMLElement && focused.dataset.mediaId ? focused.dataset.mediaId : mediaId;
    returnFocusContainerId = focused instanceof HTMLElement
      ? focused.closest("#library-grid") ? "#library-grid"
        : focused.closest("#recent-row") ? "#recent-row" : focused.closest("#shows-row") ? "#shows-row" : undefined
      : undefined;
    returnFocusControlId = focused instanceof HTMLElement && focused.id ? `#${CSS.escape(focused.id)}` : undefined;
  }
  const epoch = ++requestEpoch;
  activeDetail = undefined;
  activeDetailPlayback = undefined;
  selectedMediaId = mediaId;
  if (detail) detail.hidden = false;
  if (collectionSection) collectionSection.hidden = true;
  if (hero) hero.hidden = true;
  if (recentSection) recentSection.hidden = true;
  if (showsSection) showsSection.hidden = true;
  if (continueSection) continueSection.hidden = true;
  setMessage("正在打开详情…");
  try {
    const result = await window.zVideo.localLibrary.get(mediaId);
    if (epoch !== requestEpoch) return;
    const loaded = result.detail ?? (result.item ? { item: result.item, episodes: [result.item] } : undefined);
    if (!loaded) throw new Error("媒体条目已不存在，可能已被移除来源");
    activeDetail = loaded;
    renderDetail(loaded);
    setMessage(loaded.item.available ? "" : "来源离线；仍可浏览已缓存的索引和封面。", !loaded.item.available);
  } catch (error) {
    if (epoch === requestEpoch) setMessage(error instanceof Error ? error.message : "详情加载失败。", true);
  }
}

function renderDetail(detailValue: LocalMediaDetail): void {
  const item = detailValue.item;
  selectedMediaId = item.mediaId;
  activeDetailPlayback = detailPlayback(detailValue);
  activePlaybackTitle = item.title;
  if (playerCurrentTitle) playerCurrentTitle.textContent = activePlaybackTitle;
  if (detailTitle) detailTitle.textContent = detailValue.collectionTitle && detailValue.collectionKind === "show" ? detailValue.collectionTitle : item.title;
  if (detailMeta) {
    const parts = [kindLabel(item.kind)];
    if (item.year !== undefined) parts.push(String(item.year));
    if (item.rating !== undefined) parts.push(`★ ${item.rating.toFixed(1)}`);
    if (item.seasonNumber !== undefined && item.episodeNumber !== undefined) parts.push(`S${String(item.seasonNumber).padStart(2, "0")}E${String(item.episodeNumber).padStart(2, "0")}`);
    detailMeta.textContent = parts.join(" · ");
  }
  const plot = item.plot?.trim() ?? "";
  if (detailPlot) detailPlot.textContent = plot;
  if (detailPlotSection) {
    detailPlotSection.hidden = !plot;
    detailPlot?.classList.toggle("collapsed", plot.length > 180);
    if (detailPlotToggle) {
      detailPlotToggle.hidden = plot.length <= 180;
      detailPlotToggle.setAttribute("aria-expanded", "false");
      const label = detailPlotToggle.querySelector("span");
      if (label) label.textContent = "展开";
    }
  }
  if (detailPlotEmpty) detailPlotEmpty.hidden = Boolean(plot);
  if (detailOfflineBanner) detailOfflineBanner.hidden = item.available;
  const playback = activeDetailPlayback;
  const resume = hasResume(playback);
  const restartAfterCompletion = Boolean(playback?.watched);
  if (detailOpen) {
    detailOpen.textContent = resume
      ? `继续播放 · ${formatTime(playback.positionSec)}`
      : restartAfterCompletion ? "重新播放" : "播放";
    detailOpen.dataset.playbackMode = resume ? "resume" : restartAfterCompletion ? "restart" : "play";
    detailOpen.disabled = !item.available;
  }
  if (detailRestart) {
    detailRestart.hidden = !resume;
    detailRestart.dataset.playbackMode = "restart";
  }
  if (detailResume) {
    detailResume.hidden = !playback;
    detailResume.textContent = playback
      ? playback.watched
        ? `已保存进度 ${formatTime(playback.positionSec)} · 已看完`
        : `已保存进度 ${formatTime(playback.positionSec)} · 可继续或从头开始`
      : "";
  }
  if (detailEpisodesSection && detailEpisodes) {
    const episodes = detailValue.episodes.filter((candidate) => candidate.kind === "episode");
    detailEpisodesSection.hidden = episodes.length === 0;
    const seasons = [...new Set(episodes.map((episode) => episode.seasonNumber).filter((season): season is number => season !== undefined))];
    if (!seasons.includes(selectedSeason ?? -1)) selectedSeason = seasons[0];
    const visibleEpisodes = seasons.length > 1 ? episodes.filter((episode) => episode.seasonNumber === selectedSeason) : episodes;
    detailEpisodes.replaceChildren(...episodeRows(visibleEpisodes, selectedMediaId, playback));
    detailEpisodes.querySelectorAll<HTMLElement>("[data-artwork-media-id]").forEach((element) => enqueueArtwork(element, 1));
    detailSeasonTabs?.replaceChildren(...renderSeasonTabs(episodes, selectedSeason));
  }
  if (detailFileSection) {
    const isMovie = item.kind === "movie" || detailValue.collectionKind === "movie";
    detailFileSection.hidden = !isMovie;
    const sourceLabel = state?.sources.find((source) => source.sourceId === item.sourceId)?.label ?? "本地来源";
    const fileInfo = renderMovieFileInfo(item, sourceLabel, playback);
    fileInfo.id = "detail-file-info";
    detailFileSection.querySelector("#detail-file-info")?.replaceWith(fileInfo);
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
  requestEpoch += 1;
  activeDetail = undefined;
  activeDetailPlayback = undefined;
  selectedMediaId = undefined;
  if (detail) detail.hidden = true;
  if (collectionSection) collectionSection.hidden = homeVisible;
  void Promise.all([loadLibrary(), homeVisible ? loadHomeShelves() : Promise.resolve()]).then(([applied]) => {
    if (applied) {
      scanRenderedCommit = scanCommit;
      scanRefreshQueued = false;
      const mediaId = returnFocusMediaId;
      const containerId = returnFocusContainerId;
      const controlId = returnFocusControlId;
      returnFocusMediaId = undefined;
      returnFocusContainerId = undefined;
      returnFocusControlId = undefined;
      const target = controlId ? document.querySelector<HTMLButtonElement>(controlId)
        : mediaId && containerId ? document.querySelector<HTMLButtonElement>(`${containerId} [data-media-id="${cssEscape(mediaId)}"]`)
          : mediaId ? document.querySelector<HTMLButtonElement>(`#library-grid [data-media-id="${cssEscape(mediaId)}"]`) : null;
      target?.focus({ preventScroll: true });
    }
  });
  void loadContinueWatching();
}

async function openSelectedLocalMedia(restart = false): Promise<void> {
  if (!selectedMediaId) return;
  activePlaybackTitle = activeDetail?.item.title ?? "本地媒体";
  showPlayer(true);
  setPlayerStatus(restart ? "正在从头打开本地媒体…" : "正在打开本地媒体…");
  try {
    await window.zVideo.localPlayback.open(selectedMediaId, restart ? { restart: true } : undefined);
  } catch (error: unknown) {
    showPlayer(false);
    setMessage(error instanceof Error ? error.message : "本地播放请求失败。", true);
  }
}

async function handleImport(operation: () => Promise<Awaited<ReturnType<typeof window.zVideo.localLibrary.openVideo>>>): Promise<void> {
  if (sourceBusy) return;
  sourceBusy = true;
  chooseFolderButton?.setAttribute("disabled", "true");
  scanFolderButton?.setAttribute("disabled", "true");
  openVideoButton?.setAttribute("disabled", "true");
  setMessage("正在索引本地媒体…");
  try {
    const outcome = await operation();
    if (outcome.status === "cancelled") setMessage("已取消。" );
    else if (outcome.status === "empty") setMessage("所选文件夹没有找到支持的视频文件。", true);
    else setMessage(`已导入《${outcome.item.title}》。`);
    renderState(outcome.state);
    await loadLibrary();
    await loadContinueWatching();
    await loadHomeShelves();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "导入失败。", true);
  } finally {
    sourceBusy = false;
    chooseFolderButton?.removeAttribute("disabled");
    scanFolderButton?.removeAttribute("disabled");
    openVideoButton?.removeAttribute("disabled");
  }
}

async function runScan(operation: () => Promise<LocalScanResult>): Promise<void> {
  if (sourceBusy) return;
  sourceBusy = true;
  scanFolderButton?.setAttribute("disabled", "true");
  chooseFolderButton?.setAttribute("disabled", "true");
  openVideoButton?.setAttribute("disabled", "true");
  scanId = undefined;
  scanProgress = { scanId: "pending", sourceId: "", status: "running", scannedFiles: 0, importedFiles: 0, updatedFiles: 0, warningCount: 0 };
  scanCommit = 0;
  scanRenderedCommit = -1;
  scanRefreshQueued = false;
  cancelScanButton?.setAttribute("hidden", "true");
  setMessage("正在扫描本地来源…");
  try {
    const result = await operation();
    renderScanResult(result);
    await loadLibrary();
    await loadContinueWatching();
    await loadHomeShelves();
  } catch (error) {
    scanProgress = undefined;
    if (!isDetailOrPlayerVisible()) requestEpoch += 1;
    scanCommit = scanRenderedCommit;
    scanRefreshQueued = false;
    if (scanStatus) scanStatus.textContent = "扫描失败";
    setMessage(error instanceof Error ? error.message : "扫描失败。", true);
  } finally {
    sourceBusy = false;
    scanId = undefined;
    if (scanProgress?.status === "running") {
      scanProgress = undefined;
      scanCommit = scanRenderedCommit;
      scanRefreshQueued = false;
    }
    if (scanRefreshTimer !== undefined) {
      window.clearTimeout(scanRefreshTimer);
      scanRefreshTimer = undefined;
    }
    cancelScanButton?.setAttribute("hidden", "true");
    scanFolderButton?.removeAttribute("disabled");
    chooseFolderButton?.removeAttribute("disabled");
    openVideoButton?.removeAttribute("disabled");
  }
}

function renderScanProgress(progress: LocalScanProgress): void {
  scanProgress = progress;
  const commit = progress.importedFiles + progress.updatedFiles;
  if (progress.status === "running") {
    scanCommit = Math.max(scanCommit, commit);
    scheduleScanRefresh();
  } else {
    if (scanRefreshTimer !== undefined) {
      window.clearTimeout(scanRefreshTimer);
      scanRefreshTimer = undefined;
    }
    scanRefreshQueued = false;
    if (!isDetailOrPlayerVisible()) requestEpoch += 1;
  }
  if (progress.status === "running") {
    scanId = progress.scanId;
    if (scanStatus) scanStatus.textContent = `扫描中：${progress.scannedFiles} 个视频，新增 ${progress.importedFiles}，更新 ${progress.updatedFiles}`;
    cancelScanButton?.removeAttribute("hidden");
  } else if (scanStatus) {
    scanStatus.textContent = `${progress.status === "completed" ? "扫描完成" : progress.status === "cancelled" ? "扫描已取消" : progress.status === "partial" ? "扫描部分完成" : "来源离线"}：${progress.scannedFiles} 个视频`;
  }
}

function renderScanResult(result: LocalScanResult): void {
  renderScanProgress(result);
  if (result.status === "completed") setMessage(`扫描完成：新增 ${result.importedFiles}，更新 ${result.updatedFiles}。`);
  else if (result.status === "cancelled") setMessage("扫描已取消，已保留此前索引和播放历史。", false);
  else if (result.status === "unavailable") setMessage("来源离线，已保留此前索引和播放历史。", true);
  else setMessage(result.error ?? "扫描部分完成，部分条目保留此前索引。", true);
}

function navigateHomeOrLibrary(target: string): void {
  requestEpoch += 1;
  homeVisible = target === "home";
  if (detail) detail.hidden = true;
  if (sidebar) sidebar.hidden = true;
  if (collectionSection) collectionSection.hidden = homeVisible;
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    if (button.dataset.nav === target) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (homeVisible) { setQuery({ query: undefined, sourceId: undefined, filter: "all" }); void loadContinueWatching(); void loadHomeShelves(); }
  else { if (hero) hero.hidden = true; if (continueSection) continueSection.hidden = true; if (recentSection) recentSection.hidden = true; if (showsSection) showsSection.hidden = true; setQuery({ sourceId: undefined, filter: target === "movie" || target === "show" ? target : "all", sort: target === "recent" ? "added_desc" : currentQuery.sort }); void loadLibrary(); }
}
document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => button.addEventListener("click", () => navigateHomeOrLibrary(button.dataset.nav ?? "home")));
document.querySelectorAll<HTMLButtonElement>("[data-shelf]").forEach((button) => button.addEventListener("click", () => navigateHomeOrLibrary(button.dataset.shelf ?? "all")));
document.querySelector<HTMLButtonElement>("#manage-sources-button")?.addEventListener("click", () => { navigateHomeOrLibrary("all"); if (sidebar) sidebar.hidden = false; });
for (const row of [document.querySelector<HTMLElement>("#recent-row"), document.querySelector<HTMLElement>("#shows-row")]) row?.addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]"); if (button?.dataset.mediaId) void openDetail(button.dataset.mediaId, button); });
document.querySelector<HTMLButtonElement>("#hero-detail")?.addEventListener("click", (event) => { const item = homeItems[0]?.item ?? recentItems[0]; if (item) void openDetail(item.mediaId, event.currentTarget as HTMLElement); });
for (const [id, restart] of [["#hero-play", false], ["#hero-restart", true]] as const) document.querySelector<HTMLButtonElement>(id)?.addEventListener("click", () => { const item = homeItems[0]?.item ?? recentItems[0]; if (!item || !item.available) return; selectedMediaId = item.mediaId; activeDetail = { item, episodes: [item] }; void openSelectedLocalMedia(restart); });
chooseFolderButton?.addEventListener("click", () => void runScan(() => window.zVideo.localLibrary.chooseFolder()));
openVideoButton?.addEventListener("click", () => void handleImport(() => window.zVideo.localLibrary.openVideo()));
scanFolderButton?.addEventListener("click", () => void runScan(() => window.zVideo.localLibrary.scanFolder()));
cancelScanButton?.addEventListener("click", () => {
  if (!scanId) return;
  cancelScanButton.setAttribute("disabled", "true");
  void window.zVideo.localLibrary.cancelScan(scanId).finally(() => cancelScanButton.removeAttribute("disabled"));
});
allSourcesButton?.addEventListener("click", () => {
  setQuery({ sourceId: undefined, page: 1 });
  allSourcesButton.setAttribute("aria-pressed", "true");
  void loadLibrary();
});
sourceList?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-source-id], [data-refresh-source-id], [data-remove-source-id]");
  if (!target) return;
  const refreshId = target.dataset.refreshSourceId;
  const removeId = target.dataset.removeSourceId;
  const sourceId = target.dataset.sourceId;
  if (refreshId) {
    void runScan(() => window.zVideo.localLibrary.refreshSource(refreshId));
    return;
  }
  if (removeId) {
    const source = state?.sources.find((candidate) => candidate.sourceId === removeId);
    if (!source || !window.confirm(`只移除“${source.label}”的应用索引？源文件不会被删除。`)) return;
    sourceBusy = true;
    setMessage("正在移除应用索引…");
    void window.zVideo.localLibrary.removeSource(removeId).then((next) => {
      renderState(next);
      setQuery({ sourceId: undefined, page: 1 });
      return Promise.all([loadLibrary(), loadContinueWatching()]);
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "移除来源失败。", true)).finally(() => { sourceBusy = false; });
    return;
  }
  if (sourceId) {
    setQuery({ sourceId, page: 1 });
    allSourcesButton?.setAttribute("aria-pressed", "false");
    void loadLibrary();
  }
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
detailPlotToggle?.addEventListener("click", () => {
  const expanded = detailPlotToggle.getAttribute("aria-expanded") !== "true";
  detailPlotToggle.setAttribute("aria-expanded", String(expanded));
  detailPlot?.classList.toggle("collapsed", !expanded);
  const label = detailPlotToggle.querySelector("span");
  if (label) label.textContent = expanded ? "收起" : "展开";
});
detailOpen?.addEventListener("click", () => { void openSelectedLocalMedia(detailOpen.dataset.playbackMode === "restart"); });
detailRestart?.addEventListener("click", () => { void openSelectedLocalMedia(true); });
playerCloseButton?.addEventListener("click", () => { clearNextTimer(); void sendLocalPlaybackCommand({ type: "close" }); });
playerToggleButton?.addEventListener("click", () => {
  void sendLocalPlaybackCommand({ type: playerState === "playing" ? "pause" : "play" });
});
playerSeek?.addEventListener("change", () => {
  void sendLocalPlaybackCommand({ type: "seek", positionSec: Number(playerSeek.value) });
});
playerFullscreenButton?.addEventListener("click", () => {
  togglePlayerFullscreen();
});
playerAudioTrack?.addEventListener("change", () => {
  if (playerAudioTrack.value) void sendLocalPlaybackCommand({ type: "set-audio-track", trackId: playerAudioTrack.value });
});
playerSubtitleTrack?.addEventListener("change", () => {
  void sendLocalPlaybackCommand({ type: "set-subtitle-track", trackId: playerSubtitleTrack.value || null });
});
playerSettingsButton?.addEventListener("click", () => {
  if (!playerSettings) return;
  playerSettings.hidden = !playerSettings.hidden;
  playerSettingsButton.setAttribute("aria-expanded", String(!playerSettings.hidden));
});
playerNextButton?.addEventListener("click", () => { void playNextEpisode(); });
playerPlayNext?.addEventListener("click", () => { void playNextEpisode(); });
playerCancelNext?.addEventListener("click", () => { clearNextTimer(); if (playerCountdown) playerCountdown.textContent = "已取消自动播放"; });
document.querySelector<HTMLButtonElement>("#player-return-list")?.addEventListener("click", () => { clearNextTimer(); returnToEpisodes = true; void sendLocalPlaybackCommand({ type: "close" }); });
for (const [selector, offset] of [["#player-back-10", -10], ["#player-forward-10", 10]] as const) {
  document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", () => {
    const positionSec = Math.max(0, Math.min(playerDurationSec, Number(playerSeek?.value ?? 0) + offset));
    void sendLocalPlaybackCommand({ type: "seek", positionSec });
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
playerSpeed?.addEventListener("change", () => {
  void sendLocalPlaybackCommand({ type: "set-speed", speed: Number(playerSpeed.value) }).then((sent) => {
    if (!sent) restorePlayerSettingsAfterFailure();
  });
});
window.addEventListener("keydown", handlePlayerShortcut);
searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput?.value.trim() || undefined;
  if (homeVisible) navigateHomeOrLibrary("all");
  setQuery({ query, page: 1 });
  void loadLibrary();
});
searchInput?.addEventListener("input", () => {
  if (searchClear) searchClear.hidden = !Boolean(searchInput.value);
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    const query = searchInput.value.trim() || undefined;
    if (homeVisible) navigateHomeOrLibrary("all");
    setQuery({ query, page: 1 });
    void loadLibrary();
  }, 220);
});
searchClear?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  setQuery({ query: undefined, page: 1 });
  void loadLibrary();
  searchInput?.focus();
});
filterSelect?.addEventListener("change", () => { setQuery({ filter: filterSelect.value as LocalLibraryQuery["filter"], page: 1 }); void loadLibrary(); });
sortSelect?.addEventListener("change", () => {
  const sort = sortSelect.value as LocalSort;
  setQuery({ sort, page: 1 });
  void window.zVideo.appPreferences.setSort(sort).catch(() => setMessage("排序偏好保存失败，本次排序仍已应用。", true));
  void loadLibrary();
});
libraryPagination?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-page]");
  const page = Number(button?.dataset.page);
  if (!button || !Number.isInteger(page) || page < 1 || button.disabled || page === currentQuery.page) return;
  setQuery({ page });
  void loadLibrary();
});
window.zVideo.localLibrary.onState(renderState);
window.zVideo.localLibrary.onScanProgress(renderScanProgress);
window.zVideo.localPlayback.onEvent(renderLocalPlaybackEvent);

void (async () => {
  try {
    const next = await window.zVideo.localLibrary.getState();
    await restoreSortPreference();
    renderState(next);
    if (collectionSection) collectionSection.hidden = true;
    await Promise.all([loadLibrary(), loadContinueWatching(), loadHomeShelves()]);
  } catch (error: unknown) {
    setMessage(error instanceof Error ? error.message : "本地片库加载失败。", true);
  }
})();
