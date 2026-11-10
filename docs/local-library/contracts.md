# Local library contracts

Status: Schema v3 (viewing ledger) plus the work-level Collection read contract (B1), work-level home shelves/continue watching (B2), cleanup rules/queue (A2), local playback IPC, accepted 2026-10-31 and extended 2026-11-01/2026-11-06/2026-11-08/2026-11-09/2026-11-10. Schema owners: `src/main/local-library-worker.ts`, `src/main/local-library-database.ts`, and `src/shared/local-library-contracts.ts`; cleanup owner: `src/shared/cleanup-contracts.ts` with the queue implemented by the local-library worker and rendered by `src/renderer/views/cleanup.ts`; playback owners: `src/main/player.ts`, `src/main/mpv-player.ts`, `src/main/player-host.ts`, `src/main/app-viewing-ledger.ts`, and `src/shared/local-playback-contracts.ts`; app-preferences owners: `src/main/app-preferences.ts`, `src/main/app-preferences-ipc.ts`, and `src/shared/app-preferences-contracts.ts`.

## Schema v3

The utility process creates these tables in the database under application `userData/local-library/library.sqlite`:

| Table | Foundation fields | Next owner |
|---|---|---|
| `sources` | `source_id`, `root_path` (main/worker only), `label`, `available`, timestamps | 02 scan |
| `collections` | `collection_id`, `title`, `kind`, optional year/`premiered_at`/plot/genre/rating, owner identity/source-relative grouping, timestamps | 02 metadata |
| `media_files` | `media_id`, `collection_id`, `source_id`, `relative_path` (main/worker only), display title/kind, optional season/episode, `size_bytes`, `modified_at_ms`, `available`, timestamps | 02 scan / 03 playback |
| `artwork` | `artwork_id`, collection/media owner, source-relative path (main/worker only), `kind`, source fingerprint/cache key | 02 metadata |
| `playback_state` | `media_id`, position/duration, audio/subtitle track IDs, watched, updated time | 03 playback |
| `scan_runs` | source, generation, completion, error, start/completion times | 02 scan |
| `viewing_sessions` | `session_id`, `media_id`, start/end/heartbeat times, wall/played seconds, start/end position, duration, completed, pause/seek counts, speed, close reason | A1 ledger |
| `media_history` | `media_id`, open/effective/completed/inspection counts, total played seconds, first/last-opened/last-played times, last-session duration/position, cleanup state/until, updated time | A1 ledger |

`PRAGMA user_version` is `3`. The worker uses prepared statements and enables foreign keys. The first import creates one movie collection and one media file.

### v3 viewing ledger

- `viewing_sessions.media_id` and `media_history.media_id` are foreign keys to `media_files` with `ON DELETE CASCADE`. Both tables are owned by the local-library utility process; the renderer never reads a raw row.
- Migration is incremental and idempotent: a v1 database gains `collections.premiered_at` (v2) and then the two viewing tables (v3). Existing rows are untouched and no viewing history is backfilled from `playback_state`, so old progress never fabricates open counts or accumulated time.
- No global totals, yearly report, deleted-work archive, `history_key`, or tombstone table exists. Removing a file/source deletes its sessions and aggregate; a re-added file starts a new record.
- A source that is merely offline keeps its rows. A readable scan that completes without seeing an indexed file confirms the deletion: the worker removes that media's `viewing_sessions` and `media_history` in the same transaction that marks the media row unavailable. Removing a source deletes playback and viewing rows explicitly.
- A session left open by a crash (no `ended_at`) is settled at the next initialization from its last heartbeat: `close_reason = interrupted`, `ended_at = last_heartbeat_at`, and its counters are folded into `media_history` exactly once.

## Public IPC

Channels are defined in `src/shared/ipc-channels.ts` and exposed through `window.zVideo.localLibrary`:

