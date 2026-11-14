# UX 流程审计 · F 区（整理与检查，10 项）

- 基线：`30210bd`（2026-11-14，主工作树 `D:\project\z-video`，非 `.worktrees`；工作区仅有未跟踪的 `designs/`）
- 方法：`docs/local-library/ux-flow-audit.md` §1/§4/§5；每个操作走 主路径 / 分支 / 异常 / 恢复，按 §5 的 8 条标准判定（死路、状态残留、静默失败、误导文案、不可恢复、缺态、焦点/滚动丢失、并发破损）
- 边界：**只读静态走查**。未修改任何源码；未运行 `npm run build`/`npm test`/`npm run test:window`；未启动应用、未做真机点击。纯感官项（焦点环样式、滚动回弹、原生 Explorer 行为）标“需真机”，未伪装验证
- 交叉核对：`docs/local-library/state-machines.md`（#7 清理标记 / #28 整理·检查模式）、`docs/local-library/tickets/14-cleanup-keep-terminal.md`、`tests/cleanup-contracts.test.ts`、`tests/local-library-app-smoke.ts` 的 A2/A3 段（只读引用，未执行）
- 命名：**操作 ID 用 `F1`–`F10`（无横线）**；**发现 ID 用 `CL-01` 起**，避免与操作 ID 混淆
- 结论分布：通过 1 · 问题 9 · 需真机 0；共 15 条问题：0 blocker / 9 中 / 6 低
- 已修项不重复报告：`keep` 终态（Ticket 14）、`degraded` 与 `offline` 区分（Ticket 08）、整理页错误态清 `reviewTarget`（Ticket 14）

## 1. 结论表（10 行）

| ID | 操作 / 已覆盖路径 | 结论 | 关联问题 | 证据锚点 |
|---|---|---|---|---|
| F1 | 进入整理页：有候选 / 无候选 / 空库 / 来源离线 / 扫描中进入 / 错误态下点击入口 | **问题** | CL-01、CL-10 | `renderer.ts:2309-2338`、`2274-2284`、`1668-1689`、`local-library-worker.ts:1653-1675` |
| F2 | 规则筛选（全部+C/D/A/B/E）/ 状态筛选（待整理/已保留/稍后/待删）/ 组合为空 / 快速连点 | **问题** | CL-02、CL-03、CL-04 | `renderer.ts:2192-2226`、`2251-2289`、`cleanup.ts:119-127`、`local-library-worker.ts:1707-1733` |
| F3 | 标记 keep / snooze / delete：成功后卡片移除、消息、失败回显、连点不同卡片 | **问题** | CL-05、CL-06、CL-15 | `renderer.ts:2355-2377`、`2264-2273`、`cleanup.ts:135-152` |
| F4 | 取消标记（keep/snooze「撤销标记」、delete「移回候选」、待删清单「移回候选」） | **问题** | CL-05 | `renderer.ts:2355-2377`、`2734-2742`、`4113-4118` |
| F5 | 查看待删清单：数量/体积、排序、空清单、>200 项截断、标记后清单刷新 | **问题** | CL-12 | `renderer.ts:2726-2743`、`local-library-worker.ts:1735-1749` |
| F6 | 在资源管理器中显示：文件存在 / 已消失 / 来源离线 / 主进程返回结果 | **问题**（Explorer 行为需真机） | CL-13 | `local-library-ipc.ts:113-120`、`local-library-worker.ts:1481-1495`、`renderer.ts:2753-2761` |
| F7 | 整理设置：三档预设 / 自定义 / 关全部规则 / 校验失败 / 恢复默认 / 保存失败 | **问题** | CL-14、CL-15 | `renderer.ts:2550-2649`、`2670-2724`、`cleanup-contracts.ts:177-193,334-350` |
| F8 | 整理设置保存失败：草稿保留、错误可见、可重试、队列不重算 | **通过** | — | `renderer.ts:2702-2724`、`index.html:89,93`、`app-preferences-ipc.ts:19-22` |
| F9 | 检查模式：打开 / 关闭后决定 / 标记失败重试 / Esc 中途返回 / 打开失败 / 播放结束 | **问题** | CL-07、CL-08、CL-09 | `renderer.ts:2486-2516`、`2401-2483`、`1395-1424`、`3255-3268` |
| F10 | 整理中返回片库（按钮 / Esc / 顶栏导航）：滚动、焦点、候选 DOM、数据刷新 | **问题** | CL-10、CL-11 | `renderer.ts:2340-2353`、`2313-2336`、`3675-3697` |

