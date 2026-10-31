# Narrow review: local video and scan fixes

Date: 2026-10-31  
Fixed point: `5dfd63e`  
Compared changes: `5dfd63e...da27834` (video) and `5dfd63e...7c64906` (scan; includes `27eecb9`)  
Scope: only the two fix notes, their changed files, and the local-library owner/contract boundaries. No NAS, private/share path, CUA, GUI, test, build, or source change was performed.

## Findings

### [P1] Closing local playback does not restore the library view or fullscreen state

- Evidence: `src/renderer/renderer.ts:139-149` handles `closed` by calling `showPlayer(false)` and reloading data, but never calls `closeDetail()`. The open path had already set `collectionSection.hidden = true` and `media-detail.hidden = false` at `src/renderer/renderer.ts:460-466`, so the advertised “返回片库” action leaves the user on the detail screen.
- Evidence: the new fullscreen control sends `fullscreen=true` at `src/renderer/renderer.ts:682-686`, while the local close path `src/main/player.ts:177-188` and native-closed path `src/main/player.ts:283-290` never send `setWindowFullscreen(false)`. Closing in fullscreen can therefore leave the BrowserWindow fullscreen even though the renderer resets its button text.
- Minimal fix: on the local `closed` event, restore the library/detail visibility (`closeDetail()` or equivalent) and explicitly send `fullscreen=false` when it was active; add those two state assertions to the local playback smoke.

### [P1] The per-item scan transaction spans asynchronous filesystem work and can absorb or roll back unrelated owner writes

- Evidence: `src/main/local-library-worker.ts:793-818` starts `BEGIN IMMEDIATE`, then awaits `upsertArtwork`; that function performs `lstat` awaits at `src/main/local-library-worker.ts:771-787`. The utility worker dispatches requests concurrently, while `savePlayback` writes at `src/main/local-library-worker.ts:1071-1085` and source removal starts another transaction at `src/main/local-library-worker.ts:995-1012`.
- Consequence: a playback save arriving during an artwork lookup runs inside the scan transaction and is rolled back if the media upsert later fails; a concurrent remove/import transaction can fail with an active-transaction error, and its unconditional `ROLLBACK` can undo the in-flight scan transaction. This weakens the local owner’s progress/source-operation boundary even though the sequential fixture passed.
- Minimal fix: complete all filesystem/artwork metadata resolution before `BEGIN IMMEDIATE`, then keep the transaction synchronous through commit; alternatively add a write-only owner queue that serializes scan/import/remove/playback writes without blocking read queries.

### [P2] The new hide operation is not sticky across native-window resizes

- Evidence: `src/main/mpv-player.ts:133-143` hides the child in `stop()`, but `src/main/native-window.ts:105-118` always uses `SWP_SHOWWINDOW` and `ShowWindow(SW_SHOW)` from `resize()`. A failed `start()` retains the host after `stop()` (`src/main/mpv-player.ts:105-129`), so a later parent resize/display-metrics event can show the supposedly hidden 1x1/stale child again.
- Minimal fix: track native-host visibility separately; let `resize()` reposition without showing a hidden host, and call an explicit `show()` only once playback has started (or destroy the host on failed start).

### [P2] Profiling is not fail-open and its lifecycle starts outside the scan cleanup guard

- Evidence: `src/main/local-library-worker.ts:1215-1229` installs global `scanProfiler`/`scanCaches` before the `try/finally`; an overlap/DB setup exception before `addScanRun()` leaves that state uncleared. In addition, `finishScanProfiler()` writes with unguarded `mkdir`/`appendFile` at `src/main/local-library-worker.ts:191-205`, so an invalid `Z_VIDEO_SCAN_PROFILE_PATH` can turn an otherwise completed scan into a rejected scan from the `finally` block.
- Minimal fix: put profiler/cache installation and all setup inside one cleanup-protected scope, and treat evidence-file write failure as diagnostic-only (record it without replacing the scan result).

## Invariant and evidence audit

- Koffi/Win32: `src/main/native-window.ts:55` uses `koffi.out(koffi.pointer(RECT))`, matching the installed Koffi output-parameter contract; `GetClientRect` dimensions are converted to the child width/height at lines 105-114, and removing `SWP_NOZORDER` makes the child top-of-sibling order. These definitions are sound; the show/hide state issue above remains.
- Scan safety: the new root reuse still canonicalizes candidate paths (`src/main/local-library-worker.ts:371-379`), checks lstat before canonical acceptance for directories/files/artwork (`1171-1197`, `630-636`), only marks unseen rows unavailable after a complete traversal (`1246-1264`), and preserves the size/mtime media identity match (`795-816`). No source-file write or renderer path DTO was added.
- Cache/profile: the process LRU evicts at 512 entries (`144-166`), and the recorded profile smoke proves `nfoCacheSize=512` with evictions. The final worker/source/tests contain no `Z_VIDEO_SCAN_IO_DELAY_MS` or equivalent artificial-delay switch; the 2 ms rows in `scan.md` are explicitly historical evidence.
- Reused evidence: `docs/local-library/fixes/video.md:28-36` and `docs/local-library/fixes/scan.md:44-61`, plus existing owner/contract/typecheck/profile evidence. Those checks were not rerun in this review.

## Verification boundary

The post-fix native decoded-pixel proof is still pending. The added playback smoke only observes Chromium DOM layout and playback events (`tests/local-playback-resume-smoke.ts:47-72`); it does not observe the native child rectangle or changing decoded pixels. `docs/local-library/fixes/video.md:36` correctly records that Computer Use stopped on physical Escape and that explicit authorization is required before the bounded GUI/native-window screenshot is rerun. No pixel PASS is claimed here.

Verdict: **CHANGES_REQUIRED** for the four code findings above; after those repairs, native pixel acceptance remains a separate, authorization-gated proof boundary.
