# UX 流程审计 · B 区（来源管理）+ G 区（系统与窗口）

- 基线：主工作树 `D:\project\z-video`，`30210bd`（2026-11-14 18:28），工作树除未跟踪 `designs/` 外干净；非 `.worktrees`、非其他分支
- 方法：`docs/local-library/ux-flow-audit.md` §1/§4/§5；每个操作走 主路径 + 分支 + 异常，按 §5 的 8 条标准判定
- 边界：**只读静态走查**。未运行 `npm run build`/`npm test`/`npm run test:window`，未启动应用、未做真机点击；纯感官项（焦点环可见性、DPI 对齐、最大化视觉、焦点环/滚动观感）一律标“需真机”，未伪装验证
- 覆盖：B 区 14 项 + G 区 5 项 = 19 项，每项含取消、空目录、扫描中退出、离线 vs degraded、嵌套目录、最大化、外观回退、超长标题等分支
- 已实现且**不重复报告**：schema v4、`degraded` 语义、`keep` 终态、墓碑隐藏（走查确认在位，仅作“通过”依据）
- 跨区去重：B2 与 A 区 F-03、B3 与 C 区 F-07 同源（见 `.scratch/ux-audit/browse.md`），本文件只补充 B 区证据，不另立修复主题
- 结论分布：**通过 6 · 问题 12 · 需真机 1**；12 条问题中 1 高 / 8 中 / 3 低，无 blocker
- 未运行验证：所有结论来自 `src/` 静态阅读 + 契约/状态文档 + 既有测试文本对照；未声称任何一条已通过运行验证

## 1. 结论表（19 行）

| ID | 操作 / 已覆盖路径 | 结论 | 关联问题 | 证据锚点 |
|---|---|---|---|---|
| B1 | 添加文件夹 → 选择成功：首扫、进度（header 胶囊 / 首页卡 / 来源面板）、终局摘要、列表与来源刷新、0 来源防护 | 通过 | — | `renderer.ts:3299-3328`、`3607-3646`、`local-library-ipc.ts:30-44`、`local-library-worker.ts:2260-2332` |
| B2 | 添加文件夹 → 取消：`canceled` → `status=cancelled/sourceId=""` → 终局处理、首页结果卡、message | **问题** | B-01（同 F-03） | `local-library-ipc.ts:32-43`、`renderer.ts:3317-3323`、`3629-3643`、`3663-3670` |
| B3 | 添加文件夹 → 目录为空 / 无支持视频：0 文件扫描、来源卡、首页与片库空态 | **问题** | B-02（同源 F-07） | `local-library-worker.ts:2309-2332`、`renderer.ts:3648-3653`、`3668-3669`、`views/sources.ts:13-27`、`renderer.ts:502-516` |
| B4 | 打开/添加单个视频：复用祖先来源、单来源标记、入库后落点、空结果 | **问题** | B-03 | `renderer.ts:3270-3297`、`index.html:25,127`、`local-library-worker.ts:2365-2397`、`562-576` |
| B5 | 重新扫描单个来源：可用 / 扫描中 / degraded / 离线 / 失败；扫描刚结束时再次发起 | **问题** | B-08 | `renderer.ts:3299-3357`（共享 `sourceBusy`/`scanProgress`）、`sources.ts:76-94`、`local-library-worker.ts:2260-2293` |
| B6 | 重新扫描全部：多来源顺序执行、逐源终局、聚合终局、部分离线 | **问题** | B-04 | `local-library-database.ts:229-254`、`renderer.ts:3317-3328`、`3607-3646`、`3811-3814` |
| B7 | 取消扫描：胶囊 × / 来源面板 / 来源卡三个入口；运行中、终局窗口、挂起路径 | **问题** | B-05 | `renderer.ts:3592-3605`、`local-library-worker.ts:2425-2432`、`local-library-database.ts:102-108`、`2163-2204` |
| B8 | 扫描中关闭窗口 / 退出应用：before-quit 结算、worker close 取消扫描、下次启动恢复 | 通过 | — | `main.ts:83-93`、`local-library-worker.ts:2404-2409`、`2111-2133`、`local-library-database.ts:359-377` |
| B9 | 移除来源（确认）：对话框文案、失败重试、成功后清作品/集数/观看账本 | 通过 | —（焦点问题并入 G-03） | `renderer.ts:3400-3434`、`index.html:48-58`、`local-library-worker.ts:1438-1459` |
| B10 | 移除来源（取消 / Esc）：Esc 关闭、close 事件复位、**进行中 Esc**、失败落点 | **问题** | B-06 | `renderer.ts:3831-3841`、`3854-3861`、`3412-3434`、`index.html:57,64` |
| B11 | 来源离线 → 保留索引：来源卡离线态+说明、片库横幅、条目置灰、详情禁用播放 | 通过 | — | `views/sources.ts:13-27`、`renderer.ts:1668-1689`、`local-library-worker.ts:2273-2293` |
| B12 | 来源离线 → 删除来源：扫描失败专用对话框（保留/清理）、与 B9 的文案区分 | 通过 | — | `renderer.ts:3436-3483`、`index.html:59-65`、`local-library-worker.ts:1438-1459` |
| B13 | degraded 来源（部分目录未读）：来源卡“部分目录未读取”、仍可播放、横幅区分 | 通过 | — | `views/sources.ts:17-26`、`renderer.ts:1668-1689`、`local-library-worker.ts:2334-2344` |
| B14 | 选择重叠/嵌套目录：文件夹扫描拒绝、单视频复用祖先来源、父目录含已有来源 | **问题** | B-07 | `local-library-worker.ts:546-559`、`2275`、`2371-2375`、`562-576`、`renderer.ts:3329-3338` |
| G1 | 最小化 / 最大化 / 关闭：最大化图标、事件驱动、再次启动、关闭时写入安全 | **问题** | G-01 | `window.ts:79-91`、`main.ts:63-93`、`preload.ts:84-89`、`tests/local-library-app-smoke.ts:206-215` |
| G2 | 系统减少动效 / 高对比 / 透明回退：外观状态推送与 renderer 消费 | **问题** | G-02 | `window.ts:11-57`、`preload.ts:133-145`、`styles.css:14,22,29,232-240`、`tests/appearance-window-smoke.ts:20-28` |
| G3 | 纯键盘操作：焦点环、Tab 顺序、对话框焦点、扫描面板/卡片重建后的焦点、添加菜单 | **问题** | G-03 | `renderer.ts:3554-3597`、`3643`、`3400-3434`、`index.html:23-26` |
| G4 | 长文本 / 空字段 / 超长标题：卡片省略、详情换行、空字段回退、对话框标题 | **问题** | G-04 | `styles.css:46,95,429,464,505`、`index.html:48-58`、`all.ts:58,74-83,115,131-135`、`detail.ts:29-30,138-143` |
| G5 | 多显示器 / DPI 缩放：窗口默认几何、native overlay 对齐、display 事件覆盖 | **需真机** | — | `window.ts:61-69`、`native-window.ts:105-115`、`player-overlay.ts:8-9,55-56` |

