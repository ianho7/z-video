# 本地盘监听与防抖

ID: 24a-local-watcher
Blocked by: 23a
Spec: docs/local-library/spec-s2-change-detection.md
Status: done (2026-11-15, merged in b4555da)

## What to build

不切换窗口也能感知本地盘变化：新增、删除、改名后几秒内片库就更新。

- 对已注册来源使用递归文件系统监听，事件只收集脏目录。
- 1.5 秒防抖 + 合并去重，避免一次保存触发多次扫描。
- 忽略临时文件与系统垃圾文件（`*.tmp`、`*.part`、`~$*`、`Thumbs.db`、`@eaDir`、`#recycle`）。
- 监听不可用或来源离线时静默回退到聚焦刷新，不报错弹窗。
- 退出应用时释放全部监听与定时器。
- 变化来源可注入（测试侧），用于验证防抖与合并，不依赖真实监听。

## Acceptance criteria

- [ ] 本地新增/删除视频后数秒内片库反映，无需切窗口。
- [ ] 连续多次写入只触发一次扫描（防抖与合并生效）。
- [ ] 临时文件与垃圾文件不触发扫描。
- [ ] 来源被移除或离线后不再有残留监听。
- [ ] 应用退出后无残留 watcher 或定时器。
- [ ] 监听不可用时回退到聚焦刷新，且用户无感。

## Out of scope

- 网络盘（Ticket 24b）。
- 跨平台差异（先 Windows）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library` → 注入事件源的单元验证。
