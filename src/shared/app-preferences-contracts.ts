import type { LocalLibrarySort } from "./local-library-contracts";
import {
  defaultCleanupSettings,
  parseCleanupSettings,
  type CleanupSettings,
} from "./cleanup-contracts.js";

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  volume: 100,
  muted: false,
  speed: 1,
  sort: "recent",
  cleanup: defaultCleanupSettings(),
};

export interface AppPreferences {
  volume: number;
  muted: boolean;
  speed: number;
  sort: LocalLibrarySort;
  /** Cleanup thresholds/rules/preset; stored with application preferences, not media rows. */
  cleanup: CleanupSettings;
}

export type AppPlaybackPreferences = Pick<AppPreferences, "volume" | "muted" | "speed">;

export interface AppPreferencesApi {
  get(): Promise<AppPreferences>;
  setSort(sort: LocalLibrarySort): Promise<AppPreferences>;
  setCleanup(settings: CleanupSettings): Promise<AppPreferences>;
}

export function isLocalLibrarySort(value: unknown): value is LocalLibrarySort {
  return value === "recent" || value === "title" || value === "year_desc" || value === "score_desc" || value === "added_desc" || value === "released_desc";
}

export function isAppPlaybackPreferences(value: unknown): value is AppPlaybackPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.volume === "number"
    && Number.isFinite(record.volume)
    && record.volume >= 0
    && record.volume <= 100
    && typeof record.muted === "boolean"
    && typeof record.speed === "number"
    && Number.isFinite(record.speed)
    && record.speed >= 0.25
    && record.speed <= 3;
}

export function parseAppPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("应用设置格式无效");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["volume", "muted", "speed", "sort", "cleanup"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("应用设置字段无效");
  const playback = {
    volume: record.volume === undefined ? DEFAULT_APP_PREFERENCES.volume : record.volume,
    muted: record.muted === undefined ? DEFAULT_APP_PREFERENCES.muted : record.muted,
    speed: record.speed === undefined ? DEFAULT_APP_PREFERENCES.speed : record.speed,
  };
  const sort = record.sort === undefined ? DEFAULT_APP_PREFERENCES.sort : record.sort;
  // Older preference files have no cleanup block; default it instead of
  // discarding the saved playback settings.
  const cleanup = record.cleanup === undefined ? defaultCleanupSettings() : parseCleanupSettings(record.cleanup);
  if (!isAppPlaybackPreferences(playback) || !isLocalLibrarySort(sort)) throw new Error("应用设置值无效");
  return { ...playback, sort, cleanup };
}
