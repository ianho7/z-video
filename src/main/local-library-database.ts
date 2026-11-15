import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { utilityProcess, type UtilityProcess } from "electron";

import {
  LOCAL_LIBRARY_SCHEMA_VERSION,
  isOpaqueMediaId,
  normalizeScanRelativeDirectory,
  type LocalDirectoryScanResult,
  type LocalImportOutcome,
  type LocalLibraryPage,
  type LocalLibraryQuery,
  type LocalCollectionPage,
  type LocalCollectionQuery,
  type LocalMediaDetail,
  type LocalContinueWatchingItem,
  type LocalLibraryState,
  type LocalMarker,
  type LocalMarkerDeleteInput,
  type LocalMarkerInput,
  type LocalMediaItem,
  type LocalPlaybackState,
  type LocalPlaybackUpdate,
  type LocalScanProgress,
  type LocalScanResult,
  type LocalSourceDirectories,
  type LocalViewingHistory,
  type LocalViewingSessionFinishInput,
  type LocalViewingSessionHeartbeatInput,
  type LocalViewingSessionStartInput,
} from "../shared/local-library-contracts";
import { localLibraryErrorMessage } from "./local-library-errors";
import type {
  CleanupSettings,
  LocalCleanupQueue,
  LocalCleanupQueueQuery,
  LocalCleanupStateInput,
} from "../shared/cleanup-contracts";

type WorkerCommand =
  | { command: "initialize"; dbPath: string }
  | { command: "state" }
  | { command: "import-first-movie"; rootPath: string }
  | { command: "import-video"; filePath: string; rootPath: string }
  | { command: "scan"; rootPath: string }
  | { command: "scan-directories"; sourceId: string; relativeDirectories: string[] }
  | { command: "list-scan-directories" }
  | { command: "cancel-scan"; scanId: string }
  | { command: "list"; query: LocalLibraryQuery }
  | { command: "list-collections"; query: LocalCollectionQuery }
  | { command: "get"; mediaId: string }
  | { command: "get-detail"; mediaId: string }
  | { command: "list-markers"; mediaId: string }
  | { command: "add-marker"; input: LocalMarkerInput }
  | { command: "delete-marker"; input: LocalMarkerDeleteInput }
  | { command: "list-continue-watching" }
  | { command: "remove-source"; sourceId: string }
  | { command: "source-root"; sourceId: string }
  | { command: "resolve-artwork"; mediaId: string; kind?: "poster" | "fanart" }
  | { command: "resolve-path"; mediaId: string }
  | { command: "get-playback"; mediaId: string }
  | { command: "save-playback"; state: LocalPlaybackState }
  | { command: "start-viewing-session"; session: LocalViewingSessionStartInput }
  | { command: "heartbeat-viewing-session"; heartbeat: LocalViewingSessionHeartbeatInput }
  | { command: "finish-viewing-session"; session: LocalViewingSessionFinishInput }
  | { command: "get-viewing-history"; mediaId: string }
  | { command: "list-cleanup-queue"; query: LocalCleanupQueueQuery; settings: CleanupSettings; nowMs: number }
  | { command: "set-cleanup-state"; input: LocalCleanupStateInput; nowMs: number; keepDays: number; snoozeDays: number }
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

interface WorkerEvent {
  event: "scan-progress";
  progress: LocalScanProgress;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface LocalLibraryDatabaseOptions {
  dbPath?: string;
  workerPath?: string;
  /**
   * Upper bound for one worker round trip. A wedged worker would otherwise keep
   * the renderer's busy state forever, so every call rejects with a stable error
   * instead of hanging. Whole-folder scans use the longer traversal bound.
   */
  callTimeoutMs?: number;
}

export class LocalLibraryDatabaseError extends Error {
  constructor(readonly code: WorkerFailure["error"]["code"], message: string) {
    super(message);
    this.name = "LocalLibraryDatabaseError";
  }
}

export class LocalLibraryDatabase {
  private static readonly DEFAULT_CALL_TIMEOUT_MS = 30_000;
  /**
   * A full-root traversal over a large library is not an ordinary round trip;
   * it gets its own upper bound so the ordinary timeout never kills a scan.
   */
  private static readonly SCAN_CALL_TIMEOUT_MS = 30 * 60_000;
  private readonly dbPath: string;
  private readonly workerPath: string;
  private readonly callTimeoutMs: number;
  private worker: UtilityProcess | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly stateListeners = new Set<(state: LocalLibraryState) => void>();
  private readonly scanListeners = new Set<(progress: LocalScanProgress) => void>();
  private state: LocalLibraryState = {
    status: "error",
    schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION,
    sqliteAvailable: false,
    sources: [],
  };
  private closing = false;
  /** Set once close() ran: a teardown kill must never look like a crash. */
  private closed = false;
  /** True after an unexpected worker exit; the next owner call may restart once. */
  private workerCrashed = false;
  private restartPromise: Promise<void> | undefined;