- `local-library:state` → `LocalLibraryState`; reports schema version, SQLite availability, safe source labels/counts, and an actionable storage error.
- `local-library:choose-folder` → opens a main-owned directory picker and starts a visible, cancellable full-root scan; progress is emitted through `onScanProgress` and the final result reports `completed`/`cancelled`/`partial`/`unavailable` without a root path.
- `local-library:open-video` → opens a main-owned video picker and imports the selected file under its parent root.
- `local-library:list` → validates bounded page/query input, including `sort`, and returns `LocalLibraryPage` with renderer-safe items. `released_desc` is valid under schema v2+.
- `local-library:get` → validates opaque `mediaId` and returns one renderer-safe item; missing media is not a path error.

Renderer-visible `LocalMediaItem` fields are `mediaId`, `sourceId`, `collectionId`, title, kind, optional year, optional `premieredDate` (`YYYY-MM-DD` or `null`), optional plot/genres/rating/season/episode, artwork cache keys, size, modified time, and availability. Source summaries use a basename or a fixed drive/folder label; they never fall back to an absolute root. Absolute paths, UNC paths, source-relative paths, database rows, credentials, NAS signs, and raw playback URIs are never part of the public DTO. Worker, SQLite, filesystem and IPC errors are reduced to stable renderer-safe messages before entering state, scan results, or rejected IPC promises.

`LocalSourceSummary` adds `locationHint` and `collectionCount` for the folder page. `locationHint` only exposes a drive (`D 盘`) or a network-location marker plus the immediate parent folder name (`E 盘 · 上级：备份`); it never contains the full root. `collectionCount` counts works aggregated from that source's files. `itemCount` counts indexed files, including files whose rows are kept while a source is offline, so the folder counts and the removal confirmation agree. Both counts are computed by the worker from SQLite.

`local-library:source-refresh` rescans one registered folder. `local-library:rescan-all` rescans every registered folder in order and returns one `LocalScanResult` per folder; an unreadable folder returns `unavailable` without aborting the remaining folders.

`local-library:get` may include `detail.playback` for the requested opaque `mediaId` when local progress exists. The worker joins that state to the validated media row; the field contains only `LocalPlaybackState` and never a path or playback URI.

B4a adds optional `detail.episodePlayback`: the saved `LocalPlaybackState` for every file in the same collection, ordered by season/episode. Episodes with no saved row are omitted, so the detail page can render each episode's own watched/progress/unwatched state instead of borrowing the selected episode's state. Every entry is keyed by an opaque `mediaId` and carries only the existing playback fields; no path, relative path, URI, or raw SQL row enters the DTO.

### A1 viewing ledger contract

- `LocalViewingHistory` is the renderer-safe aggregate for one media file: `mediaId`, open/effective/completed/inspection counts, `totalPlayedSec`, first/last-opened/last-played times, last-session played/wall seconds, last position/duration, and `updatedAtMs`. It never carries a title, filename, path, source root, or raw session row.
- `local-library:get` adds optional `detail.viewing` only when at least one session has been recorded for the selected media. A cleanup mark on a never-played file creates a zero aggregate row for the mark but is not presented as a viewing record. The view is read-only; the renderer cannot write counts or mark a file watched through this DTO. The existing `playback_state.watched` flag and the `detail.playback`/`detail.episodePlayback` progress contract are preserved.
- Session capture stays in main: `AppViewingLedger` receives renderer-safe observations from the local player (`mediaId`, positions, duration, play/pause state, seek/pause counts, speed) and calls the local-library owner. The renderer never sends a path to the ledger.
- Effective watch = played at least 30 seconds and at least 3% of a known duration. Completion = the native player reported `ended`, or end position is at least 90% with at least 30 played seconds. Seeking to the end without real playback never completes. Paused, buffering, and wall-clock-only time are not counted as played time.
- The player writes a lightweight heartbeat every 10 seconds and on close; an unfinished session is recovered as `interrupted` on the next database initialization. Session close reasons are `ended`, `user-close`, `error`, `app-quit`, and `interrupted`.
- When there is no aggregate but a legacy `playback_state` row exists, the detail renders it only as "上次看到（旧记录）"; it never invents open counts or accumulated time from old progress.

