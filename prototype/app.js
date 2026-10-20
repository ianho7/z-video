const movies = [
  {
    id: "c01", title: "潮汐线之外", original: "Beyond the Tide Line", year: "2024", type: "电影", runtime: "1h 52m", rating: "8.6", cover: "assets/cover-coast-road.jpg", progress: 0, updated: 10, favorite: true,
    genres: ["剧情", "公路"], actors: ["夏未", "顾野", "周岑"], story: "一名海岸测绘员在旧航线尽头遇见一段被删去的家族记录。虚构示例片名与人物，用于展示片库信息层级。", audio: "国语 · AAC", video: "4K · HEVC"
  },
  {
    id: "c02", title: "夜行列车", original: "The Night Train", year: "2023", type: "电影", runtime: "2h 08m", rating: "8.2", cover: "assets/cover-night-train.jpg", progress: 38, updated: 9, favorite: false,
    genres: ["悬疑", "剧情"], actors: ["林砚", "夏未", "沈遥"], story: "一列没有终点站的夜车，载着三位互不相识的乘客驶向同一段旧记忆。", audio: "国语 · AAC", video: "1080p · H.264"
  },
  {
    id: "c03", title: "回声花园", original: "Echo Garden", year: "2022", type: "电影", runtime: "1h 46m", rating: "7.9", cover: "assets/cover-forest-signal.jpg", progress: 0, updated: 8, favorite: true,
    genres: ["剧情", "家庭"], actors: ["周岑", "简宁", "顾野"], story: "植物学家回到北方小城，整理一座即将拆除的旧温室。", audio: "国语 · AAC", video: "4K · HEVC"
  },
  {
    id: "c04", title: "静室来客", original: "Visitors in a Quiet Room", year: "2025", type: "电影", runtime: "1h 38m", rating: "8.8", cover: "assets/cover-quiet-room.jpg", progress: 0, updated: 7, favorite: false,
    genres: ["剧情", "文艺"], actors: ["简宁", "沈遥", "陆川"], story: "建筑师在一间尚未命名的房间里，听见了多年以前的录音。", audio: "国语 · AAC", video: "1080p · HEVC"
  },
  {
    id: "c05", title: "雨落之前", original: "Before the Rain", year: "2021", type: "电影", runtime: "1h 57m", rating: "7.6", cover: "assets/cover-rain-window.jpg", progress: 0, updated: 6, favorite: false,
    genres: ["爱情", "剧情"], actors: ["沈遥", "林砚", "夏未"], story: "两位旧友在暴雨前的一天里，重新走过一座已经改名的城市。", audio: "国语 · AAC", video: "1080p · H.264"
  },
  {
    id: "c06", title: "沙丘上的信号", original: "Signal on the Dune", year: "2024", type: "电影", runtime: "2h 14m", rating: "8.0", cover: "assets/cover-desert-line.jpg", progress: 0, updated: 5, favorite: false,
    genres: ["科幻", "冒险"], actors: ["顾野", "陆川", "简宁"], story: "无人台站收到一段来自未来的天气记录，驻守者必须决定是否回应。", audio: "英语 · E-AC3", video: "4K · HEVC"
  },
  {
    id: "c07", title: "城市的另一面", original: "The Other Side of the City", year: "2020", type: "电影", runtime: "1h 41m", rating: "7.5", cover: "assets/cover-city-after-rain.jpg", progress: 0, updated: 4, favorite: true,
    genres: ["剧情", "城市"], actors: ["林砚", "周岑", "沈遥"], story: "一位夜班摄影师沿着末班车路线，记录城市在天亮前的短暂安静。", audio: "国语 · AAC", video: "1080p · H.264"
  },
  {
    id: "c08", title: "红椅之间", original: "Between the Red Seats", year: "2023", type: "电影", runtime: "1h 29m", rating: "8.1", cover: "assets/cover-red-chair.jpg", progress: 0, updated: 3, favorite: false,
    genres: ["喜剧", "剧情"], actors: ["夏未", "陆川", "周岑"], story: "一家小影院换放映员的那一周，每个人都在寻找自己的最后一场电影。", audio: "国语 · AAC", video: "1080p · H.264"
  },
  {
    id: "c09", title: "远岸灯塔", original: "Far Shore Lighthouse", year: "2019", type: "电影", runtime: "1h 50m", rating: "7.8", cover: "assets/cover-lake-house.jpg", progress: 0, updated: 2, favorite: false,
    genres: ["家庭", "剧情"], actors: ["简宁", "顾野", "夏未"], story: "兄妹回到湖边旧屋，寻找父亲留下的一盏没有点亮的灯。", audio: "国语 · AAC", video: "4K · HEVC"
  },
  {
    id: "c10", title: "开往北方", original: "Northbound", year: "2018", type: "电影", runtime: "1h 34m", rating: "7.3", cover: "assets/cover-mountain-signal.jpg", progress: 0, updated: 1, favorite: false,
    genres: ["公路", "剧情"], actors: ["林砚", "周岑", "陆川"], story: "一支小型测绘队在雪线附近等待迟到的补给车。", audio: "国语 · AAC", video: "1080p · H.264"
  },
  {
    id: "c11", title: "回到光里", original: "Into the Light", year: "2022", type: "剧集", runtime: "8 集", rating: "8.4", cover: "assets/cover-library-light.jpg", progress: 62, updated: 11, favorite: true,
    genres: ["剧集", "成长"], actors: ["沈遥", "夏未", "简宁"], story: "一间社区图书馆重新开门后，八个陌生人的生活轨迹逐渐交汇。", audio: "国语 · AAC", video: "1080p · HEVC", seasons: [{ title: "第一季", episodes: [{ n: 1, title: "门重新打开", duration: "46m" }, { n: 2, title: "借阅卡", duration: "49m" }, { n: 3, title: "一束光", duration: "51m" }] }]
  },
  {
    id: "c12", title: "风从高地来", original: "Wind from the Highland", year: "2025", type: "剧集", runtime: "6 集", rating: "8.7", cover: "assets/cover-courtyard.jpg", progress: 0, updated: 12, favorite: false,
    genres: ["剧集", "自然"], actors: ["顾野", "林砚", "简宁"], story: "六个短篇故事发生在同一片高地，风把它们连接在一起。", audio: "国语 · AAC", video: "4K · HEVC", seasons: [{ title: "第一季", episodes: [{ n: 1, title: "入口", duration: "42m" }, { n: 2, title: "回声", duration: "45m" }, { n: 3, title: "远方", duration: "44m" }] }]
  },
  {
    id: "c13", title: "没有标题的海", original: "Sea Without a Title", year: "2024", type: "电影", runtime: "1h 44m", rating: "7.7", cover: "assets/cover-missing-cover.jpg", progress: 0, updated: 0, favorite: false,
    genres: ["剧情", "实验"], actors: ["夏未", "沈遥"], story: "这是一个故意缺少封面的状态样本，用于检查图片失败后的稳定占位。", audio: "国语 · AAC", video: "1080p · H.264"
  },
  {
    id: "c14", title: "留在窗边", original: "Stay by the Window", year: "2017", type: "电影", runtime: "1h 26m", rating: "7.1", cover: "assets/cover-lake-house.jpg", progress: 0, updated: 0, favorite: false,
    genres: ["剧情"], actors: ["陆川", "周岑"], story: "一封迟到十年的信，让两个人重新坐回同一张桌子旁。", audio: "国语 · AAC", video: "1080p · H.264"
  }
];

