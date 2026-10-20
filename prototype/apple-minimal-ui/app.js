const libraryItems = [
  {
    id: "city-after-rain",
    title: "雨后城市",
    year: "2026",
    kind: "电影",
    runtime: "1 小时 48 分",
    rating: "8.4",
    genre: "剧情 / 城市",
    image: "cover-city-after-rain.jpg",
    progress: 48,
    recent: true,
    favorite: true,
    cast: "林知远 / 周岚",
    director: "顾言",
    summary: "一场短雨之后，两个久未谋面的旧友沿着城市边缘重走一段熟悉的路。故事把时间留给街灯、车站和没有说出口的话。"
  },
  {
    id: "coast-road",
    title: "海岸公路",
    year: "2026",
    kind: "电影",
    runtime: "1 小时 56 分",
    rating: "8.1",
    genre: "公路 / 剧情",
    image: "cover-coast-road.jpg",
    progress: 22,
    recent: true,
    favorite: false,
    cast: "沈一 / 许澄",
    director: "梁川",
    summary: "沿着海岸线向北，一段被延后的告别在潮声里重新获得了方向。"
  },
  {
    id: "courtyard-wind",
    title: "院落的风",
    year: "2025",
    kind: "剧集",
    runtime: "共 8 集",
    rating: "8.8",
    genre: "家庭 / 剧情",
    image: "cover-courtyard.jpg",
    progress: 0,
    recent: true,
    favorite: true,
    cast: "苏禾 / 陈放 / 叶宁",
    director: "何川",
    summary: "一座旧院子里，三代人用各自的方式保存生活留下的声音。"
  },
  {
    id: "desert-line",
    title: "沙线",
    year: "2025",
    kind: "电影",
    runtime: "1 小时 42 分",
    rating: "7.9",
    genre: "剧情 / 旅行",
    image: "cover-desert-line.jpg",
    progress: 0,
    recent: true,
    favorite: false,
    cast: "唐予 / 魏明",
    director: "陆承",
    summary: "地图上的一条细线，连接起旷野里两个彼此错过的夏天。"
  },
  {
    id: "forest-signal",
    title: "森林信号",
    year: "2025",
    kind: "剧集",
    runtime: "共 6 集",
    rating: "8.2",
    genre: "悬疑 / 自然",
    image: "cover-forest-signal.jpg",
    progress: 0,
    recent: true,
    favorite: false,
    cast: "贺闻 / 林夕",
    director: "苏桐",
    summary: "山林深处反复出现的微弱信号，让一支测绘队重新审视十年前的记录。"
  },
  {
    id: "lake-house",
    title: "湖畔房间",
    year: "2025",
    kind: "电影",
    runtime: "1 小时 35 分",
    rating: "7.7",
    genre: "剧情 / 人物",
    image: "cover-lake-house.jpg",
    progress: 0,
    recent: true,
    favorite: true,
    cast: "许然 / 江遥",
    director: "叶初",
    summary: "湖畔一间空置的房子，收留了两位正在整理旧日生活的人。"
  },
  {
    id: "library-light",
    title: "书页之间",
    year: "2024",
    kind: "电影",
    runtime: "1 小时 29 分",
    rating: "8.0",
    genre: "人文 / 纪录",
    image: "cover-library-light.jpg",
    progress: 0,
    recent: false,
    favorite: false,
    cast: "顾青 / 何远",
    director: "郑安",
    summary: "一间社区图书馆的日常，记录下人们如何借阅书，也如何彼此照看。"
  },
  {
    id: "mountain-signal",
    title: "山的回声",
    year: "2024",
    kind: "剧集",
    runtime: "共 10 集",
    rating: "8.5",
    genre: "自然 / 纪录",
    image: "cover-mountain-signal.jpg",
    progress: 0,
    recent: false,
    favorite: false,
    cast: "赵衡 / 温宁",
    director: "谢闻",
    summary: "从谷地到山脊，十集影像记录人和自然相处的不同尺度。"
  },
  {
    id: "night-train",
    title: "夜行列车",
    year: "2024",
    kind: "电影",
    runtime: "1 小时 51 分",
    rating: "8.3",
    genre: "悬疑 / 剧情",
    image: "cover-night-train.jpg",
    progress: 0,
    recent: false,
    favorite: false,
    cast: "程野 / 罗静",
    director: "林澈",
    summary: "一趟驶向北方的夜车上，每位乘客都带着一段没有寄出的信。"
  },
  {
    id: "quiet-room",
    title: "安静房间",
    year: "2023",
    kind: "电影",
    runtime: "1 小时 37 分",
    rating: "7.8",
    genre: "剧情 / 家庭",
    image: "cover-quiet-room.jpg",
    progress: 0,
    recent: false,
    favorite: false,
    cast: "沈南 / 白芷",
    director: "何木",
    summary: "搬家之前，女孩在一间空房里重新听见家人说话的方式。"
  },
  {
    id: "rain-window",
    title: "雨窗",
    year: "2023",
    kind: "剧集",
    runtime: "共 5 集",
    rating: "7.6",
    genre: "短篇 / 剧情",
    image: "cover-rain-window.jpg",
    progress: 0,
    recent: false,
    favorite: false,
    cast: "许禾 / 周至",
    director: "程野",
    summary: "五个下雨的下午，五个相互照见的生活片段。"
  },
  {
    id: "red-chair",
    title: "红椅子",
    year: "2022",
    kind: "电影",
    runtime: "1 小时 26 分",
    rating: "7.5",
    genre: "人文 / 剧情",
    image: "cover-red-chair.jpg",
    progress: 0,
    recent: false,
    favorite: false,
    cast: "林默 / 宋秋",
    director: "顾言",
    summary: "一把旧椅子在几户人家之间移动，见证了一座街区的变化。"
  },
  {
    id: "north-window",
    title: "北向窗口",
    year: "2022",
    kind: "电影",
    runtime: "1 小时 44 分",
    rating: "7.9",
    genre: "剧情 / 城市",
    image: "cover-city-after-rain.jpg",
    progress: 0,
    recent: false,
    favorite: false,
    cast: "叶宁 / 顾远",
    director: "梁川",
    summary: "一间朝北的工作室里，画家等待一封迟到的回信。"
  },
  {
    id: "shoreline-notes",
    title: "潮线笔记",
    year: "2021",
    kind: "纪录",
    runtime: "1 小时 18 分",
    rating: "8.1",
    genre: "自然 / 纪录",
    image: "cover-coast-road.jpg",
    progress: 0,
    recent: false,
    favorite: false,
    cast: "沈言",
    director: "许澄",
    summary: "沿海记录者用一年的时间标记潮水留下的每一条线。"
  }
];

