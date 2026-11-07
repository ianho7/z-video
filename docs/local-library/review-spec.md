# Spec review: `1dea6ea...9b7420c`

Verdict: **CHANGES_REQUIRED**

## Findings

1. **[P1] Add-folder flow is only a first-file import.** The approved flow requires adding a root to start a visible, cancellable, progressive scan (`docs/local-library/spec.md:25`). The picker handler calls `importFirstMovieInFolder` (`src/main/local-library-ipc.ts:21-25`), and the worker only finds/imports the first video (`src/main/local-library-worker.ts:1034-1036`). The separate “扫描目录” button does not satisfy the default Add-folder flow.

2. **[P1] File-picker imports bypass overlapping-root rejection.** The spec requires rejecting duplicate/overlapping roots (`docs/local-library/spec.md:39`). `open-video` derives the parent directory and calls `importVideo` (`src/main/local-library-ipc.ts:26-34`); `importVideo` calls `ensureSource` without `assertNoOverlappingSource` (`src/main/local-library-worker.ts:993-999`). Selecting a file below an indexed root can therefore create a nested source.

3. **[P1] Root enforcement is lexical, not canonical/reparse-safe.** Path resolution must enforce the selected-root boundary and scanning must not follow reparse points (`docs/local-library/spec.md:36,39`). `pathWithin` compares only `resolve`/`relative` strings (`src/main/local-library-worker.ts:256-261`); `resolvePath` then returns that path after the same check (`src/main/local-library-worker.ts:791-801`), while traversal only skips `Dirent.isSymbolicLink()` (`src/main/local-library-worker.ts:908-917`). A replaced file or junction/root reparse point can escape the selected root.

4. **[P2] A mid-scan share disconnect remains “available”.** Offline cached index must expose source-unavailable status (`docs/local-library/spec.md:39,41`). `scanRoot` sets `sources.available=1` before traversal (`src/main/local-library-worker.ts:957-960`); a failed `readdir` becomes `partial` (`src/main/local-library-worker.ts:889-895,974-977`) without clearing availability, and DTO availability uses that flag (`src/main/local-library-worker.ts:312-325`). Rows/history are preserved, but the UI can still report the disconnected source as online.

No scope-creep finding. NFO fallback, full-index query/detail/episode identity/Continue Watching, local native fresh-process resume, default no-auth startup, read-only DB/source writes, bounded cache, and concurrent-query evidence remain consistent with the approved spec and recorded completions.
