# 本地 App 运行时证据：启动 → 登录 → 极影视 → 播放

验证日期：2026-10-16。目标是安装包 `zspace_windows_2.45.2026082601_082620.exe` 的解包副本；未执行安装器，也未修改系统安装目录。

## 当前结论

桌面客户端可以在保留 Electron 默认沙箱的条件下启动；用户已在解包副本中自行完成账号密码和短信验证，随后进入本地 NAS 首页、打开“极影视”并成功播放。凭证没有发送给助手。

已证明的本地链路是：

`登录态 → 127.0.0.1:13579/home/ → 极影视内嵌页面 → /transcode/video/streams → /splay/<opaque>/<media> → UZPlayer/VLC → 播放进度上报`

桌面播放器会在登录页阶段预初始化：

`极空间.exe → VlcPreload.exe → UZPlayer.exe → PlayerServer`

本次登录后的播放会话使用 PlayerServer `13617`；端口是动态分配的，不能写死为客户端协议。

## 运行时观察

- 客户端版本：`2.45.2026082601`
- Electron：`33.3.1`
- Chromium：`130.0.6723.170`
- 登录入口：`app://./index.html#/login`
- 登录后主页面：`http://127.0.0.1:13579/home/`
- 极影视页面：`/apphome_video/video/homePage?v=2.3.2026082801`
- 播放器目录：`resources/app.asar.unpacked/uzplayer`
- 播放器进程：`VlcPreload.exe`、`UZPlayer.exe`
- 本次 PlayerServer：`13617`（动态端口）
- 运行时流准备：`GET /transcode/video/streams` 返回完成
- 本地播放代理：`/splay/<opaque>/<media>`（opaque 值已省略）
- 播放器回报：收到 `result=0`，随后上报播放秒数 `2`、`14`、`26`

原始本地日志在解包验证目录的 `work/local-app-user-data-live/logs/main.log` 和 `work/local-app-user-data-live/clientConsole.txt`；本报告不复制设备标识、电脑名、账号、密码、短信验证码、token 或媒体路径。

## 证据边界

本次已证明官方桌面客户端的登录到真实播放闭环；本报告省略 token、Cookie、媒体路径或请求体，原始用户日志可能含敏感信息，未迁入新项目。静态代码声明的 `GET /transcode/play`、`/transcode/decrypt/play` 仍是播放地址获取的协议候选，当前桌面日志直接观察到的是 `/transcode/video/streams` 和本地 `/splay/<opaque>/<media>`。替代客户端的独立连接与播放尚未验证。

Web 端的登录后片库、详情、观看进度和播放停止请求见 [登录到播放运行时证据](runtime-login-play-2026-10-16.md)。桌面播放器的静态 TCP 报文和依赖见 [依赖与播放器协议](dependencies-player-analysis.md)。

本次没有执行删除、清空或回收站还原；播放期间客户端执行过观看进度上报，属于 NAS 写入请求，尚未单独核对其持久化结果。
