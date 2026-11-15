import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldImmediate } from "node:timers/promises";

import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import {
  LOCAL_LIBRARY_SCHEMA_VERSION,
  isCompletedWatch,
  isEffectiveWatch,
  isMarkerDurationSec,
  isMarkerPositionSec,
  isMarkerWithinDuration,
  isOpaqueMediaId,
  normalizeScanRelativeDirectory,
  type LocalLibraryQuery,
  type LocalCollectionQuery,
  type LocalCollectionSummary,
  type LocalDirectoryScanResult,
  type LocalMarker,
  type LocalMarkerDeleteInput,
  type LocalMarkerInput,
  type LocalMediaItem,
  type LocalMediaDetail,
  type LocalContinueWatchingItem,
  type LocalArtworkReference,
  type LocalPlaybackState,
  type LocalScanCounts,
  type LocalScanProgress,
  type LocalScanResult,
  type LocalSourceDirectories,
  type LocalSourceSummary,
  type LocalViewingHistory,
  type LocalViewingSessionFinishInput,
  type LocalViewingSessionHeartbeatInput,
  type LocalViewingSessionStartInput,
} from "../shared/local-library-contracts";
import {
  DAY_MS,
  evaluateCleanupRule,
  effectiveCleanupState,
  isCleanupState,
  type CleanupRuleId,
  type CleanupSettings,
  type CleanupState,
  type LocalCleanupCandidate,
  type LocalCleanupQueue,
  type LocalCleanupQueueItem,
  type LocalCleanupQueueQuery,
  type LocalCleanupStateInput,
} from "../shared/cleanup-contracts";
import { parseEpisodeNumbers, parseNfo, parsePremieredDate, type ParsedNfo } from "./local-library-metadata";
import { localLibraryErrorCode, localLibraryErrorMessage } from "./local-library-errors";
import { safeSourceLabel, safeSourceLocationHint } from "./local-library-label";

type WorkerRequest =
  | { id: number; command: "initialize"; dbPath: string }
  | { id: number; command: "state" }
  | { id: number; command: "import-first-movie"; rootPath: string }
  | { id: number; command: "import-video"; filePath: string; rootPath: string }
  | { id: number; command: "scan"; rootPath: string }
  | { id: number; command: "scan-directories"; sourceId: string; relativeDirectories: string[] }
  | { id: number; command: "list-scan-directories" }
  | { id: number; command: "cancel-scan"; scanId: string }
  | { id: number; command: "list"; query: LocalLibraryQuery }
  | { id: number; command: "list-collections"; query: LocalCollectionQuery }
  | { id: number; command: "get"; mediaId: string }
  | { id: number; command: "get-detail"; mediaId: string }
  | { id: number; command: "list-markers"; mediaId: string }
  | { id: number; command: "add-marker"; input: LocalMarkerInput }
  | { id: number; command: "delete-marker"; input: LocalMarkerDeleteInput }
  | { id: number; command: "list-continue-watching" }
  | { id: number; command: "remove-source"; sourceId: string }
  | { id: number; command: "source-root"; sourceId: string }
  | { id: number; command: "resolve-artwork"; mediaId: string; kind?: "poster" | "fanart" }
  | { id: number; command: "resolve-path"; mediaId: string }
  | { id: number; command: "get-playback"; mediaId: string }
  | { id: number; command: "save-playback"; state: LocalPlaybackState }
  | { id: number; command: "start-viewing-session"; session: LocalViewingSessionStartInput }
  | { id: number; command: "heartbeat-viewing-session"; heartbeat: LocalViewingSessionHeartbeatInput }
  | { id: number; command: "finish-viewing-session"; session: LocalViewingSessionFinishInput }
  | { id: number; command: "get-viewing-history"; mediaId: string }
  | { id: number; command: "list-cleanup-queue"; query: LocalCleanupQueueQuery; settings: CleanupSettings; nowMs: number }
  | { id: number; command: "set-cleanup-state"; input: LocalCleanupStateInput; nowMs: number; keepDays: number; snoozeDays: number }
  | { id: number; command: "close" };

interface WorkerSuccess {
  id: number;
  ok: true;
  result: unknown;
}

interface WorkerFailure {
  id: number;
  ok: false;
  error: { code: "sqlite-unavailable" | "storage" | "invalid-input" | "unknown"; message: string };
}

interface WorkerEvent {
  event: "scan-progress";
  progress: LocalScanProgress;
}

interface ParentPortLike {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!port) throw new Error("local library worker requires Electron utilityProcess parentPort");
const workerPort = port;

const supportedVideoExtensions = new Set([".avi", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4", ".ts", ".webm"]);
const supportedArtworkExtensions = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);
const maxNfoBytes = 2 * 1024 * 1024;
/** TEMP table holding one traversal's seen source-relative paths (reconcile). */
const SEEN_PATHS_TABLE = "seen_relative_paths";
/**
 * TEMP table holding the source-relative directory prefixes this run proved
 * complete. Missing-file detection only reaches rows inside those prefixes, so
 * an unreadable directory never tombstones the files it could not list.
 */
const SCANNED_PREFIX_TABLE = "scanned_directory_prefixes";
let database: DatabaseSyncType | undefined;
let activeScan: Promise<LocalScanResult> | undefined;
/**
 * One in-flight scan's cancellation token. `requested` is honored at every
 * traversal step; `terminal` turns true once the traversal has returned, from
 * which point the reconcile transaction and the result are uninterruptible and
 * `cancel-scan` must answer `false` instead of pretending it cancelled anything.
 */
interface ScanCancellation {
  requested: boolean;
  terminal: boolean;
}
const scanCancellation = new Map<string, ScanCancellation>();

type ScanProfileStage = "enumeration" | "realpath" | "lstat" | "stat" | "nfo" | "artwork" | "database";

interface ScanProfileReport {
  version: 1;
  status: "running" | "completed" | "cancelled" | "partial" | "unavailable" | "error";
  totalMs: number;
  stagesMs: Record<`${ScanProfileStage}Ms`, number>;
  calls: Record<string, number>;
  errors: string[];
  counts: {
    directories: number;
    videoCandidates: number;
    scannedFiles: number;
    importedFiles: number;
    updatedFiles: number;
    warnings: number;
  };
}

interface ScanProfiler {
  outputPath: string;
  startedAt: number;
  report: ScanProfileReport;
}

interface ScanCaches {
  nfo: Map<string, Promise<ParsedNfo | undefined>>;
  artwork: Map<string, Promise<string | undefined>>;
}

interface NfoCacheEntry {
  size: number;
  modifiedAtMs: number;
  value?: ParsedNfo;
  warning?: string;
}

function beginScanProfiler(): ScanProfiler | undefined {
  const outputPath = process.env.Z_VIDEO_SCAN_PROFILE_PATH;
  if (!outputPath) return undefined;
  const stagesMs = {
    enumerationMs: 0,
    realpathMs: 0,
    lstatMs: 0,
    statMs: 0,
    nfoMs: 0,
    artworkMs: 0,
    databaseMs: 0,
  } satisfies Record<`${ScanProfileStage}Ms`, number>;
  return {
    outputPath,
    startedAt: performance.now(),
    report: {
      version: 1,
      status: "running",
      totalMs: 0,
      stagesMs,
      calls: {},
      errors: [],
      counts: { directories: 0, videoCandidates: 0, scannedFiles: 0, importedFiles: 0, updatedFiles: 0, warnings: 0 },
    },
  };
}

let scanProfiler: ScanProfiler | undefined;
let scanCaches: ScanCaches | undefined;
const maxNfoMetadataCacheEntries = 512;
const nfoMetadataCache = new Map<string, NfoCacheEntry>();

function profileCount(name: string, amount = 1): void {
  if (!scanProfiler) return;
  scanProfiler.report.calls[name] = (scanProfiler.report.calls[name] ?? 0) + amount;
}

function profileError(error: unknown): void {
  if (!scanProfiler) return;
  recordProfilerError(scanProfiler, error);
}

function recordProfilerError(profiler: ScanProfiler, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!profiler.report.errors.includes(message)) profiler.report.errors.push(message);
}

function rememberNfoMetadata(filePath: string, value: NfoCacheEntry): void {
  nfoMetadataCache.delete(filePath);
  while (nfoMetadataCache.size >= maxNfoMetadataCacheEntries) {
    const oldest = nfoMetadataCache.keys().next().value as string | undefined;
    if (!oldest) break;
    nfoMetadataCache.delete(oldest);
    profileCount("nfoCacheEvictions");
  }
  nfoMetadataCache.set(filePath, value);
}

function profileSync<T>(stage: ScanProfileStage, operation: () => T): T {
  if (!scanProfiler) return operation();
  if (stage === "database") profileCount("databaseOperations");
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    scanProfiler.report.stagesMs[`${stage}Ms`] += performance.now() - startedAt;
  }
}

async function profileAsync<T>(stage: ScanProfileStage, operation: () => Promise<T>, callName?: string): Promise<T> {
  if (!scanProfiler) return operation();
  if (callName) profileCount(callName);
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    scanProfiler.report.stagesMs[`${stage}Ms`] += performance.now() - startedAt;
  }
}

async function finishScanProfiler(profiler: ScanProfiler | undefined, status: ScanProfileReport["status"], counters: ScanCounters): Promise<void> {
  if (!profiler) return;
  try {
    profiler.report.status = status;
    profiler.report.totalMs = performance.now() - profiler.startedAt;
    profiler.report.counts = {
      directories: profiler.report.calls.directories ?? 0,
      videoCandidates: profiler.report.calls.videoCandidates ?? 0,
      scannedFiles: counters.scannedFiles,
      importedFiles: counters.importedFiles,
      updatedFiles: counters.updatedFiles,
      warnings: counters.warnings.length,
    };
    profiler.report.calls.nfoCacheSize = nfoMetadataCache.size;
    await mkdir(dirname(profiler.outputPath), { recursive: true });
    await appendFile(profiler.outputPath, `${JSON.stringify(profiler.report)}\n`, "utf8");
  } catch (error) {
    // Profiling is diagnostic-only. An unwritable output path must not change scan outcome.
    recordProfilerError(profiler, error);
  }
}

function makeId(prefix: "media" | "source" | "collection" | "scan" | "artwork" | "session"): string {
  return `${prefix}_${randomUUID()}`;
}

function now(): number {
  return Date.now();
}

function requireDatabase(): DatabaseSyncType {
  if (!database) throw new LocalWorkerError("storage", "本地片库数据库尚未初始化");
  return database;
}

class LocalWorkerError extends Error {
  constructor(readonly code: WorkerFailure["error"]["code"], message: string) {
    super(message);
    this.name = "LocalWorkerError";
  }
}

