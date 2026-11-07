import { ipcMain } from "electron";

import {
  assertLocalPlaybackMediaId,
  isLocalPlaybackOpenOptions,
  isLocalPlaybackControlCommand,
  type LocalPlaybackControlCommand,
  type LocalPlaybackOpenOptions,
} from "../shared/local-playback-contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { recordUiOperation } from "./diagnostics";
import type { LocalPlaybackHost } from "./player-host";

export function registerLocalPlaybackIpcHandlers(host: LocalPlaybackHost): () => void {
  ipcMain.handle(IPC_CHANNELS.localPlaybackOpen, (_event, value: unknown) => withUiOperation("local-playback.open", () => {
    const request = parseOpenRequest(value);
    return host.open(request.mediaId, request.options);
  }));
  ipcMain.handle(IPC_CHANNELS.localPlaybackCommand, (_event, value: unknown) => withUiOperation("local-playback.command", () => host.handle(parseControlCommand(value))));
  ipcMain.handle(IPC_CHANNELS.localPlaybackChooseSubtitleFile, () => withUiOperation("local-playback.choose-subtitle-file", () => host.chooseSubtitleFile()));
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.localPlaybackOpen);
    ipcMain.removeHandler(IPC_CHANNELS.localPlaybackCommand);
    ipcMain.removeHandler(IPC_CHANNELS.localPlaybackChooseSubtitleFile);
  };
}

function parseOpenRequest(value: unknown): { mediaId: string; options?: LocalPlaybackOpenOptions } {
  if (typeof value === "string") {
    assertLocalPlaybackMediaId(value);
    return { mediaId: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本地播放打开参数格式无效");
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => key === "mediaId" || key === "restart")) throw new Error("本地播放打开字段无效");
  assertLocalPlaybackMediaId(record.mediaId);
  const options = record.restart === undefined ? undefined : { restart: record.restart };
  if (options !== undefined && !isLocalPlaybackOpenOptions(options)) throw new Error("本地播放 restart 参数无效");
  return { mediaId: record.mediaId, ...(options ? { options } : {}) };
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
