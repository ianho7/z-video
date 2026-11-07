# Account-free local media app: implementation proposal

Date: 2026-10-31. Status: proposal for user review, not approved implementation. Baseline: 1dea6ea, Electron 45.1.0 / Koffi 3.3.5. No product code, dependencies, existing spec or settings changed.

## Product contract

Launch directly into a local library without account, login restoration, NAS discovery, ZSpace SDK, NAS HTTP API or online metadata provider. Accept folders on local disks and OS-readable shares. Read videos, NFO and artwork without modifying them. Save the app's library and viewing state under its own userData. No server, API key, account or separate database installation is required. Windows first; macOS remains a separate acceptance boundary.

This replaces the old spec/ADR 0002 premise that NAS owns library/history and that independent indexing is out of scope. Once approved, update spec.md, architecture.md, GLOSSARY.md and a new ADR; do not silently reinterpret the old NAS tickets. Use a new local-library feature branch/PR, retaining the current NAS branch for rollback. Do not combine both data backends behind a speculative provider framework.

## Recommended structure

Folders -> one Electron utility process (scanner, NFO parser, SQLite owner) -> main -> preload -> renderer library/detail.
Renderer playback mediaId -> main resolves file path -> existing native libmpv -> main -> local database progress.
Artwork keys -> main/local thumbnail cache -> renderer, with bounded decoding and fixed-aspect placeholders.

A utility process is justified because blocked network filesystem operations, XML parsing and synchronous database work must not hold the main window or native playback coordination. One worker owns the database; renderer never opens it. This changes more than eight files across startup, contracts, IPC, library, persistence, player and renderer; it is a product data-source replacement, not a login-screen edit.

Sources: Electron utilityProcess https://www.electronjs.org/docs/latest/api/utility-process ; Electron 45 Node runtime https://www.electronjs.org/blog/electron-45-0 ; Node SQLite https://nodejs.org/download/release/v22.14.0/docs/api/sqlite.html . Prefer bundled node:sqlite rather than an additional native SQLite addon. Implementation ticket 1 must verify the actual pinned Electron runtime/packaged utility process can open, query and reopen a small database; official capability is not a recorded package proof. Do not silently add an addon if unavailable.

Use a maintained XML parser rather than handwritten regex. fast-xml-parser is the selected dependency candidate, subject to exact release/security/API review and lockfile pinning in implementation; never evaluate NFO or resolve entities/remote URLs. Source: https://github.com/NaturalIntelligence/fast-xml-parser . Existing repo has neither local index nor XML dependency.

## User flow and first-release scope

First launch: Add folder and Open video; an empty library is useful without a NAS. Adding a root starts a visible, cancellable scan. Imported items appear progressively. On later launches show indexed results first; no mandatory network scan. Manual Refresh rescans changed metadata. Removing a source removes only its app records after an explicit app-level action, never disk files.

Browse movies, shows/seasons/episodes, title search, title/year/score/recently-added sort and Continue Watching. Queries cover the full local index, not only a loaded page. Existing style/cards/detail layout can be adapted. Keep current controls placement as an unresolved existing visual decision; no overlay redesign is implied by this proposal.

Metadata: common movie-name.nfo/movie.nfo, tvshow.nfo and episode-name.nfo; poster/fanart and common per-file art. Core title/year/plot/genre/rating/season/episode fields only. Explicit local NFO references take precedence over conventional names. Missing/invalid NFO does not hide a playable file; fall back to filename and placeholder, with a parse warning. Episode names support SxxExx and NxM. Ambiguous files go to Unclassified. Multiple candidate media files remain individually selectable; clever edition merging and multi-part chaining are deferred. NFO XML cannot cause network fetch or read outside selected roots. Do not assume server-only corrections, artwork or history are present beside videos.

Playback: reuse main-owned libmpv; direct file path/UNC only after main resolves an indexed opaque mediaId. Local video playback gains progress persistence, which existing openLocal currently lacks. Store position, duration, watched flag, selected track preferences and update time. Flush periodically and on pause/normal close/file switch; allow crash recovery to the last committed position. Failed loads with no valid position must not overwrite history. Restoring preferences must tolerate missing track IDs. No NAS progress writes or NFO writes.

## Storage, identity and scanning decisions

Tables/responsibilities: sources (root ID/path/availability), collections (title-level metadata), media_files (file ID/root/relative path/size/mtime/season/episode), artwork (source fingerprint/cache key), playback_state (file ID/position/duration/preferences/watched), scan_runs (generation/completion/errors). Keep DB on local disk, never in the share. Prepared queries and batched transactions; ordinary title search first, no additional search service.

Allocate persistent file IDs, match an unchanged root+relative path+size+mtime across scans. Metadata edits alone do not change file identity. A changed video fingerprint is treated as a replacement and does not inherit old progress automatically. Do not hash complete video files or promise identity across arbitrary renames/moves. Root relocation, content hashing and manual progress merge are deferred. NFO provider IDs can group metadata but never uniquely identify a playable file.

