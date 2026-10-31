import { app } from "electron";

import { registerIpcHandlers } from "./ipc";
import { LibraryController } from "./library-controller";
import { NasApiClient } from "./nas-client";
import { createElectronSecureSessionStore } from "./secure-session-store";
import { SessionController } from "./session-controller";
import { createMainWindow } from "./window";
import { MainPlaybackHost, type PlaybackHost } from "./player-host";

let mainWindow: ReturnType<typeof createMainWindow> | undefined;
let playbackHost: PlaybackHost | undefined;
let playbackClose: Promise<void> | undefined;
let quitting = false;

function closePlaybackHost(): Promise<void> {
  if (playbackClose) return playbackClose;
  const host = playbackHost;
  playbackHost = undefined;
  playbackClose = Promise.resolve(host?.close()).catch((error: unknown) => {
    console.error("z-video playback shutdown failed", error instanceof Error ? error.message : "unknown error");
  }).finally(() => {
    playbackClose = undefined;
  });
  return playbackClose;
}

function attachWindowLifecycle(window: ReturnType<typeof createMainWindow>): void {
  window.once("closed", () => {
    mainWindow = undefined;
    // macOS keeps the app process after the last window closes. Windows
    // reaches this cleanup through before-quit after window-all-closed.
    if (process.platform === "darwin") void closePlaybackHost();
  });
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const nas = new NasApiClient();
  const controller = new SessionController(nas, createElectronSecureSessionStore());
  const playbackBridge: PlaybackHost = {
    chooseLocalFile: () => playbackHost?.chooseLocalFile() ?? Promise.resolve({ opened: false }),
    chooseSubtitleFile: () => playbackHost?.chooseSubtitleFile() ?? Promise.resolve({ loaded: false }),
    handle: (command) => playbackHost?.handle(command) ?? Promise.resolve(),
    close: () => playbackHost?.close() ?? Promise.resolve(),
  };
  const library = new LibraryController(controller, nas);
  mainWindow = createMainWindow();
  playbackHost = new MainPlaybackHost(mainWindow, undefined, {
    sessions: controller,
    nas,
    onProgressSaved: (identity) => library.invalidateDetail(identity.collectionId, identity.classificationId),
  });
  registerIpcHandlers(controller, library, playbackBridge);
  attachWindowLifecycle(mainWindow);
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      playbackHost = new MainPlaybackHost(mainWindow, undefined, {
        sessions: controller,
        nas,
        onProgressSaved: (identity) => library.invalidateDetail(identity.collectionId, identity.classificationId),
      });
      attachWindowLifecycle(mainWindow);
    }
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("z-video failed to start", error instanceof Error ? error.message : "unknown error");
  app.exit(1);
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void closePlaybackHost().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
