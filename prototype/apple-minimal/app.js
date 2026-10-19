const items = Array.from({ length: 14 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `placeholder-${number}`,
    title: `影片标题 ${number}`,
    year: index < 5 ? "2026" : "2025",
    kind: index % 4 === 0 ? "剧集" : "电影",
    runtime: index % 4 === 0 ? "共 8 集" : "1h 48m",
    rating: "8.0",
    genre: index % 2 === 0 ? "剧情 / 示例" : "类型 / 示例",
    progress: index < 2 ? (index === 0 ? 48 : 22) : 0,
    favorite: index % 3 === 0,
    recent: index < 6
  };
});

const categories = {
  all: "全部影片",
  movie: "电影",
  series: "剧集",
  recent: "最近添加",
  favorite: "我的收藏",
  resume: "继续观看"
};

const state = {
  view: "library",
  category: "all",
  query: "",
  selectedId: null,
  sort: "recent",
  type: "all",
  scroll: 0,
  filtersOpen: false
};

const appLayout = document.querySelector("#appLayout");
const content = document.querySelector("#content");
const contentScroll = document.querySelector("#contentScroll");
const mainPanel = document.querySelector("#mainPanel");
const toolbarContext = document.querySelector("#toolbarContext");
const toolbarTitle = document.querySelector("#toolbarTitle");
const backButton = document.querySelector("#backButton");
const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const clearSearch = document.querySelector("#clearSearch");
const liveRegion = document.querySelector("#liveRegion");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function getItem(id) {
  return items.find((item) => item.id === id) || items[0];
}

function routeView() {
  return state.query ? "search" : "library";
}

function readRoute() {
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("state");
  state.view = ["library", "search", "detail"].includes(requestedView) ? requestedView : "library";
  state.category = categories[params.get("category")] ? params.get("category") : "all";
  state.query = params.get("q") || "";
  state.selectedId = params.get("id") || null;
  state.sort = ["recent", "title"].includes(params.get("sort")) ? params.get("sort") : "recent";
  state.type = ["all", "movie", "series"].includes(params.get("type")) ? params.get("type") : "all";
  state.scroll = Math.max(0, Number.parseInt(params.get("scroll") || "0", 10) || 0);
  state.filtersOpen = state.view === "search";
}

function ensureDefaultRoute() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("state")) return;
  params.set("state", "library");
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
}

function makeLibraryParams() {
  const params = new URLSearchParams();
  params.set("state", routeView());
  if (state.query) params.set("q", state.query);
  if (state.category !== "all") params.set("category", state.category);
  if (state.sort !== "recent") params.set("sort", state.sort);
  if (state.type !== "all") params.set("type", state.type);
  if (state.scroll > 0) params.set("scroll", String(Math.round(state.scroll)));
  return params;
}

function writeRoute(params, { replace = false } = {}) {
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  if (replace) {
    window.history.replaceState(window.history.state, "", nextUrl);
  } else {
    window.history.pushState(window.history.state, "", nextUrl);
  }
  readRoute();
  render();
}

function navigateToLibrary({ replace = false } = {}) {
  state.view = state.query ? "search" : "library";
  state.selectedId = null;
  state.scroll = 0;
  writeRoute(makeLibraryParams(), { replace });
}

function rememberScroll() {
  state.scroll = contentScroll.scrollTop;
  const params = makeLibraryParams();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
}

function openDetail(id) {
  rememberScroll();
  const from = makeLibraryParams().toString();
  const params = new URLSearchParams();
  params.set("state", "detail");
  params.set("id", id);
  params.set("from", from);
  window.history.pushState({ detailOrigin: from }, "", `${window.location.pathname}?${params.toString()}`);
  readRoute();
  render();
  mainPanel.focus({ preventScroll: true });
}

function goBack() {
  if (state.view !== "detail") return;
  if (window.history.state && window.history.state.detailOrigin) {
    window.history.back();
    return;
  }

  const from = new URLSearchParams(new URLSearchParams(window.location.search).get("from") || "");
  if (from.get("state")) {
    window.history.pushState(null, "", `${window.location.pathname}?${from.toString()}`);
    readRoute();
    render();
    return;
  }

  state.query = "";
  navigateToLibrary({ replace: true });
}

