# Ticket 01 完成记录：Electron 登录与 Session

记录范围：`codex/electron-01`，仅记录 Ticket 01 已提交的实现、合并状态、验证证据和后续交接边界。

## 结论

- Ticket 01 实现已提交于 `11059a4be905e06b0c9c0d98ae54ef826445a411`。
- 集成 tip `8f33283342a3bc865b9a1c933c6fce5b86e49322` 已合并；当前 HEAD 为合并提交 `6bc5f5af14553062bff37e812b44997437b65daa`。
- Node/TypeScript 本地构建、类型检查、owner-boundary 测试和真实 Electron 窗口烟测均有通过记录。
- 这不是完整验收：没有真实 NAS 登录/片库/播放证据，也没有新鲜进程的 Windows `safeStorage` 加密持久化读回证据。

## 提交与变更范围

| 提交 | 内容 | 证据 |
| --- | --- | --- |
| `11059a4` | Ticket 01 登录、MFA、Session 恢复、安全存储、诊断、IPC、preload、登录壳和测试；27 个文件，2896 行新增 | `git show --stat 11059a4` |
| `8f33283` | 集成分支的 native player composition 可行性记录 | `git show --stat 8f33283` |
| `6bc5f5a` | 将 `codex/electron-integration` 合并进 Ticket 01 分支 | `git show --stat 6bc5f5a` |

实现文件的责任边界如下：

- 主进程：`src/main/nas-client.ts`、`session-controller.ts`、`secure-session-store.ts`、`diagnostics.ts`、`ipc.ts`、`main.ts`、`window.ts`。这里持有 NAS 请求、`token`、`nasId`、`nasSign`、Session 生命周期、`safeStorage` 文件和诊断日志。
- 共享契约：`src/shared/contracts.ts`、`src/shared/ipc-channels.ts`。这里定义 renderer-safe 的 Session、分类、片库、导航和播放命令/事件类型。
- preload：`src/preload/preload.ts`。只通过 `contextBridge` 暴露 `window.zVideo`；沙箱 preload 中保留与共享文件一致的六个 IPC channel 名称。
- renderer：`src/renderer/index.html`、`renderer.ts`、`styles.css`、`window.d.ts`。负责表单、焦点、状态和分类展示；登录表单会暂时收集用户输入并经 preload 发送，但不持久化 token、签名或密码，不直接请求 NAS，也不接收媒体地址。
- 测试与构建：`tests/`、`scripts/`、`package.json`、`package-lock.json`、`tsconfig*.json`。`docs/electron-migration-contracts.md` 是后续票据的共享交接契约。

## 已完成的本地验证

证据来自仓库根目录的 `.scratch/electron-migration/runs/01.jsonl`；以下 item 编号用于定位原始 JSONL 事件。

| 命令 | 结果 | 覆盖范围与边界 |
| --- | --- | --- |
| `npm test` | 退出码 0；最终记录为 `# tests 12`、`# pass 12`（item 180）。此前新增覆盖阶段也记录过 9/9（item 122）。 | 编译 main/renderer 并运行 NAS、Session、secure-storage、diagnostics owner-boundary 测试；fixture 不是实时 NAS。 |
| `npm run typecheck` | 退出码 0（item 181）。 | 同时检查 `tsconfig.json` 和 `tsconfig.renderer.json`。 |
| `npm run test:window` | 在正常 Windows GUI 权限下退出码 0（item 199）。 | 真实 `BrowserWindow`、隔离 renderer、preload bridge、DOM 登录到分类状态；使用本地 IPC fixture，不证明真实 NAS。 |
| `& 'C:\Users\admin\scoop\apps\python\current\python.exe' scripts/check_protocol_contracts.py` | 退出码 0；`PASS: protocol ledger and 5 shape-only fixtures are structurally safe`（item 206）。 | 只证明 ledger/5 个脱敏响应形状 fixture 的结构安全；工具本身明确不证明实时 NAS 或播放路径。 |

## 环境边界与未通过的证明方法

