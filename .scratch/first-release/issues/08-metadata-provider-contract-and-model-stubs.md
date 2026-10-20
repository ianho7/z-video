# 08: 刮削插件元数据契约与模型预留

**What to build:** 依据 `docs/metadata-extension.md`，在核心层抽象规范化的刮削扩展数据模型（`ScrapeRequest`、`MetadataCandidate` 等），明确定义未来插件提供者的输入输出契约与用户确认边界。编写完备的序列化/反序列化及契约版本测试，不引入外部运行时和伪实现。

**Blocked by:** 04: 影视详情展示与剧集选择

**Status:** implemented-contract-only

- [x] 核心层定义统一的 `ScrapeRequest`、`MetadataCandidate` 与 `MetadataDetails`，涵盖基础元数据与可选命名空间扩展字段
- [x] 数据结构与 NAS 原生 Collection/Episode 模型边界清晰解耦，保持可独立序列化（如 JSON）
- [x] 实现针对契约数据版本化、缺失字段容错、错误分类及取消语义的公共行为测试
- [x] 纯粹预留契约与领域模型，不引入 DLL、Wasm、脚本解释器等任何非必需的运行时机制

当前状态只覆盖数据契约和同步 trait；没有实际 provider、插件加载或运行时。
