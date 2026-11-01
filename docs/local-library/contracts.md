# Local library contracts

Status: Schema v1 foundation plus local playback IPC, accepted 2026-10-31 and extended 2026-11-01. Schema owners: `src/main/local-library-worker.ts`, `src/main/local-library-database.ts`, and `src/shared/local-library-contracts.ts`; playback owners: `src/main/player.ts`, `src/main/mpv-player.ts`, `src/main/player-host.ts`, and `src/shared/local-playback-contracts.ts`.

## Schema v1

The utility process creates these tables in the database under application `userData/local-library/library.sqlite`:

| Table | Foundation fields | Next owner |
|---|---|---|
| `sources` | `source_id`, `root_path` (main/worker only), `label`, `available`, timestamps | 02 scan |
| `collections` | `collection_id`, `title`, `kind`, optional year/plot/genre/rating, owner identity/source-relative grouping, timestamps | 02 metadata |
| `media_files` | `media_id`, `collection_id`, `source_id`, `relative_path` (main/worker only), display title/kind, optional season/episode, `size_bytes`, `modified_at_ms`, `available`, timestamps | 02 scan / 03 playback |
| `artwork` | `artwork_id`, collection/media owner, source-relative path (main/worker only), `kind`, source fingerprint/cache key | 02 metadata |
| `playback_state` | `media_id`, position/duration, audio/subtitle track IDs, watched, updated time | 03 playback |
| `scan_runs` | source, generation, completion, error, start/completion times | 02 scan |

`PRAGMA user_version` is `1`. The worker uses prepared statements and enables foreign keys. The first import creates one movie collection and one media file; NFO/artwork mapping is deliberately deferred to ticket 02.

## Public IPC

Channels are defined in `src/shared/ipc-channels.ts` and exposed through `window.zVideo.localLibrary`:

- `local-library:state` → `LocalLibraryState`; reports schema version, SQLite availability, safe source labels/counts, and an actionable storage error.
- `local-library:choose-folder` → opens a main-owned directory picker and starts a visible, cancellable full-root scan; progress is emitted through `onScanProgress` and the final result reports `completed`/`cancelled`/`partial`/`unavailable` without a root path.
- `local-library:open-video` → opens a main-owned video picker and imports the selected file under its parent root.
- `local-library:list` → validates bounded page/query input and returns `LocalLibraryPage` with renderer-safe items.
- `local-library:get` → validates opaque `mediaId` and returns one renderer-safe item; missing media is not a path error.

Renderer-visible `LocalMediaItem` fields are `mediaId`, `sourceId`, `collectionId`, title, kind, optional year/plot/genres/rating/season/episode, artwork cache keys, size, modified time, and availability. Source summaries use a basename or a fixed drive/folder label; they never fall back to an absolute root. Absolute paths, UNC paths, source-relative paths, database rows, credentials, NAS signs, and raw playback URIs are never part of the public DTO. Worker, SQLite, filesystem and IPC errors are reduced to stable renderer-safe messages before entering state, scan results, or rejected IPC promises.

Ticket 02 adds main-owned `scanFolder`, `cancelScan`, and bounded `onScanProgress` operations. A scan result reports counts, warnings, and `completed`/`cancelled`/`partial`/`unavailable` status without exposing a root path. A successful traversal is the only operation allowed to mark unseen files unavailable; cancellation, permission errors, and disconnected roots preserve existing rows and playback state. If a source becomes unreadable during traversal, the scan remains partial and the source is reported unavailable until a later successful refresh.

## Local playback IPC

`window.zVideo.localPlayback` is the renderer's only playback bridge. `local-playback:open` accepts an opaque `mediaId`; main resolves its private path through the local-library owner and passes it directly to libmpv. `local-playback:command` accepts play, pause, seek, audio/subtitle track, fullscreen, close, and these settings controls:

- `set-volume`: finite number from 0 through 100.
- `set-muted`: boolean.
- `set-speed`: finite number from 0.25 through 3.

`local-playback:event` may emit `{ type: "settings", mediaId, volume, muted, speed }`. These values are read from libmpv's `volume`, `mute`, and `speed` properties; the renderer does not treat a requested value as applied until this event arrives. The main-owned player keeps the latest settings in memory for the lifetime of the window and reapplies them when another media item starts. They are not written to SQLite.

Non-fatal playback-control or subtitle failures use `{ type: "control-error", mediaId, message }`; they do not mark the media load as failed or disable playback controls.

`local-playback:choose-subtitle-file` opens a main-owned picker limited to SRT, ASS, SSA, VTT, and SUB. The selected path remains in main and is passed to libmpv through `addSubtitleFile`; it is never sent through preload or a renderer event. Cancellation, no active playback, or a playback switch while the picker is open returns `{ loaded: false }` without loading a subtitle into the replacement media. A current selection returns `{ loaded: true }` after libmpv accepts it.

Playback events, including settings, contain only the active opaque `mediaId` and renderer-safe values. Settings and subtitle selection do not change schema v1 or add persisted preferences.

Native track labels are display text only. Main removes path components from libmpv-provided title/language metadata before emitting them and never reads `external-filename` into a renderer DTO.

## Identity

`mediaId` matches `media_<UUID>` and is generated by the worker. An unchanged `(source root, relative path, size, modified time)` reuses the existing ID. A changed fingerprint marks the previous row unavailable and creates a new ID without inheriting playback state. Path resolution is main-only, canonicalizes the selected root and candidate, rejects reparse/symlink escapes, and returns no path when the indexed file or artwork is replaced by an unsafe link. A single-file import reuses the most specific existing ancestor source; if no ancestor exists, an overlapping root is rejected before creating a new source.

## Handoff

Ticket 02 may add metadata columns/records only through the schema owner and must preserve the opaque-ID and path boundary. Ticket 03 uses `getPlayback`/`savePlayback` keyed by `mediaId` plus the main-only `resolveMedia` method; it must not add a renderer path escape hatch or NAS progress write.
