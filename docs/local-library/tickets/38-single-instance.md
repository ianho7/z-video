# 单实例锁

ID: 38-single-instance
Blocked by: None (can start immediately)
Status: ready-for-agent
Source: docs/local-library/ux-audit-findings.md（G-01，medium）

## What to build

保证同一时间只有一个应用实例在写本机片库。现状：没有单实例锁，第二次启动会开第二个实例；第二实例初始化时把正在跑的扫描判为 interrupted 并置 `degraded`，两个进程同时写 SQLite 与偏好。

## Acceptance criteria

- [ ] 第二次启动不创建第二个 worker、不打开第二个 SQLite 连接。
- [ ] 第二次启动把已有窗口带到前台（恢复/聚焦），然后自身退出。
- [ ] 第二实例退出后，第一实例的 `scan_runs` 不被标 interrupted、来源不被置 `degraded`。
- [ ] 第一实例正在播放时，第二次启动不打断播放。
- [ ] 若第一实例已退出，第二次启动正常成为唯一实例。
- [ ] 用一个可重复的冒烟证明上述行为（启动 → 再启动 → 断言第二实例退出且第一实例状态未被改写）。

## Out of scope

- 多用户/多 profile 并行。
- 单实例下的窗口多开策略。

## Verification

`npm run typecheck` → `npm test` → 新增的单实例冒烟 → `npm run test:local-library-app`（确认正常启动不被锁误伤）。
