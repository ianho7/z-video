# 07 · 播放器控制条、菜单、接下一集

ID: 07-player
Depends: 01, 06
原型：Player、PlayerMenus、PlayerEnded、States 卡 5/6

## 范围
- 浮动控制条：时间（tabular-nums）、波浪进度（SVG 叠在原 `#player-seek` range 上，range 继续负责交互与读屏）、−10/播放暂停/+10/下一集、音量与静音、设置摘要按钮、全屏。
- 设置弹层：音轨、字幕、加载外部字幕、倍速 8 档；替换原来两行 select，但沿用现有命令。
- 播完接下一集：收到 `state:"ended"` 且当前 detail 有下一集时显示 10 秒环形倒计时；立即播放 / 取消 / 返回剧集列表；没有下一集时只显示“已看完”和返回。
- 准备中与失败状态按原型样式。
- 现有快捷键（Space、←/→、↑/↓、M、F、Esc）保持不变。

## 验收
- 自动下一集通过现有 `localPlayback.open(mediaId)` 实现，不新增 IPC。
- 取消倒计时后不会再自动播放；播放器关闭时倒计时清除。
- `#player-*` 选择器保留或同步更新 `player-window-smoke`。
- `npm run typecheck`、`npm test`、`npm run test:window`；记录真实 native 播放仍需实机验收。