function filteredItems() {
  let result = [...items];

  if (state.category === "movie") result = result.filter((item) => item.kind === "电影");
  if (state.category === "series") result = result.filter((item) => item.kind === "剧集");
  if (state.category === "recent") result = result.filter((item) => item.recent);
  if (state.category === "favorite") result = result.filter((item) => item.favorite);
  if (state.category === "resume") result = result.filter((item) => item.progress > 0);
  if (state.type === "movie") result = result.filter((item) => item.kind === "电影");
  if (state.type === "series") result = result.filter((item) => item.kind === "剧集");

  if (state.query) {
    const needle = state.query.toLocaleLowerCase();
    result = result.filter((item) => [item.title, item.kind, item.genre, item.year].join(" ").toLocaleLowerCase().includes(needle));
  }

  if (state.sort === "title") {
    result.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
  } else {
    result.sort((left, right) => Number(right.recent) - Number(left.recent) || left.id.localeCompare(right.id));
  }

  return result;
}

function renderFilters() {
  if (!state.filtersOpen) return "";
  return `<div class="filter-bar" id="filterBar" role="group" aria-label="筛选条件">
    <span class="filter-label">筛选条件：</span>
    <button class="filter-control ${state.type === "all" ? "is-selected" : ""}" type="button" data-action="filter-type" data-type="all" aria-pressed="${state.type === "all"}">全部</button>
    <button class="filter-control ${state.type === "movie" ? "is-selected" : ""}" type="button" data-action="filter-type" data-type="movie" aria-pressed="${state.type === "movie"}">电影</button>
    <button class="filter-control ${state.type === "series" ? "is-selected" : ""}" type="button" data-action="filter-type" data-type="series" aria-pressed="${state.type === "series"}">剧集</button>
    <button class="filter-control" type="button" data-action="clear-search">清空条件</button>
  </div>`;
}

function renderPoster(item) {
  return `<button class="poster-card" type="button" data-action="open-detail" data-id="${escapeHtml(item.id)}" aria-label="打开${escapeHtml(item.title)}详情">
    <span class="poster-box" aria-hidden="true"><span>海报占位<br />${escapeHtml(item.id.replace("placeholder-", "FILM "))}</span></span>
    <span class="poster-copy">
      <span class="poster-title">${escapeHtml(item.title)}</span>
      <span class="card-meta"><span>${escapeHtml(item.year)}</span><span>${escapeHtml(item.kind)}</span></span>
    </span>
  </button>`;
}

function renderContinueCard(item) {
  return `<button class="continue-card" type="button" data-action="open-detail" data-id="${escapeHtml(item.id)}" aria-label="继续查看${escapeHtml(item.title)}">
    <span class="continue-placeholder" aria-hidden="true">横向占位</span>
    <span class="continue-copy">
      <strong>${escapeHtml(item.title)}</strong>
      <span>继续观看结构 · ${item.progress}%</span>
      <span class="progress-placeholder" aria-hidden="true"><span></span></span>
    </span>
  </button>`;
}

