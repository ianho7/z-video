# 02 · 生成封面与动态取色

ID: 02-cover-color
Depends: 01
原型：Home、AllMedia（生成封面）、Detail（tone 切换）、MovieDetail

## 范围
- `src/renderer/cover.ts`：按 spec §4 由 `mediaId` 哈希决定色调、圆角、主字/副字，返回可渲染的封面元素。替换现有 `posterFallback`。
- `src/renderer/tone.ts`：按 spec §5 从 poster `dataUrl` 取样并映射到预设色调对；失败回退到生成封面色调；内存缓存。
- 色调以 CSS 变量（`--tone-container/--tone-on/--tone-deep`）挂在容器上，供后续页面使用。

## 验收
- 同一 `mediaId` 多次渲染封面一致；无海报、海报加载失败都显示生成封面。
- 取色：纯黑/灰度/高对比测试图回退正确；结果一定落在预设色调对内。
- 单元测试覆盖哈希稳定性、首字提取（符号/方括号/数字前缀）、副字优先级、取色回退。
- `npm run typecheck`、`npm test`、`npm run test:window`。