const categories = {
  all: "全部影片",
  movie: "电影",
  series: "剧集",
  recent: "最近添加",
  favorite: "我的收藏",
  resume: "继续观看"
};

const iconPaths = {
  grid: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>',
  film: '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M6 4v12M18 8H6M18 12H6"/>',
  tv: '<rect x="3" y="5" width="14" height="10" rx="2"/><path d="m8 2 4 3M12 2 8 5M7 18h6"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
  heart: '<path d="M10 17s-6-3.6-6-8.2A3.3 3.3 0 0 1 10 7a3.3 3.3 0 0 1 6 1.8C16 13.4 10 17 10 17Z"/>',
  play: '<path d="m8 5 8 5-8 5V5Z"/>',
  sidebar: '<path d="M6 4v12M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM6 4v12"/>',
  search: '<circle cx="8.5" cy="8.5" r="4.5"/><path d="m12 12 4 4"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  back: '<path d="m12 5-5 5 5 5M7 10h8"/>',
  forward: '<path d="m8 5 5 5-5 5M13 10H5"/>',
  info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5h.01"/>',
  check: '<path d="m5 10 3 3 7-7"/>'
};

const state = {
  view: "library",
  category: "all",
  query: "",
  selectedId: null,
  sort: "recent",
  type: "all",
  scroll: 0,
  filtersOpen: false,
  origin: null
};

