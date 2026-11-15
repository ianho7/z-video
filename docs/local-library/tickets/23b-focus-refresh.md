# 回库自动刷新

ID: 23b-focus-refresh
Blocked by: 23a
Spec: docs/local-library/spec-s2-change-detection.md
Status: ready-for-agent

## What to build

改完 NFO 或增删文件后，切回应用就能看到正确结果，不需要手动扫描；正在详情或播放时只更新数据、不打断。

- 窗口重新获得焦点、或从详情/播放器返回片库时触发。
- 先对本库已知目录做 mtime 粗筛，只把变化目录交给增量扫描。
- 粗筛有节流，避免频繁切换窗口造成重复工作。
- 详情/播放期间刷新延后排队，不抢焦点、不切视图、不重置滚动。
- 结果静默推送，计数写状态行，不弹通知。

## Acceptance criteria

- [ ] 改一个 NFO 后切回片库，条目更新，无需手动扫描。
- [ ] 未变化时触发不会产生可观察的扫描（无计数变化、无状态闪烁）。
- [ ] 详情页打开期间发生的变化，返回片库后才生效，且滚动位置不变。
- [ ] 播放期间发生的变化不打断播放。
- [ ] 手动扫描进行中不叠加自动刷新，脏目录排队。
- [ ] 状态行显示四类计数，不出现"全部条目都更新"的误导。

## Out of scope

- 文件系统监听与网络盘轮询（Ticket 24a / 24b）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library` → `npm run test:window`。
