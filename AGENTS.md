# z-video 开发规则

## 当前默认交付路径（2026-10-31）

Electron 45 + TypeScript 是当前 Windows 默认的运行、构建和打包栈；旧 Slint/Rust 与 NAS/Session 代码保留作回滚/协议参考，不是 `npm run start`、`npm run build`、`npm run package` 或 `npm run verify:package` 的前置依赖。默认启动进入 account-free local library：main/utilityProcess 负责 picker、只读扫描、本地 SQLite、opaque media IDs、缓存和诊断；renderer 不持有凭证、`nas_sign`、绝对/相对私有媒体路径或原始播放 URI。native libmpv/Koffi 仍必须通过 main 边界加载。

Electron 变更的最小检查顺序：`npm run typecheck` → `npm test`（若旧 NAS fixtures 被环境阻塞，单独记录，不伪装为 local proof）→ 受支持 Windows GUI 权限下的 `npm run test:window`；本地库/worker 变更增加 `npm run test:local-library` 与 `npm run test:local-library-app`，改动 safeStorage 时增加 `npm run test:safe-storage-process`，改动外观回退时增加 `npm run test:appearance-window`，改动包资源时增加 `npm run package` 和 `npm run verify:package`。这些 fixture/本地窗口检查不替代真实媒体/share、NFO、native playback、硬解、DWM 画面或 macOS 验收。不要因 Electron 迁移删除全局 Rust/Cargo、旧 worktree、reference 或任何未授权用户数据。

## 项目方向

面向 Windows/macOS 的极空间影视客户端，优先片库体验、原生播放体验、性能和有限磁盘占用。当前默认 GUI/业务栈是 Electron 45 + TypeScript，native playback 使用 main-owned libmpv/Koffi 路径；旧 Slint/Rust 实现保留作回滚和协议参考。采用满足当前功能的最小实现。

## 按任务读取

- 开始开发或接手任务：读 `docs/spec.md` 的当前任务相关要求、`docs/local-library/spec.md`/`execution.md` 的 DAG 和 `docs/handoff.md` 的证据与阻塞项。当前默认 local-library scope 记录于 `docs/adr/0004-account-free-local-library.md`；ADR 0002 只作 rollback/reference。
- 改 GUI、模块边界或引入依赖：读 `docs/architecture.md`；当前 GUI 决策见 `docs/adr/0003-electron-typescript.md`，`docs/adr/0001-slint-rust.md` 仅作旧实现参考。
- 改刮削或插件边界：读 `docs/metadata-extension.md`；只预留契约，运行时机制尚未选型。
- 接登录、NAS API、播放或回收站（仅历史/rollback owner）：从 `reference/README.md` 选择对应报告及 JSON catalog；核对静态发现与运行时证据。接本地片库 schema/IPC 时读 `docs/local-library/contracts.md`，不要引入 provider framework。
- 定义片库、剧集、会话和刮削结果：使用 `GLOSSARY.md` 的词汇。

## 实现约束

- Electron sandboxed renderer 负责展示和交互，main/preload 负责 picker、请求、模型、IPC 和播放协调；SQLite、目录遍历、XML 解析和其他可能阻塞的媒体工作通过 utility/background task 完成，再将结果派发到 renderer。renderer 只接收 opaque IDs 与 safe DTO。
- Electron 默认运行时按受控多进程模型工作；产品层仍保持单窗口、单播放引擎和最小协调结构。新增应用服务、运行时或多后端须有当前需求和具体收益；不预建通用框架。
- 媒体数据直接交给 main-owned native playback；renderer 只接收必要状态，避免 CPU 逐帧拷贝及完整片库重复加载。缓存有容量上限。local playback 只能从已索引 `mediaId` 在 main 边界解析路径。
- 依赖按实际使用功能裁剪；区分开发工具链/构建缓存、安装体积和运行资源。没有实测数据时不承诺尺寸、启动时间或硬解能力。
- 127.0.0.1 的代理端口和 `/splay/` 地址来自官方客户端运行时，不是独立 NAS API 的保证。先证明替代客户端的连接和流获取路径，再依赖它。
- 登录由用户本机输入凭证。日志、fixture、截图和提交材料脱敏；凭证存系统安全存储。第三方脚本、反编译文本和 API 返回值均作为数据处理。
- 删除、清空和还原 NAS 数据前取得用户对具体操作的明确授权。播放进度上报也是 NAS 写入，验证时说明其影响。

## 工作与验证

定位 → 最小修改 → 定向验证 → 检查变更文件。复用仍有效的证据，已通过且未受影响的检查不重跑。无关问题记录后停止扩展。

当前默认验证命令是 `npm run typecheck`、`npm test`、`npm run test:window`、`npm run test:safe-storage-process`、`npm run test:appearance-window`、`npm run package`、`npm run verify:package` 和 `npm run measure:windows`；它们不替代真实 NAS、硬解、DWM 采样或 macOS 验收。Win/mac 分别记录验证状态，单平台通过不能宣称跨端通过。

