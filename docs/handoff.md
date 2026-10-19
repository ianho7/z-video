# 开发交接

记录日期：2026-10-16。此目录已经包含报告和设计文档，尚无应用代码。后续在 `D:\project\z-video` 开发；无需重新执行 REA 安装或复制全部历史输出。

首版范围已经用户确认：局域网、NAS 现有片库及观看进度、基础播放、Windows 先交付、个人自用。详细能力与后置项见 `architecture.md` 的“首版范围”和 `adr/0002-first-release-scope.md`，接手时无需重新询问这五项。

## 已做的工作

- 分析目标安装包 `zspace_windows_2.45.2026082601_082620.exe`，提取桌面登录/播放器依赖及静态调用。
- 收集云端和指定 NAS 的公开静态脚本，整理登录、影视及回收站接口目录。
- 用户自行完成账号密码和短信验证；观察过 Web 业务访问，并在官方安装包的解包副本中完成桌面登录到实际播放。
- 已迁入 22 个参考文件；没有迁入官方运行时用户目录、原始日志或 118 MB REA 总证据包。

## 证据与限制

| 问题 | 当前证据 | 仍缺少什么 |
|---|---|---|
| 官方 Windows 客户端能播放吗 | 本地 `/splay/`、UZPlayer 成功结果、递增播放进度 | 替代实现尚未复现 |
| 替代客户端能独立登录吗 | 静态 RSA/会话流程及用户完成的官方登录 | Rust 独立请求、MFA 错误/过期处理 |
| 能直接从 NAS 获取视频吗 | 静态播放端点及官方本地代理流 | 脱离官方进程的真实连接与流获取；LAN 和远程路径分别确认 |
| 播放返回结构完整吗 | 已整理客户端消费字段 | 完整脱敏样本、流地址有效期、音轨/字幕行为 |
| Win/mac 均可工作吗 | 当前只有 Windows 官方客户端运行证据 | Slint 自有客户端两平台运行证据 |
| 回收站可写吗 | 静态封装及参数 | 未执行实际删除、清空、还原 |

“观察到进度上报”表示客户端执行上报动作；不等同于 NAS 已持久化且重启后恢复。类似地，日志显示请求耗时不独立证明其 HTTP 状态码。

## 资料阅读顺序

先读 `reference/runtime-desktop-app-2026-10-16.md` 和 `reference/runtime-login-play-2026-10-16.md`；登录接入读 `reference/web-login-analysis.md`、`reference/login-analysis.md`；影视业务读 `reference/nas-video-api.md` 及 catalog；播放集成读 `reference/player-api.md` 和 `reference/dependencies-player-analysis.md`。

JSON catalog 是从选定版本脚本提取的调用目录，不是固件完整 API 规范。遇到资料冲突，以明确来源和覆盖范围的证据判断，不能把一处静态候选写成已成功的运行时请求。

## 原始证据位置

未迁入的原始脚本和完整 REA 证据仍在：

`C:\Users\admin\Documents\Codex\2026-10-16\npx-rea-agents-latest-setup-rea\outputs`

其中 `source-snapshot/`、`nas-source-snapshot/`、`web-source-snapshot/` 对应参考资料的 manifest。仅在需要核对调用点时读取匹配文件；分析静态脚本无需运行它们。

原始日志位于同一历史工作区的 `work/local-app-user-data-live/`，可能含账号、token、会话路径和私人媒体信息。参考文档脱敏不意味着原始日志没有敏感信息；不能把用户目录、日志或现有会话放进开发仓库。需要额外样本时现场采集并脱敏。

## 接手后的行动

先明确 LAN 直连的最小独立链路，检查 Windows 原生构建环境，用可重复获取的流验证 Slint 视频集成。网络连通和 GUI 集成分别给结论，失败时定位边界，再决定依赖。macOS 和远程访问后置，不作为首版阻塞。后续逐步完成片库、详情、播放与进度闭环；进度必须核对 NAS 保存及再次打开时的恢复，不能只看客户端发送日志。

插件只按 `metadata-extension.md` 预留模型和调用边界。先个人自用；公开分发及闭源/开源选择后置，播放器构建来源和许可条件在选型时记录。

## Ticket #9 Skia 候选交接（2026-10-19）

候选分支使用 Slint 与 `slint-build` rev `0ade85bfd0a88b6de2f87f767420975f98c141d0`，Rust `1.99.1`。upstream PR #13821 的 merge commit 已核对为 `e492aa7`；候选依赖使用其后包含该功能的 rev。Windows 通过 `backend-winit + renderer-skia + accessibility` 构建，运行环境设置 `SLINT_BACKEND=winit-skia`。

已完成 Windows 原生 fixture：同一 `poster_grid_preview.exe` 生成 Skia 默认图和 `Z_VIDEO_REDUCED_TRANSPARENCY=1` 不透明回退图，logical `1440x900`、PNG `1800x1125`、`GetDpiForWindow=120`、scale override `125%`。证据和命令见 `docs/design/evidence/ticket-09/README.md`。blur 只在侧栏/工具栏，海报网格、卡片、详情和视频区域未加入 blur。

非 Windows renderer、macOS/Linux 运行、`renderer-skia-software`、真实视频帧和性能比例仍未验证。高对比/低透明度目前通过环境变量分支验证，不等于已接入系统设置探测。回滚必须同时撤销 git-only Slint 配置和 `.slint` 中的 `backdrop-blur`，再回到稳定依赖。
