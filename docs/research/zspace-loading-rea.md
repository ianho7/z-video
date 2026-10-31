# 极影视海报/详情加载慢：REA 有界静态研究

> 研究日期：2026-10-31。只读；未安装、启动或执行安装包，未读取 `work/local-app-user-data-live`，未访问私有 NAS API、session 或凭据，未改代码/spec。

## 结论先行

1. **目标安装包不是极影视业务页面的主要载体。** `zspace_windows_2.45.2026082601_082620.exe` 是 Electron PE 外壳；已核对 SHA-256 为 `3B645F03FF9B9E72BC1EE46819E3DA81B9FBF4259BF5D79BD849ED3D45DCFF28`。历史桌面 source snapshot 的壳代码负责打开/代理 NAS 页面，`/zvideo` 业务调用和海报组件位于 NAS/Web 页面脚本。仅分析 Electron 壳不能解释海报等待。
2. **历史 NAS 页面代码确认了一个具体的海报等待链。** 列表 API 返回后，卡片不会直接显示 `cover`；`fixCoverImg` 先用 `new Image()` 读取图片自然尺寸，写入 `coverScale`，卡片模板随后才创建 `<img src=cover>`。无 `cover` 时，先生成 preview URL 并等待一次 `Image.onload`，再递归做尺寸探测；至少存在两个 Image 对象，实际是否产生两次网络传输取决于浏览器缓存，静态代码不能证明字节重复。
3. **详情请求链也有明确顺序，但图片不是请求完成信号的一部分。** 详情组件先等待 `classifyInfo`，再请求 `/zvideo/collection/info`；收到详情响应后关闭全局 loading，并非等待 backdrop/海报、人物列表或剧集图片完成。随后 `personList` 和 `collection/video` 无 await 并行发起；剧集/文件缩略图再各自创建 `Image` 探测。
4. **“NAS 其他 app 读写导致慢”目前只能作为资源竞争推断，不能确认是当前根因。** 现有运行证据是历史版本 `2.3.2026082801`（2026-10-16 snapshot）；用户当前页面为 `v2.3.2026101601`。没有当前版本 HAR/网络时序、图片 cache 命中、NAS 磁盘/CPU/队列或并发 I/O 采样，因此不能把历史静态缺陷写成当前实测归因。

## 范围与证据

### 目标与版本边界

- 安装包：`D:\Downloads\zspace_windows_2.45.2026082601_082620.exe`，PE32，336,988,536 bytes，SHA-256 如上。
- 历史 NAS 页面 snapshot：`C:\Users\admin\Documents\Codex\2026-10-16\npx-rea-agents-latest-setup-rea\outputs\nas-source-snapshot`，根目录 SHA-256 `d20051af48868e06369e50ea92af559ead129192b354e5c1a413dd49176adc66`，来源 `http://192.168.5.2:5055/home/`，观察日期 2026-10-16，历史服务版本 `2.3.2026082801`。
- 本轮未复制完整 snapshot 到 `.scratch/research-loading/`；只复用了既有静态材料并读取了下列 5 个业务 chunk。文件均为历史 snapshot，不代表当前 `v2.3.2026101601`。

| 文件 | 大小 | SHA-256（文件） | 作用 |
|---|---:|---|---|
| `home/static/js/async/53914.d64301c5.js` | 17,671 | `4ED538F7CF03102F91ECBB58F3CCCB46B9CAF8BACB7D783D457CD35E4BEFA480` | 极影视 API wrapper |
| `home/static/js/async/39650.34c8fa09.js` | 36,111 | `64B28AC372A931B47BAC2F14FAF89D294A8B499BB2CB6EDE0D2203ABABC7F426` | `/video/homePage` |
| `home/static/js/async/32779.f5626b76.js` | 56,553 | `5464AF5035D3ED716E6BF5E58241A7663D0CF243CA6A1B2784BFC2041AF72CE1` | `/video/list` |
| `home/static/js/async/14142.e0085364.js` | 18,884 | `8727B3C6827B6385593FBCFCAC2AEA9237C1221143B99DC4E01C01471FCD7C7F` | 卡片/列表 item |
| `home/static/js/async/14318.9b9586db.js` | 312,478 | `488965457CFA14A76A047F4F7614D79F639D3AFDD35FF8B6054A291ADF357F75` | 详情组件及剧集图片处理 |

REA 证据：安装包打开/摘要 `ev_2ecb49615d13138872d3b1c11d83706474bb0a7b76e5aa5bfed58fd4821c68e4`（父证据 `ev_f857213adf062b1a6d2c4d9486e4d01275afeac06c8ec2661548c89b38b58d43`）；PE 资源检查 `ev_5065fd33f55aee447ad57db023c896537e350ea4208144870200b720848ecda3`。对 5 个业务 chunk 的受限分析摘要为 `ev_840287c48fbb18037eb9d52007bf89fdaa3e4fb2460e7fb3d419fbfa78ba1596`，完整父证据 `ev_42987fa2dc87d9eb87e51898f8de4e4e8b6bcba0d5f00577805fa9900401760a`；5 个文件均 parse 成功，441,725 text bytes，0 parse failure，另有 123 个 snapshot 文件未选入分析。模块页确认这些路径是 NAS snapshot 的 JavaScript module：`ev_7772e7eff308182df7f8e17a504b5ff01e32a919d53fbd35933cd3c55b0b3aae`。