## 2. 问题详情

### B-01 · B2 · 取消“添加文件夹”被当成一次扫描：首页出现“上次扫描：扫描已取消”结果卡，并输出不成立的取消文案

- **操作 ID**：B2（分支/异常：系统选择器点取消）
- **路径**：添加文件夹 → 选择器取消 → `localLibraryChooseFolder` 返回 `status:"cancelled"`（`sourceId:""`）→ `runScan` 照常进入终局处理 → 首页结果卡 + message
- **现象**：取消选择后，`scanNotice()` 因 `sourceId` 为空不出通知，但 `lastScanSummary` 仍被写入，且状态是 `cancelled`；首页扫描卡随后显示“上次扫描：扫描已取消 ·「所选文件夹」· 新增 0 · 更新 0”，并附“结果保留到下一次扫描”（在首页时立即出现；在其他视图取消时，回到首页才出现）。该卡在非运行态没有任何关闭/忽略入口（唯一的 `[data-cancel-scan]` 在非运行态整体隐藏），只能被下一次扫描覆盖。同时 `renderScanResult` 写出的“扫描已取消，已保留此前索引和播放历史”在首次使用场景不成立（此前没有索引），且随后会被 `loadLibrary` 的“已索引 N 集/部作品”覆盖。这是“取消了一个根本没有开始的扫描”。
- **严重度**：中（判定：误导文案 + 状态残留）
- **证据**：`src/main/local-library-ipc.ts:32-43`；`src/renderer/renderer.ts:3299-3323`（`runScan` 不区分取消）、`3629-3643`（写 `lastScanSummary`）、`3648-3649`（空 `sourceId` 不出通知）、`3581-3590`（结果卡文案）、`3592-3596`（非运行态隐藏取消按钮）、`3663-3670`（取消文案）、`index.html:128-134`（结果卡无关闭入口）
- **建议修复方向**：`runScan` 在 `status === "cancelled" && !sourceId` 时按“用户放弃”处理——不写 `lastScanSummary`、不出扫描语义文案（或改成“未开始扫描”），并给结果卡补关闭/忽略入口；与 A 区 F-03 合并修复。
- **去重**：与 `.scratch/ux-audit/browse.md` 的 F-03 同根因，不另立主题。

### B-02 · B3 · 空目录 / 无支持视频的扫描被报告为“扫描完成 · 无警告”，来源卡显示“可用 0 部作品”

