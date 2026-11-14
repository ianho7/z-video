# 体验流程审计 · D 区（详情 9 项）+ E 区（播放 10 项）

审计对象：`D:\project\z-video` 主工作树，HEAD `30210bd`（工作树除未跟踪 `designs/` 外干净）。
方法：`docs/local-library/ux-flow-audit.md` §1/§4/§5。范围：`src/renderer/renderer.ts`、`src/renderer/views/*`、
`src/renderer/index.html`、`src/renderer/overlay.js`、`src/main/{player,mpv-player,player-host,player-overlay,main}.ts`、
`src/main/local-library-worker.ts`（detail/playback 读取侧）、`src/shared/local-playback-contracts.ts`、`tests/*`（仅作覆盖参考）。

边界（必须先读）：

- **纯静态走查**：未修改任何代码，未运行 `build` / `test` / 任何 git 写操作，未启动应用。下面所有"通过"只表示
  **代码路径完整、状态可收敛、无断链**，不表示已在真实窗口/真实媒体上验收。票 `17-player-window-verification`
  仍未完成，播放器与浮层的窗口证据缺口原样存在。
- 播放器控件在真实窗口中由**独立 overlay 窗口**（`player-overlay.ts` + `renderer/overlay.js`）镜像渲染，主窗口
  `[data-view=player]` 的控件被 native 子窗口遮住。因此凡涉及"用户是否真的看得到"的点，均在 §4 单列。
- 已完成的 `Ticket 06–14` 修复项（播放终态单一出口、双击关闭幂等、1.5s 兜底、`loaded` 门、轨道偏好 latch、
  字幕 `off` 哨兵、账本完成口径统一、墓碑隐藏等）不重复报告；本报告只列**残留与新增路径断裂**。
- `Ticket 15`（baseView + 图层栈）、`18`（epoch 拆分 + 详情 reopening）、`17`（播放器窗口验证）在本 HEAD
  **未实施**（全仓无 `baseView` / `libraryEpoch` / `detailEpoch` / `reopening` 标识）。因此下面 P-03 等
  "缺 reopening 态"类问题是**当前真实缺陷**，不是已修项的重复。

## 1. 结论表（19 行）

| ID | 操作 | 结论 | 主路径（代码） | 备注 |
|---|---|---|---|---|
| D1 | 打开详情（正常） | 通过 | `openDetail` → `setDetailViewState("loading")` → `get` → `renderDetail` → `ready` + 焦点落标题 | 首帧飞行/淡入属视觉项（§4）；与 D5 共用同一函数，见 P-03 |
| D2 | 打开详情（失败） | 通过 | `showDetailError` → 错误卡（重试/返回）+ 焦点入卡 + 重试重取 | `detailRequestMediaId` 保证重试目标不丢 |
| D3 | 打开详情（文件已不可用） | 通过 | `getDetail` 对墓碑返回 `undefined` → `showDetailUnavailable`（隐藏重试、保留返回） | 与"页面读取失败"分离显示，文案可执行 |
| D4 | 切换季 | 问题（中） | `selectedSeason` + 本地 `renderDetail`，不重取 | P-01、P-02 |
| D5 | 切换剧集 | 问题（中） | `openDetail(mediaId)` 全量重取，但**不进载入态** | P-03、P-04 |
| D6 | 继续播放 | 问题（中） | `open(mediaId)` 从 `playback_state.positionSec` 续播 | P-05 |
| D7 | 重新播放 | 问题（低） | `open(mediaId,{restart:true})` → 位置 0 / `watched=false` | P-12 |
| D8 | 返回片库 | 通过 | `closeDetail` → 重载列表 → 恢复 `scrollTop` 与焦点（含搜索结果路径） | 来源筛选/页码保留；依赖重载成功 |
| D9 | 详情中打开播放器再返回 | 问题（中） | 关闭后原地 `openDetail(mediaId)` 刷新 | P-09、P-13；整理入口在详情内不可达（见 §5 说明） |
| E1 | 打开播放（opening→ready） | 问题（低） | `showPlayer(true)` → `open` → `loading` → `ready` | P-12(b)、§4 |
| E2 | 加载失败 | 问题（中） | `error` 事件 → 错误面板（重试/返回）+ 控件禁用 | P-06 |
| E3 | 播放/暂停/Seek/音量/静音/速度 | 问题（中） | 命令 → main 协调器 → mpv；失败回滚滑块/芯片 | P-07 |
| E4 | 全屏切换 | 问题（中） | renderer 乐观态 → `fullscreen` 命令 → `window.setFullScreen` + overlay `syncBounds` | P-08；几何/浮层需真机（§4） |
| E5 | 音轨/字幕切换、外部字幕 | 问题（低） | `aid`/`sid` + 偏好写入 `playback_state`；外部字幕 `sub-add` | P-10 |
| E6 | 播放结束 → 自动下一集 | 通过 | `state:ended` → 结束面板 + 10s 倒计时 → `playNextEpisode`；取消/重播/立即播放均有出口 | 切集画面切换需真机（§4） |
| E7 | 关闭播放器（详情/首页/整理） | 问题（中） | `requestPlayerClose` → main 单一终态 → `handlePlayerClosed` 三条返回 | P-09 |
| E8 | 播放中打开另一部 | 问题（低） | `beginTransition` 结算旧会话（进度落盘 + 账本结束），无 `closed` | P-11 |
| E9 | 播放中关闭窗口/退出 | 通过 | `before-quit` → `closePlayback` → `coordinator.close("app-quit")` + 启动补记 | 进程退出行为需真机（§4） |
| E10 | 快速连点关闭 | 通过 | `requestPlayerClose` 重入守卫 + 1.5s 兜底 + `handlePlayerClosed` 幂等；main `pendingTermination` 合流 | 单测存在（未运行，见 §5） |

