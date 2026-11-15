import { dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { dirname } from "node:path";

import {
  isMarkerDurationSec,
  isMarkerPositionSec,
  isOpaqueMediaId,
  type LocalLibraryQuery,
  type LocalCollectionQuery,
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
import type { AppPreferencesStore } from "./app-preferences";

export function registerLocalLibraryIpcHandlers(database: LocalLibraryDatabase, window: BrowserWindow, artworkCache: LocalArtworkCache, preferences: AppPreferencesStore): () => void {
  const unsubscribe = database.onState((state) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.localLibraryState, state);
  });
  const unsubscribeScan = database.onScanProgress((progress) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.localLibraryScanProgress, progress);
  });
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
    return database.scanFolder(selection.filePaths[0]);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryOpenVideo, () => withUiOperation("local-library.open-video", async () => {
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [{ name: "视频", extensions: ["mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "m2ts"] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return { status: "cancelled", state: database.getState() } as const;
    const filePath = selection.filePaths[0];
    return database.importVideo(filePath, dirname(filePath));
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
  ipcMain.handle(IPC_CHANNELS.localLibraryArtwork, (_event, value: unknown) => withUiOperation("local-library.artwork", async () => {
    const input = parseArtworkInput(value);
    const artwork = await database.resolveArtwork(input.mediaId, input.kind);
    if (!artwork) return { state: database.getState() };
    const image = await artworkCache.load(artwork.cacheKey, artwork.path);
    return image ? { state: database.getState(), ...image } : { state: database.getState() };
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryRemoveSource, (_event, value: unknown) => withUiOperation("local-library.source-remove", async () => {
    const sourceId = parseSourceId(value);
    return database.removeSource(sourceId);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryRefreshSource, (_event, value: unknown) => withUiOperation("local-library.source-refresh", async () => {
    const sourceId = parseSourceId(value);
    const rootPath = await database.sourceRoot(sourceId);
    if (!rootPath) throw new Error("本地片库来源不存在");
    return database.scanFolder(rootPath);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryRescanAll, () => withUiOperation("local-library.rescan-all", () => database.rescanAll()));
  ipcMain.handle(IPC_CHANNELS.localLibraryScan, () => withUiOperation("local-library.scan", async () => {
    const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    if (selection.canceled || !selection.filePaths[0]) return { status: "cancelled", scanId: "scan_00000000-0000-4000-8000-000000000000", sourceId: "", scannedFiles: 0, importedFiles: 0, updatedFiles: 0, warningCount: 0, warnings: [], error: "已取消选择片库目录" } as const;
    return database.scanFolder(selection.filePaths[0]);
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
    for (const channel of [
      IPC_CHANNELS.localLibraryState,
      IPC_CHANNELS.localLibraryChooseFolder,
      IPC_CHANNELS.localLibraryOpenVideo,
      IPC_CHANNELS.localLibraryList,
      IPC_CHANNELS.localLibraryListCollections,
      IPC_CHANNELS.localLibraryGet,
      IPC_CHANNELS.localLibraryMarkersList,
      IPC_CHANNELS.localLibraryMarkersAdd,
      IPC_CHANNELS.localLibraryArtwork,
      IPC_CHANNELS.localLibraryContinueWatching,
      IPC_CHANNELS.localLibraryRemoveSource,
      IPC_CHANNELS.localLibraryRefreshSource,
      IPC_CHANNELS.localLibraryRescanAll,
      IPC_CHANNELS.localLibraryScan,
      IPC_CHANNELS.localLibraryCancelScan,
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
