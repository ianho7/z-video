# 体验流程审计（只读）

ID: 19-ux-flow-audit
Blocked by: None (can start immediately)
Status: ready-for-agent

## What to build

按 `docs/local-library/ux-flow-audit.md` 的操作清单，沿正常、分支、异常三类路径走查一遍，产出一份可执行的发现清单。交付物是清单，不是代码。

- 60 个操作全部走主路径；分支与异常只覆盖带状态迁移的约 43 个（来源、详情、播放、整理）。
- 证据以代码路径与现有冒烟为主；8–10 个纯感官项标注"需真机"，不假装验证过。
- 每条发现给出：操作 ID、路径、现象、严重度、证据位置、建议修复方向。

## Acceptance criteria

- [ ] 60 个操作均有主路径结论（通过 / 问题 / 不适用）。
- [ ] 分支与异常路径覆盖约 43 个状态迁移操作。
- [ ] 每条问题符合判定标准之一：死路、状态残留、静默失败、误导文案、不可恢复、缺态、焦点/滚动丢失、并发破损。
- [ ] 发现按严重度排序，并聚成修复主题。
- [ ] 未做真机验证的项显式标注。

## Out of scope

- 修改任何代码。
- 视觉审美评价（颜色、排版）。

## Verification

产出 `docs/local-library/ux-flow-audit.md` 的发现清单章节；BTicket 20 依据它分组修复。
