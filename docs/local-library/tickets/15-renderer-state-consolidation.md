# 渲染层状态收敛

ID: 15-renderer-state-consolidation
Depends: 11, 12
Priority: P2

## What to build

把 renderer 的视图路由、请求代际与错误恢复从"逐处写 hidden"收敛为可推导的单一来源，消除互相作废与状态泄漏。

- 引入显式视图状态（`home | library | sources | search | cleanup | detail | player`）与单一 `setView()`，由它派生 `appShell`/`sidebar`/`libraryContent`/`detail`/`playerView`/`searchSection`/`cleanupSection` 的 `hidden`；`data-view` 反映真实视图。
- 拆分请求代际：`libraryEpoch` / `searchEpoch` / `detailEpoch` 独立，互不作废；所有丢弃路径在 `finally` 清理 `aria-busy`。
- `renderState` 的错误分支改为"派生 chrome"：错误解除时首页区块、引导、离线提示能恢复，不再需要靠某次导航偶然修复。
- 详情补 `re-opening` 状态（切集时有 loading 载体，且不显示上一集内容）。
- 卡片复用路径清理 `dataset.artwork*`（与 `renderHomeHero` 对齐），修封面永久 loading。
- 扫描刷新队列：在 `closeDetail`/`showPlayer(false)` 时消费 `scanRefreshQueued`，避免扫描期间停在详情页导致列表永久陈旧。

## Acceptance criteria

- [ ] 任意视图切换序列后，只有一个视图容器可见，无残留区块（含搜索/整理/详情/播放器）。
- [ ] 打开详情不再作废在途片库加载；关闭详情不再作废在途搜索；两者丢弃时 `aria-busy` 均被清理。
- [ ] 错误态解除后首页三个区块与引导可恢复显示，无需额外导航。
- [ ] 切集时页面不显示上一集内容，也不存在"内存无详情但屏幕有内容"的窗口。
- [ ] 扫描在详情页打开期间结束，返回列表后能看到最终结果。

## Out of scope

- 视觉改版与样式重构。
- 播放器内部状态机（已在 Ticket 06）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:window` / `npm run test:appearance-window`（GUI 权限）。
该类改动以窗口冒烟为准；单测只能覆盖纯逻辑部分，结论需区分。
