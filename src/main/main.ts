import { app } from "electron";

import { registerIpcHandlers } from "./ipc";
import { NasApiClient } from "./nas-client";
import { createElectronSecureSessionStore } from "./secure-session-store";
import { SessionController } from "./session-controller";
import { createMainWindow } from "./window";
import { MainPlaybackHost, type PlaybackHost } from "./player-host";

let mainWindow: ReturnType<typeof createMainWindow> | undefined;
let playbackHost: PlaybackHost | undefined;

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const controller = new SessionController(new NasApiClient(), createElectronSecureSessionStore());
  const playbackBridge: PlaybackHost = {
    chooseLocalFile: () => playbackHost?.chooseLocalFile() ?? Promise.resolve({ opened: false }),
    handle: (command) => playbackHost?.handle(command) ?? Promise.resolve(),
    close: () => playbackHost?.close() ?? Promise.resolve(),
  };
  mainWindow = createMainWindow();
  playbackHost = new MainPlaybackHost(mainWindow);
  registerIpcHandlers(controller, playbackBridge);
  mainWindow.once("closed", () => {
    void playbackHost?.close();
    playbackHost = undefined;
    mainWindow = undefined;
  });
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      playbackHost = new MainPlaybackHost(mainWindow);
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