- 受管 sandbox 中的窗口烟测多次以 Electron Mojo `拒绝访问 (0x5)` 失败，并伴随 disk/GPU cache `EPERM`；这是执行环境边界，不是 NAS 或应用行为失败。切换到正常 Windows GUI 权限后烟测退出码为 0。
- `python scripts/check_protocol_contracts.py` 使用 Windows Store alias 时退出码为 9009，`py -3` 因找不到目标 runtime 退出码为 103；随后使用上表中的实际 Python 解释器通过。不要把 alias 失败记为协议失败。
- `cargo test --test protocol_contract_test -- --test-threads=1` 曾被执行但退出码为 1：环境设置 `CARGO_NET_OFFLINE=true`，本地缺少 `base64` crate，Cargo 报 "no matching package named base64 found"（item 208）。未下载 Rust 依赖，Rust 源码未修改；这项 Rust 兼容性检查仍待有依赖缓存或获准联网的环境执行。
- 没有真实 NAS 登录、MFA、分类、媒体流、播放进度写入及重启读回证据。没有执行删除、恢复或其他 NAS 写操作。
- `Electron` 当前 draft 依赖为 `^36.0.0`。截至 2026-10-30 的受支持 stable `45.1.0` 升级和其回归/打包验证归 Ticket 03 负责；Ticket 01 不在本交接中改依赖。

## Ticket 02 交接

Ticket 02 负责片库和浏览，不重新实现 Session 或把凭据移入 renderer：

- 使用 `src/shared/contracts.ts` 的 `Classification`、`Collection`、`Episode`、`LibraryQuery`、`NavigationContext` 和 `PublicSessionState`。
- 负责 NAS collection/detail 响应到 `Collection`/`Episode` 的映射、分页、缓存上限、搜索/排序范围、列表到详情的导航及滚动恢复。
- renderer 通过现有 preload/main 边界请求数据；原始 NAS 响应、Session 凭据、私有 `file_path` 和媒体 URI 不进入 renderer-safe DTO。
- 若需要新增 IPC，只能作为经过评审的共享契约变更，同时更新 `src/shared/ipc-channels.ts`、sandbox preload 的文字副本和 `src/main/ipc.ts`；不能静默改变已有 channel 或把空列表当作缺失字段的成功响应。

## Ticket 03 交接

Ticket 03 负责播放协调和 native player：

- `PlaybackCommand.open` 只携带 `collectionId`、`classificationId`、`episodeId` 和可选起始位置；`play`、`pause`、`seek`、音频/字幕、fullscreen、`close` 是 renderer-to-main 意图。
- `PlaybackEvent` 负责 loading、ready、state、position、tracks、error、closed；main 根据 `episodeId` 解析服务端流，私有媒体地址不得进入 renderer DTO、诊断日志或完成记录。
- 保持一个 main-owned native playback engine；HTML `<video>` 不等价于已批准的 native playback 要求。播放进度写入必须沿用已有 NAS 证据并在真实 NAS 上独立验证。
- 先处理 Electron `36.x` 到受支持 stable `45.1.0` 的升级，再做窗口/原生播放/打包回归；升级和证据归 Ticket 03 所有，本 Ticket 不改 `package.json`。

## 最终限制与待验证项

1. 真实 NAS：独立验证登录/MFA、`nas_id`/`nas_sign` 分离、分类返回、过期 Session 清理、媒体流、正确 Episode 的播放进度写入和读回。
2. 真实持久化：使用实际 Electron Windows `safeStorage`/DPAPI，在关闭并启动新进程后证明 Session 恢复；当前只有 fixture-backed `SafeStorageLike` 单元测试。
3. 真实播放与交付：native engine、暂停/seek/音轨/字幕/fullscreen、断开/过期处理、Windows 安装包和开发/安装体积尚未证明；macOS 也未验证。
4. Rust 兼容性：待解决离线 `base64` 依赖环境后再运行仓库要求的 Rust 检查；这不是 Electron 实现失败。

本交接不修改或关闭 GitHub issue；后续票据应复用本文件和 `docs/electron-migration-contracts.md` 的 owner 边界，不把未观察行为标为通过。
