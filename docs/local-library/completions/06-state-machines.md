# 状态机修复批次完成记录（Ticket 06–14、16）

Date: 2026-11-14
Scope: `docs/local-library/state-machines.md` 列出的 P0/P1 项；Ticket 15（renderer 状态收敛）未开始。
执行方式：4 条并行通道，按文件所有权切分，不使用分支/worktree；子代理只允许 `--noEmit`，构建与测试由集成侧独占。

## 已交付

| Ticket | 结果 |
|---|---|
| 06 playback-terminal | `LocalPlaybackCoordinator.terminate()` 单一出口，`closed` 每会话恰好一次且不受 `generation` 影响；failed 会话只透出 `closed`、控制命令早退；`mpvProjectedState()` 加 `loaded` 门，预加载期不再投影 `ended`；close 等待同指纹落盘；renderer 加 1.5s 关闭兜底、幂等拆卸、会话字段复位；overlay `error` 纳入 `changed`、二次显示补推完整 state |
| 07 scan-index-safety | 索引失败文件进入 `seenRelativePaths`，对账不再置 `available=0`、不再删除账本；取消终局窗口用 `cancellation.terminal` 使 `cancel-scan` 返回 `false`；`importVideo` 复用扫描单飞守卫并只补空字段（不覆盖 NFO 元数据）；`scan_runs` 启动标 interrupted；对账改 TEMP 表，消除变量上限 |
| 08 source-degraded | schema v4 `sources.degraded`；根不可读=offline，遍历不完整=degraded（可播）；清理队列不再因 partial 清空；扫描面板终态收起，首页保留“上次扫描”结果卡 |
| 09 playback-preferences | 轨道偏好 latch 只在“非空轨道且已下发”后置位，缺失轨道保留偏好；同事件不再被默认轨覆盖；字幕 `null` 以 `"off"` 哨兵持久化，DTO 不变；renderer 对速度/音轨/字幕命令失败做回滚 |
| 10 viewing-accounting | 重播=新观看尝试（清 `watched`/`endedObserved`，不重复计完成）；`error` 永不完成，resume 位置不构成完成；ended 无 position 时用 duration 落盘；`begin()` 先结算旧会话；`sessionCompletes()` 单一判定被三处共用 |
| 11 library-list-visibility | `list()`/`listCollections()`/`getDetail()` 只认可用文件；`episodeCount` 与 `availableEpisodeCount` 同口径；墓碑 mediaId 返回 undefined |
| 12 search-pagination | `searchPage` 生效，复用分页控件（`search-pagination-*`）；`countLabel()` 统一计数文案；`closeDetail` 不再留下“可见但未加载”的搜索页 |
| 13 worker-lifecycle | worker 崩溃（含 exit 0）置 error 并 reject pending；`ensureWorker()` 单次受控重启；`call()` 超时；封面缓存初始化可重试、按 key 去重、磁盘命中 touch |
| 14 cleanup-keep-terminal | `keep` 终态（忽略 `cleanup_until`，旧数据同样立即终态）；`keepDays` 设置项隐藏但保留值；`renderState` 错误分支清 `reviewTarget`；`cleanupBusy`/`reviewBusy` 合并 |
| 16 legacy-deprecation | `docs/local-library/legacy-paths.md` 13 项清单；遗留模块文件头 `@deprecated`（含 `MainPlaybackHost`）；`architecture.md` 增“活路径与遗留路径” |

## 断言变更（逐条）

