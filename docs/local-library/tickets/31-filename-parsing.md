# 文件名解析与演员/厂牌聚合

ID: 31-filename-parsing
Blocked by: None (can start immediately)
Status: ready-for-agent

## What to build

从没有 NFO 的文件名里解析出结构化字段，并以"人"为单位组织浏览。用户可感知结果：能按演员/厂牌看"我有 40 部、看过 3 部"，而不是靠文件名回忆。

- 本地规则解析常见命名模式（厂牌、演员、年份、分辨率）。
- 解析失败进"元数据待补"队列，可快速内联修正。
- 新增按演员/厂牌的聚合视图。
- 允许本地 sidecar 覆盖，不改原文件。

## Acceptance criteria

- [ ] 常见命名模式能解析出厂牌/演员/年份，解析结果可编辑。
- [ ] 解析失败的条目集中在待补队列，不静默丢弃。
- [ ] 演员/厂牌页显示条目数与已看数，点击可筛选列表。
- [ ] sidecar 覆盖优先于文件名解析，且不写回源文件。
- [ ] 解析规则可维护（同一条规则不散落在多处）。

## Out of scope

- 在线刮削或任何联网元数据。
- 自动重命名文件。

## Verification

`npm run typecheck` → `npm test` → `npm run test:local-library`。