- **操作 ID**：B3（分支：目录为空、仅有不支持格式）
- **路径**：添加一个空文件夹（或只有照片/不支持格式）→ 0 文件扫描 → 扫描结论、来源卡、下一屏空态
- **现象**：worker 对空目录走 `traversalComplete === true` 的成功分支：`available=1, degraded=0`，结果 `completed` 且 `importedFiles=0`。renderer 因此出“扫描完成 · 新增 0 项 · 更新 0 项 · 无警告”，并在 `setMessage` 写“扫描完成：新增 0，更新 0。”。来源卡同时显示“可用”+“0 部作品 / 0 集”，且 `sourceNote` 对“可用且未 degraded”的来源返回 undefined，页面上没有任何“这个文件夹没有找到支持的视频”的说明；来源页脚注只说移除会删进度。若用户从首页发起，正确空态（“这个文件夹还没有支持的视频”+重新扫描/格式说明）位于首页隐藏的 `#collection-section` 内，首页仍是欢迎卡。用户会以为扫描成功、文件夹内容正常，实际是选错目录或格式不支持。
- **严重度**：中（判定：误导文案 + 缺态）
- **证据**：`src/main/local-library-worker.ts:2296-2332`（空目录成功路径）、`src/renderer/renderer.ts:3648-3653`、`3668-3669`（成功文案）、`src/renderer/views/sources.ts:13-27`（无 note）、`63-67`（0/0 计数）、`src/renderer/renderer.ts:509-514`（正确空态）、`1709`/`3689`（首页隐藏 collection-section）
- **建议修复方向**：0 文件扫描单独出“没有找到支持的视频文件”的终局文案与来源卡说明（附支持格式/重新扫描入口），不要与普通成功共用“无警告”；首页空态按“有来源且 0 作品”渲染，而不是 onboarding。
- **去重**：首页空态部分与 C 区 F-07 同源；本条的扫描结论/来源卡证据为其补充。

### B-03 · B4 · onboarding 仍写“打开单个视频”，与“添加单个视频”及“只入库不播放”的真实行为矛盾

- **操作 ID**：B4（主路径：入口文案 → 选择文件 → 结果）
- **路径**：首次启动欢迎卡 → 点“打开单个视频” → 实际只把文件加入片库并登记父文件夹
- **现象**：header 与来源页按钮已改为“添加单个视频”（`index.html:25,39`），行为也只是入库 + “已加入《…》”toast；但欢迎卡正文仍写“添加本地文件夹，或直接打开一个视频”，按钮仍写“打开单个视频”（`index.html:127`）。用户预期选完开始播放，实际停在原处，必须自己去片库找刚加入的条目。文案与行为不一致，且同一入口在应用内存在两套说法。
- **严重度**：低（判定：误导文案）
- **证据**：`src/renderer/index.html:127`、`:25`、`:39`；`src/renderer/renderer.ts:3270-3297`（`handleImport` 只 `renderState`/`loadLibrary`，不打开详情/播放）、`3282-3285`
- **建议修复方向**：统一为“添加单个视频”，正文改成“添加文件夹，或添加单个视频（只加入该文件，所在文件夹会登记为片库文件夹）”；若要保留“打开”语义，则入库后直接打开详情/播放，二者择一。

### B-04 · B6 · “重新扫描全部”把每个来源的终局当成整体完成：扫描面板反复开合，旧“扫描完成”通知与新“正在扫描”并存

- **操作 ID**：B6（主路径：≥2 个来源顺序执行；分支：其中一个来源离线）
- **路径**：来源页点“重新扫描全部” → 逐源扫描 → 每源终局事件 / 聚合终局事件
- **现象**：`rescanAll` 是顺序 `for` 循环（每源一次 `scanFolder`），worker 对每个来源都会 emit 一次终局 progress；renderer 的 `renderScanProgress` 对任何终局 progress 都执行“整体结束”逻辑：写 `lastScanSummary`、出 `scanNotice`（“扫描完成/来源离线/扫描已取消”）、清 `scanProgress`/`scanId`、隐藏扫描面板。于是 N 个来源会看到 N 次“扫描完成”，并且第 n 个来源结束时通知条显示“扫描完成”、第 n+1 个来源开始时通知条仍留在原位，同时 header 胶囊与面板显示“正在扫描”，状态互相矛盾；最后 `runScan` 再渲染一次聚合结果，出第二条“扫描完成（全部 N 个文件夹）”。单来源时不可见，≥2 个来源必现。
- **严重度**：中（判定：状态残留 + 误导文案）
- **证据**：`src/main/local-library-database.ts:229-254`（顺序循环、逐源 emit）、`src/main/local-library-worker.ts:2329-2330`/`2341-2342`/`2347-2349`/`2288-2290`（每源终局 progress）、`src/renderer/renderer.ts:3607-3646`（终局即整体结束）、`3629-3630`（逐源通知）、`3634-3643`（逐源写摘要/清 scanId/收面板）、`3321-3323`（聚合再渲染一次）、`3496-3512`（通知只被覆盖、不会被运行态隐藏）
- **建议修复方向**：为“全部重扫”建立批次态（batch id + 已完成/总数），逐源终局只更新批次进度，不写 `lastScanSummary`、不出全局通知；只有聚合终局才出摘要与结果卡。批次进行中，通知区或面板要能表达“第 2/5 个文件夹”。