function openDatabase(dbPath: string): void {
  try {
    const sqlite = require("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseSyncType };
    if (typeof sqlite.DatabaseSync !== "function") {
      throw new LocalWorkerError("sqlite-unavailable", localLibraryErrorMessage("sqlite-unavailable"));
    }
    database = new sqlite.DatabaseSync(dbPath);
  } catch (error) {
    if (error instanceof LocalWorkerError) throw error;
    throw new LocalWorkerError("sqlite-unavailable", localLibraryErrorMessage("sqlite-unavailable"));
  }
  const db = requireDatabase();
  try {
    const versionRow = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
    const existingVersion = Number(versionRow?.user_version ?? 0);
    if (existingVersion > LOCAL_LIBRARY_SCHEMA_VERSION) {
      throw new LocalWorkerError("storage", `本地片库 schema v${existingVersion} 高于当前客户端支持的 v${LOCAL_LIBRARY_SCHEMA_VERSION}`);
    }
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sources (
        source_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        available INTEGER NOT NULL DEFAULT 1,
        degraded INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collections (
        collection_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        year INTEGER,
        plot TEXT,
        genre_json TEXT,
        rating REAL,
        identity_key TEXT,
        source_id TEXT,
        relative_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES sources(source_id)
      );
      CREATE TABLE IF NOT EXISTS media_files (
        media_id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        display_title TEXT,
        media_kind TEXT NOT NULL DEFAULT 'movie',
        size_bytes INTEGER NOT NULL,
        modified_at_ms REAL NOT NULL,
        season_number INTEGER,
        episode_number INTEGER,
        available INTEGER NOT NULL DEFAULT 1,
        added_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (collection_id) REFERENCES collections(collection_id),
        FOREIGN KEY (source_id) REFERENCES sources(source_id),
        UNIQUE (source_id, relative_path, size_bytes, modified_at_ms)
      );
      CREATE TABLE IF NOT EXISTS artwork (
        artwork_id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        media_id TEXT,
        source_id TEXT,
        relative_path TEXT,
        kind TEXT NOT NULL,
        source_fingerprint TEXT,
        cache_key TEXT,
        updated_at INTEGER,
        FOREIGN KEY (collection_id) REFERENCES collections(collection_id),
        FOREIGN KEY (media_id) REFERENCES media_files(media_id),
        FOREIGN KEY (source_id) REFERENCES sources(source_id)
      );
      CREATE TABLE IF NOT EXISTS playback_state (
        media_id TEXT PRIMARY KEY,
        position_sec REAL NOT NULL DEFAULT 0,
        duration_sec REAL,
        audio_track_id TEXT,
        subtitle_track_id TEXT,
        watched INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (media_id) REFERENCES media_files(media_id)
      );
      CREATE TABLE IF NOT EXISTS scan_runs (
        scan_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (source_id) REFERENCES sources(source_id)
      );
      CREATE TABLE IF NOT EXISTS viewing_sessions (
        session_id TEXT PRIMARY KEY,
        media_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_heartbeat_at INTEGER,
        wall_sec REAL NOT NULL DEFAULT 0,
        played_sec REAL NOT NULL DEFAULT 0,
        start_position_sec REAL NOT NULL DEFAULT 0,
        end_position_sec REAL NOT NULL DEFAULT 0,
        duration_sec REAL,
        completed INTEGER NOT NULL DEFAULT 0,
        pause_count INTEGER NOT NULL DEFAULT 0,
        seek_count INTEGER NOT NULL DEFAULT 0,
        speed REAL NOT NULL DEFAULT 1,
        close_reason TEXT,
        FOREIGN KEY (media_id) REFERENCES media_files(media_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS media_history (
        media_id TEXT PRIMARY KEY,
        open_count INTEGER NOT NULL DEFAULT 0,
        effective_watch_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        inspection_open_count INTEGER NOT NULL DEFAULT 0,
        total_played_sec REAL NOT NULL DEFAULT 0,
        first_seen_at INTEGER NOT NULL,
        last_opened_at INTEGER NOT NULL,
        last_played_at INTEGER,
        last_session_played_sec REAL NOT NULL DEFAULT 0,
        last_session_wall_sec REAL NOT NULL DEFAULT 0,
        last_position_sec REAL NOT NULL DEFAULT 0,
        last_duration_sec REAL,
        cleanup_state TEXT NOT NULL DEFAULT 'none',
        cleanup_until INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (media_id) REFERENCES media_files(media_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS markers (
        media_id TEXT NOT NULL,
        position_sec INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (media_id, position_sec),
        FOREIGN KEY (media_id) REFERENCES media_files(media_id) ON DELETE CASCADE
      );
    `);
    ensureColumn("collections", "identity_key", "TEXT");
    ensureColumn("collections", "source_id", "TEXT");
    ensureColumn("collections", "relative_path", "TEXT");
    ensureColumn("collections", "premiered_at", "TEXT");
    ensureColumn("sources", "degraded", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("media_files", "display_title", "TEXT");
    ensureColumn("media_files", "media_kind", "TEXT NOT NULL DEFAULT 'movie'");
    ensureColumn("media_files", "season_number", "INTEGER");
    ensureColumn("media_files", "episode_number", "INTEGER");
    ensureColumn("artwork", "media_id", "TEXT");
    ensureColumn("artwork", "source_id", "TEXT");
    ensureColumn("artwork", "relative_path", "TEXT");
    ensureColumn("artwork", "updated_at", "INTEGER");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS collections_identity_key ON collections(identity_key) WHERE identity_key IS NOT NULL;");
    db.exec("CREATE INDEX IF NOT EXISTS collections_premiered_at ON collections(premiered_at);");
    db.exec("CREATE INDEX IF NOT EXISTS media_files_source_path ON media_files(source_id, relative_path);");
    db.exec("CREATE INDEX IF NOT EXISTS artwork_collection_kind ON artwork(collection_id, media_id, kind);");
    db.exec("CREATE INDEX IF NOT EXISTS viewing_sessions_media_started ON viewing_sessions(media_id, started_at);");
    db.exec("CREATE INDEX IF NOT EXISTS viewing_sessions_started ON viewing_sessions(started_at);");
    db.exec("CREATE INDEX IF NOT EXISTS viewing_sessions_open ON viewing_sessions(ended_at);");
    db.exec("CREATE INDEX IF NOT EXISTS media_history_last_opened ON media_history(last_opened_at);");
    db.exec("CREATE INDEX IF NOT EXISTS media_history_cleanup_state ON media_history(cleanup_state);");
    // Incremental migrations: v2 adds collections.premiered_at; v3 adds the
    // viewing_sessions/media_history ledger tables; v4 adds
    // sources.degraded (default 0, so old rows keep their previous meaning);
    // v5 adds the markers table (FK to media_files with ON DELETE CASCADE).
    // No existing column is rewritten and no history is backfilled from
    // playback_state; every step is idempotent and re-running it is a no-op.
    if (existingVersion < LOCAL_LIBRARY_SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${LOCAL_LIBRARY_SCHEMA_VERSION};`);
    recoverInterruptedViewingSessions();
    recoverInterruptedScanRuns();
  } catch (error) {
    throw new LocalWorkerError("storage", localLibraryErrorMessage("storage"));
  }
}

function ensureColumn(table: string, column: string, definition: string): void {
  const db = requireDatabase();
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some((candidate) => candidate.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

function pathContained(rootPath: string, candidatePath: string, allowEqual = true): boolean {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const candidateRelative = relative(root, candidate);
  if (allowEqual && candidateRelative === "") return true;
  return Boolean(candidateRelative) && !isAbsolute(candidateRelative) && candidateRelative !== ".." && !candidateRelative.startsWith(`..${sep}`);
}

function pathWithin(rootPath: string, candidatePath: string): boolean {
  return pathContained(rootPath, candidatePath, false);
}

async function canonicalDirectory(rootPath: string): Promise<string> {
  const candidate = await profileAsync("realpath", () => realpath(resolve(rootPath)), "realpath").catch(() => undefined);
  if (!candidate) throw new LocalWorkerError("invalid-input", "选择的片库目录不可用");
  const metadata = await profileAsync("lstat", () => lstat(candidate), "lstat").catch(() => undefined);
  if (!metadata?.isDirectory()) throw new LocalWorkerError("invalid-input", "选择的片库目录不可用");
  return candidate;
}

async function canonicalPathWithin(rootPath: string, candidatePath: string, knownCanonicalRoot?: string): Promise<string | undefined> {
  const [root, candidate] = await Promise.all([
    knownCanonicalRoot
      ? Promise.resolve(knownCanonicalRoot)
      : profileAsync("realpath", () => realpath(resolve(rootPath)), "realpath").catch(() => undefined),
    profileAsync("realpath", () => realpath(resolve(candidatePath)), "realpath").catch(() => undefined),
  ]);
  return root && candidate && pathContained(root, candidate) ? candidate : undefined;
}

async function assertRootAndFile(rootPath: string, filePath: string): Promise<{ root: string; file: string; relativePath: string }> {
  const root = await canonicalDirectory(rootPath);
  const requestedFile = resolve(filePath);
  const fileMetadata = await profileAsync("lstat", () => lstat(requestedFile), "lstat").catch(() => undefined);
  if (!fileMetadata?.isFile() || fileMetadata.isSymbolicLink()) {
    throw new LocalWorkerError("invalid-input", "选择的本地视频文件不可用");
  }
  const file = await canonicalPathWithin(root, requestedFile, root);
  if (!file) throw new LocalWorkerError("invalid-input", "媒体文件必须位于已选择的本地片库目录内");
  const relativePath = relative(root, file);
  if (!relativePath || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new LocalWorkerError("invalid-input", "媒体文件必须位于已选择的本地片库目录内");
  }
  return { root, file, relativePath: relativePath.split(sep).join("/") };
}

function assertSupportedVideo(filePath: string): void {
  if (!supportedVideoExtensions.has(extname(filePath).toLowerCase())) {
    throw new LocalWorkerError("invalid-input", "选择的文件不是支持的本地视频格式");
  }
}

async function findFirstVideo(rootPath: string): Promise<string | undefined> {
  const root = await canonicalDirectory(rootPath);
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    const entries = await profileAsync("enumeration", () => readdir(current, { withFileTypes: true }), "readdir");
    profileSync("enumeration", () => entries.sort((left, right) => left.name.localeCompare(right.name)));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        const safeChild = await canonicalPathWithin(root, child, root);
        if (safeChild) pending.push(safeChild);
      } else if (entry.isFile() && supportedVideoExtensions.has(extname(entry.name).toLowerCase())) {
        const safeChild = await canonicalPathWithin(root, child, root);
        if (safeChild) return safeChild;
      }
    }
  }
  return undefined;
}

function ensureSource(rootPath: string): { sourceId: string; label: string; rootPath: string; available: boolean } {
  const db = requireDatabase();
  const root = resolve(rootPath);
  const label = safeSourceLabel(root);
  const existing = profileSync("database", () => db.prepare("SELECT source_id AS sourceId, label, available FROM sources WHERE root_path = ?").get(root) as { sourceId?: string; label?: string; available?: number } | undefined);
  const timestamp = now();
  if (existing?.sourceId) {
    const sourceId = existing.sourceId;
    if (existing.label !== label) profileSync("database", () => db.prepare("UPDATE sources SET label = ?, updated_at = ? WHERE source_id = ?").run(label, timestamp, sourceId));
    return { sourceId, label, rootPath: root, available: Number(existing.available) === 1 };
  }
  const sourceId = makeId("source");
  profileSync("database", () => db.prepare("INSERT INTO sources (source_id, root_path, label, available, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)").run(sourceId, root, label, timestamp, timestamp));
  return { sourceId, label, rootPath: root, available: false };
}

async function assertNoOverlappingSource(rootPath: string, sourceId?: string): Promise<void> {
  const db = requireDatabase();
  const candidateRoot = resolve(rootPath);
  const rows = profileSync("database", () => (sourceId
    ? db.prepare("SELECT source_id AS sourceId, root_path AS rootPath FROM sources WHERE source_id <> ?").all(sourceId)
    : db.prepare("SELECT source_id AS sourceId, root_path AS rootPath FROM sources").all()) as Array<{ sourceId?: string; rootPath?: string }>);
  for (const row of rows) {
    if (!row.rootPath) continue;
    const otherRoot = resolve(row.rootPath);
    if (relative(otherRoot, candidateRoot) === "") continue;
    if (pathWithin(otherRoot, candidateRoot) || pathWithin(candidateRoot, otherRoot)) {
      throw new LocalWorkerError("invalid-input", "新的片库目录与已有来源重叠");
    }
  }
}

async function containingSource(filePath: string): Promise<{ sourceId: string; rootPath: string; label: string; available: boolean } | undefined> {
  const db = requireDatabase();
  const canonicalFile = await realpath(resolve(filePath)).catch(() => undefined);
  if (!canonicalFile) return undefined;
  const rows = db.prepare("SELECT source_id AS sourceId, root_path AS rootPath, label, available FROM sources").all() as Array<Record<string, unknown>>;
  const matches = rows
    .filter((row) => typeof row.sourceId === "string" && typeof row.rootPath === "string" && pathWithin(String(row.rootPath), canonicalFile))
    .sort((left, right) => String(right.rootPath).length - String(left.rootPath).length);
  const match = matches[0];
  if (!match) return undefined;
  const rootPath = String(match.rootPath);
  const label = safeSourceLabel(rootPath);
  if (match.label !== label) db.prepare("UPDATE sources SET label = ?, updated_at = ? WHERE source_id = ?").run(label, now(), String(match.sourceId));
  return { sourceId: String(match.sourceId), rootPath, label, available: Number(match.available) === 1 };
}

function toGenreList(value: unknown): string[] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
  } catch {
    return undefined;
  }
}

function artworkFor(collectionId: string, mediaId: string): LocalArtworkReference[] | undefined {
  const db = requireDatabase();
  const rows = db.prepare(`
    SELECT kind, cache_key AS cacheKey
    FROM artwork
    WHERE collection_id = ? AND (media_id IS NULL OR media_id = ?)
    ORDER BY CASE WHEN media_id = ? THEN 0 ELSE 1 END, kind
  `).all(collectionId, mediaId, mediaId) as Array<{ kind?: string; cacheKey?: string }>;
  const output = rows.filter((row): row is { kind: "poster" | "fanart"; cacheKey: string } =>
    (row.kind === "poster" || row.kind === "fanart") && typeof row.cacheKey === "string" && row.cacheKey.length > 0);
  return output.length ? output : undefined;
}

function toPublicItem(row: Record<string, unknown>): LocalMediaItem {
  const mediaId = String(row.mediaId) as LocalMediaItem["mediaId"];
  const genreList = toGenreList(row.genreJson);
  const artwork = artworkFor(String(row.collectionId), mediaId);
  return {
    mediaId,
    sourceId: String(row.sourceId),
    collectionId: String(row.collectionId),
    title: String(row.displayTitle ?? row.title),
    kind: (String(row.mediaKind ?? row.kind) || "unclassified") as LocalMediaItem["kind"],
    sizeBytes: Number(row.sizeBytes),
    modifiedAtMs: Number(row.modifiedAtMs),
    available: Number(row.available) === 1 && Number(row.sourceAvailable) !== 0,
    ...(row.year === null || row.year === undefined ? {} : { year: Number(row.year) }),
    ...(typeof row.plot === "string" && row.plot ? { plot: row.plot } : {}),
    ...(genreList?.length ? { genres: genreList } : {}),
    ...(row.rating === null || row.rating === undefined ? {} : { rating: Number(row.rating) }),
    ...(row.seasonNumber === null || row.seasonNumber === undefined ? {} : { seasonNumber: Number(row.seasonNumber) }),
    ...(row.episodeNumber === null || row.episodeNumber === undefined ? {} : { episodeNumber: Number(row.episodeNumber) }),
    premieredDate: parsePremieredDate(row.premieredAt),
    ...(artwork ? { artwork } : {}),
  };
}

interface CollectionMetadata {
  identityKey: string;
  sourceId: string;
  relativePath: string;
  title: string;
  kind: "movie" | "show" | "unclassified";
  year?: number;
  /** Validated YYYY-MM-DD from NFO; absent when the source has no real date. */
  premieredDate?: string;
  plot?: string;
  genres: string[];
  rating?: number;
}

interface DiscoveredMedia {
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  mediaKind: "movie" | "show" | "episode" | "unclassified";
  displayTitle: string;
  seasonNumber?: number;
  episodeNumber?: number;
  collection: CollectionMetadata;
  artwork: Array<{ kind: "poster" | "fanart"; filePath: string }>;
}

function collectionKind(value: ParsedNfo["kind"], episode: boolean, show: boolean): CollectionMetadata["kind"] {
  if (episode || show || value === "tvshow" || value === "episode") return "show";
  if (value === "movie") return "movie";
  return "unclassified";
}

function stableCollectionKey(sourceId: string, relativePath: string, kind: CollectionMetadata["kind"]): string {
  return `${kind}:${sourceId}:${relativePath}`;
}

function mergeNfo(primary: ParsedNfo | undefined, fallback: ParsedNfo | undefined): ParsedNfo | undefined {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    genres: primary.genres.length ? primary.genres : fallback.genres,
    artwork: primary.artwork.length ? primary.artwork : fallback.artwork,
    title: primary.title ?? fallback.title,
    showTitle: primary.showTitle ?? fallback.showTitle,
    year: primary.year ?? fallback.year,
    premieredDate: primary.premieredDate ?? fallback.premieredDate,
    plot: primary.plot ?? fallback.plot,
    rating: primary.rating ?? fallback.rating,
    seasonNumber: primary.seasonNumber ?? fallback.seasonNumber,
    episodeNumber: primary.episodeNumber ?? fallback.episodeNumber,
  };
}

function metadataTitle(nfo: ParsedNfo | undefined, fallback: string): string {
  return nfo?.title?.trim() || fallback;
}

function makeRelative(rootPath: string, filePath: string): string {
  const value = relative(rootPath, filePath);
  if (!value || isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`)) throw new LocalWorkerError("storage", "扫描结果越过已选择的片库目录");
  return value.split(sep).join("/");
}

async function readNfoFile(filePath: string, warnings: string[]): Promise<ParsedNfo | undefined> {
  const cached = scanCaches?.nfo.get(filePath);
  if (cached) {
    profileCount("nfoCacheHits");
    return cached;
  }
  profileCount("nfoFiles");
  const operation = (async (): Promise<ParsedNfo | undefined> => {
    try {
      const metadata = await profileAsync("lstat", () => lstat(filePath), "lstat");
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxNfoBytes) {
        const warning = "NFO 文件过大或不可用，已使用文件名回退";
        warnings.push(warning);
        rememberNfoMetadata(filePath, { size: Number(metadata.size), modifiedAtMs: Number(metadata.mtimeMs), warning });
        return undefined;
      }
      const cachedMetadata = nfoMetadataCache.get(filePath);
      if (cachedMetadata && cachedMetadata.size === Number(metadata.size) && cachedMetadata.modifiedAtMs === Number(metadata.mtimeMs) && !cachedMetadata.warning) {
        profileCount("nfoMetadataCacheHits");
        rememberNfoMetadata(filePath, cachedMetadata);
        return cachedMetadata.value;
      }
      const xml = await profileAsync("nfo", () => readFile(filePath, "utf8"), "readFile");
      const value = profileSync("nfo", () => parseNfo(xml));
      rememberNfoMetadata(filePath, { size: Number(metadata.size), modifiedAtMs: Number(metadata.mtimeMs), value });
      return value;
    } catch {
      const warning = "NFO 无法解析，已使用文件名回退";
      warnings.push(warning);
      // Failed reads are not cached: a transient share error should be retried.
      return undefined;
    }
  })();
  if (scanCaches) scanCaches.nfo.set(filePath, operation);
  return operation;
}

async function artworkPath(rootPath: string, nfoDirectory: string, candidate: string): Promise<string | undefined> {
  const trimmed = candidate.trim();
  if (!trimmed || isAbsolute(trimmed) || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return undefined;
  const filePath = resolve(nfoDirectory, trimmed);
  const cacheKey = `${rootPath}\u0000${filePath}`;
  const cached = scanCaches?.artwork.get(cacheKey);
  if (cached) {
    profileCount("artworkCacheHits");
    return cached;
  }
  profileCount("artworkCandidates");
  const operation = (async (): Promise<string | undefined> => {
    try {
      const metadata = await profileAsync("lstat", () => lstat(filePath), "lstat");
      if (!metadata.isFile() || metadata.isSymbolicLink() || !supportedArtworkExtensions.has(extname(filePath).toLowerCase())) return undefined;
      const safePath = await canonicalPathWithin(rootPath, filePath, rootPath);
      if (safePath) profileCount("artworkMatches");
      return safePath;
    } catch {
      return undefined;
    }
  })();
  if (scanCaches) scanCaches.artwork.set(cacheKey, operation);
  return operation;
}

async function conventionalArtwork(rootPath: string, directory: string, baseName: string, knownEntries?: Dirent[]): Promise<Array<{ kind: "poster" | "fanart"; filePath: string }>> {
  const candidates: Array<{ kind: "poster" | "fanart"; names: string[] }> = [
    { kind: "poster", names: [`${baseName}-poster`, `${baseName}.poster`, "poster", "folder", "cover"] },
    { kind: "fanart", names: [`${baseName}-fanart`, `${baseName}.fanart`, "fanart", "background"] },
  ];
  const output: Array<{ kind: "poster" | "fanart"; filePath: string }> = [];
  const entries = knownEntries ?? await profileAsync("artwork", () => readdir(directory, { withFileTypes: true }), "readdir").catch(() => []);
  for (const candidate of candidates) {
    const match = entries.find((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) return false;
      const stem = basename(entry.name, extname(entry.name));
      return candidate.names.some((name) => stem.toLowerCase() === name.toLowerCase()) && supportedArtworkExtensions.has(extname(entry.name).toLowerCase());
    });
    if (match) {
      const filePath = await profileAsync("artwork", () => artworkPath(rootPath, directory, match.name));
      if (filePath) output.push({ kind: candidate.kind, filePath });
    }
  }
  return output;
}

async function discoverMedia(
  rootPath: string,
  sourceId: string,
  filePath: string,
  fileMetadata: { size: number; mtimeMs: number },
  entries: Array<{ name: string; isFile(): boolean; isSymbolicLink(): boolean }>,
  showContext: { directory: string; metadata?: ParsedNfo; artwork: Array<{ kind: "poster" | "fanart"; filePath: string }> } | undefined,
  warnings: string[],
): Promise<DiscoveredMedia> {
  const relativePath = makeRelative(rootPath, filePath);
  const fileName = basename(filePath);
  const baseName = basename(fileName, extname(fileName));
  const nfoName = `${baseName}.nfo`.toLowerCase();
  const sidecarEntry = entries.find((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase() === nfoName);
  const movieEntry = entries.find((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase() === "movie.nfo");
  const sidecar = sidecarEntry ? await readNfoFile(join(dirname(filePath), sidecarEntry.name), warnings) : undefined;
  const fallbackMovie = !sidecar && movieEntry ? await readNfoFile(join(dirname(filePath), movieEntry.name), warnings) : undefined;
  const nfo = mergeNfo(sidecar, fallbackMovie);
  const parsedNumbers = parseEpisodeNumbers(fileName);
  const seasonNumber = nfo?.seasonNumber ?? parsedNumbers.seasonNumber;
  const episodeNumber = nfo?.episodeNumber ?? parsedNumbers.episodeNumber;
  const episode = nfo?.kind === "episode" || Boolean(showContext && (seasonNumber !== undefined || episodeNumber !== undefined));
  const show = Boolean(showContext) || nfo?.kind === "tvshow" || nfo?.kind === "episode";
  const kind = collectionKind(nfo?.kind, episode, show);
  const collectionDirectory = showContext?.directory ?? dirname(filePath);
  // Shows group by directory; a movie or unclassified file is its own work so
  // one folder with several videos still produces one card per file.
  const collectionRelativePath = show
    ? (collectionDirectory === rootPath ? relativePath : makeRelative(rootPath, collectionDirectory))
    : relativePath;
  const collectionTitle = showContext?.metadata?.title ?? nfo?.showTitle ?? (show ? basename(collectionDirectory) : metadataTitle(nfo, baseName));
  const collectionNfo = showContext?.metadata ?? nfo;
  const displayTitle = episode ? metadataTitle(nfo, baseName) : metadataTitle(nfo, collectionTitle);
  const artworkFiles: Array<{ kind: "poster" | "fanart"; filePath: string }> = [];
  for (const reference of nfo?.artwork ?? []) {
    const resolved = await profileAsync("artwork", () => artworkPath(rootPath, dirname(filePath), reference.path));
    if (resolved) artworkFiles.push({ kind: reference.kind, filePath: resolved });
  }
  if (showContext?.artwork.length) artworkFiles.push(...showContext.artwork);
  if (!artworkFiles.length) {
    const knownEntries = collectionDirectory === dirname(filePath) ? entries as Dirent[] : undefined;
    artworkFiles.push(...await conventionalArtwork(rootPath, collectionDirectory, baseName, knownEntries));
  }
  return {
    relativePath,
    sizeBytes: Number(fileMetadata.size),
    modifiedAtMs: Number(fileMetadata.mtimeMs),
    mediaKind: episode ? "episode" : kind,
    displayTitle,
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    collection: {
      identityKey: stableCollectionKey(sourceId, collectionRelativePath, kind),
      sourceId,
      relativePath: collectionRelativePath,
      title: collectionTitle,
      kind,
      ...(collectionNfo?.year !== undefined ? { year: collectionNfo.year } : {}),
      ...(collectionNfo?.premieredDate ? { premieredDate: collectionNfo.premieredDate } : {}),
      ...(collectionNfo?.plot ? { plot: collectionNfo.plot } : {}),
      genres: collectionNfo?.genres ?? [],
      ...(collectionNfo?.rating !== undefined ? { rating: collectionNfo.rating } : {}),
    },
    artwork: artworkFiles,
  };
}

function upsertCollection(metadata: CollectionMetadata, timestamp: number, preferredCollectionId?: string, preserveExisting = false): string {
  const db = requireDatabase();
  const preferred = preferredCollectionId
    ? profileSync("database", () => db.prepare("SELECT collection_id AS collectionId, identity_key AS identityKey FROM collections WHERE collection_id = ?").get(preferredCollectionId) as { collectionId?: string; identityKey?: string | null } | undefined)
    : undefined;
  const preferredId = preferred?.collectionId ? String(preferred.collectionId) : undefined;
  // A single-file import (Ticket 07) constructs minimal movie metadata; it must
  // never move an indexed episode to a new "movie" work or clear NFO fields.
  // A scan keeps the identity check so old directory-grouped movie rows split
  // into one work per file.
  const reusePreferred = preferredId !== undefined && (preserveExisting || preferred?.identityKey === metadata.identityKey);
  const existing = reusePreferred
    ? { collectionId: preferredId as string }
    : profileSync("database", () => db.prepare(`
    SELECT collection_id AS collectionId
    FROM collections
    WHERE identity_key = ? OR (identity_key IS NULL AND source_id = ? AND relative_path = ?)
    LIMIT 1
  `).get(metadata.identityKey, metadata.sourceId, metadata.relativePath) as { collectionId?: string } | undefined);
  const collectionId = existing?.collectionId ?? makeId("collection");
  if (existing?.collectionId) {
    if (preserveExisting) {
      // Import only fills what is still missing; title, kind, identity and the
      // source-relative grouping stay exactly as the last scan wrote them.
      profileSync("database", () => db.prepare(`
        UPDATE collections SET
          year = COALESCE(year, ?),
          premiered_at = COALESCE(premiered_at, ?),
          plot = COALESCE(plot, ?),
          genre_json = CASE WHEN genre_json IS NULL OR genre_json = '' OR genre_json = '[]' THEN ? ELSE genre_json END,
          rating = COALESCE(rating, ?),
          updated_at = ?
        WHERE collection_id = ?
      `).run(metadata.year ?? null, metadata.premieredDate ?? null, metadata.plot ?? null, JSON.stringify(metadata.genres), metadata.rating ?? null, timestamp, collectionId));
    } else {
      profileSync("database", () => db.prepare(`
        UPDATE collections SET title = ?, kind = ?, year = ?, premiered_at = ?, plot = ?, genre_json = ?, rating = ?, identity_key = ?, source_id = ?, relative_path = ?, updated_at = ?
        WHERE collection_id = ?
      `).run(metadata.title, metadata.kind, metadata.year ?? null, metadata.premieredDate ?? null, metadata.plot ?? null, JSON.stringify(metadata.genres), metadata.rating ?? null, metadata.identityKey, metadata.sourceId, metadata.relativePath, timestamp, collectionId));
    }
  } else {
    profileSync("database", () => db.prepare(`
      INSERT INTO collections (collection_id, title, kind, year, premiered_at, plot, genre_json, rating, identity_key, source_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(collectionId, metadata.title, metadata.kind, metadata.year ?? null, metadata.premieredDate ?? null, metadata.plot ?? null, JSON.stringify(metadata.genres), metadata.rating ?? null, metadata.identityKey, metadata.sourceId, metadata.relativePath, timestamp, timestamp));
  }
  return collectionId;
}

function artworkFingerprint(sourceId: string, relativePath: string, sizeBytes: number, modifiedAtMs: number): { sourceFingerprint: string; cacheKey: string } {
  const sourceFingerprint = `${sourceId}:${relativePath}:${sizeBytes}:${modifiedAtMs}`;
  const cacheKey = `artwork_${createHash("sha256").update(sourceFingerprint).digest("hex")}`;
  return { sourceFingerprint, cacheKey };
}

interface PreparedArtwork {
  kind: "poster" | "fanart";
  relativePath: string;
  sourceFingerprint: string;
  cacheKey: string;
}

async function prepareArtwork(
  rootPath: string,
  sourceId: string,
  artwork: Array<{ kind: "poster" | "fanart"; filePath: string }>,
): Promise<PreparedArtwork[]> {
  const prepared: PreparedArtwork[] = [];
  for (const candidate of artwork) {
    try {
      const info = await profileAsync("lstat", () => lstat(candidate.filePath), "lstat");
      const relativePath = makeRelative(rootPath, candidate.filePath);
      const fingerprint = artworkFingerprint(sourceId, relativePath, Number(info.size), Number(info.mtimeMs));
      prepared.push({ kind: candidate.kind, relativePath, ...fingerprint });
    } catch {
      // Artwork is optional. A missing or inaccessible image never removes a playable item.
    }
  }
  return prepared;
}

/**
 * Write this file's artwork rows. Returns true when at least one row was
 * written, so a scan can tell a pure artwork refresh from an NFO metadata edit.
 */
function upsertArtwork(
  collectionId: string,
  mediaId: string,
  sourceId: string,
  artwork: PreparedArtwork[],
): boolean {
  if (!artwork.length) return false;
  const db = requireDatabase();
  const timestamp = now();
  let written = false;
  for (const candidate of artwork) {
    const existing = profileSync("database", () => db.prepare("SELECT relative_path AS relativePath, source_fingerprint AS sourceFingerprint FROM artwork WHERE collection_id = ? AND media_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1").get(collectionId, mediaId, candidate.kind) as { relativePath?: string; sourceFingerprint?: string } | undefined);
    if (existing?.relativePath === candidate.relativePath && existing.sourceFingerprint === candidate.sourceFingerprint) {
      profileCount("artworkDatabaseCacheHits");
      continue;
    }
    profileSync("database", () => db.prepare("DELETE FROM artwork WHERE collection_id = ? AND media_id = ? AND kind = ?").run(collectionId, mediaId, candidate.kind));
    profileSync("database", () => db.prepare(`
      INSERT INTO artwork (artwork_id, collection_id, media_id, source_id, relative_path, kind, source_fingerprint, cache_key, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(makeId("artwork"), collectionId, mediaId, sourceId, candidate.relativePath, candidate.kind, candidate.sourceFingerprint, candidate.cacheKey, timestamp));
    written = true;
  }
  return written;
}

interface UpsertMediaOptions {
  /** Load the row back as a renderer-safe item (single-file import). */
  includeItem?: boolean;
  /**
   * Single-file import: reuse the file's current work and media row and only
   * fill missing values. The scan path replaces NFO-derived data because the
   * scan is the metadata owner.
   */
  preserveExistingMetadata?: boolean;
}

/** What one upsert actually did, so a scan can count it instead of guessing. */
interface UpsertMediaOutcome {
  item?: LocalMediaItem;
  /** A new media row was created: a new file, or a new identity after a fingerprint change. */
  created: boolean;
  /** An existing row was updated in place by an NFO or artwork change. */
  updated: boolean;
  /** Of `updated`, the NFO-derived metadata is what changed. */
  nfoChanged: boolean;
  /** Rows tombstoned because this path now has a different video fingerprint. */
  removedRows: number;
  /** A stored identity already existed at this path with a different video fingerprint. */
  replaced: boolean;
}

interface StoredMediaMetadata {
  /** NFO-derived media and work values; timestamps, size and artwork are excluded. */
  nfo: string;
  /** 1 when the row is part of the current library, 0 when it is a tombstone. */
  available: number;
}

/**
 * The stored side of the comparison behind the four scan counts. Reading the
 * joined work row is what makes an NFO edit visible: a file whose video
 * fingerprint is unchanged takes the in-place update path, so a different
 * title/plot/year/season here means the NFO — not the file — changed.
 */
function storedMediaMetadata(mediaId: string): StoredMediaMetadata {
  const db = requireDatabase();
  const row = profileSync("database", () => db.prepare(`
    SELECT media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.collection_id AS collectionId, media_files.available AS available,
      collections.title AS collectionTitle, collections.kind AS collectionKind,
      collections.year, collections.premiered_at AS premieredAt, collections.plot,
      collections.genre_json AS genreJson, collections.rating
    FROM media_files JOIN collections USING (collection_id)
    WHERE media_files.media_id = ?
  `).get(mediaId) as Record<string, unknown> | undefined);
  if (!row) return { nfo: JSON.stringify(null), available: 0 };
  const { available, ...nfoFields } = row;
  return { nfo: JSON.stringify(nfoFields), available: Number(available ?? 0) };
}

async function upsertMedia(rootPath: string, discovered: DiscoveredMedia, options: UpsertMediaOptions = {}): Promise<UpsertMediaOutcome> {
  const db = requireDatabase();
  const timestamp = now();
  const includeItem = options.includeItem ?? true;
  const preserveExistingMetadata = options.preserveExistingMetadata === true;
  const preparedArtwork = await prepareArtwork(rootPath, discovered.collection.sourceId, discovered.artwork);
  try {
    profileSync("database", () => db.exec("BEGIN IMMEDIATE"));
    const existing = profileSync("database", () => db.prepare(`
      SELECT media_id AS mediaId, collection_id AS collectionId
      FROM media_files
      WHERE source_id = ? AND relative_path = ? AND size_bytes = ? AND modified_at_ms = ?
    `).get(discovered.collection.sourceId, discovered.relativePath, discovered.sizeBytes, discovered.modifiedAtMs) as { mediaId?: string; collectionId?: string } | undefined);
    // Snapshot the stored NFO-derived state before the write. Reading it first
    // is what lets a scan count "updated" from a real comparison instead of
    // counting every file it happened to see again.
    const before = existing?.mediaId && !preserveExistingMetadata ? storedMediaMetadata(String(existing.mediaId)) : undefined;
    // Any stored identity at this path whose fingerprint did not match is the
    // superseded identity of a replacement.
    const priorIdentity = existing?.mediaId
      ? undefined
      : profileSync("database", () => db.prepare("SELECT media_id AS mediaId FROM media_files WHERE source_id = ? AND relative_path = ? LIMIT 1").get(discovered.collection.sourceId, discovered.relativePath) as { mediaId?: string } | undefined);
    const collectionId = upsertCollection(discovered.collection, timestamp, existing?.collectionId, preserveExistingMetadata);
    let mediaId: string;
    let created = false;
    let removedRows = 0;
    if (existing?.mediaId) {
      mediaId = String(existing.mediaId);
      if (preserveExistingMetadata) {
        // Import must not relabel an indexed episode as a movie or drop its
        // season/episode numbers that a scan derived from the file name or NFO.
        profileSync("database", () => db.prepare(`
          UPDATE media_files SET collection_id = ?, display_title = COALESCE(NULLIF(display_title, ''), ?),
            media_kind = CASE WHEN media_kind = 'unclassified' THEN ? ELSE media_kind END,
            season_number = COALESCE(season_number, ?), episode_number = COALESCE(episode_number, ?),
            available = 1, updated_at = ?
          WHERE media_id = ?
        `).run(collectionId, discovered.displayTitle, discovered.mediaKind, discovered.seasonNumber ?? null, discovered.episodeNumber ?? null, timestamp, mediaId));
      } else {
        profileSync("database", () => db.prepare(`
          UPDATE media_files SET collection_id = ?, display_title = ?, media_kind = ?, season_number = ?, episode_number = ?, available = 1, updated_at = ?
          WHERE media_id = ?
        `).run(collectionId, discovered.displayTitle, discovered.mediaKind, discovered.seasonNumber ?? null, discovered.episodeNumber ?? null, timestamp, mediaId));
      }
    } else {
      profileSync("database", () => db.prepare(`
        DELETE FROM viewing_sessions WHERE media_id IN (
          SELECT media_id FROM media_files WHERE source_id = ? AND relative_path = ? AND available = 1
        )
      `).run(discovered.collection.sourceId, discovered.relativePath));
      profileSync("database", () => db.prepare(`
        DELETE FROM media_history WHERE media_id IN (
          SELECT media_id FROM media_files WHERE source_id = ? AND relative_path = ? AND available = 1
        )
      `).run(discovered.collection.sourceId, discovered.relativePath));
      // A replaced file is a new identity; the old user-written markers must not
      // survive as orphans pointing at the tombstoned row.
      profileSync("database", () => db.prepare(`
        DELETE FROM markers WHERE media_id IN (
          SELECT media_id FROM media_files WHERE source_id = ? AND relative_path = ? AND available = 1
        )
      `).run(discovered.collection.sourceId, discovered.relativePath));
      // Count the rows actually tombstoned: a fingerprint change supersedes the
      // stored identity, which is a removal from the visible library.
      const tombstoned = profileSync("database", () => db.prepare("UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ? AND relative_path = ? AND available = 1").run(timestamp, discovered.collection.sourceId, discovered.relativePath));
      removedRows = Number(tombstoned.changes ?? 0);
      mediaId = makeId("media");
      created = true;
      profileSync("database", () => db.prepare(`
        INSERT INTO media_files (media_id, collection_id, source_id, relative_path, display_title, media_kind, size_bytes, modified_at_ms, season_number, episode_number, available, added_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(mediaId, collectionId, discovered.collection.sourceId, discovered.relativePath, discovered.displayTitle, discovered.mediaKind, discovered.sizeBytes, discovered.modifiedAtMs, discovered.seasonNumber ?? null, discovered.episodeNumber ?? null, timestamp, timestamp));
    }
    const artworkWritten = upsertArtwork(collectionId, mediaId, discovered.collection.sourceId, preparedArtwork);
    let updated = false;
    let nfoChanged = false;
    if (before) {
      const after = storedMediaMetadata(mediaId);
      nfoChanged = after.nfo !== before.nfo;
      // A row that came back from a tombstone with nothing else changed is an
      // in-place update too: it re-enters the library without a new identity.
      updated = nfoChanged || artworkWritten || (before.available === 0 && after.available === 1);
    }
    const row = includeItem
      ? profileSync("database", () => db.prepare(`
        SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
          media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
          media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
          media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
          media_files.available, sources.available AS sourceAvailable,
          collections.title, collections.kind, collections.year, collections.plot,
          collections.genre_json AS genreJson, collections.rating, collections.premiered_at AS premieredAt
        FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
        WHERE media_files.media_id = ?
      `).get(mediaId) as Record<string, unknown>)
      : undefined;
    profileSync("database", () => db.exec("COMMIT"));
    return {
      ...(row ? { item: toPublicItem(row) } : {}),
      created,
      updated,
      nfoChanged,
      removedRows,
      replaced: created && Boolean(priorIdentity?.mediaId),
    };
  } catch (error) {
    profileError(error);
    try {
      profileSync("database", () => db.exec("ROLLBACK"));
    } catch {
      // Preserve the original scan error when rollback itself is unavailable.
    }
    throw error;
  }
}

function sourceSummaries(): LocalSourceSummary[] {
  const db = requireDatabase();
  // Tombstone rows (available = 0) are not part of the folder's current
  // contents, so the folder card counts only current files; a file kept while
  // the source is offline still counts. `degraded` distinguishes "some
  // subdirectories could not be read" from "the whole folder is offline".
  const rows = db.prepare(`
    SELECT sources.source_id AS sourceId, sources.root_path AS rootPath, sources.label,
      sources.available, sources.degraded,
      COUNT(media_files.media_id) AS itemCount,
      COUNT(DISTINCT media_files.collection_id) AS collectionCount
    FROM sources
    LEFT JOIN media_files ON media_files.source_id = sources.source_id AND media_files.available = 1
    GROUP BY sources.source_id
    ORDER BY sources.label COLLATE NOCASE
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const rootPath = typeof row.rootPath === "string" ? row.rootPath : "";
    return {
      sourceId: String(row.sourceId),
      label: rootPath ? safeSourceLabel(rootPath) : safeSourceLabel(String(row.label ?? "")),
      locationHint: rootPath ? safeSourceLocationHint(rootPath) : "所选文件夹",
      available: Number(row.available) === 1,
      degraded: Number(row.degraded) === 1,
      itemCount: Number(row.itemCount),
      collectionCount: Number(row.collectionCount),
    };
  });
}

function state(): { schemaVersion: typeof LOCAL_LIBRARY_SCHEMA_VERSION; sqliteAvailable: true; sources: LocalSourceSummary[] } {
  requireDatabase();
  return { schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION, sqliteAvailable: true, sources: sourceSummaries() };
}

function list(query: LocalLibraryQuery): { totalCount: number; items: LocalMediaItem[] } {
  const db = requireDatabase();
  const text = query.query?.trim() ?? "";
  // A replaced/deleted file keeps its row as a tombstone (available = 0) so
  // playback and viewing history stay attributable, but it is never a card in
  // the file list. An offline source is different: its rows stay available and
  // are listed (greyed out) because the file itself is still indexed.
  const clauses = ["media_files.available = 1"];
  const parameters: Array<string | number> = [];
  if (text) {
    clauses.push("(collections.title LIKE ? OR media_files.display_title LIKE ?)");
    parameters.push(`%${text}%`, `%${text}%`);
  }
  if (query.filter && query.filter !== "all") {
    clauses.push(query.filter === "show" ? "collections.kind = 'show'" : "media_files.media_kind = ?");
    if (query.filter !== "show") parameters.push(query.filter);
  }
  if (query.sourceId) {
    clauses.push("media_files.source_id = ?");
    parameters.push(query.sourceId);
  }
  const count = db.prepare(`SELECT COUNT(*) AS count FROM media_files JOIN collections USING (collection_id) WHERE ${clauses.join(" AND ")}`).get(...parameters) as { count?: number } | undefined;
  const sort = query.sort ?? "recent";
  const orderBy = sort === "title"
    ? "collections.title COLLATE NOCASE ASC, media_files.display_title COLLATE NOCASE ASC"
    : sort === "year_desc"
      ? "collections.year IS NULL ASC, collections.year DESC, collections.title COLLATE NOCASE ASC"
      : sort === "score_desc"
        ? "collections.rating IS NULL ASC, collections.rating DESC, collections.title COLLATE NOCASE ASC"
        : sort === "added_desc"
          ? "media_files.added_at DESC, collections.title COLLATE NOCASE ASC"
          : sort === "released_desc"
            ? "collections.premiered_at IS NULL ASC, collections.premiered_at DESC, collections.year IS NULL ASC, collections.year DESC, media_files.added_at DESC, collections.title COLLATE NOCASE ASC"
            : "media_files.updated_at DESC, collections.title COLLATE NOCASE ASC";
  const rows = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
      media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
      media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.available, sources.available AS sourceAvailable,
      collections.title, collections.kind, collections.year, collections.plot,
      collections.genre_json AS genreJson, collections.rating, collections.premiered_at AS premieredAt
    FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as Array<Record<string, unknown>>;
  return { totalCount: Number(count?.count ?? 0), items: rows.map(toPublicItem) };
}

interface CollectionEpisodeRow {
  mediaId?: string;
  collectionId?: string;
  displayTitle?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  available?: number;
  sourceAvailable?: number;
  watched?: number | null;
  positionSec?: number | null;
  durationSec?: number | null;
  updatedAtMs?: number | null;
}

/**
 * Work-level read path: one row per collection, bounded by the requested page.
 * Episodes for only the page's collections are loaded to derive watched counts,
 * resume position and the representative media ID.
 */
function listCollections(query: LocalCollectionQuery): { totalCount: number; items: LocalCollectionSummary[] } {
  const db = requireDatabase();
  const text = query.query?.trim() ?? "";
  const clauses: string[] = [];
  const parameters: Array<string | number> = [];
  if (text) {
    clauses.push("(collections.title LIKE ? OR collections.collection_id IN (SELECT match_media.collection_id FROM media_files match_media WHERE match_media.available = 1 AND match_media.display_title LIKE ?))");
    parameters.push(`%${text}%`, `%${text}%`);
  }
  if (query.filter && query.filter !== "all") {
    clauses.push("collections.kind = ?");
    parameters.push(query.filter);
  }
  if (query.sourceId) {
    clauses.push("collections.collection_id IN (SELECT source_media.collection_id FROM media_files source_media WHERE source_media.source_id = ?)");
    parameters.push(query.sourceId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const currentWhere = clauses.length ? `WHERE aggregate.episodeCount > 0 AND ${clauses.join(" AND ")}` : "WHERE aggregate.episodeCount > 0";
  // Only works with at least one current file are listed or counted; a work
  // whose files are all tombstones has nothing to open.
  const count = db.prepare(`
    SELECT COUNT(*) AS count
    FROM collections
      JOIN (SELECT collection_id FROM media_files WHERE available = 1 GROUP BY collection_id) scoped ON scoped.collection_id = collections.collection_id
    ${where}
  `).get(...parameters) as { count?: number } | undefined;
  const sort = query.sort ?? "recent";
  const orderBy = sort === "title"
    ? "collections.title COLLATE NOCASE ASC, collections.collection_id ASC"
    : sort === "year_desc"
      ? "collections.year IS NULL ASC, collections.year DESC, collections.title COLLATE NOCASE ASC"
      : sort === "score_desc"
        ? "collections.rating IS NULL ASC, collections.rating DESC, collections.title COLLATE NOCASE ASC"
        : sort === "added_desc"
          ? "aggregate.addedAtMs DESC, collections.title COLLATE NOCASE ASC"
          : sort === "released_desc"
            ? "collections.premiered_at IS NULL ASC, collections.premiered_at DESC, collections.year IS NULL ASC, collections.year DESC, aggregate.addedAtMs DESC, collections.title COLLATE NOCASE ASC"
            : "COALESCE(played.lastPlayedAtMs, aggregate.updatedAtMs) DESC, aggregate.updatedAtMs DESC, collections.title COLLATE NOCASE ASC";
  const rows = db.prepare(`
    WITH aggregate AS (
      SELECT media_files.collection_id AS collectionId,
        SUM(CASE WHEN media_files.available = 1 THEN 1 ELSE 0 END) AS episodeCount,
        SUM(CASE WHEN media_files.available = 1 AND sources.available = 1 THEN 1 ELSE 0 END) AS availableEpisodeCount,
        MAX(media_files.added_at) AS addedAtMs,
        MAX(media_files.updated_at) AS updatedAtMs
      FROM media_files JOIN sources ON sources.source_id = media_files.source_id
      GROUP BY media_files.collection_id
    ),
    played AS (
      SELECT media_files.collection_id AS collectionId, MAX(playback_state.updated_at) AS lastPlayedAtMs
      FROM media_files JOIN playback_state ON playback_state.media_id = media_files.media_id
      WHERE media_files.available = 1
      GROUP BY media_files.collection_id
    )
    SELECT collections.collection_id AS collectionId, collections.title, collections.kind,
      collections.year, collections.rating, collections.premiered_at AS premieredAt,
      aggregate.episodeCount, aggregate.availableEpisodeCount, aggregate.addedAtMs, aggregate.updatedAtMs,
      played.lastPlayedAtMs
    FROM collections
      JOIN aggregate ON aggregate.collectionId = collections.collection_id
      LEFT JOIN played ON played.collectionId = collections.collection_id
    ${currentWhere}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as Array<Record<string, unknown>>;
  return { totalCount: Number(count?.count ?? 0), items: collectionSummaries(rows, text) };
}

function collectionSummaries(rows: Array<Record<string, unknown>>, text: string): LocalCollectionSummary[] {
  if (!rows.length) return [];
  const db = requireDatabase();
  const collectionIds = rows.map((row) => String(row.collectionId));
  const placeholders = collectionIds.map(() => "?").join(",");
  const episodes = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId,
      media_files.display_title AS displayTitle,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.available, sources.available AS sourceAvailable,
      playback_state.watched, playback_state.position_sec AS positionSec,
      playback_state.duration_sec AS durationSec, playback_state.updated_at AS updatedAtMs
    FROM media_files JOIN sources ON sources.source_id = media_files.source_id
      LEFT JOIN playback_state ON playback_state.media_id = media_files.media_id
    WHERE media_files.collection_id IN (${placeholders}) AND media_files.available = 1
    ORDER BY media_files.season_number IS NULL, media_files.season_number, media_files.episode_number IS NULL,
      media_files.episode_number, media_files.display_title COLLATE NOCASE, media_files.media_id
  `).all(...collectionIds) as CollectionEpisodeRow[];
  const episodesByCollection = new Map<string, CollectionEpisodeRow[]>();
  for (const episode of episodes) {
    const key = String(episode.collectionId);
    const list = episodesByCollection.get(key);
    if (list) list.push(episode);
    else episodesByCollection.set(key, [episode]);
  }
  const matchedByCollection = new Map<string, LocalCollectionSummary["matchedEpisode"]>();
  if (text) {
    const matches = db.prepare(`
      SELECT media_files.collection_id AS collectionId, media_files.media_id AS mediaId,
        media_files.display_title AS displayTitle, media_files.season_number AS seasonNumber,
        media_files.episode_number AS episodeNumber
      FROM media_files
      WHERE media_files.collection_id IN (${placeholders}) AND media_files.available = 1 AND media_files.display_title LIKE ?
      ORDER BY media_files.collection_id, media_files.season_number IS NULL, media_files.season_number,
        media_files.episode_number IS NULL, media_files.episode_number, media_files.display_title COLLATE NOCASE
    `).all(...collectionIds, `%${text}%`) as CollectionEpisodeRow[];
    for (const match of matches) {
      const key = String(match.collectionId);
      if (matchedByCollection.has(key) || !match.mediaId) continue;
      matchedByCollection.set(key, {
        mediaId: String(match.mediaId) as `media_${string}`,
        title: String(match.displayTitle ?? ""),
        ...(match.seasonNumber === null || match.seasonNumber === undefined ? {} : { seasonNumber: Number(match.seasonNumber) }),
        ...(match.episodeNumber === null || match.episodeNumber === undefined ? {} : { episodeNumber: Number(match.episodeNumber) }),
      });
    }
  }
  const posterMediaIds = new Map<string, string>();
  const posters = db.prepare(`
    SELECT collection_id AS collectionId, media_id AS mediaId
    FROM artwork
    WHERE collection_id IN (${placeholders}) AND kind = 'poster' AND media_id IS NOT NULL
    ORDER BY updated_at DESC
  `).all(...collectionIds) as Array<{ collectionId?: string; mediaId?: string }>;
  for (const poster of posters) {
    const key = String(poster.collectionId);
    if (!posterMediaIds.has(key) && poster.mediaId) posterMediaIds.set(key, poster.mediaId);
  }
  const output: LocalCollectionSummary[] = [];
  for (const row of rows) {
    const collectionId = String(row.collectionId);
    const collectionEpisodes = episodesByCollection.get(collectionId) ?? [];
    if (!collectionEpisodes.length) continue;
    let watchedEpisodeCount = 0;
    let availableEpisodeCount = 0;
    let resumeRow: CollectionEpisodeRow | undefined;
    for (const episode of collectionEpisodes) {
      if (Number(episode.watched) === 1) watchedEpisodeCount += 1;
      if (Number(episode.available) === 1 && Number(episode.sourceAvailable) === 1) availableEpisodeCount += 1;
      if (Number(episode.watched) === 1 || !(Number(episode.positionSec) > 0)) continue;
      if (!resumeRow || Number(episode.updatedAtMs) > Number(resumeRow.updatedAtMs)) resumeRow = episode;
    }
    const representative = resumeRow ?? collectionEpisodes.find((episode) => Number(episode.watched) !== 1) ?? collectionEpisodes[0];
    if (!representative?.mediaId) continue;
    const representativeMediaId = String(representative.mediaId) as `media_${string}`;
    const coverMediaId = (posterMediaIds.get(collectionId) ?? representativeMediaId) as `media_${string}`;
    const kind = row.kind === "movie" || row.kind === "show" ? row.kind : "unclassified";
    const artwork = artworkFor(collectionId, coverMediaId);
    const matchedEpisode = matchedByCollection.get(collectionId);
    output.push({
      collectionId,
      title: String(row.title ?? ""),
      kind,
      ...(row.year === null || row.year === undefined ? {} : { year: Number(row.year) }),
      ...(row.rating === null || row.rating === undefined ? {} : { rating: Number(row.rating) }),
      premieredDate: parsePremieredDate(row.premieredAt),
      episodeCount: Number(row.episodeCount),
      watchedEpisodeCount,
      availableEpisodeCount,
      available: availableEpisodeCount > 0,
      representativeMediaId,
      coverMediaId,
      ...(resumeRow?.mediaId ? {
        resume: {
          mediaId: String(resumeRow.mediaId) as `media_${string}`,
          positionSec: Number(resumeRow.positionSec),
          ...(resumeRow.durationSec === null || resumeRow.durationSec === undefined ? {} : { durationSec: Number(resumeRow.durationSec) }),
          ...(resumeRow.seasonNumber === null || resumeRow.seasonNumber === undefined ? {} : { seasonNumber: Number(resumeRow.seasonNumber) }),
          ...(resumeRow.episodeNumber === null || resumeRow.episodeNumber === undefined ? {} : { episodeNumber: Number(resumeRow.episodeNumber) }),
          episodeTitle: String(resumeRow.displayTitle ?? ""),
          updatedAtMs: Number(resumeRow.updatedAtMs),
        },
      } : {}),
      ...(matchedEpisode ? { matchedEpisode } : {}),
      addedAtMs: Number(row.addedAtMs),
      updatedAtMs: Number(row.updatedAtMs),
      ...(artwork ? { artwork } : {}),
    });
  }
  return output;
}

function get(mediaId: string): LocalMediaItem | undefined {
  const db = requireDatabase();
  const row = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
      media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
      media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.available, sources.available AS sourceAvailable,
      collections.title, collections.kind, collections.year, collections.plot,
      collections.genre_json AS genreJson, collections.rating, collections.premiered_at AS premieredAt
    FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
    WHERE media_files.media_id = ?
  `).get(mediaId) as Record<string, unknown> | undefined;
  return row ? toPublicItem(row) : undefined;
}

function getDetail(mediaId: string): LocalMediaDetail | undefined {
  const item = get(mediaId);
  if (!item) return undefined;
  const db = requireDatabase();
  // A tombstone row (replaced or scan-confirmed missing) is a clear "no longer
  // available" result, never a successful detail with an empty episode list.
  const ownRow = db.prepare("SELECT available FROM media_files WHERE media_id = ?").get(mediaId) as { available?: number } | undefined;
  if (Number(ownRow?.available) !== 1) return undefined;
  const playback = getPlayback(item.mediaId);
  const episodePlayback = getCollectionPlayback(item.collectionId);
  // A cleanup "keep/snooze/delete" mark may create a zero aggregate row before
  // the file was ever played. It is not a viewing record until a session exists.
  const viewing = hasViewingSessions(item.mediaId) ? getViewingHistory(item.mediaId) : undefined;
  const collection = db.prepare("SELECT title, kind FROM collections WHERE collection_id = ?").get(item.collectionId) as { title?: string; kind?: string } | undefined;
  const rows = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
      media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
      media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.available, sources.available AS sourceAvailable,
      collections.title, collections.kind, collections.year, collections.plot,
      collections.genre_json AS genreJson, collections.rating, collections.premiered_at AS premieredAt
    FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
    WHERE media_files.collection_id = ? AND media_files.available = 1
    ORDER BY media_files.season_number IS NULL, media_files.season_number, media_files.episode_number IS NULL,
      media_files.episode_number, media_files.display_title COLLATE NOCASE
  `).all(item.collectionId) as Array<Record<string, unknown>>;
  const episodes = rows.map(toPublicItem);
  if (episodes.length === 0) return undefined;
  return {
    item,
    ...(collection?.title ? { collectionTitle: collection.title } : {}),
    ...(collection?.kind === "movie" || collection?.kind === "show" || collection?.kind === "unclassified" ? { collectionKind: collection.kind } : {}),
    episodes,
    ...(playback ? { playback } : {}),
    ...(episodePlayback.length > 0 ? { episodePlayback } : {}),
    ...(viewing ? { viewing } : {}),
  };
}

function listContinueWatching(): LocalContinueWatchingItem[] {
  const db = requireDatabase();
  // One entry per work: rank in-progress episodes by their latest update and
  // keep only the most recent one. A work enters once playback is real enough
  // to resume (30 seconds, or 3% for a work shorter than ten minutes).
  const rows = db.prepare(`
    WITH candidates AS (
      SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
        media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
        media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
        media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
        media_files.available, sources.available AS sourceAvailable,
        collections.title, collections.kind, collections.year, collections.plot,
        collections.genre_json AS genreJson, collections.rating, collections.premiered_at AS premieredAt,
        collections.title AS collectionTitle, collections.kind AS collectionKind,
        playback_state.position_sec AS positionSec, playback_state.duration_sec AS durationSec,
        playback_state.audio_track_id AS audioTrackId, playback_state.subtitle_track_id AS subtitleTrackId,
        playback_state.watched, playback_state.updated_at AS updatedAtMs,
        ROW_NUMBER() OVER (
          PARTITION BY media_files.collection_id
          ORDER BY playback_state.updated_at DESC, media_files.media_id ASC
        ) AS collectionRank
      FROM playback_state
        JOIN media_files ON media_files.media_id = playback_state.media_id
        JOIN collections USING (collection_id)
        JOIN sources USING (source_id)
      WHERE playback_state.watched = 0
        AND media_files.available = 1
        AND playback_state.position_sec > 0
        AND (
          playback_state.position_sec >= 30
          OR (
            playback_state.duration_sec IS NOT NULL
            AND playback_state.duration_sec > 0
            AND playback_state.duration_sec < 600
            AND playback_state.position_sec * 100 >= playback_state.duration_sec * 3
          )
        )
    )
    SELECT * FROM candidates
    WHERE collectionRank = 1
    ORDER BY updatedAtMs DESC, collectionId ASC
    LIMIT 50
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    item: toPublicItem(row),
    playback: playbackFromRow(row),
    collectionTitle: String(row.collectionTitle ?? row.title ?? ""),
    collectionKind: row.collectionKind === "movie" || row.collectionKind === "show" ? row.collectionKind : "unclassified",
    episodeTitle: String(row.displayTitle ?? ""),
    ...(row.seasonNumber === null || row.seasonNumber === undefined ? {} : { seasonNumber: Number(row.seasonNumber) }),
    ...(row.episodeNumber === null || row.episodeNumber === undefined ? {} : { episodeNumber: Number(row.episodeNumber) }),
  }));
}

