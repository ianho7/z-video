import { app } from "electron";
import { join } from "node:path";

import { registerLocalLibraryIpcHandlers } from "./local-library-ipc";
import { LocalLibraryDatabase } from "./local-library-database";
import { createMainWindow } from "./window";

let mainWindow: ReturnType<typeof createMainWindow> | undefined;
let localLibrary: LocalLibraryDatabase | undefined;
let unregisterLocalLibraryIpc: (() => void) | undefined;
let quitting = false;

function attachWindowLifecycle(window: ReturnType<typeof createMainWindow>): void {
  window.once("closed", () => {
    mainWindow = undefined;
  });
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  localLibrary = new LocalLibraryDatabase({ dbPath: join(app.getPath("userData"), "local-library", "library.sqlite") });
  await localLibrary.start();
  mainWindow = createMainWindow();
  unregisterLocalLibraryIpc = registerLocalLibraryIpcHandlers(localLibrary, mainWindow);
  attachWindowLifecycle(mainWindow);
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      attachWindowLifecycle(mainWindow);
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
  unregisterLocalLibraryIpc?.();
  const close = localLibrary?.close() ?? Promise.resolve();
  void close.finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
