# SMB Guest 与 z-video 免登录访问研究

日期：2026-10-31  
范围：只读查阅 Microsoft 官方 SMB 文档、当前 Electron 源码及仓库已有协议资料。没有连接 NAS、尝试 SMB、读取用户凭据或修改任何设置；没有改应用代码。

## 结论

SMB guest 分享的是文件读取路径，不会自动创建极空间的影视 API 会话。若 Windows SMB 客户端当前允许 guest，并且访客权限确实只读，z-video 可以考虑从登录页提供“打开共享视频”，让 Windows 文件选择器选中一个 `\\主机\共享名\目录\影片.mkv`，再交给现有 libmpv 本地播放通路。此处仅是有源码支撑的可行方案，当前没有对 UNC 或该 NAS 做运行验证。

这条路径可以绕过 **z-video 的 NAS 账号登录**，但只能打开用户选定的文件。它不会给应用提供极影视片库分类、合集/剧集关系、NAS 观看历史或进度同步。若要维持这些能力，仍需当前 NAS API 所要求的认证会话，或另行设计并验证一个能替代它们的接口。

## SMB 文件访问与极影视 API 是两层

Microsoft 将 SMB 描述为网络文件共享协议，供应用访问远端服务器上的文件和资源；Windows UNC 路径形如 `\\server\share\...`。这意味着 SMB 只回答“当前 Windows 进程能否读取这个共享文件”，本身不提供极影视条目、分类、剧集和观看历史模型。[Microsoft：SMB 文件共享概览](https://learn.microsoft.com/en-us/windows-server/storage/file-server/file-server-smb-overview)；[Microsoft：Windows UNC 路径格式](https://learn.microsoft.com/en-us/dotnet/standard/io/file-path-formats)

当前 z-video 的协议代码另走 NAS HTTP API：

- 登录流程先访问 NAS 公钥和 `/auth/login`，随后取 `/zhelper/state` 补齐 `nas_id`；分类请求使用会话上下文。见 [`nas-client.ts`](../../src/main/nas-client.ts#L483) 与 [`nas-client.ts`](../../src/main/nas-client.ts#L545)。
- 详情、取播放流和进度上报都接收 `AuthenticatedSession`；取流要求 token 和 Episode 的 NAS `file_path`，进度上报要求 token、`collection_id`、`classification_id`、`video_id`，并向 `/zvideo/video/updateplaytime` 提交。会话表单同时带 token 和 Cookie。见 [`nas-client.ts`](../../src/main/nas-client.ts#L601)、[`nas-client.ts`](../../src/main/nas-client.ts#L623)、[`nas-client.ts`](../../src/main/nas-client.ts#L646)、[`nas-client.ts`](../../src/main/nas-client.ts#L840)。
- 已有本地播放流程把 `progressEnabled` 设为 `false`；它没有 NAS 影视条目的 ID 可供上报。见 [`player.ts`](../../src/main/player.ts#L92)。

仓库的 NAS API 报告记录了特定版本的官方客户端接口与登录后播放证据，也明确指出这些静态目录不是完整服务端规范；这些资料不证明存在可匿名调用的替代 API。[NAS 极影视 API 资料](../../reference/nas-video-api.md)、[官方播放器 API 资料](../../reference/player-api.md)

## Windows guest 访问限制

Microsoft 将 SMB guest logon 定义为不带凭据的访问，并指出 guest 不支持 SMB signing 或 encryption。允许 guest 会增加伪装恶意服务器、中间人攻击和恶意内容风险；Microsoft 建议只在确有需要时启用，并建议优先要求认证访问。[Microsoft：SMB guest logon 默认行为与风险](https://learn.microsoft.com/en-us/windows-server/storage/file-server/enable-insecure-guest-logons-smb2-and-smb3?tabs=powershell)；[Microsoft：SMB 安全加固](https://learn.microsoft.com/en-us/windows-server/storage/file-server/smb-security-hardening)

Windows 的默认值需要结合版本和 Edition 判断：

- Microsoft 的 guest 行为页面称，Windows 10 Enterprise、Education、Pro for Workstations 默认拒绝 guest；Windows 10 Home/Pro 仍允许；Windows 11 Pro 从 Insider Preview build 25267 起默认拒绝。该页也说明从 Windows 11 24H2 起存在默认 SMB signing 兼容限制。[Microsoft：guest 默认行为](https://learn.microsoft.com/en-us/windows-server/storage/file-server/enable-insecure-guest-logons-smb2-and-smb3?tabs=powershell)
- Microsoft 的签名页面称 Windows 11 24H2 Pro、Enterprise、Education 默认要求 SMB signing，而 Home 不要求；guest 与 signing 不兼容，微软不建议为了 guest 而关闭 signing。[Microsoft：SMB signing](https://learn.microsoft.com/en-us/windows-server/storage/file-server/smb-signing?tabs=group-policy)
- Microsoft 的另一篇 SMB 防护页面仍称 Windows 11 Home 和 Pro 延续旧的“默认允许 guest”行为，与上述较新的 Pro 说明冲突。[Microsoft：SMB interception 防护](https://learn.microsoft.com/en-us/windows-server/storage/file-server/smb-interception-defense?tabs=group-policy)

因此，不能仅凭 NAS 页面上的“guest 已启用”判断这台 Windows 客户端能否接入。当前机器的 Windows 版本、Edition、有效策略、SMB signing/encryption 配置及 NAS 协商能力都未知；报告不替用户检查或更改这些设置。若共享无法打开，不应自动通过关闭 signing/encryption 或全局启用 insecure guest 来绕过。优先考虑 NAS 上权限限定为只读的专用 SMB 用户，并保持 Windows SMB 安全默认值。

## 当前 Electron 源码支持到哪里

1. Electron 主进程已有 `chooseLocalFile()`：使用原生打开文件对话框，筛选常见视频扩展名，并把选中的文件路径交给 `openLocal()`。见 [`player-host.ts`](../../src/main/player-host.ts#L61)。主进程把路径直接传给 libmpv 的 `loadfile`；播放前还会对非 HTTP(S) 路径调用 `existsSync`。见 [`mpv-player.ts`](../../src/main/mpv-player.ts#L99) 与 [`mpv-player.ts`](../../src/main/mpv-player.ts#L123)。Electron 原生文件对话框会返回所选路径。[Electron：dialog](https://www.electronjs.org/docs/latest/api/dialog)
2. 现有 `打开本地视频` 按钮在片库工具栏。登录页 `renderState()` 将未认证时的片库隐藏，故用户当前无法从登录页触发这项本地播放能力。见 [`index.html`](../../src/renderer/index.html#L97)、[`renderer.ts`](../../src/renderer/renderer.ts#L155)、[`ipc.ts`](../../src/main/ipc.ts#L34)。
3. Windows 将 UNC 定义为远端共享文件路径，当前 main 进程把路径交给原生文件 API 和 libmpv。因此，如果 Windows SMB 栈能读取所选 UNC，现有代码路径**可能**直接播放它；源码没有 UNC 专用鉴权、目录索引或重连逻辑，也没有证明当前 libmpv 包对此 NAS 路径能成功播放。此项是推断，需在用户明确安排的 Windows/SMB 验收中验证。
4. 当前启动恢复只读取安全存储会话并恢复分类；未保存会话时进入 `logged-out`。恢复成功后片库 API 读取依然依赖已存会话。[`session-controller.ts`](../../src/main/session-controller.ts#L45)。登录页目前也没有 guest、共享目录或离线入口。实际窗口中持续显示“正在恢复安全会话…”是另一项已观察的 UI 状态，三次观察只证明提示持续显示，根因尚未诊断。[登录页观察记录](desktop-user-view-audit.md)

“记住登录会话”保存的是此前登录获得的 NAS 会话，启动时会再次用该会话访问分类；它省去重复输入，不是 SMB guest 或匿名 NAS API。[`session-controller.ts`](../../src/main/session-controller.ts#L45)、[`session-controller.ts`](../../src/main/session-controller.ts#L219)、[`index.html`](../../src/renderer/index.html#L30)

## 方案影响与建议

| 方案 | 登录要求 | 能力与限制 | 建议 |
|---|---|---|---|
| 从登录页打开一个 SMB 视频文件 | 不需要 z-video NAS 登录；仍受 Windows SMB guest 策略约束 | 可复用本地播放协调器；无极影视分类/详情/历史/进度同步 | 若目标只是免账号播放，这是最小候选。入口需放在登录页，并在真实 NAS/Windows 上单独验证 UNC。 |
| 扫描 SMB 共享做文件库 | 不需要 z-video NAS 登录；共享必须可读取 | 可按文件名展示或自行解析元数据；不会自然获得极影视 ID、分类、海报、观看历史和进度保存 | 只有用户明确要“共享目录片库”时再设计范围。不要把文件扫描宣称为 NAS 影视库兼容。 |
| 保持现有极影视 API 流程 | 需要 NAS 登录/有效 token | 可用极影视分类、详情、服务端流 URI 与进度接口 | 如果“续播和原有片库语义”是必要要求，继续使用此路径。SMB guest 不能替代它。 |

**建议先选第一种目标：免登录打开单个共享视频文件。** 后续若落实，只需先讨论把本地/共享文件入口前移至登录页，并保持 SMB 访问由 Windows 本机 SMB 客户端处理；不自动修改 SMB 策略。需要用户提供其 Windows 版本/Edition 与共享名，并由用户决定是否进行实际 UNC 播放验证。若目标其实是保持极影视目录和进度，则应维持 NAS API 登录，单靠 guest share 不够。

## 事实、推断与未知

| 项目 | 类型 | 说明 |
|---|---|---|
| NAS 设置页报告 guest 无密码、共享只读，设备地址为 `192.168.5.2` | 用户提供，未独立核验 | 本轮没有访问该 NAS，也没有验证分享 ACL、共享名或 SMB dialect。 |
| SMB 可让应用读远端文件；UNC 以服务器/共享路径表示 | Microsoft 官方事实 | 只证明协议/路径概念，不证明当前机器已能访问该 NAS。 |
| 当前应用通过 NAS 登录态读取分类、详情、播放流并提交进度 | 当前源码事实 | 不是从 SMB 文件权限派生的登录态。服务端是否另有匿名 API，现有证据未证明。 |
| 当前应用已有登录后可见的本地视频选择及 libmpv 播放路径 | 当前源码事实 | 没有登录页入口；本地路径的进度同步关闭。 |
| Windows SMB 已允许 guest 时，选择 UNC 文件可能可直接复用现有播放器 | 推断，未测试 | 还取决于当前 Windows 策略、NAS 共享权限、路径可见性、libmpv/驱动和媒体兼容性。 |
| Windows 具体 guest 默认值和 signing/encryption 协商结果 | 未知且微软文档有冲突 | 需要准确 Windows 版本、Edition 与有效客户端策略；本轮不读取或修改这些状态。 |

## 证据边界

所有 Microsoft 外部来源均为 Microsoft Learn 官方文档。源码结论只覆盖当前仓库 Electron 45 路径；用户提供的设置截图描述未在本轮现场复核。没有访问 NAS、验证 SMB 连接、播放样本或观察进度持久化，也没有进行任何实现或设置更改。

**两分钟下一步：** 在 Windows 打开“设置 → 系统 → 关于”，记下 Edition 和 OS 版本；这一步只查看信息，不改 SMB 设置。它能缩小 guest 默认值的适用范围，但仍不能替代读取有效 SMB 客户端策略或实际 UNC 验收。
