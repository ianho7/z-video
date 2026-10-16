# 运行时链路：登录 → 极影视 → 播放

验证日期：2026-10-16。目标：用户自己的 `Z2S-6K58`，入口为 `https://zconnect.cn/home/`。本记录只保留方法、路径、状态码和参数名；不保存账号、密码、短信验证码、token 值、NAS 路径或媒体内容。

## 结论

登录凭证确实会继续参与后续业务请求。当前浏览器会话在完成“账号密码 → 短信验证码 → 登录”后，极影视可以加载片库、打开影片详情并形成观看进度；因此“登录后才能播放”的链路已得到运行时证明。

播放器的确切“开始播放”请求没有在当前页面主 CDP 网络目标中单独出现：播放面由内嵌应用/播放器表面处理。静态代码仍明确给出 `/transcode/play`（以及失败回退 `/transcode/playaddr`）获取实际播放地址；运行时已观察到其前置媒体接口和 `/transcode/play/stop` 成功返回，且界面显示实际观看时间。

## 观察到的链路

1. 用户完成短信验证后，页面回到 `/home/`，标题变为 `Z2S 极空间`，NAS 名称显示为 `Z2S-6K58`。

2. 点击“极影视”后，内嵌页面进入：

   `https://zconnect.cn/apphome_video/video/homePage?v=2.3.2026082801`

3. 下列请求在当前登录会话中返回 HTTP 200：

   - `GET /zvideo/services/status`
   - `POST /zvideo/classification/list`
   - `POST /zvideo/video/v2/playlist`
   - `POST /zvideo/favorite/list`
   - `POST /zvideo/collection/person`
   - `POST /zvideo/collection/video`
   - `GET /transcode/thumb`
   - `GET /transcode/video/streams`

4. 选中界面显示为 `MDCM-0014` 的影片后，详情页显示“播放”按钮。触发播放后，界面出现观看进度；随后界面显示“已观看 02 分 16 秒”，证明不是只打开海报或详情页。

5. 播放控制请求中观察到：

   `POST /transcode/play/stop` → HTTP 200

   请求参数名包括：

   `play_addr`, `isDecrypt`, `app`, `plat`, `version`, `device_id`, `device`, `_l`, `token`, `nasid`

## 凭证证据

登录后的页面 cookie 名称包括 `zenithtoken`、`nas_id`、`device_id`、`version` 等；会话存储中存在 `xnas_session`。对影片接口请求体做脱敏检查，确认请求会带：

`token`, `nasid`, `plat`, `version`, `device_id`, `device`, `_l`

因此新客户端不能只保存登录成功后的页面，也不能只依赖一个普通 Bearer token。至少需要维护网页协议使用的 token、NAS 标识和设备元数据；短信验证是登录阶段的一部分，播放阶段不需要再次输入短信码，除非服务端要求重新认证。

## 对自行开发客户端的直接意义

最小可行闭环现在可以确定为：

`短信登录 → 保存会话/设备字段 → 分类或片库 → 详情/文件 → transcode 播放地址 → 播放器`

实现时应优先使用服务端返回的播放 URI，不自行拼接媒体地址。`/transcode/play` 的静态参数、加密播放和旧接口回退见 [NAS 媒体 API](nas-video-api.md) 与 [媒体 API catalog](nas-video-api-catalog.json)。

## 尚未声称已经证明的部分

- 本次没有把 token 值写入文件，也没有验证 token 过期、刷新和跨设备复用规则。
- `/transcode/play` 的具体响应 JSON 和最终媒体 URI尚未从当前内嵌播放器目标中单独取出；当前证据证明了播放前置接口、实际观看进度和停止接口，不把它夸大为完整播放地址响应证据。
- 没有执行删除、清空、回收站还原或其他写入性文件操作。
