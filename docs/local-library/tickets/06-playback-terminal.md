# 播放会话终态收敛

ID: 06-playback-terminal
Depends: none
Priority: P0

## What to build

把播放会话的"结束"收敛为单一出口，消除 `closed` 事件丢失导致的播放器视图卡死，并修正加载失败与虚假结束两种不可达/矛盾状态。

- `LocalPlaybackCoordinator` 增加 `terminate(reason)` 单一终态出口：`close()`、`handleNativeClosed()`、`error` 迁移共用；终态事件幂等且无条件发出一次，不受后续 `generation++` 影响。
- 双击关闭与 `handleNativeClosed` 的 `await flushProgress` 竞态：无论调用顺序，renderer 恰好收到一次 `closed`。
- `failed` 迁移（`open()` catch 与引擎 `error`）不得残留可用 `active`：要么清 `active`，要么让 `handle()`/`ready`/`position` 分支统一早退。
- `MpvNativePlayer` 增加 `loaded` 门：`FILE_LOADED` 之前 `idle-active=yes` 不得投影为 `ended`（可投影为 loading/不动）。
- `close()` 等待进度落盘：同指纹已在队列中时也要等待该队列项完成，避免 ended 后立刻退出丢 `watched`。
- renderer：关闭入口（关闭按钮/返回列表/错误返回）进入"closing"态并在 1.5s 未收到 `closed` 时本地强制 `handlePlayerClosed()`；关闭时复位 `playerState`/`playerDurationSec`/`playerVolumeLevel`/`playerMuted`/`playerSpeedValue`；`playerCancelNext` 改用 `resetPlaybackEndedPanel()`。
- overlay：`changed` 判定纳入 `error`；`overlay:visible(true)` 后补推一次完整 state（解决二次打开空白）。

## Acceptance criteria

- [ ] 连续两次 `close` 命令、`close` 与 native-closed 交错两种顺序，均恰好产生一次 `closed` 事件（单测覆盖，`tests/local-playback.test.ts`）。
- [ ] 加载失败后：不残留可 `handle()` 的 active；renderer 不再收到该会话的 `ready`/`position`；控制命令不产生 `control-error` 风暴。
- [ ] `FILE_LOADED` 之前不产出 `state:"ended"`；`watched` 不被误置；不触发自动跳集（单测用 fake engine 顺序验证）。
- [ ] `close()` 返回后同会话的进度写入已完成（测试用可控延迟 store 断言落盘顺序）。
- [ ] renderer 在无 `closed` 回包时 1.5s 内退出播放器视图且不重复拆卸（`handlePlayerClosed` 幂等）。
- [ ] overlay 第二次打开时不出现空白控件区（结构变更后必有一次 state 推送）。

## Out of scope

- `buffering` 状态的可达性（需要读 `demuxer-cache-state`，另开）。
- NAS 播放协调器的进度队列（随 Ticket 16 一并 deprecated）。
- 全屏三副本同步协议。

## Verification

`npm run typecheck` → `npm test` → `npm run test:player-window`（真实窗口，若权限允许）。
真实窗口与真实媒体结论需单独标注，不得由单测替代。
