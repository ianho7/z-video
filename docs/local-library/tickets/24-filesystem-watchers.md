# 本地盘监听与网络盘轮询

ID: 24-filesystem-watchers
Blocked by: 23
Status: ready-for-agent

## What to build

不切换窗口也能感知变化：本地盘用文件系统监听加防抖，网络共享用低频轮询，两者共用 Ticket 23 的增量入口。用户可感知结果：正在看片库时新增文件会自己出现。

- 本地盘：递归监听 + 防抖（约 1–2 秒），事件去重。
- 网络盘：低频轮询，按目录分片，避免整库 stat。
- 监听失败或不可靠时静默回退到聚焦触发，不报错弹窗。

## Acceptance criteria

- [ ] 本地盘新增/删除视频，片库在数秒内反映。
- [ ] 网络盘在轮询周期内反映变化。
- [ ] 重复事件不会触发多次扫描。
- [ ] 监听不可用时回退到聚焦刷新，且不产生用户可见错误。
- [ ] 关闭应用后无残留监听或定时器。

## Out of scope

- 增量扫描实现（Ticket 23）。
- 跨平台监听差异（先 Windows）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library` → 窗口冒烟（如涉及 renderer 提示）。