function sourceRoot(sourceId: string): string | undefined {
  const db = requireDatabase();
  const row = db.prepare("SELECT root_path AS rootPath FROM sources WHERE source_id = ?").get(sourceId) as { rootPath?: string } | undefined;
  return row?.rootPath;
}

function removeSource(sourceId: string): boolean {
  const db = requireDatabase();
  const source = db.prepare("SELECT source_id AS sourceId FROM sources WHERE source_id = ?").get(sourceId) as { sourceId?: string } | undefined;
  if (!source?.sourceId) return false;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Removing a source is an explicit delete: never keep a viewing tombstone.
    db.prepare("DELETE FROM markers WHERE media_id IN (SELECT media_id FROM media_files WHERE source_id = ?)").run(sourceId);
    db.prepare("DELETE FROM viewing_sessions WHERE media_id IN (SELECT media_id FROM media_files WHERE source_id = ?)").run(sourceId);
    db.prepare("DELETE FROM media_history WHERE media_id IN (SELECT media_id FROM media_files WHERE source_id = ?)").run(sourceId);
    db.prepare("DELETE FROM playback_state WHERE media_id IN (SELECT media_id FROM media_files WHERE source_id = ?)").run(sourceId);
    db.prepare("DELETE FROM artwork WHERE source_id = ?").run(sourceId);
    db.prepare("DELETE FROM media_files WHERE source_id = ?").run(sourceId);
    db.prepare("DELETE FROM collections WHERE source_id = ?").run(sourceId);
    db.prepare("DELETE FROM scan_runs WHERE source_id = ?").run(sourceId);
    db.prepare("DELETE FROM sources WHERE source_id = ?").run(sourceId);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function resolveArtwork(mediaId: string, kind?: "poster" | "fanart"): Promise<{ path: string; cacheKey: string; kind: "poster" | "fanart" } | undefined> {
  const db = requireDatabase();
  const row = db.prepare(`
    SELECT sources.root_path AS rootPath, artwork.relative_path AS relativePath,
      artwork.cache_key AS cacheKey, artwork.kind
    FROM artwork
      JOIN sources ON sources.source_id = artwork.source_id
    WHERE artwork.media_id = ? AND (? IS NULL OR artwork.kind = ?)
    ORDER BY CASE WHEN artwork.kind = 'poster' THEN 0 ELSE 1 END, artwork.updated_at DESC
    LIMIT 1
  `).get(mediaId, kind ?? null, kind ?? null) as { rootPath?: string; relativePath?: string; cacheKey?: string; kind?: string } | undefined;
  if (!row?.rootPath || !row.relativePath || !row.cacheKey || (row.kind !== "poster" && row.kind !== "fanart")) return undefined;
  const requestedPath = resolve(row.rootPath, ...row.relativePath.split("/"));
  const path = await canonicalPathWithin(row.rootPath, requestedPath);
  if (!path) return undefined;
  const metadata = await lstat(requestedPath).catch(() => undefined);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) return undefined;
  return { path, cacheKey: row.cacheKey, kind: row.kind };
}

