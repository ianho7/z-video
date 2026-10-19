# z-video Apple Minimal UI 高保真原型

这是 z-video 的独立 HTML/CSS/JavaScript 高保真设计验证工具。它沿用 `prototype/apple-minimal/` 已确认的页面关系，把低保真灰阶占位替换为 Windows first 桌面端可操作的 Apple/HIG 风格视觉方向。它不属于最终 Rust + Slint 实现，也不连接真实 NAS、播放引擎或账户。

## 设计 thesis

片库的单一任务是“快速找到下一部要看的内容”。界面用稳定的浏览画布承载搜索、筛选、继续观看和海报集合；详情页在同一窗口替换主内容，返回时恢复来源上下文。签名元素是“安静的蓝色进度线”：它只表示当前选择、键盘焦点和有效观看进度，其他内容保持中性。

## 视觉 tokens

页面以深色为默认预览主题，使用语义 token；保留 `data-theme="light"` 的浅色 token 供设计对照。正文使用 `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`，正文 13–15px，辅助信息 11–12px，页面标题 26–32px，详情标题最高 38px；文本允许自然换行。

| 角色 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `surface` | `#FFFFFF` | `#18191C` | 工具栏、卡片、详情内容 |
| `canvas` | `#F5F5F7` | `#101113` | 主滚动画布 |
| `sidebar-surface` | `rgba(247,247,249,.78)` | `rgba(24,25,28,.78)` | 侧边栏功能层 |
| `text` | `#1D1D1F` | `#F5F5F7` | 主标题和正文 |
| `secondary` | `#6E6E73` | `#B6B7BD` | 辅助说明和元数据 |
| `separator` | `#D2D2D7` | `#36383E` | 分隔线和边界 |
| `accent` | `#0066CC` | `#5AA7FF` | 选择、焦点、播放、进度 |

磨砂玻璃只用于侧边栏和顶部工具栏这两个功能层：`backdrop-filter: blur(...) saturate(...)` 配合半透明暗色底和细边框。海报墙、继续观看卡片、空状态和详情内容都保持实色，避免功能层叠加到内容卡片上。`prefers-reduced-transparency`、高对比模式和不支持 `backdrop-filter` 时切换为不透明回退；`prefers-reduced-motion` 下保持静态。

内容层不使用渐变、重阴影、玻璃材质、霓虹色或大型胶囊容器；功能层只在侧边栏和顶部工具栏保留克制磨砂，并提供不透明回退。圆角控制在 8–12px，层级由表面、分隔线、间距和文字权重承担。图标是少量带 `aria-hidden` 的内联 SVG，语义始终由文字或 `aria-label` 同时表达；不使用 Apple logo、SF Symbols 素材或 macOS 窗口控制。

## 三种 URL 状态

- `?state=library`：220px 左右侧边栏、轻量工具栏、继续观看横向行、最近添加/片库海报网格。默认 1440×900 视口使用约 7 列海报。
- `?state=search&q=雨`：工具栏搜索、类型筛选、结果计数、排序、结果网格和清空入口；没有匹配项时显示可读空结果状态。
- `?state=detail&id=city-after-rain&from=...`：同一窗口的独立详情页，包含海报、标题/年份/类型、唯一主播放操作、有效进度下才出现的“继续播放”、选集、简介、演员/导演/音轨/字幕占位。`from` 保存搜索词、筛选、排序和滚动位置。

点击海报、浏览器后退、详情页返回按钮和 `Esc` 都能回到来源状态。`Ctrl/Cmd+K` 聚焦搜索；搜索框按 Enter 提交；侧边栏按钮可以隐藏/显示；类型和排序会更新模拟数据。

## 与已确认低保真线框的映射

| 低保真结构 | 高保真实现 |
| --- | --- |
| 侧边栏约 220px，最多两级 | `sidebar` + “片库/浏览”两组入口，工具栏按钮可隐藏 |
| 轻量工具栏 | 当前上下文标题、搜索字段和筛选按钮；不放窗口控制 |
| 继续观看横向行 | `continue-row` 横向滚动的紧凑条目，使用约 16:9 横向缩略图 + 右侧标题、进度和元信息；蓝色进度线只在有进度时出现 |
| 约 7 列海报网格 | 1440px 左右使用 `repeat(7, minmax(0, 1fr))`，窄窗口逐级收缩 |
| 海报点击进入独立详情 | URL 进入 `state=detail`，主内容替换为详情布局 |
| 返回恢复上下文 | `from` 参数 + 当前历史项的滚动位置，支持按钮、后退和 Esc |
| 灰阶占位 | 本地虚构片名与 `../assets/` 景物图片；加载失败显示“封面暂不可用” |

## Apple/HIG 适配边界

实现借用了 Apple references 中关于 accessibility、layout、typography、color、designing-for-macos、cross-platform、sidebars、toolbars、split-views、collections、searching、windows 和 focus-and-selection 的结构原则：清晰的 leading sidebar、少量 toolbar actions、集合网格、可隐藏侧边栏、单一主操作、可见键盘焦点、语义颜色和明暗外观。

这是 Windows first 的网页原型。最终 Slint 窗口应交给 Windows/macOS 系统处理窗口边框、标题栏和窗口按钮；本目录不绘制 macOS 红黄绿控制，也不把 CSS 视觉验证当作 Slint 或原生播放通过证据。Apple/HIG 在这里是系统级简洁、层级和可达性的设计参考，不是 macOS 品牌复刻。它仍然只是 HTML 验证原型。

## 运行

直接打开 [index.html](./index.html)，或从仓库根目录启动任意本地静态文件服务器后访问：

```powershell
cd D:\project\z-video
py -m http.server 4173
```

然后打开 `prototype/apple-minimal-ui/index.html?state=library`。搜索示例为 `prototype/apple-minimal-ui/index.html?state=search&q=雨`；详情示例可先从卡片点击进入，以便自动生成正确的 `from` 上下文。

## 素材与边界

影片标题、演员、导演、简介、评分和进度都是虚构的设计验证数据。图片只引用仓库已有的 `prototype/assets/*.jpg`，没有联网、下载或复制大文件。没有自动播放、复杂动画或真实接口调用；播放按钮只发送原型内的状态提示。

## 验证记录

- `node --check prototype\\apple-minimal-ui\\app.js`：通过。
- 本地资源引用检查：通过，`../assets/` 中的引用均存在。
- 暗色默认与层级检查：通过；`state=library` 使用深色 token，磨砂只出现在侧边栏和顶部工具栏，继续观看使用紧凑横向缩略图条目。
- 静态约束检查：通过；未发现远程资源、渐变或重阴影，磨砂仅限侧边栏和顶部工具栏且有不透明回退，HTML/CSS/JS 入口齐全，`git diff --check` 通过。
- 浏览器三状态视觉复查：主智能体已在桌面浏览器中复查 `library`、`search`、`detail`，并验证继续观看卡片可跳转详情。
