# 整理：keep 终态与检查模式一致性

ID: 14-cleanup-keep-terminal
Depends: none
Priority: P1

## What to build

让"保留"符合其字面语义，并修掉检查模式在错误/隐藏状态下的一致性缺口。

- `effectiveCleanupState`：`keep` 不再因 `cleanup_until` 到期回落 `none`；`snooze` 仍按到期回落。
- `keep` 不再写 `cleanup_until`（或写入但读取侧忽略），UI 文案改为"已保留"，不展示"保留至 X 天"。
- 迁移旧数据：已有 `keep` 行按新语义直接视为终态（无需重写 `cleanup_until`）。
- `renderState` 的错误分支在重置 `cleanupVisible` 时同时清 `reviewTarget`（或调用 `returnToReviewQueue()`），避免在隐藏的整理页上弹决定框。
- `setCleanupMark` 与 `markReviewDecision` 共用同一互斥（或各自声明互不重叠的作用域），并在完成后刷新队列。

## Acceptance criteria

- [ ] `keep` 标记在任意时间后仍为 `keep`，不出现在候选队列；`delete-candidate` 行为不变。
- [ ] `snooze` 到期仍回落 `none` 并回到队列。
- [ ] 片库错误态下若正在检查播放，关闭播放器不会在隐藏的整理页上打开决定框；决定后队列可见刷新。
- [ ] 既有单测 "keep and snooze expire back into the active queue" 按新语义改写并在完成记录中说明。

## Out of scope

- 清理规则 A–E 的判定逻辑与阈值。
- 新增整理入口或批量操作。

## Verification

`npm run typecheck` → `npm test`（`tests/cleanup-contracts.test.ts`、`tests/local-library-database-smoke.ts`）。