async function resolvePath(mediaId: string): Promise<string | undefined> {
  const db = requireDatabase();
  const row = db.prepare(`
    SELECT sources.root_path AS rootPath, media_files.relative_path AS relativePath
    FROM media_files JOIN sources USING (source_id)
    WHERE media_files.media_id = ?
  `).get(mediaId) as { rootPath?: string; relativePath?: string } | undefined;
  if (!row?.rootPath || !row.relativePath) return undefined;
  const requestedPath = resolve(row.rootPath, ...row.relativePath.split("/"));
  const path = await canonicalPathWithin(row.rootPath, requestedPath);
  if (!path) return undefined;
  const metadata = await lstat(requestedPath).catch(() => undefined);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) return undefined;
  return path;
}

/** `playback_state.subtitle_track_id` stores an explicit "off" choice as the sentinel. */
const SUBTITLE_OFF_SENTINEL = "off";

/**
 * DB → DTO subtitle mapping. `"off"` reads back as `null` (the user explicitly
 * turned subtitles off); NULL omits the field (never chosen). Ticket 09 keeps the
 * DTO contract at `string | null | undefined`, so no schema version is added.
 */
function subtitleTrackFromRow(value: unknown): string | null | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value === SUBTITLE_OFF_SENTINEL ? null : value;
}