### B-05 · B7 · 取消“全部重扫”只停当前来源且批量继续；首帧挂起期完全无法取消；没有“正在取消”态

- **操作 ID**：B7（主路径：运行中取消；分支：全部重扫中取消；异常：路径挂起/终局窗口）
- **路径**：重新扫描全部（或单个来源）→ 点取消扫描 → 期望停止整批 / 至少停止当前并给出反馈
- **现象**：
  1. **批量不停**：`cancelScan(scanId)` 只取消 worker 里当前 `scanId` 的 token；`rescanAll` 的循环不检查取消结果，当前来源返回 `cancelled` 后立刻开始下一个来源。用户看到“扫描已取消”通知，下一来源马上又“正在扫描”，必须逐源重复点取消（或退出应用）才能停，界面没有任何“已取消全部”的语义。
  2. **首帧无法取消**：`runScan` 先写入伪进度 `{scanId:"pending"}`，真实 `scanId` 只在第一个 running progress 到达时才赋值；`updateScanUi` 用 `running && scanId` 决定取消按钮可用性。worker 在 `realpath`/`lstat`/`ensureSource` 之后才发第一个 progress，网络路径（SMB/NAS）挂起时可能长时间无事件，而扫描 IPC 超时是 30 分钟——这期间所有已出现的取消入口都是 `disabled`（来源面板此时还没出现），只能等或杀进程。
  3. **无取消态**：点取消后仅把按钮置为 disabled，胶囊/面板文案仍是“正在扫描”；`cancelScan` 返回 `false`（终局窗口，worker 合约正确）时 renderer 直接丢弃，不恢复按钮、不提示“已无法取消”。
- **严重度**：高（判定：不可恢复 + 误导文案 + 缺态）
- **证据**：`src/renderer/renderer.ts:3599-3605`（取消入口、丢弃 false）、`3592-3596`（`canCancel` 依赖 `scanId`）、`3305-3314`（伪 pending 进度）、`3616-3618`（`scanId` 只在 running 时赋值）；`src/main/local-library-worker.ts:2425-2432`（终局返回 false，正确）、`2273-2300`（首 progress 之前有 `realpath/lstat`）；`src/main/local-library-database.ts:229-254`（批量不因取消中止）、`102-108`（扫描超时 30 分钟）；`src/main/local-library-worker.ts:2163-2204`（取消检查点）
- **建议修复方向**：`rescanAll` 接受一个批次取消令牌，取消后不再开始下一个来源；main 在开始扫描前先生成并返回 `scanId`（或先发一次 running progress），让取消从第一帧就可用；点击取消后进入 `cancelling` 状态（按钮→“正在取消…”，面板文案同步），`false` 结果要恢复入口并说明“这次扫描已接近完成，无法取消”；批量模式显式提供“取消全部”。

### B-06 · B10 · 移除进行中按 Esc 仍会关闭对话框并复位忙态，但数据库写入继续；失败信息落进已关闭的对话框

- **操作 ID**：B10（异常分支：确认后、完成前按 Esc / 关闭）
- **路径**：移除对话框 → 确认“移除并删除进度” → 按钮变“正在移除…”（取消/确认均 disabled）→ 按 Esc
- **现象**：对话框脚注承诺“Esc 取消并关闭”，全局 Esc 处理器不检查 `sourceDialogBusy`，仍执行 `removeDialog.close()`；`close` 事件处理器只看 `dialog.open`、不看忙态，于是把 `removingSourceId`、错误、按钮文案与 `sourceDialogBusy` 全部复位。已经发出的 `removeSource` 不会被撤回：`confirmRemoveSource` 在开头捕获了 `sourceId`，稍后照常完成删除、刷新并弹“已移除文件夹”提示——用户按 Esc 以为取消，作品和观看进度仍被删除（不可恢复）。若该次删除**失败**，`setDialogError` 与“重试移除”焦点会写进已关闭的对话框，页面无任何可见错误（静默失败）；同时 `sourceDialogBusy=false` 让下一次移除对话框可以在前一次写入未结束时打开。离线清理对话框（脚注“Esc 暂时保留记录并关闭”）同构。
- **严重度**：中（判定：误导文案 + 静默失败 + 并发破损）
- **证据**：`src/renderer/index.html:57`（Esc 承诺）、`:64`（离线对话框同承诺）；`src/renderer/renderer.ts:3854-3861`（Esc 无忙态判断）、`3833-3842`（close 无忙态判断、复位 busy）、`3412-3434`（捕获 sourceId 后继续写、失败写入 `removeDialogError`）、`3461-3483`（离线删除同构）
- **建议修复方向**：忙态下 Esc/关闭应被拒绝（`event.preventDefault()` + 提示“正在移除，请稍候”），或关闭后把操作转为不可取消的后台任务并提供进度/结果；`close` 处理器在忙态下不得复位 `removingSourceId`/错误/文案；失败必须落到对话框之外也可见的位置（toast/message），不能只写隐藏对话框。

