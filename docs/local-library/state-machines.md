# 隐式状态机清单（Implicit State Machines）

Status: 2026-11-14 审计完成，决策已确认，实施见 `tickets/06`–`tickets/15`。
Scope: `src/main`、`src/renderer`、`src/shared`、`src/preload` 全量静态分析；未运行真实媒体/NAS 验收。

本文件记录三件事：

1. 哪些行为实际上是状态机、状态存在哪里；
2. 已确认的危险组合（可达但无意义的组合状态）；
3. 每处的处理决策与对应 Ticket。

判定标准：没有显式 FSM 定义，而由「多个布尔 + 可空字段 + 字符串枚举 + 时序守卫（generation/epoch/token）」组合表达，且组合空间大于真实状态数。

全仓唯一的显式 FSM 是详情视图的 `detail.dataset.state`（`src/renderer/renderer.ts`，`loading|ready|error`）。其余 36 处均为隐式。

## 1. 总表

| # | 状态机 | 状态载体 | 真实状态数 | 决策 | Ticket |
|---|---|---|---|---|---|
| 1 | 扫描作业生命周期 | `activeScan` + 取消 token + `profileStatus` | 6 | 收敛为显式阶段并补终局检查 | 07 |
| 2 | 来源可用性 | `sources.available`（单布尔） | 5→3 塌缩 | 拆 `degraded` | 08 |
| 3 | 扫描运行记录 | `scan_runs.completed/completed_at/error` | 4→2 塌缩 | 加读取与启动修复 | 07 |
| 4 | 文件身份 / 墓碑 | `media_files.available` + 4 元组唯一键 | 2 | 列表隔离墓碑 | 11 |
| 5 | 集合身份 | `identity_key` + `preferredCollectionId` | 3 | import 不复用最小元数据覆盖 | 07 |
| 6 | 观看会话 | `ended_at IS NULL` + `finished/playingSinceMs` | 7 | 账本口径统一 | 10 |
| 7 | 清理标记 | `cleanup_state` + `cleanup_until` | 4 | `keep` 改终态 | 14 |
| 8 | worker / 库生命周期 | `worker` + `closing` + `state.status` | 6 | 崩溃态与重启 | 13 |
| 9 | 封面缓存条目 | `initialized/memory/pending/activeReads` | 6 | 初始化可失败重试 + 按 key 去重 | 13 |
| 10 | NFO 缓存条目 | 正缓存 / 负缓存 / stale | 4 | 维持（负缓存行为已可接受） | — |
| 11 | 原生播放会话 | `handle/api/host/timers/onEvent` | 7 | 归入播放终态收敛 | 06 |
| 12 | mpv 状态投影 | `lastState` + 3 个 mpv 属性 | 5（`buffering` 不可达） | 加 `loaded` 门，修伪 ended | 06 |
| 13 | 本地播放协调器会话 | `generation` + `active` + 5 布尔 | 9 | 终态单一出口 + failed 收敛 | 06 |
| 14 | 进度持久化 | `observedPosition` + 2 指纹 + 队列 | 5 | close 等待落盘、ended 无 position 兜底 | 06 |
| 15 | 观看账本会话 | `ledger.session` + `finished` | 4 | 与 playback_state 同源 | 10 |
| 16 | 轨道偏好 | `trackPreferencesApplied` + `subtitleTrackId` 三态 | 2 × 3 | latch 修正 + `off` 哨兵 | 09 |
| 17 | overlay 可见性/穿透 | `overlay` 可空 + 双端 `visible/ignore` | 5 | 二次显示补推送、error 纳入 changed | 06 |
| 18 | 外部字幕加载 | 无载体（纯 promise 流） | 5 | 维持（失败已有 control-error） | — |
| 19 | 视图路由 | 6 个 `hidden` + 2 布尔（实测 70 处写入 / 71 个测试断言点） | base 4 + 图层 3 | baseView + 图层栈，非单一枚举 | 15 |
| 20 | 片库列表三态 | `libraryLoadedOnce` + `aria-busy` + empty + pageError | 6 | 丢弃路径统一清理 | 15 |
| 21 | 详情三态 | `detail.dataset.state` | 6 | 补 `re-opening` | 15 |
| 22 | 搜索 | `searchActive` + `searchPage`（死字段） | 5 | 接分页 | 12 |
| 23 | 播放器镜像 | `playerState` + ended 面板 + `nextTimer` + origin | 8 | 关闭复位 + 超时兜底 | 06 |
| 24 | 浮层镜像 | `initialized/revision/timer/dragging` | 5 | 同 17 | 06 |
| 25 | 全屏 | 3 份副本（renderer/overlay/main） | 2 × 3 | 维持（失败回滚已在 06 覆盖） | 06 |
| 26 | 音轨/字幕/速度/音量乐观态 | 数组 `selected` + `playerMuteCommandValue` + 拖拽标志 | 3 + 3 + 3 | 失败回滚对齐 | 09 |
| 27 | 扫描进度 UI | `scanId/scanProgress/scanCommit/sourceBusy` | 8 | 终态收起 + 结果卡 | 08 |
| 28 | 整理 / 检查模式 | `cleanupVisible/reviewTarget/reviewBusy` | 6 + 5 | 错误分支清 reviewTarget | 14 |
| 29 | 来源对话框 | `removingSourceId/offlineSourceId/sourceDialogBusy` | 4 × 2 | 维持（重入保护已存在） | — |
| 30 | 动效模式 | `html[data-motion]` + `matchMedia` | 5（3 档不可达） | 维持（文档标注） | — |
| 31 | 封面加载 | `dataset.artwork*` + 队列 + generation | 5 | 卡片复用路径补清理 | 15 |
| 32 | 列表菜单 | `opened/focusIndex/activeListbox` | 3 | 维持 | — |
| 33 | 会话状态（遗留） | `session/pendingLogin/rememberSession/generation` | 6（2 个不可达） | 标 deprecated | 16 |
| 34 | 片库控制器（遗留） | `navigationGeneration/continueGeneration/activeSessionKey` | 4 | 标 deprecated | 16 |
| 35 | 发现请求代际（遗留） | `nextRequestId` + `active` + `AbortSignal` | 2 × 4 | 标 deprecated | 16 |
| 36 | NAS 播放协调器（遗留） | `generation/activeEpisodeId/active` + 3 布尔 | 8 | 标 deprecated | 16 |
| 37 | 窗口外观回退 | `nativeBackdrop/reducedTransparency/highContrast` | 4 | 维持（catch 改写语义，记录） | — |
| 38 | 自动变化校验调度 | main: `checking/activeScans/pendingTrigger/autoScanning` + 持久 baseline；renderer: `refreshCheckInFlight/refreshCheckQueued/pendingRefreshResult` | 5（idle/checking/scanning/queued/silent-result） | 维持：main 单一队列 + 单一结果推送，renderer 只有一个"等库可见再应用"入口 | 23b |