### A2 cleanup rules and queue contract

- Cleanup settings live in the application preference file (`userData/app-preferences.json`) under `cleanup`: `preset` (`conservative`/`standard`/`aggressive`/`custom`), `thresholds`, `rules` (`A`–`E` booleans), `snoozeDays` (default 30), and `keepDays` (default 180). They are validated before persistence and never written to a media table. Schema stays v3: no new table, no tombstone, and no global statistic.
- Three presets write the documented thresholds: conservative 4/8/15 GB and 60/180/365 days, standard 2/5/10 GB and 30/90/180 days, aggressive 1/3/5 GB and 14/60/120 days; the remaining rows follow the spec table (open ceilings, glance/low-return limits, effective-watch and completion percentages, relative-large percentile). Any manual threshold edit marks the preset `custom`; "恢复默认" restores the standard preset and the default snooze/keep days.
- `local-library:cleanup-queue` accepts a bounded `{ page, pageSize, rule: "all"|A–E, state: "none"|keep|snooze|delete-candidate }` (default page 1 / 50, max 100) and returns `LocalCleanupQueue`: the page of candidates, `totalCount`, `totalBytes`, the full `deleteQueue` (count/bytes plus at most 200 entries), and the `relativeLargeBytes` cutoff when the library has at least 20 current files. The queue only reads media files whose `media_files.available = 1` and whose source is available; offline or scan-confirmed-missing files never enter the counts.
- Candidate facts come from the A1 ledger. The active queue takes only files whose effective cleanup state is `none` and that match an enabled rule; keep/snooze hide a file until their `cleanup_until`, after which it returns to the queue. Explicit keep/snooze/delete-candidate filters expose marked files so a mark can be undone.
- Rule order is also display priority: C → D → A → B → E; within one rule, candidates sort by size descending and then by opaque media ID. There is no aggregate "recommendation score". Rules: A never opened (open 0, added ≥ protection days, size ≥ large); B only glanced (open ≥ 1, effective watches 0, played < glance limit, last opened ≥ protection days, size ≥ large); C few opens + large (open ≤ few-open limit, never completed, last opened ≥ stale days, size ≥ very large); D large low return (size ≥ very large, played < low-return limit, open ≤ low-return open ceiling); E completed but low revisit (completed ≥ 1, last opened ≥ strong-stale days, size ≥ very large, open ≤ low-revisit ceiling). A/B use `max(largeBytes, relativeLargeBytes)` when the relative cutoff exists.
- `LocalCleanupCandidate` carries the existing renderer-safe `LocalMediaItem`, the optional `LocalViewingHistory` (omitted when the file was never played), `rule`, `cleanupState`, optional `cleanupUntilMs`, and `addedAtMs`; it never carries a title-only path, filename, source root, or raw row. Every card states the matched rule, its current threshold, and the file's own numbers.
- `local-library:cleanup-set-state` validates an opaque `mediaId` and `{ state }`, stores keep/snooze/delete-candidate on `media_history` in the same utility process, and returns the refreshed queue. `keep`/`snooze` set `cleanup_until = now + configured days`; `none` clears the mark; deleting is never performed by the app.
- `local-library:cleanup-reveal` resolves the indexed path in main and calls the OS Explorer reveal; the renderer only receives `{ revealed: boolean }`. No path, root, or file URI crosses the bridge.
- `app-preferences:set-cleanup` validates and persists the complete cleanup settings. `app-preferences:get` now includes `cleanup`; older preference files without it default to the standard preset.
- The cleanup result's effective-watch and completion threshold fields are part of the saved preset/settings snapshot. The A1 ledger keeps its fixed contract (30 seconds + 3% effective, 90% completion) so adjusting cleanup rules never rewrites recorded history; the A–E rules consume the recorded counters.

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
- `local-library:continue-watching` is work-level too: it validates no input and returns at most one in-progress entry per Collection, keeping the most recently updated episode. A Collection enters only after at least 30 seconds of progress, or at least 3% for a work shorter than ten minutes. Each entry keeps its opaque episode `item`, `playback`, plus `collectionTitle`, `collectionKind`, `episodeTitle`, and optional season/episode numbers; it never carries a path or source root. The home shelf renders these as work cards and its count matches the returned entries.
- No absolute path, UNC path, source-relative path, SQL row, or scan root enters the DTO or a rejected IPC promise.

