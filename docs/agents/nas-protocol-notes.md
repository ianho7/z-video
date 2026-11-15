# 历史 NAS 协议与故障模式（rollback/reference）

只在接登录、NAS API、播放或回收站（历史/rollback owner）时读。默认启动是 account-free local library，不恢复旧 NAS session、不发 NAS/auth 请求；旧加密 session 保持 untouched。

## 调查规则

- UI 异步刷新必须先取分类并确定有效 `classification_id`，再请求影视列表；空 ID 不得静默转换为空列表。
- "无错误但暂无内容"必须区分：真实空片库、请求未发送、响应解析为空、鉴权/协议错误。
- 会话恢复使用系统安全存储中的 `token` 和 `nas_id`，并保留可观测证据。
- `nas_id` 是设备身份，`nas_sign` 是 `/key/pub` 返回的签名上下文；分开保存、恢复、传参。
- 启动恢复遇到 `401/403` 或明确未认证响应，清理失效凭据回登录页，不得反复用坏 token 刷新片库。
- 列表响应只有在确认 `data.list` 存在后才能映射为空列表；缺字段要报解析/协议异常并记录业务错误码。
- 诊断日志默认 `%LOCALAPPDATA%\z-video\logs\diagnostics.jsonl`，覆盖 UI 操作、请求路径、HTTP 状态、解析结果、业务结果、耗时、错误码；可用 `Z_VIDEO_LOG_DIR` 覆盖（仅诊断，不改正式默认）。
- 日志必须脱敏：不保存密码、短信验证码、完整 token、原始播放地址、完整私密媒体路径。
- 协议参数以官方 Windows app 的静态 + 运行时证据为准；Web 端参数不得直接套用。静态候选与运行时确认分开记录。

## 已验证的协议事实

- 列表 `POST /zvideo/video/v2/list` 真实 NAS 验证用 `system=94`；`system=7` 同分类返回 `count=0/list=[]`，只作兼容回退。
- `release_year`、评分等字段可能返回数字或字符串；解析必须兼容两种 JSON 类型，不能因 `integer` 丢整页。
- `/auth/login` 成功不代表片库身份完整；登录后及恢复保存会话时通过 `/zhelper/state` 补齐并保存 `nas_id`，再请求分类与列表。
- 分类响应片库总数可能在 `collection_count`；不能只读 `count`。HTTP 200 也要继续查字段、列表长度、业务结果。
- 新版 `POST /zvideo/collection/v2/info` 可能只返回详情和剧集，不带 `data.history`；缺历史时按官方客户端证据只读回退 `POST /zvideo/collection/info`（同样传 `collection_id`、`classification_id`、`get_type=all`），合并 `data.history`。回退失败不得把已成功详情伪装成空片库，但必须留可观测请求与错误记录。
- 127.0.0.1 的代理端口与 `/splay/` 地址来自官方客户端运行时，不是独立 NAS API 的保证；先证明替代客户端的连接与流获取路径。

## 契约同步

接口参数、响应字段或协议解析变更时，同步更新 `reference/protocol-ledger.md`、`tests/fixtures/protocol/` 与对应 owner 边界契约测试。Electron 默认路径先跑 `npm run typecheck`、`npm test`、`git diff --check`，再按影响跑 `python scripts/check_protocol_contracts.py`。这些只证明本地契约，不替代真实 NAS 验收。
