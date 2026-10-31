import { dialog, ipcMain, type BrowserWindow } from "electron";
import { dirname } from "node:path";

import {
  isOpaqueMediaId,
  type LocalLibraryQuery,
} from "../shared/local-library-contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { recordUiOperation } from "./diagnostics";
import { LocalLibraryDatabase } from "./local-library-database";

export function registerLocalLibraryIpcHandlers(database: LocalLibraryDatabase, window: BrowserWindow): () => void {
  const unsubscribe = database.onState((state) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.localLibraryState, state);
  });
  ipcMain.handle(IPC_CHANNELS.localLibraryState, () => database.getState());
  ipcMain.handle(IPC_CHANNELS.localLibraryChooseFolder, () => withUiOperation("local-library.choose-folder", async () => {
    const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] });
    if (selection.canceled || !selection.filePaths[0]) return { status: "cancelled", state: database.getState() } as const;
    return database.importFirstMovieInFolder(selection.filePaths[0]);
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
    return { state: database.getState(), item: await database.get(mediaId) };
  }));
  return () => {
    unsubscribe();
    for (const channel of [
      IPC_CHANNELS.localLibraryState,
      IPC_CHANNELS.localLibraryChooseFolder,
      IPC_CHANNELS.localLibraryOpenVideo,
      IPC_CHANNELS.localLibraryList,
      IPC_CHANNELS.localLibraryGet,
    ]) ipcMain.removeHandler(channel);
  };
}

function parseLocalLibraryQuery(value: unknown): LocalLibraryQuery {
  if (value === undefined || value === null) return { page: 1, pageSize: 50 };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本地片库查询参数格式无效");
  const record = value as Record<string, unknown>;
  const page = record.page === undefined ? 1 : parseInteger(record.page, "页码");
  const pageSize = record.pageSize === undefined ? 50 : parseInteger(record.pageSize, "分页大小");
  if (page < 1 || pageSize < 1 || pageSize > 100) throw new Error("本地片库分页参数无效");
  if (record.query !== undefined && record.query !== null && typeof record.query !== "string") throw new Error("本地片库搜索词格式无效");
  return {
    page,
    pageSize,
    ...(typeof record.query === "string" && record.query.trim() ? { query: record.query.trim().slice(0, 200) } : {}),
  };
}

function parseMediaId(value: unknown): string {
  if (!isOpaqueMediaId(value)) throw new Error("mediaId 格式无效");
  return value;
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
    throw error;
  }
}
