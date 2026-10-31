import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { registerIpcHandlers } from "../src/main/ipc";
import { MainPlaybackHost } from "../src/main/player-host";
import { createElectronSecureSessionStore } from "../src/main/secure-session-store";
import { SessionController } from "../src/main/session-controller";
import { LibraryController } from "../src/main/library-controller";
import { NasApiClient } from "../src/main/nas-client";

const samplePath = join(process.cwd(), "assets", "test_video.mp4");
const subtitlePath = join(process.cwd(), "tests", "fixtures", "test_subtitle.srt");
const missingPath = join(process.cwd(), "assets", "missing-player-fixture.mp4");

type DialogResult = { canceled: boolean; filePaths: string[] };

async function waitFor(label: string, predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
}

async function readPlayer(window: BrowserWindow, expression: string): Promise<unknown> {
  return window.webContents.executeJavaScript(expression, true);
}

async function run(): Promise<void> {
  assert.equal(process.platform, "win32", "native player smoke is Windows-only");
  assert.equal(existsSync(samplePath), true, "local sample is required");
  assert.equal(existsSync(subtitlePath), true, "external subtitle fixture is required");
  assert.equal(existsSync(missingPath), false, "missing media fixture must remain absent");

  const testUserDataPath = await mkdtemp(join(tmpdir(), "z-video-player-user-data-"));
  const testSessionDataPath = await mkdtemp(join(tmpdir(), "z-video-player-session-data-"));
  app.setPath("userData", testUserDataPath);
  app.setPath("sessionData", testSessionDataPath);
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    show: true,
    backgroundColor: "#08090b",
    webPreferences: {
      preload: join(__dirname, "..", "src", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const dialogQueue: DialogResult[] = [
    { canceled: false, filePaths: [missingPath] },
    { canceled: false, filePaths: [samplePath] },
    { canceled: false, filePaths: [subtitlePath] },
  ];
  const fileDialog = {
    showOpenDialog: async (): Promise<DialogResult> => dialogQueue.shift() ?? { canceled: true, filePaths: [] },
  };
  const host = new MainPlaybackHost(window, fileDialog);
  const nas = new NasApiClient();
  const controller = new SessionController(nas, createElectronSecureSessionStore());
  registerIpcHandlers(controller, new LibraryController(controller, nas), host);
  await window.loadFile(join(resolve(__dirname, "..", "src", "renderer", "index.html")));

  try {
    const bridge = (await readPlayer(window, "typeof window.zVideo.player")) as string;
    assert.equal(bridge, "object", "production preload player bridge must be present");

    const missingOpen = (await readPlayer(window, "window.zVideo.player.chooseLocalFile()")) as { opened: boolean };
    assert.equal(missingOpen.opened, true, "main-owned picker should return the selected missing path");
    await waitFor("missing media error", async () => (await readPlayer(window, "document.querySelector('#player-status')?.textContent === '本地媒体加载失败。'")) === true);

    const opened = (await readPlayer(window, "window.zVideo.player.chooseLocalFile()")) as { opened: boolean };
    assert.equal(opened.opened, true, "main-owned picker should open the sample");
    await readPlayer(
      window,
      `(() => {
        document.querySelector('[data-view="login"]')?.setAttribute('hidden', '');
        document.querySelector('[data-view="library"]')?.setAttribute('hidden', '');
        document.querySelector('[data-view="player"]')?.removeAttribute('hidden');
      })()`,
    );
    await waitFor("native ready control state", async () => (await readPlayer(window, "document.querySelector('#player-toggle-button')?.disabled === false")) === true);
    await readPlayer(
      window,
      `(() => {
        document.querySelector('[data-view="login"]')?.setAttribute('hidden', '');
        document.querySelector('[data-view="library"]')?.setAttribute('hidden', '');
        document.querySelector('[data-view="player"]')?.removeAttribute('hidden');
      })()`,
    );

    const initialToggle = (await readPlayer(window, "document.querySelector('#player-toggle-button')?.textContent")) as string;
    assert.equal(initialToggle, "暂停", "real native playback should start playing");
    await readPlayer(window, "document.querySelector('#player-toggle-button')?.click()");
    await waitFor("DOM pause control", async () => (await readPlayer(window, "document.querySelector('#player-toggle-button')?.textContent === '播放'")) === true);

    await readPlayer(
      window,
      `(() => {
        const seek = document.querySelector('#player-seek');
        if (!(seek instanceof HTMLInputElement)) return false;
        seek.value = '1';
        seek.dispatchEvent(new Event('change', { bubbles: true }));
        seek.value = '0';
        return true;
      })()`,
    );
    await waitFor("DOM seek control", async () => {
      const position = Number(await readPlayer(window, "document.querySelector('#player-seek')?.value"));
      return Number.isFinite(position) && Math.abs(position - 1) <= 0.2;
    });

    await readPlayer(window, "document.querySelector('#player-subtitle-file-button')?.click()");
    await waitFor("external subtitle DOM option", async () => (await readPlayer(window, "document.querySelector('#player-subtitle-track')?.options.length > 1")) === true);
    const selectedSubtitle = (await readPlayer(window, "document.querySelector('#player-subtitle-track')?.value")) as string;
    assert.notEqual(selectedSubtitle, "", "libmpv sub-add select should select the external subtitle in the DOM");

    await readPlayer(
      window,
      `(() => {
        const select = document.querySelector('#player-subtitle-track');
        if (!(select instanceof HTMLSelectElement)) return false;
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.value = '${selectedSubtitle.replace(/'/g, "\\'")}';
        return true;
      })()`,
    );
    await waitFor("DOM subtitle off event", async () => (await readPlayer(window, "document.querySelector('#player-subtitle-track')?.value === ''")) === true);

    await readPlayer(
      window,
      `(() => {
        const select = document.querySelector('#player-subtitle-track');
        if (!(select instanceof HTMLSelectElement)) return false;
        select.value = '${selectedSubtitle.replace(/'/g, "\\'")}';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.value = '';
        return true;
      })()`,
    );
    await waitFor("DOM subtitle selected event", async () => (await readPlayer(window, `document.querySelector('#player-subtitle-track')?.value === '${selectedSubtitle.replace(/'/g, "\\'")}'`)) === true);

    await readPlayer(
      window,
      `(() => {
        const select = document.querySelector('#player-subtitle-track');
        if (!(select instanceof HTMLSelectElement)) return false;
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.value = '${selectedSubtitle.replace(/'/g, "\\'")}';
        return true;
      })()`,
    );
    await waitFor("DOM subtitle off control", async () => (await readPlayer(window, "document.querySelector('#player-subtitle-track')?.value === ''")) === true);

    await readPlayer(window, "document.querySelector('#player-fullscreen-button')?.click()");
    await waitFor("DOM fullscreen on control", async () => window.isFullScreen());
    await readPlayer(window, "document.querySelector('#player-fullscreen-button')?.click()");
    await waitFor("DOM fullscreen off control", async () => !window.isFullScreen());

    const holdMs = Number(process.env.Z_VIDEO_PLAYER_SMOKE_HOLD_MS ?? 0);
    if (Number.isFinite(holdMs) && holdMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, holdMs));

    await readPlayer(window, "document.querySelector('#player-close-button')?.click()");
    await waitFor("DOM close control", async () => (await readPlayer(window, "document.querySelector('[data-view=player]')?.hidden")) === true);
  } finally {
    for (const channel of ["player:choose-local-file", "player:choose-subtitle-file", "player:command"]) ipcMain.removeHandler(channel);
    await host.close();
    if (!window.isDestroyed()) window.close();
    await app.quit();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
