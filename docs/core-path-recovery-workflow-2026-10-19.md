# z-video 核心路径恢复工作流

日期：2026-10-19

## 目标与验收面

真实验收面固定为：

`NAS/IP 发现 → 登录/MFA → 极影视分类 → 影视列表 → 合集详情/剧集 → 播放流 → 播放进度 → 重启后会话恢复`

必须同时满足：

- 有效会话重启后不要求再次输入账号密码；失效 token 不得在下一次启动时循环恢复。
- 列表请求成功时能区分真实空片库、分类 ID 无效、业务错误、解析失败和未发请求。
- 网络请求和 UI 操作有本地脱敏诊断记录，能按时间还原失败边界。
- 自动发现只使用已证据确认的边界；未知的官方原生扫描协议不得伪装成已实现。

## 依赖顺序与阶段状态

| 阶段 | 依赖 | 状态 | 产物/证明 |
| --- | --- | --- | --- |
| 0. 故障规则 | 无 | 已完成 | `AGENTS.md` 的故障模式与证据规则 |
| 1. 诊断日志 | 阶段 0 | 已完成 | `src/diagnostics.rs`；`%LOCALAPPDATA%\\z-video\\logs\\diagnostics.jsonl` |
| 2. 官方客户端逆向 | 阶段 0 | 静态完成 | `reference/reverse-engineering/zspace-windows-2.45-core-path.md` |
| 3. 编译与 UI 接线 | 阶段 1、2 | 已完成 | NAS 发现按钮、结果选择、取消和错误显示；`cargo check` |
| 4. 会话持久化 | 阶段 1、2 | 已修复待真机重验 | `keyring` 已启用 Windows Credential Manager / macOS Keychain 原生后端；token/nas_id/nas_sign 恢复逻辑保留 |
| 5. 协议/响应验证 | 阶段 1、2、4 | 进行中 | 先读脱敏日志，再只修复有证据的请求字段或响应模型 |
| 6. Windows 真机验收 | 阶段 5 | 待用户运行 | 真实登录、列表、详情、播放、重启恢复和日志证据 |

## 证据边界

- 官方 Windows 安装包已确认登录/MFA 包装、history token 恢复、`libzrpc_search_device` 原生发现入口、极影视详情/播放壳层接口和 Cookie 字段边界。
- 当前逆向是 ASAR/JavaScript 静态证据；Windows native provider 未配置，因此没有声称知道官方广播、UDP、mDNS 或 ARP 扫描协议。
- 本项目的 IP 发现是明确标注的 HTTP 5055 私有网段兜底探测，不等同于官方 SDK 扫描。
- `cargo check`、模型测试、协议本地回环测试和 Mock 集成测试属于 supporting/regression evidence，不能替代真实 NAS 验收。

## 当前假设与下一步规则

当前最强可验证假设是：列表“暂无内容”需要通过诊断日志核对实际请求路径、分类 ID、表单字段、HTTP 状态、业务 code 和 `data` 形状；不能仅凭 UI 空数组判断。

本轮已确认并修复一条客户端根因：刷新流程曾把“分类请求失败”或“没有有效分类 ID”转换成成功的默认空 `CollectionPage`，因此 UI 只显示“暂无内容”。现在分类失败会直接显示分类接口错误，分类为空会报告协议异常，只有分类成功后才请求影视列表；列表响应缺少 `data.list` 也会报告解析异常。诊断记录另外保存安全的服务端 `error_code`，便于将 `N001212` 等界面错误与具体请求对应。若运行环境重定向了 `LOCALAPPDATA`，使用 `Z_VIDEO_LOG_DIR` 将日志固定到可读目录。

本次 computer-use 复现又确认：`keyring = "3.6"` 未启用平台原生 feature 时，Windows 退回进程内 mock 存储；启动日志会记录 `session.restore` 为 `skipped` / `authenticated:false`，重启后因此必然要求重新登录。现已启用 `windows-native` 与 `apple-native`，但仍需用户完成一次“勾选记住登录凭证 → 关闭 → 重新启动”的真机验证，不能把编译通过当作持久化已证明。

下一次真实运行后：

1. 先读取 `diagnostics.jsonl` 中同一时间窗口的 `auth.*`、`library.classifications` 和 `library.collections` 记录。
2. 若有业务错误或 HTTP 错误，只修复对应请求契约；若 HTTP/业务成功但数量为 0，再核对响应模型和分类映射。
3. 若日志未产生，先修复日志写入/路径问题，不修改 NAS 协议。
4. 若仍缺少官方 native 扫描证据，保留兜底扫描并记录为未闭合验收项，不安装额外反编译工具。

## 验证命令与退出条件

已通过的 supporting checks：

```powershell
cargo check
cargo test --lib diagnostics::
cargo test --lib nas::auth::
cargo test --lib nas::session::
cargo test --lib nas::client::
cargo test --test credentials_storage_test
cargo test --test discovery_test
```

认证集成测试在单进程、单测试运行方式下通过；并行运行时的 Winit 单例错误属于测试环境限制：

```powershell
cargo test --test nas_auth_integration_test <test-name> -- --exact --test-threads=1
```

只有 Windows 真机完成核心路径并留下脱敏日志后，才可将状态改为 `complete`。在此之前状态为 `mitigated`：登录恢复、日志和发现兜底已实现，但真实 NAS 列表/播放仍待验收。
