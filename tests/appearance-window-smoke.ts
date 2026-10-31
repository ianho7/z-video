import assert from "node:assert/strict";
import { join } from "node:path";

import { app, ipcMain } from "electron";

import { createMainWindow } from "../src/main/window";

const smokeUserData = join(process.env.TEMP ?? process.cwd(), `z-video-electron-appearance-smoke-${process.pid}`);
app.setPath("userData", smokeUserData);
app.setPath("sessionData", join(smokeUserData, "session"));

async function run(): Promise<void> {
  await app.whenReady();
  ipcMain.handle("session:restore", async () => ({ status: "logged-out", classifications: [] }));
  ipcMain.handle("library:get-navigation", async () => ({ view: "library", library: { classificationId: "", page: 1, pageSize: 50, filter: "all", sort: "recent", scrollTop: 0 } }));
  const window = createMainWindow();
  await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 80));

  const state = (await window.webContents.executeJavaScript(
    `({ reduced: document.documentElement.dataset.reducedTransparency, highContrast: document.documentElement.dataset.highContrast, nativeBackdrop: document.documentElement.dataset.nativeBackdrop, minWidth: getComputedStyle(document.body).minWidth, minHeight: getComputedStyle(document.body).minHeight })`,
    true,
  )) as { reduced: string | undefined; highContrast: string | undefined; nativeBackdrop: string | undefined; minWidth: string; minHeight: string };
  assert.equal(state.reduced, "true");
  assert.equal(state.nativeBackdrop, "false");
  assert.equal(state.highContrast, "false");
  assert.equal(state.minWidth, "900px");
  assert.equal(state.minHeight, "640px");

  window.close();
}

run()
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
