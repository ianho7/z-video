# 08 · 状态收口与整体验收

实现基线：`0a7c7b6`。本说明记录 Windows 隔离样本的证据，不将其视为真实媒体或跨平台验收。

## 完成内容

- 片库 `state.status="error"` 显示错误信息、错误代码和唯一的“重试”操作；窗口测试验证重试后错误卡消失。
- 来源离线时，电影详情的播放与从头播放均禁用。临时样本目录重命名并重新扫描后，窗口回归先发现从头播放仍可用，修复后通过。
- 对按钮、选择框、summary 和 range 控件设置至少 44 CSS 像素目标，调整筛选、排序、搜索清除和小窗口导航；移除未使用的部分来源侧栏样式及影响离线卡片文字对比度的透明度。
- 保留 [Windows fixture 截图与对比度记录](../evidence/windows-fixture/README.md)，包括首页、全部、来源、扫描、电影与剧集详情、离线电影、播放器与菜单、下一集、首次启动和错误态。

## 已执行检查

- `npm run typecheck` 通过；最终 `npm run package` 的构建步骤也执行了 TypeScript 编译。
- `npm test` 69 项通过；该次在后续离线禁用和尺寸收口之前执行，不能单独证明最终改动。
- `npm run test:window` 通过；该次在后续状态收口之前执行。
- `npm run test:local-library-app` 在离线播放修复后通过，使用隔离 profile、仓库自有视频/NFO 样本与 8,000 个空索引文件；错误和播放结束事件为模拟事件。此后仅删除未使用样式和离线卡片透明度。
- 最终 `npm run package` 与 `npm run verify:package` 通过，包大小 503,305,475 字节；验证覆盖打包资源、Koffi/libmpv/XML 探测及隔离 profile 的空片库查询。经用户授权，临时测试包已删除。
- `git diff --check` 通过；Git 提示测试文件下次写入时 LF 将转换为 CRLF。
- 规格审查后在 `9b0aaf0` 修复简介折叠、剧集波浪与饼干徽章、后续请求骨架；该版本 `npm run typecheck`、`npm test`（69/69）、`npm run test:local-library-app` 和集成分支 `npm run test:window` 均通过。此前打包证据不覆盖这次后续 renderer 变更。

## 未通过与证据边界

`npm run test:appearance-window` 失败：fixture 期待 renderer DOM 的 appearance dataset，但该标记在改版前基线 `3e52f99` 也不存在；同时 fixture 未注册 local-library state handler。main 仍按系统设置选择窗口材质，这些事实不证明高对比或低透明度的用户可见效果，外观回退仍需有效验证。

截图来自 Electron `capturePage`，不证明 native 视频画面或 DWM 合成；实际点击目标和所有动态状态的文字对比度未逐项实测。macOS 外观、真实媒体和共享目录、硬件解码与 DWM 画面均待单独验收。没有宣称完整跨平台验收。