## 业务页面在哪里

历史 index `home/static/js/index.3608137b.js` 的静态 route 映射（文件 SHA-256 `4B52D44771B429B3599372F73636E81C6A86E02F49443B5419123E4827BC50C3`）显示：

- `/video/homePage` 加载 chunks `53914`、`14142`、`39650`（约 offset `1,198,781`）。
- `/video/list` 加载 chunks `53914`、`14142`、`50565`、`32779`（约 offset `1,197,148`）。
- `/video` 根组件还加载 `14318`（同一约 offset 区域）。卡片点击通过 `openDetailPage` 交给详情组件；`14318` 的详情组件接收 `detailPageInfo`，并在 mounted 中开始分类/详情请求。

这与既有 `reference/runtime-desktop-app-2026-10-16.md` 一致：官方桌面运行时通过本地代理/页面宿主加载 NAS 页面，而不是把极影视页面静态打进 installer。Electron 壳目录 REA 分析 `ev_6240a145328351f90a974bd217c628856e4273f466e25a36b0c5b8de5c3285c5`（父证据 `ev_781ec586c2b5cf1e27f22ecc3a4a27a748cd44a29d17f8bb07cecb631d6c012d`）只覆盖壳 snapshot，且明确是静态、部分图；其对业务 route 的 no-match 不能单独证明全局不存在，但和 NAS route/资产证据相互吻合。

## 请求与图片等待链

### API wrapper：明确的列表、详情、剧集接口

`53914.d64301c5.js` 是 webpack chunk（REA 资产分析也保留了该文件身份）。关键静态片段位于 UTF-16/ASCII 等价的 0-based source offset：

- `~1876–2130`：`getSiderBar` → `POST /zvideo/classification/list`；`getList` → `POST /zvideo/video/v2/list`；`getInfo` → `POST /zvideo/collection/v2/info`。
- `~13408–13559`：`getInfoV2` → `POST /zvideo/collection/info`；`collectionVideoList` → `POST /zvideo/collection/video`。
- `~14763` 附近：`getVideoStreamInfo` → `GET /transcode/video/streams`。
- list/detail wrapper 只组装 `{url, method, data}`，未看到 wrapper 层的 cache、retry 或 list/detail 专用 timeout；同一文件中的 `timeout:3e5` 属于字幕请求，`timeout:6e5` 属于 `classification/rmdir`，不能套到海报/详情请求上。底层 transport 为未解析的 `require`，所以不能据此排除 transport 层的 timeout/retry/cache。

### 普通列表：API 返回与海报可见之间还有图片探测门槛

`32779.f5626b76.js`：

- `getVideoList`（约 `~21127–24600`）按 `limit:20,start` 和筛选字段调用 `h.ZP.getList(o)`；成功后写入 `videoList`，对每项调用 `fixCoverImg`，再将页面状态设为 `loading="loaded"`。滚动接近底部约 400px 时才取下一页（约 `~25257`）。
- `fixCoverImg`（约 `~19037–19816`）已有 `cover` 时先访问 `cacheDB`；没有尺寸缓存则 `new Image()`，在 `onload` 读取 `naturalWidth/naturalHeight`，计算并写入 `coverScale`。没有 `cover` 但有 `file_path` 时先生成 `getPreviewUrl(...)`，`new Image().onload` 写入 `cover` 并递归调用 `fixCoverImg`。

`14142.e0085364.js` 的卡片模板（约 `~11203`、`~14363`）只有在 `!coverFail && item.coverScale` 时才渲染 `<img src=item.cover>`；否则显示空 image container 或错误图标。因而静态可确认的链为：

```text
list response
  -> fixCoverImg(item)
  -> Image probe / cacheDB / naturalWidth+naturalHeight
  -> coverScale
  -> card DOM creates <img src=cover>
```

这是一个确定的 UI 等待链；它不是“滚动输入阻塞”，但会把海报的首次可见时间绑定到图片 probe 和 IndexedDB cache 读取完成。对已有 cover，probe 与最终 `<img>` 可能复用浏览器缓存；对无 cover，代码至少创建 probe Image 和最终 card Image，不能仅凭静态代码确认产生两次网络字节。

### 首页：多个列表请求和海报探测同时启动

`39650.34c8fa09.js`：

