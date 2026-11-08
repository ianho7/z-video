import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

import { createMainWindow } from "../src/main/window";
import { MainLocalPlaybackHost } from "../src/main/player-host";
import { registerLocalPlaybackIpcHandlers } from "../src/main/local-playback-ipc";
import type { LocalPlaybackStore } from "../src/shared/local-playback-contracts";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(label: string, predicate: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + 10_000;
  while (!(await predicate())) { if (Date.now() > end) throw new Error(`timed out waiting for ${label}`); await delay(100); }
}

async function run(): Promise<void> {
  app.setPath("userData", await mkdtemp(join(tmpdir(), "z-video-overlay-test-")));
  await app.whenReady();
  const window = createMainWindow();
  const store: LocalPlaybackStore = {
    resolveMediaPath: async () => join(process.cwd(), "assets", "test_video.mp4"),
    getPlayback: async () => undefined,
    savePlayback: async (value) => value,
  };
  const host = new MainLocalPlaybackHost(window, store);
  const unregister = registerLocalPlaybackIpcHandlers(host);
  try {
    await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    await host.open("media_123e4567-e89b-42d3-a456-426614174000");
    await waitFor("overlay controls", async () => {
      const overlay = BrowserWindow.getAllWindows().find((candidate) => candidate !== window);
      return !!overlay && await overlay.webContents.executeJavaScript("document.querySelector('#player-toggle-button')?.textContent === '暂停'");
    });
    const overlay = BrowserWindow.getAllWindows().find((candidate) => candidate !== window)!;
    const read = (expression: string) => overlay.webContents.executeJavaScript(expression);
    assert.equal(await read("document.querySelector('#player-next-button').hidden"), true, "no next episode hides the entire button");
    assert.equal(await read("document.querySelector('#player-toggle-button').getAttribute('aria-label')"), "暂停");
    assert.equal(await read("!!document.querySelector('#player-toggle-button svg') && !!document.querySelector('#player-close-button svg')"), true);
    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true }))");
    await delay(300);
    assert.equal(window.isFullScreen(), false, "Ctrl+F does not trigger the player shortcut");
    await read("document.querySelector('#player-fullscreen-button').click()");
    await waitFor("full screen", async () => window.isFullScreen());
    await waitFor("idle controls hidden", () => read("document.body.classList.contains('overlay-hidden')"));
    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX' }))");
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "keyboard activity reveals controls");
    await waitFor("idle controls hidden again", () => read("document.body.classList.contains('overlay-hidden')"));
    await read("window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 100 }))");
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "mouse activity reveals controls");
    await read("document.querySelector('#player-toggle-button').click()");
    await waitFor("pause", () => read("document.querySelector('#player-toggle-button').textContent === '播放'"));
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "pause keeps controls visible");
    await read("document.querySelector('#player-toggle-button').click()");
    await waitFor("playing", () => read("document.querySelector('#player-toggle-button').textContent === '暂停'"));
    await read("document.querySelector('#player-settings-button').click()");
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "open settings keep controls visible");
    await read("document.querySelector('#player-settings-close').click(); document.querySelector('#player-seek').focus()");
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "focused controls remain visible");
    await read("document.activeElement.blur(); document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "dragging keeps controls visible");
    await read("window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))");
    await host.handle({ type: "close" });
    await waitFor("overlay closed", async () => !overlay.isVisible());
    await delay(3300);
    assert.equal(await read("document.body.classList.contains('overlay-hidden')"), false, "closing cancels the pending hide timer");
    await host.open("media_123e4567-e89b-42d3-a456-426614174001");
    await waitFor("overlay reopened for another media item", async () => overlay.isVisible());
    await waitFor("new media controls", () => read("document.querySelector('#player-toggle-button').textContent === '暂停' && !document.body.classList.contains('overlay-hidden')"));
    console.log("PASS: player overlay state, commands, idle and visibility lifecycle (synthetic DOM events)");
  } finally {
    unregister(); await host.close(); if (!window.isDestroyed()) window.destroy(); app.quit();
  }
}

void run().catch((error) => { console.error(error); app.exit(1); });