/** DTO → DB subtitle mapping: `null` persists the sentinel, `undefined` clears the column. */
function subtitleTrackToColumn(value: string | null | undefined): string | null {
  if (value === null) return SUBTITLE_OFF_SENTINEL;
  if (value === undefined) return null;
  return value;
}

function playbackFromRow(row: Record<string, unknown>): LocalPlaybackState {
  const subtitleTrackId = subtitleTrackFromRow(row.subtitleTrackId);
  return {
    mediaId: String(row.mediaId) as LocalPlaybackState["mediaId"],
    positionSec: Number(row.positionSec),
    ...(row.durationSec === null || row.durationSec === undefined ? {} : { durationSec: Number(row.durationSec) }),
    ...(row.audioTrackId === null || row.audioTrackId === undefined ? {} : { audioTrackId: String(row.audioTrackId) }),
    ...(subtitleTrackId === undefined ? {} : { subtitleTrackId }),
    watched: Number(row.watched) === 1,
    updatedAtMs: Number(row.updatedAtMs),
  };
}

function getPlayback(mediaId: string): LocalPlaybackState | undefined {
  const db = requireDatabase();
  const row = db.prepare(`
    SELECT media_id AS mediaId, position_sec AS positionSec, duration_sec AS durationSec,
      audio_track_id AS audioTrackId, subtitle_track_id AS subtitleTrackId,
      watched, updated_at AS updatedAtMs
    FROM playback_state WHERE media_id = ?
  `).get(mediaId) as Record<string, unknown> | undefined;
  return row ? playbackFromRow(row) : undefined;
}

/** Every saved episode state in one collection, ordered by season/episode. */
function getCollectionPlayback(collectionId: string): LocalPlaybackState[] {
  const db = requireDatabase();
  // Only current files: detail.episodes lists no tombstone, so a tombstone's
  // saved state must not appear as an episode that cannot be selected.
  const rows = db.prepare(`
    SELECT playback_state.media_id AS mediaId, playback_state.position_sec AS positionSec,
      playback_state.duration_sec AS durationSec, playback_state.audio_track_id AS audioTrackId,
      playback_state.subtitle_track_id AS subtitleTrackId, playback_state.watched,
      playback_state.updated_at AS updatedAtMs
    FROM playback_state JOIN media_files USING (media_id)
    WHERE media_files.collection_id = ? AND media_files.available = 1
    ORDER BY media_files.season_number IS NULL, media_files.season_number,
      media_files.episode_number IS NULL, media_files.episode_number,
      media_files.display_title COLLATE NOCASE
  `).all(collectionId) as Array<Record<string, unknown>>;
  return rows.map(playbackFromRow);
}

function savePlayback(stateValue: LocalPlaybackState): LocalPlaybackState {
  const db = requireDatabase();
  if (!Number.isFinite(stateValue.positionSec) || stateValue.positionSec < 0) throw new LocalWorkerError("invalid-input", "播放位置无效");
  if (stateValue.durationSec !== undefined && (!Number.isFinite(stateValue.durationSec) || stateValue.durationSec < 0)) throw new LocalWorkerError("invalid-input", "播放时长无效");
  const media = db.prepare("SELECT media_id AS mediaId FROM media_files WHERE media_id = ?").get(stateValue.mediaId) as { mediaId?: string } | undefined;
  if (!media?.mediaId) throw new LocalWorkerError("invalid-input", "媒体不存在");
  const updatedAtMs = Number.isFinite(stateValue.updatedAtMs) ? stateValue.updatedAtMs : now();
  db.prepare(`
    INSERT INTO playback_state (media_id, position_sec, duration_sec, audio_track_id, subtitle_track_id, watched, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(media_id) DO UPDATE SET position_sec = excluded.position_sec, duration_sec = excluded.duration_sec,
      audio_track_id = excluded.audio_track_id, subtitle_track_id = excluded.subtitle_track_id,
      watched = excluded.watched, updated_at = excluded.updated_at
  `).run(stateValue.mediaId, stateValue.positionSec, stateValue.durationSec ?? null, stateValue.audioTrackId ?? null, subtitleTrackToColumn(stateValue.subtitleTrackId), stateValue.watched ? 1 : 0, updatedAtMs);
  return { ...stateValue, updatedAtMs };
}

function markerFromRow(row: Record<string, unknown>): LocalMarker {
  return {
    mediaId: String(row.mediaId) as LocalMarker["mediaId"],
    positionSec: Number(row.positionSec),
    createdAtMs: Number(row.createdAtMs),
  };
}

/** Markers for one current media file, ordered by position. Never reads or returns a path. */
function listMarkers(mediaId: string): LocalMarker[] {
  const db = requireDatabase();
  if (!isOpaqueMediaId(mediaId)) throw new LocalWorkerError("invalid-input", "mediaId 格式无效");
  const rows = db.prepare(`
    SELECT media_id AS mediaId, position_sec AS positionSec, created_at AS createdAtMs
    FROM markers WHERE media_id = ? ORDER BY position_sec ASC
  `).all(mediaId) as Array<Record<string, unknown>>;
  return rows.map(markerFromRow);
}

/**
 * Record one whole-second marker. Invalid opaque IDs, fractional/negative
 * positions and positions beyond a known duration are rejected outright; no
 * value is clamped. Re-adding the same second returns the existing record so a
 * double press never duplicates a tick and never rewrites its creation time.
 */
function addMarker(input: LocalMarkerInput): LocalMarker {
  const db = requireDatabase();
  if (!input || typeof input !== "object") throw new LocalWorkerError("invalid-input", "标记参数格式无效");
  if (!isOpaqueMediaId(input.mediaId)) throw new LocalWorkerError("invalid-input", "mediaId 格式无效");
  if (!isMarkerPositionSec(input.positionSec)) throw new LocalWorkerError("invalid-input", "标记位置必须是有效的整秒数");
  if (input.durationSec !== undefined && !isMarkerDurationSec(input.durationSec)) {
    throw new LocalWorkerError("invalid-input", "媒体时长无效");
  }
  const media = db.prepare("SELECT media_id AS mediaId FROM media_files WHERE media_id = ? AND available = 1").get(input.mediaId) as { mediaId?: string } | undefined;
  if (!media?.mediaId) throw new LocalWorkerError("invalid-input", "标记对应的本地媒体不存在");
  // The player persists duration with playback state; the renderer also knows
  // the reported duration. The stricter of the known bounds decides.
  const stored = db.prepare("SELECT duration_sec AS durationSec FROM playback_state WHERE media_id = ?").get(input.mediaId) as { durationSec?: number | null } | undefined;
  const knownDurations = [input.durationSec, stored?.durationSec ?? undefined]
    .filter((value): value is number => isMarkerDurationSec(value) && value > 0);
  const durationSec = knownDurations.length > 0 ? Math.max(...knownDurations) : undefined;
  if (!isMarkerWithinDuration(input.positionSec, durationSec)) {
    throw new LocalWorkerError("invalid-input", "标记位置超出媒体时长，未记录");
  }
  const existing = db.prepare(`
    SELECT media_id AS mediaId, position_sec AS positionSec, created_at AS createdAtMs
    FROM markers WHERE media_id = ? AND position_sec = ?
  `).get(input.mediaId, input.positionSec) as Record<string, unknown> | undefined;
  if (existing) return markerFromRow(existing);
  db.prepare("INSERT OR IGNORE INTO markers (media_id, position_sec, created_at) VALUES (?, ?, ?)").run(input.mediaId, input.positionSec, now());
  const row = db.prepare(`
    SELECT media_id AS mediaId, position_sec AS positionSec, created_at AS createdAtMs
    FROM markers WHERE media_id = ? AND position_sec = ?
  `).get(input.mediaId, input.positionSec) as Record<string, unknown> | undefined;
  if (!row) throw new LocalWorkerError("storage", "标记保存结果不可用");
  return markerFromRow(row);
}

/**
 * Ticket 22b: delete one whole-second marker keyed by the opaque media id. The
 * same id/position rules as `addMarker` apply (no path, no fractional or
 * negative second); a second that has no marker is an idempotent `false` instead
 * of an error, so a double click never surfaces a false failure to the user.
 */
function deleteMarker(input: LocalMarkerDeleteInput): boolean {
  const db = requireDatabase();
  if (!input || typeof input !== "object") throw new LocalWorkerError("invalid-input", "标记参数格式无效");
  if (!isOpaqueMediaId(input.mediaId)) throw new LocalWorkerError("invalid-input", "mediaId 格式无效");
  if (!isMarkerPositionSec(input.positionSec)) throw new LocalWorkerError("invalid-input", "标记位置必须是有效的整秒数");
  const result = db.prepare("DELETE FROM markers WHERE media_id = ? AND position_sec = ?").run(input.mediaId, input.positionSec);
  return Number(result.changes) > 0;
}

function viewingHistoryFromRow(row: Record<string, unknown>): LocalViewingHistory {
  return {
    mediaId: String(row.mediaId) as LocalViewingHistory["mediaId"],
    openCount: Number(row.openCount),
    effectiveWatchCount: Number(row.effectiveWatchCount),
    completedCount: Number(row.completedCount),
    inspectionOpenCount: Number(row.inspectionOpenCount),
    totalPlayedSec: Number(row.totalPlayedSec),
    firstSeenAtMs: Number(row.firstSeenAtMs),
    lastOpenedAtMs: Number(row.lastOpenedAtMs),
    ...(row.lastPlayedAt === null || row.lastPlayedAt === undefined ? {} : { lastPlayedAtMs: Number(row.lastPlayedAt) }),
    lastSessionPlayedSec: Number(row.lastSessionPlayedSec),
    lastSessionWallSec: Number(row.lastSessionWallSec),
    lastPositionSec: Number(row.lastPositionSec),
    ...(row.lastDurationSec === null || row.lastDurationSec === undefined ? {} : { lastDurationSec: Number(row.lastDurationSec) }),
    updatedAtMs: Number(row.updatedAtMs),
  };
}

function getViewingHistory(mediaId: string): LocalViewingHistory | undefined {
  const db = requireDatabase();
  const row = db.prepare(`
    SELECT media_id AS mediaId, open_count AS openCount, effective_watch_count AS effectiveWatchCount,
      completed_count AS completedCount, inspection_open_count AS inspectionOpenCount,
      total_played_sec AS totalPlayedSec, first_seen_at AS firstSeenAtMs, last_opened_at AS lastOpenedAtMs,
      last_played_at AS lastPlayedAt, last_session_played_sec AS lastSessionPlayedSec,
      last_session_wall_sec AS lastSessionWallSec, last_position_sec AS lastPositionSec,
      last_duration_sec AS lastDurationSec, updated_at AS updatedAtMs
    FROM media_history WHERE media_id = ?
  `).get(mediaId) as Record<string, unknown> | undefined;
  return row ? viewingHistoryFromRow(row) : undefined;
}

function hasViewingSessions(mediaId: string): boolean {
  const db = requireDatabase();
  const row = db.prepare("SELECT 1 AS present FROM viewing_sessions WHERE media_id = ? LIMIT 1").get(mediaId) as { present?: number } | undefined;
  return Boolean(row?.present);
}

interface CleanupRow {
  mediaId?: string;
  collectionId?: string;
  sourceId?: string;
  displayTitle?: string | null;
  mediaKind?: string | null;
  sizeBytes?: number;
  modifiedAtMs?: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  available?: number;
  sourceAvailable?: number;
  title?: string | null;
  kind?: string | null;
  year?: number | null;
  plot?: string | null;
  genreJson?: string | null;
  rating?: number | null;
  premieredAt?: string | null;
  addedAtMs?: number;
  openCount?: number | null;
  effectiveWatchCount?: number | null;
  completedCount?: number | null;
  inspectionOpenCount?: number | null;
  totalPlayedSec?: number | null;
  lastOpenedAtMs?: number | null;
  lastPlayedAt?: number | null;
  lastSessionPlayedSec?: number | null;
  lastSessionWallSec?: number | null;
  lastPositionSec?: number | null;
  lastDurationSec?: number | null;
  mediaUpdatedAt?: number | null;
  cleanupState?: string | null;
  cleanupUntil?: number | null;
  hasSessions?: number | null;
}

const CLEANUP_SELECT = `
  SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
    media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
    media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
    media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
    media_files.available, sources.available AS sourceAvailable,
    collections.title, collections.kind, collections.year, collections.plot,
    collections.genre_json AS genreJson, collections.rating, collections.premiered_at AS premieredAt,
    media_files.added_at AS addedAtMs,
    media_history.open_count AS openCount, media_history.effective_watch_count AS effectiveWatchCount,
    media_history.completed_count AS completedCount, media_history.inspection_open_count AS inspectionOpenCount,
    media_history.total_played_sec AS totalPlayedSec, media_history.last_opened_at AS lastOpenedAtMs,
    media_history.last_played_at AS lastPlayedAt, media_history.last_session_played_sec AS lastSessionPlayedSec,
    media_history.last_session_wall_sec AS lastSessionWallSec, media_history.last_position_sec AS lastPositionSec,
    media_history.last_duration_sec AS lastDurationSec, media_history.updated_at AS mediaUpdatedAt,
    media_history.cleanup_state AS cleanupState, media_history.cleanup_until AS cleanupUntil,
    EXISTS (SELECT 1 FROM viewing_sessions WHERE viewing_sessions.media_id = media_files.media_id) AS hasSessions
  FROM media_files
    JOIN collections USING (collection_id)
    JOIN sources USING (source_id)
    LEFT JOIN media_history ON media_history.media_id = media_files.media_id
  WHERE media_files.available = 1 AND sources.available = 1
`;

