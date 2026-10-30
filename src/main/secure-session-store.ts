import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PersistedSession, SessionStore } from "./session-controller";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ElectronSecureSessionStore implements SessionStore {
  constructor(private readonly storage: SafeStorageLike, private readonly filePath: string) {}

  async load(): Promise<PersistedSession | null> {
    if (!this.storage.isEncryptionAvailable()) throw new Error("Windows safeStorage 不可用");
    let encoded: string;
    try {
      encoded = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw new Error("无法读取安全会话");
    }
    try {
      const value = JSON.parse(this.storage.decryptString(Buffer.from(encoded, "base64"))) as unknown;
      return parsePersistedSession(value);
    } catch {
      throw new Error("安全会话格式无效");
    }
  }

  async save(session: PersistedSession): Promise<void> {
    if (!this.storage.isEncryptionAvailable()) throw new Error("Windows safeStorage 不可用");
    const encrypted = this.storage.encryptString(JSON.stringify(session)).toString("base64");
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, encrypted, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (!isMissingFile(error)) throw new Error("无法清除安全会话");
    }
  }
}

export function createElectronSecureSessionStore(): SessionStore {
  return new ElectronSecureSessionStore(safeStorage, join(app.getPath("userData"), "session.bin"));
}

function parsePersistedSession(value: unknown): PersistedSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
  const record = value as Record<string, unknown>;
  if (typeof record.baseUrl !== "string" || typeof record.username !== "string" || typeof record.token !== "string" || !record.token.trim()) {
    throw new Error("missing session fields");
  }
  const session: PersistedSession = {
    baseUrl: record.baseUrl,
    username: record.username,
    token: record.token,
  };
  const nasId = optionalString(record.nasId);
  const nasSign = optionalString(record.nasSign);
  const nasName = optionalString(record.nasName);
  if (nasId) session.nasId = nasId;
  if (nasSign) session.nasSign = nasSign;
  if (nasName) session.nasName = nasName;
  return session;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