## 2. 问题详情

> 严重度按“影响 × 可达性”标注；括号内是 `ux-flow-audit.md` §5 的判定类别。

### CL-01 · F1 · 来源离线（或空库 / 规则全关）时，整理页统一说“当前没有候选”，不解释真实原因

- **路径**：F1 异常分支——至少一个来源 `available=false`（驱动器/网络位置断开）→ 点“整理”
- **现象**：整理队列 SQL 只取 `media_files.available = 1 AND sources.available = 1`，离线来源的文件（含已标“待删”的）整体从队列和待删清单消失；而整理页**没有任何离线提示**：`renderOfflineNotice()` 的可见条件是 `... && !cleanupVisible`，`showCleanup()` 又显式 `libraryOfflineNotice.hidden = true`。于是用户看到“候选 0 部”+“当前没有候选 / 当前规则和阈值下没有需要整理的文件”，把“来源断了”读成“没有可整理的文件”；待删清单同时变成 0 项、“查看清单”按钮被禁用，用户手标的待删项仿佛消失。同一文案在“片库本来就空”“A–E 规则全部关闭”两种成因下也照旧输出，只建议调预设/阈值。
- **严重度**：中（判定：误导文案 + 缺态）——注意这不是把 `degraded` 当 `offline`（degraded 来源的条目仍会入队），而是整理页对 offline 完全失语。
- **证据**：`src/main/local-library-worker.ts:1674`（`WHERE media_files.available = 1 AND sources.available = 1`）、`:1735`（待删清单同源）；`src/renderer/renderer.ts:1673`（`!cleanupVisible`）、`:2325`（进入时显式隐藏离线条）、`:2274-2284`（空态标题/正文只按 `state` 分支）、`:2254-2257`（摘要不含“已排除 N 个离线来源”）
- **建议修复方向**：整理页复用来源可用性（`state.sources`）做一条页内提示（离线 N 个来源/降级 N 个来源，含“去文件夹页重新扫描”入口），并在摘要里标注被排除的数量；空态文案按成因分支（离线 / 空库 / 所有规则关闭 / 仅规则或阈值过滤），不要一律归因到阈值。

### CL-02 · F2 · “已保留 / 稍后 / 待删”视图里，文件不再命中任何规则时卡片渲染成“规则 undefined · undefined”

- **路径**：F2 状态筛选 → 某张已标记卡片；触发前提是标记后该文件不再命中 A–E（最典型：给“从未打开”的 3 GB 候选做一次检查播放后选“保留”——打开次数变 1、上次打开变今天，A/B/C 全部失效，体积又不到 `veryLargeBytes`）
- **现象**：worker 对每条记录算 `rule`，未命中即 `undefined`；状态视图（`state !== "none"`）只按 `cleanupState` 过滤，`rule` 可以为空，但 DTO 里仍 `rule: entry.rule as CleanupRuleId` 强转。渲染侧直接拼 `规则 ${candidate.rule} · ${CLEANUP_RULE_LABELS[candidate.rule]}` → 卡片出现“规则 undefined · undefined”，`data-cleanup-rule="undefined"`，命中原因退回默认的“打开 N 次 · 大小”。同一份数据在“待整理”视图是正常的，切到“已保留”就变成英文 `undefined`。
- **严重度**：中（判定：缺态 + 误导文案）
- **证据**：`src/main/local-library-worker.ts:1693-1705`（`rule` 可空）、`:1723-1733`（`rule: entry.rule as CleanupRuleId`）、`:1707-1715`（状态视图不要求 rule 存在）；`src/renderer/views/cleanup.ts:119-127`、`:75-76`（default 原因）；`src/shared/cleanup-contracts.ts:355-356`（`rule` 被声明为必填）
- **建议修复方向**：把 `LocalCleanupCandidate.rule` 改成可选（或新增 `rule?: CleanupRuleId` 与显式 `ruleUnavailable` 语义），已标记卡缺规则时显示“已不满足当前任何规则（可按需改回候选）”，并保留 `cleanupState` 芯片；worker 侧去掉 `as CleanupRuleId` 强转，让类型与数据一致。

