# UI 缺口与 NAS/Web 协议可行性（2026-10-19）

## 最新状态：真实 NAS 只读核对已完成

2026-10-19（北京时间）在用户授权后，用本项目 Windows 安全存储中的既有会话完成 18 次真实 NAS 只读请求，全部为 HTTP 200、业务码 200。原始凭据与响应值仅在内存处理；没有登录写入、收藏变更、播放、进度上报或历史清理。下文原静态调查保留为来源；涉及运行时状态时以本节为准。

证据：[脱敏请求与字段结构](ui-runtime-probe-2026-10-19.json)；工具：[只读探测脚本](../../scripts/probe-ui-capabilities.py)。JSON 内时间采用 UTC，与本文北京时间日期对应。

| 功能 | 本次真实结果 | 可以得出的结论与限制 |
|---|---|---|
| 分类与片库 | 取得 2 个分类；所选分类返回 5 个抽样条目 | 基础数据路径可用；不代表所有分类或全量片库已验证 |
| 标题搜索与建议词 | 用内存中的现有片名搜索，命中同一 collection；建议词返回 2 项 | 标题搜索具备真实依据，未测所有字符/匹配规则 |
| 演员搜索与按人列片 | 详情返回 1 位演员；按该名字搜索返回人物结果 1 项、影片结果 5 项；按人物接口返回 5 项 | 演员展示、搜索和作品列表具备真实数据路径；不保证所有影片元数据齐全 |
| 收藏与最近添加 | 收藏列表返回 1 项；最近添加返回 5 项 | 可以展示列表；收藏添加/删除仍只有静态依据，尚未执行 |
| 筛选 | 返回 `collection_tag`、`collection_type` | 可取得服务端筛选数据；组合筛选与排序效果未执行验证，不能写成全部已通过 |
| 详情与续播字段 | 新版 `/collection/v2/info` 的 `last_video_id/play_duration` 等在顶层；旧 `/collection/info` 位于 `history` | 两版数据布局必须分别映射；当前 Rust 模型尚未接入这些续播字段 |
| 实际续播位置 | 从历史列表选取 5 个不同条目；额外 4 个样本明确为零位置，首个未取得正数位置 | 已证明可读取历史字段，未证明正数位置恢复，更未证明播放上报后的持久化闭环；不据零值断言续播故障 |
| 番号 | 未补足独立字段和专用检索语义 | 保持未知；允许原样展示标题，不承诺番号筛选或独立索引 |

原型候选建议：片库、搜索、演员浏览、右侧详情均有数据依据；收藏先作为已有列表展示；续播采用“存在可恢复位置时出现”的条件设计，不用假位置宣称真实可用。收藏切换、完整续播闭环、组合筛选/排序的实际效果仍在待验证清单。上述是范围建议，不是用户对 HTML 阶段的新批准。

执行时，沙箱读取 Windows 凭据管理器先返回 Win32 5（拒绝访问），未发送请求；经自动审批在当前用户环境运行后成功。该问题属于环境权限，未修改凭据，也未据此修复应用或重新登录。