interface CleanupEvaluatedRow {
  row: CleanupRow;
  state: CleanupState;
  rule?: CleanupRuleId;
}

/**
 * Cleanup queue for current on-disk files only. A1 aggregates are the source of
 * truth for the displayed numbers; the renderer never sees a raw row or a path.
 * The query is bounded by a page, while relative-large uses a single percentile
 * lookup so an 8000-file library still opens quickly.
 */
function listCleanupQueue(query: LocalCleanupQueueQuery, settings: CleanupSettings, nowMs: number): LocalCleanupQueue {
  const db = requireDatabase();
  const rows = db.prepare(CLEANUP_SELECT).all() as CleanupRow[];
  const relativeLargeBytes = relativeLargeCutoff(rows.length, settings.thresholds.relativeLargePercent);
  const evaluated: CleanupEvaluatedRow[] = rows.map((row) => {
    const state = effectiveCleanupState(cleanupStateOf(row), row.cleanupUntil ?? undefined, nowMs);
    const rule = evaluateCleanupRule({
      sizeBytes: Number(row.sizeBytes ?? 0),
      addedAtMs: Number(row.addedAtMs ?? 0),
      openCount: Number(row.openCount ?? 0),
      effectiveWatchCount: Number(row.effectiveWatchCount ?? 0),
      completedCount: Number(row.completedCount ?? 0),
      totalPlayedSec: Number(row.totalPlayedSec ?? 0),
      ...(row.lastOpenedAtMs === null || row.lastOpenedAtMs === undefined || row.lastOpenedAtMs <= 0 ? {} : { lastOpenedAtMs: Number(row.lastOpenedAtMs) }),
    }, settings, { nowMs, ...(relativeLargeBytes === undefined ? {} : { relativeLargeBytes }) });
    return { row, state, ...(rule ? { rule } : {}) };
  });

  const requestedState = query.state ?? "none";
  const requestedRule = query.rule ?? "all";
  const active = evaluated.filter((entry) => {
    if (requestedState === "none") {
      return entry.state === "none" && entry.rule !== undefined && (requestedRule === "all" || entry.rule === requestedRule);
    }
    if (entry.state !== requestedState) return false;
    return requestedRule === "all" || entry.rule === requestedRule;
  });
  active.sort(compareCleanupRows);

  const totalBytes = active.reduce((sum, entry) => sum + Number(entry.row.sizeBytes ?? 0), 0);
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize)));
  const totalPages = Math.max(1, Math.ceil(active.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(query.page)));
  const pageEntries = active.slice((page - 1) * pageSize, page * pageSize);
  const candidates: LocalCleanupCandidate[] = pageEntries.map((entry) => {
    const viewing = viewingForCandidate(entry.row);
    return {
      item: toPublicItem(entry.row as Record<string, unknown>),
      ...(viewing ? { viewing } : {}),
      rule: entry.rule as CleanupRuleId,
      cleanupState: entry.state,
      ...(entry.row.cleanupUntil === null || entry.row.cleanupUntil === undefined ? {} : { cleanupUntilMs: Number(entry.row.cleanupUntil) }),
      addedAtMs: Number(entry.row.addedAtMs ?? 0),
    };
  });

  const deleteEntries = evaluated.filter((entry) => entry.state === "delete-candidate");
  deleteEntries.sort((left, right) => Number(right.row.sizeBytes ?? 0) - Number(left.row.sizeBytes ?? 0)
    || String(left.row.title ?? "").localeCompare(String(right.row.title ?? ""))
    || String(left.row.mediaId).localeCompare(String(right.row.mediaId)));
  const deleteBytes = deleteEntries.reduce((sum, entry) => sum + Number(entry.row.sizeBytes ?? 0), 0);
  const deleteQueue: LocalCleanupQueueItem[] = deleteEntries.slice(0, 200).map((entry) => {
    const viewing = viewingForCandidate(entry.row);
    return {
      item: toPublicItem(entry.row as Record<string, unknown>),
      ...(viewing ? { viewing } : {}),
      ...(entry.rule ? { rule: entry.rule } : {}),
      cleanupState: "delete-candidate",
      addedAtMs: Number(entry.row.addedAtMs ?? 0),
    };
  });

  return {
    query: { ...query, page, pageSize },
    candidates,
    totalCount: active.length,
    totalBytes,
    deleteQueue,
    deleteCount: deleteEntries.length,
    deleteBytes,
    ...(relativeLargeBytes === undefined ? {} : { relativeLargeBytes }),
    nowMs,
  };
}

function viewingForCandidate(row: CleanupRow): LocalViewingHistory | undefined {
  if (!(Number(row.openCount ?? 0) > 0 || Number(row.hasSessions ?? 0) === 1)) return undefined;
  return viewingHistoryFromRow(row as Record<string, unknown>);
}

function cleanupStateOf(row: CleanupRow): CleanupState {
  return isCleanupState(row.cleanupState) ? row.cleanupState : "none";
}

function compareCleanupRows(left: CleanupEvaluatedRow, right: CleanupEvaluatedRow): number {
  const order: CleanupRuleId[] = ["C", "D", "A", "B", "E"];
  const leftRank = left.rule ? order.indexOf(left.rule) : order.length;
  const rightRank = right.rule ? order.indexOf(right.rule) : order.length;
  if (leftRank !== rightRank) return leftRank - rightRank;
  const sizeDelta = Number(right.row.sizeBytes ?? 0) - Number(left.row.sizeBytes ?? 0);
  if (sizeDelta !== 0) return sizeDelta;
  // Ties must not depend on the generated media id: that is a random UUID, so
  // the queue order would change between runs. Title first keeps the list
  // stable for the user and reproducible for tests.
  const titleDelta = String(left.row.title ?? "").localeCompare(String(right.row.title ?? ""));
  if (titleDelta !== 0) return titleDelta;
  return String(left.row.mediaId).localeCompare(String(right.row.mediaId));
}

/** Top-Nth size when at least 20 files are on disk; undefined for smaller libraries. */
function relativeLargeCutoff(fileCount: number, percent: number): number | undefined {
  if (fileCount < 20) return undefined;
  const db = requireDatabase();
  const offset = Math.min(fileCount - 1, Math.floor(fileCount * percent / 100));
  const row = db.prepare(`
    SELECT media_files.size_bytes AS sizeBytes
    FROM media_files JOIN sources ON sources.source_id = media_files.source_id
    WHERE media_files.available = 1 AND sources.available = 1
    ORDER BY media_files.size_bytes DESC, media_files.media_id ASC
    LIMIT 1 OFFSET ?
  `).get(offset) as { sizeBytes?: number } | undefined;
  return row?.sizeBytes === undefined ? undefined : Number(row.sizeBytes);
}

function setCleanupState(input: LocalCleanupStateInput, nowMs: number, keepDays: number, snoozeDays: number): boolean {
  const db = requireDatabase();
  if (!isOpaqueMediaId(input.mediaId)) throw new LocalWorkerError("invalid-input", "mediaId 格式无效");
  if (!isCleanupState(input.state)) throw new LocalWorkerError("invalid-input", "清理状态无效");
  const media = db.prepare("SELECT media_files.media_id AS mediaId, media_files.added_at AS addedAtMs FROM media_files WHERE media_id = ?").get(input.mediaId) as { mediaId?: string; addedAtMs?: number } | undefined;
  if (!media?.mediaId) throw new LocalWorkerError("invalid-input", "媒体不存在");
  // `keep` is terminal (Ticket 14): it never stores a deadline, so an expired
  // date cannot resurrect the file. `keepDays` stays in the IPC contract for the
  // saved preference but no longer sets a keep window. Only `snooze` expires.
  void keepDays;
  const until = input.state === "snooze"
    ? nowMs + Math.max(1, Math.trunc(snoozeDays)) * DAY_MS
    : null;
  // The cleanup mark lives on media_history, which is created on demand. A mark
  // is not a viewing session, so zero counters never render as a "record".
  db.prepare(`
    INSERT INTO media_history (media_id, first_seen_at, last_opened_at, cleanup_state, cleanup_until, updated_at)
    VALUES (?, ?, 0, ?, ?, ?)
    ON CONFLICT(media_id) DO UPDATE SET cleanup_state = excluded.cleanup_state, cleanup_until = excluded.cleanup_until, updated_at = excluded.updated_at
  `).run(input.mediaId, Number(media.addedAtMs ?? nowMs), input.state, until, nowMs);
  return true;
}