## 2. 活路径与遗留路径

`src/main/main.ts` 只装配 local-library + local playback。renderer 实际调用的 IPC 命名空间为
`localLibrary` / `localPlayback` / `appPreferences` / `overlay` / `windowAction` / `onWindowMaximized`。

因此以下模块**不在默认运行路径**上，只被 `tests/*-window-smoke.ts` 使用：

- `src/main/ipc.ts`、`src/main/session-controller.ts`、`src/main/library-controller.ts`、`src/main/discovery.ts`、`src/main/secure-session-store.ts`、`src/main/nas-client.ts`
- `src/main/player-host.ts` 的 `MainPlaybackHost`
- `src/preload/preload.ts` 的 `session` / `library` / `discovery` / `player` / `appearance` 命名空间
- `src/renderer/library.ts`（未被 `src/renderer/index.html` 引用，但仍被 `tsconfig.renderer.json` 编译）

按 AGENTS.md 的 rollback/reference 要求，本批**不删除**，只在 Ticket 16 标注 deprecated 并列出清单。

## 3. 已确认的危险组合（按风险）

### P0

1. **播放器 `closed` 事件丢失 → 视图卡死**。`LocalPlaybackCoordinator.close()` 在 `await flushProgress` 让出后依赖 `generation` 判定是否发 `closed`；双击关闭时第二次调用取走 `mediaId`、第一次因 generation 变化早退，两次都不发事件。`handleNativeClosed` 的 `await` 窗口内用户关闭同理。renderer 唯一退出播放器视图的入口是 `closed`，因此视图与 `appShell.hidden` 会永久错位。Ticket 06。
2. **单文件索引失败被当作"文件已删除"**。`scanDirectory` 中 `upsertMedia` 抛错只 push 警告，不把该文件放入 `seenRelativePaths`；遍历仍返回成功，随后对账把该行标 `available=0` 并 `clearMissingViewingRecords` 删除观看历史。一次 NFO 解析异常或 SQLITE_BUSY 即永久丢账本。Ticket 07。
3. **`partial` 把整个来源判为离线**。子目录不可读时 `sources.available=0`，该来源全部条目不可播，清理队列因 `WHERE ... sources.available = 1` 整体清空。Ticket 08。
4. **`importVideo` 抹掉 NFO 元数据**。import 构造最小 metadata（`kind="movie"`、无 plot/rating/year/premiered），`upsertCollection` 对已存在集合无条件 UPDATE 全部列并用 `?? null`，导致对已索引剧集执行"打开视频"会清空 NFO 派生字段。Ticket 07。
5. **字幕偏好静默丢失**。`trackPreferencesApplied` 在检查事件内容之前置位，空 `tracks` 事件即消费 latch；同一事件内 `updateSelectedTracks` 又用默认轨覆盖。另外 `null`（显式关闭）与 `undefined` 写库后都成 NULL，读回一律省略字段。Ticket 09。
6. **pre-load 期伪 `ended`**。`stateTimer` 在 `loadfile` 后立即启动，`idle-active=yes` 在文件加载完成前成立，投影为 `ended` → `watched=true` 并触发 renderer 的 10 秒自动跳集。Ticket 06。

