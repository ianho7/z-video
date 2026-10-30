import type {
  Classification,
  Collection,
  CollectionDetail,
  ContinueWatchingItem,
  Episode,
  LibraryFilter,
  LibraryPage,
  LibraryQuery,
  NavigationContext,
  PublicSessionState,
  PlaybackCommand,
} from "../shared/contracts";

const PAGE_SIZE = 50;

const libraryView = document.querySelector<HTMLElement>('[data-view="library"]');
const classificationList = document.querySelector<HTMLElement>("#classification-list");
const libraryMessage = document.querySelector<HTMLElement>("#library-message");
const libraryScroll = document.querySelector<HTMLElement>("#library-scroll");
const collectionGrid = document.querySelector<HTMLElement>("#collection-grid");
const collectionSection = document.querySelector<HTMLElement>("#collection-section");
const detailSection = document.querySelector<HTMLElement>("#detail-section");
const continueSection = document.querySelector<HTMLElement>("#continue-section");
const continueRow = document.querySelector<HTMLElement>("#continue-row");
const continueScope = document.querySelector<HTMLElement>("#continue-scope");
const libraryScope = document.querySelector<HTMLElement>("#library-scope");
const libraryEmpty = document.querySelector<HTMLElement>("#library-empty");
const libraryEmptyTitle = document.querySelector<HTMLElement>("#library-empty-title");
const libraryEmptyMessage = document.querySelector<HTMLElement>("#library-empty-message");
const libraryPagination = document.querySelector<HTMLElement>("#library-pagination");
const libraryBackButton = document.querySelector<HTMLButtonElement>("#library-back-button");
const searchForm = document.querySelector<HTMLFormElement>("#library-search-form");
const searchInput = document.querySelector<HTMLInputElement>("#library-search-input");
const searchClear = document.querySelector<HTMLButtonElement>("#library-search-clear");
const filterSelect = document.querySelector<HTMLSelectElement>("#library-filter");
const sortSelect = document.querySelector<HTMLSelectElement>("#library-sort");
const toolbarContext = document.querySelector<HTMLElement>("#toolbar-context");
const toolbarTitle = document.querySelector<HTMLElement>("#toolbar-title");
const mainPanel = document.querySelector<HTMLElement>("#main-panel");

let initialized = false;
let sessionState: PublicSessionState | undefined;
let activePage: LibraryPage | undefined;
let activeDetail: CollectionDetail | undefined;
let selectedEpisodeId = "";
let navigation: NavigationContext = {
  view: "library",
  library: { classificationId: "", page: 1, pageSize: PAGE_SIZE, filter: "all", sort: "recent", scrollTop: 0 },
};
let requestEpoch = 0;
let detailOpen = false;
let navigationSaveTimer: number | undefined;

function escapeHtml(value: string | number | undefined): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function requireElement<T extends Element>(element: T | null, name: string): T {
  if (!element) throw new Error(`renderer element missing: ${name}`);
  return element;
}

function setMessage(message: string, error = false): void {
  if (!libraryMessage) return;
  libraryMessage.textContent = message;
  libraryMessage.classList.toggle("error", error);
}

function renderClassifications(classifications: Classification[]): void {
  if (!classificationList) return;
  classificationList.replaceChildren(...classifications.map((classification) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.classificationId = classification.id;
    button.setAttribute("aria-current", classification.id === navigation.library.classificationId ? "page" : "false");
    const name = document.createElement("span");
    name.textContent = classification.name;
    const count = document.createElement("span");
    count.textContent = String(classification.count);
    button.append(name, count);
    return button;
  }));
}

