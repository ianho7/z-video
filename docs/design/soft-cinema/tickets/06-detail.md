# 06 · 详情页（剧集 / 电影 / 离线）

ID: 06-detail
Depends: 02
原型：Detail、MovieDetail

## 范围
- 头部用动态色调：`--tone-deep` 底、类型 chip、评分饼干、主按钮“继续 E04 · 剩 N 分”或“播放”，次按钮“从头播放”。
- 剧情简介最多 3 行可展开；无 plot 显示“暂无简介”和补 NFO/海报的提示。
- 剧集：季切换分段控件（仅多季时出现）；集行含截图位、40px 集号、标题、时长；已看集号变暗 + 对勾饼干；当前集用动态色高亮并显示波浪进度。
- 电影：无剧集区，改为文件信息卡（大小、修改时间、来源、观看进度）。
- `available=false`：顶部黄色横幅 + 播放按钮禁用，横幅链接到来源管理。

## 验收
- 详情与当前 `LocalMediaDetail` 字段一一对应，不新增字段。
- 返回片库恢复之前的位置和焦点。
- `#media-detail` 保留或同步更新 smoke。
- `npm run typecheck`、`npm test`、`npm run test:window`、`npm run test:local-library-app`。