结论分布：通过 7（D1/D2/D3/D8/E6/E9/E10），问题 12，需真机：**无整项**——凡能由代码判定的一律给结论；
纯感官部分集中在 §4，不混进结论列。本次未发现新增 blocker 级（死路/不可恢复）缺陷，Ticket 06–14 的 P0 未回退。

## 2. 问题详情（按严重度排序）

### P-01 · D4 切换季：混编季号的剧集被永久隐藏（内容不可达）

- **操作 ID**：D4（分支：多季 + 部分单集缺季号）
- **路径**：打开详情 → 该剧 `episodes` 同时存在 `seasonNumber` 有值/无值的文件 → 季标签只按有值的季生成 → 切季
- **现象**：`seasons.length > 1` 时，`visibleEpisodes` 只保留 `seasonNumber === selectedSeason` 的单集，**没有季号的单集
  不在任何一季下，永远不出现在选集列表**；这些文件只能从"单集"筛选或搜索进入。用户会认为文件丢了。
- **严重度**：中　**判定标准**：缺态 / 内容不可达
- **证据**：
  - `src/renderer/renderer.ts:3118`（`seasons` 只收集有值的季）
  - `src/renderer/renderer.ts:3120`（`seasons.length > 1 ? episodes.filter(e => e.seasonNumber === selectedSeason) : episodes`）
  - `src/renderer/views/detail.ts:79-91`（季标签同样只由有值季生成，缺季号无入口）
- **建议修复方向**：把"无季号"视为一档显式分组（例如"未分季"标签）或在季标签存在时始终附带一个"全部"；不要用
  `filter(seasonNumber === selectedSeason)` 静默丢弃。修复需与 D4 的季模型一起收敛（`selectedSeason` 见 P-02）。

### P-02 · D4 切换季：`selectedSeason` 是全局残留，列表季与当前选中集可以不一致

- **操作 ID**：D4（分支：换作品；从搜索/继续观看进入另一季的单集）
- **路径**：
  1. 打开 A 剧 → 切到第 3 季 → 返回片库（`closeDetail` 不重置 `selectedSeason`）→ 打开 B 剧（也有第 3 季）→
     **B 剧直接停在第 3 季**，不是第 1 季。
  2. B 剧默认第 1 季，但用户从搜索/继续观看打开的是一条第 2 季的单集 → 列表显示第 1 季，**选中的单集不在可见
     列表里**，而"继续播放 · 第 2 季 第 N 集"按钮仍指向它。
- **现象**：切季后首屏季号与用户预期不符；"选集"高亮/当前集与主按钮指向的对象脱节（残留在两个语义上：季选择、
  选集高亮）。另：`renderDetail` 在每次切季时**整页重建**（封面 `replaceChildren` + 重新入队 artwork、简介折叠态复位
  为"收起"），页面高度变化时滚动位置随之跳变。