const appShell = document.querySelector("#appShell");
const content = document.querySelector("#content");
const contentScroll = document.querySelector("#contentScroll");
const mainPanel = document.querySelector("#mainPanel");
const toolbarContext = document.querySelector("#toolbarContext");
const toolbarTitle = document.querySelector("#toolbarTitle");
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

function icon(name) {
  const path = iconPaths[name] || iconPaths.info;
  return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${path}</svg>`;
}

function renderIcons() {
  document.querySelectorAll("[data-icon]").forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
  });
}

function getItem(id) {
  return libraryItems.find((item) => item.id === id) || libraryItems[0];
}

function normalizeOrigin(serialized) {
  const params = new URLSearchParams(serialized || "state=library");
  return {
    query: params.get("q") || "",
    category: categories[params.get("category")] ? params.get("category") : "all",
    sort: ["recent", "title"].includes(params.get("sort")) ? params.get("sort") : "recent",
    type: ["all", "movie", "series"].includes(params.get("type")) ? params.get("type") : "all",
    scroll: Math.max(0, Number.parseInt(params.get("scroll") || "0", 10) || 0)
  };
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
  state.origin = state.view === "detail" ? normalizeOrigin(params.get("from")) : null;

  if (state.view === "detail" && state.origin) {
    state.category = state.origin.category;
    state.query = state.origin.query;
    state.sort = state.origin.sort;
    state.type = state.origin.type;
    state.scroll = state.origin.scroll;
  }
}

function ensureDefaultRoute() {
  if (new URLSearchParams(window.location.search).get("state")) return;
  const params = new URLSearchParams();
  params.set("state", "library");
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
}

function makeLibraryParams() {
  const params = new URLSearchParams();
  params.set("state", state.query ? "search" : "library");
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

function rememberScroll() {
  if (state.view === "detail") return;
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
  announce(`已打开${getItem(id).title}详情`);
}

function goBack() {
  if (state.view !== "detail") return;
  if (window.history.state && window.history.state.detailOrigin) {
    window.history.back();
    return;
  }

  const origin = state.origin || normalizeOrigin("");
  state.query = origin.query;
  state.category = origin.category;
  state.sort = origin.sort;
  state.type = origin.type;
  state.scroll = origin.scroll;
  state.selectedId = null;
  writeRoute(makeLibraryParams());
}

function filteredItems() {
  let result = [...libraryItems];

  if (state.category === "movie") result = result.filter((item) => item.kind === "电影");
  if (state.category === "series") result = result.filter((item) => item.kind === "剧集");
  if (state.category === "recent") result = result.filter((item) => item.recent);
  if (state.category === "favorite") result = result.filter((item) => item.favorite);
  if (state.category === "resume") result = result.filter((item) => item.progress > 0);
  if (state.type === "movie") result = result.filter((item) => item.kind === "电影");
  if (state.type === "series") result = result.filter((item) => item.kind === "剧集");

  if (state.query) {
    const needle = state.query.toLocaleLowerCase();
    result = result.filter((item) => [item.title, item.kind, item.genre, item.year, item.cast, item.director]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle));
  }

  if (state.sort === "title") {
    result.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
  } else {
    result.sort((left, right) => Number(right.recent) - Number(left.recent) || left.title.localeCompare(right.title, "zh-CN"));
  }

  return result;
}

function imageMarkup(item, variant = "poster") {
  const className = variant === "poster" ? "poster-frame" : variant === "detail" ? "detail-poster" : "continue-image";
  const sizeLabel = variant === "detail" ? "主海报" : "封面";
  return `<span class="${className}" data-image-frame>
    <img src="../assets/${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}${sizeLabel}" loading="lazy" />
    <span class="image-fallback" aria-hidden="true">${sizeLabel}暂不可用</span>
  </span>`;
}

function renderPoster(item) {
  const progress = item.progress > 0
    ? `<span class="poster-progress" aria-hidden="true"><span style="--progress: ${item.progress}%"></span></span>`
    : "";
  const progressText = item.progress > 0 ? `，已观看 ${item.progress}%` : "";
  return `<button class="poster-card" type="button" data-action="open-detail" data-id="${escapeHtml(item.id)}" aria-label="打开${escapeHtml(item.title)}详情${progressText}">
    ${imageMarkup(item)}${progress}
    <span class="poster-copy">
      <span class="poster-title">${escapeHtml(item.title)}</span>
      <span class="card-meta"><span>${escapeHtml(item.year)}</span><span>${escapeHtml(item.kind)}</span></span>
    </span>
  </button>`;
}

function renderContinueCard(item) {
  return `<button class="continue-card" type="button" data-action="open-detail" data-id="${escapeHtml(item.id)}" aria-label="继续观看${escapeHtml(item.title)}，已观看 ${item.progress}%">
    ${imageMarkup(item, "continue")}
    <span class="continue-copy">
      <strong>${escapeHtml(item.title)}</strong>
      <span>已观看 ${item.progress}% · ${escapeHtml(item.runtime)}</span>
      <span class="progress-track" aria-hidden="true"><span style="--progress: ${item.progress}%"></span></span>
    </span>
  </button>`;
}

function renderFilters() {
  if (!state.filtersOpen) return "";
  return `<div class="filter-bar" id="filterBar" role="group" aria-label="筛选条件">
    <span class="filter-label">类型</span>
    <button class="filter-control ${state.type === "all" ? "is-selected" : ""}" type="button" data-action="filter-type" data-type="all" aria-pressed="${state.type === "all"}">全部</button>
    <button class="filter-control ${state.type === "movie" ? "is-selected" : ""}" type="button" data-action="filter-type" data-type="movie" aria-pressed="${state.type === "movie"}">电影</button>
    <button class="filter-control ${state.type === "series" ? "is-selected" : ""}" type="button" data-action="filter-type" data-type="series" aria-pressed="${state.type === "series"}">剧集</button>
    <button class="filter-control" type="button" data-action="clear-conditions">清除条件</button>
  </div>`;
}

function renderEmptyState() {
  return `<div class="empty-state">
    <div class="empty-state-inner">
      <span class="empty-icon" aria-hidden="true">${icon("search")}</span>
      <h2>没有找到匹配内容</h2>
      <p>试试更短的片名，或清除搜索词和类型筛选后继续浏览片库。</p>
      <div class="empty-actions">
        <button class="primary-action" type="button" data-action="clear-search">清空并返回</button>
      </div>
    </div>
  </div>`;
}

function renderLibrary() {
  const result = filteredItems();
  const isSearch = state.view === "search";
  const heading = isSearch ? "搜索结果" : (categories[state.category] || "全部影片");
  const description = isSearch
    ? `搜索“${escapeHtml(state.query || "全部内容")}”，按类型和排序查看匹配结果。`
    : "从现有片库开始浏览；选择影片后，详情页会在同一窗口中替换当前内容。";
  const continueItems = libraryItems.filter((item) => item.progress > 0);
  const gridTitle = isSearch ? "结果" : state.category === "recent" ? "最近添加" : "片库内容";

  return `<div class="page-intro">
    <div>
      <p class="eyebrow">${isSearch ? "搜索 / 筛选" : "片库"}</p>
      <h2>${heading}</h2>
      <p>${description}</p>
    </div>
    <div class="section-actions">
      <span class="section-count">${result.length} 个结果</span>
      ${isSearch ? `<button class="section-link" type="button" data-action="clear-search">清空搜索 ${icon("close")}</button>` : ""}
    </div>
  </div>
  ${renderFilters()}
  ${!isSearch && state.category === "all" && state.type === "all" && !state.query ? `<section class="section-block" aria-labelledby="continueHeading">
    <div class="section-heading"><h2 id="continueHeading">继续观看</h2><span class="section-count">${continueItems.length} 部影片</span></div>
    <div class="continue-row">${continueItems.map(renderContinueCard).join("")}</div>
  </section>` : ""}
  ${result.length === 0 && isSearch ? renderEmptyState() : `<section class="section-block" aria-labelledby="gridHeading">
    <div class="section-heading">
      <h2 id="gridHeading">${gridTitle}</h2>
      <div class="section-actions">
        <label class="sort-label" for="sortSelect">排序</label>
        <select class="sort-select" id="sortSelect" data-action="sort-change" aria-label="结果排序">
          <option value="recent" ${state.sort === "recent" ? "selected" : ""}>最近添加</option>
          <option value="title" ${state.sort === "title" ? "selected" : ""}>标题</option>
        </select>
      </div>
    </div>
    <div class="poster-grid">${result.map(renderPoster).join("")}</div>
  </section>`}`;
}

function renderEpisodes(item) {
  const count = item.kind === "剧集" ? (item.id === "forest-signal" ? 6 : item.id === "mountain-signal" ? 10 : 8) : 1;
  const episodes = Array.from({ length: Math.min(count, 4) }, (_, index) => ({
    title: item.kind === "剧集" ? `第 ${index + 1} 集 · ${index === 0 ? "回到院落" : "未命名章节"}` : "正片",
    duration: item.kind === "剧集" ? "42 分" : item.runtime,
    selected: index === 0
  }));
  return `<div class="episode-list">
    ${episodes.map((episode, index) => `<button class="episode-row ${episode.selected ? "is-selected" : ""}" type="button" data-action="select-episode" data-episode="${index + 1}">
      <span class="episode-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="episode-title">${escapeHtml(episode.title)}</span>
      <span class="episode-duration">${escapeHtml(episode.duration)}</span>
    </button>`).join("")}
    ${count > episodes.length ? `<p class="section-count">还有 ${count - episodes.length} 集 · 原型只展示前四集</p>` : ""}
  </div>`;
}

function renderDetail() {
  const item = getItem(state.selectedId);
  const canResume = Number(item.progress) > 0;
  const resumeAction = canResume ? `<button class="secondary-action" type="button" data-action="start-playback">继续播放</button>` : "";
  const progressNote = canResume ? `<div class="detail-progress-note"><span>上次观看到 ${item.progress}%</span><span class="progress-track" aria-hidden="true"><span style="--progress: ${item.progress}%"></span></span></div>` : "";

  return `<div class="detail-content">
    <div class="detail-back-row">
      <p class="detail-kicker">内容详情 · 来源状态已保存</p>
      <button class="back-button" type="button" data-action="go-back">${icon("back")}返回片库</button>
    </div>
    <div class="detail-layout">
      ${imageMarkup(item, "detail")}
      <div class="detail-copy">
        <p class="eyebrow">${escapeHtml(item.kind)}</p>
        <h2>${escapeHtml(item.title)}</h2>
        <p class="detail-original">${escapeHtml(item.genre)} · 本地原型资料</p>
        <div class="detail-meta"><span>${escapeHtml(item.year)}</span><span>${escapeHtml(item.runtime)}</span><span>评分 ${escapeHtml(item.rating)}</span></div>
        <div class="detail-actions">
          <button class="primary-action" type="button" data-action="start-playback">播放</button>
          ${resumeAction}
        </div>
        ${progressNote}
        <section class="detail-section" aria-labelledby="episodeHeading"><h3 id="episodeHeading">选集</h3>${renderEpisodes(item)}</section>
        <section class="detail-section" aria-labelledby="summaryHeading"><h3 id="summaryHeading">简介</h3><p>${escapeHtml(item.summary)}</p></section>
        <section class="detail-section" aria-labelledby="infoHeading"><h3 id="infoHeading">演员与信息</h3><div class="detail-info-grid">
          <div><span class="detail-label">演员</span><span class="detail-value">${escapeHtml(item.cast)}</span></div>
          <div><span class="detail-label">导演</span><span class="detail-value">${escapeHtml(item.director)}</span></div>
          <div><span class="detail-label">音轨</span><span class="detail-value">国语 · 立体声（占位）</span></div>
          <div><span class="detail-label">字幕</span><span class="detail-value">简体中文 · 可选（占位）</span></div>
        </div></section>
        <p class="structure-note">返回后会恢复来源页面的搜索词、筛选条件、排序和滚动位置。播放按钮只验证交互入口，未连接真实 NAS 或播放引擎。</p>
      </div>
    </div>
  </div>`;
}

function renderSidebar() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.category === state.category && state.view !== "detail";
    button.classList.toggle("is-selected", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function render() {
  const isDetail = state.view === "detail";
  const isSearch = state.view === "search";
  toolbarContext.textContent = isDetail ? "详情" : isSearch ? "搜索" : "片库";
  toolbarTitle.textContent = isDetail ? getItem(state.selectedId).title : isSearch ? "搜索结果" : categories[state.category];
  searchInput.value = state.query;
  clearSearch.hidden = !state.query;
  document.querySelector("[data-action='toggle-filters']").hidden = isDetail;
  document.querySelector("[data-action='toggle-filters']").setAttribute("aria-expanded", String(state.filtersOpen));
  document.querySelector("[data-action='toggle-filters']").textContent = state.filtersOpen ? "收起筛选" : "筛选";
  content.innerHTML = isDetail ? renderDetail() : renderLibrary();
  renderIcons();
  renderSidebar();
  contentScroll.scrollTop = isDetail ? 0 : state.scroll;
}

function announce(message) {
  liveRegion.textContent = "";
  window.setTimeout(() => {
    liveRegion.textContent = message;
  }, 10);
}

function clearConditions() {
  state.query = "";
  state.category = "all";
  state.type = "all";
  state.sort = "recent";
  state.scroll = 0;
  state.view = "library";
  state.selectedId = null;
  state.filtersOpen = false;
  writeRoute(makeLibraryParams());
  announce("搜索和筛选条件已清空");
}

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  const { action } = actionTarget.dataset;
  if (action === "toggle-sidebar") {
    const hidden = appShell.classList.toggle("sidebar-hidden");
    actionTarget.setAttribute("aria-pressed", String(hidden));
    actionTarget.setAttribute("aria-label", hidden ? "显示侧边栏" : "隐藏侧边栏");
    actionTarget.title = hidden ? "显示侧边栏" : "隐藏侧边栏";
    announce(hidden ? "侧边栏已隐藏" : "侧边栏已显示");
  }
  if (action === "open-detail") openDetail(actionTarget.dataset.id);
  if (action === "go-back") goBack();
  if (action === "clear-search" || action === "clear-conditions") clearConditions();
  if (action === "toggle-filters") {
    state.filtersOpen = !state.filtersOpen;
    render();
    announce(state.filtersOpen ? "筛选条件已展开" : "筛选条件已收起");
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
    state.sort = "recent";
    state.view = "library";
    state.scroll = 0;
    state.filtersOpen = false;
    writeRoute(makeLibraryParams());
    announce(`已切换到${categories[state.category]}`);
  }
  if (action === "start-playback") announce("播放入口已触发；真实播放引擎尚未接入。");
  if (action === "select-episode") {
    document.querySelectorAll(".episode-row").forEach((row) => row.classList.remove("is-selected"));
    actionTarget.classList.add("is-selected");
    announce(`已选择第 ${actionTarget.dataset.episode} 集`);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.dataset.action !== "sort-change") return;
  state.sort = event.target.value;
  state.scroll = 0;
  writeRoute(makeLibraryParams());
  announce(state.sort === "title" ? "已按标题排序" : "已按最近添加排序");
});

document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const frame = image.closest("[data-image-frame]");
  if (frame) frame.classList.add("has-error");
}, true);

searchInput.addEventListener("input", () => {
  clearSearch.hidden = searchInput.value.length === 0;
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = searchInput.value.trim();
  state.view = state.query ? "search" : "library";
  state.scroll = 0;
  state.filtersOpen = Boolean(state.query);
  writeRoute(makeLibraryParams());
  announce(state.query ? `正在显示“${state.query}”的搜索结果` : "已返回全部影片");
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
  if (state.view !== "detail") rememberScroll();
}, { passive: true });

window.addEventListener("popstate", () => {
  readRoute();
  render();
});

ensureDefaultRoute();
readRoute();
render();
