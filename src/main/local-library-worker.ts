import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldImmediate } from "node:timers/promises";

import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import {
  LOCAL_LIBRARY_SCHEMA_VERSION,
  type LocalLibraryQuery,
  type LocalMediaItem,
  type LocalMediaDetail,
  type LocalContinueWatchingItem,
  type LocalArtworkReference,
  type LocalPlaybackState,
  type LocalScanProgress,
  type LocalScanResult,
  type LocalSourceSummary,
} from "../shared/local-library-contracts";
import { parseEpisodeNumbers, parseNfo, type ParsedNfo } from "./local-library-metadata";
import { localLibraryErrorCode, localLibraryErrorMessage } from "./local-library-errors";
import { safeSourceLabel } from "./local-library-label";

type WorkerRequest =
  | { id: number; command: "initialize"; dbPath: string }
  | { id: number; command: "state" }
  | { id: number; command: "import-first-movie"; rootPath: string }
  | { id: number; command: "import-video"; filePath: string; rootPath: string }
  | { id: number; command: "scan"; rootPath: string }
  | { id: number; command: "cancel-scan"; scanId: string }
  | { id: number; command: "list"; query: LocalLibraryQuery }
  | { id: number; command: "get"; mediaId: string }
  | { id: number; command: "get-detail"; mediaId: string }
  | { id: number; command: "list-continue-watching" }
  | { id: number; command: "remove-source"; sourceId: string }
  | { id: number; command: "source-root"; sourceId: string }
  | { id: number; command: "resolve-artwork"; mediaId: string; kind?: "poster" | "fanart" }
  | { id: number; command: "resolve-path"; mediaId: string }
  | { id: number; command: "get-playback"; mediaId: string }
  | { id: number; command: "save-playback"; state: LocalPlaybackState }
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
let database: DatabaseSyncType | undefined;
let activeScan: Promise<LocalScanResult> | undefined;
const scanCancellation = new Map<string, { requested: boolean }>();

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

function makeId(prefix: "media" | "source" | "collection" | "scan" | "artwork"): string {
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
    `);
    ensureColumn("collections", "identity_key", "TEXT");
    ensureColumn("collections", "source_id", "TEXT");
    ensureColumn("collections", "relative_path", "TEXT");
    ensureColumn("media_files", "display_title", "TEXT");
    ensureColumn("media_files", "media_kind", "TEXT NOT NULL DEFAULT 'movie'");
    ensureColumn("media_files", "season_number", "INTEGER");
    ensureColumn("media_files", "episode_number", "INTEGER");
    ensureColumn("artwork", "media_id", "TEXT");
    ensureColumn("artwork", "source_id", "TEXT");
    ensureColumn("artwork", "relative_path", "TEXT");
    ensureColumn("artwork", "updated_at", "INTEGER");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS collections_identity_key ON collections(identity_key) WHERE identity_key IS NOT NULL;");
    db.exec("CREATE INDEX IF NOT EXISTS media_files_source_path ON media_files(source_id, relative_path);");
    db.exec("CREATE INDEX IF NOT EXISTS artwork_collection_kind ON artwork(collection_id, media_id, kind);");
    if (existingVersion === 0) db.exec(`PRAGMA user_version = ${LOCAL_LIBRARY_SCHEMA_VERSION};`);
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
  const collectionRelativePath = makeRelative(rootPath, collectionDirectory) || ".";
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
      identityKey: stableCollectionKey(sourceId, collectionRelativePath === "." ? relativePath : collectionRelativePath, kind),
      sourceId,
      relativePath: collectionRelativePath === "." ? relativePath : collectionRelativePath,
      title: collectionTitle,
      kind,
      ...(collectionNfo?.year !== undefined ? { year: collectionNfo.year } : {}),
      ...(collectionNfo?.plot ? { plot: collectionNfo.plot } : {}),
      genres: collectionNfo?.genres ?? [],
      ...(collectionNfo?.rating !== undefined ? { rating: collectionNfo.rating } : {}),
    },
    artwork: artworkFiles,
  };
}

function upsertCollection(metadata: CollectionMetadata, timestamp: number, preferredCollectionId?: string): string {
  const db = requireDatabase();
  const existing = preferredCollectionId
    ? { collectionId: preferredCollectionId }
    : profileSync("database", () => db.prepare(`
    SELECT collection_id AS collectionId
    FROM collections
    WHERE identity_key = ? OR (identity_key IS NULL AND source_id = ? AND relative_path = ?)
    LIMIT 1
  `).get(metadata.identityKey, metadata.sourceId, metadata.relativePath) as { collectionId?: string } | undefined);
  const collectionId = existing?.collectionId ?? makeId("collection");
  if (existing?.collectionId) {
    profileSync("database", () => db.prepare(`
      UPDATE collections SET title = ?, kind = ?, year = ?, plot = ?, genre_json = ?, rating = ?, identity_key = ?, source_id = ?, relative_path = ?, updated_at = ?
      WHERE collection_id = ?
    `).run(metadata.title, metadata.kind, metadata.year ?? null, metadata.plot ?? null, JSON.stringify(metadata.genres), metadata.rating ?? null, metadata.identityKey, metadata.sourceId, metadata.relativePath, timestamp, collectionId));
  } else {
    profileSync("database", () => db.prepare(`
      INSERT INTO collections (collection_id, title, kind, year, plot, genre_json, rating, identity_key, source_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(collectionId, metadata.title, metadata.kind, metadata.year ?? null, metadata.plot ?? null, JSON.stringify(metadata.genres), metadata.rating ?? null, metadata.identityKey, metadata.sourceId, metadata.relativePath, timestamp, timestamp));
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

function upsertArtwork(
  collectionId: string,
  mediaId: string,
  sourceId: string,
  artwork: PreparedArtwork[],
): void {
  if (!artwork.length) return;
  const db = requireDatabase();
  const timestamp = now();
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
  }
}

