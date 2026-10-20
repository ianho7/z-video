# z-video HTML 片库原型

这是阶段二的独立界面原型，只使用 HTML、CSS、JavaScript 和 `assets/` 下的本地图片。页面中的片名、演员、年份、评分、分类和观看位置都是明确虚构的模拟数据；原型不会连接真实 NAS，不会保存凭据，不会播放真实媒体，也不会上报观看进度。

## 本地运行

在 PowerShell 中执行（使用本机已安装的 bundled Python，不需要安装运行时）：

```powershell
cd D:\project\z-video\prototype
& "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 4173
```

然后打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。也可以使用任意静态文件服务器；不需要 npm、Cargo 或其他依赖。直接双击 `index.html` 也能查看大部分布局，但使用本地 HTTP 服务器更接近浏览器的正常资源加载路径。

## 已覆盖的核心路径

- 左侧分类 → 紧凑海报墙 → 右侧详情；1440×900 下关闭详情约 7 列，打开 360px 详情栏后约 5 列。
- 详情中的演员按钮 → 演员作品 → 打开另一部影片 → Esc 关闭详情并返回当前浏览位置。
- `Ctrl K` 聚焦搜索框；搜索可以按片名或切换为演员模式，筛选和排序都标有原型语义。
- “我的收藏”只是只读列表；“继续观看”只展示 `progress > 0` 的两个模拟样本。
- 右上角“原型状态”可以演示加载中、空片库、请求失败和封面失败样本；封面失败会显示稳定占位，不影响其他卡片。
- “连接”入口是诚实的模拟登录/连接状态页；详情中的播放按钮进入模拟播放器，不载入媒体、不改变进度。

页面使用键盘焦点、可见的按钮语义、Esc 关闭详情、`loading="lazy"` 图片和 `prefers-reduced-motion` 兼容。它只用于确认产品结构、密度和操作路径，不证明 Slint 的渲染性能、原生播放器表面、NAS 协议或真实进度持久化。

## 视觉与边界

视觉使用暖白底、炭灰字、1px 浅灰边界、小圆角、低饱和点缀和系统字体；没有渐变、玻璃、重阴影、营销式 hero、大留白、滚动入场动画或 macOS 三色窗控。示例人物使用短的虚构中文姓名，不指向真实演员，也没有番号专用字段或入口。

正式应用仍以 Rust + Slint 为技术栈。本目录的 HTML/CSS/JS 不应直接当作 Slint 实现或真实 NAS 集成方案。

## 本地图片来源

图片下载自 Unsplash 的公开普通摄影页，全部为建筑、城市、自然或影院场景，没有裸露或性行为内容。下载日期：2026-10-19。运行时只读取本地副本，原始来源 URL 记录如下：

| 本地文件 | 来源 |
| --- | --- |
| `cover-courtyard.jpg` | https://images.unsplash.com/photo-1518005020951-eccb494ad742 |
| `cover-night-train.jpg` | https://images.unsplash.com/photo-1519681393784-d120267933ba |
| `cover-coast-road.jpg` | https://images.unsplash.com/photo-1500530855697-b586d89ba3ee |
| `cover-quiet-room.jpg` | https://images.unsplash.com/photo-1497366754035-f200968a6e72 |
| `cover-rain-window.jpg` | https://images.unsplash.com/photo-1518837695005-2083093ee35b |
| `cover-desert-line.jpg` | https://images.unsplash.com/photo-1500534623283-312aade485b7 |
| `cover-forest-signal.jpg` | https://images.unsplash.com/photo-1493246507139-91e8fad9978e |
| `cover-red-chair.jpg` | https://images.unsplash.com/photo-1489599849927-2ee91cede3ba |
| `cover-lake-house.jpg` | https://images.unsplash.com/photo-1500534314209-a25ddb2bd429 |
| `cover-city-after-rain.jpg` | https://images.unsplash.com/photo-1519501025264-65ba15a82390 |
| `cover-library-light.jpg` | https://images.unsplash.com/photo-1524995997946-a1c2e315a42f |
| `cover-mountain-signal.jpg` | https://images.unsplash.com/photo-1519681393784-d120267933ba |

`cover-missing-cover.jpg` 是故意不存在的路径，只用于演示图片失败占位，不是素材来源。
