import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  DEFAULT_APP_PREFERENCES,
  isAppPlaybackPreferences,
  isLocalLibrarySort,
  parseAppPreferences,
  type AppPlaybackPreferences,
  type AppPreferences,
} from "../shared/app-preferences-contracts";
import type { LocalLibrarySort } from "../shared/local-library-contracts";

export class AppPreferencesStore {
  private value: AppPreferences = { ...DEFAULT_APP_PREFERENCES };
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppPreferences> {
    if (this.loaded) return this.get();
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.value = parseAppPreferences(JSON.parse(raw) as unknown);
    } catch {
      this.value = { ...DEFAULT_APP_PREFERENCES };
    }
    return this.get();
  }

  get(): AppPreferences {
    return { ...this.value };
  }

  async setSort(sort: LocalLibrarySort): Promise<AppPreferences> {
    if (!isLocalLibrarySort(sort)) throw new Error("本地片库排序条件无效");
    return this.enqueue({ sort });
  }

  async confirmPlayback(settings: AppPlaybackPreferences): Promise<AppPreferences> {
    if (!isAppPlaybackPreferences(settings)) throw new Error("播放设置值无效");
    return this.enqueue(settings);
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private enqueue(patch: Partial<AppPreferences>): Promise<AppPreferences> {
    const work = this.writeQueue.then(async () => {
      const next = { ...this.value, ...patch };
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8" });
      await rename(temporaryPath, this.filePath);
      this.value = next;
      return this.get();
    });
    this.writeQueue = work.then(() => undefined, () => undefined);
    return work;
  }
}
