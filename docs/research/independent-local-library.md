# 独立本地片库：NFO、图片、扫描与本地续播研究

日期：2026-10-31

范围：只读核对 Kodi 与 Jellyfin 官方 NFO、影片命名和 artwork 文档，以及当前 Electron 源码。没有读取 NAS 或媒体目录，没有运行应用、扫描、播放或修改 spec/代码。整体产品方向及极影视证据边界见[本地 App 方向研究](local-app-direction.md)。

## 结论

新目标应按“免账号的本地文件片库”建模：Electron main 负责用户选定的目录、后台扫描、只读解析 NFO/图片、保存本机索引与播放进度；renderer 浏览 main 提供的安全 DTO；libmpv 播放 main 从索引解析出的文件路径。此方案不启动极空间登录、发现或影视 API，不用极影视的数据作为必要前提。

这是对产品数据源的替代提案，不只是把现有登录页绕过去。当前 `architecture.md` 和 `spec.md` 仍记录已确认的 NAS 首版范围，本报告不改写它们，也不表示替代方案已获批准。

UNC 路径只当作 Windows 文件系统路径处理：用户选择 `\\server\share\...` 后，只有当前 Windows 用户和操作系统本来就能读取该共享时，扫描和播放才有输入可用。应用不做 NAS 探测、SMB 登录或极空间 HTTP 请求。Node 的 Windows path 规则保留 UNC 前导分隔符；实际共享可读性仍取决于操作系统和共享状态，本轮未检查或连接任何共享。[Node.js `path`](https://nodejs.org/download/release/v22.17.0/docs/api/path.html)

## Kodi 与 Jellyfin 文件约定

两者均把 NFO 当成本地 XML 元数据来源，但命名和导入边界并非完全相同；建议支持它们共同使用的少量字段与常见文件名，不声称完整兼容所有版本或插件字段。

| 对象 | 官方文档事实 | 对本地 App 的最小处理建议 |
|---|---|---|
| 电影 NFO | Kodi 的 NFO 是 UTF-8 XML；电影 NFO 优先于 scraper。Kodi 推荐 `<视频文件名>.nfo`，也接受 `movie.nfo`，但后者依赖“电影各自位于同名文件夹”的 Kodi 设置。Jellyfin 使用 `movie.nfo`，也列出 DVD 的 `VIDEO_TS.nfo` 和 `<电影文件名>.nfo`。[Kodi Movies NFO](https://kodi.wiki/view/NFO_files/Movies)；[Jellyfin Local NFO](https://jellyfin.org/docs/general/server/metadata/nfo/) | 电影目录读取同名 `<视频文件名>.nfo`；同名电影文件夹内也查 `movie.nfo`。同一目录出现冲突时显示解析警告或按明确优先级取值，不静默覆盖。 |
| 剧集 NFO | Kodi 将 `tvshow.nfo` 放在剧集目录；单集 NFO 与视频同名、同目录。Kodi 从视频文件名读取季/集号，而不是从 NFO 读。Jellyfin 文档列出 `tvshow.nfo`、`season.nfo` 和 `<单集文件名>.nfo`。[Kodi TV NFO](https://kodi.wiki/view/NFO_files/TV_shows)；[Kodi Episode NFO](https://kodi.wiki/view/NFO_files/Episodes)；[Jellyfin Local NFO](https://jellyfin.org/docs/general/server/metadata/nfo/) | 支持剧集目录 `tvshow.nfo`、季目录 `season.nfo`、单集 `<文件名>.nfo`。先从 `S01E02` 或 `1x02` 这类文件名推季集，再叠加可用 NFO 字段。[Kodi episode naming](https://kodi.wiki/view/Naming_video_files/Episodes) |
| 缺少 NFO | Kodi 在没有 NFO 时才进入 scraper 或 Local Info Only 路径；Jellyfin 可使用本地 NFO 和其他 metadata provider。[Kodi NFO](https://kodi.wiki/view/NFO_files)；[Jellyfin Metadata](https://jellyfin.org/docs/general/server/metadata/) | 不接 scraper/provider；标题回退到清理后的文件名或目录名，年份只解析常见括号格式，其他字段为空，条目仍可播放。坏 XML 与“文件不存在”应分开记录。 |
| 电影/剧集目录 | Jellyfin 推荐每部电影一个独立目录；剧集按 series 目录再分 `Season 01` 等季目录。季号和 provider ID 可选。Kodi 也推荐每部电影使用独立目录以便放本地 NFO/artwork。[Jellyfin Movies](https://jellyfin.org/docs/general/server/media/movies/)；[Jellyfin TV Shows](https://jellyfin.org/docs/general/server/media/shows/)；[Kodi movie naming](https://kodi.wiki/view/Naming_video_files/Movies) | 同时接受推荐目录布局和散落视频文件；无法确定为电影或剧集时显示为“未分类”，不要猜成空库或丢弃。 |
| 多集单文件 | Jellyfin 可用 `S01E01-E02` 命名多集文件，但会作为一个条目展示多个 Episode 的元数据，并建议拆成单集文件。Kodi 当前 Episode NFO 文档说明 v22 起可为多集文件的每一集提供单独 NFO/art，名称含 `-SxxEyy` 后缀；这是带版本边界的复杂格式。[Jellyfin TV Shows](https://jellyfin.org/docs/general/server/media/shows/)；[Kodi Episode NFO](https://kodi.wiki/view/NFO_files/Episodes) | 初版以“一个视频文件 = 一个可播放项/进度身份”；识别简单范围时可显示范围文本，但不拆成可分别续播的虚构文件。Kodi v22 的多 NFO/art 变体后置。 |
| 多版本 | Jellyfin 以严格命名识别同一电影目录内的多个版本：文件必须以目录基名逐字匹配，后接分隔符和版本名；集数版本按同一季目录、同一季集编号识别。[Jellyfin Multiple Versions](https://jellyfin.org/docs/general/server/media/shows/) | 仅对完全匹配规则的文件分组，并把各真实文件保留为可选版本；未匹配或命名不一致的文件各自展示，避免误合并。多版本共享元数据、单文件分别存续播位置。 |
| 海报/背景/单集图 | Jellyfin 支持相邻的外部图片，并在有外部图片时优先于其他来源；电影/剧集示例含 `cover`、`backdrop`，单集可有 `<剧集文件名>-thumb.jpg`。NFO 图片路径也有优先权，Jellyfin 每种 artwork 只用一个 NFO `thumb`。[Jellyfin Movies / Metadata Images](https://jellyfin.org/docs/general/server/media/movies/)；[Jellyfin Local NFO](https://jellyfin.org/docs/general/server/metadata/nfo/) | 初版只查有限白名单：`poster`、`folder`、`cover`、`movie`、`show`、`fanart`、`backdrop`，以及单集 `-thumb`；缺图显示占位图，不逐个视频抽帧。 |
| Kodi artwork 名称 | Kodi 电影 artwork 通常与媒体放一起；长名为 `<视频文件名>-<arttype>.<ext>`，也有短名 `<arttype>.<ext>`。海报常用 `poster`、背景常用 `fanart`；Kodi TV/Season/Episode 还可有对应 poster、fanart、thumb。[Kodi Movie artwork](https://kodi.wiki/view/Movie_artwork)；[Kodi Artwork types](https://kodi.wiki/view/Artwork_types) | 解析长名与有限短名；先给 NFO 明确指向的本地图片，再给逐项命名图片，再给所在目录的默认封面。该优先级是本 App 的建议，不是两个产品统一规定。 |

建议 NFO 初版只读 `title/name`、`originaltitle`、`year/premiered`、`plot/overview`、`genre`、`runtime`、`uniqueid`、`director`、`credits`、`actor` 等核心字段；缺字段允许留空。Kodi 电影 NFO 还定义了 `<resume>` 秒数，Jellyfin NFO 涉及 watched/playcount 等用户数据，但不同产品的用户数据归属和写回语义不一致。[Kodi Movies NFO](https://kodi.wiki/view/NFO_files/Movies)；[Kodi Episode NFO](https://kodi.wiki/view/NFO_files/Episodes)；[Jellyfin Local NFO](https://jellyfin.org/docs/general/server/metadata/nfo/)。建议首版不把这些标签当作本机播放进度来源，也不写回或改动 NFO；本 App 的进度由自己的本机存储负责。

NFO 和媒体文件应视为不可信输入。实现上建议仅解析受支持 XML 标签；NFO 引用图片只解析 root 内的相对路径，不访问 URL，也不允许路径逃出选定目录。这样保留离线行为并避免读取用户目录之外的文件。此为安全实现建议，不是 Kodi/Jellyfin 文档要求。

## 最小本地架构

```text
用户选目录
    ↓
Electron main：异步扫描 → NFO/本地图解析 → 本机索引与进度存储
    ↓ renderer-safe DTO（mediaId、标题、年份、图片 key、季集、进度）
Renderer：片库 / 详情 / 续播
    ↓ 播放 mediaId
Electron main：从索引取路径 → 现有 libmpv 播放 → 本机续播保存
```

1. **入口与扫描：** 启动后不恢复登录、不等待 NAS；用户添加一个目录并手动扫描/刷新。递归读取常见视频扩展名，异步分批枚举；遇到权限、断线或坏目录时报告该目录错误并继续。Node `fs` 提供异步目录读取 API，适合放在 main 的后台任务；具体扫描性能和共享断线行为仍需实现后验证。[Node.js `fs`](https://nodejs.org/api/fs.html)
2. **本地索引：** 在 Electron `userData` 下维护一份本地索引，最小记录为 root、规范化相对路径、文件大小/修改时间、媒体类型、解析后的元数据和 artwork 相对路径；另存每个可播放文件的进度与更新时间。文件 ID 由 main 管理，renderer 只持有不透明 ID。一个本地数据库适合增量更新和按页浏览；仓库当前依赖没有 SQLite 或 XML parser，具体存储/解析依赖尚未选择。
3. **扫描更新：** 初版用用户显式“重新扫描”，不接文件 watcher、不递归读取媒体内容、不为建索引而调用 FFmpeg。只有一次完整成功的目录遍历后才清理索引中的消失项；共享离线或局部扫描失败时保留旧索引并标为不可达，避免把网络故障变成“已删除”。这是建议行为。
4. **剧集与版本：** 用目录层级和常见季集编号建立电影/剧集/Season/Episode 视图；对 Jellyfin 风格的严格相同主名与版本后缀做分组。多集单文件显示为一个播放项；拆分、跨文件合并和任意手工匹配后置。
5. **本机续播：** 本机数据库按文件 ID 存位置、时长和更新时间；用播放器位置事件定期写入，并在暂停、切换文件、正常退出时 flush。初版仅当前 Windows 用户/本机可用，不与 NAS 或其他设备同步。文件路径和媒体 URI 留在 main，不传给 renderer；应用不接收或保存 SMB 凭据。

### 与当前 Electron 的复用边界

- **可复用：** `MainPlaybackHost.chooseLocalFile()` 已用 main 进程原生对话框选单个视频；`PlaybackCoordinator.openLocal()` 已绕过 NAS target 解析并启动本地路径；`MpvNativePlayer.start()` 接收路径并检查本地文件存在；现有 libmpv 播放控制和 renderer 播放事件也可继续用。[`player-host.ts`](../../src/main/player-host.ts#L61)；[`player.ts`](../../src/main/player.ts#L92)；[`mpv-player.ts`](../../src/main/mpv-player.ts#L99)
- **明确未实现：** `openLocal()` 把 `local` 设为 `true`，`enableProgress()` 对本地播放直接返回，因此当前没有本地进度持久化；它只是“打开单个文件并播放”。[`player.ts`](../../src/main/player.ts#L92)；[`player.ts`](../../src/main/player.ts#L379)
- **需要换掉/适配：** 当前 `main.ts` 无条件创建 `NasApiClient`、`SessionController`、`LibraryController`；`ipc.ts` 的分类、片库、详情、续播和图片 handler 都走这些 NAS 会话/接口；renderer 的登录状态和列表模型也仍围绕分类、Collection、Episode。页面样式、分页/卡片/详情布局和播放器控件可复用，数据 API/类型与启动流程不能直接当成本地库服务。[`main.ts`](../../src/main/main.ts#L38)；[`ipc.ts`](../../src/main/ipc.ts#L32)；[`contracts.ts`](../../src/shared/contracts.ts#L31)；[`library.ts`](../../src/renderer/library.ts#L1)
- **平台边界：** `MpvNativePlayer.start()` 当前明确只允许 Windows；本地库扫描和保存本身不证明 macOS 播放已支持。[`mpv-player.ts`](../../src/main/mpv-player.ts#L99)

## 最小可交付范围与后置项

**首个可用切片：** 无登录启动；添加/移除本地目录；手动递归扫描；识别常见电影、`SxxExx`/`NxM` 单集、Kodi/Jellyfin 常见 NFO 与海报命名；缺 NFO/图时仍显示并可播放；严格规则下列出版本；本机保存单文件续播；main-only 路径与本机存储。UNC 仅当 Windows 当前用户可读时工作。

**后置：** 在线刮削/第三方 metadata provider、跨设备同步、向 NFO 写回、全量 Kodi/Jellyfin XML 兼容、Kodi v22 多集分项图片与 NFO、复杂多部分文件自动连播/拼接、任意版本自动匹配、用户手工合并、自动监控目录、Linux/macOS 播放验收、所有编码/硬解承诺。

## 事实、推断与未知

| 项目 | 分类 | 依据/限制 |
|---|---|---|
| Kodi/Jellyfin 公开了本地 NFO、命名和图片约定，但细节存在差异 | 官方文档事实 | 上表链接的 Kodi Wiki 与 Jellyfin 官方文档；不等于它们的 NFO schema 完全相同。 |
| 当前 Electron 已有本地单文件播放路径，且本地进度被关闭 | 当前仓库事实 | `player-host.ts`、`player.ts`、`mpv-player.ts`。只覆盖当前源码，不是运行验收。 |
| 当前 App 依赖 NAS 登录/片库 API 才有其列表和详情数据 | 当前仓库事实 | `main.ts` 与 `ipc.ts` 的服务创建和 handler。 |
| main 扫描文件并将本地数据库作为影片事实来源，是免 API 片库的最小实现方向 | 架构推断/建议 | 不是已有功能；数据库和 XML parser 选择还未验证或批准。 |
| 用户媒体的实际目录结构、NFO 完整率、图片命名、单集与版本数量 | 未知 | 本轮没有打开或扫描任何本地/NAS 媒体目录。 |
| 当前 Windows 是否能读某个 UNC、媒体能否顺畅播放、索引规模与扫描耗时 | 未知 | 没有连接 share、播放素材或测量性能。 |
| 首版是否继续 Windows 优先、是否启用 Kodi v22 多集规则、具体支持扩展名 | 待产品决策 | 本报告只提出最小范围，不更改已确认的 spec。 |

## 官方来源

- [Kodi NFO files](https://kodi.wiki/view/NFO_files)、[Movies](https://kodi.wiki/view/NFO_files/Movies)、[TV shows](https://kodi.wiki/view/NFO_files/TV_shows)、[Episodes](https://kodi.wiki/view/NFO_files/Episodes)
- [Kodi Movie artwork](https://kodi.wiki/view/Movie_artwork)、[Artwork types](https://kodi.wiki/view/Artwork_types)、[Movie naming](https://kodi.wiki/view/Naming_video_files/Movies)、[Episode naming](https://kodi.wiki/view/Naming_video_files/Episodes)
- [Jellyfin Local .nfo metadata](https://jellyfin.org/docs/general/server/metadata/nfo/)、[Movies](https://jellyfin.org/docs/general/server/media/movies/)、[TV Shows](https://jellyfin.org/docs/general/server/media/shows/)
- [Node.js `fs`](https://nodejs.org/api/fs.html)、[Node.js v22 `path`](https://nodejs.org/download/release/v22.17.0/docs/api/path.html)
