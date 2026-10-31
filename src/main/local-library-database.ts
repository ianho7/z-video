import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { utilityProcess, type UtilityProcess } from "electron";

import {
  LOCAL_LIBRARY_SCHEMA_VERSION,
  isOpaqueMediaId,
  type LocalImportOutcome,
  type LocalLibraryPage,
  type LocalLibraryQuery,
  type LocalLibraryState,
  type LocalMediaItem,
} from "../shared/local-library-contracts";

type WorkerCommand =
  | { command: "initialize"; dbPath: string }
  | { command: "state" }
  | { command: "import-first-movie"; rootPath: string }
  | { command: "import-video"; filePath: string; rootPath: string }
  | { command: "list"; query: LocalLibraryQuery }
  | { command: "get"; mediaId: string }
  | { command: "resolve-path"; mediaId: string }
  | { command: "close" };

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

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface LocalLibraryDatabaseOptions {
  dbPath?: string;
  workerPath?: string;
}

export class LocalLibraryDatabaseError extends Error {
  constructor(readonly code: WorkerFailure["error"]["code"], message: string) {
    super(message);
    this.name = "LocalLibraryDatabaseError";
  }
}

export class LocalLibraryDatabase {
  private readonly dbPath: string;
  private readonly workerPath: string;
  private worker: UtilityProcess | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly stateListeners = new Set<(state: LocalLibraryState) => void>();
  private state: LocalLibraryState = {
    status: "error",
    schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION,
    sqliteAvailable: false,
    sources: [],
  };
  private closing = false;

  constructor(options: LocalLibraryDatabaseOptions = {}) {
    this.dbPath = options.dbPath ?? join(process.cwd(), "local-library", "library.sqlite");
    this.workerPath = options.workerPath ?? join(__dirname, "local-library-worker.js");
  }

  async start(): Promise<LocalLibraryState> {
    if (this.worker) return this.getState();
    await mkdir(dirname(this.dbPath), { recursive: true });
    this.worker = utilityProcess.fork(this.workerPath, [], { serviceName: "z-video-local-library" });
    this.worker.on("message", (event) => {
      const payload = event && typeof event === "object" && "id" in event
        ? event
        : (event as unknown as { data?: unknown }).data;
      this.handleWorkerMessage(payload as WorkerSuccess | WorkerFailure);
    });
    this.worker.on("exit", (code) => this.handleWorkerExit(code));
    this.worker.on("error", (type, location) => {
      this.failPending(new LocalLibraryDatabaseError("sqlite-unavailable", `本地片库 worker 异常：${type} ${location}`));
    });
    try {
      const result = await this.call<{ schemaVersion: typeof LOCAL_LIBRARY_SCHEMA_VERSION; sqliteAvailable: true; sources: LocalLibraryState["sources"] }>({ command: "initialize", dbPath: this.dbPath });
      this.state = { status: "ready", ...result };
      this.emitState();
      return this.getState();
    } catch (error) {
      this.state = {
        status: "error",
        schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION,
        sqliteAvailable: false,
        sources: [],
        error: {
          code: error instanceof LocalLibraryDatabaseError && error.code === "sqlite-unavailable" ? "sqlite-unavailable" : "storage",
          message: error instanceof Error ? error.message : String(error),
        },
      };
      this.emitState();
      throw error;
    }
  }

  getState(): LocalLibraryState {
    return {
      ...this.state,
      sources: this.state.sources.map((source) => ({ ...source })),
      ...(this.state.error ? { error: { ...this.state.error } } : {}),
    };
  }

  onState(listener: (state: LocalLibraryState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  async refreshState(): Promise<LocalLibraryState> {
    const result = await this.call<{ schemaVersion: typeof LOCAL_LIBRARY_SCHEMA_VERSION; sqliteAvailable: true; sources: LocalLibraryState["sources"] }>({ command: "state" });
    this.state = { status: "ready", ...result };
    this.emitState();
    return this.getState();
  }

  async importFirstMovieInFolder(rootPath: string): Promise<LocalImportOutcome> {
    const result = await this.call<{ status: "imported" | "empty"; item?: LocalMediaItem }>({ command: "import-first-movie", rootPath });
    const state = await this.refreshState();
    return result.status === "empty" || !result.item
      ? { status: "empty", state }
      : { status: "imported", item: result.item, state };
  }

  async importVideo(filePath: string, rootPath: string): Promise<LocalImportOutcome> {
    const result = await this.call<{ status: "imported"; item: LocalMediaItem }>({ command: "import-video", filePath, rootPath });
    const state = await this.refreshState();
    return { status: "imported", item: result.item, state };
  }

  async list(query: LocalLibraryQuery): Promise<LocalLibraryPage> {
    const result = await this.call<{ totalCount: number; items: LocalMediaItem[] }>({ command: "list", query });
    return { query: { ...query }, page: query.page, pageSize: query.pageSize, ...result };
  }

  async get(mediaId: string): Promise<LocalMediaItem | undefined> {
    assertMediaId(mediaId);
    return this.call<LocalMediaItem | undefined>({ command: "get", mediaId });
  }

  /** Main-only path resolution for the future playback owner; never expose through preload. */
  async resolveMediaPath(mediaId: string): Promise<string | undefined> {
    assertMediaId(mediaId);
    return this.call<string | undefined>({ command: "resolve-path", mediaId });
  }

  async close(): Promise<void> {
    if (!this.worker || this.closing) return;
    this.closing = true;
    try {
      await this.call({ command: "close" });
    } finally {
      this.worker.kill();
      this.worker = undefined;
      this.failPending(new LocalLibraryDatabaseError("storage", "本地片库 worker 已关闭"));
      this.closing = false;
    }
  }

  private async call<T>(command: WorkerCommand): Promise<T> {
    if (!this.worker) throw new LocalLibraryDatabaseError("storage", "本地片库 worker 尚未启动");
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker?.postMessage({ id, ...command });
    });
  }

  private handleWorkerMessage(message: WorkerSuccess | WorkerFailure): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new LocalLibraryDatabaseError(message.error.code, message.error.message));
  }

  private handleWorkerExit(code: number): void {
    this.worker = undefined;
    if (!this.closing && code !== 0) this.failPending(new LocalLibraryDatabaseError("sqlite-unavailable", `本地片库 worker 已退出（code=${code}）`));
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private emitState(): void {
    const state = this.getState();
    for (const listener of this.stateListeners) listener(state);
  }
}

function assertMediaId(mediaId: string): void {
  if (!isOpaqueMediaId(mediaId)) throw new LocalLibraryDatabaseError("invalid-input", "mediaId 格式无效");
}
