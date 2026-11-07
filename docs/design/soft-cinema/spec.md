# Soft Cinema：本地片库 UI 改版设计说明

状态：原型已确认（2026-11-07），待实现
原型画布：https://claude.ai/artifact/RCtMD2nTxrqzE9WrM2rHC2 （私有，需在 Share 菜单授权后他人可见；以第二至四行 “D2” 为准，第一行 A–D 只是探索稿）

## 1. 目标与边界

把 Electron 默认路径的 renderer 改成 “Soft Cinema” 风格：深色影院底，海报是唯一的大面积色彩；软形（饼干形、波浪、胶囊、水位）和大号圆体数字只用在控件、进度和有意义的数字上。

- 只改 `src/renderer/`（HTML/CSS/TS）和随包字体资源。**不改** IPC、preload、SQLite schema 或 `docs/local-library/contracts.md` 中的 DTO。
- 原型中需要新字段的元素不实现（见 §7）。
- renderer 仍只接收 opaque `mediaId` 和 safe DTO；生成封面、取色都在 renderer 内用已有 DTO/`dataUrl` 完成。
- 不承诺尺寸、启动时间等指标；加字体后按 `npm run package` / `verify:package` 实测记录。

## 2. 设计来源

| 来源 | 借用的东西 | 不借用 |
|---|---|---|
| 小米手环 10/11 表盘系列（作者 @叫我Brin就好，用户提供的视频） | 同色系深浅配对、饼干/波浪/胶囊形、超大圆体数字、水位与波浪进度 | 具体表盘图形；大面积高饱和铺色 |
| codex-resets.com | 早期探索，最终未采用 | 粗描边、硬投影 |

## 3. 设计变量（CSS custom properties，定义在 `:root`）

### 3.1 中性色

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#0e0e10` | 页面底 |
| `--surface` | `#19191d` | 卡片、搜索框、分段控件底 |
| `--surface-2` | `#232328` | 弹层、骨架、二级卡 |
| `--text` | `#f2eef7` | 主文字 |
| `--text-muted` | `#a29fab` | 次要文字（在 `--bg` 上对比度 ≥ 4.5:1） |
| `--text-dim` | `#5f5c66` | 已看集号、禁用态；不用于需要阅读的正文 |
| `--ghost` | `#ffffff14` | 次要按钮底 |

### 3.2 色调对（tonal pair）

每个色调有 `container`（填充）和 `on`（其上文字/图标），以及详情页头部用的 `deep`（暗底）。

| 名称 | container | on | deep |
|---|---|---|---|
| lavender（品牌/全局强调） | `#c9b8ff` | `#1b1035` | `#19191d` |
| pink | `#f6a5c0` | `#4a0f26` | `#2a1520` |
| blue | `#a9cdf5` | `#0b1d5c` | `#121c33` |
| orange | `#f4a07c` | `#3a1406` | `#2b1a10` |
| mint | `#9fe0d0` | `#0f3b33` | `#10261f` |

语义色：评分/警告 `#ffd66b` / `#3d2c00`；错误 `#ffb4ab` / `#690005`，错误卡底 `#2d1416`。

规则：
- 全局控件（导航当前项、主筛选、分页当前页、片库主按钮）用 lavender。
- 与某部影片相关的强调（继续播放、播放器暂停键、进度、当前集）用该影片的动态色（§5）。
- 一屏内同时出现的色调对不超过“动态色 + lavender + 语义色”。

### 3.3 形状

| Token | 值 | 用途 |
|---|---|---|
| `--r-pill` | `999px` | 按钮、chip、分段控件、搜索框 |
| `--r-poster` | `20px` | 海报 |
| `--r-card` | `28px` | 集数行、信息卡 |
| `--r-panel` | `36–48px` | 大卡、弹层、hero |
| 不对称圆角 | 某一角放大到 48–64px | 只用于生成封面和概况/来源卡，增加“软石头”感 |

SVG 形状（renderer 内生成 path，同一参数缓存复用）：
- **饼干形**：`r = R + a·sin(n·θ)`，用于评分徽章（R42 a6 n8）、Logo、警告/错误图标底、已看对勾底。
- **波浪线**：`y = mid + amp·sin(x/k)`，用于观看进度、扫描进度。已播放部分是波浪，未播放部分是直线（播放器）或半透明波浪（卡片）。
- **水位**：矩形 + 波浪顶边，只用于扫描进行中。

不使用：描边卡片、硬投影、渐变铺底（hero 上为保证文字可读的单向遮罩除外）、emoji。

### 3.4 字体

- 中文：系统字体栈 `"Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`。不打包 CJK 字体。
- 数字与拉丁：**Nunito**（OFL）打包为本地 woff2，`@font-face` 走 `'self'`，满足现有 CSP。随包附许可证。只用 700/800/900。
- 大号数字（集号、计数、倒计时、时间）一律 Nunito 900，`font-variant-numeric: tabular-nums` 用在会跳动的时间/计数上。

| 角色 | 规格 |
|---|---|
| 页面标题 | 36–44px / 900 |
| hero 片名 | 52–56px / 900 |
| 区块标题 | 20–22px / 900 |
| 正文 | 15px / 400–500，行高 1.7 |
| 元信息 | 12–13px Nunito 800 |
| 集号 | 40px Nunito 900 |
| hero 集号 | 64px Nunito 900 |

### 3.5 尺寸与可达性

