# 遗留路径清单（NAS / 旧播放协调器）

Status: 2026-11-14（Ticket 16 标注）。本文件只记录"哪些代码不在默认运行路径、被谁使用、能否删除、删除前要做什么"，**不删除任何文件或测试**。
Evidence: 静态引用分析（`src/**`、`tests/**`、`scripts/**`、`tsconfig*.json`、`package.json` 脚本），未运行真实 NAS 或真实媒体验收。
Related: `docs/local-library/state-machines.md` §2/§4，`docs/architecture.md`「活路径与遗留路径」。

## 1. 判定依据

默认启动路径（`src/main/main.ts`）只装配：

- `registerLocalLibraryIpcHandlers`（`local-library-ipc.ts`）
- `registerLocalPlaybackIpcHandlers`（`local-playback-ipc.ts`）
- `registerAppPreferencesIpcHandlers`（`app-preferences-ipc.ts`）

`main.ts` 不 import `ipc.ts`、`session-controller.ts`、`library-controller.ts`、`discovery.ts`、`secure-session-store.ts`，也不构造 `NasApiClient`；`NasApiClient` 的唯一构造点是 `src/main/ipc.ts`（其余为测试）。

活 renderer（`src/renderer/renderer.ts`，由 `src/renderer/index.html` 唯一的 `<script type="module" src="renderer.js">` 加载）只调用
`localLibrary`、`localPlayback`、`appPreferences`、`overlay`、`windowAction`、`onWindowMaximized` 六个命名空间。

按 AGENTS.md 的 rollback/reference 要求：本批**不删除**，只标注 `@deprecated` 并给出删除前置条件。

## 2. 清单

共 13 项。其中**无人使用**（零消费者）的有 4 项：#8 `preload.session`、#10 `preload.discovery`、#12 `preload.appearance`、#13 `src/renderer/library.ts`；其余均只被 `tests/**` 下的单测或 window-smoke 引用。

"可删"一列是当前判断（`是` / `暂不`），不是本 Ticket 的动作；本 Ticket 不删除任何东西。

