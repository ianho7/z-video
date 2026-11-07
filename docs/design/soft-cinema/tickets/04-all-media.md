# 04 · 全部媒体页与搜索

ID: 04-all-media
Depends: 03
原型：AllMedia、States 卡 1/2/4

## 范围
- 网格 + 类型分段控件 + 来源 chip + 排序 + 分页（当前页 lavender 饼干圆角）。
- 搜索中：搜索框高亮、标题旁显示 `“关键词” · 命中 / 总数`。
- 离线条目半透明 + “来源离线”标签，仍可进入详情。
- 空状态区分：搜索无结果（filter≠all 时给“搜索全部类型”，保留关键词）、分类为空、真实空片库（交给 05 的首次启动）、加载中骨架。
- 保留返回时的查询、筛选、排序、页码和焦点恢复。

## 验收
- “搜索全部类型”只把 filter 设为 `all` 再查一次，不改 query。
- 空态文案按上述三类区分，不出现静默空列表。
- `npm run typecheck`、`npm test`、`npm run test:window`、`npm run test:local-library-app`。