function updateToolbar(): void {
  if (toolbarContext) toolbarContext.textContent = detailOpen ? "DETAIL" : "LIBRARY";
  if (toolbarTitle) toolbarTitle.textContent = detailOpen ? activeDetail?.title ?? "详情" : classificationsName(navigation.library.classificationId);
  if (libraryBackButton) libraryBackButton.hidden = !detailOpen;
  if (searchForm) searchForm.hidden = detailOpen;
  if (filterSelect) filterSelect.hidden = detailOpen;
  if (sortSelect) sortSelect.hidden = detailOpen;
  if (searchInput) searchInput.value = navigation.library.query ?? "";
  if (searchClear) searchClear.hidden = !Boolean(navigation.library.query);
  if (filterSelect) filterSelect.value = navigation.library.filter ?? "all";
  if (sortSelect) sortSelect.value = navigation.library.sort ?? "recent";
}

function classificationsName(id: string): string {
  return sessionState?.classifications.find((classification) => classification.id === id)?.name ?? "片库";
}

function currentQuery(): LibraryQuery {
  const { scrollTop: _scrollTop, ...query } = navigation.library;
  return query;
}

function setNavigationQuery(patch: Partial<LibraryQuery>): void {
  navigation = { ...navigation, view: "library", library: { ...navigation.library, ...patch, page: patch.page ?? 1, scrollTop: patch.page && patch.page !== navigation.library.page ? 0 : navigation.library.scrollTop } };
  renderClassifications(sessionState?.classifications ?? []);
  updateToolbar();
}

function saveNavigation(): void {
  if (navigationSaveTimer !== undefined) window.clearTimeout(navigationSaveTimer);
  navigationSaveTimer = window.setTimeout(() => {
    navigationSaveTimer = undefined;
    void window.zVideo.library.setNavigation(navigation).catch(() => undefined);
  }, 120);
}

function imageFallback(title: string, kind: "cover" | "background" = "cover"): string {
  const label = kind === "background" ? "背景不可用" : "封面不可用";
  return `<span class="poster-fallback"><strong>${escapeHtml(title.slice(0, 2) || "影视")}</strong>${label}</span>`;
}

function setImage(container: HTMLElement, dataUrl: string, alt: string): void {
  const image = document.createElement("img");
  image.src = dataUrl;
  image.alt = alt;
  image.loading = "lazy";
  container.replaceChildren(image);
}

function renderCollectionCard(collection: Collection): string {
  const loading = collection.imageKey ? `<span class="poster-frame loading" data-image-collection="${escapeHtml(collection.collectionId)}">${imageFallback(collection.title)}</span>` : `<span class="poster-frame failed">${imageFallback(collection.title)}</span>`;
  const year = collection.releaseYear || "年份未知";
  const type = collection.videoType || "影视";
  return `<button class="collection-card" type="button" data-collection-id="${escapeHtml(collection.collectionId)}" aria-label="打开《${escapeHtml(collection.title)}》详情">${loading}<span class="collection-copy"><span class="collection-title">${escapeHtml(collection.title)}</span><span class="collection-meta"><span>${escapeHtml(year)}</span><span>${escapeHtml(type)}</span></span></span></button>`;
}

function renderContinueCard(item: ContinueWatchingItem): string {
  const progress = item.progressPercent === undefined ? "" : `<span class="progress-track" aria-label="${escapeHtml(item.progressLabel)}"><span style="width:${item.progressPercent}%"></span></span>`;
  return `<button class="continue-card" type="button" data-continue-collection-id="${escapeHtml(item.collectionId)}" data-continue-classification-id="${escapeHtml(item.classificationId)}" aria-label="继续观看《${escapeHtml(item.title)}》"><span class="continue-image" data-continue-image-collection="${escapeHtml(item.collectionId)}">${imageFallback(item.title)}</span><span class="continue-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.episodeTitle)} · ${escapeHtml(item.progressLabel)}</span>${progress}</span></button>`;
}

