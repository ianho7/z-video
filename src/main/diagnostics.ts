import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOG_FILE = "diagnostics.jsonl";

export interface DiagnosticDetails {
  httpStatus?: number;
  parseResult?: string;
  businessResult?: string;
  errorKind?: string;
  errorCode?: string;
  itemCount?: number;
  categoryCount?: number;
  tokenPresent?: boolean;
  nasIdPresent?: boolean;
  nasSignPresent?: boolean;
}

function logPath(): string {
  const override = process.env.Z_VIDEO_LOG_DIR?.trim();
  if (override) return join(override, LOG_FILE);
  const localAppData = process.env.LOCALAPPDATA?.trim();
  const base = localAppData || process.env.TEMP || process.cwd();
  return join(base, "z-video", "logs", LOG_FILE);
}

export function safePath(path: string): string {
  try {
    const [withoutFragment] = path.split("#", 1);
    const parsed = new URL(withoutFragment, "http://z-video.invalid");
    const safe = new URL(parsed.pathname, "http://z-video.invalid");
    const pathname = safe.pathname || "/";
    const lower = pathname.toLowerCase();
    if (lower.includes("/splay/") || lower.startsWith("/media/") || lower.includes("/private/") || /\.(mkv|mp4|avi|ts)$/.test(lower)) {
      return "/[REDACTED_MEDIA_PATH]";
    }
    return pathname;
  } catch {
    return "/";
  }
}

export async function recordNasRequest(
  operation: string,
  method: string,
  path: string,
  result: "success" | "error",
  startedAt: number,
  details: DiagnosticDetails = {},
): Promise<void> {
  const event = {
    timestamp_utc: new Date().toISOString(),
    event_type: "nas.request",
    operation,
    phase: "complete",
    result,
    duration_ms: Math.max(0, Date.now() - startedAt),
    details: {
      method,
      path: safePath(path),
      ...details,
    },
  };
  const target = logPath();
  try {
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Diagnostics must never change the NAS result or block the UI.
  }
}

export async function recordUiOperation(
  operation: string,
  result: "success" | "error",
  startedAt: number,
  details: DiagnosticDetails = {},
): Promise<void> {
  const event = {
    timestamp_utc: new Date().toISOString(),
    event_type: "ui.operation",
    operation,
    phase: "complete",
    result,
    duration_ms: Math.max(0, Date.now() - startedAt),
    details: { ...details },
  };
  const target = logPath();
  try {
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Diagnostics must never change the UI result or block the main process.
  }
}

export function diagnosticLogPath(): string {
  return logPath();
}
