# UX 流程审计 · A 区（启动与首启）+ C 区（浏览与检索）

- 基线：`30210bd`（2026-11-14 18:28，主工作树 `D:\project\z-video`，非 .worktrees）
- 方法：`docs/local-library/ux-flow-audit.md` §1/§4/§5；每个操作走 主路径 + 分支/异常，按 §5 的 8 条标准判定
- 边界：**只读静态走查**。未运行 `npm run build`/`test`、未启动应用、未做真机点击；纯感官项（焦点环可见性、滚动回弹、动效）一律标“需真机”，未伪装验证
- 覆盖：A 区 5 项 + C 区 14 项 = 19 项；实际实现为 5 个类型筛选（doc 草案写“7 类”）、6 种排序（与代码一致）
- 结论分布：通过 7 · 问题 11 · 需真机 1；共 12 条问题：1 blocker / 6 medium / 5 low

## 1. 结论表（19 行）

| ID | 操作 / 已覆盖路径 | 结论 | 关联问题 | 证据锚点 |
|---|---|---|---|---|
| A1 | 冷启动空库：getState → onboarding → 添加文件夹/单视频（含取消选择、空目录扫描） | **问题** | F-03、F-02 | `renderer.ts:4143-4153`、`1709`、`480-517` |
| A2 | 冷启动已有库：恢复排序偏好 → 首页（hero/继续观看/货架），不进详情 | 通过（首帧受 F-02 影响） | F-02 | `renderer.ts:830-837`、`4146-4150` |
| A3 | 启动 SQLite 不可用 / worker 初始化失败 → 全局错误卡 → 重试 | **问题** | F-01、F-04 | `main.ts:63-81`、`local-library-database.ts:161-181` |
| A4 | 运行期 worker 崩溃 → 错误态 → 重试（受控重启一次） | **问题** | F-01、F-04 | `local-library-database.ts:435-467`、`renderer.ts:1627-1661`、`3805` |
| A5 | 窗口重新激活（最小化/还原；Windows 无“隐藏”语义） | **需真机** | — | `window.ts:59-104`、`main.ts:71-75,91-93` |
| C1 | 首次进入片库：骨架 → 内容；首屏已有内容时直接呈现 | 通过 | — | `renderer.ts:2089-2161`、`1695-1762` |
| C2 | 翻页：首页/上一页/页码/下一页/末页/跳页；越界输入、列表收缩后自动回退页 | **问题** | F-06 | `renderer.ts:1821-1920`、`1696-1705`、`pagination.ts:23-38` |
| C3 | 类型筛选（全部/电影/剧集/单集/未分类）→ 结果、空态、快速连点 | 通过 | — | `renderer.ts:3741-3746`、`480-517`、`524-531` |
| C4 | 按来源筛选，含离线/degraded 来源；来源被移除后重置 | **问题** | F-06 | `renderer.ts:1778-1798`、`3747-3754`、`local-library-worker.ts:1088-1091,1153-1156` |
| C5 | 排序 6 种 → 列表重排 → 偏好写盘；写盘失败提示 | **问题** | F-11 | `renderer.ts:360-396`、`830-837`、`3696`、`app-preferences.ts:38-41` |
| C6 | 搜索输入/提交：跨作品名+单集名、类型子筛、无结果、空关键词 | 通过 | — | `renderer.ts:676-740`、`3972-4016`、`local-library-worker.ts:1145-1148` |
| C7 | 清除/返回：回首页/片库/单集/文件夹/详情，恢复滚动+焦点+查询 | 通过 | — | `renderer.ts:742-814`、`3188-3253` |
| C8 | 搜索失败 → 错误态 → 重试 | **问题** | F-05 | `renderer.ts:633-646`、`712-713` |
| C9 | 空库空态：无来源 / 有来源但 0 作品 / 筛选或搜索为空 | **问题** | F-07、F-12 | `renderer.ts:480-517`、`1709`、`3755-3763` |
| C10 | 页面读取失败 → 错误卡（重试/返回）→ 恢复 | **问题** | F-09 | `index.html:191-199`、`renderer.ts:2140-2158`、`3803-3804` |
| C11 | 扫描中浏览：边扫边刷新、卡片原位复用、滚动保持、扫描中进详情/播放器 | **问题** | F-10 | `renderer.ts:2060-2087`、`1695-1762`、`3236-3240` |
| C12 | 首页：继续观看 / 最近加入 / 剧集架 / hero，含空态与失败 | **问题** | F-08 | `renderer.ts:1922-2004`、`2163-2172` |
| C13 | 首页扫描结果卡：与终局通知互斥、保留到下次扫描 | 通过 | — | `renderer.ts:282-292`、`3554-3591`、`3634-3643` |
| C14 | 通知：扫描完成/失败、关闭、重复通知 | 通过（后到通知覆盖前一条，无队列） | — | `renderer.ts:3496-3520`、`3629-3630`、`3738-3740` |