- **严重度**：中　**判定标准**：状态残留 / 误导文案（按钮指向与列表不一致）
- **证据**：
  - `src/renderer/renderer.ts:342`（`let selectedSeason` 为模块级，`openDetail`/`closeDetail` 均未重置；
    只有 `handlePlayerClosed` 的部分分支会清）
  - `src/renderer/renderer.ts:3119`（只在新作品"没有该季"时才回退到 `seasons[0]`）
  - `src/renderer/renderer.ts:3120-3121`（列表按季过滤；`selectedMediaId` 不随季变）
  - `src/renderer/renderer.ts:3091-3098`（主按钮文案取自选中集，与可见季无关）
  - `src/renderer/renderer.ts:3875-3881`（切季 = `renderDetail(activeDetail)`，整页重渲染）
  - `src/renderer/renderer.ts:3170-3185`（每次渲染都重建封面并重新排队取图）
- **建议修复方向**：`selectedSeason` 改为详情局部状态并在 `openDetail`/`closeDetail` 重置；打开某集时把
  `selectedSeason` 同步到该集的季；切季只重渲染 `#detail-episodes`/季标签，不动封面与简介折叠态。

### P-03 · D5 切换剧集：没有 reopening 载入态，旧内容在取数期间仍可操作；失败时整页被错误卡替换

- **操作 ID**：D5（主路径 + 异常：目标集刚被扫描置为墓碑 / 读取失败）
- **路径**：详情 ready → 点选集里的另一集 → `openDetail(newId)`
- **现象**：
  1. `entering = detail.hidden !== false` 为 false、`retrying` 为 false → **既不清内容也不进 loading**：在新详情返回前，
     页面仍是上一集的标题/简介/文件信息/观看记录，播放按钮仍指向上一集。用户若在此窗口点播放，打开的是旧集
     （随后新详情渲染又覆盖，成"点错集"）。这就是 Ticket 18 尚未落地的 `re-opening` 缺口。
  2. 取数失败时 `showDetailError` → `clearDetailContent()` 把选集列表一起清空并转为错误卡：**回不到上一集**，只有
     "重试"或"返回片库"两条出口（返回片库后来源筛选在，但选集位置丢失）。
- **严重度**：中　**判定标准**：状态残留 / 缺态
- **证据**：
  - `src/renderer/renderer.ts:2964-2967`（`if (entering || retrying)` 才 `clearDetailContent` + `setDetailViewState("loading")`）
  - `src/renderer/renderer.ts:2961-2963`（非 entering/retrying 时什么都不改）
  - `src/renderer/renderer.ts:3008-3016` + `src/renderer/renderer.ts:2922-2929`（失败 → 清空内容 + 错误卡）
  - `src/renderer/renderer.ts:3870-3874`（选集点击走 `openDetail`，无 `re-opening` 载体）
- **建议修复方向**：切集进入独立的 `re-opening` 态（骨架/局部 loading，保留作品级外壳但**不显示上一集的集内容**，
  播放按钮禁用）；失败时回到"该集读取失败"的局部态并保留选集列表与上一集的选中态，而不是整页错误卡。
  与 Ticket 18 落点一致。

### P-04 · D5 切换剧集：焦点丢失（落到 body）

- **操作 ID**：D5（键盘路径）
- **路径**：Tab 到某集按钮 → Enter → `openDetail` 成功 → `renderDetail` 用 `replaceChildren` 重建选集
- **现象**：被激活的行按钮被移除，`openDetail` 只在 `entering || retrying` 时才把焦点放到标题 → 切集后
  `document.activeElement === body`，Tab 从头开始（回到窗口标题栏按钮），键盘用户失去位置。滚动位置同样由
  整页重渲染决定（见 P-02）。
- **严重度**：中　**判定标准**：焦点丢失
- **证据**：
  - `src/renderer/renderer.ts:3006`（`if (entering || retrying) detailTitle?.focus(...)`——切集不满足）
  - `src/renderer/renderer.ts:3121`（`detailEpisodes.replaceChildren(...)` 销毁原按钮）
  - `src/renderer/renderer.ts:3870-3874`（点击目标不复用）
- **建议修复方向**：切集成功后把焦点放回"新选中集"的按钮（`[data-media-id=...]`，`focus({preventScroll:true})`），
  或用 `detailTitle` 承接；重渲染时保留滚动锚点（记录当前集相对位移）。

### P-05 · D6 继续播放：`watched` 与观看账本两套口径分叉，看完的片仍在"继续观看"

