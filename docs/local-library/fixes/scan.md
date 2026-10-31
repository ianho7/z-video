# Local scan performance fix

Date: 2026-10-31
Baseline: `5dfd63e` (`codex/fix-local-scan`)
Scope: `src/main/local-library-worker.ts` and the owned scan-stage smoke only. No NAS/share path was opened.

## Evidence first

The representative fixture contains 23 video entries (12 movies and 11 episodes), 16 directories, 19 NFO files, explicit and conventional artwork, and shared show artwork. The profiler is enabled only when `Z_VIDEO_SCAN_PROFILE_PATH` is set; it records stage timings and call counts without recording paths. `Z_VIDEO_SCAN_IO_DELAY_MS=2` adds a controlled 2 ms delay before each profiled filesystem call. That delay is a sensitivity probe, not a NAS latency claim. The artwork stage includes artwork-path resolution and therefore overlaps the lstat/realpath stage totals; it is not added to calculate total time.

Before optimization (`.scratch/local-library/runs/scan-profile-1793455761414-10296/scan-profile-report.json`):

| Run | Total | realpath | lstat | stat | directory reads | NFO reads | artwork stage | DB stage |
|---|---:|---:|---:|---:|---:|---:|---:|
| first, 0 ms IO delay | 104.84 ms | 191 calls / 41.00 ms | 118 / 9.38 ms | 23 / 1.69 ms | 22 | 19 | not isolated | 44.96 ms |
| repeat, 0 ms IO delay | 104.15 ms | 191 / 38.18 ms | 118 / 8.86 ms | 23 / 1.54 ms | 22 | 19 | not isolated | 58.37 ms |
| first, 2 ms IO delay | 2,158.07 ms | 191 | 118 | 23 | 22 | 19 | not isolated | 56.99 ms |
| repeat, 2 ms IO delay | 3,123.73 ms | 191 | 118 | 23 | 22 | 19 | not isolated | 72.22 ms |

The repeat scan re-read all 19 NFO files. This confirmed the suspected incremental metadata miss. The repeated path checks and per-file SQLite writes were also measured; they were not inferred from source shape alone.

After optimization (`.scratch/local-library/runs/scan-profile-1793456257421-22796/scan-profile-report.json`):

| Run | Total | realpath | lstat | stat | directory reads | NFO reads | artwork stage | DB stage |
|---|---:|---:|---:|---:|---:|---:|---:|
| first, 0 ms IO delay | 71.54 ms | 91 calls / 18.63 ms | 113 / 8.89 ms | 0 | 16 | 19 | 6.60 ms | 20.34 ms |
| repeat, 0 ms IO delay | 45.93 ms | 91 / 16.63 ms | 113 / 8.04 ms | 0 | 16 | 0; 19 cache hits | 5.38 ms | 14.94 ms |
| first, 2 ms IO delay | 1,758.45 ms | 91 | 113 | 0 | 16 | 19 | 293.88 ms | 24.24 ms |
| repeat, 2 ms IO delay | 1,797.01 ms | 91 | 113 | 0 | 16 | 0; 19 cache hits | 325.04 ms | 19.85 ms |

The same owned 2,000/20,000 scale smoke also passed after the change: 1,990 ms / 20,017 ms versus the earlier 4,863 ms / 42,662 ms run. This fixture has empty synthetic video files and proves only local owner scaling/offline retention, not NAS performance or NFO compatibility.

## Changes

- Reused the already canonical root for containment checks. Candidate paths still go through `realpath`, and the existing lstat-before-canonical check still rejects reparse/symbolic-link entries.
- Reused the already validated video `lstat` metadata and removed the duplicate `stat` call for each video; missing entries still report a partial/unavailable traversal as before.
- Reused the directory entries already read by traversal for conventional artwork lookup. Repeated artwork references are cached within a scan and the DB fingerprint check skips unchanged artwork rewrites.
- Wrapped each media upsert in one `BEGIN IMMEDIATE`/`COMMIT` transaction. The transaction is per media item, so committed items remain progressively visible and cancellation/partial scans do not require a destructive rollback of prior entries.
- Scan traversal no longer builds a renderer DTO for every item. The import path still builds and returns its item DTO.
- Added a process-lifetime NFO cache keyed by file path, size, and mtime. A changed NFO is read and parsed again; a worker restart naturally starts with an empty cache. No schema or renderer contract changed.

## Commands

```text
npm run typecheck
npm run test:local-library
npm run build
node scripts/run-local-library-scan-profile-smoke.mjs
npm run test:local-library-scale
git diff --check
```

All commands above passed in the supported Windows GUI permission context except the first unsandboxed scale attempt, which exited before Electron startup with `2147483651`; the rerun with that permission passed. The smoke uses bounded owned child processes, isolated profiles, and regular-file logs.

## Limits

- No private user directory, UNC share, or NAS was scanned. Per-IO delay is synthetic and does not establish network round-trip time.
- The NFO cache is intentionally process-local; persistence across worker restarts would require a schema/contract decision and is not included here.
- The existing real reparse-point, opaque-ID, read-only source, cancellation/partial, offline-history, and bounded cache behavior remains owned by the existing local-library smoke and was not removed or weakened.
- No package, renderer, native playback, deployment, or cleanup work was performed.