const categories = [
  { id: "all", name: "全部影片", count: 36, icon: "grid" },
  { id: "movie", name: "电影", count: 24, icon: "film" },
  { id: "series", name: "剧集", count: 12, icon: "stack" },
  { id: "recent", name: "最近添加", count: 6, icon: "clock" },
  { id: "favorite", name: "我的收藏", count: 4, icon: "bookmark" },
  { id: "resume", name: "继续观看", count: 2, icon: "play" }
];

const state = {
  view: "library",
  category: "all",
  query: "",
  searchMode: "title",
  selectedId: null,
  selectedEpisode: 1,
  detailOpen: false,
  currentActor: null,
  sort: "updated",
  typeFilter: "all",
  demo: "normal",
  playerPaused: false,
  returnFocus: null,
  connectionOpen: false
};

const appMain = document.querySelector("#appMain");
const mainContent = document.querySelector("#mainContent");
const detailPanel = document.querySelector("#detailPanel");
const workspace = document.querySelector("#workspace");
const searchInput = document.querySelector("#searchInput");
const demoMenu = document.querySelector("#demoMenu");
const toolbarTitle = document.querySelector("#toolbarTitle");
const toast = document.querySelector("#toast");

function icon(name, label = "") {
  const labels = { grid: "四格", film: "电影", stack: "剧集", clock: "时间", bookmark: "收藏", play: "播放" };
  return `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><title>${label || labels[name] || ""}</title>${iconPath(name)}</svg></span>`;
}