- **操作 ID**：D6（分支：看到 ≥90% 后关闭，引擎未报 `ended`）
- **路径**：播放到 90%+ → 关闭播放器（未自然播完）→ 回详情 → 看"继续播放/集行状态/继续观看架"
- **现象**：`playback_state.watched` 只在引擎 `state:"ended"` 时置真（全仓唯一写入点），而账本用
  `isCompletedWatch`（有效观看 ≥30s 且末位置 ≥90% 时长）判完成。于是同一次观看出现：
  - 详情主按钮仍是"继续播放 · 01:59:00"、集行仍是"看到 01:59"；
  - 首页"继续观看"仍然列出这条（查询条件 `playback_state.watched = 0`）；
  - 而"你的记录"里"完整看完 1 次"。
  即 D6 的"继续"与 D1/D9 的"已看完"显示互相矛盾，用户无法判断是否真的看完。
- **严重度**：中　**判定标准**：误导文案（同一事实两处相反）
- **证据**：
  - `src/main/player.ts:379-388`（只有 `ended` 置 `active.watched = true`）
  - `src/main/player.ts:309`（`watched: active.watched` 写入 `playback_state`）
  - `src/main/local-library-worker.ts:1889-1893`（`sessionCompletes` → `isCompletedWatch`）
  - `src/shared/local-library-contracts.ts:142`（`COMPLETION_PERCENT = 90`）、`:140`（30s 门槛）
  - `src/main/local-library-worker.ts:1399-1414`（继续观看只排除 `watched = 1`）
  - `src/renderer/renderer.ts:3087-3113`、`src/renderer/views/detail.ts:38`（详情/集行标签只读 `playback_state`）
- **建议修复方向**：把"完成"收敛为一处（账本完成结论回写 `playback_state.watched`，或详情/继续观看改为读账本口径），
  与 Ticket 10 的"单一完成函数"同源；不要保留两套判据。

### P-06 · E2 加载失败：所有失败原因合并成一句话，且没有可执行的恢复出口

- **操作 ID**：E2（主路径 + 异常：文件已删/编解码不支持/`libmpv` 缺失/非 Windows）
- **路径**：点播放 → `coordinator.open` 内 `resolveMediaPath`/`engine.start` 抛错 → `emit({type:"error"})`
- **现象**：无论是"索引里的文件已被删除/移动"、"libmpv-2.dll 找不到"、"平台不支持"还是解码失败，renderer 收到的
  都是同一句"本地媒体加载失败。"（`error.message` 被替换为固定文案）。面板只有"重试/返回"：
  - 文件已不存在时重试**必然失败**，文案里没有"该文件可能已被移动/删除，重新扫描来源"这类可执行指引；
  - `libmpv` 缺失/平台不支持时同样只能反复重试，属不可恢复循环。
- **严重度**：中　**判定标准**：静默失败（原因丢失）+ 不可恢复
- **证据**：
  - `src/main/player.ts:149-156`（catch 内统一 `message: "本地媒体加载失败。"`，原始 error 被吞）
  - `src/main/player.ts:134-135`（`if (!path) throw new Error("indexed media is unavailable")`）
  - `src/main/mpv-player.ts:148-149`（平台/exists 检查）、`:183`（`start` 失败 rethrow）
  - `src/renderer/renderer.ts:1609-1613`（只把 message 放进面板）
- **建议修复方向**：`error` 事件带一个可枚举原因（如 `unavailable` / `engine` / `decode`），renderer 对应给出
  "重新扫描来源"（跳文件夹页并聚焦该来源）或"播放器组件不可用"的可执行说明；`unavailable` 类失败不提供"重试"
  作为主操作。

### P-07 · E3 播放控制：失败反馈只写进 `sr-only` 状态行，视力用户完全看不到

- **操作 ID**：E3（异常：命令失败）
- **路径**：任意控制（播放/暂停/Seek/音量/静音/速度/轨道）→ IPC 抛错或 mpv `setProperty` 失败
- **现象**：`sendLocalPlaybackCommand` 的 catch 与 `control-error` 都只调用 `setPlayerStatus(...)`，而该元素是
  `class="sr-only"`（1×1、裁剪）—— **屏幕上没有任何错误提示**，只有"音量滑块/芯片回弹"这种间接迹象；播放/暂停/Seek
  失败连回滚动作都没有，用户以为命令生效。同一问题使"已取消自动播放""已加载外部字幕"等确认文案也不可见。
- **附加症状（同一操作）**：进度条 `max` 只在 `ready` 事件写一次（`playerSeek.max = durationSec`），后续
  `position` 只更新 `value`。若 `ready` 没带 `durationSec`（部分容器首帧 duration 尚不可读），整个会话 `max` 恒为 0，
  滑块拖动无效（`--progress` 仍在动，视觉上像"能拖但拖不动"）。
