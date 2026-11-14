# 播放偏好：轨道 latch 与字幕关闭持久化

ID: 09-playback-preferences
Depends: none
Priority: P0

## What to build

修正音轨/字幕偏好在真实播放中被静默丢弃的两条路径，并让"显式关闭字幕"跨重启保留。

- **latch 修正**：`trackPreferencesApplied` 只在"收到非空 tracks 且已下发偏好"后置位；空 `tracks` 事件不得消费 latch。若偏好目标轨不存在，保留原偏好而不是清成 `undefined`（或按明确规则降级并记录）。
- **同事件覆盖**：`updateSelectedTracks` 不得用应用前的默认轨覆盖刚下发的偏好；只有偏好应用完成后的新 `tracks` 事件才更新 `audioTrackId`/`subtitleTrackId`。
- **字幕三态持久化**：DB 中 `subtitle_track_id` 使用 `"off"` 哨兵表示"显式关闭"；写入时 `null → "off"`、`undefined → NULL`；读取时 `"off" → null`、`NULL → 省略字段`。DTO/IPC 契约不变（仍为 `string | null | undefined`），不升 schema。
- 同步更新 `docs/local-library/contracts.md` 中 `playback_state.subtitle_track_id` 的取值说明。
- renderer：音轨/字幕/速度命令失败时与音量/静音对齐，回滚乐观 UI。

## Acceptance criteria

- [ ] 先发空 `tracks` 事件、再发含真实轨道的 `tracks` 事件：保存的偏好最终被应用（`tests/local-playback.test.ts`）。
- [ ] 偏好轨不存在时：行为有明确契约（不清空 / 清空并提示），并有测试固定。
- [ ] `subtitleTrackId: null` 写入后重启读取仍为 `null`，且播放时下发 `sid=no`；`undefined` 读取仍省略字段。
- [ ] 音轨/字幕/速度命令失败时 UI 回到服务端实际值（与 `restorePlayerSettingsAfterFailure` 同语义）。
- [ ] 既有断言 `subtitleTrackId: "missing-subtitle" → undefined` 的处置在完成记录中说明（保留或按新规则改写）。

## Out of scope

- 外部字幕文件跨次加载（不持久 `sub-add`）。
- 字幕/音轨 UI 结构改动。

## Verification

`npm run typecheck` → `npm test` → `npm run test:player-window`（若权限允许）。
DB 读写通过 `npm run test:local-library` 覆盖。