实际执行命令（第二条仅补抽其他历史样本，复用第一轮成功证据）：

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts\probe-ui-capabilities.py
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts\probe-ui-capabilities.py --history-only
```

脚本限制请求路径、禁止重定向、不使用系统代理，报告只写允许字段名、类型、数量、成功标志和耗时。内嵌断言确认敏感值及未知字典键不会进入结构摘要。未修改 Rust/Slint、依赖或构建配置，没有新增应用测试；这些实时请求不构成 UI、滚动、播放或性能验收。

## 结论先行

| 功能 | 判定 | 当前可依赖的协议候选 |
| --- | --- | --- |
| 全局本地标题/文件/演员搜索 | 可纳入 | `/zvideo/search/index`、`/zvideo/search/suggest`，请求字段为 `key_word`；响应消费者读取 `data.collection`、`data.video`、`data.person` |
| 片库内标题搜索与演员搜索 | 条件纳入 | `/zvideo/search/local` 使用 `key_word` 加 `classification_id`，部分匹配场景再带 `system:94`；演员专用搜索使用 `/zvideo/search/celebrity` 的 `name` |
| 详情演员展示与按演员列片 | 条件纳入 | `/zvideo/collection/person` 返回消费者使用的 `director/actor/writer`；`/zvideo/person/collection/list` 可按 `person_name/person_id/collection_id` 取片库列表 |
| 番号字段 | 暂不纳入，保持未知 | 本次选定的搜索、详情和演员消费者没有确认媒体番号属性；现有 `index/ep` 是剧集或版本显示字段，不能代替番号 |
| 片库筛选和排序 | 可纳入 | 列表请求携带 `field/sort/collection_type/seen/system`，以及 `resolution/hdr/audio/regions/year/genres` 等筛选值 |
| 收藏读取 | 可纳入候选 | `/zvideo/favorite/list`，UI 读取 `data.list`、`data.count`，还处理 `data.add_task` |
| 收藏添加/删除 | 条件纳入 | `/zvideo/favorite/add`、`/zvideo/favorite/delete` 的动态调用字段已定位；本次没有执行 NAS 写入 |
| 最近添加 | 条件纳入 | `/zvideo/video/v2/lately` 的 UI 成员名为 `addList`；首页读取 `data` 数组，分类列表按通用列表读取 `data.list` |
| 继续观看/续播读取 | 条件纳入 | 播放记录列表只证明历史条目；真正的续播字段来自 `/zvideo/collection/info` 的 `data.history`，运行时读取响应本次未重新取样 |

表中的“可纳入”仅指具备进入原型候选范围的静态依据，不表示当前 Rust 已实现或真实 NAS 已验证。“条件纳入”还需明确可选字段、版本或响应形状的处理决定；真实接入前均须核对当前 NAS 的脱敏响应。未知项保持未知，不把 Rust 当前没有对应方法解释成 NAS 不支持。

调查由用户指定的 GPT-5.6 Luna、max 推理强度子智能体 `/root/ui_protocol_feasibility` 完成，主会话另行复核关键源码。没有制作 HTML 原型。

## 证据层次和范围

1. **官方桌面静态。** 已有 [zspace Windows 2.45 核心路径报告](zspace-windows-2.45-core-path.md) 证明 ASAR 主要是 Electron 壳层，并加载 NAS Web 页面；该报告没有把 ASAR 中未出现的片库路径当成否定证据。本次没有重新解包、运行安装包或读取官方用户会话目录，因此下文的片库接口归类为 NAS/Web 静态证据，不冒称为 ASAR 内置实现。
2. **NAS Web 静态。** 使用交接文档指向的现有 `nas-source-snapshot`、`nas-video-api-catalog.json` 和保存的源码偏移。REA 本次只选了 `53914`、`32779`、`14318`、`56798`、`39650` 五个 JS 文件做静态分析，解析失败为 0；证据摘要为 `ev_e0e9972584c2b8c52ad5c4eecb434bf979d14ca71e5482d8e3ed38b1fe29e8a0`，父证据为 `ev_2fb5854c8eab01f7829b3c3a6f7a5a6e26f9ad9baa86d973b056c833081e791d`。REA 图是部分图，未选文件、动态属性和服务端 Schema 仍属未知。
3. **Web 静态。** `web-source-snapshot` 和 `web-video-api-catalog.json` 补充了全局搜索、演员搜索和同一 UI 的调用点。Web 静态调用不直接证明指定 NAS 固件一定接受相同响应，只能作为页面协议候选。
4. **运行时。** 既有脱敏记录 [登录到播放运行时证据](../runtime-login-play-2026-10-16.md) 观察到登录会话中 `/zvideo/video/v2/playlist`、`/zvideo/favorite/list`、`/zvideo/collection/person` 返回 HTTP 200，并观察到播放进度上报。该记录没有保存响应正文；本次没有新增请求，也没有执行收藏或历史清理写入。
5. **替代客户端。** 当前 Rust 客户端缺少对应的搜索、演员、收藏 API 是实现缺口。这里仅证明服务端候选，不修改 UI、应用代码或协议客户端。

## 演员、演员搜索和番号

### 详情演员字段

NAS 与 Web catalog 都记录了同一包装器：

- `home/static/js/async/53914.d64301c5.js:13742`：`POST /zvideo/collection/person`，成员名 `personList`。
- NAS `home/static/js/async/14318.9b9586db.js:72424`：`personList({collection_id:this.id})`。
- Web `home/static/js/async/64888.54bcd7f2.js:70503`：同一调用。

详情消费者在 NAS `14318.9b9586db.js:72429` 附近读取 `e.data.director`、`e.data.actor`、`e.data.writer`，分别截取 2、10、2 项并加载 `profile`；模板在约 `134830` 处使用人员项的 `name`、`profile`，点击人员项时带上当前 `collection_id`。这证明演员是独立人员数组，不需要从标题字符串猜测。

### 按演员搜索和列片

- `POST /zvideo/search/celebrity` 的包装器在 `53914.d64301c5.js:12466`。
- Web `11876.fe5e7319.js:3163` 的本地分支发送 `{name:this.searchPeopleKey}`，全局分支发送 `/zvideo/tmdb/search/people` 的 `{name:this.searchPeopleKey,page:this.searchPage}`；全局响应消费者要求 `data.results` 和 `data.total_results`。
- `POST /zvideo/person/collection/list` 的包装器在 `53914.d64301c5.js:13643`。NAS `14318.9b9586db.js:151316` 的演员详情初始化先设置 `person_name`、`person_id`、`collection_id`，再补 `field:this.sortVal` 和 `sort:this.sortType`；初始请求对象在约 `148625` 为 `{limit:200,start:1,type:0,person_name:"",person_id:"",collection_id:"",field:"",sort:""}`。响应消费者读取 `data.list` 和 `data.count`。
- `POST /zvideo/video/person/list` 只有包装器 `53914.d64301c5.js:10902`，本次 NAS/Web catalog 没有调用点，参数和语义未知，暂不接入这条路径。

### 番号边界

本次选定的详情、搜索、演员列表消费者没有出现可归因于影片番号的 `number`、`serial` 或同义字段。NAS `14318.9b9586db.js:113102` 的 `lastPlay.index` 用于版本/集数显示；源码中 `serial_number` 的命中是磁盘 SN（`index.3608137b.js:763031`），`common_file_number` 是文件批量重命名 UI（`17398.47b62dcd.js:1218`）。这些都不能作为影片番号协议证据。

因此本轮不新增“番号已支持”的 UI 或字段映射。后续只有在脱敏详情/搜索响应明确出现字段名并确认其语义后，才能定名接入。标题中已有编号可以随原始标题展示，不推断为独立字段或专用索引。

## 搜索作用域与请求参数

### 全局本地搜索

- `POST /zvideo/search/index`：包装器 `53914.d64301c5.js:14521`；Web `30553.ee41f0a8.js:15906` 调用 `{key_word:this.searchText}`。
- 同一消费者把响应分为 `data.collection`、`data.video`、`data.person`，分别使用 `title`、`file_name`、`name` 和封面字段。它是当前最接近用户“全局搜索”的本地索引入口。
- `POST /zvideo/search/suggest`：包装器 `53914.d64301c5.js:14662`；`30553.ee41f0a8.js:14118`、`39650.31bc6f29.js:8081`、`65658.51ead9ab.js:10345` 都只发送 `{key_word:...}`，响应按字符串数组消费。

### 片库范围搜索

- `POST /zvideo/search/local`：包装器 `53914.d64301c5.js:2478`，成员名 `nasSearch`。
- `56798.126d643e.js:6763` 的元数据匹配场景发送 `{key_word,classification_id,system:94}`；`64888.54bcd7f2.js:4323` 的系列内容管理场景发送 `{key_word,classification_id}`。两处都把返回的 `data` 当本地候选列表。
- 这条 `nasSearch` 是带片库分类范围的匹配/管理搜索，不能泛化为全局搜索，也不能用它推断演员专用搜索。

### 云端/元数据搜索分支

Web `44849.3f400efa.js:6606` 和 NAS Web `56798.126d643e.js:6430` 的 `SearchTitle` 分支显示：

- 全局模式调用 `/zvideo/tmdb/search`，字段为 `key_word`、`category`、`page`，有年份时再带 `year`。
- NAS/本地模式调用 `/zvideo/search/cloud`，字段为 `key_word`、`source:"all"`，并按 UI 筛选追加 `category`、`region`、`year`。
- 演员查询走独立的 `/zvideo/search/celebrity` 或 `/zvideo/tmdb/search/people`，不能把标题搜索的字段套到人员查询上。

这些调用点证明参数形状和页面分支；没有验证每个筛选 ID 的服务端枚举，也没有验证云端服务在指定 NAS 上的权限和返回内容。

## 筛选与排序

- `POST /zvideo/collection/filter/v2` 包装器在 `53914.d64301c5.js:725`；`43033.fb1884c0.js:1070` 的调用无显式请求字段，成功后读取 `data.collection_tag`，从其中名为 `genres` 的列表取非零项。旧 `/zvideo/collection/filter` 包装器在 `53914.d64301c5.js:6470`，catalog 没有调用点，不能假定两者参数相同。
- 普通片库列表 `POST /zvideo/video/v2/list` 包装器在 `53914.d64301c5.js:2012`；`32779.f5626b76.js:22757` 的分类列表构造请求：

  ```text
  limit, start, field, classification_id, sort,
  collection_type, seen, system,
  resolution, hdr, audio, regions, year, genres
  ```

  前八项来自列表构造，后六项来自 `listParams`，并通过 `Object.assign` 合并。`system` 在值为 0 时被省略。
- `32779.f5626b76.js:6436` 的排序文案分支明确列出 `release_year`、`created_at`、`title`、`score`、`video_updated`，每项都有 `asc` 和 `desc`。初始列表状态约 `3275` 为 `sortVal:"created_at",sortType:"desc"`，进入普通分类时页面可改为 `release_year`。
- `/zvideo/video/v2/lately` 的分类列表也复用 `field/sort/collection_type/seen/system/listParams`（`32779.f5626b76.js:21819`）。当前没有对每个筛选 ID 做运行时组合验证，因此字段可纳入，枚举和值范围仍需后续脱敏读验证。

## 收藏读写

- 读取包装器：`53914.d64301c5.js:6384`，`POST /zvideo/favorite/list`，成员名 `collectList`。调用点为 `14318.9b9586db.js:25443` 的计数 `{limit:0,start:1}`、`32779.f5626b76.js:22114` 的分页 `{limit,start}`、`39650.34c8fa09.js:15875` 的首页 `{limit:30,start:1}`。首页成功分支读取 `data.list`，并处理 `data.add_task`；计数分支读取 `data.count`。
- 写入包装器：`53914.d64301c5.js:6573` 的 `POST /zvideo/favorite/add`（`collect`）和 `:6661` 的 `POST /zvideo/favorite/delete`（`uncollect`）。由于方法名动态分发，catalog 没有直接调用例；`39650.34c8fa09.js:约13058` 的共同操作构造 `{collection_id}`，当动作是 `collect/uncollect` 时再加入 `classification_id`。成功后 UI 将 `is_fav` 设为 1/0，并刷新播放记录、最近添加和收藏列表。
- 既有运行时记录确认 `/zvideo/favorite/list` 返回 HTTP 200，但没有保存响应正文；本次没有调用 add/delete，不把静态候选写成已验证的 NAS 写操作。

## 最近添加、播放记录和续播

### 最近添加

- 包装器 `53914.d64301c5.js:5420`：`POST /zvideo/video/v2/lately`，成员名 `addList`。
- 首页 `39650.34c8fa09.js:约15000` 使用 `{limit:30}`，成功后读取 `data` 数组并存入 `addList`；计数调用 `14318.9b9586db.js:24927` 使用 `{limit:0,start:1,system:0}` 并读取 `data.count`。
- 分类页 `32779.f5626b76.js:21819` 使用带排序和筛选的请求，通用列表逻辑读取 `data.list`。因此接入时必须按调用场景分别解析，不可只写一个固定响应形状。`addList` 和 `created_at` 排序支持“最近添加”候选语义，但本次没有新增 NAS 响应样本，仍标为条件纳入。

### 播放记录不是续播字段证明

- 播放记录包装器 `53914.d64301c5.js:5138`：`POST /zvideo/video/v2/playlist`。调用点 `14318.9b9586db.js:25186`、`32779.f5626b76.js:21988` 和 `39650.34c8fa09.js:16505` 使用 `{limit,start}`，首页消费者读取 `data.list`，并以 `collection_id` 建立历史卡片。
- 这些调用只证明播放记录列表和历史卡片。没有在该列表调用点确认每一项都带 `play_duration`，所以不把 playlist 直接命名为“继续观看接口”。

### 详情 history 是续播读取链

- 详情包装器 `53914.d64301c5.js:13449`：`POST /zvideo/collection/info`，NAS `14318.9b9586db.js:67768` 发送 `{collection_id,classification_id,get_type:"all"}`。
- 详情拿到 `i.data` 后在约 `14318.9b9586db.js:71175` 调用 `getLastPlayInfo(videoInfo.history.last_video_id)`。`getLastPlayInfo`（约 `79486`）把 `videoInfo.history` 的 `play_duration`、`audio_index`、`subtitle_index`、`subtitle_hash`、`subtitle_setting`、`play_chapter` 合并到当前 `lastPlay` 条目，并用 `last_video_id` 选择剧集/视频。
- 播放器静态代码 `93088.5d911e46.js:99640` 也通过 `getInfoV2({collection_id,classification_id})` 读取 `collectionInfo`；`compareHistory`（约 `105734`）在 `history.last_video_id` 匹配时读取 `history.play_duration`、`audio_index` 和 `subtitle_index`，将差异转换为本地 `sec`、音轨和字幕选择。
- 进度写入包装器 `53914.d64301c5.js:3796`；`14318.9b9586db.js:76843` 的字段为 `classification_id`、`collection_id`、`video_id`、`sec`、`chapter`、`subtitle_setting`、`audio_index`、`subtitle_index`、`subtitle_hash`。既有运行时只证明播放过程中上报过进度，尚未单独证明保存后再次打开的响应值，因此续播读取仍需一次脱敏读验证。

## 未验证项与下一步

- 没有执行安装包、没有执行 NAS 写入，没有读取用户会话目录；收藏 add/delete、播放记录删除/清空均未调用。
- 没有确认服务端对 `system`、`collection_type`、`seen` 和 `listParams` 各 ID 的枚举、默认值和错误码。
- 没有拿到本次新鲜的 `/search/index`、演员详情、`favorite/list`、`lately`、`playlist` 或 `collection/info` 响应正文；以上响应字段均来自已有静态消费者，运行时响应 Schema 仍需脱敏采样。
- `/zvideo/video/person/list`、番号字段、云端搜索在指定 NAS 上的权限/可用性保持未知。

下一次数据验证只做读请求：使用用户本机登录的测试会话，分别记录 `/zvideo/search/index`、`/zvideo/collection/person`、`/zvideo/person/collection/list`、`/zvideo/collection/filter/v2`、`/zvideo/video/v2/list`、`/zvideo/favorite/list`、`/zvideo/video/v2/lately`、`/zvideo/video/v2/playlist`、`/zvideo/collection/info` 的 HTTP 状态、业务码和字段形状。仅验证拟纳入范围的功能，不为不采用的功能补测；人员列表、筛选列表的枚举据响应取得，不猜 ID。凭据只留在用户本机，不写入报告或 fixture；不要调用收藏写入或历史清理。收藏写入与续播持久化闭环仍需后续单独的业务验证，不能靠本次只读检查判定通过。

## 主会话复核与复现入口

主会话重新计算了用户所给安装包的 SHA-256，与旧 manifest 相同：`3b645f03ff9b9e72bc1ee46819e3da81b9fbf4259bf5d79bd849ed3d45dcff28`。还直接读取 NAS snapshot 的 `35697.82b0cbe4.js:15907`、`39650.34c8fa09.js:13058`、`14318.9b9586db.js:79486`，分别确认搜索人物分组、收藏动态请求参数和 history 续播字段；三个源文件的实际 SHA-256 均匹配 `reference/nas-source-manifest.json`。演员详情与人物查询初始参数也直接复核于 `14318` 的 72388、148625 附近。

上文 REA Evidence ID 属于子智能体的工具会话；主会话尝试按 ID 读取时返回 `evidence_integrity_mismatch`，具体原因为该 ID 未保留在主会话中，并非源文件哈希矛盾。因此没有重复全量分析，改用相同源文件、manifest 和精确偏移复核关键结论。这些 ID 本身不是已导出的可移植证据包，后续复核优先使用原始快照和以下命令。

原始只读脚本目录：

`C:\Users\admin\Documents\Codex\2026-10-16\npx-rea-agents-latest-setup-rea\outputs\nas-source-snapshot\home\static\js\async`

安装包身份核对命令：

```powershell
Get-FileHash -LiteralPath 'D:\Downloads\zspace_windows_2.45.2026082601_082620.exe' -Algorithm SHA256
```

源码偏移复核示例（UTF-16、零基，未执行脚本）：

```powershell
$sourceDir = 'C:\Users\admin\Documents\Codex\2026-10-16\npx-rea-agents-latest-setup-rea\outputs\nas-source-snapshot\home\static\js\async'
$sourceText = [IO.File]::ReadAllText((Join-Path $sourceDir '35697.82b0cbe4.js'))
$sourceText.Substring(15907, 1200)
Get-FileHash -LiteralPath (Join-Path $sourceDir '35697.82b0cbe4.js') -Algorithm SHA256
```

覆盖止于所选官方客户端/NAS/Web 静态源码及既有记录；没有新增 NAS 请求、真实数据样本、播放或性能结果。未运行 Cargo 构建或测试，因为本轮仅新增研究文档和更新阶段门槛，没有改动应用。