### CL-03 · F2 · 规则 + 状态组合为空时，空态只按状态解释，把规则筛选造成的空结果说成“没有该标记”

- **路径**：F2 分支——先点状态“已保留”，再点规则“C”，结果 0 条
- **现象**：worker 对 `state !== "none"` 的过滤是先按状态、再按规则（`entry.rule === requestedRule`），因此“有保留记录、但都不再命中 C”与“没有保留记录”都得到 0 条；空态标题恒为 `没有“已保留”标记`，正文恒为“标记过的文件会留在这里；撤销标记后它会重新进入待整理”。用户会以为保留标记丢了。界面上也没有“清除规则筛选”的显式动作，只有把规则按钮再点回“全部规则”。
- **严重度**：中（判定：误导文案 + 缺态）
- **证据**：`src/renderer/renderer.ts:2274-2284`、`:2253-2257`；`src/main/local-library-worker.ts:1707-1715`
- **建议修复方向**：空态按“状态 + 规则”双条件生成文案（例如“已保留的 12 项里没有命中规则 C 的；清除规则筛选可查看全部”），并提供“清除规则筛选 / 查看全部已标记”按钮；`totalCount` 与条件无关的那部分（该状态总数）一并回传，供文案使用。

### CL-04 · F2 · 切换规则/状态筛选后整组按钮被重建，键盘焦点丢到 body

- **路径**：F2 主路径——键盘聚焦某个筛选按钮 → Enter
- **现象**：`setCleanupQuery()` 无条件调用 `renderCleanupFilters()`，后者对 `#cleanup-rule-filters` 与 `#cleanup-state-filters` 都 `replaceChildren(...)`，被点击的按钮从 DOM 移除，焦点回落到 `body`；下一次 Tab 从文档开头重新开始，不会停在刚选中的筛选项上。鼠标用户看不出来，纯键盘用户每次筛选都要重新走一遍 Tab。
- **严重度**：中（判定：焦点丢失）
- **证据**：`src/renderer/renderer.ts:2222-2226`（切换即重绘）、`:2192-2220`（两组按钮 `replaceChildren`）
- **建议修复方向**：筛选按钮只同步 `aria-pressed`，不重建 DOM（或重绘后按 `dataset.cleanupRule/cleanupState` 把焦点还回同一项）；同时给两组筛选加 `aria-controls="cleanup-candidates"`。

### CL-05 · F3/F4 · 卡片级标记（保留/稍后/待删）与取消标记后，焦点随卡片一起消失

- **路径**：F3 主路径（在“待整理”列表点某卡的“保留”）、F4 主路径（在“已保留”列表点“撤销标记”；待删清单行点“移回候选”）
- **现象**：标记成功后 `loadCleanupQueue()` 重新渲染，`#cleanup-candidates` 整体 `replaceChildren`，被操作的那张卡（以及待删清单里被移除的行）都不再存在；`setCleanupMark()` 结束时**没有**任何焦点回收。焦点落到 `body`，页面的滚动条仍停在原处，键盘用户失去“我刚才在哪一行”的位置。对照：检查模式的决定路径有显式回收（`focusCleanupCard(target.mediaId)` 或返回队列时的同一函数），行为不一致。
- **严重度**：中（判定：焦点丢失）
- **证据**：`src/renderer/renderer.ts:2355-2377`（无 focus 回收）、`:2264-2273`（候选整组重建）、`:2734-2742`＋`:4113-4118`（清单行重建）；对照 `:2445`、`:2469`（检查路径有 `focusCleanupCard`）、`:2393-2399`
- **建议修复方向**：标记后按“同位置后继”定位：记下被操作卡在列表中的索引，重绘后聚焦同索引卡片（空则聚焦“返回片库”或 `#cleanup-title`）；取消标记后聚焦被移回的那张卡（在“待整理”视图里通常仍存在）。待删清单同样处理（行被移除后聚焦下一行/关闭按钮）。

