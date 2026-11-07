# 03 · 首页

- 增加顶部导航、搜索及添加菜单，保留来源管理入口；首页提供继续观看、最近添加和剧集片架，后两者每次最多请求 12 项。
- Hero 优先显示继续观看首项，否则显示最近添加首项；使用已有 fanart、播放和详情接口，参照 D2 画板加入大集号和波浪进度。
- `npm run typecheck`：通过。`npm test`：授权环境 69/69 通过；沙箱内本地回环及 Electron 下载失败。
- 新增窗口 smoke 交互断言；Windows 窗口检查、实机截图和 local-library-app 由集成阶段串行执行。macOS 未验收。
- UI 红灯未运行：窗口测试由集成阶段串行执行。
- Windows `npm run test:window`：通过；修复首页多个片架重复请求同一延迟海报导致封面队列阻塞。`test:local-library-app` 与截图仍由集成阶段执行。
- `npm run test:local-library-app`：通过。同步测试到首页／搜索导航；窄窗口播放器控件高度恢复为 native 要求的 152px。
