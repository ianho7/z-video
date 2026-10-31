# Electron migration Spec follow-up

Commit reviewed: `cc2188cbd09acf9cb90f271c3b84e3c297a2ea62` on `codex/electron-review-fixes`, against source freeze `deae61a`. Verdict: **CHANGES_REQUIRED** for two residual Spec-axis navigation issues; the requested repair set is otherwise evidenced.

## Verified repairs

- **P1 path isolation fixed.** `src/main/nas-client.ts:306-323`, `src/main/library-controller.ts:124-161` and `src/main/player-host.ts:165-168` use an opaque handle and main-side matching. Satisfies “uses `episodeId`, not a private NAS `file_path`” (`docs/electron-migration-contracts.md:32-33`).
- **P1 account isolation fixed.** `src/main/ipc.ts:22-30`, `src/main/player-host.ts:103-154` and `src/main/session-controller.ts:203-216` close playback and reject stale session keys. Satisfies “associate correct Account/Collection/Episode” (`.scratch/electron-migration/issues/04-nas-resume.md:11`).
- **P2 stale detail fixed.** `src/main/library-controller.ts:320-345` gates cache/navigation writes by generation and session. Satisfies “prevent stale navigation results” (`docs/electron-migration-spec.md:41`).
- Password bytes, current-history resume, and failed-load progress are fixed at `src/main/ipc-validation.ts:3-20`, `src/main/player-host.ts:103-119`, and `src/main/player.ts:203-225,245-268,323-383`; these align with local password entry (`docs/electron-migration-spec.md:16`), matching Episode restore (`.scratch/electron-migration/issues/04-nas-resume.md:10-12`), and no fabricated saved receipt (`:11`).

## Residual findings

- **P2 Continue Watching context incomplete.** `src/renderer/library.ts:146,420-423` now carries `episodeId`, but `openDetail` stores only Collection/Episode at `:302-305`; playback still sends `navigation.library.classificationId` at `:378-382`. An item cached from another classification can display the right detail yet request playback under the current classification, violating “进入对应详情与选集” and “恢复正确位置” (`docs/design/spec-03-browsing-flow.md:19-20`).
- **P2 debounce can undo navigation.** The 250 ms timer at `src/renderer/library.ts:450-457` is not cancelled by `openDetail` (`:302-309`); when a user types and immediately opens a card, `loadCollections` (`:269-279`) later resets `detailOpen` and discards the detail. This breaks the approved query/detail flow (`docs/design/spec-03-browsing-flow.md:19,31`).

Evidence reused without rerun: focused owner suite 41/41 and final window smoke (`.scratch/electron-migration/review-fixes-completion.md:22-26`). Real NAS, hardware/DWM/overlay, macOS and package rebuild boundaries remain pending as documented (`:29-31`).
