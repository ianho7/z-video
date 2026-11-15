# 取消语义与"全部重扫"

ID: 37-cancel-rescan
Blocked by: None (can start immediately)
Status: done (2026-11-15, merged in 84d81bc)
Source: docs/local-library/ux-audit-findings.md（B-05，high）

## What to build

让"取消扫描"在"重扫全部"场景下真的生效，并让取消入口在第一帧就可用。

现状问题：`rescanAll` 逐源执行时只取消当前来源，取消后下一个来源立刻开始；扫描刚开始、`scanId` 还没到达 renderer 时取消按钮全部 disabled；`cancelScan` 返回 `false`（终局窗口）被静默丢弃。

## Acceptance criteria

- [ ] 在"重扫全部"进行中取消：当前来源停止，且**不再开始**后续来源。
- [ ] 取消后结果与实际一致：被取消的来源报 `cancelled`，未开始的来源不产生伪造结果。
- [ ] 扫描开始到首个进度事件之间，取消入口可用（或明确显示"正在准备，暂不可取消"而不是禁用无提示）。
- [ ] `cancelScan` 返回 `false` 时给出可见说明（例如"扫描已完成，无需取消"），不静默丢弃。
- [ ] 取消后来源可用性与 `degraded` 不被错误改写。
- [ ] 单测覆盖：取消时后续来源不启动、终局窗口返回 false 的处理。

## Out of scope

- 扫描速度优化（增量扫描已由 23a 提供）。
- 取消单个文件的索引事务。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library` → `npm run test:local-library-app`。