## 2. 问题详情

### F-01 · A3/A4 · 启动期 SQLite 或 worker 初始化失败直接退出，首启无任何窗口与错误卡

- **路径**：A3 主路径（启动 SQLite 不可用 → 期望全局错误卡）
- **现象**：`bootstrap()` 中 `await localLibrary.start()` 抛错即被顶层 `catch` 处理为 `app.exit(1)`，窗口尚未创建；`LocalLibraryDatabase.start()` 在写 error 状态后**继续 throw**。因此 renderer 里那套“片库文件暂时无法读写 / 重试 / 复制诊断 / 查看文件夹”的全局错误卡在**首启路径上不可达**，用户看到的是双击后无窗口（只有 console）。运行期崩溃才会走到该卡。
- **严重度**：blocker（判定：不可恢复 + 缺态）
- **证据**：`src/main/main.ts:69`、`src/main/main.ts:78-81`；`src/main/local-library-database.ts:161-181`（先 `emitState` 再 `throw`）；卡片定义 `src/renderer/index.html:116-125`、渲染 `src/renderer/renderer.ts:1627-1661`
- **建议修复方向**：`start()` 失败时保留 error 状态并继续 `createLocalWindow()`，让 renderer 首屏就显示全局错误卡（错误码/重试/诊断）；只在窗口都无法创建时才退出。同时给 `bootstrap` 失败补一次可诊断日志（`diagnostics.jsonl`）。

### F-02 · A1/A2 · 冷启动首帧先显示空的“全部媒体”网格，无骨架/加载态

- **路径**：A1/A2 冷启动首帧（getState + 排序偏好两个 IPC 完成之前）
- **现象**：`#collection-section` 在 HTML 里没有 `hidden`，只有 `renderer.ts:4149` 在 `await getState()`/`restoreSortPreference()` 之后才隐藏；首次 `loadLibrary` 的 8 个骨架也要等这之后才插入。因此首帧（含主进程响应慢/挂起时更久）显示的是“全部媒体”标题 + 筛选/排序工具栏 + 空网格，既不是首页也不是骨架。
- **严重度**：low（判定：缺态；正常机器上只是闪烁）
- **证据**：`src/renderer/index.html:169`、`:190`；`src/renderer/renderer.ts:4143-4150`、`2096-2105`
- **建议修复方向**：HTML 里默认给 `#collection-section` 加 `hidden`，由启动流程在确定视图后显式打开；或在 `index.html` 先给出与最终视图无关的轻量加载态（不写“全部媒体”）。

### F-03 · A1 · 取消“添加文件夹”被当成一次扫描：首页留下不可关闭的“上次扫描：扫描已取消”结果卡

