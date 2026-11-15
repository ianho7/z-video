import assert from "node:assert/strict";

import { app, ipcMain } from "electron";

import {
  MISSING_MEDIA_ID,
  MISSING_TITLE,
  SAMPLE_MEDIA_ID,
  SAMPLE_TITLE,
  startPlayerWindowFixture,
  subtitlePath,
} from "./player-window-fixture";

const delay = (ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitForWindow(label: string, predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(100);
  }
}

/**
 * Real native playback smoke for the local player. The renderer opens the
 * player through its production flow (work card -> detail -> play); a real
 * libmpv session then proves the controls and every close exit.
 */
async function run(): Promise<void> {
  const fixture = await startPlayerWindowFixture([{ canceled: false, filePaths: [subtitlePath] }]);
  const { window, host, read, waitFor, openFromLibrary } = fixture;
  try {
    const bridge = await read<boolean>(
      `typeof window.zVideo.localPlayback === "object" && typeof window.zVideo.localPlayback.open === "function"`,
    );
    assert.equal(bridge, true, "production preload local playback bridge must be present");

    // A failed open is a main-owned error, never a stuck player view.
    await openFromLibrary(MISSING_MEDIA_ID);
    await waitFor(
      "missing media error",
      `document.querySelector('#player-status')?.textContent === '本地媒体加载失败。' && document.querySelector('#player-error')?.hidden === false`,
    );
    assert.equal(
      await read(`document.querySelector('#player-error-message')?.textContent`),
      "本地媒体加载失败。",
      "the player error panel names the failed local media",
    );
    await read(`document.querySelector('#player-error-back')?.click()`);
    await waitFor("player hidden after the failed open", `document.querySelector('[data-view="player"]')?.hidden === true`);
    await waitFor("detail after the failed open", `document.querySelector('#media-detail')?.hidden === false && document.querySelector('#media-detail-title')?.textContent === ${JSON.stringify(MISSING_TITLE)}`);
    await read(`document.querySelector('#media-detail-back')?.click()`);
    await waitFor("home after the failed open", `document.querySelectorAll('#recent-row [data-media-id]').length >= 2`);

    // Real sample playback through the production open flow.
    await openFromLibrary(SAMPLE_MEDIA_ID);
    await waitFor(
      "native ready control state",
      `document.querySelector('#player-toggle-button')?.disabled === false && document.querySelector('#player-toggle-button')?.textContent === '暂停'`,
    );
    assert.equal(await read(`document.querySelector('#player-current-title')?.textContent`), SAMPLE_TITLE, "the player mirrors the opened work title");
    assert.equal(await read(`document.querySelector('#player-seek')?.disabled`), false, "native playback enables the seek control");
    assert.equal(await read(`document.querySelector('#player-toggle-button')?.textContent`), "暂停", "real native playback should start playing");

    await read(`document.querySelector('#player-toggle-button')?.click()`);
    await waitFor("DOM pause control", `document.querySelector('#player-toggle-button')?.textContent === '播放'`);

    // Seek while paused so the sampled position cannot drift past the tolerance.
    await read(`(() => {
      const seek = document.querySelector('#player-seek');
      if (!(seek instanceof HTMLInputElement)) return false;
      seek.value = '1';
      seek.dispatchEvent(new Event('change', { bubbles: true }));
      seek.value = '0';
      return true;
    })()`);
    await waitFor("DOM seek control", `(() => {
      const position = Number(document.querySelector('#player-seek')?.value);
      return Number.isFinite(position) && Math.abs(position - 1) <= 0.2;
    })()`);

    // External subtitle: the picker adds the track and libmpv selects it.
    await read(`document.querySelector('#player-subtitle-file-button')?.click()`);
    await waitFor("external subtitle option", `document.querySelectorAll('#player-subtitle-chips .player-chip').length > 1`);
    const selectedSubtitle = await read<{ value: string; label: string } | null>(`(() => {
      const chip = [...document.querySelectorAll('#player-subtitle-chips .player-chip')].find((candidate) => candidate.getAttribute('aria-pressed') === 'true' && candidate.dataset.value);
      return chip ? { value: chip.dataset.value, label: chip.textContent } : null;
    })()`);
    assert.ok(selectedSubtitle?.value, "libmpv sub-add selects the external subtitle in the player UI");
    await read(`(() => {
      const chip = [...document.querySelectorAll('#player-subtitle-chips .player-chip')].find((candidate) => candidate.dataset.value === '');
      if (chip instanceof HTMLElement) chip.click();
    })()`);
    await waitFor("subtitle off control", `document.querySelector('#player-subtitle-value')?.textContent === '关闭'`);
    await read(`(() => {
      const chip = [...document.querySelectorAll('#player-subtitle-chips .player-chip')].find((candidate) => candidate.dataset.value === ${JSON.stringify(selectedSubtitle!.value)});
      if (chip instanceof HTMLElement) chip.click();
    })()`);
    await waitFor("subtitle selected control", `document.querySelector('#player-subtitle-value')?.textContent === ${JSON.stringify(selectedSubtitle!.label)}`);

    await read(`document.querySelector('#player-fullscreen-button')?.click()`);
    await waitForWindow("window fullscreen on", () => window.isFullScreen());
    assert.equal(await read(`document.querySelector('#player-fullscreen-button')?.textContent`), "退出全屏");
    await read(`document.querySelector('#player-fullscreen-button')?.click()`);
    await waitForWindow("window fullscreen off", () => !window.isFullScreen());
    assert.equal(await read(`document.querySelector('#player-fullscreen-button')?.textContent`), "全屏");

    const holdMs = Number(process.env.Z_VIDEO_PLAYER_SMOKE_HOLD_MS ?? 0);
    if (Number.isFinite(holdMs) && holdMs > 0) await delay(holdMs);

    // Normal close: the main-owned `closed` event dismantles the view once.
    await read(`document.querySelector('#player-close-button')?.click()`);
    await waitFor("player hidden after close", `document.querySelector('[data-view="player"]')?.hidden === true`);
    await waitFor("detail after close", `document.querySelector('#media-detail')?.hidden === false && document.querySelector('#media-detail-title')?.textContent === ${JSON.stringify(SAMPLE_TITLE)}`);
    window.webContents.send("local-playback:event", { type: "closed" });
    await delay(300);
    assert.equal(await read(`document.querySelector('[data-view="player"]')?.hidden === true && document.querySelector('#media-detail')?.hidden === false`), true, "a duplicate closed event never dismantles the view twice");

    // Ticket 06 fallback: a close command whose answer is lost still leaves the
    // player after 1.5s, and a late real `closed` afterwards is idempotent.
    await read(`document.querySelector('#media-detail-open')?.click()`);
    await waitFor(
      "player reopened for the close fallback",
      `document.querySelector('[data-view="player"]')?.hidden === false && document.querySelector('#player-toggle-button')?.textContent === '暂停'`,
    );
    ipcMain.removeHandler("local-playback:command");
    ipcMain.handle("local-playback:command", () => new Promise(() => undefined));
    await read(`document.querySelector('#player-close-button')?.click()`);
    await delay(400);
    assert.equal(await read(`document.querySelector('[data-view="player"]')?.hidden === false`), true, "the close request starts from the visible player");
    await waitFor("close fallback leaves the player", `document.querySelector('[data-view="player"]')?.hidden === true`, 4_000);
    await waitFor("detail after the close fallback", `document.querySelector('#media-detail')?.hidden === false && document.querySelector('#media-detail-title')?.textContent === ${JSON.stringify(SAMPLE_TITLE)}`);
    await host.close();
    window.webContents.send("local-playback:event", { type: "closed" });
    await delay(300);
    assert.equal(
      await read(`document.querySelector('[data-view="player"]')?.hidden === true && document.querySelector('#media-detail')?.hidden === false`),
      true,
      "a late real closed event after the fallback is ignored",
    );
    assert.equal(await read(`document.querySelector('#player-status')?.textContent`), "", "the fallback resets the player status");

    console.log("PASS: real native playback controls, failed open, close fallback and idempotent teardown");
  } finally {
    await fixture.cleanup();
    await app.quit();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