function renderPage(page: LibraryPage): void {
  activePage = page;
  if (collectionSection) collectionSection.hidden = false;
  if (detailSection) detailSection.hidden = true;
  if (continueSection) continueSection.hidden = true;
  if (collectionGrid) collectionGrid.replaceChildren(...page.collections.map((collection) => htmlToElement(renderCollectionCard(collection))));
  if (libraryScope) libraryScope.textContent = page.scopeDescription;
  if (libraryEmpty) libraryEmpty.hidden = page.collections.length > 0;
  if (libraryEmptyTitle) libraryEmptyTitle.textContent = navigation.library.query ? "没有匹配条目" : "暂无内容";
  if (libraryEmptyMessage) libraryEmptyMessage.textContent = navigation.library.query ? "搜索只覆盖当前已加载页；可清空搜索或切换分类。" : "当前分类没有可显示的影视。";
  renderPagination(page);
  updateToolbar();
  setMessage(page.collections.length ? `已加载 ${page.collections.length} 项。` : navigation.library.query ? "当前已加载页没有匹配项。" : "当前分类为空。");
}

function renderPagination(page: LibraryPage): void {
  if (!libraryPagination) return;
  const totalPages = page.totalPages ?? 0;
  if (totalPages <= 1) {
    libraryPagination.replaceChildren();
    return;
  }
  const buttons: HTMLButtonElement[] = [];
  const previous = document.createElement("button");
  previous.type = "button";
  previous.dataset.page = String(page.page - 1);
  previous.textContent = "上一页";
  previous.disabled = page.page <= 1;
  buttons.push(previous);
  for (let index = 1; index <= totalPages; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.page = String(index);
    button.textContent = String(index);
    button.setAttribute("aria-current", index === page.page ? "page" : "false");
    buttons.push(button);
  }
  const next = document.createElement("button");
  next.type = "button";
  next.dataset.page = String(page.page + 1);
  next.textContent = "下一页";
  next.disabled = page.page >= totalPages;
  buttons.push(next);
  libraryPagination.replaceChildren(...buttons);
}

function renderLoading(): void {
  if (collectionGrid) collectionGrid.replaceChildren(...Array.from({ length: 12 }, () => htmlToElement(`<div class="collection-card" aria-hidden="true"><span class="poster-frame loading"></span><span class="collection-copy"><span class="collection-title">正在加载…</span><span class="collection-meta"><span>等待 NAS</span></span></span></div>`)));
  if (libraryEmpty) libraryEmpty.hidden = true;
  if (libraryPagination) libraryPagination.replaceChildren();
  setMessage("正在读取片库…");
}

function renderDetailLoading(): void {
  if (collectionSection) collectionSection.hidden = true;
  if (continueSection) continueSection.hidden = true;
  if (detailSection) {
    detailSection.hidden = false;
    detailSection.innerHTML = `<div class="detail-back-row"><span class="detail-kicker">内容详情</span></div><div class="detail-empty">正在读取详情…</div>`;
  }
  setMessage("正在读取详情…");
  updateToolbar();
}

function htmlToElement(markup: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = markup.trim();
  const element = wrapper.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("renderer template did not produce an element");
  return element;
}

async function loadImages(collections: Collection[], epoch: number): Promise<void> {
  await Promise.all(collections.slice(0, 24).map(async (collection) => {
    if (!collection.imageKey) return;
    try {
      const result = await window.zVideo.library.loadImage({ collectionId: collection.collectionId, kind: "cover" });
      if (epoch !== requestEpoch || !result.dataUrl) return;
      const frame = document.querySelector<HTMLElement>(`[data-image-collection="${cssEscape(collection.collectionId)}"]`);
      if (!frame) return;
      frame.classList.remove("loading");
      setImage(frame, result.dataUrl, `《${collection.title}》封面`);
    } catch {
      if (epoch !== requestEpoch) return;
      document.querySelector<HTMLElement>(`[data-image-collection="${cssEscape(collection.collectionId)}"]`)?.classList.add("failed");
    }
  }));
}

