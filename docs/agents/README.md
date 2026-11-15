# 给 agent 的专题文档索引

`AGENTS.md` 只保留每次对话都必须知道的硬约束和指针；以下文件按需读取，不要一次性全读。

| 文件 | 什么时候读 | 内容 |
|---|---|---|
| [verification-matrix.md](verification-matrix.md) | 要决定跑哪些检查、判断证据是否足够 | 变更类型 → 命令、证据边界、清理规则 |
| [pitfalls.md](pitfalls.md) | 改 Electron/窗口/冒烟/并行/测试 | 2026-11 已验证的重复踩坑与修复方式 |
| [codex-computer-use.md](codex-computer-use.md) | 人工验收、UI 自动化、截图取证 | DSH → Codex computer use 完整规范 |
| [nas-protocol-notes.md](nas-protocol-notes.md) | 只有接历史 NAS/登录/回收站 rollback owner 时 | 旧 NAS-first 故障模式与协议契约同步要求 |
| [state-and-concurrency.md](state-and-concurrency.md) | 改状态机、epoch、并行子代理 | 状态单一载体、非法迁移、并行白名单规则 |

新增专题文件的规则：只在 `AGENTS.md` 放一行指针；专题文件写"何时读 + 可执行规则 + 证据出处"，不写背景故事。
