# S2 完成记录：变更感知（Ticket 23a、23b、24a、24b）

Date: 2026-11-15
Integration branch: `codex/experience-backlog`
合入链：`7e62349`（23a）→ `88e578e`（23b）→ `b4555da`（24a）→ `c60e9c4`（24b）
Spec: `docs/local-library/spec-s2-change-detection.md`

## 交付

| Ticket | 结果 | 证据 |
|---|---|---|
| 23a 增量扫描与四类计数 | `scan-directories`：按目录重扫，`imported/updated/unchanged/removed` 精确计数，NFO-only 与视频指纹变化分开；缺失判定只作用于完整扫描的目录 | typecheck、126 单测、`test:local-library`、20k 规模冒烟（82.6s，扫描中并发列表 4ms） |
| 23b 回库自动刷新 | 聚焦/返回触发；已知目录 mtime 粗筛；基线持久化在 `<userData>/local-library/directory-mtime.json`；详情/播放延后；四类计数写状态行 | typecheck、131 单测、`test:local-library`、`test:window`、`test:local-library-app`（真实改 NFO → 失焦/聚焦 → 列表更新） |
| 24a 本地盘监听 | 可注入 `ChangeSource`；递归 `fs.watch` + 1.5s 防抖合并 + 忽略规则；脏目录复用刷新调度器；移除来源/退出清理 | typecheck、145 单测（含真实文件系统集成）、`test:local-library`、`test:local-library-app` |
| 24b 网络盘轮询 | UNC / 映射盘（`kernel32!GetDriveTypeW`）判定；网络盘不挂 watch；5 分钟前台轮询，只 stat 已知目录；不可达不刷错、不误报可用 | typecheck、155 单测、`test:local-library`、`test:local-library-app` |

## 契约变更

- `LocalRefreshCause = LocalRefreshTrigger | "watch"`：刷新结果可标注 watcher/poller 来源；`isLocalRefreshTrigger` 未放宽，renderer 入参仍只接受 `focus`/`return`。
- `LocalDirectoryScanResult` 与 `LocalScanResult.counts`：四类精确计数；`importedFiles/updatedFiles` 保留为兼容投影。
- `directory-mtime.json`：版本化边车，存 sourceId → 目录签名；不含绝对路径；未改 SQLite schema（仍是 v5）。

## 断言变更

- 23a：全部为新增，无既有断言修改。
- 23b：2 处既有断言调整（`scanProgress` 夹具补 `counts`，断言值不变；空数组断言改为长度比较以避免类型收窄）；其余为新增。
- 24a：1 处既有断言修改，脏祖先根目录 `[""] → ["."]`，原因：`scanDirectories` 只接受非空相对目录，`"."` 才是根；原值会被 owner 以 `invalid-input` 拒绝。
- 24b：全部为新增，无既有断言修改。

## 已知边界

- 未在真实 SMB/UNC 共享或真实映射网络盘验证；共享延迟、SMB 目录 mtime 不可靠性留真机验收。
- 网络盘"改 NFO 内容但目录 mtime 不变"由 23b 焦点校验兜底，未做真机断言。
- macOS 未验证；ACL/权限拒绝路径未覆盖。
- 20k 全量扫描实测 82.6s，增量扫描未单独做规模基准。

## 下一批

审计遗留：37（取消语义与全部重扫，B-05）、38（单实例锁，G-01）。