Ticket 02 adds main-owned `scanFolder`, `cancelScan`, and bounded `onScanProgress` operations. A scan progress/result reports counts, warnings, and `completed`/`cancelled`/`partial`/`unavailable` status without exposing a root path; `sourceLabel` is the same renderer-safe source label used by state and never a path. A successful traversal is the only operation allowed to mark unseen files unavailable; cancellation, permission errors, and disconnected roots preserve existing rows and playback state. If a source becomes unreadable during traversal, the scan remains partial and the source is reported unavailable until a later successful refresh.

## Local playback IPC

`window.zVideo.localPlayback` is the renderer's only playback bridge. `local-playback:open` accepts an opaque `mediaId` and an optional `{ restart?: boolean }`; main resolves its private path through the local-library owner and passes it directly to libmpv. With `restart: true`, main ignores the saved position and starts at zero. `local-playback:command` accepts play, pause, seek, audio/subtitle track, fullscreen, close, and these settings controls:

- `set-volume`: finite number from 0 through 100.
- `set-muted`: boolean.
- `set-speed`: finite number from 0.25 through 3.

`local-playback:event` may emit `{ type: "settings", mediaId, volume, muted, speed }`. These values are read from libmpv's `volume`, `mute`, and `speed` properties; the renderer does not treat a requested value as applied until this event arrives. Main serially persists the confirmed values and library sort under `userData/app-preferences.json`; they are not written to SQLite. Missing or invalid JSON uses safe defaults. Renderer can read the snapshot through `app-preferences:get`, update only the validated sort through `app-preferences:set-sort`, and update cleanup thresholds/rules through `app-preferences:set-cleanup` (see the A2 section).

Non-fatal playback-control or subtitle failures use `{ type: "control-error", mediaId, message }`; they do not mark the media load as failed or disable playback controls.

`local-playback:choose-subtitle-file` opens a main-owned picker limited to SRT, ASS, SSA, VTT, and SUB. The selected path remains in main and is passed to libmpv through `addSubtitleFile`; it is never sent through preload or a renderer event. Cancellation, no active playback, or a playback switch while the picker is open returns `{ loaded: false }` without loading a subtitle into the replacement media. A current selection returns `{ loaded: true }` after libmpv accepts it.

Playback events, including settings, contain only the active opaque `mediaId` and renderer-safe values. Settings and subtitle selection do not change schema v1. Restarting a local item resets only the active attempt's position and watched flag; a load failure never flushes that attempt, so the previous `playback_state` row remains unchanged. Normal generation, EOF, close, and resume handling still apply.

Native track labels are display text only. Main removes path components from libmpv-provided title/language metadata before emitting them and never reads `external-filename` into a renderer DTO.

## Identity

`mediaId` matches `media_<UUID>` and is generated by the worker. An unchanged `(source root, relative path, size, modified time)` reuses the existing ID. A changed fingerprint marks the previous row unavailable and creates a new ID without inheriting playback state. Path resolution is main-only, canonicalizes the selected root and candidate, rejects reparse/symlink escapes, and returns no path when the indexed file or artwork is replaced by an unsafe link. A single-file import reuses the most specific existing ancestor source; if no ancestor exists, an overlapping root is rejected before creating a new source.

## Handoff

Ticket 02 may add metadata columns/records only through the schema owner and must preserve the opaque-ID and path boundary. Ticket 03 uses `getPlayback`/`savePlayback` keyed by `mediaId` plus the main-only `resolveMedia` method; it must not add a renderer path escape hatch or NAS progress write.
