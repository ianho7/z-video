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
  mainWindow.once("closed", () => {
    void playbackHost?.close();
    playbackHost = undefined;
    mainWindow = undefined;
  });
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      playbackHost = new MainPlaybackHost(mainWindow, undefined, {
        sessions: controller,
        nas,
        onProgressSaved: (identity) => library.invalidateDetail(identity.collectionId, identity.classificationId),
      });
      mainWindow.once("closed", () => {
        void playbackHost?.close();
        playbackHost = undefined;
        mainWindow = undefined;
      });
    }
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("z-video failed to start", error instanceof Error ? error.message : "unknown error");
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
