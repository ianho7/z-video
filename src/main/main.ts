import { app } from "electron";
import { join } from "node:path";

import { registerLocalLibraryIpcHandlers } from "./local-library-ipc";
import { registerLocalPlaybackIpcHandlers } from "./local-playback-ipc";
import { registerAppPreferencesIpcHandlers } from "./app-preferences-ipc";
import { LocalLibraryDatabase } from "./local-library-database";
import { LocalArtworkCache } from "./local-artwork-cache";
import { MainLocalPlaybackHost } from "./player-host";
import type { LocalPlaybackStore } from "../shared/local-playback-contracts";
import { createMainWindow } from "./window";
import { AppPreferencesStore } from "./app-preferences";

let mainWindow: ReturnType<typeof createMainWindow> | undefined;
let localLibrary: LocalLibraryDatabase | undefined;
let localArtworkCache: LocalArtworkCache | undefined;
let appPreferences: AppPreferencesStore | undefined;
let unregisterLocalLibraryIpc: (() => void) | undefined;
let localPlayback: MainLocalPlaybackHost | undefined;
let unregisterLocalPlaybackIpc: (() => void) | undefined;
let unregisterAppPreferencesIpc: (() => void) | undefined;
let playbackClosing: Promise<void> | undefined;
let quitting = false;

function attachWindowLifecycle(window: ReturnType<typeof createMainWindow>): void {
  window.once("closed", () => {
    void closePlayback();
    mainWindow = undefined;
  });
}

function createLocalWindow(): void {
  if (!localLibrary) throw new Error("本地片库尚未启动");
  const window = createMainWindow();
  mainWindow = window;
  if (!appPreferences) throw new Error("应用设置尚未启动");
  localPlayback = new MainLocalPlaybackHost(window, localLibrary as unknown as LocalPlaybackStore, undefined, appPreferences);
  if (!localArtworkCache) throw new Error("本地 artwork cache 尚未启动");
  unregisterLocalLibraryIpc = registerLocalLibraryIpcHandlers(localLibrary, window, localArtworkCache);
  unregisterLocalPlaybackIpc = registerLocalPlaybackIpcHandlers(localPlayback);
  unregisterAppPreferencesIpc = registerAppPreferencesIpcHandlers(appPreferences);
  attachWindowLifecycle(window);
}

function closePlayback(): Promise<void> {
  const previousClose = playbackClosing;
  unregisterLocalPlaybackIpc?.();
  unregisterLocalPlaybackIpc = undefined;
  unregisterLocalLibraryIpc?.();
  unregisterLocalLibraryIpc = undefined;
  unregisterAppPreferencesIpc?.();
  unregisterAppPreferencesIpc = undefined;
  const host = localPlayback;
  localPlayback = undefined;
  const close = Promise.all([previousClose ?? Promise.resolve(), host?.close() ?? Promise.resolve()]).then(() => undefined);
  const tracked = close.finally(() => {
    if (playbackClosing === tracked) playbackClosing = undefined;
  });
  playbackClosing = tracked;
  return tracked;
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  localLibrary = new LocalLibraryDatabase({ dbPath: join(app.getPath("userData"), "local-library", "library.sqlite") });
  localArtworkCache = new LocalArtworkCache(join(app.getPath("userData"), "local-library", "artwork-cache"));
  appPreferences = new AppPreferencesStore(join(app.getPath("userData"), "app-preferences.json"));
  await appPreferences.load();
  await localLibrary.start();
  createLocalWindow();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createLocalWindow();
    }
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("z-video failed to start local library", error instanceof Error ? error.message : "unknown error");
  app.exit(1);
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  const close = closePlayback().then(() => localLibrary?.close());
  void close.finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
