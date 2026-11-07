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
const detailOpen = document.querySelector<HTMLButtonElement>("#media-detail-open");
const detailRestart = document.querySelector<HTMLButtonElement>("#media-detail-restart");
const detailResume = document.querySelector<HTMLElement>("#media-detail-resume");
const detailPlotSection = document.querySelector<HTMLDetailsElement>("#media-detail-plot-section");
const detailAvailability = document.querySelector<HTMLElement>("#detail-availability");
const detailEpisodesSection = document.querySelector<HTMLElement>("#detail-episodes-section");
const detailEpisodes = document.querySelector<HTMLElement>("#detail-episodes");
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
const continuePlaybackByMediaId = new Map<string, LocalPlaybackState>();

let currentQuery: LocalLibraryQuery = { page: 1, pageSize: PAGE_SIZE, filter: "all", sort: "recent" };

interface ArtworkTask {
  element: HTMLElement;
  mediaId: string;
  kind: LocalArtworkReference["kind"];
  priority: number;
}

const artworkQueue: ArtworkTask[] = [];
let artworkActive = 0;
let artworkObserver: IntersectionObserver | undefined;

type LocalSort = LocalLibrarySort;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function setMessage(message: string, error = false): void {
  if (!libraryMessage) return;
  libraryMessage.textContent = message;
  libraryMessage.dataset.state = error ? "error" : "normal";
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
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

function renderTrackOptions(select: HTMLSelectElement | null, tracks: Array<{ id: string; label: string; selected?: boolean }>, emptyLabel: string): void {
  if (!select) return;
  const options = [new Option(emptyLabel, ""), ...tracks.map((track) => {
    const option = new Option(track.label, track.id);
    option.selected = Boolean(track.selected);
    return option;
  })];
  select.replaceChildren(...options);
  select.value = tracks.find((track) => track.selected)?.id ?? "";
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

function kindLabel(kind: LocalMediaItem["kind"]): string {
  return kind === "movie" ? "电影" : kind === "show" ? "电视剧" : kind === "episode" ? "剧集" : "未分类";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function posterFallback(title: string): HTMLElement {
  const fallback = document.createElement("span");
  fallback.className = "poster-fallback";
  const titleNode = document.createElement("strong");
  titleNode.textContent = title.slice(0, 2) || "影视";
  fallback.append(titleNode, document.createTextNode("封面不可用"));
  return fallback;
}

function artworkKind(item: LocalMediaItem): LocalArtworkReference["kind"] | undefined {
  return item.artwork?.find((art) => art.kind === "poster")?.kind ?? item.artwork?.[0]?.kind;
}

function renderState(next: LocalLibraryState): void {
  state = next;
  if (allSourceCount) allSourceCount.textContent = String(next.sources.reduce((total, source) => total + source.itemCount, 0));
  if (sourceList) {
    sourceList.replaceChildren(...next.sources.map((source) => {
      const row = document.createElement("div");
      row.className = `source-row${currentQuery.sourceId === source.sourceId ? " selected" : ""}`;
      row.dataset.sourceId = source.sourceId;
      row.setAttribute("role", "listitem");
      const select = document.createElement("button");
      select.className = "source-select";
      select.type = "button";
      select.dataset.sourceId = source.sourceId;
      select.setAttribute("aria-pressed", String(currentQuery.sourceId === source.sourceId));
      const dot = document.createElement("span");
      dot.className = `source-dot${source.available ? "" : " offline"}`;
      const label = document.createElement("span");
      label.className = "source-label";
      label.textContent = source.label;
      const count = document.createElement("span");
      count.className = "source-count";
      count.textContent = String(source.itemCount);
      select.append(dot, label, count);
      const actions = document.createElement("span");
      actions.className = "source-actions";
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "source-action";
      refresh.dataset.refreshSourceId = source.sourceId;
      refresh.title = "刷新来源";
      refresh.setAttribute("aria-label", `刷新 ${source.label}`);
      refresh.textContent = "↻";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "source-action danger";
      remove.dataset.removeSourceId = source.sourceId;
      remove.title = "移除来源索引";
      remove.setAttribute("aria-label", `移除 ${source.label}`);
      remove.textContent = "×";
      actions.append(refresh, remove);
      row.append(select, actions);
      return row;
    }));
    if (next.sources.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "尚未添加来源";
      sourceList.append(empty);
    }
  }
  if (next.status === "error") setMessage(next.error?.message ?? "本地片库不可用。", true);
}

function card(item: LocalMediaItem): HTMLElement {
  const article = document.createElement("article");
  article.className = `media-card${item.available ? "" : " unavailable"}`;
  article.setAttribute("role", "listitem");
  const button = document.createElement("button");
  button.className = "media-card-button";
  button.type = "button";
  button.dataset.mediaId = item.mediaId;
  button.setAttribute("aria-label", `查看 ${item.title}`);
  const poster = document.createElement("span");
  poster.className = "media-poster";
  const kind = artworkKind(item);
  if (kind) {
    poster.dataset.artworkMediaId = item.mediaId;
    poster.dataset.artworkKind = kind;
    poster.append(posterFallback(item.title));
  } else {
    poster.append(posterFallback(item.title));
  }
  const title = document.createElement("span");
  title.className = "media-card-title";
  title.textContent = item.title;
  const meta = document.createElement("span");
  meta.className = "media-card-meta";
  const parts = [kindLabel(item.kind)];
  if (item.year !== undefined) parts.push(String(item.year));
  if (item.rating !== undefined) parts.push(`★ ${item.rating.toFixed(1)}`);
  if (!item.available) parts.push("来源离线");
  meta.textContent = `${parts.join(" · ")} · ${formatBytes(item.sizeBytes)}`;
  button.append(poster, title, meta);
  article.append(button);
  return article;
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

function renderContinue(items: LocalContinueWatchingItem[]): void {
  if (!continueSection || !continueRow) return;
  continueRow.replaceChildren();
  continuePlaybackByMediaId.clear();
  for (const entry of items) continuePlaybackByMediaId.set(entry.item.mediaId, entry.playback);
  if (items.length === 0 || currentQuery.query || currentQuery.sourceId || detail?.hidden === false || playerView?.hidden === false) {
    continueSection.hidden = true;
    return;
  }
  continueSection.hidden = false;
  if (continueScope) continueScope.textContent = `${items.length} 项`;
  for (const entry of items.slice(0, 12)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "continue-card";
    button.dataset.mediaId = entry.item.mediaId;
    button.setAttribute("aria-label", `继续观看《${entry.item.title}》，从 ${formatTime(entry.playback.positionSec)} 开始`);
    const poster = document.createElement("span");
    poster.className = "continue-image";
    const kind = artworkKind(entry.item);
    if (kind) {
      poster.dataset.artworkMediaId = entry.item.mediaId;
      poster.dataset.artworkKind = kind;
      poster.append(posterFallback(entry.item.title));
      enqueueArtwork(poster, 1);
    } else poster.append(posterFallback(entry.item.title));
    const copy = document.createElement("span");
    copy.className = "continue-copy";
    const title = document.createElement("strong");
    title.textContent = entry.item.title;
    const duration = entry.playback.durationSec && entry.playback.durationSec > 0 ? entry.playback.durationSec : 0;
    const percent = duration ? Math.min(100, Math.round(entry.playback.positionSec / duration * 100)) : 0;
    const detailLine = document.createElement("span");
    detailLine.textContent = `${kindLabel(entry.item.kind)} · 已保存至 ${formatTime(entry.playback.positionSec)}${percent ? ` · ${percent}%` : ""}`;
    const track = document.createElement("span");
    track.className = "progress-track";
    const progress = document.createElement("span");
    progress.style.width = `${percent}%`;
    track.append(progress);
    copy.append(title, detailLine, track);
    button.append(poster, copy);
    continueRow.append(button);
  }
}

function enqueueArtwork(element: HTMLElement, priority: number): void {
  const mediaId = element.dataset.artworkMediaId;
  const kind = element.dataset.artworkKind as LocalArtworkReference["kind"] | undefined;
  if (!mediaId || !kind || element.dataset.artworkLoading === "true" || element.dataset.artworkLoaded === "true") return;
  element.dataset.artworkLoading = "true";
  artworkQueue.push({ element, mediaId, kind, priority });
  artworkQueue.sort((left, right) => right.priority - left.priority);
  void pumpArtwork();
}

async function pumpArtwork(): Promise<void> {
  while (artworkActive < ARTWORK_CONCURRENCY && artworkQueue.length > 0) {
    const task = artworkQueue.shift();
    if (!task) return;
    artworkActive += 1;
    void window.zVideo.localLibrary.getArtwork(task.mediaId, task.kind).then((result) => {
      if (!result.dataUrl || !task.element.isConnected) return;
      const image = document.createElement("img");
      image.src = result.dataUrl;
      image.alt = "本地封面";
      image.decoding = "async";
      image.loading = "lazy";
      task.element.replaceChildren(image);
      task.element.dataset.artworkLoaded = "true";
    }).catch(() => undefined).finally(() => {
      task.element.dataset.artworkLoading = "false";
      artworkActive -= 1;
      void pumpArtwork();
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

async function openDetail(mediaId: string): Promise<void> {
  const epoch = ++requestEpoch;
  activeDetail = undefined;
  activeDetailPlayback = undefined;
  selectedMediaId = mediaId;
  if (detail) detail.hidden = false;
  if (collectionSection) collectionSection.hidden = true;
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
  if (detailPlot) detailPlot.textContent = item.plot ?? "暂无本地简介。";
  if (detailPlotSection) {
    const plotLength = item.plot?.trim().length ?? 0;
    detailPlotSection.open = plotLength <= 220;
  }
  if (detailAvailability) detailAvailability.textContent = item.available ? "来源可用" : "来源离线";
  const playback = activeDetailPlayback;
  const resume = hasResume(playback);
  const restartAfterCompletion = Boolean(playback?.watched);
  if (detailOpen) {
    detailOpen.textContent = resume
      ? `继续 · ${formatTime(playback.positionSec)}`
      : restartAfterCompletion ? "重新播放" : item.available ? "播放" : "尝试播放";
    detailOpen.dataset.playbackMode = resume ? "resume" : restartAfterCompletion ? "restart" : "play";
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
    detailEpisodes.replaceChildren(...episodes.map((episode) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "episode-row";
      button.dataset.mediaId = episode.mediaId;
      button.setAttribute("aria-selected", String(episode.mediaId === selectedMediaId));
      const number = document.createElement("span");
      number.className = "episode-number";
      number.textContent = episode.seasonNumber !== undefined && episode.episodeNumber !== undefined ? `S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")}` : "剧集";
      const title = document.createElement("span");
      title.className = "episode-title";
      title.textContent = episode.title;
      const availability = document.createElement("span");
      availability.className = "episode-duration";
      availability.textContent = episode.available ? "可播放" : "离线";
      button.append(number, title, availability);
      return button;
    }));
  }
  if (detailPoster) {
    detailPoster.replaceChildren(posterFallback(item.title));
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
  if (collectionSection) collectionSection.hidden = false;
  void loadLibrary().then((applied) => {
    if (applied) {
      scanRenderedCommit = scanCommit;
      scanRefreshQueued = false;
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
  } catch (error) {
    scanProgress = undefined;
    scanCommit = scanRenderedCommit;
    scanRefreshQueued = false;
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
    requestEpoch += 1;
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
  if (button?.dataset.mediaId) void openDetail(button.dataset.mediaId);
});
continueRow?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]");
  if (button?.dataset.mediaId) void openDetail(button.dataset.mediaId);
});
detailEpisodes?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]");
  const mediaId = button?.dataset.mediaId;
  if (mediaId) void openDetail(mediaId);
});
detailBack?.addEventListener("click", closeDetail);
detailOpen?.addEventListener("click", () => { void openSelectedLocalMedia(detailOpen.dataset.playbackMode === "restart"); });
detailRestart?.addEventListener("click", () => { void openSelectedLocalMedia(true); });
playerCloseButton?.addEventListener("click", () => void sendLocalPlaybackCommand({ type: "close" }));
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
  setQuery({ query: searchInput?.value.trim() || undefined, page: 1 });
  void loadLibrary();
});
searchInput?.addEventListener("input", () => {
  if (searchClear) searchClear.hidden = !Boolean(searchInput.value);
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    setQuery({ query: searchInput.value.trim() || undefined, page: 1 });
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
    await Promise.all([loadLibrary(), loadContinueWatching()]);
  } catch (error: unknown) {
    setMessage(error instanceof Error ? error.message : "本地片库加载失败。", true);
  }
})();