- **严重度**：中　**判定标准**：静默失败
- **证据**：
  - `src/renderer/index.html:400`（`<span id="player-status" class="sr-only" ...>`）
  - `src/renderer/styles.css:198`（`.sr-only` 视觉隐藏）
  - `src/renderer/renderer.ts:1617-1625`（catch → `setPlayerStatus("播放控制失败，请重试。", true)`）
  - `src/renderer/renderer.ts:1604-1608`（`control-error` 同路径）
  - `src/main/mpv-player.ts:259-266`（`setProperty` 失败只发 `control-error`）
  - `src/renderer/renderer.ts:1549-1559`（只在 `ready` 设 `max`）与 `:1577-1584`（`position` 只设 `value`）
- **建议修复方向**：新增可见的播放器提示条（overlay 镜像里同步），把 `player-status` 的 error 态升级成可视化 toast；
  `position` 事件里同步 `max`（`durationSec` 变化时更新）；Seek 失败时把滑块值回滚到最近一次服务端位置。

### P-08 · E4 全屏：加载态/错误态下 Esc、F 与全屏按钮同时失效，无法退出全屏

- **操作 ID**：E4（分支：播放错误）
- **路径**：全屏播放 → 播放报错（文件被删/解码失败）→ `setPlayerControlsEnabled(false)` → 按 Esc / F / 点"全屏"
- **现象**：`handlePlayerShortcut` 在解析快捷键**之前**有 `if (playerToggleButton?.disabled) return;`，而错误态把
  播放按钮、全屏按钮一起禁用 → Esc 退出全屏的分支（在守卫之后）永远走不到，全屏按钮也不可点。用户被留在全屏错误
  面板里，唯一出口是"关闭播放器"（会连带退出全屏并返回详情/首页），"退出全屏继续看错误信息"做不到。
- **严重度**：中　**判定标准**：不可恢复（局部）/ 缺态（缺"非播放态仍可退出全屏"）
- **证据**：
  - `src/renderer/renderer.ts:1265`（`if (playerToggleButton?.disabled) return;`）
  - `src/renderer/renderer.ts:1268-1272`（Escape 退出全屏在守卫之后）
  - `src/renderer/renderer.ts:988-1001`（`setPlayerControlsEnabled(false)` 同时禁用 `player-fullscreen-button`）
  - `src/renderer/renderer.ts:1609-1613`（error 分支禁用控件）
  - `src/main/player.ts:241-257` + `src/main/player-host.ts:218`（关闭时才 `setWindowFullscreen(false)`）
- **建议修复方向**：把全屏退出（Esc/F/按钮）从"播放控制可用"守卫中摘出，错误/加载态保持全屏按钮与 Esc 可用；
  `setPlayerControlsEnabled` 拆成"播放类控件"与"视图类控件"两组。

### P-09 · E7/D9 关闭播放器：焦点丢失，且设置面板/菜单跨会话残留

- **操作 ID**：E7（三条返回路径）、D9（播放器返回后状态残留）
- **路径**：详情/首页 → 播放器（可能开过"设置"或某个音轨/速度菜单）→ 关闭
- **现象**：
  1. **焦点丢失**：`handlePlayerClosed` 收起播放器视图后没有把焦点交回任何元素；详情刷新路径（`openDetail(mediaId)`）
     只在 `entering || retrying` 时聚焦标题，于是焦点落在 `body`。键盘用户回到列表/详情后 Tab 从文档头开始。
  2. **设置面板残留**：`#player-settings` 只在 `closePlayerSettings`（Esc/关闭按钮/面板外 pointerdown）里被隐藏，
     `handlePlayerClosed` 不复位它，也不复位 `#player-settings-button[aria-expanded]` 与打开的菜单 listbox。下一次打开
     播放器时 `sendOverlayState` 按元素 `hidden` 全量推送 → **新会话第一帧就是打开着的设置面板**；菜单同理。
     真实窗口里点 overlay 的关闭按钮只转发 `click`（不触发主窗口的 `pointerdown` 外点关闭），所以这条路径可稳定复现。
  3. 附带：`playerAudioTracks`/`playerSubtitleTracks` 也未在 `resetPlayerSessionMirror` 清空，新会话首次 `tracks`
     事件到达前会短暂显示上一部片子的轨道列表。
