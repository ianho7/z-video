# Local library contracts

Status: Schema v2 (B0 premiere dates) plus the work-level Collection read contract (B1), local playback IPC, accepted 2026-10-31 and extended 2026-11-01/2026-11-06/2026-11-08. Schema owners: `src/main/local-library-worker.ts`, `src/main/local-library-database.ts`, and `src/shared/local-library-contracts.ts`; playback owners: `src/main/player.ts`, `src/main/mpv-player.ts`, `src/main/player-host.ts`, and `src/shared/local-playback-contracts.ts`; app-preferences owners: `src/main/app-preferences.ts`, `src/main/app-preferences-ipc.ts`, and `src/shared/app-preferences-contracts.ts`.

## Schema v2

The utility process creates these tables in the database under application `userData/local-library/library.sqlite`:

| Table | Foundation fields | Next owner |
|---|---|---|
| `sources` | `source_id`, `root_path` (main/worker only), `label`, `available`, timestamps | 02 scan |
| `collections` | `collection_id`, `title`, `kind`, optional year/`premiered_at`/plot/genre/rating, owner identity/source-relative grouping, timestamps | 02 metadata |
| `media_files` | `media_id`, `collection_id`, `source_id`, `relative_path` (main/worker only), display title/kind, optional season/episode, `size_bytes`, `modified_at_ms`, `available`, timestamps | 02 scan / 03 playback |
| `artwork` | `artwork_id`, collection/media owner, source-relative path (main/worker only), `kind`, source fingerprint/cache key | 02 metadata |
| `playback_state` | `media_id`, position/duration, audio/subtitle track IDs, watched, updated time | 03 playback |
| `scan_runs` | source, generation, completion, error, start/completion times | 02 scan |

`PRAGMA user_version` is `2`. The worker uses prepared statements and enables foreign keys. The first import creates one movie collection and one media file.

### v2 premiere dates

- NFO `<premiered>` is parsed first and `<releasedate>` is a compatibility fallback. Only a real calendar date written as `YYYY-MM-DD` is accepted; a bare year, an impossible month/day, or a timestamp is rejected and stored as `NULL`. A year is never used as a date.
- `collections.premiered_at TEXT` persists that value and `collections_premiered_at` indexes it. The v1 → v2 migration is incremental and idempotent: it adds the column and index, then sets `user_version` to `2`. Existing rows keep `NULL`; migration never guesses a date.
- `local-library:list` accepts sort `released_desc`: rows with a premiere date come first, newest first, then `year` descending and most recently added; rows without a date stay last.
- `LocalMediaItem.premieredDate` is the renderer-safe `YYYY-MM-DD` value or `null` when unknown. It is not a path and carries no source location.

## Public IPC

Channels are defined in `src/shared/ipc-channels.ts` and exposed through `window.zVideo.localLibrary`:

- `local-library:state` → `LocalLibraryState`; reports schema version, SQLite availability, safe source labels/counts, and an actionable storage error.
- `local-library:choose-folder` → opens a main-owned directory picker and starts a visible, cancellable full-root scan; progress is emitted through `onScanProgress` and the final result reports `completed`/`cancelled`/`partial`/`unavailable` without a root path.
- `local-library:open-video` → opens a main-owned video picker and imports the selected file under its parent root.
- `local-library:list` → validates bounded page/query input, including `sort`, and returns `LocalLibraryPage` with renderer-safe items. `released_desc` is valid only under schema v2.
- `local-library:get` → validates opaque `mediaId` and returns one renderer-safe item; missing media is not a path error.

Renderer-visible `LocalMediaItem` fields are `mediaId`, `sourceId`, `collectionId`, title, kind, optional year, optional `premieredDate` (`YYYY-MM-DD` or `null`), optional plot/genres/rating/season/episode, artwork cache keys, size, modified time, and availability. Source summaries use a basename or a fixed drive/folder label; they never fall back to an absolute root. Absolute paths, UNC paths, source-relative paths, database rows, credentials, NAS signs, and raw playback URIs are never part of the public DTO. Worker, SQLite, filesystem and IPC errors are reduced to stable renderer-safe messages before entering state, scan results, or rejected IPC promises.

`local-library:get` may include `detail.playback` for the requested opaque `mediaId` when local progress exists. The worker joins that state to the validated media row; the field contains only `LocalPlaybackState` and never a path or playback URI.

## Work-level (Collection) read contract

B1 adds one renderer-safe work list without changing schema v2. `local-library:list-collections` validates a bounded `LocalCollectionQuery` and returns `LocalCollectionListResult` (`state` plus `LocalCollectionPage`):

