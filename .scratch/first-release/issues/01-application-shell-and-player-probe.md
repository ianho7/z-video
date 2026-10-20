# 01: 基础工程骨架与 Slint 原生播放引擎嵌入探针

**What to build:** 建立客户端的基础应用骨架与桌面窗口，并探通候选播放引擎（优先 libmpv）与 Slint 窗口的底层集成机制。加载本地测试视频文件，验证在 Windows 平台下原生视频可以在 Slint 窗口中正常渲染画面、响应基础暂停/继续操作，确保窗口不黑屏且 UI 交互线程非阻塞。

**Blocked by:** None (can start immediately)

**Status:** partially complete; playback remains pending

- [x] 初始化应用主工程结构与 Windows 平台构建配置
- [x] 成功创建 Slint 主窗口，并取得 Windows Skia shell fixture 证据
- [ ] 完成原生播放引擎（libmpv）与 Slint 窗口表面的底层嵌入
- [ ] 加载并播放本地样本视频，验证画面、音频和窗口稳定性
- [ ] 在播放期间验证 UI 线程响应及播放/暂停操作
- [x] 记录当前 Windows Skia 候选的依赖版本、构建来源及验证边界

---

## Windows 下播放引擎集成报告

### 1. 依赖版本与构建来源

| 关键组件 | 版本 / Commit | 来源 / 下载地址 | 说明 |
|---|---|---|---|
| libmpv | 2.6 (API 0x20006) | [shinchiro/mpv-winbuild-cmake (20261016)](https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261016/mpv-dev-x86_64-20261016-git-a2cd83c56d.7z) | 官方 Windows x86_64 预编译开发包，解压提取 `libmpv-2.dll` 与头文件 |
| Slint | git rev `0ade85bfd0a88b6de2f87f767420975f98c141d0` (`1.19.0-dev`) | upstream git `slint` | Windows 使用 `backend-winit`、`renderer-skia`、`accessibility`；跨平台运行尚未验证 |
| raw-window-handle | 0.6.2 | crates.io | 提供平台原生窗口句柄桥接 |
| windows-sys | 0.59 | crates.io | 提供 Win32 HWND 子窗口管理与消息处理 |

> `libmpv` 2.6 行和下面的窗口嵌入条目保留自早期候选调查，作为历史上下文；当前分支没有对应的播放运行证据，不能把它们视为已完成集成。

### 2. 历史候选架构（待后续验收）

- **候选宿主与子窗口分离**：
  - Slint 主窗口负责声明式 UI（标题栏、控制栏、播放进度条、心跳指示器与响应式布局）。
  - 在 Windows 平台下，当 Slint 窗口渲染完成首帧后，Rust 协调层从 `WindowHandle` 提取 Win32 宿主 `HWND`。
  - 创建 Win32 子窗口（`WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN`），窗口过程处理 `WM_ERASEBKGND` 返回 1，消除由于重绘背景导致的画面闪烁与黑屏。
  - Slint UI 的 `video_container` 暴露几何坐标（x, y, width, height），Rust 定时器与事件协调层根据 DPI scale factor 实时同步 Win32 子窗口位置与大小。
- **候选 Direct3D 11 原生硬件加速**：
  - libmpv 配置参数：`vo=gpu`, `gpu-api=d3d11`, `hwdec=auto-safe`, `keep-open=yes`, `wid=<child_hwnd>`。
  - mpv 媒体数据直接交给原生 D3D11 渲染管线与交换链，完全零 CPU 逐帧拷贝，且不干扰 Slint 的 FemtoVG / Skia 绘图上下文。
- **候选非阻塞事件与状态管理**：
  - 候选设计让 mpv 运行在后台独立线程（`mpv-event-loop`），通过 `mpv_wait_event` 轮询属性与事件（`time-pos`, `duration`, `pause`, `eof-reached`）。
  - 候选状态机统一为 `PlaybackState`: `Idle`, `Playing`, `Paused`, `Stopped`。
  - 候选实现采用 `slint::invoke_from_event_loop` 将播放事件与时间戳派发至 UI 线程；当前分支尚未用真实播放证据验证非阻塞和 60fps 行为。

### 3. 当前验证结果与待后续项

- **已验证**：Windows 原生 Slint shell、Skia renderer、侧栏/工具栏 blur 及低透明度回退 fixture；证据见 `docs/design/evidence/ticket-09/README.md`。
- **未验证/待后续**：libmpv 或其他播放引擎与 Slint 视频表面嵌入、本地样本播放、暂停/继续、音频输出、播放期间 UI 响应和真实视频性能。
- 早期材料中列出的 `assets/test_video.mp4`、libmpv 动态加载和播放测试结果没有与当前分支匹配的运行回执，因此不作为本次完成证据。
