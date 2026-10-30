import { ipcMain } from "electron";

import type { LoginInput, PlaybackCommand } from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import type { PlaybackHost } from "./player-host";
import { SessionController } from "./session-controller";

export { IPC_CHANNELS } from "../shared/ipc-channels";

export function registerIpcHandlers(controller: SessionController, player?: PlaybackHost): void {
  ipcMain.handle(IPC_CHANNELS.restore, () => controller.restore());
  ipcMain.handle(IPC_CHANNELS.login, (_event, value: unknown) => controller.login(parseLoginInput(value)));
  ipcMain.handle(IPC_CHANNELS.sendMfa, (_event, value: unknown) => controller.sendMfaCode(parseOptionalString(value)));
  ipcMain.handle(IPC_CHANNELS.verifyMfa, (_event, value: unknown) => controller.verifyMfa(parseRequiredString(value, "验证码")));
  ipcMain.handle(IPC_CHANNELS.logout, () => controller.logout());
  ipcMain.handle(IPC_CHANNELS.listClassifications, () => controller.listClassifications());
  if (player) {
    ipcMain.handle(IPC_CHANNELS.playerChooseLocalFile, () => player.chooseLocalFile());
    ipcMain.handle(IPC_CHANNELS.playerCommand, (_event, value: unknown) => player.handle(parsePlaybackCommand(value)));
  }
}

function parsePlaybackCommand(value: unknown): PlaybackCommand {
  const record = asRecord(value, "播放命令");
  const type = parseRequiredString(record.type, "播放命令类型");
  switch (type) {
    case "open":
      return {
        type,
        collectionId: parseRequiredString(record.collectionId, "Collection").slice(0, 200),
        classificationId: parseRequiredString(record.classificationId, "分类").slice(0, 200),
        episodeId: parseRequiredString(record.episodeId, "Episode").slice(0, 200),
        ...(record.startPositionSec === undefined ? {} : { startPositionSec: parseFiniteNumber(record.startPositionSec, "起始位置") }),
      };
    case "play":
    case "pause":
    case "close":
      return { type };
    case "seek":
      return { type, positionSec: parseFiniteNumber(record.positionSec, "跳转位置") };
    case "set-audio-track":
      return { type, trackId: parseRequiredString(record.trackId, "音轨") };
    case "set-subtitle-track":
      return { type, trackId: record.trackId === null ? null : parseRequiredString(record.trackId, "字幕轨道") };
    case "fullscreen":
      if (typeof record.enabled !== "boolean") throw new Error("全屏参数格式无效");
      return { type, enabled: record.enabled };
    default:
      throw new Error("播放命令类型无效");
  }
}

function parseLoginInput(value: unknown): LoginInput {
  const record = asRecord(value, "登录参数");
  return {
    serverUrl: parseRequiredString(record.serverUrl, "NAS 地址"),
    username: parseRequiredString(record.username, "账号"),
    password: parseRequiredString(record.password, "密码"),
    remember: typeof record.remember === "boolean" ? record.remember : false,
  };
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseRequiredString(value, "参数");
}

function parseRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label}格式无效`);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}
