# 关键帧抽取服务

ID: 26-frame-extraction
Blocked by: None (can start immediately)
Status: ready-for-agent

## What to build

给定任意已索引媒体，返回若干净帧缩略图，供卡片与去重使用。用户可感知结果：之后的三秒卡片能看到真实画面，而不是只有文字。

- 解码能力放在 main/worker 边界内，renderer 只拿图片数据。
- 抽帧位置均匀分布，跳过片头片尾黑帧。
- 结果按内容指纹缓存，源文件变化才重算。
- 单文件抽帧失败不影响其它文件。

## Acceptance criteria

- [ ] 对已索引文件返回 N 帧（建议 6）有效图片。
- [ ] 同一文件重复请求命中缓存，不重复解码。
- [ ] 文件变化后缓存失效并重算。
- [ ] 失败返回明确错误，不返回空白图或挂起。
- [ ] 不向 renderer 暴露路径或 URI。

## Out of scope

- 卡片 UI（Ticket 27）。
- 帧哈希去重（Ticket 29）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`（真实文件夹具）。
抽帧耗时与资源占用记录在完成记录中，作为后续卡片预算依据。
