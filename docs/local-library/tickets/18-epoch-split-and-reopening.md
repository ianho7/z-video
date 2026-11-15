# 请求代际拆分与详情重开

ID: 18-epoch-split-and-reopening
Blocked by: 15
Status: done (2026-11-15, merged in 3510c30; smoke precondition fixed in dd44cdb)

## What to build

让三个互不相关的请求域各自拥有代际，不再互相作废；并给详情切集一个真实的加载载体。用户可感知结果：打开详情不再打断在途的片库加载；从详情返回不再取消在途搜索；切集时不会显示上一集的内容。

- `libraryEpoch` / `searchEpoch` / `detailEpoch` 独立。
- 所有丢弃路径在 `finally` 清理 `aria-busy`。
- 详情切集进入 `re-opening` 状态（有 loading 载体，不显示旧内容）。
- 卡片复用路径清理 `dataset.artwork*`。
- `closeDetail` / `showPlayer(false)` 消费 `scanRefreshQueued`。

## Acceptance criteria

- [ ] 打开详情不作废在途片库加载；关闭详情不作废在途搜索。
- [ ] 被丢弃的请求不会遗留 `aria-busy=true`。
- [ ] 切集时页面不显示上一集内容，也不存在"内存无详情但屏幕有内容"的窗口。
- [ ] 复用的卡片不会永久停留在封面 loading。
- [ ] 扫描在详情页打开期间结束，返回列表能看到最终结果。

## Out of scope

- 视图可见性模型（Ticket 15）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:window` → `npm run test:local-library-app`。
