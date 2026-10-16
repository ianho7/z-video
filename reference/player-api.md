# 极影视：安装包内可确认的接口

版本：2.45.2026082601。静态证据来自 `source-snapshot/background.js`、`player-static-evidence.json`；运行时补证来自 `work/local-app-user-data-live/logs/main.log` 与 `clientConsole.txt`。静态表格中的字段仍是代码构造结果；本次运行没有保存业务请求体、token、Cookie 或媒体路径。偏移量为从 0 开始的 UTF-16 字符位置。

目录共有 38 个去重路径，包含共享音频的 2 条路由、字幕删除及缩略图构造；这不是 NAS 全部 API 数量。字段是客户端实际构造过的参数，不代表全部必填参数。

| 方法 | 路径 | 用途 | 已观察到的参数 | background.js 偏移 |
|---|---|---|---|---|
| GET | `/transcode/decrypt/playaddr` | 音频播放旧版回退（共用转码服务） | file_path,from,encrypted_path,dest_fmt=OP | 4600214 |
| GET | `/transcode/playaddr` | 音频播放旧版回退（共用转码服务） | file_path,from,encrypted_path,dest_fmt=OP | 4600244 |
| GET | `/transcode/decrypt/audio/play` | 音频播放（共用转码服务） | file_path,from,encrypted_path,dest_fmt=OP | 4600432 |
| GET | `/transcode/audio/play` | 音频播放（共用转码服务） | file_path,from,encrypted_path,dest_fmt=OP | 4600464 |
| POST | `/zvideo/share/updateplaytime` | 共享播放进度 | collection_id,video_id,sec,chapter | 4746383 |
| POST | `/zvideo/video/updateplaytime` | 个人播放进度 | collection_id,classification_id,video_id,sec,chapter,audio_index,subtitle_index,subtitle_hash,video_duration,subtitle_setting | 4746672 |
| POST | `/zvideo/share/v3/info` | 旧版共享内容详情 | collection_id,get_type=all | 4746828 |
| POST | `/zvideo/collection/v2/info` | 旧版合集内容详情 | collection_id,classification_id,get_type=all | 4747037 |
| POST | `/zvideo/share/classification/collection/info` | 合集详情 | collection_id,classification_id,encrypted_path | 4747233 |
| POST | `/zvideo/collection/info` | 合集详情 | collection_id,classification_id,encrypted_path | 4747280 |
| POST | `/zvideo/share/classification/collection/video` | 合集剧集列表 | collection_id,classification_id,get_type=all,encrypted_path | 4747509 |
| POST | `/zvideo/collection/video` | 合集剧集列表 | collection_id,classification_id,get_type=all,encrypted_path | 4747557 |
| GET | `/transcode/decrypt/subtitle` | 外部字幕列表 | file_path,encrypted_path,from,specify_subtitles(JSON string) | 4747792 |
| GET | `/transcode/subtitle` | 外部字幕列表 | file_path,encrypted_path,from,specify_subtitles(JSON string) | 4747822 |
| POST | `/zvideo/collection/skip` | 设置跳过片头/片尾 | collection_id,previous,start,end,preview,selected=1 | 4748079 |
| POST | `/zvideo/video/media` | 视频关联媒体信息 | file_path | 4748307 |
| GET | `/transcode/decrypt/play` | 新版开始播放/获取播放信息 | file_path,play_env,video_codec=hevc,h264,mpeg4,support_format=3,audio_index,subtitle_index,encrypted_path,from,dest_fmt | 4748733 |
| GET | `/transcode/play` | 新版开始播放/获取播放信息 | file_path,play_env,video_codec=hevc,h264,mpeg4,support_format=3,audio_index,subtitle_index,encrypted_path,from,dest_fmt | 4748759 |
| POST | `/play/stop` | 旧版停止播放 | play_addr | 4748959 |
| POST | `/transcode/decrypt/play/stop` | 新版停止播放 | play_addr,isDecrypt(client-side route selector) | 4749091 |
| POST | `/transcode/play/stop` | 新版停止播放 | play_addr,isDecrypt(client-side route selector) | 4749122 |
| POST | `/play/switchtrack` | 旧版切换音轨/字幕/清晰度 | play_addr,start_time,video_codec,audio_index,subtitle_index,encrypted_path,from,dest_fmt | 4749323 |
| POST | `/transcode/decrypt/play/switch` | 新版切换音轨/字幕/清晰度 | play_addr,start_time,video_codec,audio_index,subtitle_index,encrypted_path,from,dest_fmt; encrypted_path/from also in query for decrypt route | 4749517 |
| POST | `/transcode/play/switch` | 新版切换音轨/字幕/清晰度 | play_addr,start_time,video_codec,audio_index,subtitle_index,encrypted_path,from,dest_fmt; encrypted_path/from also in query for decrypt route | 4749550 |
| GET | `/transcode/decrypt/formatmenu` | 旧版获取播放清晰度菜单 | play_env,video_codec=hevc,h264,mpeg4,support_format=3,file_path OR encrypted_path/from | 4749832 |
| GET | `/transcode/formatmenu` | 旧版获取播放清晰度菜单 | play_env,video_codec=hevc,h264,mpeg4,support_format=3,file_path OR encrypted_path/from | 4749864 |
| GET | `/transcode/decrypt/format` | 请求转码/格式信息 | encrypted_path,file_path,play_env,dest_fmt,video_codec=hevc,h264,mpeg4 | 4750050 |
| GET | `/transcode/format` | 请求转码/格式信息 | encrypted_path,file_path,play_env,dest_fmt,video_codec=hevc,h264,mpeg4 | 4750078 |
| POST | `/zvideo/share/v4/collection/info` | 加密共享合集详情(旧版回退) | collection_id,classification_id,get_type=all | 4750304 |
| POST | `/subs/searchsub` | 旧版搜索字幕 | q | 4750534 |
| POST | `/subs/getsub` | 旧版字幕文件列表 | sub_id | 4750680 |
| POST | `/subs/downloadsub` | 旧版下载字幕到 NAS | sub_url,file_name OR encrypted_path/from | 4750805 |
| POST | `/v2/file/remove` | 删除字幕文件（不等同回收站管理） | paths(array) | 4751087 |
| POST | `/subs/v2/searchsub` | 新版搜索字幕 | q | 4751450 |
| POST | `/subs/v2/preview` | 新版字幕预览 | sub_id,download_url; wrapper also accepts encrypted_path/from | 4751581 |
| POST | `/subs/v2/downloadsub` | 新版下载字幕到 NAS | download_url,file_name,sub_id,sub_title; encrypted version removes file_name and adds encrypted_path/from | 4751852 |
| URL builder; HTTP method not observed here | `/transcode/decrypt/thumb` | 剧集缩略图 URL 构造 | is_extdev,file_path,s,encrypted_path,dest_fmt=small,request_purpose=5,device_type=pcClient | 4769073 |
| URL builder; HTTP method not observed here | `/transcode/thumb` | 剧集缩略图 URL 构造 | is_extdev,file_path,s,encrypted_path,dest_fmt=small,request_purpose=5,device_type=pcClient | 4769118 |