- **严重度**：中　**判定标准**：焦点丢失 / 状态残留
- **证据**：
  - `src/renderer/renderer.ts:1479-1527`（唯一拆卸入口，无 focus 恢复、无 `closePlayerSettings`）
  - `src/renderer/renderer.ts:1462-1472`（`resetPlayerSessionMirror` 不清轨道数组）
  - `src/renderer/renderer.ts:1169-1193`（设置面板开/关只在自身路径里写 `hidden`/`aria-expanded`）
  - `src/renderer/renderer.ts:3006`（详情刷新不聚焦）
  - `src/renderer/renderer.ts:3910-3919`（面板外关闭依赖 `pointerdown`）
  - `src/renderer/overlay.js:85-93`（overlay 只转发 `click`/`input`/`change`，不转发 `pointerdown`）
- **建议修复方向**：`handlePlayerClosed` 末尾统一复位播放器内部浮层（`closePlayerSettings(false)` + 关菜单 + 清轨道数组 +
  `aria-expanded=false`），并按返回目标把焦点交给"返回前的来源元素"（详情标题 / 打开播放的那张卡 / 整理候选卡），
  与 `closeDetail` 已有的 `focusMediaId` 恢复机制共用一套。

### P-10 · E5 音轨/字幕：选"自动"只改 UI 不发命令、不清偏好；外部字幕没有任何可见结果

- **操作 ID**：E5（分支：音轨=自动；外部字幕成功/取消/失败）
- **现象**：
  1. 音轨选"自动"（选项 value 为 `""`）时 `applyPlayerMenuValue` 只把本地 `selected` 全置 false 就 `return`，
     **不下发任何命令**：UI 显示"自动"，引擎仍在用人工选定的轨；`active.audioTrackId` 也没有被清，所以下次打开
     仍是旧偏好。"自动"是一个只改显示的空操作。
  2. 外部字幕：`chooseSubtitleFile()` 返回 `loaded:false`（取消、无活动会话、字幕文件不可读）时代码什么都不做；
     成功也只写 `sr-only` 状态（见 P-07）。用户无法确认字幕文件到底加载了没有，只能去字幕菜单里找。
- **严重度**：低　**判定标准**：误导文案 / 静默失败
- **证据**：
  - `src/renderer/renderer.ts:1109-1119`（audio 分支 `if (!value) return;`）
  - `src/renderer/renderer.ts:1025-1036`（"自动"选项 `value: ""`）
  - `src/shared/local-playback-contracts.ts:94-97`（`set-audio-track` 要求非空 `trackId`，没有"自动"命令）
  - `src/renderer/renderer.ts:3946-3952`（`loaded` 才提示，且提示是 sr-only）
  - `src/main/player.ts:209-228`（`loaded:false` 的多种原因不落到 UI）
- **建议修复方向**：给 `set-audio-track` 增加 `null`（=自动）语义并在协调器清空偏好；外部字幕成功/失败/取消分别给
  可见提示（取消可静默，失败必须可见）。

### P-11 · E8 播放中打开另一部：连点"下一集/立即播放"没有重入保护，会跳过一集

- **操作 ID**：E8（分支：快速连点）
- **路径**：播放中双击"下一集"（或结束面板双击"立即播放"）
- **现象**：`playNextEpisode` 无 busy/代际守卫，两次调用各自 `nextEpisode()`（基于已被第一次改写的
  `selectedMediaId`）→ 第二次算出的是**再下一集**，并再次 `open`。结果是跳集 + 两次 `beginTransition`，用户看到的是
  "第 3 集"而不是"第 2 集"。（旧会话结算本身没问题：`beginTransition` 会落盘进度并结束账本，且不发 `closed`。）
- **严重度**：低　**判定标准**：并发破损
- **证据**：
  - `src/renderer/renderer.ts:1334-1343`（无重入守卫，先改 `selectedMediaId` 再 `open`）
  - `src/renderer/renderer.ts:3920-3921`（"下一集"按钮与"立即播放"都直连 `playNextEpisode`）
  - `src/main/player.ts:272-287`（`beginTransition` 会接受第二次 open，只有 `loading` 事件区分两次）
- **建议修复方向**：`playNextEpisode` 加 `nextBusy` 守卫（`open` 的 `loading`/`ready` 解除），或在 `open` 在途时禁用
  "下一集/立即播放"。

### P-12 · E1/D7 打开与重试：`open` 的结果被忽略；错误态"重试"丢失 restart 意图