async function upsertMedia(rootPath: string, discovered: DiscoveredMedia, includeItem = true): Promise<{ item?: LocalMediaItem; created: boolean }> {
  const db = requireDatabase();
  const timestamp = now();
  const preparedArtwork = await prepareArtwork(rootPath, discovered.collection.sourceId, discovered.artwork);
  try {
    profileSync("database", () => db.exec("BEGIN IMMEDIATE"));
    const existing = profileSync("database", () => db.prepare(`
      SELECT media_id AS mediaId, collection_id AS collectionId
      FROM media_files
      WHERE source_id = ? AND relative_path = ? AND size_bytes = ? AND modified_at_ms = ?
    `).get(discovered.collection.sourceId, discovered.relativePath, discovered.sizeBytes, discovered.modifiedAtMs) as { mediaId?: string; collectionId?: string } | undefined);
    const collectionId = upsertCollection(discovered.collection, timestamp, existing?.collectionId);
    let mediaId: string;
    let created = false;
    if (existing?.mediaId) {
      mediaId = String(existing.mediaId);
      profileSync("database", () => db.prepare(`
        UPDATE media_files SET collection_id = ?, display_title = ?, media_kind = ?, season_number = ?, episode_number = ?, available = 1, updated_at = ?
        WHERE media_id = ?
      `).run(collectionId, discovered.displayTitle, discovered.mediaKind, discovered.seasonNumber ?? null, discovered.episodeNumber ?? null, timestamp, mediaId));
    } else {
      profileSync("database", () => db.prepare("UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ? AND relative_path = ? AND available = 1").run(timestamp, discovered.collection.sourceId, discovered.relativePath));
      mediaId = makeId("media");
      created = true;
      profileSync("database", () => db.prepare(`
        INSERT INTO media_files (media_id, collection_id, source_id, relative_path, display_title, media_kind, size_bytes, modified_at_ms, season_number, episode_number, available, added_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(mediaId, collectionId, discovered.collection.sourceId, discovered.relativePath, discovered.displayTitle, discovered.mediaKind, discovered.sizeBytes, discovered.modifiedAtMs, discovered.seasonNumber ?? null, discovered.episodeNumber ?? null, timestamp, timestamp));
    }
    upsertArtwork(collectionId, mediaId, discovered.collection.sourceId, preparedArtwork);
    const row = includeItem
      ? profileSync("database", () => db.prepare(`
        SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
          media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
          media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
          media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
          media_files.available, sources.available AS sourceAvailable,
          collections.title, collections.kind, collections.year, collections.plot,
          collections.genre_json AS genreJson, collections.rating
        FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
        WHERE media_files.media_id = ?
      `).get(mediaId) as Record<string, unknown>)
      : undefined;
    profileSync("database", () => db.exec("COMMIT"));
    return { ...(row ? { item: toPublicItem(row) } : {}), created };
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
  const rows = db.prepare(`
    SELECT sources.source_id AS sourceId, sources.root_path AS rootPath, sources.label, sources.available,
      COUNT(CASE WHEN media_files.available = 1 THEN 1 END) AS itemCount
    FROM sources
    LEFT JOIN media_files ON media_files.source_id = sources.source_id
    GROUP BY sources.source_id
    ORDER BY sources.label COLLATE NOCASE
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    sourceId: String(row.sourceId),
    label: typeof row.rootPath === "string" ? safeSourceLabel(row.rootPath) : safeSourceLabel(String(row.label ?? "")),
    available: Number(row.available) === 1,
    itemCount: Number(row.itemCount),
  }));
}

function state(): { schemaVersion: typeof LOCAL_LIBRARY_SCHEMA_VERSION; sqliteAvailable: true; sources: LocalSourceSummary[] } {
  requireDatabase();
  return { schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION, sqliteAvailable: true, sources: sourceSummaries() };
}

function list(query: LocalLibraryQuery): { totalCount: number; items: LocalMediaItem[] } {
  const db = requireDatabase();
  const text = query.query?.trim() ?? "";
  const clauses = ["1 = 1"];
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
          : "media_files.updated_at DESC, collections.title COLLATE NOCASE ASC";
  const rows = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
      media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
      media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.available, sources.available AS sourceAvailable,
      collections.title, collections.kind, collections.year, collections.plot,
      collections.genre_json AS genreJson, collections.rating
    FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as Array<Record<string, unknown>>;
  return { totalCount: Number(count?.count ?? 0), items: rows.map(toPublicItem) };
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
      collections.genre_json AS genreJson, collections.rating
    FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
    WHERE media_files.media_id = ?
  `).get(mediaId) as Record<string, unknown> | undefined;
  return row ? toPublicItem(row) : undefined;
}

function getDetail(mediaId: string): LocalMediaDetail | undefined {
  const item = get(mediaId);
  if (!item) return undefined;
  const db = requireDatabase();
  const collection = db.prepare("SELECT title, kind FROM collections WHERE collection_id = ?").get(item.collectionId) as { title?: string; kind?: string } | undefined;
  const rows = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
      media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
      media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.available, sources.available AS sourceAvailable,
      collections.title, collections.kind, collections.year, collections.plot,
      collections.genre_json AS genreJson, collections.rating
    FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
    WHERE media_files.collection_id = ?
    ORDER BY media_files.season_number IS NULL, media_files.season_number, media_files.episode_number IS NULL,
      media_files.episode_number, media_files.display_title COLLATE NOCASE
  `).all(item.collectionId) as Array<Record<string, unknown>>;
  return {
    item,
    ...(collection?.title ? { collectionTitle: collection.title } : {}),
    ...(collection?.kind === "movie" || collection?.kind === "show" || collection?.kind === "unclassified" ? { collectionKind: collection.kind } : {}),
    episodes: rows.map(toPublicItem),
  };
}

