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
| 1. 诊断日志 | 阶段 0 | 已完成 | `src/diagnostics.rs`；`%LOCALAPPDATA%\\z-video\\logs\\diagnostics.jsonl`；`scripts/verify_core_path_logs.py` |
| 2. 官方客户端逆向 | 阶段 0 | 静态完成 | `reference/reverse-engineering/zspace-windows-2.45-core-path.md` |
| 3. 编译与 UI 接线 | 阶段 1、2 | 已完成 | NAS 发现按钮、结果选择、取消和错误显示；`cargo check` |
| 4. 会话持久化 | 阶段 1、2 | 用户已确认通过 | `keyring` 已启用 Windows Credential Manager / macOS Keychain 原生后端；token/nas_id/nas_sign 恢复逻辑保留 |
| 5. 协议/响应验证 | 阶段 1、2、4 | 已补齐实现，待真机证据 | `data.history` 续播模型、进度写入等待、脱敏日志检查器和失败契约测试 |
| 6. Windows 真机验收 | 阶段 5 | 待用户运行 | 真实登录、列表、详情、播放、重启恢复和日志证据 |

## 证据边界

- 官方 Windows 安装包已确认登录/MFA 包装、history token 恢复、`libzrpc_search_device` 原生发现入口、极影视详情/播放壳层接口和 Cookie 字段边界。
- 详情响应中的 `data.history` 已按静态证据接入模型：`last_video_id`、`play_duration`、`audio_index`、`subtitle_index`、`subtitle_hash`、`subtitle_setting`、`play_chapter`；数字/字符串值统一兼容，禁止把播放地址写入诊断日志。
- 播放时会优先选中最近观看的 Episode；媒体载入完成后才执行保存位置的 seek，正常关闭窗口会等待进行中的进度写入最多约 2 秒并刷新诊断日志。
- 当前逆向是 ASAR/JavaScript 静态证据；Windows native provider 未配置，因此没有声称知道官方广播、UDP、mDNS 或 ARP 扫描协议。
- 本项目的 IP 发现是明确标注的 HTTP 5055 私有网段兜底探测，不等同于官方 SDK 扫描。
- `cargo check`、模型测试、协议本地回环测试和 Mock 集成测试属于 supporting/regression evidence，不能替代真实 NAS 验收。

## 当前假设与下一步规则

当前最强可验证假设是：列表“暂无内容”需要通过诊断日志核对实际请求路径、分类 ID、表单字段、HTTP 状态、业务 code 和 `data` 形状；不能仅凭 UI 空数组判断。

本轮已确认并修复一条客户端根因：刷新流程曾把“分类请求失败”或“没有有效分类 ID”转换成成功的默认空 `CollectionPage`，因此 UI 只显示“暂无内容”。现在分类失败会直接显示分类接口错误，分类为空会报告协议异常，只有分类成功后才请求影视列表；列表响应缺少 `data.list` 也会报告解析异常。诊断记录另外保存安全的服务端 `error_code`，便于将 `N001212` 等界面错误与具体请求对应。若运行环境重定向了 `LOCALAPPDATA`，使用 `Z_VIDEO_LOG_DIR` 将日志固定到可读目录。

本次 computer-use 复现又确认：`keyring = "3.6"` 未启用平台原生 feature 时，Windows 退回进程内 mock 存储；启动日志会记录 `session.restore` 为 `skipped` / `authenticated:false`，重启后因此必然要求重新登录。现已启用 `windows-native` 与 `apple-native`；用户已确认“勾选记住登录凭证 → 关闭 → 重新启动”不再要求重新登录。

当前已有历史日志仍包含旧版本记录、一个不可解析 JSONL 行和 `T000001` 业务失败，不能作为本轮成功证据。需要在当前构建上重新运行核心路径，再执行日志检查器；检查器报告的是日志证据完整性，不会把旧错误改写成成功。

下一次真实运行后：

1. 先读取 `diagnostics.jsonl` 中同一时间窗口的 `auth.*`、`library.classifications` 和 `library.collections` 记录。
2. 若有业务错误或 HTTP 错误，只修复对应请求契约；若 HTTP/业务成功但数量为 0，再核对响应模型和分类映射。
3. 若日志未产生，先修复日志写入/路径问题，不修改 NAS 协议。
4. 若仍缺少官方 native 扫描证据，保留兜底扫描并记录为未闭合验收项，不安装额外反编译工具。

## 脱敏日志证据检查

应用退出后，可执行以下检查：

```powershell
python scripts/verify_core_path_logs.py --log "$env:LOCALAPPDATA\z-video\logs\diagnostics.jsonl"
```

如果运行环境设置了 `Z_VIDEO_LOG_DIR`，脚本会默认读取该目录下的
`diagnostics.jsonl`。脚本默认只检查最后一个 `app.startup` 之后的记录；需要
审查整个文件时使用 `--all-events`。

脚本检查：

- UI 操作和登录、分类、列表、详情、播放、进度请求是否有完成记录；
- 请求是否到达请求边界（`request_observed=true`）、HTTP 状态、解析结果、业务结果、错误码和耗时；
- `not_sent`（明确未发出）、HTTP 失败、业务失败、解析失败、传输失败和成功但列表为空；
- JSONL 结构及禁止字段、完整 URL、私密媒体路径和敏感值赋值形式。

它只检查已有日志，不发起 NAS 请求、不生成成功事件、不保存真实响应，因此
`result=PASS` 仍只是日志证据完整，不能替代 Windows 真机登录、播放、进度持久化
和重启续播验收。没有请求记录时，脚本报告 `NOT_OBSERVED`；只有应用明确跳过列表
请求时才报告 `NOT_SENT`，不能把两者混为一谈。

## 验证命令与退出条件

已通过的 supporting checks：

```powershell
cargo check
cargo test --lib diagnostics::
cargo test --lib nas::auth::
cargo test --lib nas::session::
cargo test --lib nas::client::
cargo test --lib nas::models::tests -- --test-threads=1
cargo test --test credentials_storage_test
cargo test --test discovery_test
cargo test --test protocol_contract_test -- --test-threads=1
cargo test --test playback_launch_test -- --test-threads=1
cargo test --test nas_auth_integration_test -- --test-threads=1
```

认证集成测试在单进程、单测试运行方式下通过；并行运行时的 Winit 单例错误属于测试环境限制：

```powershell
cargo test --test nas_auth_integration_test <test-name> -- --exact --test-threads=1
```

只有 Windows 真机完成核心路径并留下脱敏日志后，才可将状态改为 `complete`。在此之前状态为 `mitigated`：登录恢复、日志和发现兜底已实现，但真实 NAS 列表/播放仍待验收。
