# Local library contracts

Status: Schema v5 (markers) on top of Schema v4 (source degraded), v3 (viewing ledger) plus the work-level Collection read contract (B1), work-level home shelves/continue watching (B2), cleanup rules/queue (A2), local playback IPC, accepted 2026-10-31 and extended 2026-11-01/2026-11-06/2026-11-08/2026-11-09/2026-11-10/2026-11-14/2026-11-15. Schema owners: `src/main/local-library-worker.ts`, `src/main/local-library-database.ts`, and `src/shared/local-library-contracts.ts`; cleanup owner: `src/shared/cleanup-contracts.ts` with the queue implemented by the local-library worker and rendered by `src/renderer/views/cleanup.ts`; playback owners: `src/main/player.ts`, `src/main/mpv-player.ts`, `src/main/player-host.ts`, `src/main/app-viewing-ledger.ts`, and `src/shared/local-playback-contracts.ts`; app-preferences owners: `src/main/app-preferences.ts`, `src/main/app-preferences-ipc.ts`, and `src/shared/app-preferences-contracts.ts`.

## Schema v5

The utility process creates these tables in the database under application `userData/local-library/library.sqlite`:

| Table | Foundation fields | Next owner |
|---|---|---|
| `sources` | `source_id`, `root_path` (main/worker only), `label`, `available`, `degraded`, timestamps | 02 scan |
| `collections` | `collection_id`, `title`, `kind`, optional year/`premiered_at`/plot/genre/rating, owner identity/source-relative grouping, timestamps | 02 metadata |
| `media_files` | `media_id`, `collection_id`, `source_id`, `relative_path` (main/worker only), display title/kind, optional season/episode, `size_bytes`, `modified_at_ms`, `available`, timestamps | 02 scan / 03 playback |
| `artwork` | `artwork_id`, collection/media owner, source-relative path (main/worker only), `kind`, source fingerprint/cache key | 02 metadata |
| `playback_state` | `media_id`, position/duration, audio/subtitle track IDs, watched, updated time | 03 playback |
| `scan_runs` | source, generation, completion, error, start/completion times | 02 scan |
| `viewing_sessions` | `session_id`, `media_id`, start/end/heartbeat times, wall/played seconds, start/end position, duration, completed, pause/seek counts, speed, close reason | A1 ledger |
| `media_history` | `media_id`, open/effective/completed/inspection counts, total played seconds, first/last-opened/last-played times, last-session duration/position, cleanup state/until, updated time | A1 ledger |
| `markers` | `media_id`, `position_sec` (whole seconds), `created_at`; primary key `(media_id, position_sec)`; `ON DELETE CASCADE` | 22a marker display / 22b actions |

`PRAGMA user_version` is `5`. The worker uses prepared statements and enables foreign keys. The first import creates one movie collection and one media file.

### v5 markers

- A Marker is one user-written point on a Media file. The table stores the opaque `media_id`, the whole-second `position_sec` and the creation time; it has no path, title, filename, source root or playback URI column, and those values never enter the renderer DTO. Markers are local-only: they are never written into media files, NFO, exports or network requests.
- `markers.media_id` is a foreign key to `media_files` with `ON DELETE CASCADE`, so deleting a file row deletes its markers. `removeSource` additionally deletes the source's marker rows explicitly in the same transaction as its media rows, and the file-replacement and scan-confirmed-missing paths delete the old identity's markers next to the A1 viewing rows. Removing a Source therefore leaves no marker rows, and no marker row can outlive the media row it belongs to.
- The primary key `(media_id, position_sec)` makes a second marker at the same whole second idempotent: re-adding it returns the existing record and keeps its original `createdAtMs` instead of writing a duplicate tick.
- Migration is incremental and idempotent: opening a v1/v2/v3/v4 database creates `markers` in the same pass that applies the older steps, and existing media rows and viewing history are untouched. Re-opening the same database is a no-op; a later client that only knows v4 refuses a v5 file instead of silently dropping markers.
- Schema v5 is only the storage contract. Rendering the ticks is Ticket 22a; seeking/deleting a marker, heat aggregation and waveforms stay out of this schema.
- The player's `B` shortcut records the current whole second through `local-library:markers-add` without pausing or opening a dialog. A failed write is shown in the existing visible player notice strip; a file without markers renders no tick layer at all.

