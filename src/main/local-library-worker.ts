import { createHash, randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";

import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import {
  LOCAL_LIBRARY_SCHEMA_VERSION,
  type LocalLibraryQuery,
  type LocalMediaItem,
  type LocalArtworkReference,
  type LocalPlaybackState,
  type LocalScanProgress,
  type LocalScanResult,
  type LocalSourceSummary,
} from "../shared/local-library-contracts";
import { parseEpisodeNumbers, parseNfo, type ParsedNfo } from "./local-library-metadata";

type WorkerRequest =
  | { id: number; command: "initialize"; dbPath: string }
  | { id: number; command: "state" }
  | { id: number; command: "import-first-movie"; rootPath: string }
  | { id: number; command: "import-video"; filePath: string; rootPath: string }
  | { id: number; command: "scan"; rootPath: string }
  | { id: number; command: "cancel-scan"; scanId: string }
  | { id: number; command: "list"; query: LocalLibraryQuery }
  | { id: number; command: "get"; mediaId: string }
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
      throw new LocalWorkerError("sqlite-unavailable", "当前 Electron utilityProcess 未提供 node:sqlite DatabaseSync");
    }
    database = new sqlite.DatabaseSync(dbPath);
  } catch (error) {
    if (error instanceof LocalWorkerError) throw error;
    throw new LocalWorkerError("sqlite-unavailable", `当前 Electron utilityProcess 无法打开 node:sqlite：${error instanceof Error ? error.message : String(error)}`);
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
    throw new LocalWorkerError("storage", `本地片库数据库初始化失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function ensureColumn(table: string, column: string, definition: string): void {
  const db = requireDatabase();
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some((candidate) => candidate.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

function assertRootAndFile(rootPath: string, filePath: string): { root: string; file: string; relativePath: string } {
  const root = resolve(rootPath);
  const file = resolve(filePath);
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

function findFirstVideo(rootPath: string): string | undefined {
  const root = resolve(rootPath);
  const rootStat = statSync(root, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory()) throw new LocalWorkerError("invalid-input", "选择的片库目录不可用");
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile() && supportedVideoExtensions.has(extname(entry.name).toLowerCase())) {
        return child;
      }
    }
  }
  return undefined;
}

function pathWithin(rootPath: string, candidatePath: string): boolean {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const candidateRelative = relative(root, candidate);
  return Boolean(candidateRelative) && !isAbsolute(candidateRelative) && candidateRelative !== ".." && !candidateRelative.startsWith(`..${sep}`);
}

function ensureSource(rootPath: string): { sourceId: string; label: string; rootPath: string; available: boolean } {
  const db = requireDatabase();
  const root = resolve(rootPath);
  const existing = db.prepare("SELECT source_id AS sourceId, label, available FROM sources WHERE root_path = ?").get(root) as { sourceId?: string; label?: string; available?: number } | undefined;
  const timestamp = now();
  if (existing?.sourceId) {
    return { sourceId: existing.sourceId, label: existing.label ?? basename(root), rootPath: root, available: Number(existing.available) === 1 };
  }
  const sourceId = makeId("source");
  const label = basename(root) || root;
  db.prepare("INSERT INTO sources (source_id, root_path, label, available, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)").run(sourceId, root, label, timestamp, timestamp);
  return { sourceId, label, rootPath: root, available: false };
}

function assertNoOverlappingSource(rootPath: string, sourceId?: string): void {
  const db = requireDatabase();
  const rows = (sourceId
    ? db.prepare("SELECT source_id AS sourceId, root_path AS rootPath FROM sources WHERE source_id <> ?").all(sourceId)
    : db.prepare("SELECT source_id AS sourceId, root_path AS rootPath FROM sources").all()) as Array<{ sourceId?: string; rootPath?: string }>;
  for (const row of rows) {
    if (row.rootPath && (pathWithin(row.rootPath, rootPath) || pathWithin(rootPath, row.rootPath))) {
      throw new LocalWorkerError("invalid-input", "新的片库目录与已有来源重叠");
    }
  }
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
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.size > maxNfoBytes) {
      warnings.push("NFO 文件过大或不可用，已使用文件名回退");
      return undefined;
    }
    const xml = await readFile(filePath, "utf8");
    return parseNfo(xml);
  } catch {
    warnings.push("NFO 无法解析，已使用文件名回退");
    return undefined;
  }
}

async function artworkPath(rootPath: string, nfoDirectory: string, candidate: string): Promise<string | undefined> {
  const trimmed = candidate.trim();
  if (!trimmed || isAbsolute(trimmed) || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return undefined;
  const filePath = resolve(nfoDirectory, trimmed);
  if (!pathWithin(rootPath, filePath)) return undefined;
  try {
    const metadata = await lstat(filePath);
    return metadata.isFile() && !metadata.isSymbolicLink() && supportedArtworkExtensions.has(extname(filePath).toLowerCase()) ? filePath : undefined;
  } catch {
    return undefined;
  }
}

async function conventionalArtwork(rootPath: string, directory: string, baseName: string): Promise<Array<{ kind: "poster" | "fanart"; filePath: string }>> {
  const candidates: Array<{ kind: "poster" | "fanart"; names: string[] }> = [
    { kind: "poster", names: [`${baseName}-poster`, `${baseName}.poster`, "poster", "folder", "cover"] },
    { kind: "fanart", names: [`${baseName}-fanart`, `${baseName}.fanart`, "fanart", "background"] },
  ];
  const output: Array<{ kind: "poster" | "fanart"; filePath: string }> = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const candidate of candidates) {
    const match = entries.find((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) return false;
      const stem = basename(entry.name, extname(entry.name));
      return candidate.names.some((name) => stem.toLowerCase() === name.toLowerCase()) && supportedArtworkExtensions.has(extname(entry.name).toLowerCase());
    });
    if (match) {
      const filePath = await artworkPath(rootPath, directory, match.name);
      if (filePath) output.push({ kind: candidate.kind, filePath });
    }
  }
  return output;
}

async function discoverMedia(
  rootPath: string,
  sourceId: string,
  filePath: string,
  entries: Array<{ name: string; isFile(): boolean; isSymbolicLink(): boolean }>,
  showContext: { directory: string; metadata?: ParsedNfo; artwork: Array<{ kind: "poster" | "fanart"; filePath: string }> } | undefined,
  warnings: string[],
): Promise<DiscoveredMedia> {
  const fileStat = await stat(filePath);
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
    const resolved = await artworkPath(rootPath, dirname(filePath), reference.path);
    if (resolved) artworkFiles.push({ kind: reference.kind, filePath: resolved });
  }
  if (showContext?.artwork.length) artworkFiles.push(...showContext.artwork);
  if (!artworkFiles.length) artworkFiles.push(...await conventionalArtwork(rootPath, collectionDirectory, baseName));
  return {
    relativePath,
    sizeBytes: Number(fileStat.size),
    modifiedAtMs: Number(fileStat.mtimeMs),
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
    : db.prepare(`
    SELECT collection_id AS collectionId
    FROM collections
    WHERE identity_key = ? OR (identity_key IS NULL AND source_id = ? AND relative_path = ?)
    LIMIT 1
  `).get(metadata.identityKey, metadata.sourceId, metadata.relativePath) as { collectionId?: string } | undefined;
  const collectionId = existing?.collectionId ?? makeId("collection");
  if (existing?.collectionId) {
    db.prepare(`
      UPDATE collections SET title = ?, kind = ?, year = ?, plot = ?, genre_json = ?, rating = ?, identity_key = ?, source_id = ?, relative_path = ?, updated_at = ?
      WHERE collection_id = ?
    `).run(metadata.title, metadata.kind, metadata.year ?? null, metadata.plot ?? null, JSON.stringify(metadata.genres), metadata.rating ?? null, metadata.identityKey, metadata.sourceId, metadata.relativePath, timestamp, collectionId);
  } else {
    db.prepare(`
      INSERT INTO collections (collection_id, title, kind, year, plot, genre_json, rating, identity_key, source_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(collectionId, metadata.title, metadata.kind, metadata.year ?? null, metadata.plot ?? null, JSON.stringify(metadata.genres), metadata.rating ?? null, metadata.identityKey, metadata.sourceId, metadata.relativePath, timestamp, timestamp);
  }
  return collectionId;
}

function artworkFingerprint(sourceId: string, relativePath: string, sizeBytes: number, modifiedAtMs: number): { sourceFingerprint: string; cacheKey: string } {
  const sourceFingerprint = `${sourceId}:${relativePath}:${sizeBytes}:${modifiedAtMs}`;
  const cacheKey = `artwork_${createHash("sha256").update(sourceFingerprint).digest("hex")}`;
  return { sourceFingerprint, cacheKey };
}

async function upsertArtwork(
  collectionId: string,
  mediaId: string,
  sourceId: string,
  rootPath: string,
  artwork: Array<{ kind: "poster" | "fanart"; filePath: string }>,
): Promise<void> {
  if (!artwork.length) return;
  const db = requireDatabase();
  const timestamp = now();
  for (const candidate of artwork) {
    try {
      const info = await lstat(candidate.filePath);
      const relativePath = makeRelative(rootPath, candidate.filePath);
      const fingerprint = artworkFingerprint(sourceId, relativePath, Number(info.size), Number(info.mtimeMs));
      db.prepare("DELETE FROM artwork WHERE collection_id = ? AND media_id = ? AND kind = ?").run(collectionId, mediaId, candidate.kind);
      db.prepare(`
        INSERT INTO artwork (artwork_id, collection_id, media_id, source_id, relative_path, kind, source_fingerprint, cache_key, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(makeId("artwork"), collectionId, mediaId, sourceId, relativePath, candidate.kind, fingerprint.sourceFingerprint, fingerprint.cacheKey, timestamp);
    } catch {
      // Artwork is optional. A missing or inaccessible image never removes a playable item.
    }
  }
}

async function upsertMedia(rootPath: string, discovered: DiscoveredMedia): Promise<{ item: LocalMediaItem; created: boolean }> {
  const db = requireDatabase();
  const timestamp = now();
  const existing = db.prepare(`
    SELECT media_id AS mediaId, collection_id AS collectionId
    FROM media_files
    WHERE source_id = ? AND relative_path = ? AND size_bytes = ? AND modified_at_ms = ?
  `).get(discovered.collection.sourceId, discovered.relativePath, discovered.sizeBytes, discovered.modifiedAtMs) as { mediaId?: string; collectionId?: string } | undefined;
  const collectionId = upsertCollection(discovered.collection, timestamp, existing?.collectionId);
  let mediaId: string;
  let created = false;
  if (existing?.mediaId) {
    mediaId = String(existing.mediaId);
    db.prepare(`
      UPDATE media_files SET collection_id = ?, display_title = ?, media_kind = ?, season_number = ?, episode_number = ?, available = 1, updated_at = ?
      WHERE media_id = ?
    `).run(collectionId, discovered.displayTitle, discovered.mediaKind, discovered.seasonNumber ?? null, discovered.episodeNumber ?? null, timestamp, mediaId);
  } else {
    db.prepare("UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ? AND relative_path = ? AND available = 1").run(timestamp, discovered.collection.sourceId, discovered.relativePath);
    mediaId = makeId("media");
    created = true;
    db.prepare(`
      INSERT INTO media_files (media_id, collection_id, source_id, relative_path, display_title, media_kind, size_bytes, modified_at_ms, season_number, episode_number, available, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(mediaId, collectionId, discovered.collection.sourceId, discovered.relativePath, discovered.displayTitle, discovered.mediaKind, discovered.sizeBytes, discovered.modifiedAtMs, discovered.seasonNumber ?? null, discovered.episodeNumber ?? null, timestamp, timestamp);
  }
  await upsertArtwork(collectionId, mediaId, discovered.collection.sourceId, rootPath, discovered.artwork);
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
  `).get(mediaId) as Record<string, unknown>;
  return { item: toPublicItem(row), created };
}

function sourceSummaries(): LocalSourceSummary[] {
  const db = requireDatabase();
  const rows = db.prepare(`
    SELECT sources.source_id AS sourceId, sources.label, sources.available,
      COUNT(CASE WHEN media_files.available = 1 THEN 1 END) AS itemCount
    FROM sources
    LEFT JOIN media_files ON media_files.source_id = sources.source_id
    GROUP BY sources.source_id
    ORDER BY sources.label COLLATE NOCASE
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    sourceId: String(row.sourceId),
    label: String(row.label),
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
  const where = text ? "AND (collections.title LIKE ? OR media_files.display_title LIKE ?)" : "";
  const parameters = text ? [`%${text}%`, `%${text}%`] : [];
  const count = db.prepare(`SELECT COUNT(*) AS count FROM media_files JOIN collections USING (collection_id) WHERE 1 = 1 ${where}`).get(...parameters) as { count?: number } | undefined;
  const rows = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.collection_id AS collectionId, media_files.source_id AS sourceId,
      media_files.display_title AS displayTitle, media_files.media_kind AS mediaKind,
      media_files.size_bytes AS sizeBytes, media_files.modified_at_ms AS modifiedAtMs,
      media_files.season_number AS seasonNumber, media_files.episode_number AS episodeNumber,
      media_files.available, sources.available AS sourceAvailable,
      collections.title, collections.kind, collections.year, collections.plot,
      collections.genre_json AS genreJson, collections.rating
    FROM media_files JOIN collections USING (collection_id) JOIN sources USING (source_id)
    WHERE 1 = 1 ${where}
    ORDER BY media_files.updated_at DESC, collections.title COLLATE NOCASE
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

function resolvePath(mediaId: string): string | undefined {
  const db = requireDatabase();
  const row = db.prepare(`
    SELECT sources.root_path AS rootPath, media_files.relative_path AS relativePath
    FROM media_files JOIN sources USING (source_id)
    WHERE media_files.media_id = ?
  `).get(mediaId) as { rootPath?: string; relativePath?: string } | undefined;
  if (!row?.rootPath || !row.relativePath) return undefined;
  const path = resolve(row.rootPath, ...row.relativePath.split("/"));
  if (!pathWithin(row.rootPath, path)) throw new LocalWorkerError("storage", "本地媒体路径越过已选择的片库目录");
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
  db.prepare("INSERT INTO scan_runs (scan_id, source_id, generation, completed, started_at) VALUES (?, ?, ?, 0, ?)").run(scanId, sourceId, generation, now());
  return generation;
}

function finishScan(scanId: string, completed: boolean, error?: string): void {
  const db = requireDatabase();
  db.prepare("UPDATE scan_runs SET completed = ?, error = ?, completed_at = ? WHERE scan_id = ?").run(completed ? 1 : 0, error ?? null, now(), scanId);
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
  let entries;
  try {
    entries = (await readdir(currentDirectory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    counters.warnings.push("部分目录无法读取，已保留此前索引");
    return false;
  }
  let localShowContext = showContext;
  const tvshow = entries.find((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase() === "tvshow.nfo");
  if (tvshow) {
    const metadata = await readNfoFile(join(currentDirectory, tvshow.name), counters.warnings);
    const artworkFiles: Array<{ kind: "poster" | "fanart"; filePath: string }> = [];
    for (const candidate of metadata?.artwork ?? []) {
      const artworkFile = await artworkPath(rootPath, currentDirectory, candidate.path);
      if (artworkFile) artworkFiles.push({ kind: candidate.kind, filePath: artworkFile });
    }
    if (!artworkFiles.length) artworkFiles.push(...await conventionalArtwork(rootPath, currentDirectory, basename(currentDirectory)));
    localShowContext = { directory: currentDirectory, metadata, artwork: artworkFiles };
  }
  for (const entry of entries) {
    if (cancellation.requested) throw new LocalWorkerError("storage", "scan-cancelled");
    const child = join(currentDirectory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const complete = await scanDirectory(rootPath, child, sourceId, scanId, cancellation, counters, localShowContext);
      if (!complete) return false;
      continue;
    }
    if (!entry.isFile() || !supportedVideoExtensions.has(extname(entry.name).toLowerCase())) continue;
    counters.scannedFiles += 1;
    try {
      const discovered = await discoverMedia(rootPath, sourceId, child, entries, localShowContext, counters.warnings);
      const result = await upsertMedia(rootPath, discovered);
      if (result.created) counters.importedFiles += 1;
      else counters.updatedFiles += 1;
      counters.seenRelativePaths.add(discovered.relativePath);
    } catch {
      counters.warnings.push("视频条目无法索引，已保留此前索引");
    }
    emitProgress(progressFor(scanId, sourceId, "running", counters));
    await yieldImmediate();
  }
  return true;
}

async function scanRoot(rootPath: string): Promise<LocalScanResult> {
  if (activeScan) throw new LocalWorkerError("invalid-input", "已有本地片库扫描正在进行");
  const root = resolve(rootPath);
  assertNoOverlappingSource(root);
  const source = ensureSource(root);
  const scanId = makeId("scan");
  const cancellation = { requested: false };
  scanCancellation.set(scanId, cancellation);
  const counters: ScanCounters = { scannedFiles: 0, importedFiles: 0, updatedFiles: 0, warnings: [], seenRelativePaths: new Set() };
  addScanRun(source.sourceId, scanId);
  try {
    let rootStat;
    try {
      rootStat = await stat(root);
    } catch {
      const db = requireDatabase();
      db.prepare("UPDATE sources SET available = 0, updated_at = ? WHERE source_id = ?").run(now(), source.sourceId);
      const result: LocalScanResult = { ...progressFor(scanId, source.sourceId, "unavailable", counters), warnings: [], error: "来源不可用，已保留此前索引和播放历史" };
      finishScan(scanId, false, result.error);
      emitProgress(result);
      return result;
    }
    if (!rootStat.isDirectory()) throw new LocalWorkerError("invalid-input", "选择的片库目录不可用");
    const db = requireDatabase();
    db.prepare("UPDATE sources SET available = 1, updated_at = ? WHERE source_id = ?").run(now(), source.sourceId);
    emitProgress(progressFor(scanId, source.sourceId, "running", counters));
    const traversalComplete = await scanDirectory(root, root, source.sourceId, scanId, cancellation, counters, undefined);
    if (cancellation.requested) throw new LocalWorkerError("storage", "scan-cancelled");
    if (traversalComplete) {
      if (counters.seenRelativePaths.size === 0) {
        db.prepare("UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ?").run(now(), source.sourceId);
      } else {
        const placeholders = [...counters.seenRelativePaths].map(() => "?").join(",");
        db.prepare(`UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ? AND relative_path NOT IN (${placeholders})`).run(now(), source.sourceId, ...counters.seenRelativePaths);
      }
      finishScan(scanId, true);
      const result: LocalScanResult = { ...progressFor(scanId, source.sourceId, "completed", counters), warnings: [...counters.warnings] };
      emitProgress(result);
      return result;
    }
    const error = "部分目录无法读取，已保留此前索引和播放历史";
    finishScan(scanId, false, error);
    const result: LocalScanResult = { ...progressFor(scanId, source.sourceId, "partial", counters), warnings: [...counters.warnings], error };
    emitProgress(result);
    return result;
  } catch (error) {
    if (error instanceof LocalWorkerError && error.message === "scan-cancelled") {
      const result: LocalScanResult = { ...progressFor(scanId, source.sourceId, "cancelled", counters), warnings: [...counters.warnings], error: "扫描已取消，已保留此前索引和播放历史" };
      finishScan(scanId, false, result.error);
      emitProgress(result);
      return result;
    }
    finishScan(scanId, false, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    scanCancellation.delete(scanId);
  }
}

async function importVideo(filePath: string, rootPath: string): Promise<LocalMediaItem> {
  const db = requireDatabase();
  assertSupportedVideo(filePath);
  const paths = assertRootAndFile(rootPath, filePath);
  const fileStat = statSync(paths.file, { throwIfNoEntry: false });
  if (!fileStat?.isFile()) throw new LocalWorkerError("invalid-input", "选择的本地视频文件不可用");
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
    const filePath = findFirstVideo(request.rootPath);
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
          ? { code: error.code, message: error.message }
          : { code: "unknown", message: error instanceof Error ? error.message : String(error) },
      };
      workerPort.postMessage(response);
    },
  );
});
