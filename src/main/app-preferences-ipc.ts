import { ipcMain } from "electron";

import { isLocalLibrarySort } from "../shared/app-preferences-contracts";
import type { LocalLibrarySort } from "../shared/local-library-contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { recordUiOperation } from "./diagnostics";
import { AppPreferencesStore } from "./app-preferences";

export function registerAppPreferencesIpcHandlers(store: AppPreferencesStore): () => void {
  ipcMain.handle(IPC_CHANNELS.appPreferencesGet, (_event, ...args: unknown[]) => {
    if (args.length > 0) throw new Error("应用设置读取参数无效");
    return store.get();
  });
  ipcMain.handle(IPC_CHANNELS.appPreferencesSetSort, (_event, value: unknown) => withUiOperation("app-preferences.set-sort", async () => {
    if (!isLocalLibrarySort(value)) throw new Error("本地片库排序条件无效");
    return store.setSort(value as LocalLibrarySort);
  }));
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.appPreferencesGet);
    ipcMain.removeHandler(IPC_CHANNELS.appPreferencesSetSort);
  };
}

async function withUiOperation<T>(operation: string, action: () => Promise<T>): Promise<T> {
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