Scan asynchronously, stream directory entries and batch updates. Initial proposal: two filesystem tasks per source and two artwork jobs; these are tunable implementation defaults, not measured optimums. Never open every video for probing or extraction just to index it. Index changes progressively, with a separate successful traversal generation. Only an entirely successful traversal can mark unseen files missing. Cancellation, partial permission errors and share disconnect preserve previous entries/history. Missing entries are marked unavailable rather than destructively deleting progress. Do not follow directory links/reparse points outside selected roots; reject duplicate/overlapping roots in the first release.

Fixed-ratio card placeholders render without waiting for natural image dimensions. Cache downscaled poster variants locally, load visible/current-detail art first, bound decoding and cache size. Proposed thumbnail disk budget: 512 MiB, evict least-recently-used derivatives; database/history is not evicted. Do not eagerly copy full-resolution fanart or original video. Offline cached posters/index remain browsable, with explicit source-unavailable status. Busy source operations must not stall navigation/cancellation acknowledgment; blocked OS IO may finish later, and stale results must be ignored. No unconditional full scan on startup.

## Five delivery tickets and dependency graph

1. **Local foundation vertical slice:** approve/update product contract and glossary; utility process, runtime SQLite capability gate, owned local DB, folder picker, initial single-movie import, no-login library and local file identity. Dependent production startup performs no NAS/auth calls. This is the first demonstrable product, not infrastructure-only scaffolding.
2. **Metadata and incremental import** (after 1): NFO/artwork, movie/show/episode mapping, manual/cancellable rescans, bounded jobs, invalid-input and unavailable-root behavior. Own parser/scanner contracts.
3. **Local playback and persistent resume** (after 1, parallel with 2): indexed mediaId resolution, reuse libmpv, DB progress/reopen, failed-load preservation and track preferences. Own player boundary; coordinate shared contract/schema through integration.
4. **Usable indexed library** (after 2 and 3): full-index search/filter/sort, posters/cache, details/seasons, Continue Watching, offline and partial-scan feedback. Reuse existing renderer presentation; remove login-dependent navigation.
5. **Windows candidate and user-view acceptance** (after 4): package database worker/parser resources, isolated fresh-profile launch, actual read-only local/share sample, restart resume, loaded/offline responsiveness and measured cache/package size. Native overlay decision remains separately explicit.

Graph: 1 -> {2,3} -> 4 -> 5. If implementation is approved, use separate worktrees and visible agents for ready tickets. Do not create Issues or start implementers merely from this research request. No implementation duration commitment before the first compatibility/file-layout slice.

## Acceptance proof ownership (proposal)

- Real filesystem + local DB owner fixture: movie/show/bad NFO/missing art; repeat scan has no duplicates, changes update, cancellation/disconnect do not erase indexed items/history. Independently specified expected records, not parser-generated expectations.
- Actual isolated Electron window: fresh startup, folder selection/import, full-index query/detail, offline cached browse and responsive cancellation while a controlled source is slow. This owns UI/IPC integration, not duplicate parser semantics. Record request/interaction timings; no unsupported speed claim or real NAS load generation.
- Real native playback + fresh process reopen: known local sample reaches an observed position; close/reopen offers correct file and approximate saved position. Load failure preserves prior progress. This owns native/persistence lifecycle; no NAS writes.
- Packaged candidate: bundled utility process, node:sqlite and XML parser work outside the checkout, with userData isolated and GUI output written safely to files. Inventory package/development/cache sizes separately. This owns delivery-only failure modes, not a second full feature suite.

Use test-audit and acceptance-design gates before authoring tests; reuse still-valid native engine evidence. Proposed 2,000-item and 20,000-item synthetic metadata inventories check scaling of query/scan/window state; they do not prove real NAS latency or video decoding. A representative real folder is required before claiming practical NFO compatibility or UNC playback; read-only access scope must be chosen before scanning personal media.

## Limits and rollout

Most fragile assumption: files already contain enough NFO/artwork to recreate the desired library. Design survives missing files by filename/placeholder fallback; online scraping is a separate opt-in future feature. Existing NAS history/manual corrections are not automatically migrated. Cross-device progress, cloud accounts, writable metadata, automatic watchers, complex editions and additional platforms remain outside first release.

Keep previous branch and use separate local-library data directory; do not read/clear old encrypted NAS sessions. Rollback uses the previous app/branch without touching media files. Cache can grow up to its defined budget; Electron/libmpv still dominate the portable package, so no smaller installation size is promised. No credentials or OS SMB-policy changes are required by the app; inaccessible shares remain inaccessible until the user arranges OS access.

Pending approval: replace the old NAS-client product scope with this account-free local-library scope, Windows first, read-only media, local-only progress. Do not implement until the user decides.
