# E2E 截图取证完成记录（Ticket 39）

Date: 2026-11-15
产物：`docs/local-library/evidence/e2e-2026-11-15/`（13 张截图 + `manifest.json` + `README.md`）

## 背景与方案变更

原计划用 LCU（Codex computer use，`amontlabs/lcu`）驱动真实操作。调研结论：LCU 最新 release 只有 macOS/Linux 三个包，**Windows 11 被明确标为 candidate/deferred**，且依赖官方 ChatGPT 桌面版运行时；本机没有该应用。因此 LCU 路线不可用。

实际采用混合方案：

- **操作**：Windows UI Automation `InvokePattern` 驱动导航/详情/播放/暂停/关闭；`WScript.Shell.SendKeys` 在 `AppActivate` 后发送 `B`。
- **播放器刻度点击与删除**：主窗口自动化元素会被 overlay 窗口拦截，这两步用 Codex computer use（`gpt-6.1-terra` + `cua_repl`）。
- **截图**：PowerShell `GetWindowRect` + `CopyFromScreen`，按窗口矩形抓图；播放器截图前把鼠标移到控制条。
- **数据**：直接读隔离 profile 的 `library.sqlite` 交叉验证。

## 覆盖结果

13 步全部通过，见 `manifest.json`。重点证据：

- `u06b-marker-visible.png` + `markers=[{position_sec:3}]`：`B` 打点成功且刻度可见。
- `u08b-marker-deleted.png` + `markers=[]`：删除后刻度消失。
- `u10-nfo-refresh.png` + `collections` 含 `Cu Movie Two RENAMED`：改 NFO 后自动刷新且进度保留。
- `u11/u12` 的 `available=1 → 0`：新增/删除文件被正确索引与标记不可用。
- `u13`：第二实例 `exit=0` 自行退出。

## 过程中发现并排除的假问题

- 「点击关闭无效」「点击删除标记无效」：实际是 **overlay 窗口拦截坐标点击**，不是产品缺陷；改用 Codex 的 cua 或键盘后正常。
- 「新增/删除延迟一步」：驱动脚本先触发刷新再改文件，顺序错误；修正后即时生效。
- 「B 没写入」：`SetForegroundWindow` 被前台锁挡住，`SendKeys` 发给了别的窗口；改用 `AppActivate` 后正确写入。

## 限制

- 截图是窗口级抓取，不能替代像素级视觉验收。
- 驱动脚本是一次性 `.scratch` 脚本，未固化为 `npm run test:e2e-evidence`；Ticket 39 的"可重复脚本"部分未完成。
- macOS、真实 SMB 共享未验证。
