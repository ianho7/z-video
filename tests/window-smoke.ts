import assert from "node:assert/strict";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

const smokeUserData = process.env.Z_VIDEO_WINDOW_SMOKE_PROFILE ?? join(process.env.TEMP ?? process.cwd(), `z-video-electron-window-smoke-${process.pid}`);
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
  totalCount: 50_000_000,
  totalPages: 1_000_000,
  loadedCount: 1,
  coverage: "server-page",
  scopeDescription: "当前已加载范围：第 1 页 1/50000000 项；共 1000000 页",
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
  const collectionQueries: Array<Record<string, unknown>> = [];
  const detailQueries: Array<Record<string, unknown>> = [];
  const playerCommands: Array<Record<string, unknown>> = [];
  ipcMain.handle("session:restore", async () => loggedOutState);
  ipcMain.handle("session:login", async () => ({ state: authenticatedState }));
  ipcMain.handle("session:send-mfa", async () => ({ state: { ...loggedOutState, status: "mfa-required" } }));
  ipcMain.handle("session:verify-mfa", async () => ({ state: authenticatedState }));
  ipcMain.handle("session:logout", async () => ({ state: loggedOutState }));
  ipcMain.handle("library:list-classifications", async () => ({ classifications: [], state: authenticatedState }));
  ipcMain.handle("library:get-navigation", async () => ({ view: "library", library: { classificationId: "movie", page: 1, pageSize: 50, filter: "all", sort: "recent", scrollTop: 0 } }));
  ipcMain.handle("library:set-navigation", async (_event, context) => context);
  ipcMain.handle("library:list-collections", async (_event, query) => {
    collectionQueries.push(query as Record<string, unknown>);
    return { state: authenticatedState, page: fixturePage };
  });
  ipcMain.handle("library:get-detail", async (_event, input) => {
    detailQueries.push(input as Record<string, unknown>);
    return { state: authenticatedState, detail: fixtureDetail };
  });
  ipcMain.handle("library:list-continue-watching", async () => ({
    state: authenticatedState,
    items: [{ collectionId: "fixture-collection", classificationId: "tv", episodeId: "fixture-episode", title: "窗口测试影片", episodeTitle: "正片", watchedSeconds: 12, durationSeconds: 90, progressPercent: 13, progressLabel: "已看 13%", durationLabel: "01:30", imageKey: "fixture-collection|cover" }],
  }));
  ipcMain.handle("library:load-image", async () => ({ state: authenticatedState, dataUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", mimeType: "image/gif" }));
  ipcMain.handle("player:command", async (_event, command) => {
    playerCommands.push(command as Record<string, unknown>);
  });
  ipcMain.handle("discovery:start", async () => ({
    status: "success",
    requestId: 1,
    report: {
      results: [{ ip: "192.168.5.2", name: "Fixture NAS", available: true }],
      candidateCount: 2,
      truncated: false,
    },
  }));
  ipcMain.handle("discovery:cancel", async () => ({ cancelled: true }));

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
      discoveryApi: typeof window.zVideo.discovery === 'object',
      loginView: document.querySelector('[data-view="login"]')?.hidden === false,
      serverInput: Boolean(document.querySelector('#server-url')),
      playerBridge: typeof window.zVideo.player === 'object',
      playerControls: Boolean(document.querySelector('#player-seek') && document.querySelector('#player-audio-track') && document.querySelector('#player-subtitle-file-button'))
    })`,
    true,
  )) as { bridge: boolean; nodeRequire: string; nodeProcess: string; discoveryApi: boolean; loginView: boolean; serverInput: boolean; playerBridge: boolean; playerControls: boolean };
  assert.equal(initial.bridge, true);
  assert.equal(initial.nodeRequire, "undefined");
  assert.equal(initial.nodeProcess, "undefined");
  assert.equal(initial.discoveryApi, true);
  assert.equal(initial.loginView, true);
  assert.equal(initial.serverInput, true);
  assert.equal(initial.playerBridge, true);
  assert.equal(initial.playerControls, true);

  await window.webContents.executeJavaScript(
    `document.querySelector('#discover-button').click()`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  const discovery = (await window.webContents.executeJavaScript(
    `({
      result: document.querySelector('[data-discovery-ip]')?.textContent || '',
      status: document.querySelector('#discovery-status')?.textContent || ''
    })`,
    true,
  )) as { result: string; status: string };
  assert.match(discovery.result, /使用此地址/);
  assert.match(discovery.status, /发现 1 台 NAS/);
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-discovery-ip="192.168.5.2"]').click()`,
    true,
  );
  const selectedAddress = await window.webContents.executeJavaScript(
    `document.querySelector('#server-url').value`,
    true,
  ) as string;
  assert.equal(selectedAddress, "http://192.168.5.2:5055");

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
       scope: document.querySelector('#library-scope')?.textContent || '',
       continueEpisode: document.querySelector('[data-continue-episode-id]')?.getAttribute('data-continue-episode-id') || '',
       paginationButtons: document.querySelectorAll('#library-pagination button[data-page]').length
    })`,
    true,
  )) as { loginHidden: boolean; libraryVisible: boolean; category: string; card: string; scope: string; continueEpisode: string; paginationButtons: number };
  assert.equal(afterSubmit.loginHidden, true);
  assert.equal(afterSubmit.libraryVisible, true);
  assert.match(afterSubmit.category, /电影/);
  assert.match(afterSubmit.card, /窗口测试影片/);
  assert.match(afterSubmit.scope, /当前已加载范围/);
  assert.equal(afterSubmit.continueEpisode, "fixture-episode");
  assert.ok(afterSubmit.paginationButtons <= 10);

  await window.webContents.executeJavaScript(
    `document.querySelector('[data-continue-collection-id="fixture-collection"]').click()`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const continueDetail = (await window.webContents.executeJavaScript(
    `({ hidden: document.querySelector('#detail-section')?.hidden, selected: document.querySelector('[data-episode-id="fixture-episode"]')?.getAttribute('aria-selected') || '' })`,
    true,
  )) as { hidden: boolean; selected: string };
  assert.equal(continueDetail.hidden, false);
  assert.equal(continueDetail.selected, "true");
  assert.equal(detailQueries.at(-1)?.classificationId, "tv");
  await window.webContents.executeJavaScript(`document.querySelector('[data-detail-action="play"]').click()`, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(playerCommands.at(-1)?.classificationId, "tv");
  assert.equal(playerCommands.at(-1)?.episodeId, "fixture-episode");
  await window.webContents.executeJavaScript(`document.querySelector('[data-detail-action="back"]').click()`, true);
  await new Promise((resolve) => setTimeout(resolve, 150));

  await window.webContents.executeJavaScript(
    `(() => { const input = document.querySelector('#library-search-input'); input.value = '窗口'; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-collection-id="fixture-collection"]').click(); return true; })()`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  const immediateDetail = (await window.webContents.executeJavaScript(
    `({ hidden: document.querySelector('#detail-section')?.hidden, title: document.querySelector('#detail-title')?.textContent || '' })`,
    true,
  )) as { hidden: boolean; title: string };
  assert.equal(immediateDetail.hidden, false);
  assert.match(immediateDetail.title, /窗口测试影片/);
  await window.webContents.executeJavaScript(`document.querySelector('[data-detail-action="back"]').click()`, true);
  await new Promise((resolve) => setTimeout(resolve, 150));

  const queriesBeforeSearch = collectionQueries.length;
  await window.webContents.executeJavaScript(
    `(() => { const input = document.querySelector('#library-search-input'); input.value = '窗口'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(collectionQueries.length, queriesBeforeSearch + 1);
  assert.equal(collectionQueries.at(-1)?.query, "窗口");
  await window.webContents.executeJavaScript("document.querySelector('#library-search-clear').click()", true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(collectionQueries.at(-1)?.query, undefined);

  await window.webContents.executeJavaScript(
    `document.querySelector('#sidebar-toggle-button').click()`,
    true,
  );
  const collapsedSidebar = (await window.webContents.executeJavaScript(
    `({ collapsed: document.querySelector('[data-view="library"]')?.classList.contains('sidebar-collapsed'), expanded: document.querySelector('#sidebar-toggle-button')?.getAttribute('aria-expanded'), hidden: document.querySelector('#classification-sidebar')?.getAttribute('aria-hidden') })`,
    true,
  )) as { collapsed: boolean; expanded: string | null; hidden: string | null };
  assert.equal(collapsedSidebar.collapsed, true);
  assert.equal(collapsedSidebar.expanded, "false");
  assert.equal(collapsedSidebar.hidden, "true");
  await window.webContents.executeJavaScript(
    `document.querySelector('#sidebar-toggle-button').click()`,
    true,
  );
  const expandedSidebar = (await window.webContents.executeJavaScript(
    `({ collapsed: document.querySelector('[data-view="library"]')?.classList.contains('sidebar-collapsed'), expanded: document.querySelector('#sidebar-toggle-button')?.getAttribute('aria-expanded') })`,
    true,
  )) as { collapsed: boolean; expanded: string | null };
  assert.equal(expandedSidebar.collapsed, false);
  assert.equal(expandedSidebar.expanded, "true");

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
    "player:command",
    "discovery:start",
    "discovery:cancel",
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