### P1

7. **worker 崩溃后仍报 ready**，且无重启路径；`exit code 0` 的非正常退出不 reject pending，`call()` 无超时。Ticket 13。
8. **墓碑进入列表 + 集数虚增**：`list()` 无 `available` 过滤；`episodeCount` 用 `COUNT(*)` 而 `availableEpisodeCount` 才过滤。Ticket 11。
9. **failed 态不清理 `active`、`handle()` 无守卫**：加载失败后每条控制命令都报 `control-error`，且仍会收到 `ready`/`position`。Ticket 06。
10. **`requestEpoch` 跨域共享**：片库页、搜索、详情共用一个计数器，互相作废在途请求，且丢弃路径不清理 `aria-busy`。Ticket 15。
11. **`scan_runs` 写-only**：有 in-flight 标记但全仓无读取，启动不修复。Ticket 07。
12. **搜索只显示前 24 条**：`searchPage` 只被赋 1，却作为页码传给 IPC；文案显示服务端总数。Ticket 12。

### P2

13. **`renderState` 错误分支单向隐藏**：隐藏 onboarding/hero/continue/recent/shows 后无恢复路径。
14. **`keep` 非终态**：`keepDays` 后静默回到候选队列，与文案相反。
15. **重复计完成**：`endedObserved` 粘滞，重播后再关闭仍报 `ended`；加载失败按恢复位置参与 `isCompletedWatch`。
16. **视图路由无单一来源**：`data-view` 是静态属性，真实视图由 6 个 `hidden` + 2 布尔推导。2026-11-14 实测：14 个导航函数内有 70 处可见性写入，测试有 71 个断言点依赖；且视图是**层叠**而非互斥（`showCleanup`/`openDetail` 都不卸载 `libraryContent`，复查播放时整理层与播放器可同时可见）。因此收敛目标修正为 `baseView` + 图层栈，而不是单一枚举。