### CL-06 · F3 · 标记尚未返回时点另一张卡的标记按钮，被静默忽略且无任何反馈

- **路径**：F3 分支——连续快速标记两张卡（本地 SQLite 通常在几十毫秒内返回，但慢盘/worker 重连时窗口可达数百毫秒）
- **现象**：`setCleanupMark()` 入口 `if (cleanupMarkBusy) return;` 直接返回；按钮没有 `disabled`，也没有排队或提示。第一次标记的消息（“正在更新标记…”，随后变成“已保留…”）会覆盖第二次点击的语义，用户容易认为两张卡都已处理；实际第二张仍在“待整理”里。待删清单里的“移回候选”共用同一个互斥，同样会被静默吞掉。检查模式的决定路径反而做了 `setReviewDialogBusy(true)` 全按钮禁用，两条路径的并发策略不一致。
- **严重度**：中（判定：并发破损 + 静默失败）
- **证据**：`src/renderer/renderer.ts:2355-2358`、`:2372-2377`；`src/renderer/views/cleanup.ts:135-152`（按钮无 busy 态）；对照 `:2386-2391`（检查对话框有 busy 禁用）
- **建议修复方向**：标记期间禁用所有 `[data-cleanup-action]`（或按卡片队列串行处理并在被忽略的点击上给出“上一个标记还在保存”的提示）；统一 `cleanupMarkBusy` 的 UI 表达，别让两条标记路径各自一套。

### CL-07 · F9 · 检查播放打开失败后，决定框照常弹出，框内没有错误文案也没有“重试打开”

- **路径**：F9 异常分支——点“打开检查” → `localPlayback.open()` 拒绝（文件被杀毒锁定、来源刚离线、native 播放器初始化失败）
- **现象**：`openReviewMedia()` 的 catch 只做 `discardPlayerSession / showPlayer(false) / setMessage("…", true) / openReviewDecision()`；`openReviewDecision()` 又把 `#review-decision-error` 清空并隐藏、把 `#review-retry` 隐藏。结果是用户“什么都没看到就被要求做决定”：《X》要保留吗？保留/稍后/待删。错误文字只落在片库顶部的 `#library-message`（模态背景之外），与决定框相距很远；唯一出路是“返回队列”再重新点一次“打开检查”（没有提示）。决定框的 `#review-retry` 语义是“重试标记”，复用它也覆盖不了“重试打开”。
- **严重度**：中（判定：缺态 + 静默失败）
- **证据**：`src/renderer/renderer.ts:2486-2503`（catch 不写决定框错误）、`:2401-2416`（打开时清错并隐藏重试）、`index.html:243-256`（框内只有标记动作）
- **建议修复方向**：打开失败时在决定框内显示错误并提供“重试打开 / 返回队列”，未成功打开前不建议直接给出标记结论；把“重试标记”和“重试打开”拆成两个明确动作。

### CL-08 · F9 · 检查播放结束后“重播”按钮点了没反应（`selectedMediaId` 为空）

