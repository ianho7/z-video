# 增量扫描与四类计数

ID: 23a-incremental-scan
Blocked by: None (can start immediately)
Spec: docs/local-library/spec-s2-change-detection.md
Status: done (2026-11-15, merged in 7e62349; 20k scale smoke green)

## What to build

让扫描能只处理指定目录，并如实报告发生了什么：新增了几个、更新了几个、没变几个、移除了几个。

- 输入来源与相对目录集合，只遍历这些目录，不整库遍历。
- 复用既有文件发现、NFO 解析与 upsert 逻辑。
- 计数由库内已有行与本次见到比对得出，分 imported / updated / unchanged / removed。
- NFO-only 变化与视频指纹变化分开统计。
- 缺失判定只作用于被完整扫描的目录。

## Acceptance criteria

- [ ] 只给一个目录时，只扫描该目录，其它目录的行与 mtime 不被触碰。
- [ ] 新增/修改/删除各一次后，四类计数与实际一致。
- [ ] 只改 NFO 时记为 NFO 变化，不记为视频指纹变化，且播放进度与观看历史保留。
- [ ] 视频指纹变化时按既有语义处理：旧行不可用、新行新建、进度不继承。
- [ ] 目录扫描不完整时不把该目录内未见的文件标为不可用。
- [ ] 非法或不存在的相对目录被拒绝，不抛未处理异常。

## Out of scope

- 触发点与监听（Ticket 23b / 24a / 24b）。
- 全库重扫行为改动。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`。
