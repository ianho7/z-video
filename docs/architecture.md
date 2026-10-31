# 架构与范围

## 当前批准的本地片库默认路径（2026-10-31）

默认启动是 account-free local library，不调用 Session、NAS discovery、ZSpace SDK、NAS HTTP API 或在线 metadata。Electron main 创建一个 utilityProcess 作为 scanner/SQLite owner；main 负责 OS picker、IPC 和未来 playback path resolve；sandboxed renderer 只收到 local-library state、opaque `mediaId` 和其他 renderer-safe DTO。

```text
Folder/File picker (main)
        │ private path
        ▼
utilityProcess ── node:sqlite ── userData/local-library/library.sqlite
        │ public LocalMediaItem / LocalLibraryState
        ▼
main ── narrow preload IPC ──> sandboxed renderer
        │ mediaId only
        ▼
future local playback owner (ticket03)
```

SQLite capability is a runtime gate in the pinned Electron 45 utility process. If bundled `node:sqlite` is unavailable, startup fails with a visible storage error; no native SQLite addon is silently installed. Stable schema and IPC contracts are recorded in `docs/local-library/contracts.md`.

## 当前桌面实现（2026-10-31）

Electron 45 + TypeScript 是当前默认的 Windows 运行、构建和打包路径。当前 local-library main 持有本地数据库协调、picker 和 diagnostics；历史 Session/NAS/safeStorage/native playback 模块仍保留作 rollback 或后续 ticket owner。sandboxed renderer 只处理页面、键盘/ARIA 交互和 renderer-safe DTO；preload 通过窄 IPC bridge 连接两侧，私有文件路径不进入 renderer。

默认窗口沿用旧 AppWindow 的 preferred `1040x720`、minimum `900x640` 和可收起 `220px` 侧栏。Windows 11 22H2+ 优先使用 Electron `backgroundMaterial: "acrylic"`，对应旧 Windows DWM transient-window 材料；系统 high contrast/reduced-transparency、显式 `Z_VIDEO_REDUCED_TRANSPARENCY=1`、不支持的 OS build 或材料不可用时，回退为不透明 sidebar/toolbar。该回退已由真实 Electron 窗口验证；DWM 实际采样画面仍需在有权限的 Windows 设备上单独留证。

`npm run start`、`npm run build`、`npm run package`、`npm run verify:package` 和 `npm run measure:windows` 不依赖 Rust/Cargo。一次 Windows 测量记录在 `.scratch/electron-migration/runs/05-resources-1793418913399-24128/resource-measurement.json`；它分别记录开发依赖/cache、portable 总目录和 idle working-set，不比较不存在的 Rust release 包。旧 Slint/Rust 实现继续保留作回滚/对照；不删除全局 Rust/Cargo、旧 worktree、reference 或测试资料。

## 已确定与待验证

当前 GUI/业务实现是 Electron 45 + TypeScript；Windows/macOS 是目标平台，旧 Slint/Rust 代码只作回滚与协议参考。优先精致 GUI、原生播放、易维护和有限资源占用；不以增加语言和运行时换取尚未证明的收益。

首版采用单应用、单进程、单窗口和一个播放引擎的最小方向。它是实现起点，不是对所有平台集成能力的保证。若真实播放集成需要改变进程或渲染结构，先记录实际约束和取舍，再调整。

libmpv 是优先评估候选，不是已批准依赖。尚未决定版本、绑定库、图形后端、分发构建及许可证方案。原生播放器指原生媒体引擎与窗口交互，不要求必须使用系统解码器。

## 历史 NAS-first 范围（rollback reference）

2026-10-16 用户确认以下五项，理由见 [首版范围决策](adr/0002-first-release-scope.md)：

