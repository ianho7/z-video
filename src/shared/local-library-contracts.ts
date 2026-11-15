import type {
  LocalCleanupQueueQuery,
  LocalCleanupQueueResult,
  LocalCleanupRevealResult,
  LocalCleanupStateInput,
} from "./cleanup-contracts";

/**
 * Shared local-library contracts. Renderer-facing records intentionally omit
 * absolute paths and source-relative paths; only main/utility-process owners
 * may resolve those values.
 */

export const LOCAL_LIBRARY_SCHEMA_VERSION = 5 as const;

export const LOCAL_LIBRARY_SCHEMA_TABLES = [
  "sources",
  "collections",
  "media_files",
  "artwork",
  "playback_state",
  "scan_runs",
  "viewing_sessions",
  "media_history",
  "markers",
] as const;

export type LocalLibrarySchemaTable = (typeof LOCAL_LIBRARY_SCHEMA_TABLES)[number];

export function isOpaqueMediaId(value: unknown): value is `media_${string}` {
  return typeof value === "string"
    && /^media_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * One user-written point on a Media file (schema v5). The renderer-safe record
 * carries only the opaque media ID, the whole-second position and the creation
 * time; it never includes a path, title, filename, source root or playback URI.
 */
export interface LocalMarker {
  mediaId: `media_${string}`;
  /** Whole seconds from the start of the file. */
  positionSec: number;
  createdAtMs: number;
}

/**
 * Add-marker input. `durationSec` is a validation bound only (the renderer knows
 * the duration the player reported); it is never stored on the marker record.
 */
export interface LocalMarkerInput {
  mediaId: `media_${string}`;
  positionSec: number;
  durationSec?: number;
}

/**
 * Delete-marker input. A marker's identity is its Media file plus whole second,
 * so the same opaque id + `positionSec` pair that created it removes it.
 */
export interface LocalMarkerDeleteInput {
  mediaId: `media_${string}`;
  positionSec: number;
}

/** Marker positions are whole, non-negative seconds; fractions are rejected, never rounded. */
export function isMarkerPositionSec(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A usable duration bound is finite and non-negative; NaN/Infinity never silently disables the check. */
export function isMarkerDurationSec(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * The single marker range rule shared by the IPC parser and the SQLite owner.
 * A marker is rejected when it has no whole-second position, when it is
 * negative, or when a known duration proves it lies past the end of the file.
 * The value is never clamped: an out-of-range position is an error.
 */
export function isMarkerWithinDuration(positionSec: number, durationSec?: number): boolean {
  if (!isMarkerPositionSec(positionSec)) return false;
  if (durationSec === undefined || !isMarkerDurationSec(durationSec) || durationSec <= 0) return true;
  return positionSec <= durationSec;
}

export type LocalLibraryStatus = "ready" | "error";

export interface LocalSourceSummary {
  sourceId: string;
  label: string;
  /** Drive or parent-folder clue only; never a full/relative root path. */
  locationHint: string;
  /**
   * False only when the source root itself cannot be read: the whole folder is
   * offline and its files cannot be played.
   */
  available: boolean;
  /**
   * True when the last scan could read the root but not every subdirectory or
   * file (or when a previous scan never finished). Indexed files stay playable;
   * the UI must show "部分目录未读取" rather than "离线". Schema v4.
   */
  degraded: boolean;
  /** Current (non-tombstone) files for this source, including files kept while the source is offline. */
  itemCount: number;
  /** Works (collections) aggregated from this source's current indexed files. */
  collectionCount: number;
}

export type LocalMediaKind = "movie" | "show" | "episode" | "unclassified";

export type LocalLibraryFilter = "all" | LocalMediaKind;
export type LocalLibrarySort = "recent" | "title" | "year_desc" | "score_desc" | "added_desc" | "released_desc";

export interface LocalArtworkReference {
  kind: "poster" | "fanart";
  cacheKey: string;
}

export interface LocalMediaItem {
  mediaId: `media_${string}`;
  sourceId: string;
  collectionId: string;
  title: string;
  kind: LocalMediaKind;
  sizeBytes: number;
  modifiedAtMs: number;
  available: boolean;
  year?: number;
  /** NFO premiere date as YYYY-MM-DD; null when the source has no real date. */
  premieredDate?: string | null;
  plot?: string;
  genres?: string[];
  rating?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  artwork?: LocalArtworkReference[];
}

export interface LocalMediaDetail {
  item: LocalMediaItem;
  collectionTitle?: string;
  collectionKind?: "movie" | "show" | "unclassified";
  /** All files in the same local collection, ordered by season/episode. */
  episodes: LocalMediaItem[];
  /** Saved local progress for the selected media, when one exists. */
  playback?: LocalPlaybackState;
  /**
   * Saved local progress for every file in the same collection, keyed by the
   * opaque media ID. Omitted entries have never been played. No path or URI is
   * ever part of this list.
   */
  episodePlayback?: LocalPlaybackState[];
  /**
   * Aggregated viewing ledger for the selected file. Omitted until the file has
   * at least one recorded session; never carries a title, filename, or path.
   */
  viewing?: LocalViewingHistory;
}

export interface LocalContinueWatchingItem {
  item: LocalMediaItem;
  playback: LocalPlaybackState;
  /** Collection identity for the work-level home card. */
  collectionTitle: string;
  collectionKind: LocalCollectionKind;
  /** Episode title; for a movie this repeats the work title. */
  episodeTitle: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

/** Playback owner contract. The mediaId is the only renderer-to-main target. */
export interface LocalPlaybackState {
  mediaId: `media_${string}`;
  positionSec: number;
  durationSec?: number;
  audioTrackId?: string;
  /**
   * Renderer contract: a string selects a subtitle track, `null` means the user
   * explicitly turned subtitles off, and an absent field means "never chosen".
   * The database stores the explicit-off case as the `"off"` sentinel and keeps
   * the absent case as NULL, so the three states survive a restart.
   */
  subtitleTrackId?: string | null;
  watched: boolean;
  updatedAtMs: number;
}

export type LocalPlaybackUpdate = Omit<LocalPlaybackState, "mediaId" | "updatedAtMs"> & { updatedAtMs?: number };

export const EFFECTIVE_WATCH_MIN_SEC = 30 as const;
export const EFFECTIVE_WATCH_MIN_PERCENT = 3 as const;
export const COMPLETION_PERCENT = 90 as const;

export type LocalViewingCloseReason = "ended" | "user-close" | "error" | "app-quit" | "interrupted";

/** One recorded playback attempt. Main/worker only; never sent to the renderer. */
export interface LocalViewingSessionStartInput {
  mediaId: `media_${string}`;
  startedAtMs: number;
  startPositionSec: number;
}

export interface LocalViewingSessionHeartbeatInput {
  sessionId: string;
  playedSec: number;
  wallSec: number;
  endPositionSec: number;
  durationSec?: number;
  pauseCount: number;
  seekCount: number;
  speed: number;
  heartbeatAtMs: number;
}

export interface LocalViewingSessionFinishInput extends LocalViewingSessionHeartbeatInput {
  mediaId: `media_${string}`;
  endedAtMs: number;
  completed: boolean;
  closeReason: LocalViewingCloseReason;
}

/**
 * Renderer-safe aggregate for one current media file. Every field is a count or
 * a renderer-safe value; the DTO never exposes a title, filename, or path.
 */
export interface LocalViewingHistory {
  mediaId: `media_${string}`;
  openCount: number;
  effectiveWatchCount: number;
  completedCount: number;
  inspectionOpenCount: number;
  totalPlayedSec: number;
  firstSeenAtMs: number;
  lastOpenedAtMs: number;
  lastPlayedAtMs?: number;
  lastSessionPlayedSec: number;
  lastSessionWallSec: number;
  lastPositionSec: number;
  lastDurationSec?: number;
  updatedAtMs: number;
}

/** Effective watch = at least 30 seconds and at least 3% of a known duration. */
export function isEffectiveWatch(playedSec: number, durationSec?: number): boolean {
  if (!Number.isFinite(playedSec) || playedSec < EFFECTIVE_WATCH_MIN_SEC) return false;
  if (durationSec === undefined || !Number.isFinite(durationSec) || durationSec <= 0) return true;
  return playedSec * 100 >= durationSec * EFFECTIVE_WATCH_MIN_PERCENT;
}

/**
 * The single completion rule shared by the live close, the recovered session
 * and the recorded aggregate: an attempt completes only through the player
 * reporting the end (`ended`, which callers pass as `completed: true`) or
 * through real playback reaching 90% for at least 30 played seconds.
 *
 * Position alone never completes: a resume position or a seek to the end with
 * little played time fails the 30-second floor. A failed load
 * (`closeReason === "error"`) is not a watch attempt at all, so callers must
 * not consult this function for it.
 */
export function isCompletedWatch(playedSec: number, durationSec: number | undefined, endPositionSec: number): boolean {
  if (!Number.isFinite(playedSec) || playedSec < EFFECTIVE_WATCH_MIN_SEC) return false;
  if (durationSec === undefined || !Number.isFinite(durationSec) || durationSec <= 0) return false;
  if (!Number.isFinite(endPositionSec) || endPositionSec <= 0) return false;
  return endPositionSec * 100 >= durationSec * COMPLETION_PERCENT;
}

export interface LocalPlaybackTarget {
  mediaId: `media_${string}`;
}

export interface LocalScanProgress {
  scanId: string;
  sourceId: string;
  /** Renderer-safe folder label for the source being scanned; never a path. */
  sourceLabel?: string;
  status: "running" | "completed" | "cancelled" | "partial" | "unavailable";
  scannedFiles: number;
  importedFiles: number;
  updatedFiles: number;
  warningCount: number;
}

/**
 * Precise comparison of the rows a Scan run found in the library against what
 * the run saw. It is derived from the stored rows and the traversed files, not
 * from "how many files the traversal visited again" (Ticket 23a).
 */
export interface LocalScanCounts {
  /** Rows this run created: a file with no stored identity, or a new identity for a changed video. */
  imported: number;
  /** Stored rows whose metadata changed while the video fingerprint stayed the same. */
  updated: number;
  /** Stored rows that matched what this run saw; nothing about them moved. */
  unchanged: number;
  /**
   * Rows that left the visible library: a fully scanned directory proved the
   * file missing, or a changed video fingerprint superseded the old identity.
   */
  removed: number;
}

export interface LocalScanResult extends LocalScanProgress {
  warnings: string[];
  error?: string;
  /**
   * Present on every worker-produced result (full scan and directory rescan).
   * Optional on this shared shape only because the renderer composes several
   * per-folder results from progress-shaped fields and may omit it.
   */
  counts?: LocalScanCounts;
  /** Subset of `counts.updated`: NFO-derived metadata changed, the video fingerprint did not. */
  nfoUpdatedFiles?: number;
  /** Subset of `counts.imported`: a stored identity at the same path had a different video fingerprint. */
  fingerprintReplacedFiles?: number;
}

/** Directory-scoped rescan result: the precise counts are part of the contract, not optional. */
export interface LocalDirectoryScanResult extends LocalScanResult {
  counts: LocalScanCounts;
  nfoUpdatedFiles: number;
  fingerprintReplacedFiles: number;
}

/**
 * The directory inventory one Source exposes to the mtime coarse filter
 * (Ticket 23b). It is derived from the stored rows, not from a new table: the
 * source root (so a new top-level folder changes it) plus the parent directory
 * of every indexed Media file. Values are source-relative POSIX directories and
 * never an absolute path; `""` is the source root.
 */
export interface LocalSourceDirectories {
  sourceId: string;
  relativeDirectories: string[];
}

/**
 * What asked for the change check from the renderer: the window regained focus,
 * or the library surface came back. `isLocalRefreshTrigger` accepts only these
 * two values, so a renderer call can never claim the watcher cause below.
 */
export type LocalRefreshTrigger = "focus" | "return";

export function isLocalRefreshTrigger(value: unknown): value is LocalRefreshTrigger {
  return value === "focus" || value === "return";
}

/**
 * Every cause of an automatic refresh. `watch` is main-only (Ticket 24a): the
 * local filesystem watcher found expected-dirty directories. The renderer reads
 * only the counts of a refresh result and never branches on the cause, so this
 * cause reaches it as an opaque label rather than a new entry point.
 */
export type LocalRefreshCause = LocalRefreshTrigger | "watch";

/**
 * Immediate answer to one change check. `refreshed` means at least one changed
 * directory was rescanned and a `LocalLibraryRefreshResult` was pushed;
 * `unchanged` means the baseline matched; `throttled` means a focus arrived
 * inside the throttle window; `queued` means a scan was already running and the
 * dirty directories wait for it.
 */
export type LocalRefreshStatus = "refreshed" | "unchanged" | "throttled" | "queued" | "error";

export interface LocalRefreshOutcome {
  status: LocalRefreshStatus;
}

/**
 * One silent automatic refresh (Ticket 23b). It carries the same four counts as
 * a manual scan so the status line never falls back to the "files seen again"
 * compatibility counter, and it is pushed without a notification.
 */
export interface LocalLibraryRefreshResult {
  /** Ticket 24a adds the main-only `watch` cause; consumers read `counts`. */
  trigger: LocalRefreshCause;
  /** Directories handed to the directory rescan, after ancestor collapsing. */
  scannedDirectories: number;
  counts: LocalScanCounts;
  /** Subset of `counts.updated`: the change was NFO/artwork metadata only. */
  nfoUpdatedFiles: number;
  /** Subset of `counts.imported`: a changed video fingerprint replaced an identity. */
  fingerprintReplacedFiles: number;
  warningCount: number;
}

/**
 * Normalize one source-relative directory for the directory-scoped rescan
 * (Ticket 23a). A scan scope must stay inside its Source by construction, so an
 * absolute path, a UNC path, a Windows drive, a URL or an escaping parent
 * segment is rejected (`undefined`) rather than clamped into the root. `.` and
 * repeated separators are elided, `/` and `\` are both accepted, and the result
 * uses the library's POSIX-style separators; the source root itself
 * normalizes to `""`.
 */
export function normalizeScanRelativeDirectory(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.includes("\u0000")) return undefined;
  // Another root: system-absolute, UNC, drive-qualified or a URL.
  if (/^[\\/]/u.test(value) || /^[a-zA-Z]:/u.test(value) || /^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) return undefined;
  const segments: string[] = [];
  for (const segment of value.split(/[\\/]+/u)) {
    if (!segment || segment === ".") continue;
    // A parent segment is rejected instead of resolved: the scope must be a
    // child directory, never a computed position that happens to land inside.
    if (segment === "..") return undefined;
    segments.push(segment);
  }
  return segments.join("/");
}

export interface LocalLibraryState {
  status: LocalLibraryStatus;
  schemaVersion: typeof LOCAL_LIBRARY_SCHEMA_VERSION;
  sqliteAvailable: boolean;
  sources: LocalSourceSummary[];
  error?: { code: "sqlite-unavailable" | "storage" | "unknown"; message: string };
}

export interface LocalLibraryQuery {
  page: number;
  pageSize: number;
  query?: string;
  filter?: LocalLibraryFilter;
  sort?: LocalLibrarySort;
  sourceId?: string;
}

export interface LocalLibraryPage {
  query: LocalLibraryQuery;
  page: number;
  pageSize: number;
  totalCount: number;
  items: LocalMediaItem[];
}

export type LocalCollectionKind = "movie" | "show" | "unclassified";
export type LocalCollectionFilter = "all" | LocalCollectionKind;

/** Work-level query. "episode" stays a file-level filter on LocalLibraryQuery. */
export interface LocalCollectionQuery {
  page: number;
  pageSize: number;
  query?: string;
  filter?: LocalCollectionFilter;
  sort?: LocalLibrarySort;
  sourceId?: string;
}

export interface LocalCollectionResume {
  mediaId: `media_${string}`;
  positionSec: number;
  durationSec?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle: string;
  updatedAtMs: number;
}

export interface LocalCollectionMatchedEpisode {
  mediaId: `media_${string}`;
  title: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

/**
 * One card per work. Counts are episode counts for that work; resume and
 * representative IDs are opaque media IDs only and never carry a path.
 */
export interface LocalCollectionSummary {
  collectionId: string;
  title: string;
  kind: LocalCollectionKind;
  year?: number;
  rating?: number;
  premieredDate: string | null;
  episodeCount: number;
  watchedEpisodeCount: number;
  availableEpisodeCount: number;
  available: boolean;
  representativeMediaId: `media_${string}`;
  coverMediaId: `media_${string}`;
  resume?: LocalCollectionResume;
  matchedEpisode?: LocalCollectionMatchedEpisode;
  addedAtMs: number;
  updatedAtMs: number;
  artwork?: LocalArtworkReference[];
}

export interface LocalCollectionPage {
  query: LocalCollectionQuery;
  page: number;
  pageSize: number;
  totalCount: number;
  items: LocalCollectionSummary[];
}

export interface LocalLibraryListResult {
  state: LocalLibraryState;
  page?: LocalLibraryPage;
}

export interface LocalCollectionListResult {
  state: LocalLibraryState;
  page?: LocalCollectionPage;
}

export interface LocalLibraryDetailResult {
  state: LocalLibraryState;
  detail?: LocalMediaDetail;
  /** Compatibility projection for older renderer callers. */
  item?: LocalMediaItem;
}

export interface LocalLibraryArtworkResult {
  state: LocalLibraryState;
  dataUrl?: string;
  mimeType?: string;
}

export type LocalImportOutcome =
  | { status: "imported"; item: LocalMediaItem; state: LocalLibraryState }
  | { status: "cancelled"; state: LocalLibraryState }
  | { status: "empty"; state: LocalLibraryState };

export interface LocalLibraryApi {
  getState(): Promise<LocalLibraryState>;
  chooseFolder(): Promise<LocalScanResult>;
  openVideo(): Promise<LocalImportOutcome>;
  list(query?: Partial<LocalLibraryQuery>): Promise<LocalLibraryListResult>;
  listCollections(query?: Partial<LocalCollectionQuery>): Promise<LocalCollectionListResult>;
  get(mediaId: string): Promise<LocalLibraryDetailResult>;
  getArtwork(mediaId: string, kind?: LocalArtworkReference["kind"]): Promise<LocalLibraryArtworkResult>;
  /** Markers for one opaque media ID, ordered by position; never carries a path or URI. */
  listMarkers(mediaId: string): Promise<LocalMarker[]>;
  /** Record the current whole second as one marker; the record is returned so the UI can render it. */
  addMarker(input: LocalMarkerInput): Promise<LocalMarker>;
  /**
   * Delete one marker by its opaque id and whole second. Resolves `true` when a
   * row was removed and `false` when that second had no marker (an idempotent
   * no-op, not an error, so a double click never reports a false failure).
   */
  removeMarker(input: LocalMarkerDeleteInput): Promise<boolean>;
  listContinueWatching(): Promise<{ state: LocalLibraryState; items: LocalContinueWatchingItem[] }>;
  removeSource(sourceId: string): Promise<LocalLibraryState>;
  refreshSource(sourceId: string): Promise<LocalScanResult>;
  /** Rescan every registered folder sequentially; results follow the source order. */
  rescanAll(): Promise<LocalScanResult[]>;
  scanFolder(): Promise<LocalScanResult>;
  cancelScan(scanId: string): Promise<boolean>;
  /** Cleanup queue for current on-disk files, evaluated with saved preferences. */
  getCleanupQueue(query?: Partial<LocalCleanupQueueQuery>): Promise<LocalCleanupQueueResult>;
  /** Mark one current file keep/snooze/delete-candidate (or clear the mark). */
  setCleanupState(input: LocalCleanupStateInput): Promise<LocalCleanupQueueResult>;
  /** Reveal the file in Explorer. Main resolves the path; no path reaches the renderer. */
  revealCleanupMedia(mediaId: string): Promise<LocalCleanupRevealResult>;
  onScanProgress(listener: (progress: LocalScanProgress) => void): () => void;
  onState(listener: (state: LocalLibraryState) => void): () => void;
  /**
   * Ask main for one change check (Ticket 23b). The renderer calls this when the
   * window regains focus and when it returns to the library from a detail or
   * player layer; main applies the throttle and the single-flight queue.
   */
  checkRefresh(trigger: LocalRefreshTrigger): Promise<LocalRefreshOutcome>;
  /** Silent result of a completed automatic refresh; never a notification. */
  onRefreshResult(listener: (result: LocalLibraryRefreshResult) => void): () => void;
}
