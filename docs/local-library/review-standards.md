# Standards review

固定基线：`1dea6ea`；冻结 tip：`9b7420c`；审查范围：`git diff 1dea6ea...9b7420c`（67 个文件，非空；tip 包含 9 个后续提交）。结论：**CHANGES_REQUIRED**。

## Findings

1. **[P1] 本地根边界只做词法检查，不能阻止 reparse/symlink 逃逸。** `pathWithin` 仅对 `resolve/relative` 结果做字符串判断（`src/main/local-library-worker.ts:256-260`）；`resolveArtwork`/`resolvePath` 随后直接返回路径（`src/main/local-library-worker.ts:773-800`），没有 canonical `realpath` 或逐级 reparse 检查。索引后的普通文件被替换为 junction/symlink 时，播放或 artwork 读取可越过所选根，违反 `docs/local-library/spec.md:39` 与 `docs/local-library/contracts.md:36` 的 root-boundary 规则。

2. **[P1] renderer-visible source label 可能泄露绝对路径。** `ensureSource` 在 drive root 等 `basename(root)` 为空时回退到完整 `root`（`src/main/local-library-worker.ts:263-274`），随后由 `sourceSummaries` 放进 `LocalLibraryState.sources`（`603-618`）并通过 IPC 发送。该 DTO 违反 `AGENTS.md:39`、`docs/local-library/contracts.md:24,30` 的 safe-label/path privacy 约束。

3. **[P1] 原始 filesystem/SQLite 异常文本未经脱敏进入 renderer。** worker 直接转发 `error.message`（`src/main/local-library-worker.ts:104,208,1072-1080`），database 又把它放入 `state.error.message`/reject（`src/main/local-library-database.ts:119-129,270-276`）；renderer 直接显示该文本（`src/renderer/renderer.ts:320-322,437-439,460-462`）。系统错误可能包含 DB/source 绝对路径，违反同一 DTO 隐私边界；应在 owner 边界映射为稳定、无路径的消息。

4. **[P1] 512 MiB artwork disk cap 非并发安全。** `withReadSlot` 允许四个 load 同时进入（`src/main/local-artwork-cache.ts:73-85`），但 `writeDisk` 与 `evictDisk` 并未串行化（`105-134`）；并发 eviction 对同一文件即使 `unlink` 失败仍递减 `diskBytes`（`131-133`），可低估占用并让实际目录超过上限。违反 `docs/local-library/spec.md:41` 与 `docs/local-library/completions/04.md:13` 的 bounded-cache 规则。

已复用既有 completion 01–05、C: regular-copy package `503,138,932` bytes/231 files/0 links 与 `verify:package` PASS 证据；未重跑有效 checks、build、GUI、NAS 或网络验证。