- **操作 ID**：E1（分支：`open` 返回 `opened:false`）、D7（异常：从头播放失败后重试）
- **现象**：
  1. `openSelectedLocalMedia` 只用 try/catch 处理**抛错**，忽略 `{opened:false}`（main 在窗口已销毁/host 已关闭时返回它）。
     此时播放器视图已显示、没有任何事件到来，界面停在"正在加载本地媒体…"，只能靠用户手动关闭（1.5s 兜底只在
     `requestPlayerClose` 时才启动）。
  2. "从头播放"失败进入错误面板后，`player-error-retry` 调 `openSelectedLocalMedia()`（**不带 restart**）→ 重试变成
     "从旧进度继续"，与用户刚才点的"从头播放（会清除当前观看进度）"相反，且无任何提示。
- **严重度**：低　**判定标准**：静默失败 / 误导文案
- **证据**：
  - `src/renderer/renderer.ts:3255-3268`（`await window.zVideo.localPlayback.open(...)`，返回值未用）
  - `src/main/player-host.ts:226-231`（`return { opened: false }` 的两条早退）
  - `src/renderer/renderer.ts:3934-3938`（retry 不带 restart）与 `:3930`（replay 带 restart）
  - `src/renderer/renderer.ts:3103`（"从头播放（会清除当前观看进度）"）
- **建议修复方向**：记住本次尝试的 `restart` 意图（`pendingPlaybackRestart`），错误重试沿用；`opened:false` 时立刻
  `discardPlayerSession` + 回退视图并给可见提示。

### P-13 · D9 详情 → 搜索 → 返回详情：详情滚动位置被重置，且必然重取

- **操作 ID**：D9（分支：详情内用顶栏搜索再返回）
- **现象**：`clearSearch` 回详情时调用 `openDetail(mediaId, undefined, origin)`，但 `entering`（详情此前被
  `showSearchView` 隐藏）为真 → 走 `setDetailScroll(0)`，**即使带着 `restoringOrigin` 也不恢复 `origin.scrollTop`**。
  用户从简介/选集深处去搜一个片名再返回，回到详情顶部。`restoringOrigin` 只用于 `detailOrigin`/返回按钮文案。
- **严重度**：低　**判定标准**：滚动丢失
- **证据**：
  - `src/renderer/renderer.ts:2957-2960`（`entering` → `setDetailScroll(0)`）
  - `src/renderer/renderer.ts:775-782`（`clearSearch` → `openDetail(..., origin.detail.origin)`）
  - `src/renderer/renderer.ts:2852-2857`（`restoreDetailScroll` 存在但此路径未调用）
- **建议修复方向**：`restoringOrigin` 非空时在 `renderDetail` 之后 `restoreDetailScroll(restoringOrigin)`（而不是 0），
  并按 `episodeId` 恢复选中集与焦点。

## 3. 分支/异常路径覆盖记录（要点）

| 操作 | 主路径 | 分支 | 异常 | 恢复 |
|---|---|---|---|---|
| D1 | 通过 | 连点两张卡 → 旧请求按 epoch 丢弃 | `get` 失败 → D2 | 错误卡重试 |
| D2 | 通过 | 重试（清内容 → loading） | 再次失败 | 重试/返回片库 |
| D3 | 通过 | 切集时目标被墓碑 → unavailable | 返回按钮文案随 origin | 返回片库 |
| D4 | 问题 | 多季/缺季号（P-01）、换作品（P-02） | 无取数（本地重渲染） | 重新选季 |
| D5 | 问题 | 连点两集 → 旧 epoch 丢弃，仍无 loading | 失败 → 整页错误卡（P-03） | 重试/返回 |
| D6 | 问题 | 已看完 → 走"重新播放"；≥90% 关闭（P-05） | 文件不可用 → E2 | 返回详情 |
| D7 | 问题 | 从头播放失败 → 重试丢意图（P-12） | `restart` 被 IPC 校验拒绝会抛错 | 返回 |
| D8 | 通过 | 从搜索/首页返回、页面收缩触发换页 | 重载失败 → 错误卡 + 焦点仍回卡片 | 重试当前页 |
| D9 | 问题 | 播放器返回（P-09）、搜索返回（P-13） | 播放器错误返回 → 详情刷新 | 三条返回路径齐备 |
| E1 | 问题 | `opened:false`（P-12） | 事件永不到达 | 关闭（兜底在关闭时启动） |
| E2 | 问题 | 错误后重试 → 续播 | 引擎级失败不可恢复（P-06） | 返回详情/首页 |
| E3 | 问题 | 拖拽中失败延后回滚（Ticket 09 已修） | 命令失败仅 sr-only（P-07） | 滑块/芯片回弹 |
| E4 | 问题 | 退出全屏（Esc/F/按钮） | 错误态全禁（P-08） | 关闭播放器 |
| E5 | 问题 | 自动音轨空操作（P-10）、字幕 off 已修 | 外部字幕失败无声（P-10） | 菜单重选 |
| E6 | 通过 | 取消 → 面板收起（控制条"下一集"仍在） | 下一集加载失败 → E2 | 重播/返回 |
| E7 | 问题 | 返回详情/首页/整理三条 | 无 `closed` → 1.5s 兜底 | 详情原地刷新 |
| E8 | 问题 | 自动下一集/立即播放/重播 | 连点跳集（P-11） | — |
| E9 | 通过 | 窗口 X / 菜单退出 / 系统退出 | 崩溃 → 启动补记账本 | 重启后自愈 |
| E10 | 通过 | 关闭按钮 + 返回列表连点 | `closed` 丢失 → 兜底一次 | 视角复原 |

