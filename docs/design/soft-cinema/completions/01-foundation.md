# 01 · 设计基础完成记录

- 基于 Ticket 01：加入深色设计变量、基础控件样式、焦点样式和减少动效规则；保留现有页面布局和 IPC 契约。
- Nunito Latin 可变 WOFF2 覆盖 700–900；本地资源 39,128 bytes，OFL 许可证 4,385 bytes。构建时复制到 renderer，现有 CSP `default-src 'self'` 无需放宽。实际包体变化待 package 对比。
- 新增饼干、波浪、水位路径函数及参数缓存；renderer 按 home、all、sources、detail、player 和 shared 提取页面渲染代码，原协调与事件逻辑保留。
- `npm run typecheck`：通过。
- `npm test`：67/67 通过。首次沙箱运行的 Electron 下载和本地 HTTP fixture 受网络限制；安装 Electron 后在允许本地 fixture 的环境重跑通过。
- `git diff --check`：通过。
- 集成分支串行验证：`npm run test:window`、`npm run package` 和 `npm run verify:package` 均通过；独立包大小为 503,248,965 bytes，包内确认含字体和许可证。未测同环境基线包，不能将总包体差异归因于字体。
- Windows 截图和 macOS 外观尚未验收。
