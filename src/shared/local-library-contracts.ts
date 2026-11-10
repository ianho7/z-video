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

export const LOCAL_LIBRARY_SCHEMA_VERSION = 3 as const;

export const LOCAL_LIBRARY_SCHEMA_TABLES = [
  "sources",
  "collections",
  "media_files",
  "artwork",
  "playback_state",
  "scan_runs",
  "viewing_sessions",
  "media_history",
] as const;

export type LocalLibrarySchemaTable = (typeof LOCAL_LIBRARY_SCHEMA_TABLES)[number];

export function isOpaqueMediaId(value: unknown): value is `media_${string}` {
  return typeof value === "string"
    && /^media_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type LocalLibraryStatus = "ready" | "error";

export interface LocalSourceSummary {
  sourceId: string;
  label: string;
  /** Drive or parent-folder clue only; never a full/relative root path. */
  locationHint: string;
  available: boolean;
  /** Indexed files for this source, including files kept while the source is offline. */
  itemCount: number;
  /** Works (collections) aggregated from this source's indexed files. */
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

/** Completion = the player reported the end, or 90% plus at least 30 played seconds. */
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

export interface LocalScanResult extends LocalScanProgress {
  warnings: string[];
  error?: string;
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
}
