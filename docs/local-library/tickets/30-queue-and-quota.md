# 队列到期与配额可视化

ID: 30-queue-and-quota
Blocked by: 25
Status: ready-for-agent

## What to build

把"想看"变成有期限的队列，并让存储成本可见。用户可感知结果：未看条目会到期提醒"要么看要么删"；每个来源显示占用与"每小时观看成本"。

- 未看队列：进入后 N 天未看即进入待决。
- 配额：每个来源的存储预算与当前占用，超限只提示不阻塞。
- 成本视图：GB / 已观看小时。

## Acceptance criteria

- [ ] 未看条目到期后出现在待决入口，可从那里直接分诊。
- [ ] 每个来源显示占用与预算使用比例。
- [ ] 超出预算时给出提示，但不阻止导入。
- [ ] 不做任何自动删除或移动。

## Out of scope

- 清理规则阈值调整（已由既有 A–E 规则承担）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library-app`。