### B-07 · B14 · 重叠/嵌套目录被拒绝但只说“与已有来源重叠”；父目录含已有来源时“添加单个视频”无可行恢复路径

- **操作 ID**：B14（主路径：选择被已有来源覆盖的目录；分支：单视频的父目录在已有来源之上）
- **路径**：添加文件夹选 `D:\A\B`（已有来源 `D:\A`）→ 拒绝；或添加单个视频 `D:\A\foo.mp4`（已有来源 `D:\A\B`）→ 拒绝
- **现象**：
  1. 文件夹路径：`assertNoOverlappingSource` 抛出 `invalid-input` “新的片库目录与已有来源重叠”，经 `runScan` 的 catch 显示为一条“扫描失败”通知（或 `setMessage`）。文案不说明被哪个已有文件夹覆盖、也不给下一步（“直接重新扫描 D:\A 即可”），且此处术语回到“来源”，与全站“文件夹”不一致。
  2. 单视频路径：若文件已有祖先来源，`containingSource` 会复用祖先（正确）；但若“文件的父目录/祖先目录里包含一个已存在的来源”，`assertNoOverlappingSource(dirname(file))` 会拒绝——这不是用户可选择的目录，而是应用自动推导的父目录；用户想把这部片子加入片库，唯一出路是先移除那个已有来源、再添加父目录，属于破坏性重建。UI 没有任何“只加入这个视频/不登记父目录”的替代路径。
- **严重度**：中（判定：缺态 + 不可恢复）
- **证据**：`src/main/local-library-worker.ts:546-559`（重叠判定与文案）、`2275`（扫描前判定）、`2371-2375`（单视频推导父目录后判定）、`562-576`（祖先来源复用）；`src/renderer/renderer.ts:3329-3338`（通用“扫描失败”提示）、`3270-3297`（导入仅 `setMessage`）；`src/main/local-library-errors.ts:14-17`
- **建议修复方向**：拒绝文案带上“被「X」覆盖”与推荐动作（重新扫描 X / 改选其他目录）；单视频导入在父目录被已有来源包含时，允许“只索引该文件”而不登记新来源（或复用最近的祖先来源并把文件写入其索引），不要把它降级成“重叠错误”。同时统一术语为“文件夹”。

### B-08 · B5 · 扫描结束后的列表刷新期间可再发起扫描，前后两次 `runScan` 共享全局状态，后完成的 finally 会清掉新扫描的进度与按钮禁用

- **操作 ID**：B5（异常分支：扫描刚结束、刷新未完成时再点“重新扫描”）
- **路径**：某次扫描结束（终局进度先到）→ `runScan` 已把 `sourceBusy=false`，但仍在 `await loadLibrary/loadContinueWatching/loadHomeShelves` → 来源卡按钮此时已被终局进度重新启用 → 用户点另一来源“重新扫描” → 第二次 `runScan` 开始 → 第一次的 `finally` 后到
- **现象**：`sourceBusy`、`scanProgress`、`scanId`、`scanCommit`、`scanRefreshTimer` 都是模块级单例；`runScan` 在 `operation()` 返回后立刻把 `sourceBusy=false`（注释说明是为了让后续点击不被刷新阻塞），但第一次调用的 `finally` 会无条件 `sourceBusy=false`、`scanId=undefined`、`stopScanElapsedTimer()`、清 `scanRefreshTimer`，并在 `scanProgress?.status === "running"` 时把**第二次扫描**的进度清空。结果：第二次扫描进行中，header 扫描胶囊/取消入口会被第一次的 finally 清掉（直到下一次 progress 才恢复），同时顶部“重新扫描全部 / 添加文件夹 / 添加单个视频”被第一次 finally 重新启用；若用户在此时点“重新扫描全部”，会拿到 worker 的“已有本地片库扫描正在进行”错误，显示成一次“扫描失败”。耗时越长（大库列表查询），窗口越大。
- **严重度**：低（判定：并发破损；需在扫描结束后数百毫秒内再次点击）
- **证据**：`src/renderer/renderer.ts:3299-3357`（单例状态 + 早释放 `sourceBusy` + finally 无条件复位）、`3340-3352`（`scanId`/`scanProgress`/定时器清理）、`3318-3320`（注释与早释放）、`3609`（终局进度先重绘来源卡、启用按钮）、`src/main/local-library-worker.ts:2260-2261`（worker `activeScan` 守卫报“已有扫描正在进行”）
- **建议修复方向**：给每次 `runScan` 一个自增 token，finally 只在 `token === currentToken` 时复位共享状态；扫描面板/按钮的启用条件改为“有活动扫描 token”，不要依赖全局 `sourceBusy`；或在 `runScan` 结束前禁止来源卡操作，再在结束时统一恢复。

