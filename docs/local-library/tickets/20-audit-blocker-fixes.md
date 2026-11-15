# 审计 blocker 修复

ID: 20-audit-blocker-fixes
Blocked by: 19, 15
Status: done (2026-11-15, merged in 8248f71; window smokes green, UI-level checks automated by 20b)

## What to build

修掉审计中判定为 blocker 的问题：死路、静默失败、不可恢复、误导文案。其余发现留给后续批次，不在本票扩大范围。

## Acceptance criteria

- [ ] Ticket 19 中每个 blocker 都有对应的修复与验证证据。
- [ ] 非 blocker 发现只记录、不修复。
- [ ] 修复不引入新的行为变更；如不可避免，逐条在完成记录中说明。
- [ ] 涉及视图可见性的修复以 Ticket 15 的模型为准，不另写 `hidden`。

## Out of scope

- 需要新产品能力的修复（去重、分诊、热区等）。
- 纯视觉调整。

## Verification

`npm run typecheck` → `npm test` → 受影响的窗口冒烟（按票判定）。
