# zSpace Windows 2.45 核心路径静态逆向报告

> 调查日期：2026-10-19  
> 调查性质：仅静态证据；未执行官方客户端、未登录、未保存运行时凭证或媒体数据。  
> 任务边界：不修改 `z-video` 源码、Cargo 文件或测试文件，不提交、不推送。

## 1. 目标与证据身份

| 项目 | 结果 |
|---|---|
| 目标 | `D:\Downloads\zspace_windows_2.45.2026082601_082620.exe` |
| 目标 SHA-256 | `3b645f03ff9b9e72bc1ee46819e3da81b9fbf4259bf5d79bd849ed3d45dcff28` |
| 目标类型 | NSIS-3 Unicode 外层 PE32/x86 安装包；产品版本 `2.45.2026082601` |
| 主要 JS 载荷 | `resources\app.asar`，SHA-256 `4a8f9a8dd0d476d4ebffc62d02fdbb71da9401be9b1aab1a5cf2626ee09103a4` |
| JS 主 Evidence | `ev_87f957d5280e45693d8665c784cbea225f70e0fef5220bb8b227b3c3880724e0` |
| JS Summary Evidence | `ev_01efd26f1f93450bf31274dd96103c396951d74fdec385be5fbd661e5d331995` |
| REA JS provider | `rea-javascript-application`，版本 `1`；authority=`shipped-artifact`，confidence=`derived` |
| 针对性 JS Evidence | `ev_188214d0e1e9f845b26c7b195d6dd81c523285c9b1f8625a6b5c740f2d0d14f5`；Summary `ev_b4c390e31645f2d8fb23c0defd6ef8d70b69fd89c73b2d16524127158f198be5` |

REA 对完整 ASAR 的统计为 1,865 个相关文件、1,126 个 JS 文件解析成功、0 个解析失败；针对性分析选择了 `background.js`、`preload.js`、`package.json` 和登录/壳层 JS 文件。针对性分析的临时目录 SHA-256 为 `bbe5bddd92eabae9301932373de669bfb04ab48cbc865cd4d0725935e29c9022`，它只标识解包目录，不替代官方 ASAR SHA。

## 2. 原生分析限制（明确结论）

已按 REA native artifact 流程对安装包执行 `open_binary`，但原生 provider 不可用：

- `binary_overview` 的 Ghidra candidate 为 `not_configured`，原因是未配置 `GHIDRA_INSTALL_DIR`；Hopper 在 Windows 上为 `unsupported_host`；IDA 未配置。
- `inspect_with_objdump` 返回 `capability_unavailable / ERR_REA_WINDOWS_NATIVE`。
- PE resource 和 managed inspection 因目标尺寸超过当前保留上限失败，未产生可用的部分 Evidence。
- 因此没有可信的原生函数反编译、调用者/被调用者或 DLL 内部 UDP/广播实现证据。本报告不把 JS 中的 native 函数名当作 DLL 内部实现。

没有等待 Ghidra，也没有安装额外软件；后续结论来自 NSIS/7z 目录清单、ASAR 内容、REA JS 分析和已有脱敏 web/runtime 参考文档。JS 是惰性解析，未执行；JS Evidence 的 request family 为 partial/0 retained relations，不能用“未提取到”证明不存在。

## 3. A：登录、MFA、token/nasid/session 持久化

### Observed

来自 `static/js/chunk-84200ec6.b0586271.js` 和 `chunk-3b0dd3ec.bee8efbf.js`：

- 认证包装函数明确包含 `GET /key/pub`、`POST /auth/login`、`POST /sms/usend`、`POST /sms/ucheck`、`POST /captcha/check`、`POST /quick/nasid`，以及邮箱/二维码登录分支。
- 登录页先取得云端/NAS 公钥，再对用户名和密码做 RSA 公钥加密；`POST /auth/login` 的数据是加密后的用户名、密码，成功响应读取 `data.token`、用户名、显示名、用户信息和头像。
- 新设备分支识别业务码 `N001414`，设置 `smsCheckType="new_device"` 和 `newDeviceCheck=true`。验证码校验调用 `/sms/ucheck`，传入加密用户名、`key_id`、NAS 身份字段和用户输入的短信码；成功响应读取 `sms_proof`，随后把 `sms_proof` 放入 `/auth/login`，而不是把短信码直接当 token 使用。
- `background.js` 的 Vuex 初始化使用 persisted-state，存储名为 `vuex`；存储实现以 Electron `userData` 为根、使用 `zspace` 项目名和 `nodejs` suffix 计算 JSON 配置路径，并以约 200 ms debounce 写盘。
- `user/historyUsers` 中保存登录历史。`ADD_HISTORY_USER` 在“记住登录”时保留 token；点击历史用户时，如果记录中存在 token，代码会恢复 nasId、用户名、token、设备信息并直接发送 `signin`，不再要求重新输入密码。退出当前用户的分支会清空历史项 token 和时间戳。

### Derived

