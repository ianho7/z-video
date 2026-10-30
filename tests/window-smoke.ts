import assert from "node:assert/strict";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

const smokeUserData = join(process.env.TEMP ?? process.cwd(), `z-video-electron-window-smoke-${process.pid}`);
app.setPath("userData", smokeUserData);
app.setPath("sessionData", join(smokeUserData, "session"));

const loggedOutState = { status: "logged-out", classifications: [] };
const authenticatedState = {
  status: "authenticated",
  identity: { serverUrl: "http://127.0.0.1:5055", username: "fixture-user", nasId: "fixture-nas" },
  classifications: [{ id: "movie", name: "电影", count: 2, isSystem: true, isEnabled: true }],
};

const fixturePage = {
  query: { classificationId: "movie", page: 1, pageSize: 50, filter: "all", sort: "recent" },
  page: 1,
  pageSize: 50,
  totalCount: 1,
  totalPages: 1,
  loadedCount: 1,
  coverage: "server-page",
  scopeDescription: "当前已加载范围：第 1 页 1/1 项；共 1 页",
  collections: [{ collectionId: "fixture-collection", title: "窗口测试影片", cover: "", releaseYear: "2026", videoType: "movie", imageKey: "fixture-collection|cover" }],
};

const fixtureDetail = {
  collectionId: "fixture-collection",
  title: "窗口测试影片",
  cover: "",
  releaseYear: "2026",
  videoType: "movie",
  seasons: [{ seasonNumber: 1, title: "正片", episodes: [{ episodeId: "fixture-episode", episodeNumber: 1, title: "正片", durationSec: 90, seasonNumber: 1 }] }],
};

async function run(): Promise<void> {
  await app.whenReady();
  ipcMain.handle("session:restore", async () => loggedOutState);
  ipcMain.handle("session:login", async () => ({ state: authenticatedState }));
  ipcMain.handle("session:send-mfa", async () => ({ state: { ...loggedOutState, status: "mfa-required" } }));
  ipcMain.handle("session:verify-mfa", async () => ({ state: authenticatedState }));
  ipcMain.handle("session:logout", async () => ({ state: loggedOutState }));
  ipcMain.handle("library:list-classifications", async () => ({ classifications: [], state: authenticatedState }));
  ipcMain.handle("library:get-navigation", async () => ({ view: "library", library: { classificationId: "movie", page: 1, pageSize: 50, filter: "all", sort: "recent", scrollTop: 0 } }));
  ipcMain.handle("library:set-navigation", async (_event, context) => context);
  ipcMain.handle("library:list-collections", async () => ({ state: authenticatedState, page: fixturePage }));
  ipcMain.handle("library:get-detail", async () => ({ state: authenticatedState, detail: fixtureDetail }));
  ipcMain.handle("library:list-continue-watching", async () => ({ state: authenticatedState, items: [] }));
  ipcMain.handle("library:load-image", async () => ({ state: authenticatedState, dataUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", mimeType: "image/gif" }));

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

  const initial = (await window.webContents.executeJavaScript(
    `({
      bridge: typeof window.zVideo === "object",
      nodeRequire: typeof require,
      nodeProcess: typeof process,
      loginView: document.querySelector('[data-view="login"]')?.hidden === false,
      serverInput: Boolean(document.querySelector('#server-url')),
      playerBridge: typeof window.zVideo.player === 'object',
      playerControls: Boolean(document.querySelector('#player-seek') && document.querySelector('#player-audio-track') && document.querySelector('#player-subtitle-file-button'))
    })`,
    true,
  )) as { bridge: boolean; nodeRequire: string; nodeProcess: string; loginView: boolean; serverInput: boolean; playerBridge: boolean; playerControls: boolean };
  assert.equal(initial.bridge, true);
  assert.equal(initial.nodeRequire, "undefined");
  assert.equal(initial.nodeProcess, "undefined");
  assert.equal(initial.loginView, true);
  assert.equal(initial.serverInput, true);
  assert.equal(initial.playerBridge, true);
  assert.equal(initial.playerControls, true);

  await window.webContents.executeJavaScript(
    `(() => {
      document.querySelector('#server-url').value = '127.0.0.1:5055';
      document.querySelector('#username').value = 'fixture-user';
      document.querySelector('#password').value = 'fixture-password';
      document.querySelector('#login-form').requestSubmit();
      return true;
    })()`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const afterSubmit = (await window.webContents.executeJavaScript(
    `({
      loginHidden: document.querySelector('[data-view="login"]')?.hidden === true,
      libraryVisible: document.querySelector('[data-view="library"]')?.hidden === false,
      category: document.querySelector('#classification-list')?.textContent || '',
      card: document.querySelector('[data-collection-id]')?.textContent || '',
      scope: document.querySelector('#library-scope')?.textContent || ''
    })`,
    true,
  )) as { loginHidden: boolean; libraryVisible: boolean; category: string; card: string; scope: string };
  assert.equal(afterSubmit.loginHidden, true);
  assert.equal(afterSubmit.libraryVisible, true);
  assert.match(afterSubmit.category, /电影/);
  assert.match(afterSubmit.card, /窗口测试影片/);
  assert.match(afterSubmit.scope, /当前已加载范围/);

  await window.webContents.executeJavaScript(
    `document.querySelector('[data-collection-id="fixture-collection"]').click()`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  const detail = (await window.webContents.executeJavaScript(
    `({ hidden: document.querySelector('#detail-section')?.hidden, title: document.querySelector('#detail-title')?.textContent || '', episode: document.querySelector('[data-episode-id]')?.textContent || '' })`,
    true,
  )) as { hidden: boolean; title: string; episode: string };
  assert.equal(detail.hidden, false);
  assert.match(detail.title, /窗口测试影片/);
  assert.match(detail.episode, /正片/);

  window.close();
  for (const channel of [
    "session:restore",
    "session:login",
    "session:send-mfa",
    "session:verify-mfa",
    "session:logout",
    "library:list-classifications",
    "library:get-navigation",
    "library:set-navigation",
    "library:list-collections",
    "library:get-detail",
    "library:list-continue-watching",
    "library:load-image",
  ]) {
    ipcMain.removeHandler(channel);
  }
}

run()
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
