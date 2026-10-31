import { basename, sep } from "node:path";

/** Renderer-safe label for a selected source. It never falls back to the root path. */
export function safeSourceLabel(rootPath: string): string {
  const trimmed = rootPath.replace(/[\\/]+$/u, "");
  const drive = trimmed.match(/^([A-Za-z]):$/u)?.[1];
  if (drive) return `${drive.toUpperCase()} drive`;
  const name = basename(trimmed);
  if (name && name !== "." && name !== sep && !/[\\/]/u.test(name)) return name.slice(0, 80);
  return "Selected folder";
}
