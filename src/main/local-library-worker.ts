import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import {
  LOCAL_LIBRARY_SCHEMA_VERSION,
  type LocalLibraryQuery,
  type LocalMediaItem,
  type LocalSourceSummary,
} from "../shared/local-library-contracts";

type WorkerRequest =
  | { id: number; command: "initialize"; dbPath: string }
  | { id: number; command: "state" }
  | { id: number; command: "import-first-movie"; rootPath: string }
  | { id: number; command: "import-video"; filePath: string; rootPath: string }
  | { id: number; command: "list"; query: LocalLibraryQuery }
  | { id: number; command: "get"; mediaId: string }
  | { id: number; command: "resolve-path"; mediaId: string }
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

interface ParentPortLike {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!port) throw new Error("local library worker requires Electron utilityProcess parentPort");

const supportedVideoExtensions = new Set([".avi", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4", ".ts", ".webm"]);
let database: DatabaseSyncType | undefined;

function makeId(prefix: "media" | "source" | "collection" | "scan"): string {
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_files (
        media_id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        modified_at_ms REAL NOT NULL,
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
        kind TEXT NOT NULL,
        source_fingerprint TEXT,
        cache_key TEXT,
        FOREIGN KEY (collection_id) REFERENCES collections(collection_id)
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
    if (existingVersion === 0) db.exec(`PRAGMA user_version = ${LOCAL_LIBRARY_SCHEMA_VERSION};`);
  } catch (error) {
    throw new LocalWorkerError("storage", `本地片库数据库初始化失败：${error instanceof Error ? error.message : String(error)}`);
  }
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

function ensureSource(rootPath: string): { sourceId: string; label: string } {
  const db = requireDatabase();
  const root = resolve(rootPath);
  const existing = db.prepare("SELECT source_id AS sourceId, label FROM sources WHERE root_path = ?").get(root) as { sourceId?: string; label?: string } | undefined;
  const timestamp = now();
  if (existing?.sourceId) {
    db.prepare("UPDATE sources SET available = 1, updated_at = ? WHERE source_id = ?").run(timestamp, existing.sourceId);
    return { sourceId: existing.sourceId, label: existing.label ?? basename(root) };
  }
  const sourceId = makeId("source");
  const label = basename(root) || root;
  db.prepare("INSERT INTO sources (source_id, root_path, label, available, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").run(sourceId, root, label, timestamp, timestamp);
  return { sourceId, label };
}

function toPublicItem(row: Record<string, unknown>): LocalMediaItem {
  return {
    mediaId: String(row.mediaId) as LocalMediaItem["mediaId"],
    sourceId: String(row.sourceId),
    title: String(row.title),
    kind: "movie",
    sizeBytes: Number(row.sizeBytes),
    modifiedAtMs: Number(row.modifiedAtMs),
    available: Number(row.available) === 1,
  };
}

function importVideo(filePath: string, rootPath: string): LocalMediaItem {
  const db = requireDatabase();
  assertSupportedVideo(filePath);
  const paths = assertRootAndFile(rootPath, filePath);
  const fileStat = statSync(paths.file, { throwIfNoEntry: false });
  if (!fileStat?.isFile()) throw new LocalWorkerError("invalid-input", "选择的本地视频文件不可用");
  const source = ensureSource(paths.root);
  const sizeBytes = Number(fileStat.size);
  const modifiedAtMs = Number(fileStat.mtimeMs);
  const existing = db.prepare(`
    SELECT media_id AS mediaId, source_id AS sourceId, title, size_bytes AS sizeBytes,
      modified_at_ms AS modifiedAtMs, available
    FROM media_files
    JOIN collections USING (collection_id)
    WHERE source_id = ? AND relative_path = ? AND size_bytes = ? AND modified_at_ms = ?
  `).get(source.sourceId, paths.relativePath, sizeBytes, modifiedAtMs) as Record<string, unknown> | undefined;
  const timestamp = now();
  if (existing?.mediaId) {
    db.prepare("UPDATE media_files SET available = 1, updated_at = ? WHERE media_id = ?").run(timestamp, String(existing.mediaId));
    return toPublicItem({ ...existing, available: 1 });
  }
  db.prepare("UPDATE media_files SET available = 0, updated_at = ? WHERE source_id = ? AND relative_path = ? AND available = 1").run(timestamp, source.sourceId, paths.relativePath);
  const collectionId = makeId("collection");
  const mediaId = makeId("media") as LocalMediaItem["mediaId"];
  const title = basename(paths.file, extname(paths.file));
  db.prepare("INSERT INTO collections (collection_id, title, kind, created_at, updated_at) VALUES (?, ?, 'movie', ?, ?)").run(collectionId, title, timestamp, timestamp);
  db.prepare(`
    INSERT INTO media_files (media_id, collection_id, source_id, relative_path, size_bytes, modified_at_ms, available, added_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(mediaId, collectionId, source.sourceId, paths.relativePath, sizeBytes, modifiedAtMs, timestamp, timestamp);
  return { mediaId, sourceId: source.sourceId, title, kind: "movie", sizeBytes, modifiedAtMs, available: true };
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
  const where = text ? "AND collections.title LIKE ?" : "";
  const parameters = text ? [`%${text}%`] : [];
  const count = db.prepare(`SELECT COUNT(*) AS count FROM media_files JOIN collections USING (collection_id) WHERE media_files.available = 1 ${where}`).get(...parameters) as { count?: number } | undefined;
  const rows = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.source_id AS sourceId,
      collections.title, media_files.size_bytes AS sizeBytes,
      media_files.modified_at_ms AS modifiedAtMs, media_files.available
    FROM media_files JOIN collections USING (collection_id)
    WHERE media_files.available = 1 ${where}
    ORDER BY media_files.updated_at DESC, collections.title COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as Array<Record<string, unknown>>;
  return { totalCount: Number(count?.count ?? 0), items: rows.map(toPublicItem) };
}

function get(mediaId: string): LocalMediaItem | undefined {
  const db = requireDatabase();
  const row = db.prepare(`
    SELECT media_files.media_id AS mediaId, media_files.source_id AS sourceId,
      collections.title, media_files.size_bytes AS sizeBytes,
      media_files.modified_at_ms AS modifiedAtMs, media_files.available
    FROM media_files JOIN collections USING (collection_id)
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
  const relativePath = relative(row.rootPath, path);
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) throw new LocalWorkerError("storage", "本地媒体路径越过已选择的片库目录");
  return path;
}

function handle(request: WorkerRequest): unknown {
  if (request.command === "initialize") {
    openDatabase(request.dbPath);
    return state();
  }
  if (request.command === "close") {
    database?.close();
    database = undefined;
    return undefined;
  }
  if (request.command === "state") return state();
  if (request.command === "import-first-movie") {
    const filePath = findFirstVideo(request.rootPath);
    return filePath ? { status: "imported", item: importVideo(filePath, request.rootPath) } : { status: "empty" };
  }
  if (request.command === "import-video") return { status: "imported", item: importVideo(request.filePath, request.rootPath) };
  if (request.command === "list") return list(request.query);
  if (request.command === "get") return get(request.mediaId);
  if (request.command === "resolve-path") return resolvePath(request.mediaId);
  throw new LocalWorkerError("unknown", "未知本地片库命令");
}

port.on("message", (event) => {
  const request = event.data as WorkerRequest;
  try {
    const response: WorkerSuccess = { id: request.id, ok: true, result: handle(request) };
    port.postMessage(response);
  } catch (error) {
    const response: WorkerFailure = {
      id: request.id,
      ok: false,
      error: error instanceof LocalWorkerError
        ? { code: error.code, message: error.message }
        : { code: "unknown", message: error instanceof Error ? error.message : String(error) },
    };
    port.postMessage(response);
  }
});
