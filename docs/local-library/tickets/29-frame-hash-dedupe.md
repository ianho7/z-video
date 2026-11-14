# 帧哈希去重

ID: 29-frame-hash-dedupe
Blocked by: 26, 28
Status: ready-for-agent

## What to build

用画面指纹识别重编码、改名、不同封装的同一内容，补上轻量去重识别不了的重复。用户可感知结果：那些"名字完全不同但其实是同一个"的条目会被折叠。

- 从关键帧算感知哈希，按相似度阈值分组。
- 只在需要时计算，后台排队，不阻塞浏览。
- 与 Ticket 28 的分组结果合并。

## Acceptance criteria

- [ ] 重编码/改名后的同一内容能被归为一组。
- [ ] 不同内容不会被误合并（用已知不同样本验证）。
- [ ] 计算在后台进行，浏览不被阻塞。
- [ ] 结果与轻量去重合并后不重复计数。
- [ ] 用户可对分组结果提出异议并拆分。

## Out of scope

- 跨来源的内容匹配策略优化。
- 人工标注工具。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`（含误判样本）。
