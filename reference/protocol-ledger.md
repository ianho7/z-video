# z-video 协议证据台账

状态：证据台账与脱敏响应形状，2026-10-19。此文件只整理仓库已有证据，不把静态候选写成真实 NAS 已确认协议。

## 证据层级

| 标记 | 含义 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| `S` 静态 | 安装包 ASAR、NAS 页面脚本、catalog 或静态代码 | 客户端构造过某个路径、字段或分支 | 字段必填、当前固件接受、替代客户端可独立完成请求 |
| `R` 运行时 | 官方 Web/Windows 客户端的脱敏运行记录 | 某次会话观察到的路径、HTTP 状态或播放链 | 未捕获的请求体、完整响应 schema、跨版本通用性 |
| `N` 真实 NAS | z-video 对真实 NAS 的脱敏验证记录 | 指定 NAS、指定版本和指定操作的结果 | 其他 NAS、固件、媒体或账号 |
| `I` 推断 | 根据上述证据和当前代码做出的实现判断 | 需要继续验证的工程假设 | 已实现或服务端保证 |

必填性使用以下含义：`调用必须` 表示当前客户端没有该字段就无法构造请求；`成功响应必须` 表示当前生产 owner 才能安全继续；`服务端必填未知` 表示静态资料没有证明后端规则；`可选/分支` 表示由内容或服务端响应决定。

## 1. 登录与会话

| 接口 | 字段/位置 | 证据层级 | 必填性 | 类型变体 | fixture / test | 未知项与最后验证边界 |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /key/pub?signme=1` | `signme` query；响应 `data.key`、`data.sign`、`data.name` | `S`；安装包静态报告 | `signme` 为当前调用必须；响应 `key` 成功登录必须；`sign`/`name` 可选 | key/sign/name 为字符串；缺失时的服务端规则未知 | `tests/fixtures/protocol/login-response-shape.json`; `tests/protocol_contract_test.rs` 登录链 | 静态代码证明了公钥和 sign 的使用，不证明 NAS 固件的完整公钥 schema；最后边界为 2026-10-19 静态报告 |
| `POST /auth/login` | 加密 `username`、加密 `password`；`plat`、`version`、`device`、`device_id`；可选 `sms_proof` | `S` + `R` | 当前调用必须；服务端其他字段必填性未知 | 成功 `code` 可为数字/字符串；`data.token` 为字符串；`is_local` 观察到 boolean 或整数 `0/1` | `tests/fixtures/protocol/login-response-shape.json`; `src/nas/auth.rs` 回归测试; `tests/protocol_contract_test.rs` | 原始凭证、验证码和 token 不进入 fixture；token 过期/刷新/撤销状态机未验证；官方运行时记录没有保存请求体 |
| `GET /zhelper/state` | 登录后补齐 `nas_id` | `R` + 当前实现 | 登录后片库身份恢复需要；服务端是否始终返回未知 | `data.nasid`/别名为字符串；缺失时当前实现保留已有状态 | `tests/fixtures/protocol/login-response-shape.json`; `tests/protocol_contract_test.rs` 登录链 | 仅证明项目当前登录链会补齐身份，不证明所有 NAS 都支持同样字段 |
| `POST /sms/ucheck` | 云端验证阶段使用加密用户名、`key_id`、NAS sign 和用户输入码；成功返回不透明 proof | `S` | MFA 分支调用必须；原始码不能当 proof | proof 为不透明字符串；原始码不保存 | `reference/reverse-engineering/zspace-windows-2.45-core-path.md`; `tests/nas_auth_integration_test.rs` | 短信发送条件、重试和供应商状态未验证；本台账不保存验证码或 proof 值 |

## 2. 分类

| 接口 | 字段/位置 | 证据层级 | 必填性 | 类型变体 | fixture / test | 未知项与最后验证边界 |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /zvideo/classification/list` | 请求使用会话上下文；响应 `data[]` 的 `id`、`name`、`is_system`、`is_enable`、`count`/`collection_count` | `S` + `R`；NAS 页面目录与登录后运行记录 | 成功响应 `data` 必须；条目字段的后端必填性未知 | 标志位当前模型为整数；计数可来自 `count` 或 `collection_count` | `tests/fixtures/protocol/classification-response-shape.json`; `src/nas/models.rs` 分类测试 | 运行记录证明一次 HTTP 200，不包含完整脱敏响应；不可据此推广所有固件 |

## 3. 影视列表

