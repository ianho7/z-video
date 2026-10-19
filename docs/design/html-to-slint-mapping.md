# HTML 高保真原型到 Slint 的映射方案

状态：阶段三第 1 步已完成，映射草案和最小原生切片已落地。当前切片只覆盖已登录的片库/详情外壳；真实播放表面和 NAS 数据边界保持原实现。

来源：已确认的 `prototype/apple-minimal-ui/` 高保真原型、`docs/spec.md`、`docs/architecture.md`、ADR-0001 和 ADR-0002。

## 保留的产品关系

- 单窗口、片库和播放属于同一个应用状态。
- 详情页替换主内容区，不从右侧展开抽屉，因此片库网格不会被挤压或重新排版。
- 片库首屏包含侧边栏、工具栏、搜索/筛选、继续观看横向卡片和海报网格。
- 继续观看使用横向缩略图（约 16:9）和右侧标题、进度、时长；片库海报仍使用 2:3 比例。
- 暗色是默认外观。磨砂只属于侧边栏和工具栏等功能层，内容卡片、海报和详情内容保持实色。
- HTML 中的 URL 状态只用于原型验证；正式应用由 Rust 保存导航状态和返回上下文，不依赖浏览器历史。

## 页面和组件映射

| HTML 原型 | Slint 组件职责 | 关键状态 |
| --- | --- | --- |
| `.app-shell` | `AppWindow` 根布局 | 窗口尺寸、侧边栏可见性、当前页面 |
| `.sidebar` | `Sidebar` | 导航项、分类计数、连接状态、焦点/选中状态 |
| `.toolbar` | `Toolbar` | 页面标题、侧边栏切换、搜索输入、筛选入口 |
| `.content-scroll` | `ContentViewport` | 垂直滚动、恢复滚动位置、加载/错误占位 |
| `.continue-row` | `ContinueRail` + `ContinueCard` | 可见条目、观看进度、打开详情动作 |
| `.poster-grid` | `CollectionGrid` + `PosterCard` | 集合模型、排序后的顺序、图片状态、选中/焦点 |
| `.filter-bar` | `FilterBar` | 类型筛选、清除条件、筛选展开状态 |
| `.detail-content` | `DetailView` | 当前 Collection、Episode、播放入口、返回来源 |
| `.episode-row` | `EpisodeList` + `EpisodeRow` | Episode 选择、当前 Episode、可播放状态 |
| `.empty-state` | `EmptyState` | 查询条件、空结果原因、清除操作 |
| `.progress-track` | `ProgressBar` | 进度值、加载/未知进度状态 |

组件只负责展示和转发用户动作。网络请求、图片解码、播放协调和导航事实来源放在 Rust。

## Slint 状态模型

正式 UI 不复制浏览器 URL，而是由 Rust 持有可序列化的导航状态，并将当前快照推送给 Slint：

```text
ViewMode       = Library | Search | Detail
LibraryScope   = All | Movie | Series | Recent | Favorite | Resume
SortOrder      = Recent | Title
MediaType      = All | Movie | Series
NavigationState {
    view, scope, query, sort, media_type,
    selected_collection_id,
    source_state,
    scroll_offset
}
```

建议把上述枚举和结构定义在 Rust 的应用协调层，再通过 Slint `export global` 或根组件输入属性暴露给 UI。Slint 不负责决定鉴权、请求是否成功或播放是否可用。

### UI 事件边界

Slint → Rust 的最小动作集合：

- `navigate(scope)`、`toggle-sidebar()`、`toggle-filters()`。
- `search-submitted(query)`、`filter-changed(media_type)`、`sort-changed(sort)`。
- `collection-opened(id)`、`episode-selected(id)`、`back-requested()`。
- `play-requested(id)`、`resume-requested(id)`。
- `scroll-changed(offset)`，只在需要保存返回上下文时节流发送。

Rust → Slint 的状态集合：

- 当前页面、标题、侧边栏状态、筛选状态和返回来源。
- 已排序/筛选的 Collection、继续观看和 Episode 模型。
- 每一行的图片状态（未加载、加载中、已加载、失败）和连接/请求状态。
- 当前播放状态、缓冲状态、音轨/字幕候选及可用控制项。

回调只投递动作，不等待网络或媒体任务。异步结果通过 UI 事件循环回到 Slint，并检查请求代次或当前 Collection/Episode，过期结果直接丢弃。

## 数据模型初稿

模型字段以 `GLOSSARY.md` 的 Collection、Episode、PlaybackSession 词汇为准。字段类型和后端 JSON 的兼容解析仍由 Rust 模型层负责。

```text
CollectionRow {
    id, title, year, kind, genre,
    poster_key, poster_state,
    progress, runtime, rating,
    is_favorite, is_recent
}

EpisodeRow {
    id, collection_id, number, title,
    duration, selected, playable, progress
}

PlaybackViewState {
    collection_id, episode_id,
    position, duration, playing, buffering,
    audio_tracks, subtitle_tracks,
    can_seek, can_fullscreen
}
```

展示层需要的列表应使用 Slint model（Rust 侧保持可变模型并增量更新），不要把整个 NAS 片库复制成一份嵌套 UI 状态。后端返回的年份、评分等可为数字或字符串，统一在 Rust 解析后转换为显示字段。

## 视觉 Token 映射

HTML 的 token 进入一个 Slint `Theme` 全局，组件只引用 `Theme`，不散落十六进制颜色。具体字体和尺寸以实际 Slint 版本的系统字体能力为准。

