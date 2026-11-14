# 来源可用性：拆分 degraded

ID: 08-source-degraded
Depends: 07
Priority: P0

## What to build

把"来源可用性"从单布尔拆成可区分的状态，使"部分目录读不出来"不再等价于"整个来源离线"。

- schema 增列（v3 → v4）：`sources.degraded INTEGER NOT NULL DEFAULT 0`，增量迁移且幂等；`docs/local-library/contracts.md` 同步 schema 版本与列语义。
- 扫描收尾语义：
  - 根目录不可 canonical / 不可读 → `available=0`（真离线）；
  - 遍历不完整（子目录或文件失败）→ `available=1` + `degraded=1`（已索引条目仍可播）；
  - 完整遍历 → `available=1`、`degraded=0`。
- `LocalSourceSummary` 增 `degraded: boolean`；`LocalLibraryState` 随之暴露。
- 清理队列不再因 partial 被清空（依赖 `available` 语义修正，`WHERE sources.available = 1` 保持不变）。
- UI：来源卡与状态行区分"离线"与"部分目录未读取"；离线才禁用播放，degraded 只提示。
- 扫描面板：终态后 `scanProgress` 复位、面板收起；首页扫描卡保留"上次扫描：完成/部分/取消 + 计数"。

## Acceptance criteria

- [ ] 子目录不可读的扫描结果为 `partial`，来源 `available=true`、`degraded=true`；该来源条目仍可播放，清理队列不清空。
- [ ] 根目录不可读的扫描结果为 `unavailable`，来源 `available=false`、`degraded=false`，条目不可播。
- [ ] 完整扫描后 `degraded=false`，`available=true`。
- [ ] 旧库（schema v3）升级到 v4 后 `degraded` 默认 0，已有行数据与观看历史不变；重复迁移幂等。
- [ ] 渲染层对 degraded / offline 两种状态有可区分的文案，不把 degraded 说成"文件夹离线"。
- [ ] 扫描结束后扫描面板不再常驻；首页结果卡显示最后一次扫描的状态与计数。

## Out of scope

- 墓碑可见性（Ticket 11）。
- 扫描作业生命周期显式化（在 Ticket 07 内以最小改动完成）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library` → `npm run test:local-library-app`（GUI 权限）。
既有 `local-library-database-smoke` 中"partial ⇒ available=false"的断言按新语义改写，需在完成记录中报备。
