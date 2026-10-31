import { app } from "electron";
import { join } from "node:path";

import { registerLocalLibraryIpcHandlers } from "./local-library-ipc";
import { registerLocalPlaybackIpcHandlers } from "./local-playback-ipc";
import { LocalLibraryDatabase } from "./local-library-database";
import { MainLocalPlaybackHost } from "./player-host";
import type { LocalPlaybackStore } from "../shared/local-playback-contracts";
import { createMainWindow } from "./window";

let mainWindow: ReturnType<typeof createMainWindow> | undefined;
let localLibrary: LocalLibraryDatabase | undefined;
let unregisterLocalLibraryIpc: (() => void) | undefined;
let localPlayback: MainLocalPlaybackHost | undefined;
let unregisterLocalPlaybackIpc: (() => void) | undefined;
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
  localPlayback = new MainLocalPlaybackHost(window, localLibrary as unknown as LocalPlaybackStore);
  unregisterLocalLibraryIpc = registerLocalLibraryIpcHandlers(localLibrary, window);
  unregisterLocalPlaybackIpc = registerLocalPlaybackIpcHandlers(localPlayback);
  attachWindowLifecycle(window);
}

function closePlayback(): Promise<void> {
  const previousClose = playbackClosing;
  unregisterLocalPlaybackIpc?.();
  unregisterLocalPlaybackIpc = undefined;
  unregisterLocalLibraryIpc?.();
  unregisterLocalLibraryIpc = undefined;
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
