# 极空间：登录、极影视、回收站逆向结果

本目录是历史逆向资料；新项目的已确定方向与开发入口见 [项目 README](../README.md) 和 [开发交接](../docs/handoff.md)。下文 Electron、Qt、VLC 和 SDK 是原客户端依赖，不代表新项目必须采用。

分析日期：2026-10-16。已在用户完成短信验证登录后，完成脱敏 Web 运行时验证；并在安装包解包副本中完成本地 App 登录、进入极影视和真实播放验证。

## 先看结果

网页比只看 EXE 更直接：大部分业务逻辑在网页 JS。已从你提供的安装包、云端公开网页及你 NAS 的公开静态资源提取接口；本次登录由用户在页面完成，未记录账号、密码、短信验证码或 token 值。

| 对象 | 已确认身份 | 结果入口 |
|---|---|---|
| 桌面安装包 | `2.45.2026082601`；已验证本地登录 → 极影视 → 流准备 → UZPlayer/VLC 播放 → 进度上报 | [桌面登录](login-analysis.md)、[桌面播放接口](player-api.md)、[本地 App 运行时](runtime-desktop-app-2026-10-16.md) |
| 你的 NAS | `Z2s-6k58` 解析到 `192.168.5.2`；公开 `/home/static/version` 返回 `2.3.2026082801` | [NAS 媒体 API](nas-video-api.md)、[机器可读目录](nas-video-api-catalog.json) |
| 云端网页 | `https://zconnect.cn/home/`，入口 `index.a785a6de.js` | [网页登录](web-login-analysis.md)、[回收站](recycle-api.md) |

你的 NAS 入口为 `index.3608137b.js`，与云端不同。以下统计不能解读为所有固件版本的完整后端 API。

## 已提取的接口与调用协议

| 模块 | 已获得内容 | 边界 |
|---|---|---|
| 登录 | 桌面登录模块 18 个封装；网页目录 40 个端点/变体，含密码、验证码、二维码、会话恢复及相关流程 | 变体不等同去重接口数；网页详细人工报告基于云端脚本，NAS 逐条一致性未全部复核 |
| 极影视 | NAS 目录 197 个方法/路径组合，其中核心极影视 API 模块为 164 个；其余含字幕、播放及其他共用媒体服务。桌面相关目录另有 38 条路径 | 官方 Web 与桌面客户端已有登录后播放证据；替代客户端独立连接与播放尚未实现 |
| 回收站 | 已定位个人/家庭回收站的列表、还原、批量还原、合并还原、清空、删除及设置等封装和调用参数 | 详细报告和精选 catalog 以云端为主；NAS 个人/家庭页面脚本与云端不同，未完成逐条人工对照 |

登录关键点：云端先解析 NAS/集群，再向 NAS 取公钥，用户名、密码分别 RSA 加密后提交 `/auth/login`。普通浏览器不需要桌面 `libzrpc`；桌面使用原生代理。网页常规 POST 使用表单编码，按请求条件附加 `token`、`nasid` 和客户端信息；不能统一改成 Bearer token。`/auth/token` 在已检查代码中用于会话/用户状态恢复，没有证据证明它刷新 token。

极影视常用链：分类 `/zvideo/classification/list` → 片库/播放列表 → 详情 `/zvideo/collection/info` → 剧集 `/zvideo/collection/video` → 播放地址/流信息 → 播放器。Web 端运行时已确认分类、片库、详情、缩略图/流信息返回 200，并观察到 `/transcode/play/stop` 返回 200；本地 App 进一步观察到 `/transcode/video/streams`、本地 `/splay/<opaque>/<media>`、UZPlayer 回报和进度上报。静态代码仍显示 `/transcode/play` 及加密/旧接口回退；实际客户端应使用服务端返回的 URI。完整记录见 [登录到播放运行时证据](runtime-login-play-2026-10-16.md) 和 [本地 App 运行时](runtime-desktop-app-2026-10-16.md)。

## 运行依赖

