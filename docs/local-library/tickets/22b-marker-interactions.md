# Marker 交互：跳转与删除

ID: 22b-marker-interactions
Blocked by: 22a
Status: ready-for-agent
Spec: docs/local-library/spec-s1-watch-experience.md

## What to build

让进度条上的标记可用：点一下就跳到那个时间，打错了能删掉，删完进度条立即更新。

- 点击进度条上的标记跳转到对应位置。
- 播放器内删除选中的标记，一次确认，不引入右键菜单系统。
- 删除后刻度立即消失；失败时给出可见反馈且不改动已存数据。

## Acceptance criteria

- [ ] 点击标记后播放位置跳到该秒数，误差在可接受范围（≤2 秒）。
- [ ] 删除后标记立即消失，重启后也不再出现。
- [ ] 删除失败时保留原标记，并显示可见提示。
- [ ] 无标记时点击进度条行为与现在一致（只跳转，不弹确认）。
- [ ] overlay 里的进度条与主窗口标记显示一致。

## Out of scope

- 批量删除与"标记转片段"。
- 标记的重命名、颜色、分类。

## Verification

`npm run typecheck` → `npm test` → `npm run test:player-window` → `npm run test:player-overlay-window`。