- 可点目标 ≥ 44px；主按钮 48–52px 高。
- 所有交互元素是真实 `<button>`/`<a>`/`<input>`；图标按钮带 `aria-label`。
- 键盘焦点：`:focus-visible` 用 3px lavender outline（偏移 3px），不能只靠颜色变化。
- 区分颜色时同时区分明度（已看/未看/当前集）。
- `prefers-reduced-motion: reduce` 时关闭所有动效。

## 4. 生成封面（无海报时）

触发：`item.artwork` 不含 poster，或 poster 加载失败。

- 种子：`mediaId` 的稳定哈希（如 FNV-1a）。同一 `mediaId` 每次得到相同结果。
- 色调：从 pink/blue/orange/mint/lavender 中按种子选一个，`container` 作底、`on` 作字。
- 圆角：从 4 种（均匀 / 左上大 / 右下大 / 右上大）中按种子选。
- 主字：片名首字（去掉前导符号、`[`、数字前缀后的第一个字）；副字：年份 → 集数（`6 集`）→ 文件扩展名大写（`MP4`），按顺序取第一个可用值。扩展名只能从现有 title 或 DTO 推导，不新增字段；取不到就留空。
- 剧集（episode）缩略图同理，副字为 `E04`。

## 5. 动态取色（随海报变色）

- 时机：poster `dataUrl` 已经被现有 artwork 队列载入后，在 renderer 用 `OffscreenCanvas`（或 `<canvas>`）缩到 32×32 取样。
- 算法：取饱和度和明度都在中间段的像素，按色相分桶取主色；映射到 §3.2 最近的色调对。**只映射到预设色调对**，不直接用海报原色，保证文字对比度。
- 回退：取不到（海报太暗、灰度、过花）或无海报 → 用生成封面选中的色调；电影详情页无海报时与生成封面同色。
- 缓存：renderer 内存 `Map<mediaId, toneName>`，随页面生命周期失效，不持久化。
- 作用范围：首页 hero、详情页头部和主按钮、当前集高亮、播放器暂停键/进度/倒计时。

## 6. 页面清单与现有功能对应

| 页面 / 状态 | 原型画板 | 现有功能 / 数据 |
|---|---|---|
| 首页：顶部导航 + hero + 片架 | `Home` | 继续观看 `listContinueWatching`；最近添加 `list({sort:"added_desc"})`；剧集片架 `list({filter:"show"})`；hero 背景用 fanart `getArtwork(id,"fanart")` |
| 全部媒体 | `AllMedia` | `list` 的 query/filter/sort/sourceId/page；`item.available=false` 显示“来源离线” |
| 搜索无结果、带类型筛选 | `States` 卡 1 | 提示“当前只在「X」里搜索”，按钮“搜索全部类型”把 filter 设为 `all`、保留 query |
| 分类为空 | `States` 卡 2 | `totalCount=0` 且 filter≠all |
| 片库错误 | `States` 卡 3 | `state.status="error"`，显示 `error.code`；只给“重试” |
| 加载中 | `States` 卡 4 | 骨架卡 |
| 来源管理（独立页） | `Sources` | `sources[]`（label/available/itemCount）、`refreshSource`、`removeSource`、`chooseFolder`、`openVideo` |
| 移除确认 | `Sources` 对话框 | 替换现有 `window.confirm`，文案保留“不删除源文件” |
| 扫描进行中 / 结果 | `ScanPanel` | `onScanProgress`、`LocalScanResult.status/warnings`、`cancelScan` |
| 首次启动 | `Onboarding` | `sources.length=0` 且片库为空 |
| 剧集详情 | `Detail` | `LocalMediaDetail.episodes`、`playback`、`watched` |
| 电影详情（无海报 / 离线） | `MovieDetail` | `available=false` 时禁用播放；无 NFO 时展示 sizeBytes/modifiedAtMs/来源/进度 |
| 播放器 | `Player` | 现有 seek/play/pause/volume/mute/fullscreen；波浪进度叠在 `<input type=range>` 上，保留原 input 做交互和读屏 |
| 播放器菜单 | `PlayerMenus` | 音轨/字幕/倍速/加载外部字幕，合并成一个弹层 |
| 播完接下一集 | `PlayerEnded` | `state:"ended"` 事件 + 当前 detail 的 episodes 找下一集，10 秒倒计时，可立即播放/取消 |
| 播放器准备中 / 失败 | `States` 卡 5、6 | `loading` / `error` 事件 |

## 7. 已决定（2026-11-07）

- 做：播完自动接下一集（含播放器“下一集”按钮）。
- 做：来源管理改为独立页面，主界面去掉左侧来源栏；全部媒体页保留来源过滤 chip。
- 做：搜索无结果且开着类型筛选时，提供“搜索全部类型”。
- 不做：状态卡里的“打开诊断日志”按钮。
- 不做（需要新字段，超出本次范围）：来源卡上的“上次扫描时间”、扫描中的每来源独立进度条之外的历史统计、海报原色直出。
- 推迟：动效（hover 圆角变形、波浪流动、水位上涨动画、饼干旋转）。第一阶段只做静态外观；后续单独 ticket。

## 8. 验证

每个 ticket 按 AGENTS 顺序：`npm run typecheck` → `npm test` → `npm run test:window`；触及片库页面加 `npm run test:local-library-app`；加字体后加 `npm run package` + `npm run verify:package`；涉及外观回退加 `npm run test:appearance-window`。

- window smoke 依赖的 DOM id（`#choose-folder-button`、`#library-search-input`、`#continue-section`、`#source-list`、`#scan-status`、`#media-detail`、`#player-*`）要么保留，要么同一 ticket 内同步更新测试。
- 外观以 Windows 实机截图记录在完成说明里；macOS 外观单独标记为待验收。