1. 只保证局域网访问。云端中转、远程访问和穿透后置；连接方式集中在 NAS 网络模块内处理。LAN 业务访问不等于登录必定全离线，登录是否需要云服务由实际流程确认。
2. NAS 现有极影视片库是主要事实来源，同步观看进度；不在首版建立独立扫描、匹配和索引系统。未来刮削先提供候选预览和人工确认，写回 NAS 单独设计。
3. 播放基线包含常用影片硬解、拖动、续播、选集、音轨切换、内外字幕及全屏。HDR、杜比视界和音频直通暂不承诺；支持格式以真实素材验证结果为准。硬解是目标能力，不代表所有编码、设备或异常素材都能硬解。
4. Windows 先交付，平台相关代码集中隔离；macOS 保持设计兼容，实际构建与播放验收后再宣称支持。首版不因缺少 macOS 环境而停工，也不提前完成第二平台专用实现。
5. 先个人自用验证，记录依赖及构建来源；公开分发前确定开源/闭源、签名、更新和许可证方案。个人自用不是忽略第三方许可条件的理由。

## 本地片库模块边界（Ticket 01）

`LocalLibraryDatabase` is the main-side lifecycle owner for one bounded child utility process. It owns worker request correlation, storage errors, schema initialization, opaque ID reuse and main-only path resolution. The worker is the only code that opens SQLite. `local-library-ipc.ts` validates page/mediaId inputs and never returns root or relative paths. The renderer can browse and request detail, but cannot call `node:sqlite`, `fs`, or native playback directly.

## 历史 NAS 模块边界（rollback reference）

```text
Renderer ──窄 preload IPC──> Electron main
   ^                         ├─ NAS/Session/safeStorage/cache
   │ renderer-safe DTO        ├─ Player：一个 native libmpv 引擎
   └─────────────────────────┤
                             └─ diagnostics：脱敏诊断日志

未来：应用协调 → MetadataProvider → 候选元数据 → 用户确认 → 核心保存
```

这些是职责，不要求每项一个服务或通用框架。只有刮削提供者需要为未来替换预留明确契约。renderer 不等待网络或媒体任务；main 通过 IPC 派发异步结果。

## 做减法

- 首版只接极空间，先实现登录、分类/片库、详情/剧集、播放和观看进度；回收站写操作及刮削运行时后置。
- 播放只接一个引擎，封装现有控制和状态；实际出现第二后端需求时再提炼通用接口。
- 以 NAS 为主要片库事实来源，本地先保存设置和限额缓存；离线索引需要明确用例后再引入数据库。
- 首版无需 HTTP 后台、NAS 配套服务、Web 前端、插件市场或动态语言解释器。
- 片库翻页、缩略图按需加载、过期任务取消和缓存容量控制直接服务于性能目标；避免用框架替代这些具体工作。

## 播放与鉴权边界

官方 Windows 客户端通过本地代理和 UZPlayer/VLC 已播放成功。实际看到 `/transcode/video/streams`、本地 `/splay/<opaque>/<media>` 和进度 `2/14/26` 秒。静态接口还包含 `/transcode/play` 等路径，完整响应和替代客户端的独立链路尚未验证。

开发必须明确当前传输是 LAN 直连、云端中转还是原生 SDK 本地代理。已有证据不能证明云端远程访问无需 SDK，也不能将旧会话生成的 `/splay/` 地址作为稳定链接。固定端口和设备标识仅是当次观察，不是配置默认值。

## 资源与平台判断

分别测开发工具链/构建缓存、安装体积、片库空闲/滚动内存和播放资源。数字目标尚未由用户确定，不在此虚构预算。视频解码、字幕、音轨、快进和全屏需要真实素材及硬件验证；先记录 Windows 结果，macOS 延后验收，HDR 等非首版能力不扩充当前验收范围。

## 第一项决策所需证据

在正式完成海报墙之前，解决两件会推翻架构的前提：替代客户端能否独立获取可用流，以及 Electron/native libmpv 能否组合视频画面和控制层。记录来源、版本、复现步骤、成功/失败和平台覆盖；只有结论成立后才固化播放器依赖。