function finiteNonNegative(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function startViewingSession(session: LocalViewingSessionStartInput): { sessionId: string } {
  const db = requireDatabase();
  const media = db.prepare("SELECT media_id AS mediaId FROM media_files WHERE media_id = ?").get(session.mediaId) as { mediaId?: string } | undefined;
  if (!media?.mediaId) throw new LocalWorkerError("invalid-input", "媒体不存在");
  const startedAt = finiteNonNegative(session.startedAtMs, now());
  const sessionId = makeId("session");
  db.prepare(`
    INSERT INTO viewing_sessions (session_id, media_id, started_at, last_heartbeat_at, start_position_sec, end_position_sec, speed)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(sessionId, session.mediaId, startedAt, startedAt, finiteNonNegative(session.startPositionSec), finiteNonNegative(session.startPositionSec));
  return { sessionId };
}

function heartbeatViewingSession(heartbeat: LocalViewingSessionHeartbeatInput): void {
  const db = requireDatabase();
  if (!isSessionId(heartbeat.sessionId)) throw new LocalWorkerError("invalid-input", "观看会话格式无效");
  const playedSec = finiteNonNegative(heartbeat.playedSec);
  const wallSec = finiteNonNegative(heartbeat.wallSec);
  const speed = typeof heartbeat.speed === "number" && Number.isFinite(heartbeat.speed) && heartbeat.speed > 0 ? heartbeat.speed : 1;
  db.prepare(`
    UPDATE viewing_sessions SET played_sec = ?, wall_sec = ?, end_position_sec = ?, duration_sec = ?,
      pause_count = ?, seek_count = ?, speed = ?, last_heartbeat_at = ?
    WHERE session_id = ? AND ended_at IS NULL
  `).run(
    playedSec,
    wallSec,
    finiteNonNegative(heartbeat.endPositionSec),
    heartbeat.durationSec === undefined ? null : finiteNonNegative(heartbeat.durationSec),
    Math.max(0, Math.trunc(finiteNonNegative(heartbeat.pauseCount))),
    Math.max(0, Math.trunc(finiteNonNegative(heartbeat.seekCount))),
    speed,
    finiteNonNegative(heartbeat.heartbeatAtMs, now()),
    heartbeat.sessionId,
  );
}

interface AggregatedViewingSession {
  mediaId: string;
  startedAtMs: number;
  endedAtMs: number;
  playedSec: number;
  wallSec: number;
  endPositionSec: number;
  durationSec?: number;
  completed: boolean;
  closeReason: string;
}

/**
 * The one completion conclusion for a finished attempt. The live close, the
 * aggregate write and the interrupted-session recovery all go through it, so
 * the same session can never be "completed" in one path and "not completed" in
 * another.
 *
 * A failed load (`closeReason: "error"`) never completes: its end position came
 * from the resume point, not from playback. Otherwise the player's own `ended`
 * report completes, and a close without that report still completes when real
 * playback reached the 90% rule (`isCompletedWatch`).
 */
function sessionCompletes(session: AggregatedViewingSession): boolean {
  if (session.closeReason === "error") return false;
  if (session.completed) return true;
  if (session.closeReason === "ended") return true;
  return isCompletedWatch(session.playedSec, session.durationSec, session.endPositionSec);
}

/** Fold one finished or recovered session into the per-media aggregate. */
function aggregateViewingSession(session: AggregatedViewingSession): void {
  const db = requireDatabase();
  const playedSec = finiteNonNegative(session.playedSec);
  const effective = isEffectiveWatch(playedSec, session.durationSec) ? 1 : 0;
  const inspection = effective ? 0 : 1;
  const completed = sessionCompletes(session) ? 1 : 0;
  const lastPlayedAt = playedSec > 0 ? session.endedAtMs : null;
  const durationSec = session.durationSec === undefined ? null : finiteNonNegative(session.durationSec);
  db.prepare(`
    INSERT INTO media_history (
      media_id, open_count, effective_watch_count, completed_count, inspection_open_count, total_played_sec,
      first_seen_at, last_opened_at, last_played_at, last_session_played_sec, last_session_wall_sec,
      last_position_sec, last_duration_sec, updated_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(media_id) DO UPDATE SET
      open_count = media_history.open_count + 1,
      effective_watch_count = media_history.effective_watch_count + excluded.effective_watch_count,
      completed_count = media_history.completed_count + excluded.completed_count,
      inspection_open_count = media_history.inspection_open_count + excluded.inspection_open_count,
      total_played_sec = media_history.total_played_sec + excluded.total_played_sec,
      first_seen_at = MIN(media_history.first_seen_at, excluded.first_seen_at),
      last_opened_at = MAX(media_history.last_opened_at, excluded.last_opened_at),
      last_played_at = CASE WHEN excluded.last_opened_at >= media_history.last_opened_at THEN excluded.last_played_at ELSE media_history.last_played_at END,
      last_session_played_sec = CASE WHEN excluded.last_opened_at >= media_history.last_opened_at THEN excluded.last_session_played_sec ELSE media_history.last_session_played_sec END,
      last_session_wall_sec = CASE WHEN excluded.last_opened_at >= media_history.last_opened_at THEN excluded.last_session_wall_sec ELSE media_history.last_session_wall_sec END,
      last_position_sec = CASE WHEN excluded.last_opened_at >= media_history.last_opened_at THEN excluded.last_position_sec ELSE media_history.last_position_sec END,
      last_duration_sec = CASE WHEN excluded.last_opened_at >= media_history.last_opened_at THEN excluded.last_duration_sec ELSE media_history.last_duration_sec END,
      updated_at = MAX(media_history.updated_at, excluded.updated_at)
  `).run(
    session.mediaId,
    effective,
    completed,
    inspection,
    playedSec,
    session.startedAtMs,
    session.startedAtMs,
    lastPlayedAt,
    playedSec,
    finiteNonNegative(session.wallSec),
    finiteNonNegative(session.endPositionSec),
    durationSec,
    session.endedAtMs,
  );
  // Ticket 20 / P-05: `playback_state.watched` is a projection of this one
  // completion conclusion, never a second judge. A close at 90%+ (or an explicit
  // `ended`) therefore flips the detail/continue-watching projection in the same
  // transaction, so "完整看完 1 次" and "继续播放" can no longer contradict.
  if (completed === 1) mirrorCompletionToPlaybackState(session.mediaId, finiteNonNegative(session.endPositionSec), durationSec, session.endedAtMs);
}

/**
 * Write the ledger's completion verdict into the playback projection. The
 * existing position/duration/track columns are kept when a row already exists:
 * the player reports position, the ledger alone decides `watched`.
 */
function mirrorCompletionToPlaybackState(mediaId: string, endPositionSec: number, durationSec: number | null, updatedAtMs: number): void {
  const db = requireDatabase();
  db.prepare(`
    INSERT INTO playback_state (media_id, position_sec, duration_sec, audio_track_id, subtitle_track_id, watched, updated_at)
    VALUES (?, ?, ?, NULL, NULL, 1, ?)
    ON CONFLICT(media_id) DO UPDATE SET
      watched = 1,
      updated_at = MAX(playback_state.updated_at, excluded.updated_at)
  `).run(mediaId, endPositionSec, durationSec, updatedAtMs);
}

function finishViewingSession(session: LocalViewingSessionFinishInput): LocalViewingHistory | undefined {
  const db = requireDatabase();
  if (!isSessionId(session.sessionId)) throw new LocalWorkerError("invalid-input", "观看会话格式无效");
  const row = db.prepare(`
    SELECT media_id AS mediaId, started_at AS startedAtMs, ended_at AS endedAt
    FROM viewing_sessions WHERE session_id = ?
  `).get(session.sessionId) as { mediaId?: string; startedAtMs?: number; endedAt?: number | null } | undefined;
  if (!row?.mediaId) return undefined;
  if (row.endedAt !== null && row.endedAt !== undefined) return getViewingHistory(String(row.mediaId));
  const endedAtMs = finiteNonNegative(session.endedAtMs, now());
  const startedAtMs = finiteNonNegative(row.startedAtMs, endedAtMs);
  const playedSec = finiteNonNegative(session.playedSec);
  const durationSec = session.durationSec === undefined ? undefined : finiteNonNegative(session.durationSec);
  const closeReason = session.closeReason;
  const finished: AggregatedViewingSession = {
    mediaId: String(row.mediaId),
    startedAtMs,
    endedAtMs,
    playedSec,
    wallSec: finiteNonNegative(session.wallSec),
    endPositionSec: finiteNonNegative(session.endPositionSec),
    ...(durationSec === undefined ? {} : { durationSec }),
    completed: session.completed,
    closeReason,
  };
  // The stored session row and the aggregate share one completion conclusion.
  const completed = sessionCompletes(finished);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE viewing_sessions SET ended_at = ?, wall_sec = ?, played_sec = ?, end_position_sec = ?, duration_sec = ?,
        completed = ?, pause_count = ?, seek_count = ?, speed = ?, close_reason = ?, last_heartbeat_at = ?
      WHERE session_id = ? AND ended_at IS NULL
    `).run(
      endedAtMs,
      finiteNonNegative(session.wallSec),
      playedSec,
      finiteNonNegative(session.endPositionSec),
      durationSec ?? null,
      completed ? 1 : 0,
      Math.max(0, Math.trunc(finiteNonNegative(session.pauseCount))),
      Math.max(0, Math.trunc(finiteNonNegative(session.seekCount))),
      typeof session.speed === "number" && Number.isFinite(session.speed) && session.speed > 0 ? session.speed : 1,
      closeReason,
      endedAtMs,
      session.sessionId,
    );
    aggregateViewingSession(finished);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getViewingHistory(String(row.mediaId));
}

/**
 * A session left open by a crash is settled from its last heartbeat. This runs
 * once on database initialization, before any new playback can start.
 */
function recoverInterruptedViewingSessions(): void {
  const db = requireDatabase();
  const rows = db.prepare(`
    SELECT session_id AS sessionId, media_id AS mediaId, started_at AS startedAtMs,
      last_heartbeat_at AS lastHeartbeatAt, wall_sec AS wallSec, played_sec AS playedSec,
      end_position_sec AS endPositionSec, duration_sec AS durationSec, completed
    FROM viewing_sessions WHERE ended_at IS NULL
  `).all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const startedAtMs = Number(row.startedAtMs);
      const endedAtMs = row.lastHeartbeatAt === null || row.lastHeartbeatAt === undefined ? startedAtMs : Number(row.lastHeartbeatAt);
      const playedSec = finiteNonNegative(row.playedSec);
      const wallSec = Math.max(finiteNonNegative(row.wallSec), Math.max(0, endedAtMs - startedAtMs) / 1000);
      const durationSec = row.durationSec === null || row.durationSec === undefined ? undefined : finiteNonNegative(row.durationSec);
      const endPositionSec = finiteNonNegative(row.endPositionSec);
      const pending: AggregatedViewingSession = {
        mediaId: String(row.mediaId),
        startedAtMs,
        endedAtMs,
        playedSec,
        wallSec,
        endPositionSec,
        ...(durationSec === undefined ? {} : { durationSec }),
        completed: Number(row.completed) === 1,
        closeReason: "interrupted",
      };
      // Recovery uses the same completion rule as the live close; the stored
      // row and the aggregate never disagree.
      const completed = sessionCompletes(pending);
      db.prepare("UPDATE viewing_sessions SET ended_at = ?, wall_sec = ?, close_reason = 'interrupted', completed = ?, last_heartbeat_at = ? WHERE session_id = ? AND ended_at IS NULL")
        .run(endedAtMs, wallSec, completed ? 1 : 0, endedAtMs, String(row.sessionId));
      aggregateViewingSession(pending);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Correlated predicate that keeps missing-file detection inside the directory
 * prefixes this run proved complete. An empty prefix (the source root) matches
 * every row; `SCANNED_PREFIX_TABLE` carries one prefix per complete directory.
 */
const SCANNED_PREFIX_MATCH = `EXISTS (
  SELECT 1 FROM ${SCANNED_PREFIX_TABLE} prefixes
  WHERE prefixes.prefix = '' OR substr(media_files.relative_path, 1, length(prefixes.prefix)) = prefixes.prefix
)`;

/**
 * Delete ledger rows for media the scan confirmed missing while the source was
 * readable. Media rows stay unavailable so the ordinary scan contract does not
 * change; only the viewing history is removed. The traversal result and the
 * complete directory scopes are read from TEMP tables so the statement keeps a
 * fixed number of parameters.
 */
function clearMissingViewingRecords(sourceId: string): void {
  const db = requireDatabase();
  const predicate = `source_id = ? AND relative_path NOT IN (SELECT relative_path FROM ${SEEN_PATHS_TABLE}) AND ${SCANNED_PREFIX_MATCH}`;
  db.prepare(`DELETE FROM viewing_sessions WHERE media_id IN (SELECT media_id FROM media_files WHERE ${predicate})`).run(sourceId);
  db.prepare(`DELETE FROM media_history WHERE media_id IN (SELECT media_id FROM media_files WHERE ${predicate})`).run(sourceId);
  // A scan-confirmed missing file also forgets its user-written markers; the
  // media row itself stays as a tombstone under the ordinary scan contract.
  db.prepare(`DELETE FROM markers WHERE media_id IN (SELECT media_id FROM media_files WHERE ${predicate})`).run(sourceId);
}

/**
 * The directory scope of one reconcile. A full scan passes the empty prefix
 * (the root itself); a directory rescan passes the prefixes it proved complete,
 * so rows outside them are never touched.
 */
function replaceScannedDirectoryPrefixes(prefixes: string[]): void {
  const db = requireDatabase();
  db.exec(`DROP TABLE IF EXISTS temp.${SCANNED_PREFIX_TABLE}; CREATE TEMP TABLE ${SCANNED_PREFIX_TABLE} (prefix TEXT PRIMARY KEY);`);
  const insert = db.prepare(`INSERT OR IGNORE INTO ${SCANNED_PREFIX_TABLE} (prefix) VALUES (?)`);
  for (const prefix of prefixes) insert.run(prefix);
}

function dropScannedDirectoryPrefixes(): void {
  if (!database) return;
  try {
    database.exec(`DROP TABLE IF EXISTS temp.${SCANNED_PREFIX_TABLE};`);
  } catch {
    // A failed cleanup of a TEMP table is harmless; the next scan recreates it.
  }
}

/**
 * A ~20k-file library exceeds SQLite's bound-variable limit, so reconcile must
 * not build `NOT IN (?,…)`. A per-connection TEMP table keeps the statement
 * shape constant; it is created and dropped inside the reconcile transaction.
 * An empty set means "saw nothing", which marks every indexed row unavailable.
 */
function replaceSeenRelativePaths(seenRelativePaths: Set<string>): void {
  const db = requireDatabase();
  db.exec(`DROP TABLE IF EXISTS temp.${SEEN_PATHS_TABLE}; CREATE TEMP TABLE ${SEEN_PATHS_TABLE} (relative_path TEXT PRIMARY KEY);`);
  const insert = db.prepare(`INSERT OR IGNORE INTO ${SEEN_PATHS_TABLE} (relative_path) VALUES (?)`);
  for (const relativePath of seenRelativePaths) insert.run(relativePath);
}

function dropSeenRelativePaths(): void {
  if (!database) return;
  try {
    database.exec(`DROP TABLE IF EXISTS temp.${SEEN_PATHS_TABLE};`);
  } catch {
    // A failed cleanup of a TEMP table is harmless; the next scan recreates it.
  }
}

function addScanRun(sourceId: string, scanId: string): number {
  const db = requireDatabase();
  const row = db.prepare("SELECT COALESCE(MAX(generation), 0) AS generation FROM scan_runs WHERE source_id = ?").get(sourceId) as { generation?: number } | undefined;
  const generation = Number(row?.generation ?? 0) + 1;
  profileSync("database", () => db.prepare("INSERT INTO scan_runs (scan_id, source_id, generation, completed, started_at) VALUES (?, ?, ?, 0, ?)").run(scanId, sourceId, generation, now()));
  return generation;
}

function finishScan(scanId: string, completed: boolean, error?: string): void {
  const db = requireDatabase();
  profileSync("database", () => db.prepare("UPDATE scan_runs SET completed = ?, error = ?, completed_at = ? WHERE scan_id = ?").run(completed ? 1 : 0, error ?? null, now(), scanId));
}

/** Internal marker for a scan run whose worker died before `finishScan`. */
const INTERRUPTED_SCAN_ERROR = "interrupted";

/**
 * `scan_runs` is a fact source, not a write-only log. A run that never reached
 * `finishScan` (worker crash or forced quit) is closed as `interrupted` on the
 * next initialization, so nothing looks complete that never finished.
 *
 * The same startup decision also marks the affected source `degraded = 1`: the
 * last traversal did not prove the index complete, so the next successful scan
 * of that source must re-reconcile, and the UI must not claim the folder was
 * fully read in the meantime. `generation` is the per-source attempt counter
 * used here to find each source's newest run.
 */
function recoverInterruptedScanRuns(): void {
  const db = requireDatabase();
  const recoveredAt = now();
  const pending = db.prepare("SELECT scan_id AS scanId FROM scan_runs WHERE completed_at IS NULL").all() as Array<{ scanId?: string }>;
  if (pending.length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE scan_runs SET completed = 0, error = ?, completed_at = ? WHERE completed_at IS NULL").run(INTERRUPTED_SCAN_ERROR, recoveredAt);
    db.prepare(`
      UPDATE sources SET degraded = 1, updated_at = ?
      WHERE source_id IN (
        SELECT run.source_id FROM scan_runs run
        JOIN (SELECT source_id, MAX(generation) AS generation FROM scan_runs GROUP BY source_id) latest
          ON latest.source_id = run.source_id AND latest.generation = run.generation
        WHERE run.completed = 0 AND run.error = ?
      )
    `).run(recoveredAt, INTERRUPTED_SCAN_ERROR);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface ScanCounters {
  /** Candidate files this run attempted to index (existing streaming counter). */
  scannedFiles: number;
  /** Rows created (existing streaming counter; equals `imported`). */
  importedFiles: number;
  /**
   * Existing rows refreshed by this run (existing streaming counter). It counts
   * files seen again, whether or not anything changed, and is kept for the
   * unchanged full-scan behaviour; use `counts.updated` for real updates.
   */
  updatedFiles: number;
  warnings: string[];
  seenRelativePaths: Set<string>;
  sourceLabel?: string;
  /** Precise four-way comparison against the stored rows (Ticket 23a). */
  imported: number;
  updated: number;
  unchanged: number;
  removed: number;
  nfoUpdated: number;
  fingerprintReplaced: number;
}

function countsFor(counters: ScanCounters): LocalScanCounts {
  return {
    imported: counters.imported,
    updated: counters.updated,
    unchanged: counters.unchanged,
    removed: counters.removed,
  };
}

function resultFor(
  scanId: string,
  sourceId: string,
  status: LocalScanProgress["status"],
  counters: ScanCounters,
  error?: string,
): LocalDirectoryScanResult {
  return {
    ...progressFor(scanId, sourceId, status, counters),
    warnings: [...counters.warnings],
    ...(error ? { error } : {}),
    counts: countsFor(counters),
    nfoUpdatedFiles: counters.nfoUpdated,
    fingerprintReplacedFiles: counters.fingerprintReplaced,
  };
}

function progressFor(scanId: string, sourceId: string, status: LocalScanProgress["status"], counters: ScanCounters, sourceLabel = counters.sourceLabel): LocalScanProgress {
  return {
    scanId,
    sourceId,
    ...(sourceLabel ? { sourceLabel } : {}),
    status,
    scannedFiles: counters.scannedFiles,
    importedFiles: counters.importedFiles,
    updatedFiles: counters.updatedFiles,
    warningCount: counters.warnings.length,
  };
}

function emitProgress(progress: LocalScanProgress): void {
  const event: WorkerEvent = { event: "scan-progress", progress };
  workerPort.postMessage(event);
}

type ShowContext = {
  directory: string;
  metadata?: ParsedNfo;
  artwork: Array<{ kind: "poster" | "fanart"; filePath: string }>;
};

/**
 * Read one directory's `tvshow.nfo` context (metadata plus artwork). The
 * recursive traversal calls it when it enters a directory, and a directory
 * rescan calls it for the ancestor that owns the requested subdirectory.
 */
async function readShowContext(
  rootPath: string,
  directory: string,
  entries: Dirent[],
  warnings: string[],
): Promise<ShowContext> {
  const tvshow = entries.find((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase() === "tvshow.nfo");
  const metadata = tvshow ? await readNfoFile(join(directory, tvshow.name), warnings) : undefined;
  const artworkFiles: Array<{ kind: "poster" | "fanart"; filePath: string }> = [];
  for (const candidate of metadata?.artwork ?? []) {
    const artworkFile = await profileAsync("artwork", () => artworkPath(rootPath, directory, candidate.path));
    if (artworkFile) artworkFiles.push({ kind: candidate.kind, filePath: artworkFile });
  }
  if (!artworkFiles.length) artworkFiles.push(...await conventionalArtwork(rootPath, directory, basename(directory), entries));
  return { directory, metadata, artwork: artworkFiles };
}

/**
 * Inherit the nearest show context above a requested directory, so rescanning
 * `Show/Season 1` keeps the same work a full scan produced instead of minting a
 * new collection from the season directory. An ancestor without `tvshow.nfo`,
 * or an unreadable one, contributes nothing.
 */
async function showContextFromAncestors(rootPath: string, directory: string, warnings: string[]): Promise<ShowContext | undefined> {
  const root = resolve(rootPath);
  const ancestors: string[] = [];
  let current = resolve(directory);
  while (current !== root) {
    const parent = dirname(current);
    if (parent === current) break;
    ancestors.push(parent);
    current = parent;
  }
  for (const ancestor of ancestors) {
    if (!pathContained(root, ancestor)) continue;
    const entries = await profileAsync("enumeration", () => readdir(ancestor, { withFileTypes: true }), "readdir").catch(() => []);
    if (!entries.some((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase() === "tvshow.nfo")) continue;
    return readShowContext(root, ancestor, entries, warnings);
  }
  return undefined;
}

function relativeFromRoot(rootPath: string, targetPath: string): string {
  const value = relative(rootPath, targetPath);
  if (!value) return "";
  if (isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`)) {
    throw new LocalWorkerError("invalid-input", "扫描目录必须位于片库来源内");
  }
  return value.split(sep).join("/");
}

/**
 * Turn the requested source-relative directories into canonical directories
 * inside the source root. Every value is validated before any bookkeeping row
 * is written, so a rejected scope leaves the library and the scan history
 * untouched. A directory already covered by a requested ancestor is dropped:
 * the ancestor's traversal visits it anyway, and visiting it twice would count
 * the same files twice.
 */
async function resolveDirectoryScope(rootPath: string, requested: string[]): Promise<Array<{ relative: string; directory: string }>> {
  if (requested.length === 0) throw new LocalWorkerError("invalid-input", "至少需要一个相对目录");
  const scopes: Array<{ relative: string; directory: string }> = [];
  for (const value of requested) {
    const relativePath = normalizeScanRelativeDirectory(value);
    if (relativePath === undefined) throw new LocalWorkerError("invalid-input", "扫描目录必须是片库来源内的相对目录");
    const candidate = relativePath === "" ? rootPath : resolve(rootPath, ...relativePath.split("/"));
    const canonical = await canonicalPathWithin(rootPath, candidate, rootPath);
    const metadata = canonical ? await profileAsync("lstat", () => lstat(canonical), "lstat").catch(() => undefined) : undefined;
    if (!canonical || !metadata?.isDirectory() || metadata.isSymbolicLink()) {
      throw new LocalWorkerError("invalid-input", "扫描目录不存在或不可用");
    }
    scopes.push({ relative: relativeFromRoot(rootPath, canonical), directory: canonical });
  }
  const kept: Array<{ relative: string; directory: string }> = [];
  for (const scope of [...scopes].sort((left, right) => left.relative.length - right.relative.length)) {
    const covered = kept.some((outer) => outer.relative === "" || scope.relative === outer.relative || scope.relative.startsWith(`${outer.relative}/`));
    if (!covered) kept.push(scope);
  }
  return kept;
}

async function scanDirectory(
  rootPath: string,
  currentDirectory: string,
  sourceId: string,
  scanId: string,
  cancellation: ScanCancellation,
  counters: ScanCounters,
  showContext: { directory: string; metadata?: ParsedNfo; artwork: Array<{ kind: "poster" | "fanart"; filePath: string }> } | undefined,
): Promise<boolean> {
  if (cancellation.requested) throw new LocalWorkerError("storage", "scan-cancelled");
  profileCount("directories");
  const safeCurrentDirectory = await canonicalPathWithin(rootPath, currentDirectory, rootPath);
  if (!safeCurrentDirectory) {
    counters.warnings.push("来源目录已不可用，已保留此前索引");
    return false;
  }
  let entries: Dirent[];
  try {
    entries = await profileAsync("enumeration", () => readdir(safeCurrentDirectory, { withFileTypes: true }), "readdir");
    profileSync("enumeration", () => entries.sort((left, right) => left.name.localeCompare(right.name)));
  } catch {
    counters.warnings.push("部分目录无法读取，已保留此前索引");
    return false;
  }
  if (!(await canonicalPathWithin(rootPath, safeCurrentDirectory, rootPath))) {
    counters.warnings.push("来源目录已不可用，已保留此前索引");
    return false;
  }
  let localShowContext = showContext;
  if (entries.some((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase() === "tvshow.nfo")) {
    localShowContext = await readShowContext(rootPath, safeCurrentDirectory, entries, counters.warnings);
  }
  for (const entry of entries) {
    if (cancellation.requested) throw new LocalWorkerError("storage", "scan-cancelled");
    const child = join(safeCurrentDirectory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const directoryMetadata = await profileAsync("lstat", () => lstat(child), "lstat").catch(() => undefined);
      if (!directoryMetadata) {
        counters.warnings.push("来源目录已不可用，已保留此前索引");
        return false;
      }
      const safeChild = await canonicalPathWithin(rootPath, child, rootPath);
      if (!safeChild) {
        counters.warnings.push("已跳过越过片库目录边界的链接");
        continue;
      }
      const complete = await scanDirectory(rootPath, safeChild, sourceId, scanId, cancellation, counters, localShowContext);
      if (!complete) return false;
      continue;
    }
    if (!entry.isFile() || !supportedVideoExtensions.has(extname(entry.name).toLowerCase())) continue;
    profileCount("videoCandidates");
    const fileMetadata = await profileAsync("lstat", () => lstat(child), "lstat").catch(() => undefined);
    if (!fileMetadata) {
      counters.warnings.push("来源文件已不可用，已保留此前索引");
      return false;
    }
    if (!fileMetadata.isFile() || fileMetadata.isSymbolicLink()) continue;
    const safeChild = await canonicalPathWithin(rootPath, child, rootPath);
    if (!safeChild) {
      counters.warnings.push("已跳过越过片库目录边界的链接");
      continue;
    }
    counters.scannedFiles += 1;
    try {
      const discovered = await discoverMedia(rootPath, sourceId, safeChild, fileMetadata, entries, localShowContext, counters.warnings);
      const result = await upsertMedia(rootPath, discovered, { includeItem: false });
      if (result.created) {
        counters.importedFiles += 1;
        counters.imported += 1;
        // A changed video fingerprint supersedes the stored identity, so that
        // row leaves the visible library in the same write.
        counters.removed += result.removedRows;
        if (result.replaced) counters.fingerprintReplaced += 1;
      } else {
        counters.updatedFiles += 1;
        if (result.updated) {
          counters.updated += 1;
          if (result.nfoChanged) counters.nfoUpdated += 1;
        } else {
          counters.unchanged += 1;
        }
      }
      counters.seenRelativePaths.add(discovered.relativePath);
    } catch (error) {
      profileError(error);
      counters.warnings.push("视频条目无法索引，已保留此前索引");
      // A failed index attempt (NFO parse, SQLITE_BUSY, …) is not proof the file
      // was deleted. Record it as seen so reconcile never marks the row
      // unavailable and never deletes its viewing ledger.
      try {
        counters.seenRelativePaths.add(makeRelative(rootPath, safeChild));
      } catch {
        counters.warnings.push("无法确认失败条目的相对路径，已保留此前索引");
      }
    }
    emitProgress(progressFor(scanId, sourceId, "running", counters));
    await yieldImmediate();
  }
  return true;
}

interface ScanSourceInput {
  /** Full-root scan: the root the caller asked for. */
  rootPath?: string;
  /** Directory rescan: the registered source whose directories are refreshed. */
  sourceId?: string;
  relativeDirectories?: string[];
}

interface KnownSource {
  sourceId: string;
  rootPath: string;
  label: string;
}

function knownSource(sourceId: string): KnownSource | undefined {
  const db = requireDatabase();
  const row = profileSync("database", () => db.prepare("SELECT source_id AS sourceId, root_path AS rootPath FROM sources WHERE source_id = ?").get(sourceId) as { sourceId?: string; rootPath?: string } | undefined);
  if (!row?.sourceId || !row.rootPath) return undefined;
  return { sourceId: String(row.sourceId), rootPath: row.rootPath, label: safeSourceLabel(row.rootPath) };
}

/**
 * The known-directory inventory for the mtime coarse filter (Ticket 23b).
 * Derived from the existing rows, so no schema or side table is added: every
 * source's root plus the parent directory of each indexed Media file. Stored
 * relative paths use POSIX separators, so the parent is a string prefix.
 */
function listScanDirectories(): LocalSourceDirectories[] {
  const db = requireDatabase();
  const sources = profileSync("database", () => db.prepare("SELECT source_id AS sourceId FROM sources ORDER BY source_id").all() as Array<{ sourceId?: string }>);
  const directories = new Map<string, Set<string>>();
  for (const row of sources) {
    if (row.sourceId) directories.set(String(row.sourceId), new Set([""]));
  }
  const mediaRows = profileSync("database", () => db.prepare("SELECT source_id AS sourceId, relative_path AS relativePath FROM media_files").all() as Array<{ sourceId?: string; relativePath?: string }>);
  for (const row of mediaRows) {
    if (!row.sourceId) continue;
    const known = directories.get(String(row.sourceId));
    if (!known) continue;
    const relativePath = String(row.relativePath ?? "");
    const separator = relativePath.lastIndexOf("/");
    known.add(separator <= 0 ? "" : relativePath.slice(0, separator));
  }
  return [...directories.entries()].map(([sourceId, known]) => ({
    sourceId,
    relativeDirectories: [...known].sort((left, right) => left.localeCompare(right)),
  }));
}

async function scanRoot(rootPath: string): Promise<LocalDirectoryScanResult> {
  return scanSource({ rootPath });
}

async function scanDirectories(sourceId: string, relativeDirectories: string[]): Promise<LocalDirectoryScanResult> {
  return scanSource({ sourceId, relativeDirectories });
}

/**
 * One Scan run over either the whole source root or an explicit directory
 * scope (Ticket 23a). Both share the traversal, upsert and reconcile code; only
 * the starting directories and the reconcile scope differ.
 */
async function scanSource(input: ScanSourceInput): Promise<LocalDirectoryScanResult> {
  if (activeScan) throw new LocalWorkerError("invalid-input", "已有本地片库扫描正在进行");
  const counters: ScanCounters = {
    scannedFiles: 0,
    importedFiles: 0,
    updatedFiles: 0,
    warnings: [],
    seenRelativePaths: new Set(),
    imported: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    nfoUpdated: 0,
    fingerprintReplaced: 0,
  };
  let profiler: ScanProfiler | undefined;
  let profileStatus: ScanProfileReport["status"] = "error";
  let source: { sourceId: string; label: string } | undefined;
  let scanId: string | undefined;
  let cancellation: ScanCancellation | undefined;
  try {
    profiler = beginScanProfiler();
    scanProfiler = profiler;
    scanCaches = { nfo: new Map(), artwork: new Map() };
    let requestedRoot: string;
    let canonicalRoot: string | undefined;
    let scanOwner: KnownSource;
    if (input.sourceId !== undefined) {
      const known = knownSource(input.sourceId);
      if (!known) throw new LocalWorkerError("invalid-input", "本地片库来源不存在");
      scanOwner = known;
      requestedRoot = resolve(known.rootPath);
      canonicalRoot = await profileAsync("realpath", () => realpath(requestedRoot), "realpath").catch(() => undefined);
    } else {
      requestedRoot = resolve(input.rootPath ?? "");
      canonicalRoot = await profileAsync("realpath", () => realpath(requestedRoot), "realpath").catch(() => undefined);
      const sourceRoot = canonicalRoot ?? requestedRoot;
      await assertNoOverlappingSource(sourceRoot);
      scanOwner = ensureSource(sourceRoot);
    }
    source = scanOwner;
    counters.sourceLabel = scanOwner.label;
    // Validate the directory scope before any bookkeeping row is written, so a
    // rejected scope leaves the library and the scan history untouched.
    const directories = canonicalRoot && input.sourceId !== undefined
      ? await resolveDirectoryScope(canonicalRoot, input.relativeDirectories ?? [])
      : undefined;
    scanId = makeId("scan");
    cancellation = { requested: false, terminal: false };
    scanCancellation.set(scanId, cancellation);
    addScanRun(scanOwner.sourceId, scanId);
    // Root not canonical/readable: the whole folder is offline. Files keep their
    // rows but nothing in it is playable, so `available = 0` and `degraded = 0`.
    if (!canonicalRoot) {
      const db = requireDatabase();
      profileSync("database", () => db.prepare("UPDATE sources SET available = 0, degraded = 0, updated_at = ? WHERE source_id = ?").run(now(), scanOwner.sourceId));
      const result = resultFor(scanId, scanOwner.sourceId, "unavailable", counters, "来源不可用，已保留此前索引和播放历史");
      finishScan(scanId, false, result.error);
      emitProgress(result);
      profileStatus = "unavailable";
      return result;
    }
    const rootStat = await profileAsync("lstat", () => lstat(canonicalRoot), "lstat");
    if (!rootStat.isDirectory()) throw new LocalWorkerError("invalid-input", "选择的片库目录不可用");
    const db = requireDatabase();
    // The root is readable, so the source is online. Whether every subdirectory
    // could be read is decided after traversal (`degraded`).
    profileSync("database", () => db.prepare("UPDATE sources SET available = 1, updated_at = ? WHERE source_id = ?").run(now(), scanOwner.sourceId));
    emitProgress(progressFor(scanId, scanOwner.sourceId, "running", counters));
    let traversalComplete: boolean;
    const completePrefixes: string[] = [];
    if (directories) {
      const completeness = new Map<string, boolean>();
      for (const scope of directories) {
        if (cancellation.requested) throw new LocalWorkerError("storage", "scan-cancelled");
        // Inherit the owning show's context from the directories above the
        // requested one, so a subdirectory rescan keeps the full scan's work.
        const showContext = await showContextFromAncestors(canonicalRoot, scope.directory, counters.warnings);
        completeness.set(scope.relative, await scanDirectory(canonicalRoot, scope.directory, scanOwner.sourceId, scanId, cancellation, counters, showContext));
      }
      traversalComplete = [...completeness.values()].every(Boolean);
      // Only directories this run proved complete may confirm a deletion.
      for (const [scopeRelative, complete] of completeness) {
        if (complete) completePrefixes.push(scopeRelative ? `${scopeRelative}/` : "");
      }
    } else {
      traversalComplete = await scanDirectory(canonicalRoot, canonicalRoot, scanOwner.sourceId, scanId, cancellation, counters, undefined);
      if (traversalComplete) completePrefixes.push("");
    }
    // Terminal window: after the traversal returns there is no further await
    // before the reconcile transaction and `finishScan`, so a later cancel
    // request cannot interrupt anything. Marking the token terminal makes
    // `cancel-scan` answer `false` instead of promising a cancellation that
    // will still finish as completed/partial.
    cancellation.terminal = true;
    if (cancellation.requested) throw new LocalWorkerError("storage", "scan-cancelled");
    if (completePrefixes.length > 0) {
      db.exec("BEGIN IMMEDIATE");
      try {
        // Only rows inside a completely scanned directory are candidates: any
        // indexed file that was not seen there is confirmed missing. Forgotten
        // by design: remove its ledger rows explicitly; only the media row
        // stays unavailable. Reconcile reads both sets from TEMP tables so a
        // 20k-file library never hits SQLite's bound-variable limit.
        replaceSeenRelativePaths(counters.seenRelativePaths);
        replaceScannedDirectoryPrefixes(completePrefixes);
        clearMissingViewingRecords(scanOwner.sourceId);
        const tombstoned = profileSync("database", () => db.prepare(`UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ? AND available = 1 AND relative_path NOT IN (SELECT relative_path FROM ${SEEN_PATHS_TABLE}) AND ${SCANNED_PREFIX_MATCH}`).run(now(), scanOwner.sourceId));
        counters.removed += Number(tombstoned.changes ?? 0);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        dropSeenRelativePaths();
        dropScannedDirectoryPrefixes();
      }
    }
    if (traversalComplete) {
      // A full traversal proves the index complete and clears `degraded`. A
      // directory rescan only proves its own directories, so it never claims
      // the rest of the source is complete.
      profileSync("database", () => db.prepare(directories
        ? "UPDATE sources SET available = 1, updated_at = ? WHERE source_id = ?"
        : "UPDATE sources SET available = 1, degraded = 0, updated_at = ? WHERE source_id = ?").run(now(), scanOwner.sourceId));
      finishScan(scanId, true);
      const result = resultFor(scanId, scanOwner.sourceId, "completed", counters);
      emitProgress(result);
      profileStatus = "completed";
      return result;
    }
    // The root was readable but traversal was incomplete (a subdirectory or file
    // failed). Indexed entries stay playable, so the source stays available and
    // is only marked degraded; `WHERE sources.available = 1` keeps its cleanup
    // queue.
    const error = "部分目录无法读取，已保留此前索引和播放历史";
    profileSync("database", () => db.prepare("UPDATE sources SET available = 1, degraded = 1, updated_at = ? WHERE source_id = ?").run(now(), scanOwner.sourceId));
    finishScan(scanId, false, error);
    const result = resultFor(scanId, scanOwner.sourceId, "partial", counters, error);
    emitProgress(result);
    profileStatus = "partial";
    return result;
  } catch (error) {
    if (scanId && source && error instanceof LocalWorkerError && error.message === "scan-cancelled") {
      const result = resultFor(scanId, source.sourceId, "cancelled", counters, "扫描已取消，已保留此前索引和播放历史");
      finishScan(scanId, false, result.error);
      emitProgress(result);
      profileStatus = "cancelled";
      return result;
    }
    const code = localLibraryErrorCode(error, "storage");
    const safeMessage = localLibraryErrorMessage(code, error instanceof Error ? error.message : undefined);
    if (scanId) finishScan(scanId, false, safeMessage);
    throw new LocalWorkerError(code, safeMessage);
  } finally {
    if (scanId) scanCancellation.delete(scanId);
    await finishScanProfiler(profiler, profileStatus, counters);
    if (scanProfiler === profiler) scanProfiler = undefined;
    scanCaches = undefined;
  }
}

async function importVideo(filePath: string, rootPath: string): Promise<LocalMediaItem> {
  const db = requireDatabase();
  // A single-file import and a folder scan both write sources/media_files, so
  // they must never run concurrently. The contract is a readable rejection
  // rather than a silent parallel write.
  if (activeScan) throw new LocalWorkerError("invalid-input", "已有本地片库扫描正在进行，请等待扫描结束后再打开视频");
  assertSupportedVideo(filePath);
  const existingSource = await containingSource(filePath);
  const paths = await assertRootAndFile(existingSource?.rootPath ?? rootPath, filePath);
  if (!existingSource) await assertNoOverlappingSource(paths.root);
  const fileStat = await stat(paths.file);
  const source = ensureSource(paths.root);
  const discovered: DiscoveredMedia = {
    relativePath: paths.relativePath,
    sizeBytes: Number(fileStat.size),
    modifiedAtMs: Number(fileStat.mtimeMs),
    mediaKind: "movie",
    displayTitle: basename(paths.file, extname(paths.file)),
    collection: {
      identityKey: stableCollectionKey(source.sourceId, paths.relativePath, "movie"),
      sourceId: source.sourceId,
      relativePath: paths.relativePath,
      title: basename(paths.file, extname(paths.file)),
      kind: "movie",
      genres: [],
    },
    artwork: [],
  };
  const result = await upsertMedia(paths.root, discovered, { preserveExistingMetadata: true });
  db.prepare("UPDATE sources SET available = 1, updated_at = ? WHERE source_id = ?").run(now(), source.sourceId);
  if (!result.item) throw new LocalWorkerError("storage", "本地视频导入结果不可用");
  return result.item;
}

async function handle(request: WorkerRequest): Promise<unknown> {
  if (request.command === "initialize") {
    openDatabase(request.dbPath);
    return state();
  }
  if (request.command === "close") {
    for (const token of scanCancellation.values()) token.requested = true;
    if (activeScan) await activeScan.catch(() => undefined);
    database?.close();
    database = undefined;
    return undefined;
  }
  if (request.command === "state") return state();
  if (request.command === "import-first-movie") {
    const filePath = await findFirstVideo(request.rootPath);
    return filePath ? { status: "imported", item: await importVideo(filePath, request.rootPath) } : { status: "empty" };
  }
  if (request.command === "import-video") return { status: "imported", item: await importVideo(request.filePath, request.rootPath) };
  if (request.command === "scan") {
    activeScan = scanRoot(request.rootPath);
    try {
      return await activeScan;
    } finally {
      activeScan = undefined;
    }
  }
  if (request.command === "scan-directories") {
    activeScan = scanDirectories(request.sourceId, request.relativeDirectories);
    try {
      return await activeScan;
    } finally {
      activeScan = undefined;
    }
  }
  if (request.command === "list-scan-directories") return listScanDirectories();
  if (request.command === "cancel-scan") {
    const token = scanCancellation.get(request.scanId);
    // Answering `true` for a scan that already returned would promise a
    // cancellation the result can no longer honor.
    if (!token || token.terminal) return false;
    token.requested = true;
    return true;
  }
  if (request.command === "list") return list(request.query);
  if (request.command === "list-collections") return listCollections(request.query);
  if (request.command === "get") return get(request.mediaId);
  if (request.command === "get-detail") return getDetail(request.mediaId);
  if (request.command === "list-markers") return listMarkers(request.mediaId);
  if (request.command === "add-marker") return addMarker(request.input);
  if (request.command === "delete-marker") return deleteMarker(request.input);
  if (request.command === "list-continue-watching") return listContinueWatching();
  if (request.command === "remove-source") return removeSource(request.sourceId);
  if (request.command === "source-root") return sourceRoot(request.sourceId);
  if (request.command === "resolve-artwork") return resolveArtwork(request.mediaId, request.kind);
  if (request.command === "resolve-path") return resolvePath(request.mediaId);
  if (request.command === "get-playback") return getPlayback(request.mediaId);
  if (request.command === "save-playback") return savePlayback(request.state);
  if (request.command === "start-viewing-session") return startViewingSession(request.session);
  if (request.command === "heartbeat-viewing-session") {
    heartbeatViewingSession(request.heartbeat);
    return true;
  }
  if (request.command === "finish-viewing-session") return finishViewingSession(request.session);
  if (request.command === "get-viewing-history") return getViewingHistory(request.mediaId);
  if (request.command === "list-cleanup-queue") return listCleanupQueue(request.query, request.settings, request.nowMs);
  if (request.command === "set-cleanup-state") return setCleanupState(request.input, request.nowMs, request.keepDays, request.snoozeDays);
  throw new LocalWorkerError("unknown", "未知本地片库命令");
}

workerPort.on("message", (event) => {
  const request = event.data as WorkerRequest;
  void handle(request).then(
    (result) => {
      const response: WorkerSuccess = { id: request.id, ok: true, result };
      workerPort.postMessage(response);
    },
    (error: unknown) => {
      const response: WorkerFailure = {
        id: request.id,
        ok: false,
        error: error instanceof LocalWorkerError
          ? { code: error.code, message: localLibraryErrorMessage(error.code, error.message) }
          : { code: "unknown", message: localLibraryErrorMessage("unknown") },
      };
      workerPort.postMessage(response);
    },
  );
});
