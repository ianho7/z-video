# 扫描与索引安全

ID: 07-scan-index-safety
Depends: none
Priority: P0

## What to build

修正扫描作业中对账、取消与导入路径的三处数据安全问题，并让 `scan_runs` 成为可用的事实来源。

- **单文件索引失败不得被当作"文件已删除"**：`scanDirectory` 中 `discoverMedia`/`upsertMedia` 抛错的文件必须进入 `seenRelativePaths`（或独立 `failedRelativePaths` 并在对账时排除），对账不得把该行标 `available=0`，`clearMissingViewingRecords` 不得删除其账本。
- **取消的终局窗口**：`traversalComplete` 之后、对账事务与 `finishScan` 之前再检查一次 `cancellation.requested`；`cancel-scan` 只有在扫描确实还能被中断时才返回 `true`。
- **`importVideo` 不得覆盖已有集合的 NFO 元数据**：复用已有行的 `year/premiered_at/plot/genre_json/rating`（只写非空），或 import 路径改为"仅补齐缺失字段"。
- **`import` 与 `scan` 互斥**：`import-video` 复用 `activeScan` 单飞守卫（或排队），避免二者竞争 `sources.available` 与 `media_files`。
- **`scan_runs` 从写-only 变为可读**：启动时把 `completed_at IS NULL` 的行标为 interrupted，并据此决定是否需要一次对账；`generation` 若保留则说明其用途，否则移除。
- **大库对账分批**：`NOT IN (?,…)` 改为临时表或分批查询，避免超过 SQLite 变量上限导致事务回滚。

## Acceptance criteria

- [ ] 构造"某文件 NFO 解析抛错、其余正常"的扫描：该文件所在行保持 `available=1`，其 `viewing_sessions`/`media_history` 不被删除，扫描仍可 `completed`（`tests/local-library-database-smoke.ts`）。
- [ ] 在 `traversalComplete` 之后注入取消：`cancelScan` 返回 `false`（或扫描结果为 `cancelled`），二者不再出现"返回 true 但结果是 completed"。
- [ ] 对已索引剧集执行 `importVideo` 后，`collections.plot/rating/year/premiered_at` 保持不变，`kind` 不被改成 `movie`。
- [ ] 扫描进行中触发 `importVideo` 的行为有明确契约（拒绝并给出可读错误，或排队），不得静默并行写库。
- [ ] 启动时存在未完成 `scan_runs` 行的库：状态可查询到 interrupted，且不残留"看起来完成"的假象。
- [ ] 约 2 万条已索引记录的成功扫描不被 SQL 变量上限打断（用合成行做单元/冒烟规模验证即可）。

## Out of scope

- 来源可用性语义拆分（Ticket 08）。
- 墓碑是否出现在列表（Ticket 11）。
- worker 崩溃与重启（Ticket 13）。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`。
被修改的既有断言需在完成记录中逐条列出旧值/新值与理由。
