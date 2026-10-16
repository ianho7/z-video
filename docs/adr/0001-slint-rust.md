# 使用 Slint GUI 与 Rust 业务核心

状态：accepted；2026-10-16。用户明确选择 Slint，并偏好 Rust/Go 等较少语言和开发依赖的实现，同时重视 Windows/macOS 的 GUI、原生播放及资源占用。

采用 Slint 声明式界面和 Rust 业务核心，接受 `.slint` 界面描述与 Rust 两种文件，而非承诺所有依赖均由纯 Rust 编写。相比此前讨论的 Flutter/Dart、Wails/Go＋Web UI、Tauri/Rust＋Web UI，本选择减少了对另一套应用语言或 Web 前端工具链的需求；代价是原生视频表面、控制层和平台行为需要直接集成验证。

此决策只确定 GUI 与业务语言。libmpv 仍为待验证候选，不由本 ADR 确定播放库、图形后端、安装体积或商业分发条件。