官方 Windows 客户端的“重新启动后无需重新输入密码”依赖两层状态：持久化的 Vuex/history record，以及当前会话中的 token/nasId。持久化代码把 `encryptionKey` 传为 undefined，但 bundled storage 仍有内置的加解密兼容分支；没有读取真实 userData 文件，不能把本地文件最终形态断言为明文或系统安全存储。

### Unknown

- token 过期、刷新、撤销和跨设备复用规则未由本次静态证据确认。
- `/sms/usend` 的发送条件、短信供应商返回值和“手机未收到验证码”的服务端原因未确认。
- `N001414` 的完整业务语义可由 UI 分支确认，但其服务端状态机、重试次数和设备指纹规则仍未知。

## 4. B：NAS/IP 设备发现与局域网扫描

### Observed

- `background.js` 声明了 native SDK 边界：`libzrpc_init`、`libzrpc_refresh`、`libzrpc_check_ports`、`libzrpc_start_service`、`libzrpc_get_nas_status`、`libzrpc_search_device`、`libzrpc_set_private_network_access`、`libzrpc_detect_nas` 等。
- 主进程的 `searchDevice()` 直接调用 `libzrpc_search_device()` 并 JSON.parse 返回值；`ipcMain` 的 `searchDevice` handler 过滤 `nas_id` 以 `P0` 开头或第二位不是 `0` 的条目后返回 renderer。
- 登录 UI 消费的设备字段明确有 `nas_id`、`nas_ip`、`nas_name`；选择设备时去掉 `:5055` 后建立内部连接。默认直连端口在 UI/SDK 调用路径中为 `5055`。
- 直连路径调用 `libzrpc_set_private_network_access(ip, port, ...)`；SDK service 配置把本地代理端口与远端 NAS 端口绑定，随后 renderer 使用本地 `global.ApiHost` 访问 NAS API。

### Unknown

没有原生 provider，因此无法证明 `libzrpc_search_device()` 内部使用广播、UDP、mDNS、ARP、HTTP 探测中的哪一种，也没有观察到其目标地址、超时、广播端口、请求内容或完整返回 schema。`libzrpc_detect_nas` 的静态声明存在，但其调用路径和语义未解析。不能把 5055 推广为所有发现流量的端口，也不能把 `nas_ip` 字段推断为扫描协议字段。

## 5. C：极影视分类、片库、详情、剧集、播放、进度

### 5.1 官方 ASAR 中已确认的壳层/播放器接口

`background.js` 的 video wrapper 明确构造以下请求；均通过 `global.ApiHost`、`apiTarget:"direct"` 和手工 Cookie 发出：

| 用途 | 方法和路径 | 观察到的参数/字段 |
|---|---|---|
| 共享进度 | POST `/zvideo/share/updateplaytime` | `collection_id`, `video_id`, `sec`, `chapter` |
| 个人进度 | POST `/zvideo/video/updateplaytime` | 上述字段，加 `classification_id`, `audio_index`, `subtitle_index`, `subtitle_hash`, `video_duration`, `subtitle_setting`；后者会 JSON.stringify |
| 详情/合集 | POST `/zvideo/collection/v2/info` | `collection_id`, `classification_id`, `get_type:"all"` |
| 详情/合集新旧分支 | POST `/zvideo/collection/info` 或共享变体 | `collection_id`, `classification_id`；有 `encrypted_path` 时切换共享路径 |
| 剧集列表 | POST `/zvideo/collection/video` 或共享变体 | `collection_id`, `classification_id`, `get_type:"all"`, 可选 `encrypted_path` |
| 片头片尾 | POST `/zvideo/collection/skip` | `collection_id`, `previous`, `start`, `end`, `preview`, `selected` |
| 媒体信息 | POST `/zvideo/video/media` | `file_path` |
| 新播放地址 | GET `/transcode/play` 或解密变体 | `file_path`, `play_env`, `video_codec:"hevc,h264,mpeg4"`, `support_format`, 音视频轨道、`encrypted_path`, `from` |
| 旧播放回退 | GET `/transcode/playaddr` 或解密变体 | `file_path`, `dest_fmt` 等；新播放返回 404 时进入此分支 |
| 播放停止/切轨 | POST `/play/stop`、`/transcode/play/stop`、`/play/switchtrack`、`/transcode/play/switch` | `play_addr`、轨道索引、起始秒数、格式等 |

播放器入口把 `path/vid`、`coll`、`clsf`、`video_id`、`seek/sec`、`encrypted_path`、`from`、`version_id`、`chapter` 和字幕/音频选择写入会话状态。详情响应使用了 `history`、`skip`、`extend_type`、标题、年份、外部 ID 和 `type`；剧集项使用 `video_id`、`file_path/path`、`file_name`、`ep/episode` 和文件大小。完整媒体路径和播放 URL 未写入本报告。

进度上报在播放秒数变化且超过约 10 秒，或收到强制上报事件时执行；个人内容调用 `/zvideo/video/updateplaytime`，共享内容调用 `/zvideo/share/updateplaytime`。这是 NAS 写入操作，不是只读请求。

### 5.2 分类/片库列表的边界

