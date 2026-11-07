# 05 · 来源管理、扫描面板、首次启动

ID: 05-sources
Depends: 03
原型：Sources、ScanPanel、Onboarding

## 范围
- 来源管理独立页面：每个来源一张卡（条目数大字、可用/扫描中/部分完成/离线状态 chip、重新扫描/取消扫描、移除）；“添加文件夹”“打开单个视频”。
- 移除确认改为页面内对话框（替换 `window.confirm`），焦点锁定在对话框内，Esc 取消；文案保留“不删除源文件”。
- 扫描面板：进行中用水位卡（scanned/imported/updated/warning 计数、取消）；结束后按 `status` 显示完成/部分完成/已取消/不可用，列出 `warnings`（原文已脱敏，renderer 不再拼接路径）。
- 首次启动：无来源且无条目时显示 Onboarding，两个入口。
- 不做：上次扫描时间（无字段）。

## 验收
- 移除后 `source-list` 与片库同步刷新；对话框可纯键盘完成。
- 扫描五种 status 都有对应展示。
- `#source-list`、`#scan-status`、`#choose-folder-button` 保留或同步更新 smoke。
- `npm run typecheck`、`npm test`、`npm run test:window`、`npm run test:local-library-app`。