### G-01 · G1 · 没有单实例锁：最小化后再启动会开第二个实例，两个进程同写 SQLite / 偏好文件，第二个实例启动即把在跑的扫描标记为中断

- **操作 ID**：G1（分支：最小化后从快捷方式/任务栏再次启动；关闭路径）
- **路径**：应用最小化（或已有一个窗口）→ 再次双击 exe/快捷方式 → Windows 启动第二个进程与窗口
- **现象**：`main.ts` 没有 `requestSingleInstanceLock()` / `second-instance` 处理，`activate` 只在 macOS 重建窗口。Windows 上第二次启动得到独立进程：同一 `userData` 下的 `local-library/library.sqlite` 与 `app-preferences.json` 被两个 worker 同时打开。第二个实例初始化时执行 `recoverInterruptedScanRuns()`，会把第一个实例**正在跑**的 `scan_runs`（`completed_at IS NULL`）判为 `interrupted`，并把该来源置 `degraded=1`（第一个实例下次刷新状态时可能显示“部分目录未读取”，直到其扫描成功覆盖）；两个进程还都可发起扫描/移除（`activeScan` 守卫只在单进程内），`BEGIN IMMEDIATE` 处没有显式 busy handler/timeout，先写失败的一方可能以“扫描失败/本地片库操作失败”落地。叠加后果：第二个窗口里已删除的来源再点“重新扫描”，`sourceRoot` 为空会退化成通用“请重试”，重试永远不可能成功。
- **严重度**：中（判定：并发破损 + 误导文案）
- **证据**：`src/main/main.ts:63-93`（无单实例锁；`activate` 仅 macOS）、`:65`（同一 `userData` 路径）、`src/main/local-library-worker.ts:443`、`2111-2133`（每次打开即恢复中断并在跑扫描）、`279-300`（只设 WAL/foreign_keys，无 busy timeout）、`1442`/`2310`（`BEGIN IMMEDIATE`）、`src/main/local-library-ipc.ts:84-89` + `src/main/local-library-errors.ts:14-17`（来源消失→通用“请重试”）
- **建议修复方向**：启动即 `requestSingleInstanceLock()`，失败时 `app.quit()` 并把 `second-instance` 转成“还原并聚焦已有窗口”；若确实要支持多窗口，改为单 worker 服务并让第二个窗口通过 IPC 复用同一 owner，同时把 busy timeout 与跨进程扫描互斥显式化。最大化/最小化/关闭本身（含 `window:maximized` 图标、`isMaximized` 切换）代码路径完整，但有既有冒烟断言（`tests/local-library-app-smoke.ts:206-215`）；双击拖拽区最大化、Win+方向贴边后的图标状态仍需真机。

### G-02 · G2 · 高对比 / 低透明度回退只改窗口材质：renderer 不消费 appearance 状态，也没有 forced-colors 规则；不透明底色还把 acrylic 完全遮住

- **操作 ID**：G2（主路径：系统开启高对比 / 减少透明度 → 期望界面可读的回退）
- **现象**：main 的 `readWindowAppearance` 能读到 `inForcedColorsMode`/`prefersReducedTransparency`，`applyWindowAppearance` 只做三件事：切换 `setBackgroundMaterial`/`setBackgroundColor`、在 catch 里降级、向 renderer 发 `appearance:state`。但活 renderer 没有任何订阅者（唯一暴露入口是 deprecated 的 `preload.appearance.onState`，全仓零消费者），CSS 里也没有 `forced-colors` / `prefers-contrast` 规则，更没有 `data-reduced-transparency` 之类的状态载体——高对比与低透明度在页面内没有任何 UI 表现。同时 `:root`、`body`、`.app-shell` 都是不透明底色、全站没有半透明 surface 或 `backdrop-filter`，因此 `nativeBackdrop:true` 时窗口的 acrylic 材质也被完全盖住，用户观察不到任何差异。既有的 `test:appearance-window` 断言 `documentElement.dataset.{reducedTransparency,highContrast,nativeBackdrop}`，文档已记录该 fixture 失败且基线也不存在该标记——外观回退至今没有有效验证。
  - 减少动效是**已生效**的：`@media (prefers-reduced-motion: reduce)` 与 `motionMode()` 都走系统设置，这部分不构成问题。
