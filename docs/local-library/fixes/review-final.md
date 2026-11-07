# Local-library fixes final narrow review

Date: 2026-11-01  
Compared: `5dfd63e...90c18c6` (video fix on top of scan merge `90d50aa`; scan repairs `1f04ff2` and `e83b14b`)  
Scope: re-review of the four findings in `docs/local-library/fixes/review.md`. No source change, test/build rerun, GUI action, or NAS/private-share access was performed.

## Verdict

**PASS — no remaining blocker for the four findings.** The earlier pending native-pixel status is superseded: current CUA authorization is restored, and `video.md` records real Sky observation of a colored decoded tree frame plus the Win32 child-window probes. The evidence is bounded to the owned local fixture; it is not a NAS or cross-platform claim.

## Finding disposition

1. **P1 close/fullscreen state — fixed.** `src/renderer/renderer.ts:140-149` now handles `closed` by hiding the player, resetting controls, calling `closeDetail()`, and returning to the collection view. `src/main/player.ts:177-188` and `284-292` explicitly call `setWindowFullscreen(false)` on coordinator close and native shutdown. The added unit assertion covers both paths (`tests/local-playback.test.ts`), and `video.md:43` records the actual play/pause/seek/`返回片库` AX path and library-card return.

2. **P1 scan transaction boundary — fixed.** `src/main/local-library-worker.ts:775-793` performs artwork `lstat`/fingerprint preparation before `upsertMedia` opens the transaction. The `BEGIN IMMEDIATE` at line 822 through `COMMIT` at line 860 is synchronous database work; no filesystem `await` is inside it. `scan.md:37,45` records the owner-concurrent playback write and partial-scan retention proof.

3. **P2 native hide/show — fixed.** `src/main/native-window.ts:79-128` keeps explicit `visible` state, makes resize/DPI callbacks honor it, and only calls `show()` after `loadfile` is accepted (`src/main/mpv-player.ts:127`). Its `SetWindowPos` call uses `HWND_TOP` (`0n`) without `SWP_NOZORDER`, while the real native probe in `video.md:35-41` records a visible `2048 × 1000` child below a `2048 × 1152` parent and a stopped/resize retry with `visible: false` at `1028 × 532`; this closes the stale re-show path.

4. **P2 profiler lifecycle/fail-open — fixed.** `finishScanProfiler()` catches directory/append failures and records them diagnostically (`src/main/local-library-worker.ts:195-214`), while scan setup and global profiler/cache teardown are inside `scanRoot`'s `try/finally` (`src/main/local-library-worker.ts:1243-1318`). `scan.md:37,48` records completed-scan behavior with an invalid profile output and cleanup coverage.

## Invariant check

- The current scan path still canonicalizes and rejects reparse/symbolic-link entries (`src/main/local-library-worker.ts:380-428,1197-1222`), only marks missing rows unavailable after a complete traversal (`1282-1286`), preserves the `(source_id, relative_path, size_bytes, modified_at_ms)` identity match (`826-827`), and retains the 512-entry NFO cache cap (`144,162-170`).
- `scan.md:42-48,65-68` records unchanged read-only/offline/cancellation/partial/opaque-ID ownership and confirms the final worker has no artificial per-IO delay switch. No new scope or NAS claim was introduced.
- Koffi uses the output-parameter declaration at `src/main/native-window.ts:54`; the recorded native geometry and real decoded frame cover the prior proof gap. Existing typecheck/build/unit/profile/resume evidence is reused as documented and was not rerun in this review.

