import assert from "node:assert/strict";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

const smokeUserData = process.env.Z_VIDEO_WINDOW_SMOKE_PROFILE ?? join(process.env.TEMP ?? process.cwd(), `z-video-electron-window-smoke-${process.pid}`);
app.setPath("userData", smokeUserData);
app.setPath("sessionData", join(smokeUserData, "session"));

const item = {
  mediaId: "media_123e4567-e89b-12d3-a456-426614174000",
  sourceId: "source_123e4567-e89b-12d3-a456-426614174000",
  title: "窗口测试影片",
  kind: "movie",
  sizeBytes: 1_048_576,
  modifiedAtMs: 1_793_440_000_000,
  available: true,
};
const state = {
  status: "ready",
  schemaVersion: 1,
  sqliteAvailable: true,
  sources: [{ sourceId: item.sourceId, label: "owned-fixture", available: true, itemCount: 1 }],
};

async function run(): Promise<void> {
  await app.whenReady();
  const queries: Array<Record<string, unknown>> = [];
  ipcMain.handle("local-library:state", async () => state);
  ipcMain.handle("local-library:choose-folder", async () => ({
    status: "completed",
    scanId: "scan_123e4567-e89b-12d3-a456-426614174000",
    sourceId: item.sourceId,
    scannedFiles: 1,
    importedFiles: 1,
    updatedFiles: 0,
    warningCount: 0,
    warnings: [],
  }));
  ipcMain.handle("local-library:open-video", async () => ({ status: "imported", item, state }));
  ipcMain.handle("local-library:list", async (_event, query) => {
    queries.push((query ?? {}) as Record<string, unknown>);
    return { state, page: { query: query ?? { page: 1, pageSize: 50 }, page: 1, pageSize: 50, totalCount: 1, items: [item] } };
  });
  ipcMain.handle("local-library:get", async () => ({ state, item }));
  ipcMain.handle("local-library:continue-watching", async () => ({ state, items: [] }));

  const window = new BrowserWindow({
    show: false,
    width: 1040,
    height: 720,
    webPreferences: {
      preload: join(__dirname, "..", "src", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(join(__dirname, "..", "src", "renderer", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 120));

  const initial = await window.webContents.executeJavaScript(`({
    bridge: typeof window.zVideo === "object",
    nodeRequire: typeof require,
    nodeProcess: typeof process,
    localApi: typeof window.zVideo.localLibrary === "object",
    loginView: Boolean(document.querySelector('[data-view="login"]')),
    folderButton: Boolean(document.querySelector('#choose-folder-button')),
    openButton: Boolean(document.querySelector('#open-video-button')),
    card: document.querySelector('[data-media-id]')?.textContent || ''
  })`, true) as { bridge: boolean; nodeRequire: string; nodeProcess: string; localApi: boolean; loginView: boolean; folderButton: boolean; openButton: boolean; card: string };
  assert.equal(initial.bridge, true);
  assert.equal(initial.nodeRequire, "undefined");
  assert.equal(initial.nodeProcess, "undefined");
  assert.equal(initial.localApi, true);
  assert.equal(initial.loginView, false);
  assert.equal(initial.folderButton, true);
  assert.equal(initial.openButton, true);
  assert.match(initial.card, /窗口测试影片/);

  await window.webContents.executeJavaScript("document.querySelector('#choose-folder-button').click()", true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const folderScan = await window.webContents.executeJavaScript("document.querySelector('#scan-status')?.textContent || ''", true) as string;
  assert.match(folderScan, /扫描完成/);

  await window.webContents.executeJavaScript("document.querySelector('[data-media-id]').click()", true);
  const detail = await window.webContents.executeJavaScript(`({ hidden: document.querySelector('#media-detail')?.hidden, title: document.querySelector('#media-detail-title')?.textContent || '' })`, true) as { hidden: boolean; title: string };
  assert.equal(detail.hidden, false);
  assert.equal(detail.title, "窗口测试影片");

  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  await window.webContents.executeJavaScript("document.querySelector('#library-search-input').value = '窗口'; document.querySelector('#library-search-input').dispatchEvent(new Event('input', { bubbles: true }))", true);
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(queries.at(-1)?.query, "窗口");

  window.close();
  for (const channel of ["local-library:state", "local-library:choose-folder", "local-library:open-video", "local-library:list", "local-library:get", "local-library:continue-watching"]) ipcMain.removeHandler(channel);
}

run().then(() => app.quit()).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