- **路径**：F9 分支——检查播放自然结束（ended）→ 结束面板点“重播”
- **现象**：检查模式只调用 `localPlayback.open(target.mediaId)`，从不设置 `selectedMediaId`/`activeDetail`；结束面板在无下一集时显示“重播”，其处理是 `openSelectedLocalMedia(true)`，第一行 `if (!selectedMediaId) return;` 直接返回——按钮可见、可聚焦、点了完全没反应，也没有消息。用户只能改用关闭按钮。
- **严重度**：中（判定：死路 + 静默失败）
- **证据**：`src/renderer/renderer.ts:3930`（重播绑定）、`:3255-3256`（提前 return）、`:2505-2516`＋`:2486-2493`（检查路径不写 `selectedMediaId`）、`:1412`（无下一集时显示重播）
- **建议修复方向**：检查模式的重播走 `localPlayback.open(reviewTarget.mediaId, { restart: true })`（或先把 `selectedMediaId` 设为检查目标）；通用入口在 `selectedMediaId` 为空时应给出可见反馈而不是静默返回。

### CL-09 · F9 · 检查播放继承上一次详情的 `activeDetail`/`selectedMediaId`，结束面板会出现“下一集”并 10 秒自动跳集

- **路径**：F9 分支——先在详情页打开过一部剧集，用**顶栏「片库」**返回（不是详情页里的“← 返回片库”按钮），再进整理页对另一部候选做检查播放 → 该候选播放结束
- **现象**：`navigateHomeOrLibrary()` 只 `detail.hidden = true`，不清 `activeDetail`/`selectedMediaId`（只有 `closeDetail()` 与 `handlePlayerClosed()` 才清）。检查播放不写这两个变量，于是它们仍是上一部剧的状态：`nextEpisode()` 从旧 `activeDetail.episodes` 里找“当前集”，把**别的作品**的下一集当作本次播放的下一集；结束面板喊“本集已看完 / 下一集：…”、倒计时“10 秒后自动播放下一集”，到点 `playNextEpisode()` 真的会打开那部剧的下一集（在检查模式里播放了错误的文件）。播放器的“下一集”按钮同样会因此出现。若旧详情是电影（`episodes` 只有自身），则表现为把电影候选错标成“本集已看完”。
- **严重度**：中（判定：状态残留；影响是播放错误内容，命中条件较窄，建议优先修）
- **证据**：`src/renderer/renderer.ts:3675-3697`（导航不清理选择）、`:1327-1332`、`:1334-1343`（按旧 `activeDetail` 找下一集并打开）、`:1395-1424`（结束面板与自动跳集）、`:1565`（“下一集”按钮同步；每帧状态事件都会重算）、`:2505-2516`（检查路径不设置/清理选择）、`:3193-3195`、`:1495-1504`（清理点只有两处）
- **建议修复方向**：检查模式进入时显式把 `activeDetail`/`selectedMediaId` 清空（或引入独立的 `inspectionTarget`，让 `nextEpisode()`/重播/错误重试只读它）；`navigateHomeOrLibrary`/`showSources` 隐藏详情时也应清选择，或至少标记“详情不再活跃”，避免后续路径按旧详情推断。

### CL-10 · F1/F10 · 进出整理页不衔接滚动与焦点：进入不置顶，返回不恢复原位置

- **路径**：F1 主路径（片库滚到很深处 → 点“整理”）、F10 主路径（整理页里滚动 → 点“返回片库”/Esc）
- **现象**：两者都没走统一的滚动策略。`showCleanup()` 直接显示整理区并 `#cleanup-title.focus({ preventScroll: true })`，没有 `scrollResultsToTop()`，页面保留片库的滚动偏移（内容变短后被浏览器夹到底部）——用户进入整理页时看到的可能不是标题和筛选，而是列表中部/底部。`hideCleanup()` 反过来也不恢复进入前的偏移，而是直接 `loadLibrary()` 重绘，并把焦点给 `#cleanup-entry`（`preventScroll`），该按钮此时可能在视口外，Tab 会从不可见的位置继续。对照：详情页有一整套 `captureDetailOrigin`/`restoreDetailScroll`/`focusMediaId` 机制，`applyQuery`/搜索也都会 `scrollResultsToTop()`，只有整理页没有对应实现。
- **严重度**：中（判定：焦点/滚动丢失）
- **证据**：`src/renderer/renderer.ts:2309-2338`、`:2340-2353`、`:2337`、`:2352`；对照 `:2792-2797`（`scrollResultsToTop`）、`:2799-2803`、`:2822-2857`（详情的捕获/恢复）；滚动容器 `.library-content{overflow:auto}`：`styles.css:44,118`
- **建议修复方向**：进入整理时复用 `scrollResultsToTop()`；返回时记录进入前的 `scrollTop` + 触发按钮（或用 `captureDetailOrigin` 同款 origin 结构）并在 `loadLibrary()` 完成后恢复，必要时先 `scrollIntoView` 再聚焦。把“视图切换的滚动/焦点”收敛成一个共用方法，避免每个视图各写一套。