| 接口 | 字段/位置 | 证据层级 | 必填性 | 类型变体 | fixture / test | 未知项与最后验证边界 |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /zvideo/video/v2/list` | form/query 上下文：`classification_id`、`start`、`limit`、`system`；当前真实 NAS 记录使用 `system=94`，旧页面候选出现 `system=7` | `S` + `N`（仅 `system=94` 参数边界）+ `I`（兼容回退） | `classification_id` 必须为有效分类；当前实现主请求使用 `system=94`；服务端其他必填性未知 | `count` 或 `collection_count`；卡片 `release_year`、`score`、`rating` 可为数字或字符串 | `tests/fixtures/protocol/list-response-shape.json`; `tests/protocol_contract_test.rs` 列表链 | `data.list` 缺失必须是协议错误，不能当空片库；真实 NAS 的完整响应没有迁入仓库；`system=7` 不是当前默认协议 |
| 成功响应 | `data.list`、`data.count`/`data.collection_count`、可选 `classification_name` | `I` + 当前生产 owner 契约 | `data.list` 成功响应必须存在，即使为空也要明确记录 | `list` 为数组；计数为整数或按 fixture 记录的变体 | 同上 | 空列表、未发请求、鉴权错误和解析错误必须分别报告；此条是应用边界，不是后端完整规范 |

## 4. 合集详情与剧集

| 接口 | 字段/位置 | 证据层级 | 必填性 | 类型变体 | fixture / test | 未知项与最后验证边界 |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /zvideo/collection/v2/info` | `collection_id`、`classification_id`、`get_type=all` | `S` + `R` | 当前调用必须；服务端字段必填性未知 | 参数为字符串；响应 `data` 为对象 | `tests/fixtures/protocol/detail-response-shape.json`; `tests/protocol_contract_test.rs` 详情链 | 官方 Web 运行时观察到详情链；完整详情 schema 和权限差异未确认 |
| 详情 `data` | `collection_id`、标题/年份/评分、`list[]`；剧集可能在 `version_list`、`video_list`、`episodes`；剧集有 `video_id`、`episode`、`file_path` | `S` + `R` | `data` 成功响应必须；具体剧集容器按响应分支 | 年份、评分、季/集编号可能数字或字符串；媒体路径值必须省略 | 同上 | 当前 fixture 只有字段名和类型；不保存私密媒体路径；不同固件的嵌套结构仍是未知项 |

## 5. 播放

| 接口 | 字段/位置 | 证据层级 | 必填性 | 类型变体 | fixture / test | 未知项与最后验证边界 |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /transcode/play` | `file_path`、`play_env`、`video_codec`、`support_format`、音/字幕索引、分支字段 `encrypted_path`/`from` | `S`；安装包静态播放器接口 | 当前 z-video 请求构造需要 `file_path`；其他字段服务端必填性未知 | 参数以 query 发送；响应 `data.uri` 为服务端返回字符串，地址值禁止保存 | `tests/fixtures/protocol/playback-response-shape.json`; `tests/protocol_contract_test.rs` 播放业务错误链 | 官方桌面运行时直接观察到的是 `/transcode/video/streams` 和动态 `/splay/`；`/transcode/play` 完整响应未捕获 |
| `GET /transcode/video/streams` | `file_path` 或加密分支字段 | `R`；官方 Web/Windows 运行记录 | 运行时曾成功发出；替代客户端的必填性未知 | 响应完整字段未保存；只记录 shape 级信息 | `tests/fixtures/protocol/playback-response-shape.json` | 不能把动态本地 `/splay/` 地址写成协议常量；不能把官方客户端播放证明成所有替代客户端都能播放 |
| 播放响应 | `data.uri`、可选 `audio_list`、`subtitle_list`、格式扩展字段 | `S` + 当前生产 owner 契约 | 当前生产 owner 只有在 `data` 和非空 URI 存在时才成功 | URI/播放地址为字符串但值不落盘；轨道为数组 | 同上 | `T000001` 是业务失败，不是空播放地址；完整返回 schema、有效期和跨固件差异未知 |

## 脱敏 fixture 约定

fixture 位于 [`tests/fixtures/protocol/`](../tests/fixtures/protocol/)，只保存：

- 字段名、JSON 类型、业务成功/失败类别、HTTP 状态类型；
- `data` 是否存在、列表字段是否存在、计数字段的别名；
- 证据来源和覆盖边界。

fixture 不保存字段值、原始 JSON、账号、密码、短信验证码、proof、token、Cookie、播放 URI、`file_path` 或其他私密媒体路径。字段名可以出现在 `fields` 中，但必须标记 `value_omitted: true`。

运行轻量检查：

```powershell
python scripts/check_protocol_contracts.py
```

该脚本只检查台账章节/路径、fixture 结构和敏感值禁入；它不能证明真实 NAS 协议正确，也不能替代 Windows 真机验收。生产 owner 契约测试使用合成的本地 HTTP 响应，不代表真实 NAS 已通过。

## Test-audit authoring gate 记录

新增契约测试都在 `tests/protocol_contract_test.rs` 的 `HttpNasClient` owner 边界运行：

| 测试风险 | 独立契约/故障依据 | 基线缺口 | 不新增生产测试 seam 的理由 |
| --- | --- | --- | --- |
| `integer 0/1` | 已出现的 `/auth/login` `integer 0` 解析回归；登录响应类型契约 | 原有测试只在 auth 模块内覆盖；没有 HTTP owner 边界 | 通过本地 HTTP server 驱动公开 `NasClient::login` |
| 数字/字符串混用 | NAS 卡片年份/评分和详情季集字段的已知变化 | 原有模型测试没有覆盖列表/详情 HTTP 边界 | 直接调用公开列表/详情接口 |
| 缺少 `data.list`、计数别名 | `AGENTS.md` 的空列表误判规则 | 旧 Mock 忽略分类 ID，不能证明真实列表响应 | 直接调用 `HttpNasClient::get_collections` |
| 错误分类、`T000001`、HTTP 200 业务失败 | 片库空列表和播放参数错误的真实故障模式 | 过去把错误转换成成功空页；失败响应没有 owner 测试 | `HttpNasClient` 由本地 server 驱动；`MockNasClient` 由其真实实现边界测试 |

## 当前未闭合项

1. fixture 是脱敏响应形状，不是从真实 NAS 原始响应复制的 fixture；真实响应 body、完整播放 URI 和私密路径仍未保存。
2. `/transcode/play` 的完整运行时请求/响应仍是未知；官方运行时的 `/transcode/video/streams`/`/splay/` 证据与替代客户端独立链路必须分开。
