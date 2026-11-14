# 渲染层视图模型（baseView + 图层栈）

ID: 15-renderer-state-consolidation
Blocked by: None (can start immediately)
Status: ready-for-agent

## What to build

把 renderer 的视图可见性从"十几个函数各自写 hidden"收敛成 `baseView` + 图层栈的单一派生。用户可感知的结果：视图切换不再残留区块；从详情或播放器返回后，片库仍在原来的页并保留滚动位置。

- baseView 互斥四态：home / library / sources / search。
- 图层：cleanup、detail、player；player 是模态层，隐藏 appShell 但保留底层状态。
- 一个 `applyView()` 由 `{ baseView, layers }` 派生全部 `hidden`；导航函数只改状态，不再直接写 `hidden`。
- `renderState` 的错误分支改为派生 chrome：错误解除时首页区块、引导、离线提示能恢复。

## Acceptance criteria

- [ ] 任意 baseView 切换后只有对应容器可见，无残留区块。
- [ ] cleanup 与 detail 叠加时 base 保持挂载；player 打开后关闭能回到正确目标。
- [ ] 播放器三条返回路径（详情 / 首页 / 整理）的可见性组合与改动前逐项一致。
- [ ] 从详情返回片库，列表 `scrollTop` 与打开前误差 ≤4。
- [ ] 错误态解除后首页三个区块与引导可恢复显示，无需额外导航。
- [ ] 预判会失效的 9–12 处既有断言逐条报备（旧值 / 新值 / 理由）。

## Out of scope

- 请求代际拆分、详情 reopening、卡片 dataset 清理（见 Ticket 18）。
- 视觉改版与播放器内部状态机。

## Verification

`npm run typecheck` → `npm test` → `npm run test:window` → `npm run test:local-library-app`。
连续两轮窗口冒烟失败即停止，只保留 baseView 与 libraryContent/appShell 两处派生。