function renderLibrary() {
  const result = filteredItems();
  const isSearch = state.view === "search";
  const heading = isSearch ? "搜索结果" : (categories[state.category] || "全部影片");
  const description = isSearch
    ? `搜索词：${state.query ? `“${escapeHtml(state.query)}”` : "未输入"}。此处只验证搜索、筛选和结果网格的结构。`
    : "固定浏览画布；详情页会替换这里的主内容并保留返回上下文。";
  const continueItems = items.filter((item) => item.progress > 0);

  if (isSearch && result.length === 0) {
    return `<div class="page-intro"><div><p class="eyebrow">搜索 / 筛选</p><h2>${heading}</h2><p>${description}</p></div></div>
      ${renderFilters()}
      <div class="empty-state"><div class="empty-state-inner"><h2>没有匹配的占位结果</h2><p>可以清空搜索词或筛选条件，回到固定片库浏览画布。</p><button class="secondary-action" type="button" data-action="clear-search">清空并返回</button></div></div>`;
  }

  return `<div class="page-intro"><div><p class="eyebrow">${isSearch ? "搜索 / 筛选" : "片库结构"}</p><h2>${heading}</h2><p>${description}</p></div><div class="section-actions"><span class="section-count">${result.length} 个结果</span><button class="filter-control" type="button" data-action="toggle-filters" aria-expanded="${state.filtersOpen}" aria-controls="filterBar">${state.filtersOpen ? "收起条件" : "显示条件"}</button></div></div>
    ${renderFilters()}
    ${!isSearch && state.category === "all" ? `<section class="section-block" aria-labelledby="continueHeading"><div class="section-heading"><h2 id="continueHeading">继续观看</h2><p class="section-count">横向行结构占位</p></div><div class="continue-row">${continueItems.map(renderContinueCard).join("")}</div></section>` : ""}
    <section class="section-block" aria-labelledby="gridHeading"><div class="section-heading"><h2 id="gridHeading">${isSearch ? "结果网格" : "最近添加"}</h2><div class="section-actions"><label class="filter-label" for="sortSelect">排序</label><select class="filter-control" id="sortSelect" data-action="sort-change"><option value="recent" ${state.sort === "recent" ? "selected" : ""}>最近</option><option value="title" ${state.sort === "title" ? "selected" : ""}>标题</option></select></div></div><div class="poster-grid">${result.map(renderPoster).join("")}</div></section>`;
}

function renderEpisodes() {
  const episodes = ["第一集 · 结构占位", "第二集 · 结构占位", "第三集 · 结构占位"];
  return `<div class="episode-list">${episodes.map((episode, index) => `<button class="episode-row ${index === 0 ? "is-selected" : ""}" type="button" data-action="select-episode" data-episode="${index + 1}"><span class="episode-number">${String(index + 1).padStart(2, "0")}</span><span class="episode-title">${episode}</span><span class="episode-duration">00:45</span></button>`).join("")}</div>`;
}

function renderDetail() {
  const item = getItem(state.selectedId);
  return `<div class="detail-content">
    <div class="detail-back-row"><p class="detail-kicker">独立详情页 · 来源上下文已保留</p><button class="back-control" type="button" data-action="go-back">返回片库</button></div>
    <div class="detail-layout">
      <div class="detail-poster" role="img" aria-label="主海报占位"><span>主海报占位<br />${escapeHtml(item.id.replace("placeholder-", "DETAIL "))}</span></div>
      <div class="detail-copy">
        <p class="eyebrow">内容详情</p>
        <h2>${escapeHtml(item.title)}</h2>
        <p class="detail-original">原始片名占位 · 版本信息占位</p>
        <div class="detail-meta"><span>${escapeHtml(item.year)}</span><span>${escapeHtml(item.kind)}</span><span>${escapeHtml(item.runtime)}</span><span>评分 ${escapeHtml(item.rating)}</span></div>
        <div class="detail-actions"><button class="primary-action" type="button" data-action="start-playback">播放</button><button class="secondary-action" type="button" data-action="start-playback">继续播放</button></div>
        <section class="detail-section" aria-labelledby="episodeHeading"><h3 id="episodeHeading">选集</h3>${renderEpisodes()}</section>
        <section class="detail-section" aria-labelledby="summaryHeading"><h3 id="summaryHeading">简介</h3><p>简介文字占位。这里承载片库已有简介和必要元数据，详情页优先呈现播放入口，再呈现选集和说明。</p></section>
        <section class="detail-section" aria-labelledby="castHeading"><h3 id="castHeading">演员与信息</h3><div class="detail-info-grid"><div><span class="detail-label">演员</span><span class="detail-value">演员姓名占位 / 演员姓名占位</span></div><div><span class="detail-label">类型</span><span class="detail-value">${escapeHtml(item.genre)}</span></div><div><span class="detail-label">音轨</span><span class="detail-value">音轨信息占位</span></div><div><span class="detail-label">字幕</span><span class="detail-value">字幕信息占位</span></div></div></section>
        <p class="structure-note">返回会恢复来源状态：搜索词、筛选条件、排序和片库滚动位置。此处没有右侧详情面板，也不代表真实播放请求已实现。</p>
      </div>
    </div>
  </div>`;
}