本次官方 ASAR 字符检索没有发现 `/zvideo/classification/list` 或 `/zvideo/video/v2/list` 的字面量；ASAR 里的 Electron 壳层会加载 NAS 侧页面，片库 UI 代码不等同于本地打包 JS。已有仓库参考文档中的 web 证据记录了：

- POST `/zvideo/classification/list`：侧栏分类入口；
- POST `/zvideo/video/v2/list`：已观察到 `classification_id`、`start`、`limit`、`system:7`；
- POST `/zvideo/collection/v2/info`：已观察到 `collection_id`、`classification_id`、`get_type:"all"`。

这三项是现有 web/runtime 参考证据，不冒充本次 ASAR 的原生分析结果。它们足以说明当前 z-video 的列表路径有可核对的候选，但不能单凭安装包静态分析确认当前 NAS 固件实际返回的分类/列表 schema。

## 6. D：与当前 z-video 的明显请求差异

### Observed comparison

官方壳层的 Cookie 构造函数（`background.js` 约 4,752,000 字符位置）包含：

`app=video`、token、`plat=pc`、nas 身份、`clientPublicIp`、版本、`device_id`、设备类型；另一条 renderer builder 还出现 `_l` 和 session `uuid`。字段值会做 URI 编码，`nasid` 会转成 `nas_id`。官方请求目标是 SDK 建立的本地 `global.ApiHost`，不是固定写死的 NAS URL。

当前 z-video 的 `src/nas/client.rs`（`build_nas_cookie`、`get_classifications`、`get_collections`）目前只构造 `token` 和 `nas_id` Cookie，并把 token、`rnd`、`webagent=v2` 放入 URL；其列表表单是 `classification_id/start/limit/system/token` 加可选 `nasid`。当前 `SavedCredentials` 也只持久化 server、username、可选 password/token/nas_id，没有官方壳层明确使用的 `device_id`、device、version、clientPublicIp、locale/uuid 元数据。

### Inferred risk

当前列表出现“该分类下暂无影视内容”时，最值得优先核对的不是 UI 数组，而是请求身份和承载方式：官方 app 的 direct proxy Cookie 字段集合、编码和本地 SDK proxy 与当前 Rust 直接请求之间存在明显差异。这个差异可以解释业务接口返回空数据或参数错误，但仅凭静态证据不能把它定为唯一根因；必须查看本地操作日志中的脱敏请求字段、HTTP 状态、业务 code 和响应 data 形状后再修复。

## 7. Evidence 分层与覆盖结论

### Observed

- 目标 SHA-256、ASAR SHA-256、NSIS/ASAR 结构和上述 JS 字面量/调用构造。
- `/auth/login`、`/sms/ucheck`、`libzrpc_search_device` 边界、Vuex/historyUsers 持久化、播放器 API 方法/路径/字段。
- REA JS 分析完成且 0 parse failures；针对性分析也完成且 0 parse failures。

### Derived

- 登录成功后的恢复路径依赖持久化 history token；“cargo run 后每次重新登录”与当前 z-video 的持久化/恢复实现是否真正接线，需要看运行时日志和 keyring 实际内容。
- 官方 app 的播放核心路径是 `collection info/video -> media/play -> local player -> updateplaytime`；播放器本地端口和播放地址是会话生成值，不能硬编码。

### Inferred

- 当前 z-video 的空列表/参数错误优先怀疑 app Cookie/设备元数据/SDK proxy 差异，而不是直接认定分类 ID 错误。
- 官方设备扫描的具体协议可能在 native SDK 中，但在 Ghidra 不可用时不能进一步确认。

### Unknown

1. native SDK 的函数体、广播/UDP/mDNS/HTTP 扫描细节、端口探测和完整设备返回 schema；
2. token 刷新/失效状态机、真实 userData 文件的加密形态、短信发送失败原因；
3. 官方壳层加载的 NAS 片库页面在本次安装包中的实际列表请求和响应 schema；
4. 当前 NAS 固件对每个请求字段的强制性、业务 code 的完整枚举、播放器实际运行时的完整响应和媒体流细节。

## 8. REA trace 结果与限制

针对 `/zvideo/video/updateplaytime` 的 trace Evidence 为 `ev_1fd3d74aeda4bd6cb3601e940abedb009f3a3b066cf0d991da414f10c84a55bf`；针对 `searchDevice` 的 trace Evidence 为 `ev_3c3828e10dd0ac76d90c220c97f47965b05d338bf67c0d03d4cbc8981f16cd6b`。两者均为 `no-match`，source graph 为 partial。REA 明确说明“无 literal graph match 不等于功能不存在”，所以本报告以 ASAR 原文静态位置为主，不把 trace no-match 当作否定证据。

完整 ASAR 分析还提示 `504.html` 有未分析的 inline JS、动态属性/调用和运行时注册未执行、request relation extractor 未保留关系；这些限制已经纳入上述 Unknown。

## 9. 清理记录

报告写入并核验后，已清理本次创建的临时目录 `.tmp-re-zspace-20261019`。该目录只包含本次 ASAR/NSIS 提取和 REA 输入副本；没有从中删除仓库源文件或报告。