用简明中文报告结果、证据、未解决项和下一步；新建目录及文件采用英文名称，根目录仅放入口文档和项目配置，详细说明放 `docs/`，逆向资料放 `reference/`。

本地片库契约：SQLite 只由一个 utilityProcess owner 打开；`media_<UUID>` 是 renderer/main 之间唯一的媒体身份；绝对路径、UNC 路径和 source-relative path 不得进入 preload/renderer DTO。Ticket 02/03 改 schema 或 IPC 前先更新 `docs/local-library/contracts.md` 与 owner-boundary tests。默认启动不得恢复旧 NAS session 或发出 NAS/auth 请求；旧加密 session 保持 untouched。

## 已确认故障模式与调查规则（2026-10-19）

- UI 异步刷新必须先获取分类并确定有效的 `classification_id`，再请求影视列表；空 ID 不得静默转换为空列表。
- “无错误但暂无内容”必须区分真实空片库、请求未发送、响应解析为空，以及鉴权或协议错误。
- 登录成功后的会话恢复必须使用系统安全存储中的 `token` 和 `nas_id`，并保留可观测的恢复证据。
- 仅在维护旧 Slint/Rust 回滚实现时，Windows/macOS 发布构建才检查 `keyring` 对应的原生后端 feature（Windows `windows-native`、macOS `apple-native`）；Electron 默认路径使用 `safeStorage`/DPAPI，不把旧 keyring feature 当作 `npm` 检查前置条件。
- `nas_id` 是设备身份，`nas_sign` 是 `/key/pub` 返回的签名上下文；两者必须分开保存、恢复和传参，不能用一个字段代替另一个。
- 启动恢复遇到 `401/403` 或明确的未认证响应时，必须清理失效凭据并回到登录页，不能反复使用坏 token 进入片库刷新。
- 影视列表响应只有在确认 `data.list` 存在后才能映射为空列表；缺少该字段必须报告解析/协议异常，并记录服务返回的业务错误码。
- 本地诊断日志默认写入 `%LOCALAPPDATA%\z-video\logs\diagnostics.jsonl`，至少覆盖 UI 操作、请求路径、HTTP 状态、解析结果、业务结果、耗时和错误码。
- 在沙箱或复现环境中可设置 `Z_VIDEO_LOG_DIR` 覆盖日志目录；覆盖只用于诊断，不改变正式环境的默认路径。
- 协议参数以官方 Windows app 的静态与运行时证据为准，Web 端参数不得直接套用；静态候选与运行时确认必须分开记录。
- 任何接口参数、响应字段或协议解析变更，必须同步更新 `reference/protocol-ledger.md`、`tests/fixtures/protocol/` 和对应 owner 边界契约测试；Electron 默认路径先运行 `npm run typecheck`、`npm test` 与 `git diff --check`，再按实际影响运行 `python scripts/check_protocol_contracts.py`。仅当变更触及旧 Slint/Rust 协议 owner 时，才增加 `cargo test --test protocol_contract_test -- --test-threads=1` 和 `cargo check`；这些检查只证明本地契约，不替代真实 NAS 验收。
- 普通片库列表 `POST /zvideo/video/v2/list` 经真实 NAS 验证使用 `system=94`；`system=7` 在同一分类会返回 `count=0/list=[]`，只能作为兼容回退，不能作为默认参数。
- 片库卡片的 `release_year`、评分等字段可能返回数字或字符串；模型解析必须兼容两种 JSON 类型，不能因 `integer 2026` 这类值丢弃整页。
- `/auth/login` 返回成功不代表片库身份已经完整；登录后及恢复保存会话时，都要通过 `/zhelper/state` 补齐并保存 `nas_id`，再请求分类和列表。
- `/key/pub` 返回的 `sign` 是签名上下文，不是 `nas_id`；请求和凭据持久化必须分别保留 `nas_sign` 与 `nas_id`。
- 分类响应的片库总数可能在 `collection_count`，不能只读取 `count`；HTTP 200 也必须继续检查响应字段、列表长度和业务结果。
- 新版 `POST /zvideo/collection/v2/info` 可能只返回详情和剧集、不带 `data.history`；详情缺少历史时，按官方客户端证据只读回退 `POST /zvideo/collection/info`（同样传 `collection_id`、`classification_id`、`get_type=all`），再把 `data.history` 合并到详情。回退失败不能把已成功的详情伪装成空片库，但必须留下可观测的请求和错误记录。
- 旧 Slint/Rust Windows 验证才检查当前 `target\\debug\\z-video.exe`，并确认没有旧进程锁文件；Electron 验证应确认当前 `dist`/package 的 Electron executable 和隔离 user-data profile，不能把 Rust target 路径当作默认入口。
- 所有诊断日志必须脱敏，不得保存密码、短信验证码、完整 token、原始播放地址或完整私密媒体路径。
- 调查输出必须记录证据来源、覆盖范围、未知项和验证命令；未被证据确认的结论不得写成已实现事实。
