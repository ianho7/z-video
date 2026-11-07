# 04 · 全部媒体页与搜索

- 将首页/全部/电影/剧集入口共用的列表查询页改为 D2 全部媒体结构：类型分段控件、来源筛选 chip、排序、海报网格和分页；离线媒体保留详情入口并在海报上显示“来源离线”。
- 搜索结果标题显示关键词、命中数与片库总数。类型筛选下的无结果状态会提示当前筛选范围，并可点“搜索全部类型”；操作保留关键词。分类为空、无匹配结果和加载错误使用不同文案/操作。
- 查询参数和页码沿用现有 local-library `list` DTO，不涉及 IPC、preload 或 schema。详情返回后恢复原页并尝试恢复焦点到原媒体卡片。
- 覆盖测试：扩展 `tests/local-library-app-smoke.ts` 检查第 2 页往返与焦点恢复，以及“搜索全部类型”保留关键词；窗口 smoke 由集成者串行执行，本 worktree 未运行。
- `npm run typecheck`：通过。
- `npm test`：69 项中 49 项通过、20 项因当前环境无法访问本地 NAS 测试地址（`fetch failed`）失败；renderer build 成功，失败集中在旧 NAS 网络测试，不属于本 ticket 行为。
- `git diff --check`：通过。
- Windows GUI 截图/窗口 smoke 由集成阶段执行；macOS 外观未验收。