### v4 source availability

- `sources.available` answers one question only: can the source root itself be read? `available = 0` means the whole folder is offline; its files keep their rows but cannot be played.
- `sources.degraded` separates "some subdirectories/files could not be read" from "offline". `degraded = 1` with `available = 1` means the indexed entries are still current and playable, but the last traversal was incomplete, so the index is not proven complete. The renderer must show "部分目录未读取" and must not call that state "文件夹离线".
- Scan outcome → source state: root not canonical/readable → `available = 0, degraded = 0` and the scan result is `unavailable`; traversal returned incomplete (subdirectory or file failed) → `available = 1, degraded = 1` and the scan result is `partial`; complete traversal → `available = 1, degraded = 0` and the result is `completed`.
- Because a partial scan is no longer offline, `WHERE sources.available = 1` in the cleanup queue keeps a partially readable folder's files queued.
- Migration is incremental and idempotent: opening a v3 database adds `sources.degraded INTEGER NOT NULL DEFAULT 0`, so existing rows read as not degraded and keep their data and viewing history. Re-opening the same database is a no-op; a later client that only knows v3 refuses a v4 file instead of silently dropping the column.

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
- `local-library:markers-list` → validates the opaque `mediaId` and returns `LocalMarker[]` ordered by `positionSec`. A well-formed but unknown media ID returns an empty list; a malformed value is rejected.
- `local-library:markers-add` → accepts `{ mediaId, positionSec, durationSec? }`, writes one whole-second marker and returns the renderer-safe `LocalMarker`. It rejects a non-opaque `mediaId`, an unknown or tombstoned media row, a non-integer or negative `positionSec`, a non-finite/negative `durationSec`, and a `positionSec` past a known duration (the caller's `durationSec` or the stored `playback_state.duration_sec`, whichever is larger). Positions are never clamped or rounded on the way in; the renderer converts the reported playback position to the current whole second. Re-adding the same second returns the existing record unchanged.

Renderer-visible `LocalMediaItem` fields are `mediaId`, `sourceId`, `collectionId`, title, kind, optional year, optional `premieredDate` (`YYYY-MM-DD` or `null`), optional plot/genres/rating/season/episode, artwork cache keys, size, modified time, and availability. `LocalMarker` is the renderer-safe marker record: `mediaId`, whole-second `positionSec`, and `createdAtMs` only; it carries no path, title, filename, source root or playback URI. Source summaries use a basename or a fixed drive/folder label; they never fall back to an absolute root. Absolute paths, UNC paths, source-relative paths, database rows, credentials, NAS signs, and raw playback URIs are never part of the public DTO. Worker, SQLite, filesystem and IPC errors are reduced to stable renderer-safe messages before entering state, scan results, or rejected IPC promises.

`LocalSourceSummary` carries `sourceId`, `label`, `locationHint`, `available`, `degraded`, `itemCount`, and `collectionCount` for the folder page. `available` is false only for an unreadable root; `degraded` is the partial-traversal flag from schema v4. `locationHint` only exposes a drive (`D 盘`) or a network-location marker plus the immediate parent folder name (`E 盘 · 上级：备份`); it never contains the full root. `collectionCount` counts works aggregated from that source's current files. `itemCount` counts current (non-tombstone) indexed files, including files whose rows are kept while a source is offline, so the folder counts and the removal confirmation agree. Both counts are computed by the worker from SQLite.

`local-library:source-refresh` rescans one registered folder. `local-library:rescan-all` rescans every registered folder in order and returns one `LocalScanResult` per folder; an unreadable folder returns `unavailable` without aborting the remaining folders.

`local-library:get` may include `detail.playback` for the requested opaque `mediaId` when local progress exists. The worker joins that state to the validated media row; the field contains only `LocalPlaybackState` and never a path or playback URI.

B4a adds optional `detail.episodePlayback`: the saved `LocalPlaybackState` for every file in the same collection, ordered by season/episode. Episodes with no saved row are omitted, so the detail page can render each episode's own watched/progress/unwatched state instead of borrowing the selected episode's state. Every entry is keyed by an opaque `mediaId` and carries only the existing playback fields; no path, relative path, URI, or raw SQL row enters the DTO.

### A1 viewing ledger contract

- `LocalViewingHistory` is the renderer-safe aggregate for one media file: `mediaId`, open/effective/completed/inspection counts, `totalPlayedSec`, first/last-opened/last-played times, last-session played/wall seconds, last position/duration, and `updatedAtMs`. It never carries a title, filename, path, source root, or raw session row.
- `local-library:get` adds optional `detail.viewing` only when at least one session has been recorded for the selected media. A cleanup mark on a never-played file creates a zero aggregate row for the mark but is not presented as a viewing record. The view is read-only; the renderer cannot write counts or mark a file watched through this DTO. The existing `playback_state.watched` flag and the `detail.playback`/`detail.episodePlayback` progress contract are preserved.
- Session capture stays in main: `AppViewingLedger` receives renderer-safe observations from the local player (`mediaId`, positions, duration, play/pause state, seek/pause counts, speed) and calls the local-library owner. The renderer never sends a path to the ledger.
- Effective watch = played at least 30 seconds and at least 3% of a known duration. Completion = the native player reported `ended`, or end position is at least 90% with at least 30 played seconds. Seeking to the end without real playback never completes. Paused, buffering, and wall-clock-only time are not counted as played time. One pure function (`isCompletedWatch`) is the only completion rule; the live close, the aggregate write, and the interrupted-session recovery all use the same conclusion, so a stored `viewing_sessions.completed` value and its aggregate never disagree. A load failure (`close_reason = "error"`) never completes: its end position came from the resume point, not from playback.
- `playback_state.subtitle_track_id` keeps the three-way choice without a schema change: a track ID is stored verbatim, an explicit "subtitles off" (`null` in the DTO) is stored as the `"off"` sentinel, and "never chosen" (`undefined`) stays NULL. Reading maps `"off"` back to `null` and NULL back to an absent field, so the renderer contract remains `string | null | undefined` and a restart keeps subtitles off.
- The player writes a lightweight heartbeat every 10 seconds and on close; an unfinished session is recovered as `interrupted` on the next database initialization. Session close reasons are `ended`, `user-close`, `error`, `app-quit`, and `interrupted`.
- When there is no aggregate but a legacy `playback_state` row exists, the detail renders it only as "上次看到（旧记录）"; it never invents open counts or accumulated time from old progress.

### A2 cleanup rules and queue contract

- Cleanup settings live in the application preference file (`userData/app-preferences.json`) under `cleanup`: `preset` (`conservative`/`standard`/`aggressive`/`custom`), `thresholds`, `rules` (`A`–`E` booleans), `snoozeDays` (default 30), and `keepDays` (default 180). They are validated before persistence and never written to a media table. Cleanup adds no table, column, or tombstone of its own; schema v5 is unchanged by cleanup.
- Three presets write the documented thresholds: conservative 4/8/15 GB and 60/180/365 days, standard 2/5/10 GB and 30/90/180 days, aggressive 1/3/5 GB and 14/60/120 days; the remaining rows follow the spec table (open ceilings, glance/low-return limits, effective-watch and completion percentages, relative-large percentile). Any manual threshold edit marks the preset `custom`; "恢复默认" restores the standard preset and the default snooze/keep days.
- `local-library:cleanup-queue` accepts a bounded `{ page, pageSize, rule: "all"|A–E, state: "none"|keep|snooze|delete-candidate }` (default page 1 / 50, max 100) and returns `LocalCleanupQueue`: the page of candidates, `totalCount`, `totalBytes`, the full `deleteQueue` (count/bytes plus at most 200 entries), and the `relativeLargeBytes` cutoff when the library has at least 20 current files. The queue only reads media files whose `media_files.available = 1` and whose source is available; offline or scan-confirmed-missing files never enter the counts.
- Candidate facts come from the A1 ledger. The active queue takes only files whose effective cleanup state is `none` and that match an enabled rule; `snooze` hides a file until its `cleanup_until` and then returns it to the queue, while `keep` hides it permanently and `delete-candidate` stays in the delete list. Explicit keep/snooze/delete-candidate filters expose marked files so a mark can be undone.
- Rule order is also display priority: C → D → A → B → E; within one rule, candidates sort by size descending and then by opaque media ID. There is no aggregate "recommendation score". Rules: A never opened (open 0, added ≥ protection days, size ≥ large); B only glanced (open ≥ 1, effective watches 0, played < glance limit, last opened ≥ protection days, size ≥ large); C few opens + large (open ≤ few-open limit, never completed, last opened ≥ stale days, size ≥ very large); D large low return (size ≥ very large, played < low-return limit, open ≤ low-return open ceiling); E completed but low revisit (completed ≥ 1, last opened ≥ strong-stale days, size ≥ very large, open ≤ low-revisit ceiling). A/B use `max(largeBytes, relativeLargeBytes)` when the relative cutoff exists.
- `LocalCleanupCandidate` carries the existing renderer-safe `LocalMediaItem`, the optional `LocalViewingHistory` (omitted when the file was never played), `rule`, `cleanupState`, optional `cleanupUntilMs`, and `addedAtMs`; it never carries a title-only path, filename, source root, or raw row. Every card states the matched rule, its current threshold, and the file's own numbers.
- `local-library:cleanup-set-state` validates an opaque `mediaId` and `{ state }`, stores keep/snooze/delete-candidate on `media_history` in the same utility process, and returns the refreshed queue. `snooze` sets `cleanup_until = now + configured days`; `keep` is terminal and stores no deadline; `none` clears the mark; deleting is never performed by the app.
- `keep` never returns to the queue: `effectiveCleanupState` maps `keep` to `keep` regardless of `cleanup_until`, so a deadline written by an older client cannot resurrect the file. `snooze` still falls back to `none` when its window closes, and `delete-candidate` never expires. Saved `cleanupSettings.keepDays` stays part of the preference file but no longer defines a keep window, and the copy for a kept file is "已保留" with no "保留至 X 天".
- `local-library:cleanup-reveal` resolves the indexed path in main and calls the OS Explorer reveal; the renderer only receives `{ revealed: boolean }`. No path, root, or file URI crosses the bridge.
- `app-preferences:set-cleanup` validates and persists the complete cleanup settings. `app-preferences:get` now includes `cleanup`; older preference files without it default to the standard preset.
- The cleanup result's effective-watch and completion threshold fields are part of the saved preset/settings snapshot. The A1 ledger keeps its fixed contract (30 seconds + 3% effective, 90% completion) so adjusting cleanup rules never rewrites recorded history; the A–E rules consume the recorded counters.

### A3 review-mode contract

- Review mode is not a new route, IPC channel, or DTO. A cleanup candidate's own `LocalViewingHistory` (already part of `LocalCleanupCandidate`) supplies the strip's facts; the renderer must not derive counts or accumulated played time from playback events. "第 N 次打开" names the open currently in progress, so it is the recorded `openCount` plus this one open; `totalPlayedSec` and `lastOpenedAtMs` are shown verbatim.
- A review starts only from a cleanup candidate's `打开检查` action (or the focused card plus Enter/Space). Normal detail/home playback never shows the strip. The strip shares the mirrored player heading, so the existing sandboxed overlay mirrors it without a new overlay contract; it sits above the playback controls and must stay inside a 900×640 window.
- Closing a review attempt always returns to the cleanup queue and opens one decision: `保留` / `稍后` / `待删` / `返回队列`. The mark is written through the existing `local-library:cleanup-set-state` owner path (same `media_history.cleanup_state` persistence and same snooze/keep windows). `待删` only joins the delete list; the app never deletes, moves, or renames a file. `返回队列` and Escape write no mark.
- A successful decision shows the marked-state filter so the original candidate card stays visible; keyboard focus returns to that card. A failed mark keeps the decision open with a retry; a failed playback open returns to the same decision instead of losing the review.
- Review facts and decision copy never carry a path, filename other than the already-safe renderer title, raw session row, or root.
- No schema, DTO, IPC channel, or cleanup-rule change is introduced by A3.

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

Ticket 02 adds main-owned `scanFolder`, `cancelScan`, and bounded `onScanProgress` operations. A scan progress/result reports counts, warnings, and `completed`/`cancelled`/`partial`/`unavailable` status without exposing a root path; `sourceLabel` is the same renderer-safe source label used by state and never a path. A successful traversal is the only operation allowed to mark unseen files unavailable; cancellation, permission errors, and disconnected roots preserve existing rows and playback state. If a source becomes partially unreadable during traversal, the scan result is `partial` and the source is `available = 1, degraded = 1` (its indexed entries stay playable) until a later complete refresh clears the flag; only an unreadable root sets `available = 0`.

### Scan and index safety

- **A per-file index failure is not a deletion.** When `discoverMedia`/`upsertMedia` throws for one file (NFO parse error, `SQLITE_BUSY`, …), that file's source-relative path still counts as seen for this traversal. Reconcile therefore never marks its row `available = 0` and never deletes its `viewing_sessions`/`media_history`, and the scan can still finish `completed` with a warning.
- **Cancellation has a terminal window.** `cancelScan` answers `true` only while the traversal can still observe the request. Once traversal returns, the reconcile transaction and the result are uninterruptible, so `cancel-scan` answers `false`; a scan never reports `true` from `cancelScan` and still finishes `completed`.
- **Import and scan never write concurrently.** `import-video`/`import-first-movie` reject with a readable message while a scan is active instead of racing `sources.available` and `media_files`.
- **Import never rewrites scan metadata.** Opening an already indexed file reuses its existing work and media row and only fills missing values: `collections.title`, `kind`, `identity_key`, `year`, `premiered_at`, `plot`, `genre_json`, and `rating` keep the values a scan wrote (empty optional fields are still filled), and `media_files.display_title`, `media_kind`, `season_number`, and `episode_number` keep their NFO- or filename-derived values. A scan remains the metadata owner and still replaces them.
- **`scan_runs` is readable at startup.** A run that never reached `finishScan` (worker crash or forced quit) is closed on the next initialization with `completed = 0`, `error = 'interrupted'`, and `completed_at` set; the newest run of each affected source additionally marks that source `degraded = 1`, so the next successful scan re-reconciles and the UI never claims the folder was fully read. `generation` is the per-source attempt counter used to find each source's newest run.
- **Reconcile is batched.** The seen-path set is written to a per-connection `TEMP` table, so a ~20k-file library never builds a `NOT IN (?,…)` list that exceeds SQLite's bound-variable limit and rolls the transaction back.

### `available` across list, detail and counts

`media_files.available` and `sources.available` answer different questions, and the read paths use them as follows:

- `media_files.available = 0` is a tombstone: the file was replaced (fingerprint change) or a readable scan confirmed it is missing. A tombstone keeps its row so old playback/ledger rows stay attributable, but it is not a card anywhere.
- `sources.available = 0` is an offline folder. Its files keep `media_files.available = 1`, stay listed, and render greyed out / not playable; the copy must say the folder is offline, not that the file is missing.
- `local-library:list` returns only `media_files.available = 1` rows, in both the page and `totalCount`. Replacing a file therefore shows one card, never the old row.
- `local-library:list-collections` counts a work's files with the current-file rule: `episodeCount` and `availableEpisodeCount` both count `media_files.available = 1` (so `episodeCount` no longer includes tombstones; `availableEpisodeCount` additionally requires an available source, which is what makes an offline work show as not playable). A work whose files are all tombstones is absent from `items` and from `totalCount`. Episode-level search matches, `watchedEpisodeCount`, `resume`, and `representativeMediaId` consider current files only.
- `local-library:get` lists `detail.episodes` and `detail.episodePlayback` for current files only. Requesting a tombstone media ID or a work with no current file is an explicit unavailable result (`detail` is absent, so `state` plus the missing detail carry the answer) rather than a successful empty episode list. The detail of a current file inside an offline source still loads; its `item.available` is false and the episodes are not playable.
- `sources.itemCount`/`collectionCount` follow the current-file rule for the same reason.
- No filter or entry point exposes tombstones to the renderer; there is no "invalid files" screen and no tombstone GC in this scope.

## Local playback IPC

`window.zVideo.localPlayback` is the renderer's only playback bridge. `local-playback:open` accepts an opaque `mediaId` and an optional `{ restart?: boolean }`; main resolves its private path through the local-library owner and passes it directly to libmpv. With `restart: true`, main ignores the saved position and starts at zero. `local-playback:command` accepts play, pause, seek, audio/subtitle track, fullscreen, close, and these settings controls:

- `set-volume`: finite number from 0 through 100.
- `set-muted`: boolean.
- `set-speed`: finite number from 0.25 through 3.

`local-playback:event` may emit `{ type: "settings", mediaId, volume, muted, speed }`. These values are read from libmpv's `volume`, `mute`, and `speed` properties; the renderer does not treat a requested value as applied until this event arrives. Main serially persists the confirmed values and library sort under `userData/app-preferences.json`; they are not written to SQLite. Missing or invalid JSON uses safe defaults. Renderer can read the snapshot through `app-preferences:get`, update only the validated sort through `app-preferences:set-sort`, and update cleanup thresholds/rules through `app-preferences:set-cleanup` (see the A2 section).

Non-fatal playback-control or subtitle failures use `{ type: "control-error", mediaId, message }`; they do not mark the media load as failed or disable playback controls.

`local-playback:choose-subtitle-file` opens a main-owned picker limited to SRT, ASS, SSA, VTT, and SUB. The selected path remains in main and is passed to libmpv through `addSubtitleFile`; it is never sent through preload or a renderer event. Cancellation, no active playback, or a playback switch while the picker is open returns `{ loaded: false }` without loading a subtitle into the replacement media. A current selection returns `{ loaded: true }` after libmpv accepts it.

Playback events, including settings, contain only the active opaque `mediaId` and renderer-safe values. Settings, track preferences, and subtitle selection store no new schema columns (schema v5 adds only the Ticket 22a `markers` table). Restarting a local item resets only the active attempt's position and watched flag; a load failure never flushes that attempt, so the previous `playback_state` row remains unchanged. Normal generation, EOF, close, and resume handling still apply.

Native track labels are display text only. Main removes path components from libmpv-provided title/language metadata before emitting them and never reads `external-filename` into a renderer DTO.

## Worker and cache lifecycle

- The utility process is the only SQLite owner. `LocalLibraryDatabase` starts it once and every command is a bounded round trip: an ordinary call rejects with the stable `sqlite-unavailable` message after 30 seconds, while a full-root scan/import gets a 30-minute traversal bound. A wedged worker therefore ends the renderer's busy state instead of blocking it forever.
- An unexpected worker exit — including exit code 0 — rejects every pending call and moves `LocalLibraryState` to `status: "error"` / `sqliteAvailable: false` with an actionable message, then notifies `onState` listeners. It never keeps reporting `ready`.
- The next owner operation after a crash performs exactly one controlled restart. A successful start republishes the real state; a failed one keeps the error state visible and re-raises it to the caller. `close()` marks the instance closed, so its own teardown kill is not treated as a crash and no restart races it.
- `LocalArtworkCache` retries initialization after a failure (a rejected directory creation is not latched forever), merges concurrent loads of the same `cacheKey` into one source read and one decode, and refreshes an explicit last-use marker on a disk hit so eviction drops the least recently used cover instead of the oldest written one.

## Identity

`mediaId` matches `media_<UUID>` and is generated by the worker. An unchanged `(source root, relative path, size, modified time)` reuses the existing ID. A changed fingerprint marks the previous row unavailable and creates a new ID without inheriting playback state. Path resolution is main-only, canonicalizes the selected root and candidate, rejects reparse/symlink escapes, and returns no path when the indexed file or artwork is replaced by an unsafe link. A single-file import reuses the most specific existing ancestor source; if no ancestor exists, an overlapping root is rejected before creating a new source.

## Handoff

Ticket 02 may add metadata columns/records only through the schema owner and must preserve the opaque-ID and path boundary. Ticket 03 uses `getPlayback`/`savePlayback` keyed by `mediaId` plus the main-only `resolveMedia` method; it must not add a renderer path escape hatch or NAS progress write.