### CL-11 · F10 · 返回片库后候选 DOM 与整理消息原样保留，再次进入整理会先显示上一次的候选

- **路径**：F10 主路径——整理页 → 返回片库 → 稍后（片库数据已变：新扫描、标记变更）再次点“整理”
- **现象**：`hideCleanup()` 只 `cleanupQueue = undefined` 并隐藏区块，不清 `#cleanup-candidates` 的子节点、不清 `#cleanup-message`、不把 `#cleanup-empty` 复位。`showCleanup()` 先 `cleanupSection.hidden = false`，再 `await appPreferences.get()` 后 `await loadCleanupQueue()`；在两次 IPC 返回之前，用户看到的是**上一轮**的候选卡、摘要和消息（可能包含已经撤销/已删除的条目），随后被新结果整页替换。若新一次 `getCleanupQueue` 失败，还会走“清空候选 + 隐藏空态/清单栏”的错误分支，用户连“上一条候选”都看不到。
- **严重度**：低（判定：状态残留）
- **证据**：`src/renderer/renderer.ts:2340-2353`（不清 DOM/消息）、`:2313`（先显示区块）、`:2329-2336`（先取偏好再排队列）、`:2300-2305`（错误分支清空）
- **建议修复方向**：`showCleanup()` 进入时先复位（清候选、清消息、`cleanupEmpty.hidden = true`、`cleanupQueueBar/分页`占位）再显示区块，或先出骨架/加载态；`hideCleanup()` 释放大对象时同时清空 DOM，让“隐藏”与“卸载”一致。

### CL-12 · F5 · 待删清单只渲染前 200 项，摘要却报全量数量与体积，界面不说明截断

- **路径**：F5 分支——待删标记超过 200 项 → “查看清单”
- **现象**：worker 的 `deleteQueue` 固定 `slice(0, 200)`，但 `deleteCount`/`deleteBytes` 按全量统计；对话框摘要写“250 项 · 1.2 TB”，下面只有 200 行，既没有“仅显示前 200 项”的说明，也没有分页/继续查看入口。用户会以为清单丢了 50 项（而删除又必须逐条在资源管理器里手动完成，截断直接影响操作）。
- **严重度**：低（判定：误导文案 + 缺态）——需要夹具才能稳定复现（>200 待删），本轮为静态判定
- **证据**：`src/main/local-library-worker.ts:1735-1749`（`.slice(0, 200)` 与全量 `deleteBytes`）、`src/renderer/renderer.ts:2726-2743`（只渲染 DTO 里的 `deleteQueue`）
- **建议修复方向**：摘要标注“显示前 200 项（共 N 项）”并给“查看全部/导出清单”入口，或让待删清单也走分页（与候选一致）。

### CL-13 · F6 · “已在资源管理器中定位文件”是未经验证的成功声明

