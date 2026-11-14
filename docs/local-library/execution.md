# Local library execution

Approved: 2026-10-31. Integration: codex/local-library-integration, baseline 1dea6ea. User authorized splitting and starting implementation with visible gpt-5.6-luna / max implementers. Existing GitHub tracker: ianho7/z-video. Keep previous migration PR #21 separate.

DAG: 01 -> {02,03} -> 04 -> 05. Approved spec: docs/local-library/spec.md. This supersedes old NAS-first product restrictions, not privacy/source-read-only/native-playback boundaries. Test seams approved as part of the plan: real filesystem/local DB owner, isolated Electron UI/IPC, real native playback with fresh-process persistence, package delivery. TDD/test-audit required; no repeated valid checks or private media scan.

Each implementer uses its own codex/local-* branch and .worktrees/local-* checkout from integration, merges latest integration before completion, commits source and a completion note. Use root node_modules read-only via a scoped junction or mapped compilation; avoid duplicate installs. Schema/contracts belong to ticket01 and subsequent changes coordinate through integration. Dedicated merger integrates each ticket; after all tickets run separate Standards/Spec reviews and fix findings through one implementer. Cleanup only task-created clean/merged worktrees after preserving artifacts.

All GUI checks use isolated profiles, bounded owned-child lifetimes and regular-file logs (avoid prior EPIPE console pipe incident). Never run installed official client/NAS write operations or scan private shares. Use owned local fixtures; actual read-only personal/share validation remains a separately scoped acceptance task. Do not claim it passed from synthetic tests.

Source paths in renderer remain opaque. No ZSpace login/session/API at default startup. Keep old encrypted sessions untouched. Default media access is read-only. No global Rust/cache/old-worktree cleanup. Windows first, no macOS or overlay parity claims. Package size/resource measurements must be factual.

Ticket 01 handoff contract: `docs/local-library/contracts.md` and `src/shared/local-library-contracts.ts` are the source of truth for schema v1, `local-library:*` IPC, opaque `media_<UUID>` identity, and `LocalPlaybackState`/`LocalPlaybackTarget`. Ticket 02 and 03 must coordinate changes through integration rather than redefining these fields independently.

## Published tracker

Parent spec: https://github.com/ianho7/z-video/issues/22 . Tickets: 01/#23, 02/#24, 03/#25, 04/#26, 05/#27. Dependency graph: #23 -> {#24,#25} -> #26 -> #27. First implementer: visible local_foundation, gpt-5.6-luna/max, worktree .worktrees/local-01. The API EOF during issue creation was reconciled with a read-only remote inventory before retry; no duplicate issue was created.

Draft PR: https://github.com/ianho7/z-video/pull/28 (base codex/electron-integration). Ticket01 merged at 4cae8fe. Tickets02/03 are running in .worktrees/local-02 and .worktrees/local-03. Metadata implementer owns shared database/worker files; playback implementer requests persistence operations rather than editing the same owner concurrently. Native GitHub sub-issue and blocked-by relationships are recorded. Coordinator rechecked the prior environment-blocked legacy owners with proper loopback/temp permissions: 21/21 pass; details in completions/01.md.

## Final local-library candidate (2026-10-31)

Implementation and review repairs complete at 8a2b104; both independent review axes PASS. Final C-drive ordinary-file package contains 233 files / 503,148,872 bytes with zero reparse points and passes production renderer/SQLite/native/XML checks. Exact executable and evidence: docs/local-library/final-delivery.md. Native two-process local resume and owned scale/offline proofs are reused; no private/share/macOS/hardware/overlay claim is added. Final default-runner legacy fixture flake is recorded truthfully rather than marked all-pass.

All six task-created worktrees (local-01 through local-05 and local-review-fixes) have now been removed after ancestry/clean-or-known-preserved-evidence checks. Windows long-path cleanup was confined to the same verified task directory. Root dependencies, branches/commits, independent C package and preserved logs remain. Final D free space observed: 443,228,160 bytes; no unrelated cache/toolchain/worktree was deleted.

## 状态机修复批次（2026-11-14）

审计与决策：`docs/local-library/state-machines.md`（37 处隐式状态机、危险组合、死状态、决策记录）。
本批次不删除遗留 NAS 路径，不为并行开新 worktree；按波次在单一工作树内顺序实施。

DAG：

```text
Wave 1: 06, 07, 09, 12, 13, 14
Wave 2: 08 (after 07), 10 (after 09)
Wave 3: 11 (after 08)
Wave 4: 15 (after 11, 12)
随时:   16 (纯标注，不碰运行时)
```

- 06 playback-terminal：`closed` 单一出口、failed 收敛、伪 ended、关闭兜底。
- 07 scan-index-safety：索引失败不删账本、取消终局、import 不覆盖 NFO、`scan_runs` 可读。
- 08 source-degraded：schema v4 `sources.degraded`，partial 不再等同离线；扫描面板收尾。
- 09 playback-preferences：轨道 latch 修正 + 字幕 `"off"` 哨兵。
- 10 viewing-accounting：重播/加载失败/完成计数口径统一。
- 11 library-list-visibility：墓碑不进列表，`episodeCount` 改可用口径。
- 12 search-pagination：`searchPage` 生效，复用分页控件。
- 13 worker-lifecycle：崩溃态可见可恢复、`call()` 超时、封面缓存可重试。
- 14 cleanup-keep-terminal：`keep` 改终态；检查模式与错误分支一致。
- 15 renderer-state-consolidation：单一视图状态、epoch 拆分、错误恢复派生。
- 16 legacy-deprecation：标注 deprecated 并输出清单，不删除。

每张 Ticket 完成后需：跑该 Ticket 的验证命令 → 独立复核 → 在完成后记录中列出被修改的既有断言（旧值/新值/理由）→ 区分"单测已证"与"待真实窗口/真实媒体验证"。