- **路径**：A1 分支（onboarding → 添加文件夹 → 系统对话框点取消）
- **现象**：`chooseFolder` 取消时返回 `{status:"cancelled", sourceId:"", error:"已取消选择片库目录"}`，renderer 的 `runScan` 照常把它当扫描结果处理：`scanNotice()` 因 `sourceId` 为空返回 undefined（不出通知），但 `lastScanSummary` 仍被写入，首页扫描卡因此持续显示“上次扫描：扫描已取消 · 「所选文件夹」· 新增 0 · 更新 0”；该结果卡在非运行态没有任何关闭/忽略动作（唯一的 `[data-cancel-scan]` 按钮在非运行态被整体隐藏），只能等下一次扫描覆盖。同时 `renderScanResult` 会先写一句“扫描已取消，已保留此前索引和播放历史。”——首次使用场景下这句话不成立（此前没有索引）；该文案随后被 `loadLibrary` 的成功消息覆盖，属于短暂误报。
- **严重度**：medium（判定：误导文案 + 状态残留）
- **证据**：`src/main/local-library-ipc.ts:32-43`；`src/renderer/renderer.ts:3299-3323`（runScan 不区分取消）、`3629-3643`（写 lastScanSummary）、`3648-3649`（空 sourceId 不出通知）、`3581-3590`（结果卡文案）、`3592-3596`（非运行态隐藏取消按钮）、`3663-3670`（取消文案）、`2117-2123`（随后覆盖 message）
- **建议修复方向**：`runScan` 在 `sourceId` 为空 / `error === "已取消选择片库目录"` 时按“用户取消”处理：不写 `lastScanSummary`、不出取消文案；或由 main 明确返回“未开始扫描”的语义；结果卡补一个关闭/忽略入口。

### F-04 · A3/A4 · 全局错误卡的“重试”没有任何反馈，且文案让用户去重启应用

- **路径**：A3/A4 异常路径（错误卡 → 点“重试” → 仍然失败 / 正在重启 worker）
- **现象**：`#library-error-retry` 只调用 `loadLibrary()`；当 `state.status === "error"` 时 `loadLibrary` 的 catch 直接 `return false`，不清错误、不更新 message、不留“正在重试”状态，错误卡内容完全不变。用户无法判断点击是否生效（成功时才会因 `onState(ready)` 重绘）。同时错误卡正文来自 `local-library-error.ts` 的“本地片库存储不可用，请重启应用后重试。”，与卡片上的“重试”按钮互相矛盾。
- **严重度**：medium（判定：静默失败 + 误导文案）
- **证据**：`src/renderer/renderer.ts:3805`、`:2140-2147`；`src/main/local-library-errors.ts:4`；`src/renderer/index.html:119-123`
- **建议修复方向**：重试期间禁用按钮并显示“正在重试…/正在重启本地片库服务…”；重试仍失败时给出新的时间戳或递增尝试次数；把 body 文案改成与按钮一致（不再指示重启应用），并区分 `sqlite-unavailable` 与 `storage`。

### F-05 · C8 · 搜索失败没有“重试”，且失败态旁显示“共 0 部作品”

- **路径**：C8 主路径（提交搜索 → IPC/查询失败 → 期望重试）
- **现象**：`showSearchFailure` 清空结果与分页、把 `searchEmpty` 标题改成“搜索暂时不可用”，但 `#search-empty` 里只有“清空搜索”一个动作（`#search-all-types-button` 被强制隐藏），没有重试按钮；同时 `searchCount` 被写成 `共 0 部作品 · <类型>`，与“暂时不可用”并列，容易被读成“确实没有结果”。唯一的重试方式是重新按回车（无任何提示）。上一次的成功结果也已被清空。
- **严重度**：medium（判定：缺态 + 误导文案）
- **证据**：`src/renderer/renderer.ts:633-646`（含 `searchCount` 赋值）、`712-713`、`index.html:162-167`
- **建议修复方向**：失败态提供“重试搜索”（复用 `loadSearch`）；计数区改为“读取失败，未得到结果数”而不是“共 0”；保留上次结果或在失败态明确说明结果已清空的原因。

### F-06 · C2/C4 · 分页器与来源筛选控件每次整体重建，点击后焦点丢失

- **路径**：C2 主路径（键盘聚焦“下一页”/页码后回车 → 翻页）、C4 主路径（键盘聚焦来源 chip → 回车）
- **现象**：`renderPager` 每次渲染都 `host.replaceChildren()` 重建全部按钮/跳页表单；`renderSourceFilters` 同样 `replaceChildren()` 重建全部 chip。点击后 `applyQuery` → `loadLibrary` → `renderState`/`renderPage` 触发重建，被点元素已从 DOM 移除，焦点回落到 `body`；`restoreGridFocus()` 只恢复网格卡片焦点，不覆盖这两处。键盘用户每翻一页都要重新 Tab 一遍；扫描期间 `renderState` 事件还会在未点击时把来源 chip 的焦点打掉。
- **严重度**：medium（判定：焦点丢失）
- **证据**：`src/renderer/renderer.ts:1821-1881`（`1825` 清空）、`:1778-1798`（`1791` 清空）、`4017-4022`、`3747-3754`、`1659`
- **建议修复方向**：与 `#library-filter-buttons` 一致——控件节点常驻，只更新 `aria-pressed`/`disabled`/`aria-current` 和页码文本；确实需要重建时记录 `data-page`/`data-source-filter-id` 并在渲染后 `focus({preventScroll:true})` 恢复。