## 调用链与返回值

登录获得的 token/NAS 身份先同步到客户端状态；视频请求使用 `global.ApiHost`，而不是固定云端域名。原生播放器接收主进程取得的流地址。

新播放链调用 `GET /transcode/play`；有 `encrypted_path` 时改为 `/transcode/decrypt/play`。代码遇到 `code=404` 时会回退到 `/transcode/playaddr`，再调用旧版合集详情和清晰度菜单。`play_env` 为局域网/具备连接能力时 1，否则 2；默认格式按路径选择 `OP` 或 `FHD_EX`。不能假定所有 NAS 固件都支持相同版本。

新接口消费 `data.uri`、`play_format_list`、`current_fmt`、`resolution`、`subtitle_list`、`audio_list` 等字段；接口返回相对 URI 时拼接 NAS origin，绝对 URI 则直接处理。应使用服务端返回的地址，不应猜测流路径。

进度上报包含合集、分类、视频 ID，以及秒数、章节、音轨、字幕等；普通上报代码间隔大于 10 秒，强制上报可立即触发。`subtitle_setting` 作为 JSON 字符串发送。

## 本地 App 运行时补证

用户在解包副本中完成登录后打开“极影视”并播放成功。日志直接观察到：

- `GET /transcode/video/streams` 完成；
- 本地播放代理地址形态为 `/splay/<opaque>/<media>`；opaque 值和媒体路径未保存；
- 主进程启动 `UZPlayer.exe`，并向动态 PlayerServer 端口 `13617` 返回实例信息；
- 播放器先回报成功结果，随后回报播放秒数 `2`、`14`、`26`，客户端执行播放进度上报。

因此，静态 `/transcode/play`/`/transcode/decrypt/play` 是代码层面的播放地址接口候选；在这次桌面闭环中，最终可观察到的是流准备接口、本地 `/splay/` 代理和原生播放器 TCP 回报。实现替代客户端时应先复现登录态与 NAS 返回的流 URI，再按客户端能力选择浏览器播放或原生播放器。

## Cookie 的精确构造

`_a()` 构造 `{app:"video",token:encodeURIComponent(token),plat:"pc",nasid,clientPublicIp,version,device_id,device:encodeURIComponent(device)}`；`ma()` 把 `nasid` 改为 `nas_id` 并对所有值再次 `encodeURIComponent`，然后用 `; ` 拼接。因此 token/device 在这条主进程 Cookie 路径中存在两层 URI 编码。证据在 `background.js` 的 `_a` 和 `ma`，紧随偏移 4752240 附近的字幕包装函数之后；以原始函数内容为准。这个手工 Cookie 构造与登录页请求头不是同一种承载方式，不能直接混用。

## 回收站边界

`POST /v2/file/remove` 的播放器调用只传 `{paths:[subtitlePath]}`。静态代码没有给出该请求是否一定进入回收站、保留多久、如何还原的服务端保证。它不能替代回收站“列表、还原、彻底删除、清空、个人/家庭/外部设备来源”的接口。

## 尚未获得的完整业务接口

安装包在登录后从 NAS 加载 `/home/`。影视分类/片库首页、搜索、扫描目录、刮削、海报、编辑、收藏、管理，以及回收站页面的大量调用可能只在 NAS 下发的脚本中。需要该 NAS 的 `/home/` 主页面与它实际引用的 JS 分块，才能继续做完整清单。API 响应完整 schema、固件能力、权限规则、验证码/二步验证和原生播放器内部请求也没有通过运行确认。
