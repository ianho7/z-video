import { basename, dirname, sep } from "node:path";

/** Renderer-safe label for a selected source. It never falls back to the root path. */
export function safeSourceLabel(rootPath: string): string {
  const trimmed = rootPath.replace(/[\\/]+$/u, "");
  const drive = trimmed.match(/^([A-Za-z]):$/u)?.[1];
  if (drive) return `${drive.toUpperCase()} 盘`;
  const name = basename(trimmed);
  if (name && name !== "." && name !== sep && !/[\\/]/u.test(name)) return name.slice(0, 80);
  return "Selected folder";
}

/**
 * Renderer-safe location clue for a source. It only exposes the drive (or the
 * fact that the root is a network location) and the immediate parent folder
 * name; the full root never leaves main/worker.
 */
export function safeSourceLocationHint(rootPath: string): string {
  const trimmed = rootPath.replace(/[\\/]+$/u, "");
  const drive = trimmed.match(/^([A-Za-z]):(?:[\\/]|$)/u)?.[1];
  const network = /^\\\\[^\\/]+[\\/][^\\/]+/u.test(trimmed);
  const networkChild = /^\\\\[^\\/]+[\\/][^\\/]+[\\/].+/u.test(trimmed);
  const server = /^\\\\([^\\/]+)/u.exec(trimmed)?.[1];
  const parent = basename(dirname(trimmed));
  const base = drive ? `${drive.toUpperCase()} 盘` : network ? "网络位置" : `上级：${basename(trimmed) || "所选文件夹"}`;
  if (network && !networkChild) return base;
  if (!parent || parent === "." || parent === ".." || parent === trimmed || parent === sep || /[\\/]/u.test(parent) || (network && server && parent === server)) return base;
  return `${base} · 上级：${parent.slice(0, 80)}`;
}