async function loadContinue(epoch: number): Promise<void> {
  try {
    const result = await window.zVideo.library.listContinueWatching();
    if (epoch !== requestEpoch || !result.items.length || detailOpen || navigation.library.query || navigation.library.filter !== "all") return;
    if (!continueSection || !continueRow) return;
    continueSection.hidden = false;
    continueRow.replaceChildren(...result.items.map((item) => htmlToElement(renderContinueCard(item))));
    if (continueScope) continueScope.textContent = `${result.items.length} 项真实历史`;
    await Promise.all(result.items.slice(0, 8).map(async (item) => {
      if (!item.imageKey) return;
      const image = await window.zVideo.library.loadImage({ collectionId: item.collectionId, kind: "cover" }).catch(() => undefined);
      if (epoch !== requestEpoch || !image?.dataUrl) return;
      const target = document.querySelector<HTMLElement>(`[data-continue-image-collection="${cssEscape(item.collectionId)}"]`);
      if (target) setImage(target, image.dataUrl, "");
    }));
  } catch {
    // Continue watching is optional and must never turn a real library into an error state.
  }
}

async function loadCollections(): Promise<void> {
  const query = currentQuery();
  if (!query.classificationId) {
    setMessage("NAS 未返回可用分类，未请求影视列表。", true);
    if (collectionGrid) collectionGrid.replaceChildren();
    return;
  }
  const epoch = ++requestEpoch;
  detailOpen = false;
  activeDetail = undefined;
  renderLoading();
  updateToolbar();
  try {
    const result = await window.zVideo.library.listCollections(query);
    if (epoch !== requestEpoch) return;
    if (result.state.status === "logged-out") {
      window.dispatchEvent(new CustomEvent("z-video:session-state", { detail: result.state }));
      return;
    }
    if (!result.page) {
      setMessage(result.state.error?.message ?? "片库加载失败。", true);
      return;
    }
    renderPage(result.page);
    saveNavigation();
    void loadImages(result.page.collections, epoch);
    void loadContinue(epoch);
  } catch (error) {
    if (epoch !== requestEpoch) return;
    setMessage(error instanceof Error ? error.message : "片库加载失败。", true);
  }
}

async function openDetail(collectionId: string, classificationId = navigation.library.classificationId, episodeId?: string): Promise<void> {
  const id = collectionId.trim();
  if (!id || !classificationId) return;
  navigation = { ...navigation, view: "detail", detail: { collectionId: id, ...(episodeId ? { episodeId } : {}), focusCollectionId: id } };
  saveNavigation();
  const epoch = ++requestEpoch;
  detailOpen = true;
  renderDetailLoading();
  try {
    const result = await window.zVideo.library.getDetail({ collectionId: id, classificationId });
    if (epoch !== requestEpoch) return;
    if (result.state.status === "logged-out") {
      window.dispatchEvent(new CustomEvent("z-video:session-state", { detail: result.state }));
      return;
    }
    if (!result.detail) {
      setMessage(result.state.error?.message ?? "详情加载失败。", true);
      return;
    }
    activeDetail = result.detail;
    selectedEpisodeId = episodeId ?? result.detail.resume?.episodeId ?? result.detail.seasons[0]?.episodes[0]?.episodeId ?? "";
    renderDetail(result.detail);
    mainPanel?.focus({ preventScroll: true });
    void loadDetailImage(result.detail, epoch);
  } catch (error) {
    if (epoch !== requestEpoch) return;
    setMessage(error instanceof Error ? error.message : "详情加载失败。", true);
  }
}

