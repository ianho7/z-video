# UX preferences and restart owner

Date: 2026-11-06. Baseline: `fbf4cb4`. Owner: main playback chain and shared/preload contracts. Renderer files are intentionally unchanged.

## Production contract

`window.zVideo.appPreferences` exposes only:

- `get(): Promise<{ volume, muted, speed, sort }>`
- `setSort(sort: LocalLibrarySort): Promise<{ volume, muted, speed, sort }>`

`setSort` accepts only `recent`, `title`, `year_desc`, `score_desc`, or `added_desc`. It rejects arbitrary objects, path-like values, and unknown sort values. The JSON file is main-owned at `userData/app-preferences.json`; missing, malformed, out-of-range, or unknown-field content falls back to defaults.

Native volume/mute/speed continue to use the existing `local-playback:command` controls. After each successful libmpv setter, main reads the native properties and persists only that confirmed snapshot. Updates are serialized, written through a temporary file and renamed, and flushed after the player closes. A write failure reports a non-fatal `control-error`; it does not stop playback.

`window.zVideo.localPlayback.open(mediaId, { restart?: boolean })` accepts only an opaque media ID plus an optional boolean restart flag. `restart: true` resolves the path through the main/local-library owner, starts native playback at `0`, and resets only the active attempt's watched flag. A load failure is gated by the existing `loadFailed`/`observedPosition` checks and does not overwrite prior history. Existing generation, EOF, close, normal resume, track, and fullscreen behavior remains in the coordinator.

## UI integration

1. On library startup, call `const preferences = await window.zVideo.appPreferences.get()` and use `preferences.sort` for the first bounded `localLibrary.list` query.
2. On sort change, call `await window.zVideo.appPreferences.setSort(nextSort)` and use the returned `sort` as the committed value; an IPC error should keep the current UI value and show the existing safe error surface.
3. Keep player sliders bound to `localPlayback.command({ type: "set-volume", ... })`, `set-muted`, and `set-speed`. Treat the `settings` event as the applied value; do not write native settings through app preferences.
4. For a deliberate start-over action, call `localPlayback.open(mediaId, { restart: true })`. For Continue, keep the existing `open(mediaId)` call so saved local progress is used.

## Evidence

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS after final source/test changes |
| `node --test dist/tests/app-preferences.test.js dist/tests/local-playback.test.js` | PASS, 11/11; covers invalid/missing JSON, unknown/path field rejection, serialized updates, restart-from-zero, restart watched reset, and failed-load history preservation |
| `npm run test:local-playback-resume` | PASS under supported Windows GUI permissions; fresh Electron processes restored native `{ volume: 35, muted: true, speed: 1.25 }`, sort `score_desc`, and observed position `12.9129s` (`12.9129s` after reopen) |
| `git diff --check` | PASS |

The native smoke evidence is under `.scratch/electron-migration/runs/local-library/playback-profile-hJLnYo/`: `first-result.json`, `second-result.json`, and `app-preferences.json`. The first sandboxed launch was an environment-only Electron `0x80000003`; the same smoke passed after rerun with supported GUI permissions.

The broad `npm test` run still includes the repository's pre-existing NAS/secure-storage environment failures (`fetch failed`, sandbox `EPERM`); local playback and new preference tests passed. No package or deployment check was run, and no renderer GUI acceptance claim is made here.