- `filter` accepts `all`, `movie`, `show`, and `unclassified`. `episode` is intentionally rejected: the file-level "单集" view keeps using `local-library:list` with `filter: "episode"`.
- `page`/`pageSize`, `query`, `sort` (`recent`/`title`/`year_desc`/`score_desc`/`added_desc`/`released_desc`), and `sourceId` are validated like the file list; `pageSize` is capped at 100.
- `LocalCollectionPage.totalCount` counts works (collections), not files. `items` contains one `LocalCollectionSummary` per collection, so three episodes of one show produce one card.
- `LocalCollectionSummary` carries only safe fields: `collectionId`, `title`, `kind`, optional `year`/`rating`, `premieredDate`, `episodeCount`, `watchedEpisodeCount`, `availableEpisodeCount`, `available`, `representativeMediaId`, `coverMediaId`, optional `resume`/`matchedEpisode`, `addedAtMs`/`updatedAtMs`, and artwork cache keys.
- `representativeMediaId` follows the spec order: the most recently updated in-progress episode, then the first unwatched episode, then the first episode. `resume` contains only the opaque media ID, position/duration, season/episode numbers, and episode title.
- `coverMediaId` prefers an episode with indexed poster artwork and falls back to the representative episode.
- A movie or unclassified file is its own work; a show groups the files that share its show directory. Reusing an old directory-grouped collection is allowed only when the stored identity matches, so existing movie rows split into one work per file on the next scan.
- Search matches the collection title or any episode title. A matching show still appears once and may carry one `matchedEpisode`; it never exposes the source-relative episode path.
- No absolute path, UNC path, source-relative path, SQL row, or scan root enters the DTO or a rejected IPC promise.

Ticket 02 adds main-owned `scanFolder`, `cancelScan`, and bounded `onScanProgress` operations. A scan progress/result reports counts, warnings, and `completed`/`cancelled`/`partial`/`unavailable` status without exposing a root path; `sourceLabel` is the same renderer-safe source label used by state and never a path. A successful traversal is the only operation allowed to mark unseen files unavailable; cancellation, permission errors, and disconnected roots preserve existing rows and playback state. If a source becomes unreadable during traversal, the scan remains partial and the source is reported unavailable until a later successful refresh.

## Local playback IPC

`window.zVideo.localPlayback` is the renderer's only playback bridge. `local-playback:open` accepts an opaque `mediaId` and an optional `{ restart?: boolean }`; main resolves its private path through the local-library owner and passes it directly to libmpv. With `restart: true`, main ignores the saved position and starts at zero. `local-playback:command` accepts play, pause, seek, audio/subtitle track, fullscreen, close, and these settings controls:

- `set-volume`: finite number from 0 through 100.
- `set-muted`: boolean.
- `set-speed`: finite number from 0.25 through 3.

`local-playback:event` may emit `{ type: "settings", mediaId, volume, muted, speed }`. These values are read from libmpv's `volume`, `mute`, and `speed` properties; the renderer does not treat a requested value as applied until this event arrives. Main serially persists the confirmed values and library sort under `userData/app-preferences.json`; they are not written to SQLite. Missing or invalid JSON uses safe defaults. Renderer can read the snapshot through `app-preferences:get` and can update only the validated sort through `app-preferences:set-sort`.

Non-fatal playback-control or subtitle failures use `{ type: "control-error", mediaId, message }`; they do not mark the media load as failed or disable playback controls.

`local-playback:choose-subtitle-file` opens a main-owned picker limited to SRT, ASS, SSA, VTT, and SUB. The selected path remains in main and is passed to libmpv through `addSubtitleFile`; it is never sent through preload or a renderer event. Cancellation, no active playback, or a playback switch while the picker is open returns `{ loaded: false }` without loading a subtitle into the replacement media. A current selection returns `{ loaded: true }` after libmpv accepts it.

Playback events, including settings, contain only the active opaque `mediaId` and renderer-safe values. Settings and subtitle selection do not change schema v1. Restarting a local item resets only the active attempt's position and watched flag; a load failure never flushes that attempt, so the previous `playback_state` row remains unchanged. Normal generation, EOF, close, and resume handling still apply.

Native track labels are display text only. Main removes path components from libmpv-provided title/language metadata before emitting them and never reads `external-filename` into a renderer DTO.

## Identity

`mediaId` matches `media_<UUID>` and is generated by the worker. An unchanged `(source root, relative path, size, modified time)` reuses the existing ID. A changed fingerprint marks the previous row unavailable and creates a new ID without inheriting playback state. Path resolution is main-only, canonicalizes the selected root and candidate, rejects reparse/symlink escapes, and returns no path when the indexed file or artwork is replaced by an unsafe link. A single-file import reuses the most specific existing ancestor source; if no ancestor exists, an overlapping root is rejected before creating a new source.

## Handoff

Ticket 02 may add metadata columns/records only through the schema owner and must preserve the opaque-ID and path boundary. Ticket 03 uses `getPlayback`/`savePlayback` keyed by `mediaId` plus the main-only `resolveMedia` method; it must not add a renderer path escape hatch or NAS progress write.
