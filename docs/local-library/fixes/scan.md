# Local scan performance fix

Date: 2026-10-31
Baseline: `5dfd63e` (`codex/fix-local-scan`)
Scope: `src/main/local-library-worker.ts` and the owned scan-stage smoke only. No NAS/share path was opened.

## Evidence first

The representative fixture contains 23 video entries (12 movies and 11 episodes), 16 directories, 19 NFO files, explicit and conventional artwork, and shared show artwork. The profiler is enabled only when `Z_VIDEO_SCAN_PROFILE_PATH` is set; it records stage timings and call counts without recording paths. An earlier instrumented run used `Z_VIDEO_SCAN_IO_DELAY_MS=2` as a controlled sensitivity probe; that artificial delay switch was removed from the final worker. The artwork stage includes artwork-path resolution and therefore overlaps the lstat/realpath stage totals; it is not added to calculate total time.

Before optimization (`.scratch/local-library/runs/scan-profile-1793455761414-10296/scan-profile-report.json`):

| Run | Total | realpath | lstat | stat | directory reads | NFO reads | artwork stage | DB stage |
|---|---:|---:|---:|---:|---:|---:|---:|
| first, 0 ms IO delay | 104.84 ms | 191 calls / 41.00 ms | 118 / 9.38 ms | 23 / 1.69 ms | 22 | 19 | not isolated | 44.96 ms |
| repeat, 0 ms IO delay | 104.15 ms | 191 / 38.18 ms | 118 / 8.86 ms | 23 / 1.54 ms | 22 | 19 | not isolated | 58.37 ms |
| first, 2 ms IO delay | 2,158.07 ms | 191 | 118 | 23 | 22 | 19 | not isolated | 56.99 ms |
| repeat, 2 ms IO delay | 3,123.73 ms | 191 | 118 | 23 | 22 | 19 | not isolated | 72.22 ms |

The repeat scan re-read all 19 NFO files. This confirmed the suspected incremental metadata miss. The repeated path checks and per-file SQLite writes were also measured; they were not inferred from source shape alone.

After optimization (`.scratch/local-library/runs/scan-profile-1793456422389-22872/scan-profile-report.json`):

| Run | Total | realpath | lstat | stat | directory reads | NFO reads | artwork stage | DB stage |
|---|---:|---:|---:|---:|---:|---:|---:|
| first, no artificial delay | 71.46 ms | 91 calls / 18.41 ms | 113 / 9.53 ms | 0 | 16 | 19 | 6.30 ms | 20.34 ms |
| repeat, one changed NFO | 47.59 ms | 92 / 17.27 ms | 115 / 8.62 ms | 0 | 16 | 1; 18 cache hits | 5.77 ms | 14.88 ms |

The same final profile then scanned a separate 520-item NFO capacity probe: `nfoCacheSize=512`, `nfoCacheEvictions=27`, `importedFiles=520`. The changed-NFO assertion verified that the edited file was read again while the other 18 unchanged NFO entries were reused.

The 2 ms rows in the before table are historical instrumented data only; the final worker has no artificial per-IO delay environment switch and those rows are not a NAS speed claim.

The same owned 2,000/20,000 scale smoke passed after the optimization: 1,990 ms / 20,017 ms versus the earlier 4,863 ms / 42,662 ms run. The scale run predates only this diagnostic cleanup and cache-capacity probe; those follow-up edits do not affect empty-video scan behavior. This fixture has empty synthetic video files and proves only local owner scaling/offline retention, not NAS performance or NFO compatibility.

## Review follow-up evidence

The final profile smoke at `.scratch/local-library/runs/scan-profile-1793457281727-16928/scan-profile-report.json` also restarted the worker with an existing directory as `Z_VIDEO_SCAN_PROFILE_PATH`. The scan still returned `completed`; the unwritable profile output was treated as diagnostic-only and did not replace the scan result. The owner smoke at `.scratch/local-library/db-1793457277994-24368/electron.log` observed a playback write from scan progress while another scan was active, and verified that a later partial directory failure retained the already committed first item.

## Changes

- Reused the already canonical root for containment checks. Candidate paths still go through `realpath`, and the existing lstat-before-canonical check still rejects reparse/symbolic-link entries.
- Reused the already validated video `lstat` metadata and removed the duplicate `stat` call for each video; missing entries still report a partial/unavailable traversal as before.
- Reused the directory entries already read by traversal for conventional artwork lookup. Repeated artwork references are cached within a scan and the DB fingerprint check skips unchanged artwork rewrites.
- Wrapped each media upsert in one `BEGIN IMMEDIATE`/`COMMIT` transaction. The transaction is per media item, so committed items remain progressively visible and cancellation/partial scans do not require a destructive rollback of prior entries.
- Completed artwork `lstat` and fingerprint preparation before opening the media transaction. The `BEGIN IMMEDIATE` through `COMMIT` section is synchronous SQLite work with no filesystem `await`, so concurrent playback/source commands cannot interleave into a half-open media transaction.
- Scan traversal no longer builds a renderer DTO for every item. The import path still builds and returns its item DTO.
- Added a bounded 512-entry process-lifetime LRU NFO cache keyed by file path, size, and mtime. A changed NFO is read and parsed again; a worker restart naturally starts with an empty cache. No schema or renderer contract changed.
- Put all scan setup under the cleanup guard and made profile directory/append failures non-fatal. The profiler and scan caches are cleared even when overlap/DB setup fails; profile output cannot change a completed, partial, cancelled, or unavailable scan result.

## Commands

```text
npm run typecheck
npm run test:local-library
npm run build
node scripts/run-local-library-scan-profile-smoke.mjs
npm run test:local-library-scale
git diff --check
```

The final typecheck/build/profile smoke and local DB owner smoke passed in the supported Windows GUI permission context. The first unsandboxed scale attempt exited before Electron startup with `2147483651`; the rerun with that permission passed. The smoke uses bounded owned child processes, isolated profiles, and regular-file logs.

## Limits

- No private user directory, UNC share, or NAS was scanned. The historical per-IO delay is synthetic and does not establish network round-trip time; the final worker contains no such delay switch.
- The bounded NFO cache is intentionally process-local; persistence across worker restarts would require a schema/contract decision and is not included here.
- The concurrency proof uses the local-library owner seam and an owned fixture; it is not a claim about an actual NAS round trip or remote SQLite contention.
- The existing real reparse-point, opaque-ID, read-only source, cancellation/partial, offline-history, and bounded cache behavior remains owned by the existing local-library smoke and was not removed or weakened.
- No package, renderer, native playback, deployment, or cleanup work was performed.
