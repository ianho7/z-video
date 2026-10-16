# z-video

面向 Windows/macOS 的极空间影视客户端。GUI 已选 **Slint**，业务核心采用 **Rust**。关注片库浏览、详情、选集、续播和播放体验，同时限制运行资源与磁盘占用。

当前阶段：文档与逆向资料已准备，尚未初始化应用代码、依赖或构建环境。播放引擎优先评估 libmpv，尚未定案。

首版范围已确认：局域网访问、使用 NAS 现有片库并同步观看进度、基础播放体验、Windows 先交付、先个人自用。macOS、远程访问、高级影音能力及插件运行时后置，详见 [首版范围决策](docs/adr/0002-first-release-scope.md)。

## 开发入口

已确认的首版需求、用户故事及验收边界见 [首版 Spec](docs/spec.md)；对应 [GitHub Issue #1](https://github.com/ianho7/z-video/issues/1)，标签为 `ready-for-agent`。

1. 接手项目：读 [开发交接](docs/handoff.md)。
2. 理解设计：读 [架构与范围](docs/architecture.md) 和 [Slint/Rust 决策](docs/adr/0001-slint-rust.md)。
3. 设计刮削扩展：读 [元数据扩展契约](docs/metadata-extension.md)。
4. 接入极空间：读 [逆向资料索引](reference/README.md)。
5. 开发规则及领域词汇：见 [AGENTS.md](AGENTS.md) 和 [GLOSSARY.md](GLOSSARY.md)。

第一项工作是明确独立连接 NAS、获取播放流的路径，并验证 Slint 与原生视频画面/控制层的集成。官方客户端播放成功不等于替代客户端已能独立播放。
