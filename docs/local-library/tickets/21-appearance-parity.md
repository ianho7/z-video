# 外观一致性：收掉原生控件样式

ID: 21-appearance-parity
Blocked by: 15
Status: ready-for-agent

## What to build

把残留的原生控件外观换成与 Soft Cinema 一致的自绘样式。用户可感知结果：滚动条、折叠三角、悬浮提示不再像系统默认控件。

- 滚动条：普通与 hover 态，深色主题。
- `<details>/<summary>` 的三角标记替换为自绘。
- `title=` 的原生 tooltip 改为应用内提示。
- `::selection` 与 focus ring 统一。

## Acceptance criteria

- [ ] 全仓不再出现 `::-webkit-scrollbar` 之外的系统默认滚动条外观。
- [ ] `summary` 不再显示原生三角。
- [ ] 主要触发点不再依赖原生 `title` 提示。
- [ ] 键盘焦点可见且与现有 focus 样式一致。
- [ ] 不动布局结构与信息层级。

## Out of scope

- 新配色、新排版。
- 右键菜单与文本拖拽（若审计另有发现，归入 Ticket 20）。

## Verification

`npm run typecheck` → `npm run test:window` → `npm run test:appearance-window`（改动外观时必跑）。