## 4. 需真机复核（不得由本次静态走查代替）

1. **E1/E3/E6**：原生视频子窗口接管、首帧黑场/闪烁、overlay 控件是否随 struct push 正确绘制（`player-overlay.ts`
   + `overlay.js`）。本报告只能确认镜像数据源正确。
2. **E4**：全屏几何 —— native 子窗口 `resize()` 的 `titleHeight` 计算（`native-window.ts:111`）、overlay `syncBounds`
   在 enter/leave fullscreen 与多显示器 DPI 变化下的对齐、DWM 下的黑边/裁切。
3. **E6**：自动下一集时原生画面切换是否有残留帧、结束面板倒计时环是否按 `--remaining` 平滑收敛。
4. **E9**：窗口关闭/进程退出时进度与账本是否真的落盘（`before-quit` 的 await 链是否被 OS 关闭流程打断），
   以及 `test:player-window` / `test:player-overlay-window`（Ticket 17 仍未执行）。
5. **D4**：切季整页重渲染造成的封面闪动/滚动跳变的实际观感。

## 5. 未重复报告 / 复核边界说明

- 已修且本次未发现回退（不重复报告）：`closed` 丢失与视图卡死、双击关闭双发、pre-load 伪 `ended`（`loaded` 门）、
  失败态 `active` 残留与 `control-error` 风暴、`close()` 等待进度落盘、结束面板 10s 自动跳集与取消、
  轨道偏好 latch/同事件覆盖、字幕 `off` 哨兵持久化、失败回滚（音量/静音/速度/音轨/字幕）、墓碑不返回详情空壳、
  账本完成口径统一、`scan_runs` 启动修复、degraded/offline 拆分。
- 与既有票的关系：P-03 落在 `Ticket 18`（re-opening）；P-09 的浮层复位与 `Ticket 15/17` 的图层与窗口验证相邻；
  P-02 的视图/状态残留与 `Ticket 15`（baseView）主题一致。本次不新开票，按 `Ticket 20` 的 blocker 口径交给后续分组。
- 关于 D9 的"详情内打开整理"：`#cleanup-entry` 位于 `#collection-section` 的工具栏（`index.html:184`），而
  `openDetail` 会隐藏该容器（`renderer.ts:2976`），因此**详情页内不存在整理入口**，该分支不适用；D9 的"整理"半程
  只发生在 A3 检查模式反方向（整理 → 播放 → 返回整理），属 F 区。
- 测试参考（**未运行**，仅说明覆盖存在）：`tests/local-playback.test.ts`（关闭幂等/进度落盘/轨道偏好）、
  `tests/local-playback-resume-smoke.ts`、`tests/player-window-smoke.ts`、`tests/player-overlay-window-smoke.ts`、
  `tests/local-library-app-smoke.ts`（详情错误态焦点、卡片焦点恢复、播放器关闭后详情恢复）。
  本次未执行 `npm run typecheck` / `npm test` / 任何窗口冒烟，结论不含运行证据。

## 6. 汇总

- 19 项：通过 7、问题 12、需真机 0（感官部分单列 §4）。
- 问题按判定标准分布：状态残留 3（P-02/P-03/P-09）、焦点丢失 2（P-04/P-09）、缺态 2（P-01/P-03）、
  静默失败 4（P-06/P-07/P-10/P-12）、误导文案 3（P-02/P-05/P-10/P-12）、不可恢复 2（P-06/P-08）、
  并发破损 1（P-11）、滚动丢失 1（P-13）。
- 最值得优先处理的三个（若只修三条）：**P-05**（完成口径分叉，用户可见矛盾且污染首页"继续观看"）、
  **P-07**（控制失败全静默）、**P-03**（切集无载入态 + 失败吞列表）。
