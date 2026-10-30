import { app } from "electron";

import { registerIpcHandlers } from "./ipc";
import { NasApiClient } from "./nas-client";
import { createElectronSecureSessionStore } from "./secure-session-store";
import { SessionController } from "./session-controller";
import { createMainWindow } from "./window";

let mainWindow: ReturnType<typeof createMainWindow> | undefined;

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const controller = new SessionController(new NasApiClient(), createElectronSecureSessionStore());
  registerIpcHandlers(controller);
  mainWindow = createMainWindow();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("z-video failed to start", error instanceof Error ? error.message : "unknown error");
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