## 4. 死状态与死契约（记录，不单独开 Ticket）

- `PlaybackEvent` 的 `buffering`：契约与 renderer 都实现，但 mpv 投影永不产出（`syncState` 只有 playing/paused/ended）。
- `SessionStatus` 的 `restoring` / `authenticating` / `error`：类型声明存在，`SessionController` 从不产出（只产 `logged-out` / `authenticated` / `mfa-required`）。
- `searchPage`：只被赋 `1`。
- `html[data-motion]` 的 `manual-full/reduced/off` 三档：没有代码写入 `data-motion`。
- `scan_runs`：写-only。
- `preload.ts` 的五个命名空间与 `src/renderer/library.ts`：不在活路径（Ticket 16 标 deprecated）。
- `SessionStatus.error`：与 `restoring`/`authenticating` 同类无生产者；`session-controller.ts` 只返回 `logged-out` / `mfa-required` / `authenticated`，错误经 `state.error` 字段返回。
- `LocalPlaybackEvent` 的 `buffering`：活契约同样无生产者，mpv 状态投影只产出 `playing` / `paused` / `ended`；`renderer.ts` 的 `buffering` 分支只能由 `loading` 事件里的本地赋值进入，事件本身不可达。
- `appearance:state`：main 的 `applyWindowAppearance`（`window.ts`）仍会发送，但活 renderer 无订阅者；唯一暴露入口是 deprecated 的 `preload.appearance.onState`（Ticket 16 标注）。
- `player.send`：`preload.ts` 中与 `player.command` 同通道的重复别名，只被 deprecated 的 `src/renderer/library.ts` 使用。
- preload 遗留命名空间的实际消费者：`library` / `player` 仅 `src/renderer/library.ts`；`session` / `discovery` / `appearance` 零消费者。
- `html[data-motion]` 补充证据：`index.html` 的静态值是 `data-motion="auto"`；`motion.ts` 虽识别 `full|reduced|off`，但全仓没有写入这三档的代码，实际档位始终由 `matchMedia("(prefers-reduced-motion: reduce)")` 决定。

## 5. 决策记录（2026-11-14 用户确认）

| 决策点 | 结论 |
|---|---|
| 批次范围 | 两个 P0 bug 与语义决策一起改 |
| 子目录不可读 | 拆 `degraded`：只有根目录不可读才算 offline |
| `keep` 语义 | 改为终态，永不再进候选队列 |
| 字幕关闭持久化 | DB 存 `"off"` 哨兵，DTO 仍为 `null`，不升 schema |
| 看完后重播 | 视为新观看尝试，清 `watched`/`endedObserved`，不重复计完成 |
| 搜索截断 | 接分页，复用现有分页控件 |
| 扫描结束后面板 | 收起；首页保留"上次扫描"结果卡 |
| 失效文件行 | 列表隐藏墓碑，`episodeCount` 改可用口径 |
| 测试断言 | 可以修改，逐条在完成记录中报备旧/新断言与理由 |
| 遗留代码 | 先列清单，标 deprecated，不删除 |
| 交付形式 | 文档 + 分批改代码 + Ticket |

## 6. 验证边界

- 可执行：`npm run typecheck`、`npm test`、`npm run test:local-library`。
- 需 GUI 权限或真实媒体：`test:window`、`test:local-library-app`、`test:player-window`、真实播放/DWM 采样。
- 本审计为纯静态分析，所有竞态结论为代码路径推导；Ticket 完成后必须区分"单测/冒烟已证"与"待真实窗口验证"。
