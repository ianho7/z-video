# 01: B0 · 最近发布日期

**What to build:** 用户在片库排序里选择“最近发布”时，作品按 NFO 里的真实发布日期从新到旧排列；没有日期的作品显示“发布日期未知”并排在最后，不能用年份倒装日期。这个行为要贯穿 NFO 解析、数据库、作品列表 DTO、排序菜单和验证。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] NFO 的 `<premiered>` 能解析出 `YYYY-MM-DD`；`<releasedate>` 作为兼容回退；非法或缺失日期为 null。
- [ ] `collections` 新增 `premiered_at TEXT` 与索引，`user_version` 升到 2；重复启动/迁移幂等，旧数据不被猜测日期。
- [ ] 作品查询新增 `released_desc`：按日期降序，无日期条目排最后，再按年份/最近加入决胜。
- [ ] 作品 DTO 暴露 `premieredDate`，不包含任何私有路径。
- [ ] 片库排序菜单出现“最近发布”；选择后结果顺序正确，无日期条目显示“发布日期未知”。
- [ ] 真实 SQLite 测试覆盖日期解析、非法日期、null 排最后、迁移和排序；production app smoke 覆盖菜单与顺序。
