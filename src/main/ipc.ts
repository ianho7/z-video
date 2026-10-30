import { ipcMain } from "electron";

import type { LoginInput } from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { SessionController } from "./session-controller";

export { IPC_CHANNELS } from "../shared/ipc-channels";

export function registerIpcHandlers(controller: SessionController): void {
  ipcMain.handle(IPC_CHANNELS.restore, () => controller.restore());
  ipcMain.handle(IPC_CHANNELS.login, (_event, value: unknown) => controller.login(parseLoginInput(value)));
  ipcMain.handle(IPC_CHANNELS.sendMfa, (_event, value: unknown) => controller.sendMfaCode(parseOptionalString(value)));
  ipcMain.handle(IPC_CHANNELS.verifyMfa, (_event, value: unknown) => controller.verifyMfa(parseRequiredString(value, "验证码")));
  ipcMain.handle(IPC_CHANNELS.logout, () => controller.logout());
  ipcMain.handle(IPC_CHANNELS.listClassifications, () => controller.listClassifications());
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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}
