import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import { DEFAULT_APP_PREFERENCES, isLocalLibrarySort, parseAppPreferences } from "../src/shared/app-preferences-contracts";
import { CLEANUP_PRESETS, defaultCleanupSettings, parseCleanupSettings } from "../src/shared/cleanup-contracts";
import { AppPreferencesStore } from "../src/main/app-preferences";

test("app preferences default safely for missing or invalid JSON and reject invalid sort input", async () => {
  await mkdir(join(process.cwd(), ".scratch"), { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), ".scratch", "z-video-app-preferences-"));
  const filePath = join(directory, "app-preferences.json");
  try {
    const missing = new AppPreferencesStore(filePath);
    assert.deepEqual(await missing.load(), DEFAULT_APP_PREFERENCES);

    await writeFile(filePath, JSON.stringify({ volume: 999, path: "C:\\private\\media" }), "utf8");
    const invalid = new AppPreferencesStore(filePath);
    assert.deepEqual(await invalid.load(), DEFAULT_APP_PREFERENCES);
    await assert.rejects(() => invalid.setSort("not-a-sort" as never), /排序条件无效/);
    assert.equal(isLocalLibrarySort({ sort: "score_desc" }), false);
    assert.equal(isLocalLibrarySort("released_desc"), true);
    assert.throws(() => parseAppPreferences({ volume: 30, path: "C:\\private\\media" }), /字段无效/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("app preferences serialize concurrent updates and restore them from a fresh store", async () => {
  await mkdir(join(process.cwd(), ".scratch"), { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), ".scratch", "z-video-app-preferences-"));
  const filePath = join(directory, "app-preferences.json");
  try {
    const first = new AppPreferencesStore(filePath);
    await first.load();
    const cleanup = { ...defaultCleanupSettings(), preset: "aggressive" as const, thresholds: { ...CLEANUP_PRESETS.aggressive }, snoozeDays: 45, keepDays: 365 };
    await Promise.all([
      first.confirmPlayback({ volume: 35, muted: true, speed: 1.25 }),
      first.setSort("score_desc"),
      first.setCleanup(cleanup),
    ]);
    await first.flush();

    const second = new AppPreferencesStore(filePath);
    assert.deepEqual(await second.load(), { volume: 35, muted: true, speed: 1.25, sort: "score_desc", cleanup });
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(persisted).sort(), ["cleanup", "muted", "sort", "speed", "volume"]);
    assert.equal(JSON.stringify(persisted.cleanup).includes("C:\\private"), false, "no path can enter cleanup settings");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleanup preferences default for older files and reject invalid threshold updates", async () => {
  await mkdir(join(process.cwd(), ".scratch"), { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), ".scratch", "z-video-app-preferences-"));
  const filePath = join(directory, "app-preferences.json");
  try {
    // A preference file written before cleanup existed keeps its playback settings.
    await writeFile(filePath, JSON.stringify({ volume: 40, muted: true, speed: 1.5, sort: "title" }), "utf8");
    const legacy = new AppPreferencesStore(filePath);
    assert.deepEqual(await legacy.load(), { volume: 40, muted: true, speed: 1.5, sort: "title", cleanup: defaultCleanupSettings() });

    const custom = { ...defaultCleanupSettings(), preset: "custom" as const, thresholds: { ...defaultCleanupSettings().thresholds, protectionDays: 45, largeBytes: 3 * 1024 * 1024 * 1024 }, snoozeDays: 14, keepDays: 90 };
    await legacy.setCleanup(custom);
    assert.deepEqual(legacy.get().cleanup, custom);
    await assert.rejects(() => legacy.setCleanup({ ...custom, thresholds: { ...custom.thresholds, protectionDays: 0 } }), /保护期/);
    assert.deepEqual(legacy.get().cleanup, custom, "an invalid update leaves the saved settings untouched");

    await writeFile(filePath, JSON.stringify({ ...DEFAULT_APP_PREFERENCES, cleanup: { preset: "standard" } }), "utf8");
    const broken = new AppPreferencesStore(filePath);
    assert.deepEqual(await broken.load(), DEFAULT_APP_PREFERENCES, "a malformed cleanup block falls back to safe defaults");
    assert.throws(() => parseCleanupSettings({ ...defaultCleanupSettings(), keepDays: 0 }), /保留/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
