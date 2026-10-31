# z-video

面向 Windows/macOS 的极空间影视客户端。当前默认桌面实现是 **Electron 45 + TypeScript**；旧的 Slint/Rust 实现保留在 Git 历史中作为回滚与协议参考。关注片库浏览、详情、选集、续播和原生播放体验，同时分别测量运行资源与磁盘占用。

当前阶段：Electron 主进程、隔离 preload、renderer、NAS 片库/续播和 Windows libmpv 路径已实现；Windows portable package 与 fresh-process safeStorage 证据由 Ticket 05 维护。真实 NAS、硬解、DWM 实际画面、macOS 和公开分发仍未验收。

首版范围已确认：局域网访问、使用 NAS 现有片库并同步观看进度、基础播放体验、Windows 先交付、先个人自用。macOS、远程访问、高级影音能力及插件运行时后置，详见 [首版范围决策](docs/adr/0002-first-release-scope.md)。

## 开发入口

当前首选入口不需要 Rust/Cargo：

```powershell
npm install
npm run start                 # build + Electron 开发运行
npm run build                 # TypeScript + renderer assets
npm run package               # 手工 Windows x64 portable folder
npm run verify:package        # 隔离 cwd 的包内 EXE/Koffi/libmpv smoke
npm run measure:windows       # 开发依赖、portable 总量和 idle working-set
npm run test:safe-storage-process  # 两个 Electron 进程 + 本地 HTTP fixture
```

portable 输出默认位于 `.scratch/electron-migration/05-package/z-video-win32-x64/`；不会读取普通用户会话，也不会连接私有 NAS。包清单会记录 Electron/Koffi/libmpv 版本、文件数、字节数和 DLL SHA-256。`npm run measure:windows` 的一次 Windows 记录为：node_modules 405,872,832 bytes、npm cache 491,439,771 bytes、portable 总目录 502,108,811 bytes、fresh idle packaged process working set 138,178,560 bytes；这些是分开的测量，不是节省承诺。libmpv 的公开再分发许可证来源尚未确认，因此该目录是个人使用验证包，不是签名或公开发布包。

已确认的首版需求、用户故事及验收边界见 [首版 Spec](docs/spec.md)；迁移范围和未通过项见 [Electron migration spec](docs/electron-migration-spec.md)。

1. 接手项目：读 [开发交接](docs/handoff.md)。
2. 理解当前架构：读 [架构与范围](docs/architecture.md) 和 [Electron/TypeScript ADR](docs/adr/0003-electron-typescript.md)。
3. 设计刮削扩展：读 [元数据扩展契约](docs/metadata-extension.md)。
4. 接入极空间：读 [逆向资料索引](reference/README.md)。
5. 开发规则及领域词汇：见 [AGENTS.md](AGENTS.md) 和 [GLOSSARY.md](GLOSSARY.md)。

第一项工作是明确独立连接 NAS、获取播放流的路径，并验证 Electron/native libmpv 与原生视频画面/控制层的集成。官方客户端播放成功不等于替代客户端已能独立播放。
