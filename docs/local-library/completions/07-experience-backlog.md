# 体验欠账批次完成记录（Ticket 15、17、19、20）

Date: 2026-11-15
Integration branch: `codex/experience-backlog`
基线：`62a0475`（Ticket 15 合入）→ `7d75fd8`（17）→ `8248f71`（20）
方式：每票独立工作树 + 独立 merger 复验；用户游戏期间切换到无窗口验证，窗口类证据显式延后。

## 交付

| Ticket | 结果 | 证据 |
|---|---|---|
| 15 renderer 视图模型 | `baseView`（home/library/sources/search）+ 图层栈（cleanup/detail/player），`applyView()` 单一派生；删除 `homeVisible`/`searchActive`/`cleanupVisible` 三个布尔与 17 处分散写入 | typecheck、124 单测、`test:window`、`test:local-library-app` 全过；0 处旧断言修改，新增 146 行断言；TDD 红证据为"错误解除后首页片架恢复" |
| 17 播放器/浮层窗口验证 | 两条夹具改为走生产流程（片库 → 详情 → `localPlayback.open`），新增缺失媒体、字幕 chips、全屏、关闭兜底与 overlay 二次显示断言 | 夹具改造后两条命令曾各通过一次；**合并后未重跑**，记为 deferred |
| 19 体验流程审计 | 4 区 60 操作走查，52 条发现，按主题分级 | `docs/local-library/ux-audit-findings.md` + `docs/local-library/ux-audit/` 四份原始报告 |
| 20 审计 blocker 修复 | 8 条：F-01 启动失败无窗口、F-04 重试无效、F-05 搜索失败误导、P-05 完成判定不一致、P-07 控制失败不可见、P-12 打开失败被忽略、B-06 Esc 忙态、CL-08 检查模式重播 | typecheck、124 单测、`test:local-library` 通过；P-05 有红→绿证据（95% 关闭写入 `playback_state.watched`） |

## 断言变更

- Ticket 15：**0 处既有断言修改**；新增 12 个断言块（视图栈、错误恢复、层叠、返回路径）。
- Ticket 20：**0 处既有断言修改**；`tests/local-library-database-smoke.ts` 新增 P-05 与 F-04 两组断言。
- Ticket 17：夹具整体重写（旧夹具驱动已退役的 NAS `player:*` 桥），断言按现行 `localPlayback` 契约重写。

## 已验证（无窗口）

`npm run typecheck`、`npm test`（124/124）、`npm run test:local-library`，均在集成分支与各工作树通过；`git diff --check` 干净。

## 延后验证（用户游戏期间禁止开窗）

- `test:player-window`、`test:player-overlay-window`（Ticket 17 的最终证据）
- `test:window`、`test:local-library-app`（Ticket 20 的 UI 级结论）
- 手动清单：建目录模拟启动失败、错误卡重试、搜索失败、控制失败回弹、Esc 忙态、检查模式重播
- `test:appearance-window`、`test:safe-storage-process`、`package`/`verify:package`

## 已知残余

- P-05：账本写失败时，引擎已写入的 `watched=1` 会领先账本；仅错误路径。
- P-07：提示条出现会触发 overlay 结构重绘，极端情况下打断 overlay 内拖拽。
- B-06：成功路径依赖 `<dialog>` close 事件异步派发。
- F-01：窗口本身创建失败仍 `exit(1)`（无可用报错面）。
- Ticket 20 未覆盖：B-05（`rescanAll` 忽略取消）、G-01（无单实例锁）——建议下一批单独成票。

## 下一批建议

按前沿与风险：**B-05 + G-01**（数据一致性）优先，其次 18（代际/重开）、21（外观）、22（打点）、25（复查会话）。18 与 25 都重度改 `renderer.ts`，建议串行，不要并行。