function listContinueWatching(): LocalContinueWatchingItem[] {
  const db = requireDatabase();
  const rows = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
      media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
      media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.available, sources.available AS sourceAvailable,
      collections.title, collections.kind, collections.year, collections.plot,
      collections.genre_json AS genreJson, collections.rating,
      playback_state.position_sec AS positionSec, playback_state.duration_sec AS durationSec,
      playback_state.audio_track_id AS audioTrackId, playback_state.subtitle_track_id AS subtitleTrackId,
      playback_state.watched, playback_state.updated_at AS updatedAtMs
    FROM playback_state
      JOIN media_files ON media_files.media_id = playback_state.media_id
      JOIN collections USING (collection_id)
      JOIN sources USING (source_id)
    WHERE playback_state.watched = 0 AND playback_state.position_sec > 0
    ORDER BY playback_state.updated_at DESC
    LIMIT 50
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    item: toPublicItem(row),
    playback: {
      mediaId: String(row.mediaId) as LocalPlaybackState["mediaId"],
      positionSec: Number(row.positionSec),
      ...(row.durationSec === null || row.durationSec === undefined ? {} : { durationSec: Number(row.durationSec) }),
      ...(row.audioTrackId === null || row.audioTrackId === undefined ? {} : { audioTrackId: String(row.audioTrackId) }),
      ...(row.subtitleTrackId === null || row.subtitleTrackId === undefined ? {} : { subtitleTrackId: String(row.subtitleTrackId) }),
      watched: false,
      updatedAtMs: Number(row.updatedAtMs),
    },
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

function getPlayback(mediaId: string): LocalPlaybackState | undefined {
  const db = requireDatabase();
  const row = db.prepare(`
    SELECT media_id AS mediaId, position_sec AS positionSec, duration_sec AS durationSec,
      audio_track_id AS audioTrackId, subtitle_track_id AS subtitleTrackId,
      watched, updated_at AS updatedAtMs
    FROM playback_state WHERE media_id = ?
  `).get(mediaId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    mediaId: String(row.mediaId) as LocalPlaybackState["mediaId"],
    positionSec: Number(row.positionSec),
    ...(row.durationSec === null || row.durationSec === undefined ? {} : { durationSec: Number(row.durationSec) }),
    ...(row.audioTrackId === null || row.audioTrackId === undefined ? {} : { audioTrackId: String(row.audioTrackId) }),
    ...(row.subtitleTrackId === null || row.subtitleTrackId === undefined ? {} : { subtitleTrackId: String(row.subtitleTrackId) }),
    watched: Number(row.watched) === 1,
    updatedAtMs: Number(row.updatedAtMs),
  };
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
  `).run(stateValue.mediaId, stateValue.positionSec, stateValue.durationSec ?? null, stateValue.audioTrackId ?? null, stateValue.subtitleTrackId ?? null, stateValue.watched ? 1 : 0, updatedAtMs);
  return { ...stateValue, updatedAtMs };
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

interface ScanCounters {
  scannedFiles: number;
  importedFiles: number;
  updatedFiles: number;
  warnings: string[];
  seenRelativePaths: Set<string>;
}

function progressFor(scanId: string, sourceId: string, status: LocalScanProgress["status"], counters: ScanCounters): LocalScanProgress {
  return {
    scanId,
    sourceId,
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

async function scanDirectory(
  rootPath: string,
  currentDirectory: string,
  sourceId: string,
  scanId: string,
  cancellation: { requested: boolean },
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
  const tvshow = entries.find((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase() === "tvshow.nfo");
  if (tvshow) {
    const metadata = await readNfoFile(join(safeCurrentDirectory, tvshow.name), counters.warnings);
    const artworkFiles: Array<{ kind: "poster" | "fanart"; filePath: string }> = [];
    for (const candidate of metadata?.artwork ?? []) {
      const artworkFile = await profileAsync("artwork", () => artworkPath(rootPath, safeCurrentDirectory, candidate.path));
      if (artworkFile) artworkFiles.push({ kind: candidate.kind, filePath: artworkFile });
    }
    if (!artworkFiles.length) artworkFiles.push(...await conventionalArtwork(rootPath, safeCurrentDirectory, basename(safeCurrentDirectory), entries));
    localShowContext = { directory: safeCurrentDirectory, metadata, artwork: artworkFiles };
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
      const result = await upsertMedia(rootPath, discovered, false);
      if (result.created) counters.importedFiles += 1;
      else counters.updatedFiles += 1;
      counters.seenRelativePaths.add(discovered.relativePath);
    } catch (error) {
      profileError(error);
      counters.warnings.push("视频条目无法索引，已保留此前索引");
    }
    emitProgress(progressFor(scanId, sourceId, "running", counters));
    await yieldImmediate();
  }
  return true;
}

async function scanRoot(rootPath: string): Promise<LocalScanResult> {
  if (activeScan) throw new LocalWorkerError("invalid-input", "已有本地片库扫描正在进行");
  const counters: ScanCounters = { scannedFiles: 0, importedFiles: 0, updatedFiles: 0, warnings: [], seenRelativePaths: new Set() };
  let profiler: ScanProfiler | undefined;
  let profileStatus: ScanProfileReport["status"] = "error";
  let source: ReturnType<typeof ensureSource> | undefined;
  let scanId: string | undefined;
  let cancellation: { requested: boolean } | undefined;
  try {
    profiler = beginScanProfiler();
    scanProfiler = profiler;
    scanCaches = { nfo: new Map(), artwork: new Map() };
    const requestedRoot = resolve(rootPath);
    const canonicalRoot = await profileAsync("realpath", () => realpath(requestedRoot), "realpath").catch(() => undefined);
    const sourceRoot = canonicalRoot ?? requestedRoot;
    await assertNoOverlappingSource(sourceRoot);
    const scanSource = ensureSource(sourceRoot);
    source = scanSource;
    scanId = makeId("scan");
    cancellation = { requested: false };
    scanCancellation.set(scanId, cancellation);
    addScanRun(scanSource.sourceId, scanId);
    if (!canonicalRoot) {
      const db = requireDatabase();
      profileSync("database", () => db.prepare("UPDATE sources SET available = 0, updated_at = ? WHERE source_id = ?").run(now(), scanSource.sourceId));
      const result: LocalScanResult = { ...progressFor(scanId, scanSource.sourceId, "unavailable", counters), warnings: [], error: "来源不可用，已保留此前索引和播放历史" };
      finishScan(scanId, false, result.error);
      emitProgress(result);
      profileStatus = "unavailable";
      return result;
    }
    const rootStat = await profileAsync("lstat", () => lstat(canonicalRoot), "lstat");
    if (!rootStat.isDirectory()) throw new LocalWorkerError("invalid-input", "选择的片库目录不可用");
    const db = requireDatabase();
    profileSync("database", () => db.prepare("UPDATE sources SET available = 1, updated_at = ? WHERE source_id = ?").run(now(), scanSource.sourceId));
    emitProgress(progressFor(scanId, scanSource.sourceId, "running", counters));
    const traversalComplete = await scanDirectory(canonicalRoot, canonicalRoot, scanSource.sourceId, scanId, cancellation, counters, undefined);
    if (cancellation.requested) throw new LocalWorkerError("storage", "scan-cancelled");
    if (traversalComplete) {
      if (counters.seenRelativePaths.size === 0) {
        profileSync("database", () => db.prepare("UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ?").run(now(), scanSource.sourceId));
      } else {
        const placeholders = [...counters.seenRelativePaths].map(() => "?").join(",");
        profileSync("database", () => db.prepare(`UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ? AND relative_path NOT IN (${placeholders})`).run(now(), scanSource.sourceId, ...counters.seenRelativePaths));
      }
      finishScan(scanId, true);
      const result: LocalScanResult = { ...progressFor(scanId, scanSource.sourceId, "completed", counters), warnings: [...counters.warnings] };
      emitProgress(result);
      profileStatus = "completed";
      return result;
    }
    const error = "部分目录无法读取，已保留此前索引和播放历史";
    profileSync("database", () => db.prepare("UPDATE sources SET available = 0, updated_at = ? WHERE source_id = ?").run(now(), scanSource.sourceId));
    finishScan(scanId, false, error);
    const result: LocalScanResult = { ...progressFor(scanId, scanSource.sourceId, "partial", counters), warnings: [...counters.warnings], error };
    emitProgress(result);
    profileStatus = "partial";
    return result;
  } catch (error) {
    if (scanId && source && error instanceof LocalWorkerError && error.message === "scan-cancelled") {
      const result: LocalScanResult = { ...progressFor(scanId, source.sourceId, "cancelled", counters), warnings: [...counters.warnings], error: "扫描已取消，已保留此前索引和播放历史" };
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
  const result = await upsertMedia(paths.root, discovered);
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
  if (request.command === "cancel-scan") {
    const token = scanCancellation.get(request.scanId);
    if (!token) return false;
    token.requested = true;
    return true;
  }
  if (request.command === "list") return list(request.query);
  if (request.command === "get") return get(request.mediaId);
  if (request.command === "get-detail") return getDetail(request.mediaId);
  if (request.command === "list-continue-watching") return listContinueWatching();
  if (request.command === "remove-source") return removeSource(request.sourceId);
  if (request.command === "source-root") return sourceRoot(request.sourceId);
  if (request.command === "resolve-artwork") return resolveArtwork(request.mediaId, request.kind);
  if (request.command === "resolve-path") return resolvePath(request.mediaId);
  if (request.command === "get-playback") return getPlayback(request.mediaId);
  if (request.command === "save-playback") return savePlayback(request.state);
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