function iconPath(name) {
  switch (name) {
    case "grid": return '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>';
    case "film": return '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M8 5v14M16 5v14M5 9h14M5 15h14"/>';
    case "stack": return '<rect x="5" y="4" width="11" height="14" rx="1"/><path d="M8 7h5M8 10h5M8 13h3M9 18h10V7"/>';
    case "clock": return '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>';
    case "bookmark": return '<path d="M7 5h10v15l-5-3-5 3V5Z"/>';
    case "play": return '<path d="m9 6 9 6-9 6V6Z"/>';
    default: return '<circle cx="12" cy="12" r="8"/>';
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function getMovie(id) { return movies.find((movie) => movie.id === id); }

function initials(name) { return String(name).slice(0, 1); }

function progressLabel(movie) { return movie.progress > 0 ? `已看 ${movie.progress}%` : "未开始"; }

function cardTemplate(movie, index = 0) {
  const progress = movie.progress > 0 ? `<span class="poster-badge">${movie.progress}%</span><span class="poster-progress" aria-label="已观看 ${movie.progress}%"><i style="width:${movie.progress}%"></i></span>` : "";
  return `<button class="poster-card" type="button" data-action="open-detail" data-id="${escapeHtml(movie.id)}" style="--index:${index}" aria-label="查看《${escapeHtml(movie.title)}》详情">
    <span class="poster-frame">
      <img src="${escapeHtml(movie.cover)}" alt="《${escapeHtml(movie.title)}》封面" loading="lazy" onerror="handleImageError(this)" />
      <span class="poster-fallback" hidden><span><strong>${escapeHtml(initials(movie.title))}</strong>封面暂不可用</span></span>
      ${progress}
    </span>
    <span class="poster-copy"><span class="card-title">${escapeHtml(movie.title)}</span><span class="card-meta"><span>${escapeHtml(movie.year)}</span><span>${escapeHtml(movie.type)}</span></span><span class="card-subtle">${escapeHtml(movie.genres.join(" · "))}</span></span>
  </button>`;
}

function resumeTemplate(movie) {
  return `<button class="resume-card" type="button" data-action="open-detail" data-id="${escapeHtml(movie.id)}" aria-label="继续观看《${escapeHtml(movie.title)}》">
    <span class="resume-cover"><img src="${escapeHtml(movie.cover)}" alt="" loading="lazy" onerror="handleImageError(this)" /></span>
    <span class="resume-info"><strong>${escapeHtml(movie.title)}</strong><span>${escapeHtml(movie.type)} · ${escapeHtml(movie.runtime)}</span><span>${escapeHtml(progressLabel(movie))}</span><span class="resume-progress"><i style="width:${movie.progress}%"></i></span></span>
    <span class="resume-percent">${movie.progress}%</span>
  </button>`;
}

function getResumable() { return movies.filter((movie) => movie.progress > 0).sort((a, b) => b.progress - a.progress); }

function renderCategories() {
  document.querySelector("#categoryNav").innerHTML = categories.map((category) => `<button class="nav-item ${state.category === category.id && state.view === "library" ? "active" : ""}" type="button" data-action="select-category" data-category="${category.id}" aria-current="${state.category === category.id && state.view === "library" ? "page" : "false"}">${icon(category.icon)}<span>${category.name}</span><span class="count">${category.count}</span></button>`).join("");
}

function getFilteredMovies() {
  let result = [...movies];
  if (state.category === "movie") result = result.filter((movie) => movie.type === "电影");
  if (state.category === "series") result = result.filter((movie) => movie.type === "剧集");
  if (state.category === "recent") result = result.filter((movie) => movie.updated >= 8);
  if (state.category === "favorite") result = result.filter((movie) => movie.favorite);
  if (state.category === "resume") result = result.filter((movie) => movie.progress > 0);
  if (state.currentActor) result = result.filter((movie) => movie.actors.includes(state.currentActor));
  if (state.typeFilter !== "all") result = result.filter((movie) => movie.type === state.typeFilter);
  if (state.query && state.searchMode === "title") {
    const needle = state.query.toLocaleLowerCase();
    result = result.filter((movie) => [movie.title, movie.original, movie.type, ...movie.genres, ...movie.actors].join(" ").toLocaleLowerCase().includes(needle));
  }
  if (state.query && state.searchMode === "actor") {
    const needle = state.query.toLocaleLowerCase();
    result = result.filter((movie) => movie.actors.some((actor) => actor.toLocaleLowerCase().includes(needle)));
  }
  const sorters = {
    updated: (a, b) => b.updated - a.updated,
    title: (a, b) => a.title.localeCompare(b.title, "zh-CN"),
    year: (a, b) => Number(b.year) - Number(a.year),
    rating: (a, b) => Number(b.rating) - Number(a.rating)
  };
  return result.sort(sorters[state.sort] || sorters.updated);
}

function getMatchingPeople() {
  const names = [...new Set(movies.flatMap((movie) => movie.actors))];
  if (!state.query) return names;
  return names.filter((name) => name.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
}

function renderToolbar() {
  const category = categories.find((item) => item.id === state.category);
  toolbarTitle.innerHTML = state.view === "library"
    ? `<span class="toolbar-kicker">片库</span><span class="toolbar-current">${escapeHtml(category?.name || "全部影片")}</span>`
    : state.view === "actor"
      ? `<span class="toolbar-kicker">浏览</span><span class="toolbar-current">演员作品</span>`
      : state.view === "player"
        ? `<span class="toolbar-kicker">播放</span><span class="toolbar-current">模拟播放器</span>`
        : `<span class="toolbar-kicker">连接</span><span class="toolbar-current">局域网会话</span>`;
  searchInput.value = state.query;
  searchInput.placeholder = state.searchMode === "actor" ? "搜索演员" : "搜索片名或演员";
  const modeButton = document.querySelector(".search-mode");
  modeButton.textContent = state.searchMode === "actor" ? "演员" : "片名";
  modeButton.setAttribute("aria-pressed", String(state.searchMode === "actor"));
}

function renderLibrary() {
  if (state.demo === "loading") return renderLoading();
  if (state.demo === "error") return renderError();
  if (state.demo === "empty") return renderEmpty();

  const items = getFilteredMovies();
  const resume = getResumable();
  const isSearch = Boolean(state.query);
  const people = isSearch ? getMatchingPeople() : [];
  const currentName = state.currentActor ? `演员 · ${state.currentActor}` : categories.find((item) => item.id === state.category)?.name || "全部影片";
  mainContent.innerHTML = `<div class="${isSearch ? "search-results" : ""}">
    ${isSearch ? `<div class="page-intro"><div><p class="section-label">搜索模拟</p><h2>“${escapeHtml(state.query)}”</h2><p>${state.searchMode === "actor" ? "按演员浏览模拟数据" : `${items.length} 个片库匹配结果`}</p></div><span class="prototype-note">原型数据</span></div>` : `<div class="page-intro"><div><p class="section-label">${state.currentActor ? "人物作品" : "我的片库"}</p><h2>${escapeHtml(currentName)}</h2><p>${state.category === "resume" ? "只显示有正数观看位置的条目" : "按需浏览 · 固定图片槽 · 模拟数据"}</p></div><div class="page-tools"><span class="prototype-note">原型数据</span><label class="select-wrap"><span class="sr-only">类型筛选</span><select data-control="type-filter" aria-label="类型筛选"><option value="all">全部类型</option><option value="电影" ${state.typeFilter === "电影" ? "selected" : ""}>电影</option><option value="剧集" ${state.typeFilter === "剧集" ? "selected" : ""}>剧集</option></select></label><label class="select-wrap"><span class="sr-only">排序</span><select data-control="sort" aria-label="排序"><option value="updated" ${state.sort === "updated" ? "selected" : ""}>最近添加</option><option value="title" ${state.sort === "title" ? "selected" : ""}>片名</option><option value="year" ${state.sort === "year" ? "selected" : ""}>年份</option><option value="rating" ${state.sort === "rating" ? "selected" : ""}>评分</option></select></label></div></div>`}
    ${people.length ? `<div class="section-block"><div class="section-bar"><h3>人物结果</h3><p>点击后浏览该演员作品</p></div><div class="person-results">${people.map((name) => `<button class="person-result" type="button" data-action="open-actor" data-actor="${escapeHtml(name)}"><span class="person-avatar" aria-hidden="true">${escapeHtml(initials(name))}</span><span><strong>${escapeHtml(name)}</strong><span>${movies.filter((movie) => movie.actors.includes(name)).length} 部作品</span></span></button>`).join("")}</div></div>` : ""}
    ${!isSearch && state.category === "all" && resume.length ? `<section class="section-block" aria-labelledby="resumeHeading"><div class="section-bar"><h3 id="resumeHeading">继续观看</h3><p>仅显示已有观看位置的条目</p></div><div class="resume-rail">${resume.map(resumeTemplate).join("")}</div></section>` : ""}
    <section class="section-block" aria-labelledby="gridHeading"><div class="section-bar"><h3 id="gridHeading">${isSearch ? "片库结果" : "海报墙"}</h3><p>${items.length} 项</p></div>${items.length ? `<div class="poster-grid">${items.map(cardTemplate).join("")}</div>` : `<div class="empty-state"><div class="state-content"><div class="state-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></div><h3>没有匹配条目</h3><p>换一个片名、演员或清除搜索条件。</p><button class="secondary-button" type="button" data-action="clear-search">清除条件</button></div></div>`}</section>
  </div>`;
}

function renderLoading() {
  mainContent.innerHTML = `<div class="page-intro"><div><p class="section-label">片库</p><h2>正在载入</h2><p>这是原型中的加载状态，等待不会发送网络请求。</p></div><span class="prototype-note">模拟状态</span></div><div class="skeleton-grid" aria-label="片库加载中">${Array.from({ length: 14 }, (_, index) => `<div class="skeleton-card" style="--index:${index}"><div class="skeleton-cover"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`).join("")}</div>`;
}

function renderEmpty() {
  mainContent.innerHTML = `<div class="empty-state"><div class="state-content"><div class="state-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4V7Z"/><path d="M8 14h8"/></svg></div><h3>这个分类暂时没有条目</h3><p>这是原型的空片库状态。切回“正常片库”可以继续查看模拟数据。</p><button class="secondary-button" type="button" data-demo="normal">返回正常片库</button></div></div>`;
}

function renderError() {
  mainContent.innerHTML = `<div class="error-state"><div class="state-content"><div class="state-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4 21 19H3L12 4Z"/><path d="M12 9v5M12 17v.5"/></svg></div><h3>片库请求未完成</h3><p>原型模拟了服务暂时不可用的情况。可以重试，或打开状态菜单切回正常片库。</p><div class="button-row" style="justify-content:center"><button class="primary-button" type="button" data-demo="normal">重试</button><button class="secondary-button" type="button" data-action="open-login">查看连接</button></div></div></div>`;
}

function renderActorPage() {
  const items = getFilteredMovies();
  mainContent.innerHTML = `<div class="actor-page"><div class="actor-heading"><div><p class="section-label">演员浏览 · 模拟</p><h2>${escapeHtml(state.currentActor || "演员")}</h2><p>${items.length} 部片库作品 · 点击封面打开右侧详情</p></div><div class="actor-badge"><span class="person-avatar" aria-hidden="true">${escapeHtml(initials(state.currentActor || "演"))}</span><span><strong>${escapeHtml(state.currentActor || "演员")}</strong><span class="card-subtle">示例人物资料</span></span></div></div><section class="section-block" aria-labelledby="actorWorksHeading"><div class="section-bar"><h3 id="actorWorksHeading">作品</h3><button class="link-button" type="button" data-action="back-library"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6" /></svg>返回片库</button></div>${items.length ? `<div class="poster-grid">${items.map(cardTemplate).join("")}</div>` : `<div class="empty-state"><div class="state-content"><h3>没有作品结果</h3><p>这个示例人物还没有匹配的模拟作品。</p></div></div>`}</section></div>`;
}

function renderLogin() {
  mainContent.innerHTML = `<section class="login-state" aria-labelledby="loginHeading"><p class="section-label">局域网连接 · 模拟页</p><h2 id="loginHeading">连接到片库</h2><p>这里仅展示登录与恢复状态的界面方向。不会发送地址、账号、密码或验证码，也不会读取真实 NAS。</p><div class="field-grid"><label>NAS 地址<input value="192.168.1.100:5055" readonly /></label><label>账号<input value="示例账号（未提交）" readonly /></label><label>会话状态<input value="已连接 · 模拟会话" readonly /></label></div><div class="button-row" style="margin-top:18px"><button class="primary-button" type="button" data-action="back-library">进入模拟片库</button><button class="secondary-button" type="button" data-action="show-about">查看边界</button></div><p class="login-footnote">真实实现需要由 Rust 负责会话、系统安全存储、错误恢复与请求；本原型只用于确认布局和操作路径。</p></section>`;
}

function renderAbout() {
  mainContent.innerHTML = `<section class="about-state" aria-labelledby="aboutHeading"><p class="section-label">原型边界</p><h2 id="aboutHeading">z-video 片库方向</h2><p>当前方案围绕首屏片库、紧凑海报墙、右侧详情、搜索和演员浏览展开。资料是明确虚构的模拟数据，图片来自公开普通摄影素材。</p><dl class="about-list"><div><dt>可操作流程</dt><dd>分类 → 海报 → 详情 → 切换影片 / 演员作品 → 返回</dd></div><div><dt>收藏</dt><dd>只读列表展示，不提供写回按钮</dd></div><div><dt>续播</dt><dd>只有正数观看位置的样本才显示“继续观看”</dd></div><div><dt>未包含</dt><dd>番号入口、元数据编辑、刮削、NAS 管理、收藏写回</dd></div><div><dt>工程边界</dt><dd>HTML 原型不证明 Slint 性能、播放器集成或 NAS 协议可用性</dd></div></dl><div class="button-row" style="margin-top:20px"><button class="secondary-button" type="button" data-action="back-library">返回片库</button></div></section>`;
}

function renderPlayer() {
  const movie = getMovie(state.selectedId) || movies[0];
  const iconMarkup = state.playerPaused ? '<svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6V6Z" /></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 6v12M16 6v12" /></svg>';
  mainContent.innerHTML = `<section class="player-view" aria-labelledby="playerHeading"><div class="player-top"><div><h2 id="playerHeading">${escapeHtml(movie.title)}</h2><p>${escapeHtml(movie.type)} · 模拟播放状态</p></div><button class="secondary-button" type="button" data-action="back-detail">返回详情</button></div><div class="player-screen"><div class="player-screen-inner"><div class="player-mark"><svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6V6Z" /></svg></div><h3>播放画面占位</h3><p>这里模拟原生播放表面的位置与控制层，不载入真实媒体，也不会向 NAS 上报进度。</p></div></div><div class="player-controls"><div class="player-progress" aria-label="模拟播放进度"><i></i></div><div class="player-control-row"><div><button class="player-control" type="button" data-action="toggle-player" aria-label="${state.playerPaused ? "继续播放" : "暂停播放"}">${iconMarkup}<span>${state.playerPaused ? "继续" : "暂停"}</span></button><span class="player-time">00:42 / 02:08</span></div><button class="player-control" type="button" data-action="back-detail">退出播放器</button></div><div class="player-disclaimer">模拟状态：${state.playerPaused ? "已暂停" : "正在播放"} · 片库位置和 NAS 观看进度不会被修改。</div></div></section>`;
}

function renderDetail() {
  const movie = getMovie(state.selectedId);
  if (!movie || !state.detailOpen) {
    detailPanel.hidden = true;
    detailPanel.setAttribute("aria-hidden", "true");
    workspace.classList.remove("detail-open");
    return;
  }
  const episodes = movie.seasons?.[0]?.episodes || [{ n: 1, title: "正片", duration: movie.runtime }];
  const selectedEpisode = episodes.find((episode) => episode.n === state.selectedEpisode) || episodes[0];
  detailPanel.innerHTML = `<div class="detail-scroll"><div class="detail-top"><span class="detail-kicker">影片详情 · 模拟</span><button class="detail-close" type="button" data-action="close-detail" aria-label="关闭详情"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div><div class="detail-hero"><div class="detail-cover"><img src="${escapeHtml(movie.cover)}" alt="《${escapeHtml(movie.title)}》封面" onerror="handleImageError(this)" /><span class="poster-fallback" hidden><span><strong>${escapeHtml(initials(movie.title))}</strong>封面暂不可用</span></span></div><div class="detail-hero-copy"><h2>${escapeHtml(movie.title)}</h2><p class="detail-original">${escapeHtml(movie.original)}</p><div class="detail-meta"><span>${escapeHtml(movie.year)}</span><span>${escapeHtml(movie.type)}</span><span>${escapeHtml(movie.runtime)}</span><span class="detail-score">★ ${escapeHtml(movie.rating)}</span></div><span class="tag blue">${escapeHtml(movie.video)}</span></div></div><div class="detail-actions"><button class="primary-button" type="button" data-action="open-player" data-id="${escapeHtml(movie.id)}"><svg aria-hidden="true" viewBox="0 0 24 24" style="width:13px;height:13px;vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"><path d="m9 6 9 6-9 6V6Z" /></svg>${movie.progress > 0 ? `继续播放 · ${movie.progress}%` : "模拟播放"}</button><button class="secondary-button" type="button" disabled title="收藏当前为只读展示">${movie.favorite ? "收藏中" : "收藏只读"}</button></div>${movie.progress > 0 ? `<div class="detail-note">本条有 ${movie.progress}% 的正数观看位置，所以出现在继续观看。这里仅展示模拟状态。</div>` : ""}<section class="detail-section"><h3>简介</h3><p class="detail-story">${escapeHtml(movie.story)}</p></section><section class="detail-section"><h3>演职员</h3><div class="cast-list">${movie.actors.map((actor) => `<button class="actor-link" type="button" data-action="open-actor" data-actor="${escapeHtml(actor)}">${escapeHtml(actor)}</button>`).join("")}</div></section><section class="detail-section"><h3>${movie.seasons ? "选集" : "播放单元"}</h3><div class="detail-list">${episodes.map((episode) => `<button class="episode-row ${episode.n === selectedEpisode.n ? "selected" : ""}" type="button" data-action="select-episode" data-episode="${episode.n}"><span class="episode-no">${String(episode.n).padStart(2, "0")}</span><strong>${escapeHtml(episode.title)}</strong><span class="episode-duration">${escapeHtml(episode.duration || "")}</span></button>`).join("")}</div></section><section class="detail-section"><h3>媒体信息</h3><div class="detail-meta"><span>${escapeHtml(movie.audio)}</span><span>${escapeHtml(movie.video)}</span></div></section></div>`;
  detailPanel.hidden = false;
  detailPanel.setAttribute("aria-hidden", "false");
  workspace.classList.add("detail-open");
}

function render() {
  renderCategories();
  renderToolbar();
  if (state.view === "library") renderLibrary();
  if (state.view === "actor") renderActorPage();
  if (state.view === "login") renderLogin();
  if (state.view === "about") renderAbout();
  if (state.view === "player") renderPlayer();
  renderDetail();
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 2400);
}

function openDetail(id, focusTarget = null) {
  state.selectedId = id;
  state.selectedEpisode = 1;
  state.detailOpen = true;
  state.returnFocus = focusTarget;
  render();
  window.requestAnimationFrame(() => detailPanel.querySelector(".detail-close")?.focus());
}

function closeDetail() {
  state.detailOpen = false;
  render();
  if (state.returnFocus && document.contains(state.returnFocus)) state.returnFocus.focus();
  else appMain.focus();
  state.returnFocus = null;
}

function openActor(name) {
  state.currentActor = name;
  state.view = "actor";
  state.category = "all";
  state.query = "";
  state.detailOpen = false;
  render();
  appMain.focus();
}

function openLogin() {
  state.view = "login";
  state.detailOpen = false;
  state.connectionOpen = false;
  render();
}

function backLibrary() {
  state.view = "library";
  state.currentActor = null;
  state.query = "";
  state.detailOpen = false;
  render();
}

function handleImageError(imageElement) {
  imageElement.classList.add("is-failed");
  const fallback = imageElement.parentElement.querySelector(".poster-fallback");
  if (fallback) fallback.hidden = false;
}

window.handleImageError = handleImageError;

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action], [data-demo]");
  if (!actionTarget) {
    if (!event.target.closest(".demo-menu") && !event.target.closest("[data-action='toggle-demo-menu']")) closeDemoMenu();
    return;
  }
  const action = actionTarget.dataset.action;
  if (action === "select-category") {
    state.view = "library"; state.category = actionTarget.dataset.category; state.currentActor = null; state.query = ""; state.detailOpen = false; render();
  }
  if (action === "open-detail") openDetail(actionTarget.dataset.id, actionTarget);
  if (action === "close-detail") closeDetail();
  if (action === "open-actor") openActor(actionTarget.dataset.actor);
  if (action === "open-actor-index") { state.view = "actor"; state.currentActor = "夏未"; state.category = "all"; state.query = ""; state.detailOpen = false; render(); }
  if (action === "open-login") openLogin();
  if (action === "back-library") backLibrary();
  if (action === "show-about") { state.view = "about"; state.detailOpen = false; render(); }
  if (action === "clear-search") { state.query = ""; render(); searchInput.focus(); }
  if (action === "toggle-search-mode") { state.searchMode = state.searchMode === "title" ? "actor" : "title"; render(); searchInput.focus(); }
  if (action === "toggle-demo-menu") {
    const nextHidden = !demoMenu.hidden; demoMenu.hidden = nextHidden; actionTarget.setAttribute("aria-expanded", String(!nextHidden));
  }
  if (action === "open-player") { state.selectedId = actionTarget.dataset.id || state.selectedId; state.view = "player"; state.detailOpen = false; render(); appMain.focus(); }
  if (action === "back-detail") { state.view = "library"; state.detailOpen = true; render(); }
  if (action === "toggle-player") { state.playerPaused = !state.playerPaused; render(); }
  if (action === "select-episode") { state.selectedEpisode = Number(actionTarget.dataset.episode); renderDetail(); }
  if (actionTarget.dataset.demo) setDemo(actionTarget.dataset.demo);
});

document.addEventListener("input", (event) => {
  if (event.target === searchInput) {
    state.query = event.target.value.trim();
    state.view = "library";
    state.currentActor = null;
    renderLibrary();
    renderToolbar();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.dataset.control === "sort") { state.sort = event.target.value; renderLibrary(); }
  if (event.target.dataset.control === "type-filter") { state.typeFilter = event.target.value; renderLibrary(); }
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchInput.focus(); searchInput.select(); }
  if (event.key === "Escape") {
    if (!demoMenu.hidden) closeDemoMenu();
    else if (state.detailOpen) closeDetail();
  }
});

function closeDemoMenu() {
  demoMenu.hidden = true;
  document.querySelector("[data-action='toggle-demo-menu']")?.setAttribute("aria-expanded", "false");
}

function setDemo(name) {
  state.demo = name;
  closeDemoMenu();
  if (name === "image-failure") {
    state.demo = "normal";
    state.category = "all";
    state.view = "library";
    state.query = "没有标题的海";
    state.searchMode = "title";
    showToast("已定位到封面失败样本");
    render();
    return;
  }
  render();
}

render();
