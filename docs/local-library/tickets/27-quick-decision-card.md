# 三秒卡片

ID: 27-quick-decision-card
Blocked by: 25, 26
Status: ready-for-agent

## What to build

复查会话里的每个候选显示成一张能三秒判断的卡片：几帧真实画面、时长、大小、分辨率、厂牌或演员线索、上次看到哪。用户可感知结果：不用点开就能决定，决定后自动下一个。

## Acceptance criteria

- [ ] 卡片显示 6 帧缩略图，加载中不塌陷布局。
- [ ] 显示时长、大小、分辨率与"上次看到"（有则显示，无则说明未看）。
- [ ] 单键 K/S/D 生效，决定后自动进入下一个。
- [ ] 抽帧失败时降级为占位图，不阻塞决策。
- [ ] 卡片在最小窗口（900×640）下不溢出、不遮挡按键提示。

## Out of scope

- 连续会话本身（Ticket 25）。
- 自动抽帧的排队策略优化。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library-app`。
