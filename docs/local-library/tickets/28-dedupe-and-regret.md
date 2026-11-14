# 轻量去重、版本折叠与后悔率

ID: 28-dedupe-and-regret
Blocked by: None (can start immediately)
Status: ready-for-agent

## What to build

识别同一内容的多份拷贝并把它们折成一张卡，同时记录"删掉又下回来"的后悔事件。用户可感知结果：库里重复条目一次性消失；系统能提示"你上次删了又重下"。

- 轻量身份：时长 + 大小 + 规范化文件名（不做帧分析）。
- 版本折叠：同内容只保留一张卡，默认保留最高质量，其余进待决。
- 后悔率：标记删除后同身份再次出现，记一次后悔事件。

## Acceptance criteria

- [ ] 同内容不同清晰度/文件名被归为一组，列表只出现一张卡。
- [ ] 折叠后能看到组内版本与默认保留项。
- [ ] 删除后再下载能被识别并记录后悔事件。
- [ ] 误判可解除分组（不强制合并）。
- [ ] 不做任何文件删除或移动。

## Out of scope

- 帧哈希去重（Ticket 29）。
- 分组 UI 的大改版。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`。
