# 01 · 设计变量、字体与基础组件

ID: 01-foundation
Depends: —
原型：全部 D2 画板

## 范围
- `styles.css` 顶部定义 spec §3 的全部 token；删除旧绿色主题色值，现有页面先换成新 token，不改布局。
- 打包 Nunito 700/800/900 woff2 到 renderer 资源目录，`@font-face` 本地引用；附 OFL 许可证；确认 CSP 不需要放宽。
- 基础组件类：主按钮 / 次按钮 / ghost 按钮、chip、分段控件、搜索框、`:focus-visible` 样式。
- `src/renderer/shapes.ts`：饼干形 path、波浪 path、水位顶边 path 生成函数，参数相同结果缓存。
- `prefers-reduced-motion` 全局规则。

## 验收
- 现有功能全部可用，页面已是深色新配色和新字体。
- shapes 函数有单元测试（同参数输出稳定、端点坐标正确）。
- `npm run typecheck`、`npm test`、`npm run test:window`、`npm run package`、`npm run verify:package` 通过；记录字体带来的包体变化。