桌面：Electron 外壳，`@lwahonen/ffi-napi`、`ref-napi` 和 `sdk/libzrpc_x64.dll` 提供 NAS 代理；视频通过 `UZPlayer.exe` → VLCQt → libVLC，并依赖 Qt6、Windows C/C++ 运行库。运行时已确认主窗口能进入本地登录页，并在登录前初始化 `VlcPreload.exe`、`UZPlayer.exe` 和动态 PlayerServer 端口。主进程通过本地 TCP 给播放器发送播放地址、鉴权信息和控制消息。原始 DLL 导入/导出、18 个 FFI 绑定、启动参数及报文格式详见 [依赖与播放器协议](dependencies-player-analysis.md)；启动证据见 [本地 App 运行时](runtime-desktop-app-2026-10-16.md)。

网页：Vue、Vue Router、Axios、公共组件及按路由加载的业务分块；独立 `/player` 页面包含 xgplayer 和媒体播放相关代码。桌面播放还依赖 Electron 主进程、动态 PlayerServer、本地 `/splay/` 代理、UZPlayer/VLCQt/Qt6；是否能直播放取决于浏览器解码能力、NAS 返回格式及转码服务。NAS 服务端组件和部署清单无法仅凭客户端完整还原。

NAS 与云端已提取媒体目录的差集只有 NAS 侧 5 条额外声明：`POST /transcode/video/process/{tasks,delete,clear,add,query}`。它们来自共享转码组件，不应误当成 5 个极影视主流程必需接口。核心极影视 chunk `53914.d64301c5.js` 两端 SHA-256 相同；这不等于整个产品版本一致。

## 文件与证据

| 文件 | 用途 |
|---|---|
| [网页登录 JSON](web-login-api-catalog.json) | 参数位置、URL/base 变体、鉴权和源码证据 |
| [回收站 JSON](recycle-api-catalog.json) | 精选接口、调用参数与证据 |
| [NAS 全部已提取请求封装](nas-all-request-wrappers.json) | 包括共享组件及邻近模块，不能全计入这三个目标功能 |
| [NAS 资源 manifest](nas-source-manifest.json)、[云端 manifest](web-source-manifest.json)、[安装包 manifest](source-manifest.json) | 获取 URL、源文件身份、SHA-256；对应目录 `nas-source-snapshot`、`web-source-snapshot`、`source-snapshot` 保存原始脚本 |
| 原始脚本与 REA 证据包（未迁入） | 打包检查、解包和选定 JS 的静态分析；原始位置见 [交接说明](../docs/handoff.md) |

安装包 SHA-256：`3b645f03ff9b9e72bc1ee46819e3da81b9fbf4259bf5d79bd849ed3d45dcff28`。

ASAR SHA-256：`4a8f9a8dd0d476d4ebffc62d02fdbb71da9401be9b1aab1a5cf2626ee09103a4`。REA 检查父记录：`ev_b9c88d24f725641f4c70696da7cc005a49db3baff9608578dc3ecef41a1537ad`；选定网页 JS 分析父记录：`ev_ea332053ab496f23c32c17d3ec2426aae5c7dd55eb118032f7096fec605453c4`。REA 语义图为有范围/资源上限的部分分析；其无发现不表示功能不存在。额外的接口清单来自保存脚本的 AST 提取及人工调用点检查，不冒称全部由 REA 自动证明。

## 尚未验证

已证明一次真实 Web 登录后的业务访问和观看进度，也已证明本地 App 的登录到极影视播放闭环。仍未证明 token 过期/刷新规则、完整返回值 Schema，以及 `/transcode/play` 在内嵌播放器目标中的完整响应；动态生成接口、未收集模块、原生 SDK 内部协议和 NAS 后端仍可能增加依赖。回收站仍未执行真实写操作。

两分钟下一步：打开 [登录到播放运行时证据](runtime-login-play-2026-10-16.md)，先按其中的凭证字段和最小闭环设计客户端；本次验证不需要你再次提供登录信息。