| Token | 默认深色值 | 用途 |
| --- | --- | --- |
| `canvas` | `#101113` | 主滚动画布 |
| `surface` | `#18191C` | 卡片、详情内容 |
| `surface-subtle` | `#202125` | 悬停和次级表面 |
| `text` | `#F5F5F7` | 主标题和正文 |
| `secondary` | `#B6B7BD` | 元数据和辅助说明 |
| `separator` | `#36383E` | 分隔线和边界 |
| `accent` | `#5AA7FF` | 选中、焦点、播放、进度 |
| `success` | `#78C88D` | 连接状态 |

浅色 token 可以作为后续系统外观适配，但首个 Slint切片先固定深色，避免同时引入主题切换和业务集成两类变量。窗口缩放、键盘焦点和高对比度状态优先保证可读性。

## 图片、滚动和性能映射

1. Rust 图片任务负责按可见区域和预取窗口加载、解码和缓存；Slint 只接收已准备好的图片或失败状态。
2. 海报网格不能在首屏同步解码整个片库。具体使用的 Slint 列表/网格控件要先依据实际 Slint 版本确认是否有可用的视口虚拟化；若没有，使用分页/分批模型和严格的可见窗口。
3. 图片缓存有数量或字节上限，离开页面和超过上限的图片可释放；不把原始大图长期保存在 UI 模型中。
4. 搜索输入先在 UI 保持即时反馈，Rust 侧防抖后执行筛选或请求；新查询取消或使旧任务失效。
5. 页面切换只替换内容模型，保留侧边栏、工具栏和必要的导航状态，避免重复布局和重复请求。
6. 磨砂玻璃在 Slint 中先以半透明 `Rectangle` + 不透明回退实现。真正的背景模糊不是 CSS 的直接等价物，只有在目标渲染后端实测可用且成本可接受时再增加平台效果。

这些是实现方向，不是性能承诺；海报滚动、内存、图片解码和页面切换必须在 Windows 实际构建中记录基线后再优化。

## 播放边界

详情页中的“播放”和“继续播放”只向 Rust 播放协调器发出请求。Slint 需要接收播放表面、控制层状态和错误/缓冲状态，但不假设当前已有可用的流地址或播放器引擎。

正式实现前必须先完成两项独立证据：

- 替代客户端在官方进程和本地代理不运行时，能否从 LAN 连接取得当前 Episode 的有效流。
- 候选播放引擎能否在 Windows Slint 窗口中嵌入视频表面并支持暂停、拖动、音轨、字幕、全屏。

在这两项证据完成前，UI 只保留可替换的 `PlaybackSurface` 和状态接口，不伪造播放成功或 NAS 进度保存。

## 当前原生切片的边界

- 已登录片库和详情现在使用 `AppleWorkspace`；播放器探针仍沿用原视图，避免改变视频表面集成。
- 片库网格、分类导航、加载/空/错误状态、详情返回、选集和播放入口已经映射到现有 Rust 回调。
- “继续观看”只在 NAS 提供可关联的 Collection/Episode 历史后显示。当前列表模型没有进度字段，原生切片不填充虚构卡片，也不为展示而逐条预取详情。
- 工具栏搜索字段先保留视觉和焦点位置；真实搜索/防抖查询待 Rust 查询状态接入后启用。
- Slint 没有 CSS `backdrop-filter` 的直接等价物；当前使用半透明功能层和清晰的实色边界，未承诺背景模糊已经生效。

## 实施顺序和验收门槛

1. 先建立最小 Slint 窗口、`Theme`、`AppWindow`、侧边栏、工具栏和静态 fixture 模型，完成编译和截图。
2. 接入 Library/Search/Detail 三种页面状态及返回上下文，确认详情替换主内容而不是展开右侧面板。
3. 接入异步图片加载、失败占位、有限缓存和分批海报模型，记录 Windows 基线。
4. 在独立 LAN/流获取证据成立后接入真实 NAS 模型；所有鉴权和请求错误都映射到可理解 UI 状态。
5. 在播放器嵌入证据成立后接入 `PlaybackSurface`、控制层、进度上报和续播恢复。
6. 对照已确认 HTML 原型检查深色层级、横向继续观看卡片、详情布局、窗口缩放、加载/空/错误状态和实际滚动性能。

阶段三下一步是把真实片库数据、图片任务和播放状态逐项接入这套外壳。若 Slint 版本、图片接口或视频表面证据改变上述映射，先记录差异并回到用户确认，不擅自改变已确认的页面关系。

## 当前未知项

- 仓库已有 Cargo/Slint 项目配置；Ticket #9 候选将 `slint` 与 `slint-build` 固定到同一 git rev `0ade85bfd0a88b6de2f87f767420975f98c141d0`。列表模型、图片接口和 `poster_grid_preview` 原生快照入口已经存在，但播放器表面与真实 NAS 能力仍按 `docs/handoff.md` 的证据边界单独验收。
- 候选播放引擎、Windows 视频表面集成、硬解覆盖和音视频字幕能力尚未验证。
- 极影视独立 LAN 登录、流获取、流地址有效期和进度持久化仍按 `docs/handoff.md` 的证据边界处理。
- 磨砂背景模糊是否值得在 Slint 中实现，需要目标平台实测；默认方案是清晰的半透明功能层和不透明回退。

## 验证记录

- `cargo check`：通过；当前锁定的 Slint git compiler candidate 可编译 UI 并与 Rust 回调接口匹配。
- `git diff --check`：通过（2026-10-19，Ticket #9 closeout commit `c4cd67fff1931aa76098a59e35d788048a02ddc5`）。
- 原生窗口截图：由 `src/bin/poster_grid_preview.rs` 通过 `Window::take_snapshot()` 生成；本次 Ticket 的尺寸、缩放因子和截图路径记录在 `docs/design/evidence/ticket-07/README.md`。