- **严重度**：中（判定：缺态；另附文档/状态台账与实现不一致）
- **证据**：`src/main/window.ts:11-24`、`40-57`（只改材质，发 `appearance:state`）；`src/preload/preload.ts:133-145`（deprecated、零消费者）；`src/renderer/renderer.ts` 无 `appearance` 订阅（仅 `localLibrary.onState`/`localPlayback.onEvent`，`4139-4141`）；`src/renderer/styles.css:14,22,29`（不透明底色）、`232-240`（仅减少动效）、全文无 `forced-colors`/`prefers-contrast`；`tests/appearance-window-smoke.ts:20-28`（期望的 dataset）；`docs/design/soft-cinema/completions/08-states-acceptance.md:25`（fixture 失败记录）；`docs/local-library/ux-rework-spec.md:226`（要求 renderer 消费并 forced-colors 用系统色）
- **建议修复方向**：renderer 订阅 appearance（或由 main 注入 `html[data-appearance]`），高对比下切到 `forced-colors` 系统色并保证焦点/边界可见；低透明度下提供不透明 surface 回退（至少给侧栏/工具栏/卡片一个 `data-reduced-transparency` 分支）；若暂时不做 acrylic，就不要让“窗口材质”成为唯一载体（当前被不透明底色遮住等于没有），并修正文档中“已回退”的表述为“窗口材质层回退、页面内待办”。

### G-03 · G3 · 键盘焦点丢失：扫描终局隐藏面板/取消按钮、移除成功后卡片重建、添加菜单打开后不关闭

- **操作 ID**：G3（主路径：纯键盘完成添加/取消扫描/移除；分支：面板或卡片被整体重建）
- **现象**：
  1. **扫描终局**：键盘用户 Tab 到“取消扫描”（header 胶囊 / 首页卡 / 来源面板任一）后，扫描自然完成，`updateScanUi` 把 `[data-cancel-scan]` 全部 `hidden`，`renderScanProgress` 收起 `scanPanel`；没有把焦点交给任何持久元素，`display:none` 使焦点落回 `body`，下一次 Tab 从窗口标题栏重新开始。
  2. **移除成功**：确认后 `removeDialog.close()` → `renderState` → `renderSources` 整体 `replaceChildren`，被聚焦的移除按钮随卡片消失，焦点落回 `body`；`confirmRemoveSource`/`refreshAfterSourceChange` 没有指定后续焦点（规范要求“返回恢复原卡片”，但卡片已不存在，至少应落到相邻卡片或页标题）。
  3. **添加菜单**：header 的 `<details class="add-menu">` 打开后选择“添加文件夹/添加单个视频”不会自动收起，也没有点外/`Esc` 关闭逻辑（全局 Esc 处理器不覆盖它）；键盘用户下次 Tab 仍要先穿过展开的菜单项，属于可见的状态残留。焦点环本身有全局规则（`:focus-visible` 3px lavender、偏移 3px，`styles.css:227`），其可见性与对比度仍需真机。
- **严重度**：中（判定：焦点丢失 + 状态残留）
- **证据**：`src/renderer/renderer.ts:3592-3596`（隐藏所有 `[data-cancel-scan]`）、`3607-3646`（终局收面板，无焦点转移）、`3400-3434`（移除无焦点目标）、`src/renderer/views/sources.ts:32`（`replaceChildren`）、`src/renderer/index.html:23-26`（add-menu）、`src/renderer/renderer.ts:3735-3736`（仅转发 click）、`3854-3861`（Esc 不覆盖 details）、`src/renderer/styles.css:227`（焦点环）
- **建议修复方向**：隐藏/重建前显式转移焦点：扫描终局把焦点交回扫描入口按钮（或页标题），移除成功后聚焦相邻来源卡/“重新扫描全部”，并给 `add-menu` 加选择后收起 + 点外/Esc 关闭（或改用已有 `AppListbox`）。

### G-04 · G4 · 对话框标题/正文没有换行策略，超长无空格来源名会溢出 460px 对话框