### F-07 · C9 · 有来源但 0 作品时，首页仍显示“添加文件夹”的 onboarding，正确的空态被藏起来

- **路径**：C9 分支（添加了文件夹，扫描成功但 0 个受支持视频 → 首页）
- **现象**：onboarding 的显示条件只判断 `homeVisible && totalCount === 0 && !query`，不看 `state.sources.length`；而针对“文件夹里没有支持的视频”的空态（含“重新扫描 / 查看支持的格式”）位于 `#library-empty`，其祖先是首页隐藏的 `#collection-section`。结果：首页持续显示“你的私人影院，从这里开始 / 添加本地文件夹”，用户已加过文件夹且刚扫过 0 项，看不出真实原因，也没有“重新扫描/格式说明”入口（需先点“全部”才能看到）。
- **严重度**：medium（判定：误导文案 + 缺态）
- **证据**：`src/renderer/renderer.ts:1709`（onboarding 条件）、`:1657`/`:3689`（首页隐藏 collection-section）、`:480-517`（正确的有来源空态，不可达）、`index.html:200-211`
- **建议修复方向**：onboarding 仅在 `sources.length === 0` 且无搜索时显示；有来源时在首页渲染“这个文件夹还没有支持的视频”空态（带重新扫描/格式说明），或把 onboarding 与 `library-empty` 合并成单一空态渲染函数。

### F-08 · C12 · 首页货架读取失败无错误态/重试，失败后保留旧卡片

- **路径**：C12 异常（首页架/继续观看 IPC 失败，或首次加载即失败）
- **现象**：`loadHomeShelves` 的 catch 只 `setMessage("首页片架加载失败，请重试。")`；没有错误卡、没有重试按钮，`recent/shows` 的 `hidden` 只在成功分支改动，因此失败后保持上一次的旧卡片（或保持隐藏），hero 也不更新。`loadContinueWatching` 的 catch 更彻底——直接 `renderContinue([])`，把“读取失败”渲染成“没有继续观看”，与真实空态不可区分。
- **严重度**：medium（判定：缺态 + 静默失败 + 状态残留）
- **证据**：`src/renderer/renderer.ts:1967-1988`（`1987` 仅 setMessage）、`:2163-2172`（catch 转空数组）、`:1990-2004`
- **建议修复方向**：为首页三个货架引入显式 `loading/ready/empty/error` 态：错误时保留内容但加一条可重试的错误条（区分“读取失败”和“暂无内容”）；`loadContinueWatching` 失败不得伪装成空列表。

### F-09 · C10 · 页面读取错误卡位于首页隐藏的 `#collection-section` 内，首页失败只剩一行会被覆盖的文案

- **路径**：C10 分支（首页视角下首次 `loadLibrary` 失败，或扫描中刷新失败）
- **现象**：`#library-page-error` 是 `#collection-section` 的子节点，首页时该祖先整体隐藏；错误卡只在切换到“全部”后才可见。首页此时只有 `#library-message` 一行文字，而 `setMessage` 会同时写 `#sources-message`，且 `loadHomeShelves` 的失败文案可能随后覆盖它，用户最终只看到“首页片架加载失败”而不知道片库页读取失败。
- **严重度**：low（判定：缺态）
- **证据**：`src/renderer/index.html:191-199`（位于 `169-213` 内）、`src/renderer/renderer.ts:1657`、`:2140-2158`、`:413-419`（setMessage 双写）、`:1987`
- **建议修复方向**：把页面错误卡提到与视图无关的位置（或首页用独立的错误条）；`setMessage` 的两个载体拆开，避免首页文案被其他失败覆盖；错误态记录 `page/pageSize` 已实现，可复用为“重试当前页”入口。

### F-10 · C11 · 单集（文件级）列表卡片按 mediaId 复用且不校验内容，重新扫描后离线标记/大小/标题不更新