  constructor(options: LocalLibraryDatabaseOptions = {}) {
    this.dbPath = options.dbPath ?? join(process.cwd(), "local-library", "library.sqlite");
    this.workerPath = options.workerPath ?? join(__dirname, "local-library-worker.js");
    const requestedTimeout = options.callTimeoutMs;
    this.callTimeoutMs = typeof requestedTimeout === "number" && Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout
      : LocalLibraryDatabase.DEFAULT_CALL_TIMEOUT_MS;
  }

  async start(): Promise<LocalLibraryState> {
    if (this.closed) throw new LocalLibraryDatabaseError("storage", "本地片库 worker 已关闭");
    if (this.worker) return this.getState();
    await mkdir(dirname(this.dbPath), { recursive: true });
    const worker = utilityProcess.fork(this.workerPath, [], { serviceName: "z-video-local-library" });
    this.worker = worker;
    worker.on("message", (event) => {
      const payload = event && typeof event === "object" && ("id" in event || "event" in event)
        ? event
        : (event as unknown as { data?: unknown }).data;
      if (isWorkerEvent(payload)) {
        for (const listener of this.scanListeners) listener(payload.progress);
        return;
      }
      this.handleWorkerMessage(payload as WorkerSuccess | WorkerFailure);
    });
    worker.on("exit", (code) => this.handleWorkerExit(worker, code));
    worker.on("error", (type, location) => {
      void type;
      void location;
      if (this.closed || this.closing) return;
      this.failWorker(new LocalLibraryDatabaseError("sqlite-unavailable", localLibraryErrorMessage("sqlite-unavailable")));
    });
    try {
      const result = await this.call<{ schemaVersion: typeof LOCAL_LIBRARY_SCHEMA_VERSION; sqliteAvailable: true; sources: LocalLibraryState["sources"] }>({ command: "initialize", dbPath: this.dbPath });
      this.workerCrashed = false;
      this.state = { status: "ready", ...result };
      this.emitState();
      return this.getState();
    } catch (error) {
      // Ticket 20 / F-04: a worker that failed to initialize must not be reused.
      // It is discarded here so the next owner call performs one fresh
      // initialization instead of answering every request with "database not
      // initialized" while the renderer's retry appears to do nothing.
      this.workerCrashed = true;
      const worker = this.worker;
      this.worker = undefined;
      this.failPending(new LocalLibraryDatabaseError("storage", localLibraryErrorMessage("storage")));
      if (worker) {
        this.closing = true;
        worker.kill();
        this.closing = false;
      }
      this.state = {
        status: "error",
        schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION,
        sqliteAvailable: false,
        sources: [],
        error: {
          code: error instanceof LocalLibraryDatabaseError && error.code === "sqlite-unavailable" ? "sqlite-unavailable" : "storage",
          message: localLibraryErrorMessage(error instanceof LocalLibraryDatabaseError ? error.code : "storage", error instanceof Error ? error.message : undefined),
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

  onScanProgress(listener: (progress: LocalScanProgress) => void): () => void {
    this.scanListeners.add(listener);
    return () => this.scanListeners.delete(listener);
  }

  async refreshState(): Promise<LocalLibraryState> {
    const result = await this.call<{ schemaVersion: typeof LOCAL_LIBRARY_SCHEMA_VERSION; sqliteAvailable: true; sources: LocalLibraryState["sources"] }>({ command: "state" });
    this.state = { status: "ready", ...result };
    this.emitState();
    return this.getState();
  }

  async importFirstMovieInFolder(rootPath: string): Promise<LocalImportOutcome> {
    const result = await this.call<{ status: "imported" | "empty"; item?: LocalMediaItem }>({ command: "import-first-movie", rootPath }, LocalLibraryDatabase.SCAN_CALL_TIMEOUT_MS);
    const state = await this.refreshState();
    return result.status === "empty" || !result.item
      ? { status: "empty", state }
      : { status: "imported", item: result.item, state };
  }

  async importVideo(filePath: string, rootPath: string): Promise<LocalImportOutcome> {
    const result = await this.call<{ status: "imported"; item: LocalMediaItem }>({ command: "import-video", filePath, rootPath }, LocalLibraryDatabase.SCAN_CALL_TIMEOUT_MS);
    const state = await this.refreshState();
    return { status: "imported", item: result.item, state };
  }

  async scanFolder(rootPath: string): Promise<LocalScanResult> {
    const result = await this.call<LocalScanResult>({ command: "scan", rootPath }, LocalLibraryDatabase.SCAN_CALL_TIMEOUT_MS);
    await this.refreshState();
    return result;
  }

  /**
   * Rescan only the given source-relative directories of one registered source
   * (Ticket 23a). The traversal, NFO parsing and upsert are the ones the full
   * scan uses; missing-file detection only reaches the directories this run
   * proved complete, so rows elsewhere in the source are never touched. The
   * result carries the precise imported/updated/unchanged/removed comparison
   * and the NFO-only / fingerprint-change breakdown.
   *
   * An empty scope, a non-relative value, a value that escapes the source or a
   * directory that does not exist is rejected with `invalid-input` before any
   * library row or Scan run is written.
   */
  async scanDirectories(sourceId: string, relativeDirectories: readonly string[]): Promise<LocalDirectoryScanResult> {
    assertSourceId(sourceId);
    if (!Array.isArray(relativeDirectories) || relativeDirectories.length === 0) {
      throw new LocalLibraryDatabaseError("invalid-input", "至少需要一个相对目录");
    }
    for (const value of relativeDirectories) {
      if (normalizeScanRelativeDirectory(value) === undefined) {
        throw new LocalLibraryDatabaseError("invalid-input", "扫描目录必须是片库来源内的相对目录");
      }
    }
    const result = await this.call<LocalDirectoryScanResult>(
      { command: "scan-directories", sourceId, relativeDirectories: [...relativeDirectories] },
      LocalLibraryDatabase.SCAN_CALL_TIMEOUT_MS,
    );
    await this.refreshState();
    return result;
  }

  /**
   * The known-directory inventory used by the mtime coarse filter (Ticket 23b).
   * Derived from the stored rows: one entry per source with its root (`""`) and
   * every indexed Media file's parent directory. It carries source-relative
   * POSIX directories only, so no path reaches a renderer DTO.
   */
  async listScanDirectories(): Promise<LocalSourceDirectories[]> {
    return this.call<LocalSourceDirectories[]>({ command: "list-scan-directories" });
  }

  /** Rescan every registered folder in source order; one unreadable source never aborts the rest. */
  async rescanAll(): Promise<LocalScanResult[]> {

    const state = await this.refreshState();
    const results: LocalScanResult[] = [];
    for (const source of state.sources) {
      const rootPath = await this.sourceRoot(source.sourceId);
      if (!rootPath) continue;
      try {
        results.push(await this.scanFolder(rootPath));
      } catch (error) {
        results.push({
          scanId: "",
          sourceId: source.sourceId,
          sourceLabel: source.label,
          status: "unavailable",
          scannedFiles: 0,
          importedFiles: 0,
          updatedFiles: 0,
          warningCount: 0,
          warnings: [],
          counts: { imported: 0, updated: 0, unchanged: 0, removed: 0 },
          nfoUpdatedFiles: 0,
          fingerprintReplacedFiles: 0,
          error: localLibraryErrorMessage("storage", error instanceof Error ? error.message : undefined),
        });
      }
    }
    return results;
  }

  async cancelScan(scanId: string): Promise<boolean> {
    return this.call<boolean>({ command: "cancel-scan", scanId });
  }

  async list(query: LocalLibraryQuery): Promise<LocalLibraryPage> {
    const result = await this.call<{ totalCount: number; items: LocalMediaItem[] }>({ command: "list", query });
    return { query: { ...query }, page: query.page, pageSize: query.pageSize, ...result };
  }

  async listCollections(query: LocalCollectionQuery): Promise<LocalCollectionPage> {
    const result = await this.call<{ totalCount: number; items: LocalCollectionPage["items"] }>({ command: "list-collections", query });
    return { query: { ...query }, page: query.page, pageSize: query.pageSize, ...result };
  }

  async get(mediaId: string): Promise<LocalMediaItem | undefined> {
    assertMediaId(mediaId);
    return this.call<LocalMediaItem | undefined>({ command: "get", mediaId });
  }

  async getDetail(mediaId: string): Promise<LocalMediaDetail | undefined> {
    assertMediaId(mediaId);
    return this.call<LocalMediaDetail | undefined>({ command: "get-detail", mediaId });
  }

  async listMarkers(mediaId: string): Promise<LocalMarker[]> {
    assertMediaId(mediaId);
    return this.call<LocalMarker[]>({ command: "list-markers", mediaId });
  }

  async addMarker(input: LocalMarkerInput): Promise<LocalMarker> {
    assertMediaId(input.mediaId);
    return this.call<LocalMarker>({ command: "add-marker", input });
  }

  async removeMarker(input: LocalMarkerDeleteInput): Promise<boolean> {
    assertMediaId(input.mediaId);
    return this.call<boolean>({ command: "delete-marker", input });
  }

  async listContinueWatching(): Promise<LocalContinueWatchingItem[]> {
    return this.call<LocalContinueWatchingItem[]>({ command: "list-continue-watching" });
  }

  async removeSource(sourceId: string): Promise<LocalLibraryState> {
    assertSourceId(sourceId);
    await this.call<boolean>({ command: "remove-source", sourceId });
    return this.refreshState();
  }

  async sourceRoot(sourceId: string): Promise<string | undefined> {
    assertSourceId(sourceId);
    return this.call<string | undefined>({ command: "source-root", sourceId });
  }

  async resolveArtwork(mediaId: string, kind?: "poster" | "fanart"): Promise<{ path: string; cacheKey: string; kind: "poster" | "fanart" } | undefined> {
    assertMediaId(mediaId);
    return this.call<{ path: string; cacheKey: string; kind: "poster" | "fanart" } | undefined>({ command: "resolve-artwork", mediaId, ...(kind ? { kind } : {}) });
  }

  /** Main-only path resolution for the future playback owner; never expose through preload. */
  async resolveMediaPath(mediaId: string): Promise<string | undefined> {
    assertMediaId(mediaId);
    return this.call<string | undefined>({ command: "resolve-path", mediaId });
  }

  async resolveMedia(mediaId: string): Promise<string | undefined> {
    return this.resolveMediaPath(mediaId);
  }

  async getPlayback(mediaId: string): Promise<LocalPlaybackState | undefined> {
    assertMediaId(mediaId);
    return this.call<LocalPlaybackState | undefined>({ command: "get-playback", mediaId });
  }

  async savePlayback(state: LocalPlaybackState): Promise<LocalPlaybackState>;
  async savePlayback(mediaId: string, state: LocalPlaybackUpdate): Promise<LocalPlaybackState>;
  async savePlayback(stateOrMediaId: LocalPlaybackState | string, update?: LocalPlaybackUpdate): Promise<LocalPlaybackState> {
    let state: LocalPlaybackState;
    if (typeof stateOrMediaId === "string") {
      assertMediaId(stateOrMediaId);
      state = { ...update, mediaId: stateOrMediaId, updatedAtMs: update?.updatedAtMs ?? Date.now(), watched: update?.watched ?? false, positionSec: update?.positionSec ?? 0 };
    } else {
      state = stateOrMediaId;
    }
    assertMediaId(state.mediaId);
    return this.call<LocalPlaybackState>({ command: "save-playback", state });
  }

  async startViewingSession(session: LocalViewingSessionStartInput): Promise<{ sessionId: string }> {
    assertMediaId(session.mediaId);
    return this.call<{ sessionId: string }>({ command: "start-viewing-session", session });
  }

  async heartbeatViewingSession(heartbeat: LocalViewingSessionHeartbeatInput): Promise<void> {
    assertSessionId(heartbeat.sessionId);
    await this.call<boolean>({ command: "heartbeat-viewing-session", heartbeat });
  }

  async finishViewingSession(session: LocalViewingSessionFinishInput): Promise<LocalViewingHistory | undefined> {
    assertSessionId(session.sessionId);
    assertMediaId(session.mediaId);
    return this.call<LocalViewingHistory | undefined>({ command: "finish-viewing-session", session });
  }

  async getViewingHistory(mediaId: string): Promise<LocalViewingHistory | undefined> {
    assertMediaId(mediaId);
    return this.call<LocalViewingHistory | undefined>({ command: "get-viewing-history", mediaId });
  }

  async listCleanupQueue(query: LocalCleanupQueueQuery, settings: CleanupSettings, nowMs = Date.now()): Promise<LocalCleanupQueue> {
    return this.call<LocalCleanupQueue>({ command: "list-cleanup-queue", query, settings, nowMs });
  }

  async setCleanupState(input: LocalCleanupStateInput, keepDays: number, snoozeDays: number, nowMs = Date.now()): Promise<void> {
    assertMediaId(input.mediaId);
    await this.call<boolean>({ command: "set-cleanup-state", input, nowMs, keepDays, snoozeDays });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    // No automatic restart may race a teardown.
    this.closed = true;
    const worker = this.worker;
    if (!worker) return;
    this.closing = true;
    try {
      await this.call({ command: "close" });
    } catch {
      // A worker that already died needs no orderly shutdown; teardown below
      // still runs and no caller-visible state is lost.
    } finally {
      worker.kill();
      if (this.worker === worker) this.worker = undefined;
      this.failPending(new LocalLibraryDatabaseError("storage", "本地片库 worker 已关闭"));
      this.closing = false;
    }
  }

  /**
   * Dispatch one command with a bounded wait. A worker that never answers (or a
   * dropped reply) rejects with a stable error so the renderer's busy state ends
   * instead of waiting forever.
   */
  private async call<T>(command: WorkerCommand, timeoutMs = this.callTimeoutMs): Promise<T> {
    const worker = await this.ensureWorker();
    if (!worker) throw new LocalLibraryDatabaseError("sqlite-unavailable", localLibraryErrorMessage("sqlite-unavailable"));
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new LocalLibraryDatabaseError("sqlite-unavailable", localLibraryErrorMessage("sqlite-unavailable")));
      }, Math.max(1, timeoutMs));
      // A pending request must not keep the process alive on its own.
      (timer as unknown as { unref?: () => void }).unref?.();
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value as T); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      try {
        worker.postMessage({ id, ...command });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new LocalLibraryDatabaseError("sqlite-unavailable", localLibraryErrorMessage("sqlite-unavailable", error instanceof Error ? error.message : undefined)));
      }
    });
  }

  /**
   * After an unexpected worker exit — or a failed initialization, which discards
   * the half-started worker — the next owner operation performs exactly one
   * controlled restart. This is also the retry path behind the renderer's error
   * card: an owner call re-runs initialization instead of reusing a process that
   * never opened the database. A successful start restores `ready`; a failed one
   * keeps the error state visible and reports it through `onState`.
   */
  private async ensureWorker(): Promise<UtilityProcess | undefined> {
    if (this.worker) return this.worker;
    if (this.closed || this.closing || !this.workerCrashed) return undefined;
    if (!this.restartPromise) {
      this.restartPromise = this.start().then(
        () => undefined,
        () => undefined,
      ).finally(() => { this.restartPromise = undefined; });
    }
    await this.restartPromise;
    return this.worker;
  }

  private handleWorkerMessage(message: WorkerSuccess | WorkerFailure): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new LocalLibraryDatabaseError(message.error.code, localLibraryErrorMessage(message.error.code, message.error.message)));
  }

  private handleWorkerExit(worker: UtilityProcess, code: number): void {
    void code;
    // A late exit from an already replaced worker must not clear the new one.
    if (this.worker !== worker) return;
    this.worker = undefined;
    if (this.closed || this.closing) return;
    // Any unexpected exit — including a zero exit code — leaves the owner
    // unusable. Pending calls must reject and the state must stop claiming
    // `ready` so the renderer can show an actionable error.
    this.workerCrashed = true;
    this.failWorker(new LocalLibraryDatabaseError("sqlite-unavailable", localLibraryErrorMessage("sqlite-unavailable")));
  }

  /** Reject every pending call and publish a stable error state. */
  private failWorker(error: LocalLibraryDatabaseError): void {
    this.failPending(error);
    this.state = {
      status: "error",
      schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION,
      sqliteAvailable: false,
      sources: [],
      error: {
        code: error.code === "sqlite-unavailable" ? "sqlite-unavailable" : "storage",
        message: localLibraryErrorMessage(error.code === "sqlite-unavailable" ? "sqlite-unavailable" : "storage", error.message),
      },
    };
    this.emitState();
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

function isWorkerEvent(value: unknown): value is WorkerEvent {
  return Boolean(value && typeof value === "object" && (value as { event?: unknown }).event === "scan-progress");
}

function assertMediaId(mediaId: string): asserts mediaId is `media_${string}` {
  if (!isOpaqueMediaId(mediaId)) throw new LocalLibraryDatabaseError("invalid-input", "mediaId 格式无效");
}

function assertSourceId(sourceId: string): asserts sourceId is `source_${string}` {
  if (typeof sourceId !== "string" || !/^source_[0-9a-f-]{36}$/i.test(sourceId)) throw new LocalLibraryDatabaseError("invalid-input", "sourceId 格式无效");
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || !/^session_[0-9a-f-]{36}$/i.test(sessionId)) throw new LocalLibraryDatabaseError("invalid-input", "sessionId 格式无效");
}
