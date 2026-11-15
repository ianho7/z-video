# 验证矩阵与证据边界

`AGENTS.md` 只保留默认顺序；本文件按变更类型给出完整命令。所有 `test:*` 脚本内部都会先 `npm run build`，因此**不能并发跑**，也不能由并行子代理跑（见 [pitfalls.md](pitfalls.md)）。

## 默认顺序（任何 Electron 变更）

1. `npm run typecheck`（只类型检查，子代理可用）
2. `npm test`
3. 受支持的 Windows GUI 权限下 `npm run test:window`
4. `git diff --check`

## 按变更类型追加

| 变更 | 追加命令 |
|---|---|
| 本地库/worker/SQLite | `npm run test:local-library`、`npm run test:local-library-app` |
| safeStorage/进程级凭证 | `npm run test:safe-storage-process` |
| 外观回退（high contrast / reduced transparency / 材料不可用） | `npm run test:appearance-window` |
| 单实例/启动锁 | `npm run test:single-instance` |
| 播放器窗口/overlay | `npm run test:player-window`、`npm run test:player-overlay-window` |
| 包资源/打包脚本 | `npm run package`、`npm run verify:package` |
| Windows 资源测量 | `npm run measure:windows` |
| 接口参数/响应字段/协议解析 | `reference/protocol-ledger.md`、`tests/fixtures/protocol/`、owner 边界契约测试，另按影响跑 `python scripts/check_protocol_contracts.py` |

Electron 验证要确认用的是当前 `dist`/package 的 executable 和隔离的 `--user-data-dir` profile。

## 证据边界（不得越级宣称）

- fixture、本地窗口、package verify 都**不**替代真实媒体/share、NFO、native playback、硬解、DWM 实际画面或 macOS 验收。
- Win/mac 分别记录；单平台通过不能宣称跨端通过。
- 旧 NAS fixtures 被环境阻塞时单独记录，不伪装成 local proof。
- 修改既有测试断言时，在完成记录里逐条列旧值、新值、理由。
- 未被证据确认的结论不得写成已实现事实；调查输出记录来源、覆盖范围、未知项、验证命令。

## 夹具会过期

`test:appearance-window` 等窗口夹具依赖 renderer/IPC 契约。契约变更后旧 stub 可能驱动已退役通道。历史案例：2026-11-07 的夹具失败与证据边界见 `docs/design/soft-cinema/completions/08-states-acceptance.md`。夹具失效时修复证明方法，不能据此声称外观回退已通过。

## 清理

打包验证后清理本次任务生成且不再需要的临时包和构建产物；保留用户要求的交付包、必要证据和已有文件。清理前核对具体路径与用途，并报告清理结果。
