import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import { DEFAULT_APP_PREFERENCES, isLocalLibrarySort, parseAppPreferences } from "../src/shared/app-preferences-contracts";
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
    await Promise.all([
      first.confirmPlayback({ volume: 35, muted: true, speed: 1.25 }),
      first.setSort("score_desc"),
    ]);
    await first.flush();

    const second = new AppPreferencesStore(filePath);
    assert.deepEqual(await second.load(), { volume: 35, muted: true, speed: 1.25, sort: "score_desc" });
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(persisted).sort(), ["muted", "sort", "speed", "volume"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
