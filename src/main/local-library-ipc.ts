import { dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { dirname } from "node:path";

import {
  isLocalRefreshTrigger,
  isMarkerDurationSec,
  isMarkerPositionSec,
  isOpaqueMediaId,
  type LocalLibraryQuery,
  type LocalCollectionQuery,
  type LocalMarkerDeleteInput,
  type LocalMarkerInput,
} from "../shared/local-library-contracts";
import {
  isCleanupRuleId,
  isCleanupState,
  type LocalCleanupQueueQuery,
  type LocalCleanupStateInput,
} from "../shared/cleanup-contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { recordUiOperation } from "./diagnostics";
import { localLibraryErrorCode, localLibraryErrorMessage } from "./local-library-errors";
import { LocalLibraryDatabase } from "./local-library-database";
import { LocalArtworkCache } from "./local-artwork-cache";
import type { LocalLibraryRefreshScheduler } from "./local-library-refresh";
import type { LocalWatchSyncPort } from "./local-library-watch";
import type { AppPreferencesStore } from "./app-preferences";

/**
 * Ticket 23b: `refresh` owns the mtime coarse filter behind window focus/return.
 * Every manual scan, import and source removal runs through its single-flight
 * gate so an automatic check waits instead of starting a second scan; after the
 * operation finishes, the directory baseline is recorded while the gate is
 * still held, so the next automatic check compares against what this run wrote.
 *
 * Ticket 24a: `watch` keeps one local filesystem watch per registered Source.
 * A folder add/remove re-syncs it, and a focus is the retry point for a Source
 * whose watch was unavailable (removed share, unplugged drive).
 */
export function registerLocalLibraryIpcHandlers(database: LocalLibraryDatabase, window: BrowserWindow, artworkCache: LocalArtworkCache, preferences: AppPreferencesStore, refresh?: LocalLibraryRefreshScheduler, watch?: LocalWatchSyncPort): () => void {
  const sendToWindow = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
  };
  const unsubscribe = database.onState((state) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.localLibraryState, state);
  });
  const unsubscribeScan = database.onScanProgress((progress) => {
    // Ticket 23b: an automatic refresh is silent. Its directory rescan must not
    // flash the scan pill or raise a completion notice; only the pushed result
    // reaches the renderer.
    if (refresh?.isAutomaticScanActive()) return;
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.localLibraryScanProgress, progress);
  });
  const unsubscribeRefresh = refresh?.onResult((result) => sendToWindow(IPC_CHANNELS.localLibraryRefreshResult, result));
  /** Wrap one owner operation so its post-run baseline is recorded while the gate is held. */
  const withBaseline = <T>(task: () => Promise<T>, sourceIds: (result: T) => readonly string[]): (() => Promise<T>) => async () => {
    const result = await task();
    const ids = sourceIds(result);
    if (refresh && ids.length > 0) await refresh.recordBaselineForSources(ids);
    // Ticket 24a: a scan can register a new Source (or prove an offline one back),
    // so the watch set is reconciled while the owner is still gated.
    if (watch) await watch.sync();
    return result;
  };
  /** A scanning operation: it enters the shared scan queue and records its baseline. */
  const scanAndRecord = <T>(task: () => Promise<T>, sourceIds: (result: T) => readonly string[]): Promise<T> => {
    const work = withBaseline(task, sourceIds);
    return refresh ? refresh.runScan(work) : work();
  };
  /** A single-file import: it never overlaps an automatic check, but keeps the worker's import-during-scan rejection. */
  const importAndRecord = <T>(task: () => Promise<T>, sourceIds: (result: T) => readonly string[]): Promise<T> => {
    const work = withBaseline(task, sourceIds);
    return refresh ? refresh.runExclusiveOperation(work) : work();
  };
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => refresh ? refresh.runExclusiveOperation(task) : task();
  ipcMain.handle(IPC_CHANNELS.localLibraryState, () => database.getState());
  ipcMain.handle(IPC_CHANNELS.localLibraryChooseFolder, () => withUiOperation("local-library.choose-folder", async () => {
    const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] });
    if (selection.canceled || !selection.filePaths[0]) return {
      status: "cancelled",
      scanId: "scan_00000000-0000-4000-8000-000000000000",
      sourceId: "",
      scannedFiles: 0,
      importedFiles: 0,
      updatedFiles: 0,
      warningCount: 0,
      warnings: [],
      error: "已取消选择片库目录",
    } as const;
    return scanAndRecord(() => database.scanFolder(selection.filePaths[0]), (result) => result.status === "cancelled" ? [] : [result.sourceId]);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryOpenVideo, () => withUiOperation("local-library.open-video", async () => {
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [{ name: "视频", extensions: ["mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "m2ts"] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return { status: "cancelled", state: database.getState() } as const;
    const filePath = selection.filePaths[0];
    return importAndRecord(() => database.importVideo(filePath, dirname(filePath)), (outcome) => outcome.status === "imported" ? [outcome.item.sourceId] : []);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryList, (_event, value: unknown) => withUiOperation("local-library.list", async () => {
    const page = await database.list(parseLocalLibraryQuery(value));
    // State is read after the page so scan-time queries include committed rows
    // and their current source summary without refreshing on every progress event.
    return { state: await database.refreshState(), page };
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryListCollections, (_event, value: unknown) => withUiOperation("local-library.list-collections", async () => {
    const page = await database.listCollections(parseLocalCollectionQuery(value));
    return { state: await database.refreshState(), page };
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryGet, (_event, value: unknown) => withUiOperation("local-library.get", async () => {
    const mediaId = parseMediaId(value);
    const detail = await database.getDetail(mediaId);
    return { state: database.getState(), detail, ...(detail ? { item: detail.item } : {}) };
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryContinueWatching, (_event) => withUiOperation("local-library.continue-watching", async () => ({
    state: database.getState(),
    items: await database.listContinueWatching(),
  })));
  ipcMain.handle(IPC_CHANNELS.localLibraryMarkersList, (_event, value: unknown) => withUiOperation("local-library.markers-list", async () => {
    const mediaId = parseMediaId(value);
    return database.listMarkers(mediaId);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryMarkersAdd, (_event, value: unknown) => withUiOperation("local-library.markers-add", async () => {
    const input = parseMarkerInput(value);
    return database.addMarker(input);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryMarkersRemove, (_event, value: unknown) => withUiOperation("local-library.markers-remove", async () => {
    const input = parseMarkerDeleteInput(value);
    return database.removeMarker(input);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryArtwork, (_event, value: unknown) => withUiOperation("local-library.artwork", async () => {
    const input = parseArtworkInput(value);
    const artwork = await database.resolveArtwork(input.mediaId, input.kind);
    if (!artwork) return { state: database.getState() };
    const image = await artworkCache.load(artwork.cacheKey, artwork.path);
    return image ? { state: database.getState(), ...image } : { state: database.getState() };
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryRemoveSource, (_event, value: unknown) => withUiOperation("local-library.source-remove", async () => {
    const sourceId = parseSourceId(value);
    return exclusive(async () => {
      const state = await database.removeSource(sourceId);
      // Ticket 24a: a removed Source must not keep a live recursive watch.
      if (watch) {
        watch.forgetSources([sourceId]);
        await watch.sync();
      }
      return state;
    });
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryRefreshSource, (_event, value: unknown) => withUiOperation("local-library.source-refresh", async () => {
    const sourceId = parseSourceId(value);
    const rootPath = await database.sourceRoot(sourceId);
    if (!rootPath) throw new Error("本地片库来源不存在");
    return scanAndRecord(() => database.scanFolder(rootPath), (result) => result.status === "cancelled" ? [] : [result.sourceId]);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryRescanAll, () => withUiOperation("local-library.rescan-all", () => scanAndRecord(
    () => database.rescanAll(),
    // Ticket 37 / B-05: a cancelled folder was not read completely, so recording
    // its directory baseline would hide changes made during the interrupted run
    // from the next automatic check. Mirrors the single-folder scan's rule.
    (results) => results.filter((result) => result.sourceId && result.status !== "cancelled").map((result) => result.sourceId),
  )));
  ipcMain.handle(IPC_CHANNELS.localLibraryScan, () => withUiOperation("local-library.scan", async () => {
    const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    if (selection.canceled || !selection.filePaths[0]) return { status: "cancelled", scanId: "scan_00000000-0000-4000-8000-000000000000", sourceId: "", scannedFiles: 0, importedFiles: 0, updatedFiles: 0, warningCount: 0, warnings: [], error: "已取消选择片库目录" } as const;
    return scanAndRecord(() => database.scanFolder(selection.filePaths[0]), (result) => result.status === "cancelled" ? [] : [result.sourceId]);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryRefreshCheck, (_event, value: unknown) => withUiOperation("local-library.refresh-check", async () => {
    if (!isLocalRefreshTrigger(value)) throw new Error("刷新触发类型无效");
    if (!refresh) return { status: "unchanged" } as const;
    // A window focus is throttled so flicking between windows does not restat
    // the library; a return from detail/player is a deliberate surface change
    // and runs one check immediately.
    const outcome = await refresh.request(value, { force: value === "return" });
    // Ticket 24a: focus is also the retry point for a Source whose watch was
    // unavailable (removed share, unplugged drive) or that was just registered.
    // It stays fire-and-forget: the renderer's answer never waits for a watch.
    void watch?.sync();
    return outcome;
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryCancelScan, (_event, value: unknown) => withUiOperation("local-library.scan-cancel", async () => {
    if (!isScanId(value)) throw new Error("scanId 格式无效");
    return database.cancelScan(value);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryCleanupQueue, (_event, value: unknown) => withUiOperation("local-library.cleanup-queue", async () => {
    const query = parseCleanupQuery(value);
    const settings = preferences.get().cleanup;
    const queue = await database.listCleanupQueue(query, settings);
    return { state: database.getState(), queue };
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryCleanupSetState, (_event, value: unknown) => withUiOperation("local-library.cleanup-set-state", async () => {
    const input = parseCleanupStateInput(value);
    const settings = preferences.get().cleanup;
    await database.setCleanupState(input, settings.keepDays, settings.snoozeDays);
    const queue = await database.listCleanupQueue({ page: 1, pageSize: 50, rule: "all", state: "none" }, settings);
    return { state: database.getState(), queue };
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryCleanupReveal, (_event, value: unknown) => withUiOperation("local-library.cleanup-reveal", async () => {
    const mediaId = parseMediaId(value);
    const filePath = await database.resolveMediaPath(mediaId);
    if (!filePath) return { revealed: false };
    // Main resolves the private path; the renderer only learns whether Explorer opened.
    shell.showItemInFolder(filePath);
    return { revealed: true };
  }));
  return () => {
    unsubscribe();
    unsubscribeScan();
    unsubscribeRefresh?.();
    for (const channel of [
      IPC_CHANNELS.localLibraryState,
      IPC_CHANNELS.localLibraryChooseFolder,
      IPC_CHANNELS.localLibraryOpenVideo,
      IPC_CHANNELS.localLibraryList,
      IPC_CHANNELS.localLibraryListCollections,
      IPC_CHANNELS.localLibraryGet,
      IPC_CHANNELS.localLibraryMarkersList,
      IPC_CHANNELS.localLibraryMarkersAdd,
      IPC_CHANNELS.localLibraryMarkersRemove,
      IPC_CHANNELS.localLibraryArtwork,
      IPC_CHANNELS.localLibraryContinueWatching,
      IPC_CHANNELS.localLibraryRemoveSource,
      IPC_CHANNELS.localLibraryRefreshSource,
      IPC_CHANNELS.localLibraryRescanAll,
      IPC_CHANNELS.localLibraryScan,
      IPC_CHANNELS.localLibraryCancelScan,
      IPC_CHANNELS.localLibraryRefreshCheck,
      IPC_CHANNELS.localLibraryCleanupQueue,
      IPC_CHANNELS.localLibraryCleanupSetState,
      IPC_CHANNELS.localLibraryCleanupReveal,
    ]) ipcMain.removeHandler(channel);
  };
}

function isScanId(value: unknown): value is string {
  return typeof value === "string" && /^scan_[0-9a-f-]{36}$/i.test(value);
}

function parseLocalLibraryQuery(value: unknown): LocalLibraryQuery {
  if (value === undefined || value === null) return { page: 1, pageSize: 50 };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本地片库查询参数格式无效");
  const record = value as Record<string, unknown>;
  const page = record.page === undefined ? 1 : parseInteger(record.page, "页码");
  const pageSize = record.pageSize === undefined ? 50 : parseInteger(record.pageSize, "分页大小");
  if (page < 1 || pageSize < 1 || pageSize > 100) throw new Error("本地片库分页参数无效");
  if (record.query !== undefined && record.query !== null && typeof record.query !== "string") throw new Error("本地片库搜索词格式无效");
  const filters = new Set(["all", "movie", "show", "episode", "unclassified"]);
  const sorts = new Set(["recent", "title", "year_desc", "score_desc", "added_desc", "released_desc"]);
  if (record.filter !== undefined && (!filters.has(String(record.filter)))) throw new Error("本地片库筛选条件无效");
  if (record.sort !== undefined && (!sorts.has(String(record.sort)))) throw new Error("本地片库排序条件无效");
  if (record.sourceId !== undefined && (typeof record.sourceId !== "string" || !/^source_[0-9a-f-]{36}$/i.test(record.sourceId))) throw new Error("本地片库来源格式无效");
  return {
    page,
    pageSize,
    ...(typeof record.query === "string" && record.query.trim() ? { query: record.query.trim().slice(0, 200) } : {}),
    ...(typeof record.filter === "string" ? { filter: record.filter as LocalLibraryQuery["filter"] } : {}),
    ...(typeof record.sort === "string" ? { sort: record.sort as LocalLibraryQuery["sort"] } : {}),
    ...(typeof record.sourceId === "string" ? { sourceId: record.sourceId } : {}),
  };
}

function parseLocalCollectionQuery(value: unknown): LocalCollectionQuery {
  if (value === undefined || value === null) return { page: 1, pageSize: 50 };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("作品查询参数格式无效");
  const record = value as Record<string, unknown>;
  const page = record.page === undefined ? 1 : parseInteger(record.page, "页码");
  const pageSize = record.pageSize === undefined ? 50 : parseInteger(record.pageSize, "分页大小");
  if (page < 1 || pageSize < 1 || pageSize > 100) throw new Error("作品分页参数无效");
  if (record.query !== undefined && record.query !== null && typeof record.query !== "string") throw new Error("作品搜索词格式无效");
  const filters = new Set(["all", "movie", "show", "unclassified"]);
  const sorts = new Set(["recent", "title", "year_desc", "score_desc", "added_desc", "released_desc"]);
  if (record.filter !== undefined && (!filters.has(String(record.filter)))) throw new Error("作品筛选条件无效");
  if (record.sort !== undefined && (!sorts.has(String(record.sort)))) throw new Error("作品排序条件无效");
  if (record.sourceId !== undefined && (typeof record.sourceId !== "string" || !/^source_[0-9a-f-]{36}$/i.test(record.sourceId))) throw new Error("作品来源格式无效");
  return {
    page,
    pageSize,
    ...(typeof record.query === "string" && record.query.trim() ? { query: record.query.trim().slice(0, 200) } : {}),
    ...(typeof record.filter === "string" ? { filter: record.filter as LocalCollectionQuery["filter"] } : {}),
    ...(typeof record.sort === "string" ? { sort: record.sort as LocalCollectionQuery["sort"] } : {}),
    ...(typeof record.sourceId === "string" ? { sourceId: record.sourceId } : {}),
  };
}

function parseMediaId(value: unknown): string {
  if (!isOpaqueMediaId(value)) throw new Error("mediaId 格式无效");
  return value;
}

/**
 * Marker input validation at the main boundary. The worker re-checks the same
 * rules against the database (media existence, known duration), so a malformed
 * renderer value never reaches SQLite and is never clamped into range.
 */
function parseMarkerInput(value: unknown): LocalMarkerInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("标记参数格式无效");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["mediaId", "positionSec", "durationSec"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("标记字段无效");
  const mediaId = parseMediaId(record.mediaId);
  if (!isMarkerPositionSec(record.positionSec)) throw new Error("标记位置必须是有效的整秒数");
  if (record.durationSec !== undefined && !isMarkerDurationSec(record.durationSec)) throw new Error("媒体时长无效");
  return {
    mediaId: mediaId as `media_${string}`,
    positionSec: record.positionSec,
    ...(record.durationSec === undefined ? {} : { durationSec: record.durationSec }),
  };
}

/**
 * Ticket 22b delete input: only the opaque id and whole-second position. The
 * worker re-checks the same opaque-id/position rules, so a malformed renderer
 * value never reaches SQLite and no duration bound is needed to remove a marker.
 */
function parseMarkerDeleteInput(value: unknown): LocalMarkerDeleteInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("标记参数格式无效");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["mediaId", "positionSec"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("标记字段无效");
  const mediaId = parseMediaId(record.mediaId);
  if (!isMarkerPositionSec(record.positionSec)) throw new Error("标记位置必须是有效的整秒数");
  return { mediaId: mediaId as `media_${string}`, positionSec: record.positionSec };
}

function parseCleanupQuery(value: unknown): LocalCleanupQueueQuery {
  if (value === undefined || value === null) return { page: 1, pageSize: 50, rule: "all", state: "none" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("整理查询参数格式无效");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["page", "pageSize", "rule", "state"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("整理查询字段无效");
  const page = record.page === undefined ? 1 : parseInteger(record.page, "页码");
  const pageSize = record.pageSize === undefined ? 50 : parseInteger(record.pageSize, "分页大小");
  if (page < 1 || pageSize < 1 || pageSize > 100) throw new Error("整理分页参数无效");
  if (record.rule !== undefined && record.rule !== "all" && !isCleanupRuleId(record.rule)) throw new Error("整理规则筛选无效");
  if (record.state !== undefined && !isCleanupState(record.state)) throw new Error("整理状态筛选无效");
  return {
    page,
    pageSize,
    rule: record.rule === undefined ? "all" : record.rule as LocalCleanupQueueQuery["rule"],
    state: record.state === undefined ? "none" : record.state,
  };
}

function parseCleanupStateInput(value: unknown): LocalCleanupStateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("整理标记参数格式无效");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["mediaId", "state"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("整理标记字段无效");
  const mediaId = parseMediaId(record.mediaId);
  if (!isCleanupState(record.state)) throw new Error("整理标记状态无效");
  return { mediaId: mediaId as `media_${string}`, state: record.state };
}

function parseSourceId(value: unknown): string {
  if (typeof value !== "string" || !/^source_[0-9a-f-]{36}$/i.test(value)) throw new Error("sourceId 格式无效");
  return value;
}

function parseArtworkInput(value: unknown): { mediaId: string; kind?: "poster" | "fanart" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("artwork 参数格式无效");
  const record = value as Record<string, unknown>;
  const mediaId = parseMediaId(record.mediaId);
  if (record.kind !== undefined && record.kind !== "poster" && record.kind !== "fanart") throw new Error("artwork 类型无效");
  return { mediaId, ...(record.kind ? { kind: record.kind } : {}) };
}

function parseInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${label}必须是整数`);
  return value;
}

async function withUiOperation<T>(operation: string, action: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await action();
    await recordUiOperation(operation, "success", startedAt);
    return result;
  } catch (error) {
    await recordUiOperation(operation, "error", startedAt, { errorKind: error instanceof Error ? error.name : "unknown" });
    const code = localLibraryErrorCode(error);
    throw new Error(localLibraryErrorMessage(code, error instanceof Error ? error.message : undefined));
  }
}
