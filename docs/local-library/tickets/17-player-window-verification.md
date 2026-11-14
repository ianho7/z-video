# 播放器与浮层窗口验证补齐

ID: 17-player-window-verification
Blocked by: 15
Status: ready-for-agent

## What to build

补齐上一批按需跳过的两条窗口验证，让播放关闭与浮层行为有真实窗口证据，而不是只有代码路径。

覆盖：播放器关闭兜底与幂等拆卸、overlay 二次显示补推 state、`error` 纳入 overlay 变化判定。

## Acceptance criteria

- [ ] `npm run test:player-window` 通过，或记录为 environment-blocked 并说明失败落在哪个流程。
- [ ] `npm run test:player-overlay-window` 通过，或同等标注。
- [ ] 未跑通的项在完成记录里与"已通过"分开列出。
- [ ] 不修改产品代码；只允许调整夹具使其与当前 renderer/preload 一致。

## Out of scope

- 播放器内部状态机修复（已完成于 Ticket 06）。
- 其余三条未跑冒烟（appearance / safe-storage / resume）。

## Verification

`npm run test:player-window` → `npm run test:player-overlay-window`。
