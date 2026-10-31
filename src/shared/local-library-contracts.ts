/**
 * Shared local-library contracts. Renderer-facing records intentionally omit
 * absolute paths and source-relative paths; only main/utility-process owners
 * may resolve those values.
 */

export const LOCAL_LIBRARY_SCHEMA_VERSION = 1 as const;

export const LOCAL_LIBRARY_SCHEMA_TABLES = [
  "sources",
  "collections",
  "media_files",
  "artwork",
  "playback_state",
  "scan_runs",
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
  available: boolean;
  itemCount: number;
}

export type LocalMediaKind = "movie" | "show" | "episode" | "unclassified";

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
  plot?: string;
  genres?: string[];
  rating?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  artwork?: LocalArtworkReference[];
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

export interface LocalPlaybackTarget {
  mediaId: `media_${string}`;
}

export interface LocalScanProgress {
  scanId: string;
  sourceId: string;
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
}

export interface LocalLibraryPage {
  query: LocalLibraryQuery;
  page: number;
  pageSize: number;
  totalCount: number;
  items: LocalMediaItem[];
}

export interface LocalLibraryListResult {
  state: LocalLibraryState;
  page?: LocalLibraryPage;
}

export interface LocalLibraryDetailResult {
  state: LocalLibraryState;
  item?: LocalMediaItem;
}

export type LocalImportOutcome =
  | { status: "imported"; item: LocalMediaItem; state: LocalLibraryState }
  | { status: "cancelled"; state: LocalLibraryState }
  | { status: "empty"; state: LocalLibraryState };

export interface LocalLibraryApi {
  getState(): Promise<LocalLibraryState>;
  chooseFolder(): Promise<LocalImportOutcome>;
  openVideo(): Promise<LocalImportOutcome>;
  list(query?: Partial<LocalLibraryQuery>): Promise<LocalLibraryListResult>;
  get(mediaId: string): Promise<LocalLibraryDetailResult>;
  scanFolder(): Promise<LocalScanResult>;
  cancelScan(scanId: string): Promise<boolean>;
  onScanProgress(listener: (progress: LocalScanProgress) => void): () => void;
  onState(listener: (state: LocalLibraryState) => void): () => void;
}
