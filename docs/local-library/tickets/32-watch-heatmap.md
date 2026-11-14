# 自观看热区

ID: 32-watch-heatmap
Blocked by: 22
Status: ready-for-agent

## What to build

把本地观看位置聚合成时间轴上的强度曲线，显示在进度条上。用户可感知结果：能看出自己反复回到哪一段，而不是只有一条平直的进度。

- 位置落成固定分桶（建议 1% 一格），按 `mediaId` 聚合。
- 只统计本机数据：播放位置、打点；不引入任何人群数据。
- 没有数据的文件不显示热区，显示明确空态而不是伪造曲线。
- 热区只做展示，不改变播放行为。

## Acceptance criteria

- [ ] 看过至少一次的文件显示热区，且与观看历史一致。
- [ ] 从未看过的文件不显示热区，也不显示空曲线。
- [ ] 热区随新观看更新，不要求重启。
- [ ] 分桶数据量有上限，不随观看次数无限增长。
- [ ] 表述不出现"最好看/精华"这类无法验证的结论。

## Out of scope

- 音频波形（Ticket 33/34）。
- 心率数据（Ticket 35）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library` → 涉及进度条的窗口冒烟。
