# Local library execution

Approved: 2026-10-31. Integration: codex/local-library-integration, baseline 1dea6ea. User authorized splitting and starting implementation with visible gpt-5.6-luna / max implementers. Existing GitHub tracker: ianho7/z-video. Keep previous migration PR #21 separate.

DAG: 01 -> {02,03} -> 04 -> 05. Approved spec: docs/local-library/spec.md. This supersedes old NAS-first product restrictions, not privacy/source-read-only/native-playback boundaries. Test seams approved as part of the plan: real filesystem/local DB owner, isolated Electron UI/IPC, real native playback with fresh-process persistence, package delivery. TDD/test-audit required; no repeated valid checks or private media scan.

Each implementer uses its own codex/local-* branch and .worktrees/local-* checkout from integration, merges latest integration before completion, commits source and a completion note. Use root node_modules read-only via a scoped junction or mapped compilation; avoid duplicate installs. Schema/contracts belong to ticket01 and subsequent changes coordinate through integration. Dedicated merger integrates each ticket; after all tickets run separate Standards/Spec reviews and fix findings through one implementer. Cleanup only task-created clean/merged worktrees after preserving artifacts.

All GUI checks use isolated profiles, bounded owned-child lifetimes and regular-file logs (avoid prior EPIPE console pipe incident). Never run installed official client/NAS write operations or scan private shares. Use owned local fixtures; actual read-only personal/share validation remains a separately scoped acceptance task. Do not claim it passed from synthetic tests.

Source paths in renderer remain opaque. No ZSpace login/session/API at default startup. Keep old encrypted sessions untouched. Default media access is read-only. No global Rust/cache/old-worktree cleanup. Windows first, no macOS or overlay parity claims. Package size/resource measurements must be factual.

Ticket 01 handoff contract: `docs/local-library/contracts.md` and `src/shared/local-library-contracts.ts` are the source of truth for schema v1, `local-library:*` IPC, opaque `media_<UUID>` identity, and `LocalPlaybackState`/`LocalPlaybackTarget`. Ticket 02 and 03 must coordinate changes through integration rather than redefining these fields independently.
