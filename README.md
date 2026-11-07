# z-video

面向 Windows/macOS 的极空间影视客户端。当前默认桌面实现是 **Electron 45 + TypeScript**；旧的 Slint/Rust 实现保留在 Git 历史中作为回滚与协议参考。关注片库浏览、详情、选集、续播和原生播放体验，同时分别测量运行资源与磁盘占用。

当前阶段：Electron 主进程、隔离 preload、renderer、本地片库/续播和 Windows libmpv 路径已实现；默认启动是 account-free local library，旧 NAS 路径仅保留作 rollback/reference。Windows candidate package 与 fresh-process 证据由 Ticket 05 维护。真实 NAS、硬解、DWM 实际画面、macOS 和公开分发仍未验收。

当前 local-library 首版范围已确认：本地磁盘/OS 可读 share、只读索引与 NFO/artwork、本地观看进度、基础播放、Windows 先交付、先个人自用。NAS 登录/同步是旧 rollback 范围；macOS、远程访问、高级影音能力及插件运行时后置，详见 [本地片库 Spec](docs/local-library/spec.md)。

## 开发入口

当前首选入口不需要 Rust/Cargo：

```powershell
npm install
npm run start                 # build + Electron 开发运行
npm run build                 # TypeScript + renderer assets
npm run package               # 手工 Windows x64 candidate folder
npm run verify:package        # 隔离 cwd 的包内 EXE/Koffi/libmpv smoke
npm run measure:windows       # 开发依赖、candidate 总量和 idle working-set
npm run test:local-library-scale # owned 2,000/20,000 项扫描、并发查询和 offline smoke
npm run test:safe-storage-process  # 两个 Electron 进程 + 本地 HTTP fixture
```

candidate 输出默认位于 `.scratch/local-library/package/z-video-win32-x64/`；不会读取普通用户会话，也不会连接私有 NAS。包生成器现在只允许同卷 hard link 或普通文件 copy，禁止 symlink/junction 回退；本机 D: 仅余约 33 MB 时，默认目标的完整 regular-copy 会明确以 `ENOSPC` 失败。最终独立 regular-copy candidate 位于授权 C: 路径 `C:\Users\admin\.codex\visualizations\2026\10\30\01a18d67-6765-7dc0-8bd1-47ac85ca8f26\local-library-package\z-video-win32-x64\`：503,138,932 bytes、231 files、0 个 reparse points；最新 idle packaged process working set 为 149,057,536 bytes。包清单会记录 Electron/Koffi/libmpv/XML 依赖闭包、文件数、字节数和 DLL SHA-256；libmpv 的公开再分发许可证来源尚未确认，因此该目录是个人使用验证候选，不是签名或公开发布包。2,000/20,000 项 owned scale 证据见 `.scratch/local-library/runs/scale-1793452793624-11380/`。

已确认的首版需求、用户故事及验收边界见 [首版 Spec](docs/spec.md)；迁移范围和未通过项见 [Electron migration spec](docs/electron-migration-spec.md)。

1. 接手项目：读 [开发交接](docs/handoff.md)。
2. 理解当前架构：读 [架构与范围](docs/architecture.md) 和 [Electron/TypeScript ADR](docs/adr/0003-electron-typescript.md)。
3. 设计刮削扩展：读 [元数据扩展契约](docs/metadata-extension.md)。
4. 接入极空间：读 [逆向资料索引](reference/README.md)。
5. 开发规则及领域词汇：见 [AGENTS.md](AGENTS.md) 和 [GLOSSARY.md](GLOSSARY.md)。

第一项工作是明确独立连接 NAS、获取播放流的路径，并验证 Electron/native libmpv 与原生视频画面/控制层的集成。官方客户端播放成功不等于替代客户端已能独立播放。