| # | 模块 | 使用者 | 可删 | 删除前置条件 |
|---|---|---|---|---|
| 1 | `src/main/ipc.ts`（NAS/session/library/discovery 的 `registerIpcHandlers`） | 仅测试：`tests/player-window-smoke.ts`、`tests/nas-player-window-smoke.ts`、`tests/safe-storage-process-smoke.ts` | 暂不 | 上述 3 个 window-smoke 删除或改写；`package.json` 的 `test:player-window` / `test:nas-player-window` / `test:safe-storage-process` 同步处理；`shared/ipc-channels.ts` 的 `session:*` / `library:*` / `discovery:*` / `player:*` 通道、`shared/contracts.ts` 的 `ElectronApi.subset`、`preload.ts` 五个遗留命名空间一并移除 |
| 2 | `src/main/session-controller.ts` | 仅测试：`tests/session-controller.test.ts`、`tests/library-controller.test.ts`，以及 3 个 window-smoke | 暂不 | 上述测试迁移或删除；`shared/contracts.ts` 的 `SessionStatus`/`PublicSessionState`/`LoginInput` 与 `preload.ts` 的 `session` 命名空间一并移除；非测试调用方为 `ipc.ts`、`library-controller.ts`、`player-host.ts`（`MainPlaybackHost`）与 `secure-session-store.ts`（仅类型导入） |
| 3 | `src/main/library-controller.ts` | 仅测试：`tests/library-controller.test.ts`，以及 `tests/nas-player-window-smoke.ts`、`tests/player-window-smoke.ts`、`tests/safe-storage-process-smoke.ts` | 暂不 | 上述测试迁移或删除；依赖它的 `ipc.ts`、`preload.ts` 的 `library` 命名空间、`shared/contracts.ts` 的 `LibraryQuery`/`Collection*` 一起处理 |
| 4 | `src/main/discovery.ts` | 仅测试：`tests/discovery.test.ts`（另被已弃用的 `ipc.ts` 作为默认参数引用） | 暂不 | `tests/discovery.test.ts` 删除；`ipc.ts` 的 `discoveryStart`/`discoveryCancel` handler、`shared/contracts.ts` 的 `Discovery*` 类型与 `preload.ts` 的 `discovery` 命名空间一并移除。默认路径已改用 OS 文件选择器，无需替代实现 |
| 5 | `src/main/secure-session-store.ts` | 仅测试：`tests/secure-session-store.test.ts`、`tests/player-window-smoke.ts`、`tests/safe-storage-process-smoke.ts` | 暂不 | 上述测试删除；先确认 `test:safe-storage-process` 的覆盖不再需要（它验证 safeStorage 进程边界）；**旧加密 session 文件必须保持不动**，默认路径不读取也不清理 |
| 6 | `src/main/nas-client.ts` | 测试：`tests/nas-client.test.ts`、`tests/diagnostics.test.ts`、`tests/library.test.ts`，以及遗留模块 `ipc.ts`、`session-controller.ts`、`library-controller.ts`、`player-host.ts`（`NasError` 值导入）、`episode-identity.ts`（仅类型） | 暂不 | 上述测试与遗留模块先移除；`player-host.ts` 的 `NasError` 导入与 `episode-identity.ts` 的 `NasEpisode` 类型导入需同时处理。注意：`main.ts` → `player-host.ts` 会在启动时**加载**该模块（`NasError` 值导入），但默认路径不实例化 `NasApiClient`、不发 NAS 请求 |
| 7 | `src/main/player-host.ts` 的 `MainPlaybackHost` | 仅测试：`tests/player-window-smoke.ts`、`tests/nas-player-window-smoke.ts` | 暂不 | 两个 smoke 改用 `MainLocalPlaybackHost` 或删除；随后才能删除 `MainPlaybackHost` 及其 `PlaybackHost`/`PlaybackCommand`/`PlaybackEvent` 契约。同文件内的 `MainLocalPlaybackHost` 是活路径，**不得整体删除该文件** |
| 8 | `src/preload/preload.ts` 的 `session` 命名空间 | 无人使用（活 renderer 不调用；已弃用的 `src/renderer/library.ts` 也不用） | 暂不 | 见 #2；`preload.ts` 本身是活文件，只删命名空间及其 `IPC_CHANNELS` 项 |
| 9 | `src/preload/preload.ts` 的 `library` 命名空间 | 仅 `src/renderer/library.ts`（该文件零引用，见 #13） | 暂不 | 见 #3 + #13 |
| 10 | `src/preload/preload.ts` 的 `discovery` 命名空间 | 无人使用 | 暂不 | 见 #4 |
| 11 | `src/preload/preload.ts` 的 `player` 命名空间 | 仅 `src/renderer/library.ts`（其中只用 `player.send`，见 #13） | 暂不 | 见 #7 + #13；`player.send` 与 `player.command` 是同一通道的重复别名，删除时保留其一即可 |
| 12 | `src/preload/preload.ts` 的 `appearance` 命名空间 | 无人使用 | 暂不 | main 侧 `window.ts` 的 `applyWindowAppearance` 仍会 `send` `appearance:state`，但活 renderer 没有订阅者；删除前确认外观回退验证（`test:appearance-window`）是否需要该事件，或改为直接读窗口结果 |
| 13 | `src/renderer/library.ts` | **无人使用**：`src/renderer/index.html` 只加载 `renderer.js`（无 `library.js` 引用），全仓无模块 import 它；仅被 `tsconfig.renderer.json` 的 `include` 编译 | 暂不（可提删除建议） | 从 `tsconfig.renderer.json` 的 `include` 移除；确认 `scripts/copy-renderer-assets.mjs` 中 `library.css` 的拷贝是否仍需要（`index.html` 未 link 该 css，`styles.css` 也未 `@import` 它）；随后可删除 `library.ts`/`library.css`。零测试依赖 |

## 3. 死状态 / 死契约（与 state-machines.md §4 同源）

这三个不是"文件"，是类型契约里永远到不了的分支，记录在 `docs/local-library/state-machines.md` §4，本节只做索引：

- `SessionStatus.restoring` / `authenticating`：`contracts.ts` 声明，`session-controller.ts` 只产出 `logged-out` / `mfa-required` / `authenticated`（错误经 `error` 字段返回），`restoring`/`authenticating`/`error` 三个取值无生产者。
- `PlaybackEvent.buffering`（以及活契约 `LocalPlaybackEvent.buffering`）：`renderer.ts` 有 `buffering` 分支，但 mpv 状态投影只产出 `playing` / `paused` / `ended`，无生产者。
- `html[data-motion]` 手动三档（`full` / `reduced` / `off`）：`index.html` 静态写死 `data-motion="auto"`，`motion.ts` 读取三档但没有任何代码写入它们；实际档位来自 `matchMedia("(prefers-reduced-motion: reduce)")`。

## 4. 未决 / 冲突

- `src/main/player-host.ts` 被 Ticket 16 要求加 `@deprecated`（针对 `MainPlaybackHost`），但该文件正被并行的播放 ticket 修改，本批次按白名单**未改动**；`MainLocalPlaybackHost` 是活路径，后续给该文件加注释时必须只标注 `MainPlaybackHost` 类。
- `src/renderer/renderer.ts` 正被并行的 renderer 状态 ticket 修改，本文件对 `searchPage`、视图状态等结论只以 2026-11-14 当前代码为准。
- 所有"可删"结论都不代表本批已删除；删除动作需单独立项并重新核对引用。
