import assert from "node:assert/strict";
import { join } from "node:path";

import { app, ipcMain } from "electron";

import { applyWindowAppearance, createMainWindow } from "../src/main/window";

const smokeUserData = join(process.env.TEMP ?? process.cwd(), `z-video-electron-appearance-smoke-${process.pid}`);
app.setPath("userData", smokeUserData);
app.setPath("sessionData", join(smokeUserData, "session"));

const libraryState = { status: "ready", schemaVersion: 3, sqliteAvailable: true, sources: [] };

async function run(): Promise<void> {
  await app.whenReady();
  // The account-free renderer boots from local-library IPC, not the legacy NAS
  // session/library channels this fixture used to stub.
  ipcMain.handle("local-library:state", async () => libraryState);
  ipcMain.handle("local-library:list", async (_event, query) => ({ state: libraryState, page: { query, page: 1, pageSize: 50, totalCount: 0, items: [] } }));
  ipcMain.handle("local-library:list-collections", async (_event, query) => ({ state: libraryState, page: { query, page: 1, pageSize: 50, totalCount: 0, items: [] } }));
  ipcMain.handle("local-library:continue-watching", async () => ({ state: libraryState, items: [] }));
  ipcMain.handle("app-preferences:get", async () => ({ volume: 100, muted: false, speed: 1, sort: "recent" }));
  ipcMain.handle("app-preferences:set-sort", async (_event, sort) => ({ volume: 100, muted: false, speed: 1, sort }));

  const window = createMainWindow();
  assert.deepEqual(window.getMinimumSize(), [900, 640], "the main window keeps the 900x640 minimum");
  await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 80));

  // The renderer has no appearance consumer yet (tracked separately as G-02),
  // so observe the appearance decision at its owner: main, under the runner's
  // Z_VIDEO_REDUCED_TRANSPARENCY=1 / Z_VIDEO_NATIVE_BACKDROP=1 environment.
  const appearance = applyWindowAppearance(window);
  const expected = {
    nativeBackdrop: false,
    reducedTransparency: process.platform === "win32",
    highContrast: false,
  };
  assert.deepEqual(appearance, expected, "the window falls back to the opaque reduced-transparency path");
  assert.deepEqual(applyWindowAppearance(window), expected, "re-applying the same system state is stable");

  const geometry = (await window.webContents.executeJavaScript(
    `({ minWidth: getComputedStyle(document.body).minWidth, minHeight: getComputedStyle(document.body).minHeight })`,
    true,
  )) as { minWidth: string; minHeight: string };
  assert.equal(geometry.minWidth, "900px", "the renderer keeps the 900x640 minimum CSS geometry");
  assert.equal(geometry.minHeight, "640px", "the renderer keeps the 900x640 minimum CSS geometry");

  window.close();
}

run()
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
