import { dialog, ipcMain, type BrowserWindow } from "electron";
import { dirname } from "node:path";

import {
  isOpaqueMediaId,
  type LocalLibraryQuery,
} from "../shared/local-library-contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { recordUiOperation } from "./diagnostics";
import { localLibraryErrorCode, localLibraryErrorMessage } from "./local-library-errors";
import { LocalLibraryDatabase } from "./local-library-database";
import { LocalArtworkCache } from "./local-artwork-cache";

export function registerLocalLibraryIpcHandlers(database: LocalLibraryDatabase, window: BrowserWindow, artworkCache: LocalArtworkCache): () => void {
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
  ipcMain.handle(IPC_CHANNELS.localLibraryList, (_event, value: unknown) => withUiOperation("local-library.list", async () => ({
    state: database.getState(),
    page: await database.list(parseLocalLibraryQuery(value)),
  })));
  ipcMain.handle(IPC_CHANNELS.localLibraryGet, (_event, value: unknown) => withUiOperation("local-library.get", async () => {
    const mediaId = parseMediaId(value);
    const detail = await database.getDetail(mediaId);
    return { state: database.getState(), detail, ...(detail ? { item: detail.item } : {}) };
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryContinueWatching, (_event) => withUiOperation("local-library.continue-watching", async () => ({
    state: database.getState(),
    items: await database.listContinueWatching(),
  })));
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
  ipcMain.handle(IPC_CHANNELS.localLibraryScan, () => withUiOperation("local-library.scan", async () => {
    const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    if (selection.canceled || !selection.filePaths[0]) return { status: "cancelled", scanId: "scan_00000000-0000-4000-8000-000000000000", sourceId: "", scannedFiles: 0, importedFiles: 0, updatedFiles: 0, warningCount: 0, warnings: [], error: "已取消选择片库目录" } as const;
    return database.scanFolder(selection.filePaths[0]);
  }));
  ipcMain.handle(IPC_CHANNELS.localLibraryCancelScan, (_event, value: unknown) => withUiOperation("local-library.scan-cancel", async () => {
    if (!isScanId(value)) throw new Error("scanId 格式无效");
    return database.cancelScan(value);
  }));
  return () => {
    unsubscribe();
    unsubscribeScan();
    for (const channel of [
      IPC_CHANNELS.localLibraryState,
      IPC_CHANNELS.localLibraryChooseFolder,
      IPC_CHANNELS.localLibraryOpenVideo,
      IPC_CHANNELS.localLibraryList,
      IPC_CHANNELS.localLibraryGet,
      IPC_CHANNELS.localLibraryArtwork,
      IPC_CHANNELS.localLibraryContinueWatching,
      IPC_CHANNELS.localLibraryRemoveSource,
      IPC_CHANNELS.localLibraryRefreshSource,
      IPC_CHANNELS.localLibraryScan,
      IPC_CHANNELS.localLibraryCancelScan,
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
  const sorts = new Set(["recent", "title", "year_desc", "score_desc", "added_desc"]);
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

function parseMediaId(value: unknown): string {
  if (!isOpaqueMediaId(value)) throw new Error("mediaId 格式无效");
  return value;
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