| 文件 | 旧 → 新 | 理由 |
|---|---|---|
| `tests/local-library-contract.test.ts` | `SCHEMA_VERSION 3` → `4` | v4 新增 `sources.degraded` |
| `tests/local-library-database-smoke.ts` | `schemaVersion`/`user_version` 3 → 4（多处） | 同上 |
| 同上 | partial 来源 `available=false` → `available=true` 且新增 `degraded=true`、条目仍可播、清理候选仍在队列 | Ticket 08 拆分 degraded |
| 同上 | `keep` 的 `cleanupUntilMs > now+179d` → `=== undefined` | Ticket 14 keep 终态不写 deadline |
| 同上 | 迁移用例标题 “v3 migration creates both ledger tables” → “the v3 step of the migration …” | 迁移目标改为 v4 |
| `tests/cleanup-contracts.test.ts` | `effectiveCleanupState("keep", 过期)` `"none"` → `"keep"`，用例名改写 | keep 终态 |
| `tests/local-playback.test.ts` | “missing persisted track IDs are ignored…” → “saved track preferences that this file does not offer are kept…”；期望 `undefined` → 原值 | Ticket 09 保留缺失偏好 |
| 同上 | `FakeViewingLedger.finish` 形参 `number` → `number \| undefined` | 账本需区分“观测位置”与 resume 位置 |
| 同上 | `MemoryPlaybackStore.savePlayback` 改 async + 可选 `saveGate` | 用于断言 close 等待落盘 |
| `tests/local-library-app-smoke.ts` | 状态筛选标签 `"保留"` → `"已保留"`；整理提示 `/已标记保留/` → `/已保留/` | Ticket 14 文案与 `CLEANUP_STATE_LABELS` |
| `tests/window-smoke.ts` | 无期望翻转，仅新增（扫描面板收起、结果卡、degraded 来源、关闭兜底）并给两处旧断言补说明 | 结果卡与摘要提示互斥，旧断言仍成立 |

## 非 Ticket 范围内的修复

- **清理队列同尺寸排序**：`deleteEntries.sort` 与 `compareCleanupRows` 原以随机 `mediaId`（`crypto.randomUUID`）作 tie-break，导致删除清单顺序每次运行 50/50 翻转（`local-library-database-smoke` 因此在集成时失败）。改为按标题、再兜底 `mediaId`，断言不变。
- `docs/local-library/execution.md` 追加本批次波次与 DAG。

## 证据

环境注意：本机 shell 默认 `ELECTRON_RUN_AS_NODE=1`，会让 `electron.exe` 退化为 Node 并拒绝 `--disable-gpu`；所有 Electron 冒烟前需 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | PASS（`tsconfig.json` + `tsconfig.renderer.json`） |
| `npm test` | PASS 124/124（真实 `dist/`） |
| `npm run test:local-library`（DB 冒烟） | PASS；首次失败为上述 flaky 排序，修复后重跑通过 |
| `npm run test:local-artwork-cache` | PASS 4/4 |
| `npm run test:local-library-scale` | PASS：2,000/20,000 索引、扫描中并发 list、来源删除后保留不可用行 |
| `npm run test:window` | PASS（含扫描结果卡、degraded 来源、关闭兜底新增断言） |
| `npm run test:local-library-app` | PASS（整窗片库、整理、检查流程） |
| `git diff --check` | PASS |

## 未验证

- 未运行：`test:player-window`、`test:player-overlay-window`、`test:appearance-window`、`test:safe-storage-process`、`test:local-playback-resume`。因此 overlay 的“二次显示补推”“error 纳入 changed”、`loaded` 门在真实 libmpv 下的行为、真实媒体续播均只有代码路径与单测证据。
- 未做真实 NAS、真实私有 share、DWM 采样、macOS 验收。
- 未打包验证（`npm run package` / `verify:package`）。

## 遗留与后续

- **Ticket 15 未开始**：视图路由单一来源、`requestEpoch` 拆分、`renderState` 恢复派生、详情 `re-opening`、卡片复用清理、扫描刷新队列消费。
- `resolvePath`/`resolveArtwork` 仍可解析已墓碑的 `mediaId`（陈旧 ID 可能打开替换后的新文件）。
- 指纹变化时 `importVideo` 仍会新建作品并把旧行置墓碑（本次只修同指纹导入）。
- 扫描中途根目录失联仍报 `partial`/degraded，而非 `unavailable`。
- 仅由 import 创建的来源固定 `available=1, degraded=0`。
- `keepDays` 偏好项仍在设置中（隐藏 input 保留值），实际无效果。
- 扫描面板收起后详细警告行不再可达，只显示条数。
- `lastScanSummary` 仅内存，重启后首页不显示“上次扫描”。
- `PlaybackEvent.buffering` 仍无生产者；`SessionStatus.restoring/authenticating` 仍不可达（遗留路径）。
- 遗留 `PlaybackCoordinator.handleNativeClosed` 保留原有 generation 风险（按范围未改）。
