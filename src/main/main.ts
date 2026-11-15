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
import { recordUiOperation } from "./diagnostics";

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
  unregisterLocalLibraryIpc = registerLocalLibraryIpcHandlers(localLibrary, window, localArtworkCache, appPreferences);
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

/**
 * Ticket 20 / F-01: a local-library start failure must never be a windowless
 * exit. The window is created first so the renderer can show the global error
 * card (error code, retry, diagnostics); the database owner keeps its `error`
 * state and re-initializes on the next owner call (F-04). Only a failure to
 * create the window itself is unrecoverable.
 */
async function bootstrap(): Promise<void> {
  await app.whenReady();
  const startedAt = Date.now();
  localLibrary = new LocalLibraryDatabase({ dbPath: join(app.getPath("userData"), "local-library", "library.sqlite") });
  localArtworkCache = new LocalArtworkCache(join(app.getPath("userData"), "local-library", "artwork-cache"));
  appPreferences = new AppPreferencesStore(join(app.getPath("userData"), "app-preferences.json"));
  await appPreferences.load();
  try {
    await localLibrary.start();
    void recordUiOperation("local-library.start", "success", startedAt);
  } catch (error) {
    // The renderer's error card is the user-facing report; this trace is for
    // diagnostics after the fact.
    console.error("z-video failed to start local library", error instanceof Error ? error.message : "unknown error");
    void recordUiOperation("local-library.start", "error", startedAt, {
      errorKind: error instanceof Error ? error.name : "unknown",
      ...(error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? { errorCode: (error as { code: string }).code } : {}),
    });
  }
  createLocalWindow();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createLocalWindow();
    }
  });
}

void bootstrap().catch((error: unknown) => {
  // Reaching here means even the window could not be created: there is no
  // surface left to report on.
  console.error("z-video failed to create its main window", error instanceof Error ? error.message : "unknown error");
  void recordUiOperation("main.window", "error", Date.now(), { errorKind: error instanceof Error ? error.name : "unknown" });
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
