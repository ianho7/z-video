# Marker 存储与展示

ID: 22a-marker-storage-display
Blocked by: 15（已完成）
Status: ready-for-agent
Spec: docs/local-library/spec-s1-watch-experience.md

## What to build

让用户能在播放中按 `B` 记下当前位置，并在进度条上看到这个点；关闭应用再打开，标记仍在。

- schema v5 新增标记存储，按 Media file 的 `mediaId` 与秒级位置保存，随文件/来源删除级联。
- 按 `mediaId` 的列出/新增通道，校验 opaque id 与位置范围。
- 播放器快捷键 `B` 记录当前播放位置，不暂停、不弹窗。
- 进度条渲染标记刻度；无标记时不渲染刻度层。

## Acceptance criteria

- [ ] 播放中按 `B` 在当前秒数记录一个标记，播放不中断。
- [ ] 重启应用后同一文件的标记仍可读取。
- [ ] 进度条显示该文件的标记；无标记时没有刻度层。
- [ ] 删除 Source 后其标记不再可读，且不残留孤儿行。
- [ ] 非法 `mediaId`、负数或超出时长的位置被拒绝。
- [ ] 标记数据不含路径、标题或播放 URI。

## Out of scope

- 点击跳转、删除交互（Ticket 22b）。
- 热度聚合与波形（后续）。
- 自动标记。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library` → `npm run test:player-window`。
