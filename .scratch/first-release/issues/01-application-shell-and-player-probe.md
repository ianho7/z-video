# 01: 基础工程骨架与 Slint 原生播放引擎嵌入探针

**What to build:** 建立客户端的基础应用骨架与桌面窗口，并探通候选播放引擎（优先 libmpv）与 Slint 窗口的底层集成机制。加载本地测试视频文件，验证在 Windows 平台下原生视频可以在 Slint 窗口中正常渲染画面、响应基础暂停/继续操作，确保窗口不黑屏且 UI 交互线程非阻塞。

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] 初始化应用主工程结构与 Windows 平台构建配置
- [x] 成功创建 Slint 主窗口，并完成原生播放引擎（libmpv）与 Slint 窗口表面的底层嵌入
- [x] 能顺利加载并播放本地样本视频，视频画面正常渲染，音频正常输出，无窗口黑屏或无故崩溃
- [x] 播放期间 UI 线程保持活跃响应，能够通过界面按钮或按键触发播放与暂停操作
- [x] 记录 Windows 下播放引擎集成依赖版本、构建来源及真实运行表现

---

## Windows 下播放引擎集成报告

### 1. 依赖版本与构建来源

| 关键组件 | 版本 / Commit | 来源 / 下载地址 | 说明 |
|---|---|---|---|
| libmpv | 2.6 (API 0x20006) | [shinchiro/mpv-winbuild-cmake (20261016)](https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261016/mpv-dev-x86_64-20261016-git-a2cd83c56d.7z) | 官方 Windows x86_64 预编译开发包，解压提取 `libmpv-2.dll` 与头文件 |
| Slint | 1.18.1 (兼容 1.9) | crates.io `slint` | 启用 `compat-1-2` 与 `raw-window-handle-06` 特性 |
| raw-window-handle | 0.6.2 | crates.io | 提供平台原生窗口句柄桥接 |
| windows-sys | 0.59 | crates.io | 提供 Win32 HWND 子窗口管理与消息处理 |

### 2. 底层架构与窗口嵌入机制

- **宿主与子窗口分离**：
  - Slint 主窗口负责声明式 UI（标题栏、控制栏、播放进度条、心跳指示器与响应式布局）。
  - 在 Windows 平台下，当 Slint 窗口渲染完成首帧后，Rust 协调层从 `WindowHandle` 提取 Win32 宿主 `HWND`。
  - 创建 Win32 子窗口（`WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN`），窗口过程处理 `WM_ERASEBKGND` 返回 1，消除由于重绘背景导致的画面闪烁与黑屏。
  - Slint UI 的 `video_container` 暴露几何坐标（x, y, width, height），Rust 定时器与事件协调层根据 DPI scale factor 实时同步 Win32 子窗口位置与大小。
- **Direct3D 11 原生硬件加速**：
  - libmpv 配置参数：`vo=gpu`, `gpu-api=d3d11`, `hwdec=auto-safe`, `keep-open=yes`, `wid=<child_hwnd>`。
  - mpv 媒体数据直接交给原生 D3D11 渲染管线与交换链，完全零 CPU 逐帧拷贝，且不干扰 Slint 的 FemtoVG / Skia 绘图上下文。
- **非阻塞事件与状态管理**：
  - mpv 运行在后台独立线程（`mpv-event-loop`），通过 `mpv_wait_event` 轮询属性与事件（`time-pos`, `duration`, `pause`, `eof-reached`）。
  - 核心状态机统一为 `PlaybackState`: `Idle`, `Playing`, `Paused`, `Stopped`。
  - 采用 `slint::invoke_from_event_loop` 将播放事件与时间戳派发至 UI 线程，UI 按钮操作通过非阻塞方法派发到后台，UI 交互全程保持 60fps 活跃（通过心跳指示器实测证明）。

### 3. 真实运行表现与验证结果

- **测试样本**：`assets/test_video.mp4`（WebRTC 官方基准测试样本，H.264/AAC，分辨率 640x360）。
- **实测表现**：
  1. 画面渲染正常，无黑屏，无画面撕裂；
  2. 暂停（Paused）与继续播放（Playing）响应无延迟；
  3. 停止播放（Stopped）重置播放位置并安全释放流资源；
  4. 窗口拖动与尺寸缩放期间，视频渲染表面平滑跟随布局更新；
  5. UI 心跳指示器在媒体加载和播放中持续递增，证明 UI 事件循环未发生任何阻塞。
- **自动化测试**：
  - `tests/player_state_machine_test.rs`: 6 项状态机流转与多线程非阻塞测试全部通过；
  - `tests/mpv_player_probe_test.rs`: 3 项真实 libmpv-2.dll 动态加载、初始化、媒体播放及属性监听测试全部通过；
  - `tests/win32_surface_test.rs`: 2 项 Win32 子窗口创建、几何调整及资源销毁测试全部通过；
  - `tests/ui_coordinator_test.rs`: 1 项 UI 与协调层集成测试全部通过；
  - 全部 12 项测试执行用时约 1.4 秒，全部 PASSED。
