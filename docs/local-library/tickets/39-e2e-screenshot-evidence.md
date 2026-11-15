# E2E 截图取证

ID: 39-e2e-screenshot-evidence
Blocked by: None (S0–S2 已合入)
Status: ready-for-agent

## What to build

在 Windows 上无人值守地走一遍真实用户操作，并为每一步留下**截图证据**，让验收可以事后复核、不依赖记忆。

- 驱动真实生产窗口（不是 stub）：点击、按键、滚动、聚焦/失焦都触发真实 DOM 事件。
- 播放使用真实 libmpv 与真实视频文件。
- 文件变化在磁盘上真实发生（新增/修改/删除 NFO 与视频）。
- 每一步截图：渲染器画面（`webContents.capturePage()`）+ 至少若干关键步骤的桌面截图（证明窗口真实存在）。
- 产出 `docs/local-library/evidence/e2e-<date>/`：每步 PNG、`manifest.json`（checklist 项 → 截图文件 → 断言结果）、`README.md`（运行方式、环境、已知限制）。
- 截图要自检：尺寸合理、非纯色（用像素方差或抽样断言），避免保存空白图冒充证据。

## 覆盖清单

至少覆盖 `docs/local-library/ux-flow-audit.md` 中 S0–S2 涉及的操作：

1. 列表滚动 → 详情 → 返回，滚动位置保留
2. 详情 / 首页 / 整理 三种入口打开播放器并返回
3. 详情切集不显示上一集内容
4. 播放中按 `B` 记录刻度、不暂停
5. 点击刻度跳转
6. 删除标记
7. 改 NFO → 失焦 / 聚焦 → 列表更新
8. 详情打开期间改 NFO → 返回后才生效
9. 新增 / 删除视频后的条目状态
10. 重扫全部时取消
11. 第二次启动单实例退出

## 约束

- 只改 `tests/**`、`scripts/**`、`package.json`；不改 `src/**` 产品行为。
- 使用一次性临时 profile；不得触碰真实 `%APPDATA%\z-video-electron` 与真实媒体库。
- 失败不吞：某步失败仍然保存截图与失败原因，继续跑后续能跑的步骤。
- 不新增依赖。

## Acceptance criteria

- [ ] `npm run test:e2e-evidence` 可无人值守运行，退出码表达结果。
- [ ] 覆盖清单每一项都有截图与断言记录，失败项如实标记。
- [ ] 截图非空白：尺寸与像素分布断言通过。
- [ ] `manifest.json` 能逐条回答"哪张图证明了哪一项"。
- [ ] 运行后无残留 electron 进程、无临时 profile 残留。
- [ ] 真实用户数据目录内容不变（前后指纹比对）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:e2e-evidence`。