- **路径**：C11 分支（切到“单集”筛选 → 扫描进行中/完成后刷新该列表）
- **现象**：作品级卡片有 `collectionCardSignature` 内容签名校验，文件级卡片只校验 `dataset.cardMode` 与 `releaseDate`；只要 mediaId 还在当前页，就会复用旧 DOM。来源转为离线（`available=false`）、文件大小/标题变化后，卡片不会更新“来源离线”徽标与元信息，直到翻页或切换筛选重建。`renderState` 状态事件也不会重绘该网格。
- **严重度**：low（判定：状态残留）
- **证据**：`src/renderer/renderer.ts:1737-1746`（复用条件）、`:1691-1693`（对照：作品级签名）、`:1658-1661`（状态事件只重绘来源）
- **建议修复方向**：给文件级卡片加内容签名（`title/sizeBytes/modifiedAtMs/available`），或复用前比对 `item` 的关键字段；来源可用性变化时强制重绘当前页。

### F-11 · C5 · 从首页货架“查看全部”进入片库会改变有效排序但不写偏好，重启后回退

- **路径**：C5 分支（首页“最近加入 → 查看全部” → 片库；再冷启动）
- **现象**：`navigateHomeOrLibrary("recent")` 直接把 `currentQuery.sort` 设为 `added_desc` 并加载列表，但只有排序菜单的 `onSelect` 才调用 `appPreferences.setSort`。结果是：界面和排序菜单都显示“最近加入”，偏好文件仍是旧值，重启后列表按旧排序出现——用户看到的排序没有持久化，且无任何提示。
- **严重度**：low（判定：状态残留）
- **证据**：`src/renderer/renderer.ts:3696`、`:3700-3704`、`:386-393`（唯一持久化点）、`:830-837`（启动恢复）、`src/main/app-preferences.ts:38-41`
- **建议修复方向**：货架入口改为“设置排序但不持久化”的显式语义（并在菜单旁标注“临时排序”），或与菜单一致地持久化；两者不要各写一套。

### F-12 · C9 · 空态的“重新扫描”忽略当前来源筛选，实际重扫全部来源

- **路径**：C9 分支（来源筛选到某个 0 作品来源 → 空态点“重新扫描”）
- **现象**：空态按钮统一 `emptyRescan → rescanAllButton.click()`，无论 `currentQuery.sourceId` 是否存在；用户以为在重扫当前文件夹，实际顺序重扫所有来源（可能出现离线来源弹窗、耗时更长）。
- **严重度**：low（判定：误导文案）
- **证据**：`src/renderer/renderer.ts:3757`、`:502-516`（空态动作集）、`:528-531`（sourceId 仍在查询里）
- **建议修复方向**：`sourceId` 存在时走 `refreshSource(sourceId)` 并改文案为“重新扫描此文件夹”；只有“全部来源”时才调用 `rescanAll`。

## 3. 需真机 / 未覆盖

- **A5（需真机）**：主进程没有隐藏到托盘/隐藏窗口的语义（`window.close()` 直接关窗，Windows 触发 `window-all-closed → quit`；只有 macOS `activate` 会重建窗口），renderer 也没有 `focus`/`visibilitychange` 监听。因此“隐藏后再打开”在 Windows 实际是“最小化 → 还原”，DOM 未销毁，滚动位置与焦点理论上保留；**焦点环可见性、还原后滚动位置、最大化图标状态**只能在真机确认。若在 macOS 上重建窗口，视图状态会整体丢失（未持久化当前视图/滚动），这条也需真机确认。
- **纯感官项未验证**：翻页/筛选后的滚动复位观感、扫描中骨架与卡片复用的闪烁、通知进出动效、焦点环样式——均标需真机。
- **本轮未运行**：`npm run build`、`npm test`、`npm run test:window`、应用启动与点击验证。所有结论来自 `src/` 静态阅读 + 契约/状态文档交叉核对；`library-controller.ts` 已标注 deprecated、不在默认运行路径，未作为证据。
- **文档偏差**：`ux-flow-audit.md` C3 写“7 类”筛选，当前实现为 5 类（全部/电影/剧集/单集/未分类）；C5 的 6 种排序与代码一致。