- **路径**：F6 主路径（文件仍存在）与异常分支（Explorer 未弹出/权限或 UNC 失败）
- **现象**：主进程用 `shell.showItemInFolder(filePath)` 打开资源管理器，该 API 返回 `void`，但 IPC 立刻返回 `{ revealed: true }`，渲染层据此写“已在资源管理器中定位文件；应用没有删除它。”。文件存在性有 `lstat` 校验（消失/离线 → `revealed:false` 文案正确，这半边通过），但“资源管理器是否真的弹出并选中”无法由 API 得知；一旦 Explorer 未响应、路径在断连的 UNC/映射盘上、或被策略拦截，用户仍看到成功文案，没有任何反馈或替代入口（如“复制路径”）。是否真的弹出只能真机确认。
- **严重度**：低（判定：误导文案）——Explorer 实际行为需真机
- **证据**：`src/main/local-library-ipc.ts:113-120`、`src/main/local-library-worker.ts:1481-1495`（存在性校验）、`src/renderer/renderer.ts:2753-2761`（文案）
- **建议修复方向**：文案改成“已请求在资源管理器中显示（若未弹出，请检查路径/权限）”，或补“复制完整路径/重新扫描来源”动作；主进程可先 `stat` 父目录并区分“路径不可达”与“已请求打开”。

### CL-14 · F7 · 设置表单声明的最小/最大值与真正的校验范围不一致，且保存时完全不触发浏览器校验

- **路径**：F7 分支——在阈值输入框里输入表单范围之外的值（如“新片保护期 3 天”“大文件 400 GB”“超大 1 GB”）→ 保存规则
- **现象**：输入框的 `min/max/step` 来自 `CLEANUP_THRESHOLD_FIELDS`（保护期 7–90 天、大文件 0.5–20 GB、很大 1–50 GB、超大 2–100 GB、`effectiveWatchSec` ≤120…），而实际校验是 `THRESHOLD_RULES`（保护期 1–3650、大文件 0.5–100 GB、很大/超大 0.5–100 GB、`effectiveWatchSec` ≤300…）。保存是普通按钮 `click`（不在 `<form>` 里，没有 `checkValidity`/`reportValidity`），也没有 `:invalid` 样式，于是：表单认为越界的值能保存成功，表单认为合法的范围又比真正接受的窄——用户看到的最小/最大与实际生效规则不一致，且没有任何逐字段提示。顺带：保存没有 busy 态，双击会发两次 `setCleanup`；若在保存返回前关掉再打开对话框，返回时的 `cleanupSettingsDialog?.close()` 会关掉刚重开的对话框（`close` 监听会清掉草稿），新编辑静默丢失（窄窗口）。
- **严重度**：低（判定：误导文案 + 并发破损（窄））
- **证据**：`src/renderer/renderer.ts:2594-2596`（input min/max）、`:2580-2607`、`:2680-2687`（直接读 value 换算）、`:2712-2713`（`parseCleanupSettings` 才是真校验）、`:2702-2723`（无 busy）、`:4096-4102`（close 清草稿）；`src/shared/cleanup-contracts.ts:177-193`（`THRESHOLD_RULES`）、`:334-350`（`CLEANUP_THRESHOLD_FIELDS`）；`index.html:93`（保存是普通按钮）
- **建议修复方向**：让一组范围成为唯一事实源（表单 min/max 直接由 `THRESHOLD_RULES` 派生，或让 `parseCleanupSettings` 复用 `CLEANUP_THRESHOLD_FIELDS`）；保存前 `reportValidity()`，失败时聚焦并标记具体字段；保存加 busy（禁用按钮 + `aria-busy`），并在恢复时按“同一份草稿”判断是否还属于当前对话框。

### CL-15 · F3/F7/F8 · 失败分支直接把 IPC 原始错误串（含英文方法名）显示给用户

