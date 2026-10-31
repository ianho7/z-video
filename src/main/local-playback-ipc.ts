import { ipcMain } from "electron";

import {
  assertLocalPlaybackMediaId,
  isLocalPlaybackControlCommand,
  type LocalPlaybackControlCommand,
} from "../shared/local-playback-contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { recordUiOperation } from "./diagnostics";
import type { LocalPlaybackHost } from "./player-host";

export function registerLocalPlaybackIpcHandlers(host: LocalPlaybackHost): () => void {
  ipcMain.handle(IPC_CHANNELS.localPlaybackOpen, (_event, value: unknown) => withUiOperation("local-playback.open", () => host.open(parseMediaId(value))));
  ipcMain.handle(IPC_CHANNELS.localPlaybackCommand, (_event, value: unknown) => withUiOperation("local-playback.command", () => host.handle(parseControlCommand(value))));
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.localPlaybackOpen);
    ipcMain.removeHandler(IPC_CHANNELS.localPlaybackCommand);
  };
}

function parseMediaId(value: unknown): string {
  assertLocalPlaybackMediaId(value);
  return value;
}

function parseControlCommand(value: unknown): LocalPlaybackControlCommand {
  if (!isLocalPlaybackControlCommand(value)) throw new Error("本地播放命令格式无效");
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