function renderDetail(detail: CollectionDetail): void {
  if (!detailSection) return;
  if (collectionSection) collectionSection.hidden = true;
  if (continueSection) continueSection.hidden = true;
  detailSection.hidden = false;
  const selected = detail.seasons.flatMap((season) => season.episodes).find((episode) => episode.episodeId === selectedEpisodeId);
  const episodes = detail.seasons.flatMap((season) => [`<div class="episode-season"><h3>${escapeHtml(season.title)}</h3><div class="episode-list">${season.episodes.map((episode) => renderEpisode(episode)).join("")}</div></div>`]);
  const resume = detail.resume ? `<div class="detail-resume">上次观看到 ${escapeHtml(formatTime(detail.resume.positionSec))} · ${escapeHtml(selected?.title ?? "已保存进度")}</div>` : "";
  detailSection.innerHTML = `<div class="detail-back-row"><p class="detail-kicker">内容详情 · 来源状态已保存</p><button class="text-button" type="button" data-detail-action="back">返回片库</button></div><div class="detail-layout"><div id="detail-cover" class="detail-poster">${imageFallback(detail.title)}</div><div class="detail-copy"><p class="eyebrow">CONTENT DETAIL</p><h1 id="detail-title">${escapeHtml(detail.title)}</h1><p class="detail-original">${escapeHtml(detail.releaseYear || "年份未知")} · ${escapeHtml(detail.videoType || "影视")}</p><div class="detail-meta"><span>${escapeHtml(detail.releaseYear || "年份未知")}</span><span>${escapeHtml(detail.videoType || "影视")}</span>${detail.score || detail.rating ? `<span>评分 ${escapeHtml(detail.score ?? detail.rating)}</span>` : ""}</div><div class="detail-actions"><button class="primary-button" type="button" data-detail-action="play">播放</button>${detail.resume ? `<button class="secondary-button" type="button" data-detail-action="resume">继续播放</button>` : ""}</div>${resume}<section><h3>选集</h3>${episodes.length ? episodes.join("") : `<div class="detail-empty">当前详情没有可播放 Episode。</div>`}</section><section><h3>简介</h3><p class="detail-storyline">${escapeHtml(detail.storyline || "暂无简介")}</p></section></div></div>`;
  setMessage(detail.resume ? "详情已加载，存在真实续播历史。" : "详情已加载。");
}

function renderEpisode(episode: Episode): string {
  const selected = episode.episodeId === selectedEpisodeId;
  return `<button class="episode-row" type="button" data-episode-id="${escapeHtml(episode.episodeId)}" aria-selected="${selected}"><span class="episode-number">${String(episode.episodeNumber).padStart(2, "0")}</span><span class="episode-title">${escapeHtml(episode.title)}</span><span class="episode-duration">${escapeHtml(episode.durationSec ? formatTime(episode.durationSec) : "时长未知")}</span></button>`;
}

async function loadDetailImage(detail: CollectionDetail, epoch: number): Promise<void> {
  if (!detail.imageKey) return;
  const result = await window.zVideo.library.loadImage({ collectionId: detail.collectionId, kind: "cover" }).catch(() => undefined);
  if (epoch !== requestEpoch || !result?.dataUrl) return;
  const cover = document.querySelector<HTMLElement>("#detail-cover");
  if (cover) setImage(cover, result.dataUrl, `《${detail.title}》封面`);
}

async function backToLibrary(): Promise<void> {
  const focusCollectionId = navigation.detail?.focusCollectionId;
  detailOpen = false;
  activeDetail = undefined;
  navigation = { ...navigation, view: "library", detail: undefined };
  saveNavigation();
  await loadCollections();
  if (libraryScroll) libraryScroll.scrollTop = navigation.library.scrollTop;
  if (focusCollectionId) document.querySelector<HTMLButtonElement>(`[data-collection-id="${cssEscape(focusCollectionId)}"]`)?.focus();
}

async function sendPlaybackCommand(type: "play" | "resume"): Promise<void> {
  if (!activeDetail || !selectedEpisodeId) {
    setMessage("当前详情没有可播放 Episode。", true);
    return;
  }
  const command: PlaybackCommand = {
    type: "open",
    collectionId: activeDetail.collectionId,
    classificationId: navigation.library.classificationId,
    episodeId: selectedEpisodeId,
    ...(type === "resume" && activeDetail.resume ? { startPositionSec: activeDetail.resume.positionSec } : {}),
  };
  if (!window.zVideo.player) {
    setMessage("播放模块尚未就绪，已保留当前 Episode 选择。", true);
    return;
  }
  try {
    await window.zVideo.player.send(command);
    setMessage(type === "resume" ? "已请求继续播放。" : "已请求播放。", false);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "播放请求失败。", true);
  }
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

