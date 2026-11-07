# Ticket 07 · 播放器与下一集

- 控制条保留原进度滑块、快捷键和播放命令，加入波浪进度、前后 10 秒、下一集及设置面板。
- 播放结束后依据当前详情的剧集顺序提供 10 秒自动播放、立即播放、取消和返回；关闭播放器清除倒计时。
- 验证：`npm run typecheck`、`npm test`（69/69）、`npm run test:window`、`npm run test:local-library-app` 通过。窗口测试使用隔离资料和三集本地 fixture，模拟播放结束事件，验证取消、立即播放和倒计时切集。
- 仍需 Windows 实机截图及真实媒体播放验收；macOS 外观和播放未验证。
