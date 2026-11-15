# E2E 证据：真实用户操作 + 截图（2026-11-15）

运行方式：Electron 真实窗口（隔离 `--user-data-dir`，`--force-renderer-accessibility`），真实文件与真实 libmpv 播放。

- **操作**：Windows UI Automation `InvokePattern`（导航、详情、播放/暂停、关闭）与 `SendKeys`（`B` 打点；发送前用 `WScript.Shell.AppActivate` 确保窗口在前台）。
- **播放器 overlay 的点击**：主窗口自动化元素点击会被 overlay 拦截，刻度点击与删除标记两步改用 Codex computer use（`gpt-6.1-terra` + `cua_repl`）完成。
- **截图**：PowerShell `GetWindowRect` + `CopyFromScreen`，按窗口矩形抓取；播放器截图前把鼠标移到控制条使其显示。
- **数据交叉验证**：直接读隔离 profile 的 `library.sqlite`（`markers`、`media_files`、`collections`）。

## 覆盖与证据

| # | 步骤 | 截图 | 结果 | 数据证据 |
|---|---|---|---|---|
| 1 | 打开应用（3 部作品） | `u01-home.png` | 通过 | — |
| 2 | 打开详情 | `u02-detail.png` | 通过：电影 · 2021 · 评分 8.1 | — |
| 3 | 返回首页 | `u03-back.png` | 通过：回到 hero | — |
| 4 | 打开播放器 | `u04-play.png` | 通过：真实视频画面 + 标题 | — |
| 5 | 暂停 | `u05-pause.png` | 通过：显示"已暂停" | — |
| 6 | `B` 打点 | `u06b-marker-visible.png` | 通过：控制条出现标记刻度 | `markers=[{position_sec:3}]` |
| 7 | 点击刻度 | `u07b-marker-clicked.png` | 通过：跳转到 00:03 | — |
| 8 | 删除标记 | `u08b-marker-deleted.png` | 通过：刻度消失、提示"已删除标记 00:03" | `markers=[]` |
| 9 | 关闭播放器 | `u09-close-player.png` | 通过：返回详情 | — |
| 10 | 改 NFO 自动刷新 | `u10-nfo-refresh.png` | 通过：标题变为 `Cu Movie Two RENAMED`，进度 00:03 保留 | `collections` 含 `Cu Movie Two RENAMED` |
| 11 | 新增视频 | `u11-file-add.png` | 通过：新条目被索引 | `Cu Movie Four available=1` |
| 12 | 删除视频 | `u12-file-remove.png` | 通过：条目不可用 | `Cu Movie Four available=0` |
| 13 | 第二次启动 | `u13-single-instance.png` | 通过：第二实例自行退出 | `secondExited=True exit=0` |

## 已知限制

- 截图是窗口级抓取，不是逐像素视觉验收；颜色/字体的主观判断仍需人眼。
- 播放器 overlay 的坐标点击无法用 UIA 直接命中，这两步依赖 Codex computer use；其余步骤不消耗 Codex token。
- macOS 未验证；网络盘（SMB）未在此环境验证。
- 本目录是证据，不是可重放的测试脚本；驱动脚本在 `.scratch/seed/`（临时目录，不随仓库保留）。
