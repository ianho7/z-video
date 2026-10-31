import type {
  LocalImportOutcome,
  LocalLibraryPage,
  LocalLibraryState,
} from "../shared/local-library-contracts";
import type { LocalPlaybackEvent } from "../shared/local-playback-contracts";

const chooseFolderButton = document.querySelector<HTMLButtonElement>("#choose-folder-button");
const openVideoButton = document.querySelector<HTMLButtonElement>("#open-video-button");
const searchInput = document.querySelector<HTMLInputElement>("#library-search-input");
const sourceList = document.querySelector<HTMLElement>("#source-list");
const libraryMessage = document.querySelector<HTMLElement>("#library-message");
const libraryGrid = document.querySelector<HTMLElement>("#library-grid");
const libraryEmpty = document.querySelector<HTMLElement>("#library-empty");
const detail = document.querySelector<HTMLElement>("#media-detail");
const detailTitle = document.querySelector<HTMLElement>("#media-detail-title");
const detailMeta = document.querySelector<HTMLElement>("#media-detail-meta");
const detailOpen = document.querySelector<HTMLButtonElement>("#media-detail-open");
const detailBack = document.querySelector<HTMLButtonElement>("#media-detail-back");

let activeMediaId: string | undefined;
let searchTimer: number | undefined;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function setMessage(message: string, error = false): void {
  if (!libraryMessage) return;
  libraryMessage.textContent = message;
  libraryMessage.dataset.state = error ? "error" : "normal";
}

function renderState(state: LocalLibraryState): void {
  if (!sourceList) return;
  sourceList.innerHTML = state.sources.length
    ? state.sources.map((source) => `<div class="source-row" role="listitem"><span class="source-dot" aria-hidden="true"></span><span class="source-label">${escapeHtml(source.label)}</span><span class="source-count">${source.itemCount}</span></div>`).join("")
    : `<p class="muted">尚未添加来源</p>`;
  if (state.status === "error") setMessage(state.error?.message ?? "本地片库不可用。", true);
}

function renderPage(page: LocalLibraryPage): void {
  if (!libraryGrid || !libraryEmpty) return;
  libraryGrid.innerHTML = page.items.map((item) => `
    <article class="media-card" role="listitem">
      <button class="media-card-button" type="button" data-media-id="${escapeHtml(item.mediaId)}" aria-label="查看 ${escapeHtml(item.title)}">
        <span class="media-poster" aria-hidden="true"><span>${escapeHtml(item.title.slice(0, 1).toUpperCase())}</span></span>
        <span class="media-card-title">${escapeHtml(item.title)}</span>
        <span class="media-card-meta">本地电影 · ${formatBytes(item.sizeBytes)}</span>
      </button>
    </article>`).join("");
  libraryEmpty.hidden = page.items.length > 0;
  if (page.totalCount > 0) setMessage(`已索引 ${page.totalCount} 部影片。`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function refresh(): Promise<void> {
  const state = await window.zVideo.localLibrary.getState();
  renderState(state);
  const result = await window.zVideo.localLibrary.list({ page: 1, pageSize: 50, ...(searchInput?.value.trim() ? { query: searchInput.value.trim() } : {}) });
  if (result.page) renderPage(result.page);
}

async function handleImport(operation: () => Promise<LocalImportOutcome>): Promise<void> {
  chooseFolderButton?.setAttribute("disabled", "true");
  openVideoButton?.setAttribute("disabled", "true");
  setMessage("正在导入本地视频…");
  try {
    const outcome = await operation();
    if (outcome.status === "cancelled") setMessage("已取消。", false);
    else if (outcome.status === "empty") setMessage("所选文件夹没有找到支持的视频文件。", true);
    else setMessage(`已导入《${outcome.item.title}》。`);
    renderState(outcome.state);
    await refresh();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "导入失败。", true);
  } finally {
    chooseFolderButton?.removeAttribute("disabled");
    openVideoButton?.removeAttribute("disabled");
  }
}

async function showDetail(mediaId: string): Promise<void> {
  const result = await window.zVideo.localLibrary.get(mediaId);
  if (!result.item || !detail || !detailTitle || !detailMeta) return;
  activeMediaId = result.item.mediaId;
  detailTitle.textContent = result.item.title;
  detailMeta.textContent = `本地电影 · ${formatBytes(result.item.sizeBytes)} · ${result.item.available ? "来源可用" : "来源不可用"}`;
  detail.hidden = false;
  libraryGrid?.setAttribute("hidden", "true");
  libraryEmpty?.setAttribute("hidden", "true");
  detailOpen?.focus();
}

function hideDetail(): void {
  activeMediaId = undefined;
  if (detail) detail.hidden = true;
  libraryGrid?.removeAttribute("hidden");
  void refresh();
}

chooseFolderButton?.addEventListener("click", () => void handleImport(() => window.zVideo.localLibrary.chooseFolder()));
openVideoButton?.addEventListener("click", () => void handleImport(() => window.zVideo.localLibrary.openVideo()));
libraryGrid?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-media-id]");
  if (button?.dataset.mediaId) void showDetail(button.dataset.mediaId);
});
detailBack?.addEventListener("click", hideDetail);
detailOpen?.addEventListener("click", () => {
  if (!activeMediaId) return;
  setMessage("正在打开本地媒体…", false);
  void window.zVideo.localPlayback.open(activeMediaId).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "本地播放请求失败。", true));
});
searchInput?.addEventListener("input", () => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void refresh(), 180);
});
window.zVideo.localLibrary.onState(renderState);
window.zVideo.localPlayback.onEvent((event: LocalPlaybackEvent) => {
  if (event.type === "loading") setMessage("正在加载本地媒体…", false);
  if (event.type === "ready") setMessage("本地媒体已就绪。", false);
  if (event.type === "state" && event.state === "paused") setMessage("本地媒体已暂停。", false);
  if (event.type === "error") setMessage(event.message, true);
  if (event.type === "closed") setMessage("本地播放已关闭。", false);
});
void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "本地片库加载失败。", true));
