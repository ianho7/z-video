# 03 · 首页：顶部导航、hero、片架

ID: 03-home
Depends: 01, 02
原型：Home

## 范围
- 去掉左侧来源栏；顶部导航：Logo、首页/全部/电影/剧集、扫描状态小胶囊、搜索框、“+”菜单（添加文件夹、打开视频、管理来源）。
- hero：继续观看第一项，fanart 背景（无 fanart 用 `--tone-deep` 纯色），集号大字、波浪进度、继续/从头/详情。无继续观看时 hero 换成最近添加第一项或隐藏。
- 片架：继续观看、最近添加（`added_desc`）、剧集（`filter:"show"`），横向滚动，“查看全部”进入 04 的对应筛选。
- 电影/剧集 tab 进入 04 的对应筛选；全部 tab 进入 04。

## 验收
- 首页请求只用现有 `listContinueWatching` / `list` / `getArtwork`；片架各自限量，不加载完整片库。
- 扫描结束后首页按现有刷新逻辑更新。
- `#continue-section`、`#library-search-input`、`#scan-status`、`#choose-folder-button` 保留或同步更新 smoke。
- `npm run typecheck`、`npm test`、`npm run test:window`、`npm run test:local-library-app`。