export function initializeLibraryRenderer(): void {
  if (initialized) return;
  initialized = true;
  classificationList?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-classification-id]");
    if (!button) return;
    setNavigationQuery({ classificationId: button.dataset.classificationId ?? "", page: 1, query: "", filter: "all", sort: "recent" });
    void loadCollections();
  });
  collectionGrid?.addEventListener("click", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-collection-id]");
    if (card?.dataset.collectionId) void openDetail(card.dataset.collectionId);
  });
  continueRow?.addEventListener("click", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-continue-collection-id]");
    if (card?.dataset.continueCollectionId) void openDetail(card.dataset.continueCollectionId, card.dataset.continueClassificationId);
  });
  detailSection?.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-detail-action], [data-episode-id]");
    if (!target) return;
    if (target.dataset.detailAction === "back") void backToLibrary();
    if (target.dataset.detailAction === "play") void sendPlaybackCommand("play");
    if (target.dataset.detailAction === "resume") void sendPlaybackCommand("resume");
    if (target.dataset.episodeId && activeDetail) {
      selectedEpisodeId = target.dataset.episodeId;
      navigation = { ...navigation, detail: navigation.detail ? { ...navigation.detail, episodeId: selectedEpisodeId } : undefined };
      renderDetail(activeDetail);
    }
  });
  libraryPagination?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    const page = Number(button?.dataset.page);
    if (!button || !Number.isInteger(page) || page < 1 || page === navigation.library.page) return;
    setNavigationQuery({ page });
    void loadCollections();
  });
  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    setNavigationQuery({ query: searchInput?.value.trim() || "", page: 1 });
    void loadCollections();
  });
  searchInput?.addEventListener("input", () => { if (searchClear) searchClear.hidden = !Boolean(searchInput.value); });
  searchClear?.addEventListener("click", () => { if (searchInput) searchInput.value = ""; setNavigationQuery({ query: "", page: 1 }); void loadCollections(); searchInput?.focus(); });
  filterSelect?.addEventListener("change", () => { setNavigationQuery({ filter: filterSelect.value as LibraryFilter, page: 1 }); void loadCollections(); });
  sortSelect?.addEventListener("change", () => { setNavigationQuery({ sort: sortSelect.value as LibraryQuery["sort"], page: 1 }); void loadCollections(); });
  libraryBackButton?.addEventListener("click", () => { void backToLibrary(); });
  libraryScroll?.addEventListener("scroll", () => { if (!detailOpen) { navigation = { ...navigation, library: { ...navigation.library, scrollTop: libraryScroll.scrollTop } }; saveNavigation(); } }, { passive: true });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !detailOpen) { event.preventDefault(); searchInput?.focus(); searchInput?.select(); }
    if (event.key === "Escape" && detailOpen) { event.preventDefault(); void backToLibrary(); }
  });
  void window.zVideo.library.getNavigation().then((stored) => {
    if (!stored.library.classificationId) return;
    navigation = stored;
    updateToolbar();
  }).catch(() => undefined);
}

export function setLibrarySessionState(state: PublicSessionState): void {
  sessionState = state;
  renderClassifications(state.classifications);
  if (state.status !== "authenticated") {
    detailOpen = false;
    activeDetail = undefined;
    if (libraryView) libraryView.hidden = true;
    return;
  }
  if (libraryView) libraryView.hidden = false;
  const selected = state.classifications.some((classification) => classification.id === navigation.library.classificationId) ? navigation.library.classificationId : state.classifications[0]?.id ?? "";
  if (!selected) {
    setMessage("NAS 未返回可用分类，未请求影视列表。", true);
    return;
  }
  setNavigationQuery({ classificationId: selected });
  void loadCollections();
}

export function refreshLibrary(): void {
  requestEpoch += 1;
  activePage = undefined;
  setNavigationQuery({ page: 1 });
  void loadCollections();
}

initializeLibraryRenderer();

