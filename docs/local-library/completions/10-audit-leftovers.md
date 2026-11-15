# 审计遗留修复完成记录（Ticket 37、38）

Date: 2026-11-15
Integration branch: `codex/experience-backlog`
合入：`84d81bc`（37）→ `d4e9e4b`（38）

## 交付

| Ticket | 结果 | 证据 |
|---|---|---|
| 37 取消语义与全部重扫（B-05） | `rescanAll` 增加运行级取消意图：每个来源启动前与返回后检查，取消后不再启动后续来源；`cancelScan` 在 rescan-all 活跃时返回 true 表示剩余来源已取消；首帧取消入口可用并说明"准备中"；`false` 有可见反馈；取消不改写 `available/degraded` | typecheck、155 单测、`test:local-library`、`test:window`、`test:local-library-app` 全过 |
| 38 单实例锁（G-01） | 模块加载即 `requestSingleInstanceLock()`，早于 worker/SQLite/偏好；第二实例 exit 0（约 111ms）且完全不走 bootstrap；主实例收到 `second-instance` 后还原并聚焦窗口 | typecheck、155 单测、`test:single-instance`（红→绿，4 次运行）、`test:local-library-app` 全过 |

## 单实例冒烟的证明方式

三个真实启动共享一次性 profile：主实例加载生产 main、预置 in-flight `scan_runs` 与健康来源并最小化；第二次用生产入口 `electron .` 启动；主实例退出后再启动一次。receipt 断言第二实例 exit 0、主窗口唯一且已还原聚焦、DB 两行快照前后一致、第二实例日志无 bootstrap。

## 断言变更

- 37：DB 冒烟新增 5 条（取消请求计数、来源顺序、后续来源未索引、可用性未被改写、终局 false）；window smoke 新增首帧取消与 false 反馈两组，`readScanState` 只增键；app smoke 的等待谓词改为显式等待含 `scanId` 的进度帧（理由：取消入口现在准备帧就可点）。
- 38：未修改任何既有断言；新增 `test:single-instance` 脚本与主实例侧 smoke。

## 已知边界与遗留

- 37：跨来源终局竞态（点击恰在来源已完成、UI 仍显示 running 的毫秒窗口）会返回 true 并跳过后续来源，已完成来源如实报 completed；无 e2e 覆盖。`contracts.md` 未写入 rescan-all 运行级取消语义（不在该票允许范围）。
- 38：真实播放中启动第二实例不打断播放只有代码路径证据（第二实例不进入 bootstrap），无 mpv 画面证据；macOS 单实例行为未验证。
- 合并时观察到两处既有测试卫生问题（非本批引入）：`window` fixture 未注册 `markers-list` 通道，日志有 4 条 no-handler；`local-library-app` 冒烟退出后未删除临时 profile（`%TEMP%` 累积）。建议单独开一张小票修。
