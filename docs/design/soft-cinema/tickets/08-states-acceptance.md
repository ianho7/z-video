# 08 · 状态收口与整体验收

ID: 08-states-acceptance
Depends: 04, 05, 07
原型：States 及全部 D2 画板

## 范围
- 片库错误卡（`state.status="error"` + `error.code`，只有“重试”）。
- 全局走查：token 是否统一、旧样式残留清理、焦点样式、44px 目标、对比度。
- 删除不再使用的旧 CSS（`library.css` 中仅 NAS 回滚路径使用的部分保持不动）。

## 验收
- `npm run typecheck`、`npm test`、`npm run test:window`、`npm run test:local-library-app`、`npm run test:appearance-window`、`npm run package`、`npm run verify:package`。
- Windows 实机截图：首页、全部、来源、扫描、详情（剧集/电影离线）、播放器、菜单、接下一集、首次启动、错误态。
- macOS 外观标记为待验收；真实媒体/硬解/DWM 不在本次证明范围内。
