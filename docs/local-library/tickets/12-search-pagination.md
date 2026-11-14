# 搜索分页

ID: 12-search-pagination
Depends: none
Priority: P1

## What to build

让搜索结果可以完整浏览，计数文案与实际展示一致。

- `searchPage` 真正生效：翻页/重置路径写入它，`loadSearch` 使用它。
- 复用 `paginationModel` 与现有分页控件，在搜索页底部渲染分页；返回/清空搜索时复位为 1。
- `searchCount` 文案区分"共 N 部"与"当前第 X 页"，过滤/排序变化时回到第 1 页。
- 保持 `searchActive` 单一判断：不再出现 `searchActive=false` 但 `searchSection` 可见的空白页。

## Acceptance criteria

- [ ] 搜索结果超过一页时可翻到第 2 页且内容不重复、不丢失；返回第 1 页正确。
- [ ] 过滤/排序切换后自动回到第 1 页并重载。
- [ ] 顶部计数与实际可浏览结果一致，不再出现"共 137 部但只有 24 张卡"。
- [ ] `closeDetail` 的搜索返回路径不会留下"可见但未加载"的搜索页。

## Out of scope

- 搜索索引/模糊匹配质量。
- 服务端搜索（当前为本地库查询）。

## Verification

`npm run typecheck` → `npm test`。
GUI 行为若涉及渲染，需 `npm run test:window` 或手动窗口验证并单独标注。
