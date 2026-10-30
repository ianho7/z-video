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

async function run(): Promise<void> {
  await app.whenReady();
  ipcMain.handle("session:restore", async () => loggedOutState);
  ipcMain.handle("session:login", async () => ({ state: authenticatedState }));
  ipcMain.handle("session:send-mfa", async () => ({ state: { ...loggedOutState, status: "mfa-required" } }));
  ipcMain.handle("session:verify-mfa", async () => ({ state: authenticatedState }));
  ipcMain.handle("session:logout", async () => ({ state: loggedOutState }));
  ipcMain.handle("library:list-classifications", async () => ({ classifications: [], state: authenticatedState }));

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
      playerControls: Boolean(document.querySelector('#player-seek') && document.querySelector('#player-audio-track'))
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
      category: document.querySelector('#classification-list')?.textContent || ''
    })`,
    true,
  )) as { loginHidden: boolean; libraryVisible: boolean; category: string };
  assert.equal(afterSubmit.loginHidden, true);
  assert.equal(afterSubmit.libraryVisible, true);
  assert.match(afterSubmit.category, /电影/);

  window.close();
  for (const channel of [
    "session:restore",
    "session:login",
    "session:send-mfa",
    "session:verify-mfa",
    "session:logout",
    "library:list-classifications",
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