- **路径**：F3 异常（标记写入失败）、F7/F8 异常（保存规则失败）、检查模式标记失败
- **现象**：渲染层统一用 `error.message` 作为用户文案。经 `ipcRenderer.invoke` 传递的异常会被 Electron 包成 `Error invoking remote method 'local-library:cleanup-set-state': Error: 媒体不存在` 这类字符串，于是整理页消息区、设置对话框的错误条、检查决定框会出现英文前缀 + 内部 channel 名。校验类错误（如“大文件阈值必须按大文件 ≤ 很大 ≤ 超大排列”）本身可读，但也缺少“哪一项”的定位。
- **严重度**：低（判定：误导文案）
- **证据**：`src/renderer/renderer.ts:2373`、`:2472`、`:2720`；`src/main/local-library-ipc.ts:106-112`（抛出原始 Error）；`src/shared/cleanup-contracts.ts:203-236`（校验文案）
- **建议修复方向**：在主进程侧把错误映射成稳定错误码 + 中文文案（renderer 保留兜底文案），渲染层不要直接展示 `error.message`；设置校验失败时返回 `{field, message}` 以便高亮字段。

## 3. 通过项与关键判断（未展开成问题）

- **F8（通过）**：保存失败时对话框不关闭、`#cleanup-settings-error` 以 `role="alert"` 显示、DOM 输入值保留（草稿不丢），队列与已生效设置都不变；重试路径存在（再次点“保存规则”）。IPC 侧还有 `parseCleanupSettings` 双重校验（`app-preferences-ipc.ts:19-22`、`app-preferences.ts:44-47`）。
- **F1 错误态**：片库进入 `status=error` 时 `#collection-section` 被隐藏，而“整理”入口就在该区块的工具栏里，因此**错误态下没有可点击的整理入口**；若错误发生在整理页内，`renderState()` 会隐藏整理区、置 `cleanupVisible=false`、清 `reviewTarget`（Ticket 14），用户回到全局错误卡，未出现“隐藏页上弹决定框”。这条按已修处理，未重复报告。
- **F9 中途返回（Esc / “返回队列”）**：`returnToReviewQueue()` 清 `reviewTarget`、恢复 `returnQuery`、不写标记、消息写明“没有修改标记”，焦点回到原候选卡（`focusCleanupCard`），卡片 DOM 刻意不重载以免播放刚改动的账本把候选刷掉——文案也提示“数字会在下次刷新时重算”，属可接受设计。
- **F9 标记失败与重试**：`markReviewDecision` 失败时保留对话框、显示错误、露出 `#review-retry` 并把焦点放回所选动作；重试复用同一 `reviewPendingState`，互斥 `cleanupMarkBusy` 生效。
- **F5 语义**：清单全程只读，界面有两处“应用不会自动删除文件”的说明，`revealed` 失败分支文案正确；排序为“体积从大到小”，与用户预期（先清大的）一致。
- **F3 结果文案**：`keep` 不再承诺到期（“不会再回到整理候选，也没有到期时间”）与 `effectiveCleanupState` 的终态实现一致；`snooze` 仍写明天数；`delete` 写明需手动删除。

## 4. 需真机 / 未覆盖

- **需真机**：F6 的 Explorer 实际弹出与选中（`shell.showItemInFolder` 无返回值）；CL-04/CL-05/CL-10 的焦点环可见性与滚动复位观感；900×640 下整理卡片/清单/设置对话框的裁切（既有 `test:local-library-app` 已有相关断言，但本轮未执行）。
- **未覆盖分支**：>200 条待删清单（CL-12）与“已标记卡不再命中规则”（CL-02）需要夹具才能稳定复现，本轮只做静态判定；Windows 高 DPI / 多显示器下清理对话框的定位（`app-preferences` 无关，属 G5）。
- **未运行**：`npm run build`、`npm test`、`npm run test:window`、`npm run test:local-library`、`npm run test:local-library-app`，以及应用启动与真机点击。本报告全部结论来自 `src/`、`docs/`、`tests/` 的静态阅读与交叉核对，不构成任何运行验证。
- **文档偏差**：`ux-flow-audit.md` §3 F 区 10 项与当前实现一一对应（无缺项）；§2 的“整理 hidden/ready/empty/marking/settings/review”中 `marking` 在 UI 上只有一句“正在更新标记…”且按钮不禁用（见 CL-06），`review` 与 `settings` 是两个叠加层而非互斥视图。
