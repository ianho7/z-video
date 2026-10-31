export type LocalLibraryErrorCode = "sqlite-unavailable" | "storage" | "invalid-input" | "unknown";

const DEFAULT_MESSAGES: Record<LocalLibraryErrorCode, string> = {
  "sqlite-unavailable": "本地片库存储不可用，请重启应用后重试。",
  storage: "本地片库暂时无法读取，请检查应用存储权限后重试。",
  "invalid-input": "所选本地片库输入无效。",
  unknown: "本地片库操作失败，请重试。",
};

// Only deliberate, short validation messages may cross the main/renderer boundary.
// Filesystem, SQLite and native errors are reduced to the stable code message.
const SAFE_VALIDATION_MESSAGE = /^[^\\/:]{1,200}$/u;

export function localLibraryErrorMessage(code: LocalLibraryErrorCode, candidate?: unknown): string {
  if (code === "invalid-input" && typeof candidate === "string" && SAFE_VALIDATION_MESSAGE.test(candidate)) return candidate;
  return DEFAULT_MESSAGES[code];
}

export function localLibraryErrorCode(error: unknown, fallback: LocalLibraryErrorCode = "unknown"): LocalLibraryErrorCode {
  if (!error || typeof error !== "object") return fallback;
  const code = (error as { code?: unknown }).code;
  return code === "sqlite-unavailable" || code === "storage" || code === "invalid-input" || code === "unknown" ? code : fallback;
}

export function safeLocalLibraryError(error: unknown, fallback: LocalLibraryErrorCode = "unknown"): Error {
  const code = localLibraryErrorCode(error, fallback);
  const message = error instanceof Error ? error.message : undefined;
  return new Error(localLibraryErrorMessage(code, message));
}