- **操作 ID**：G4（分支：超长标题 / 无空格拉丁名）
- **现象**：`dialog` 固定 `width:min(460px,90vw)`、`padding:32px`，没有 `overflow-wrap`/`word-break`/`overflow:hidden`；移除与离线对话框的标题把来源名直接拼进字符串（“移除「…」？”“「…」现在不可用”），而 `safeSourceLabel` 允许最长 80 字符。CJK 可以任意断行，但常见的长发布名（点分隔、无空格，如 `The.Movie.2024.2160p.UHD.BluRay...`）无法断行，会横向溢出对话框。对比：`.source-card h2`、`.detail-copy h2`、`.search-heading h1`、`.review-decision-dialog h2` 都单独加了 `overflow-wrap:anywhere`，对话框标题漏了。
  - 其余长文本/空字段路径是**通过**的：卡片与单集行按设计省略显示（`.media-card-title`/`.episode-title`，`docs/design/spec-01-poster-grid.md:14`），完整标题在按钮 `aria-label`（`all.ts:58,115`），详情标题完整换行（`styles.css:505`，符合 `ux-rework-spec.md:175`）；年份/评分缺失则省略，首映缺失显示“发布日期未知”，集号缺失显示“—”，观看记录为空有一句说明。
- **严重度**：低（判定：缺态——没有换行/截断态）
- **证据**：`src/renderer/styles.css:464-465`（dialog 无换行规则）、`429`/`505`/`583`/`728`（其他位置都有）；`src/main/local-library-label.ts:9`（80 字符上限）；`src/renderer/renderer.ts:3403`、`3441-3442`（拼进标题/正文）；`index.html:48-58`、`59-65`；对照通过项 `src/renderer/views/all.ts:58,74-83,115,131-135`、`views/detail.ts:29-30,138-143`、`styles.css:46,95,505`
- **建议修复方向**：给 `dialog h2`/`.dialog-lead` 增加 `overflow-wrap:anywhere; word-break:break-word`，或对来源名做中间省略（保留头尾）并加 `title`；超长标题的 900×640 / 150% 缩放观感归 G5 真机复查。

## 3. 需真机 / 未覆盖

- **G5（需真机）**：窗口默认 1040×720、最小 900×640、无位置/尺寸持久化，也没有界面缩放入口；多显示器下每次启动回到主屏默认位置，用户搬到副屏/分屏的布局每次都要重做（`window.ts:61-69`）。native 视频子窗口用 `GetClientRect + GetDpiForWindow` 计算标题栏高度并跟随 `resize`/`enter-full-screen`/`leave-full-screen`/`display-metrics-changed`（`native-window.ts:86-115`）；overlay 用 `parent.getContentBounds()` 跟随 `move`/`resize`/全屏（`player-overlay.ts:8-9,55-56`）。拖到不同缩放比例的显示器、Windows 贴边/最大化、150% 缩放下的 overlay 与页面控件对齐、以及最大化双击/贴边后的图标状态，静态代码无法证明，需真机。
- **G1 的视觉部分**：最大化/最小化/关闭的代码路径与既有冒烟断言（`tests/local-library-app-smoke.ts:206-215`）存在，但双击拖拽区最大化、Win+方向贴边后的“还原”图标、关闭动画等只能真机确认；A5（`.scratch/ux-audit/browse.md`）已把该视觉项列入需真机，未重复计数。
- **G4 的极端标题观感**：900×640 与 150% 缩放下对话框标题/卡片的实际裁切需真机（`ux-rework-spec.md:229`）。
- **未运行**：`npm run build`、`npm test`、`npm run test:window`、`npm run test:local-library-app`、`npm run test:appearance-window`、应用启动与点击验证均未执行；`tests/local-library-app-smoke.ts` 的断言只作为“已有覆盖”证据引用，不代表本次通过。所有结论来自 `src/` 静态阅读 + 契约/状态文档交叉核对。
- **未作为证据**：`src/main/library-controller.ts`、`src/main/session-controller.ts`、`src/renderer/library.ts` 等 deprecated/非默认路径（见 `docs/local-library/state-machines.md:63-68`）。

## 4. 修复主题建议（供汇总）

1. **扫描终局与批量语义**（B-01、B-02、B-04、B-05、B-08）：批次 token、取消全部、0 文件终局、取消态、逐源终局不当作整体完成。
2. **来源对话框与破坏性操作**（B-06，及 B9 焦点部分）：忙态锁死 Esc/关闭、失败可见、成功后焦点落点。
3. **来源数据模型可解释性**（B-07）：重叠拒绝文案给出来源与下一步；单文件导入不再被“父目录重叠”卡死。
4. **窗口与外观**（G-01、G-02）：单实例锁 + second-instance；appearance 进 renderer（forced-colors / 低透明回退），并修正文档表述。
5. **键盘与长文本**（G-03、G-04）：焦点转移约定（面板收起、卡片重建、菜单关闭）、对话框换行。
6. **不生成新 Ticket 的重复项**：B2≈F-03、B3≈F-07，合并到对应主题。