function renderSidebar() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.category === state.category && state.view !== "detail";
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function render() {
  const isDetail = state.view === "detail";
  toolbarContext.textContent = isDetail ? "详情" : (state.view === "search" ? "搜索 / 筛选" : "片库");
  toolbarTitle.textContent = isDetail ? "影片详情" : (state.view === "search" ? "搜索结果" : (categories[state.category] || "全部影片"));
  backButton.hidden = !isDetail;
  searchInput.value = state.query;
  clearSearch.hidden = !state.query;
  content.innerHTML = isDetail ? renderDetail() : renderLibrary();
  renderSidebar();

  document.querySelectorAll('[data-action="toggle-filters"]').forEach((button) => {
    button.setAttribute("aria-expanded", String(state.filtersOpen));
  });

  contentScroll.scrollTop = isDetail ? 0 : state.scroll;
}

function announce(message) {
  liveRegion.textContent = message;
}

function toggleSidebar() {
  const hidden = appLayout.classList.toggle("sidebar-hidden");
  document.querySelectorAll('[data-action="toggle-sidebar"]').forEach((button) => {
    button.setAttribute("aria-pressed", String(hidden));
    button.textContent = hidden ? "显示侧边栏" : "侧边栏";
  });
  announce(hidden ? "侧边栏已隐藏" : "侧边栏已显示");
}

function submitSearch() {
  state.query = searchInput.value.trim();
  state.view = state.query ? "search" : "library";
  state.scroll = 0;
  state.filtersOpen = Boolean(state.query);
  writeRoute(makeLibraryParams());
  announce(state.query ? `已显示搜索结果：${state.query}` : "已返回全部影片");
}

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  const { action } = actionTarget.dataset;
  if (action === "toggle-sidebar") toggleSidebar();
  if (action === "open-detail") openDetail(actionTarget.dataset.id);
  if (action === "go-back") goBack();
  if (action === "clear-search") {
    state.query = "";
    state.type = "all";
    state.view = "library";
    state.category = "all";
    state.scroll = 0;
    state.filtersOpen = false;
    navigateToLibrary();
    announce("搜索和筛选条件已清空");
  }
  if (action === "toggle-filters") {
    state.filtersOpen = !state.filtersOpen;
    render();
  }
  if (action === "filter-type") {
    state.type = actionTarget.dataset.type;
    state.view = state.query ? "search" : "library";
    state.scroll = 0;
    writeRoute(makeLibraryParams());
  }
  if (action === "select-category") {
    state.category = actionTarget.dataset.category;
    state.query = "";
    state.type = "all";
    state.view = "library";
    state.scroll = 0;
    state.filtersOpen = false;
    writeRoute(makeLibraryParams());
  }
  if (action === "start-playback") announce("播放入口结构已触发；真实播放尚未接入。");
  if (action === "select-episode") {
    document.querySelectorAll(".episode-row").forEach((row) => row.classList.remove("is-selected"));
    actionTarget.classList.add("is-selected");
    announce(`已选择第 ${actionTarget.dataset.episode} 集占位`);
  }
  if (action === "show-structure-note") announce("当前版本只验证片库、搜索和详情的结构关系。");
});

document.addEventListener("change", (event) => {
  if (event.target.dataset.action !== "sort-change") return;
  state.sort = event.target.value;
  state.scroll = 0;
  writeRoute(makeLibraryParams());
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitSearch();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    announce("搜索框已获得焦点");
  }
  if (event.key === "Escape" && state.view === "detail") {
    event.preventDefault();
    goBack();
  }
});

contentScroll.addEventListener("scroll", () => {
  if (state.view !== "detail") state.scroll = contentScroll.scrollTop;
}, { passive: true });

window.addEventListener("popstate", () => {
  readRoute();
  render();
});

ensureDefaultRoute();
readRoute();
render();