- `initList`（约 `~9149–10100`）连续调用 `getplayRecordList()`、`getAddList()`、`getCollectList()`、`getShareList()`、`getRecommendationList()`、`changeHomePageStatus()`，没有 await，也没有统一图片并发调度器。
- 各列表响应都遍历数据并调用 `fixCoverImg`；推荐区对 `backdrop` 也使用 `new Image()` 读取自然尺寸并写入 `coverScale`（约 `~9872–10107`）。
- `changeHomePageStatus` 只对 sidebar/share-class 请求使用 `Promise.all`（约 `~18317`）；这是额外的 API fan-out，不是海报加载完成条件。

因此首页存在静态可确认的请求/图片 fan-out。实际是否同时占用 NAS 连接、是否由浏览器连接池限流，取决于未选入的 transport 和运行时，不能从这段代码直接推出网络并发数。

### 详情：分类 → 详情 → 人物/剧集与图片探测

`14318.9b9586db.js`：

- `mounted`（约 `~86454–87006`）先 await `d.ZP.classifyInfo({classification_id})`，随后调用 `this.getInfo()`。
- `getInfo`（约 `~67362–68700`）显示全局 loading，非 share 分支调用 `d.ZP.getInfoV2(s)`；wrapper 映射到 `POST /zvideo/collection/info`，参数含 `collection_id`、`classification_id`、`get_type:"all"`。收到响应后立即关闭全局 loading，调用 `fixCoverImg(i.data,"cover",.6666)`，写入 `videoInfo`，随后对非 `[2,4,8]` 类型调用 `getPersonList()`，并调用 `getCollectionVideoList()`；这些后续调用没有 await。
- `getCollectionVideoList`（约 `~69000–71100`）调用 `/zvideo/collection/video`；收到 `video_list`/`file_list` 后为每个可视文件生成 preview URL，并各自 `new Image()`，在 `onload` 设置 `loaded=1`，在 `onerror` 设置 `error=1`。这批图片探测不属于前面的 `getInfo` loading promise。
- backdrop 是 CSS `background-image:url(videoInfo.backdrop || videoInfo.cover || videoInfo.screenshot)`（约 `~53619–54165`、模板约 `~90128`），没有看到 backdrop `onload` 或 ready gate。若详情数据没有 `cover`，`fixCoverImg` 需要先由 preview Image 的 `onload` 写入 cover，背景才有 URL。

这说明详情的“接口 loading 已结束”和“用户看到完整海报/剧集图片”是两个状态；静态代码没有把它们合并为一个可观测的完成时刻。

## 缺陷、推断与不能确认的部分

### 严格确认的静态事实/缺陷候选

- 安装包根体是 Electron PE；业务页面/API/卡片组件在历史 NAS snapshot 的 Web chunks 中，不在已检查的安装器子容器中。
- 列表卡片把 poster DOM 的创建放在 `coverScale` 探测之后；`coverScale` 由图片加载和 cacheDB 读取决定。
- 无 cover 的列表/详情路径会先通过 preview URL 的 `Image.onload` 设置 cover，再进入尺寸探测/渲染；该路径没有显式取消、优先级或超时。
- 首页初始化会启动多组独立列表/API 及对应图片探测；普通 list 的分页请求在触底附近继续启动，代码未提供共享图片并发上限。
- 详情关闭全局 loading 的时点早于人物、剧集和缩略图图片完成；详情背景图也无独立 ready/error 观测。

以上是历史代码中的等待链/调度事实，不等于当前版本已复现的时间回归。

### 资源竞争推断（未实测）

- 官方桌面页面由 NAS/本地代理承载，preview/backdrop URL 也由 NAS 页面生成；在 NAS 其他应用读写时，HTTP API、图片读取、NAS 文件系统和缩略图生成可能竞争同一设备资源，因此上述 fan-out 可能把等待放大。
- 但也可能只是浏览器图片缓存、NAS 服务端缩略图生成、网络往返或当前版本 transport 行为；现有证据无法在这些候选之间排序。

### 当前根因仍缺的证据

- 当前 `v2.3.2026101601` 的页面 chunk/文件 hash 与上述历史 snapshot 的差异。
- 当前客户端一次列表/详情打开的网络时序：分类、list、collection/info、collection/video、图片 URL 的 request/response/queue/cache 状态。
- 当前海报 URL 的真实响应体积、缓存命中率、图片解码耗时、失败/重试次数。
- NAS 在“其他 app 读写”和“无竞争”两种条件下的磁盘队列、CPU、网络和服务端处理耗时。
- 未选入的 transport module 是否提供全局 retry、timeout、cache、连接池或请求串行化。

## 最终判断

本次有界 REA 研究可以严格支持：**极影视业务页面在 NAS 页面层；历史页面存在“API 返回后还要先 Image probe/尺寸缓存，才创建 poster DOM”的静态等待链；详情请求完成并不等于海报/剧集图片完成。** 这比从 Electron 壳推断图片慢更直接。

本次研究不能严格支持：**当前 `v2.3.2026101601` 的慢一定由 NAS 其他 app I/O 引起**，也不能给出当前版本的单一根因或耗时比例。若继续验证，应只对当前版本做一次脱敏 HAR/时序与 NAS 资源对照；本报告没有执行该运行时采样。

