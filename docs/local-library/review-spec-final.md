# Final Spec review: `9b7420c...8a2b104`

Verdict: **PASS** for the four findings in the prior Spec review.

1. **Add-folder scan — resolved.** The spec requires a visible, cancellable, progressive root scan (`docs/local-library/spec.md:25`). The handler now returns `database.scanFolder(...)` (`src/main/local-library-ipc.ts:22-36`), and the renderer routes “添加文件夹” through `runScan` with progress/cancel UI (`src/renderer/renderer.ts:447-470,491-493`). The completion records real-window scan-status proof (`docs/local-library/completions/review-fixes.md:16,29`).

2. **Nested/overlapping file roots — resolved.** The spec requires rejecting overlapping roots (`docs/local-library/spec.md:39`). File import now reuses the most-specific ancestor (`src/main/local-library-worker.ts:322-335,1080-1087`) and calls overlap rejection for new roots (`src/main/local-library-worker.ts:306-319`). The owner smoke proves both ancestor reuse and sibling overlap rejection (`docs/local-library/completions/review-fixes.md:17,28`).

3. **Canonical/reparse root boundary — resolved.** The spec requires main-only boundary enforcement and no reparse escape (`docs/local-library/spec.md:36,39`). Root/candidate paths are canonicalized (`src/main/local-library-worker.ts:231-245,247-260`), traversal rechecks directories/files (`src/main/local-library-worker.ts:943-1004`), and playback/artwork resolution rejects unsafe replacements (`src/main/local-library-worker.ts:822-839,847-858`). The supported Windows owner proof used a real junction replacement and both resolutions returned no path (`docs/local-library/completions/review-fixes.md:12,28`).

4. **Mid-scan disconnect availability — resolved.** The spec requires preserving rows/history while reporting offline status (`docs/local-library/spec.md:39,41`). Partial traversal now marks the source unavailable and returns `partial` (`src/main/local-library-worker.ts:1058-1063`); the owner smoke proves `partial` plus unavailable state (`docs/local-library/completions/review-fixes.md:18,28`).

No remaining blocker or scope-creep finding within this narrow re-review. Existing NFO, full-index/episode/Continue Watching, native fresh-process resume, no-auth, cache/query, and package proofs are reused as authorized. The final C: package rebuild is a post-merge delivery action, not a source finding.
