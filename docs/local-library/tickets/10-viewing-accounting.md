# 观看账本口径统一

ID: 10-viewing-accounting
Depends: 09
Priority: P1

## What to build

让"重播""加载失败""已看完"三件事在 `playback_state` 与观看账本上口径一致，不再互相矛盾。

- **重播 = 新观看尝试**：引擎进入 `ended` 后再收到 `play` 时，清 `watched`、`endedObserved`、`viewingFinished`，开启新一轮会话（mpv 从 0 播放）。不得把同一集重复计入 `completed_count`。
- **加载失败不按恢复位置计完成**：`reason === "error"` 时不得以 resume 位置参与 `isCompletedWatch`；`begin()` 的初始 `endPositionSec` 不得单独构成完成资格。
- **`watched` 与账本同源**：ended 时若从未收到 `position` 事件，`flushProgress` 不得因 `observedPosition=false` 丢弃 `watched`；否则两套记录分叉。二选一：用 `durationSec` 作为落盘位置，或让账本与 `playback_state` 共用同一写入点。
- `AppViewingLedger.begin()` 前若存在未结束会话，先 finish 旧会话；`startPromise` 失败需可观测（至少 diagnostics 一条），不再静默丢弃整个观看尝试。
- `completed` 判定收敛为一处纯函数，恢复/聚合/实时三条路径共用。

## Acceptance criteria

- [ ] 播完 → Space 重播 → 关闭：`completed_count` 只加 1；`watched` 与最终位置自洽（不再出现"已看完 + 进度 0"）。
- [ ] 加载失败（resume 位置 90%+）：该次不计入 `completed_count`，也不把 `watched` 置真。
- [ ] ended 但无 `position` 事件：`playback_state.watched` 与账本完成计数一致。
- [ ] 连续两次 `begin`（切换媒体）：前一会话在库中已结束（`ended_at` 非空，或恢复路径能正确补记）。
- [ ] 恢复/聚合/实时三条路径对同一会话给出相同 `completed` 结论（纯函数单测）。

## Out of scope

- 账本 schema 变更。
- 整理规则阈值调整（Ticket 14）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-playback-resume`（若环境可用）。
