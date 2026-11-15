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
    assert.equal(
      await read(`document.querySelector('#player-marker-delete')?.hidden`),
      true,
      "seeking an unmarked bar only seeks; no marker confirmation appears",
    );

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

    // Ticket 22a: a file without markers renders no tick layer at all.
    assert.equal(
      await read(`(() => { const layer = document.querySelector('#player-marker-ticks'); return Boolean(layer) && layer.hidden === true && layer.childElementCount === 0; })()`),
      true,
      "a file without markers renders no tick layer",
    );
    assert.equal(
      await read(`document.querySelector('#player-marker-delete')?.hidden`),
      true,
      "without markers there is no marker delete control",
    );

    // `B` during real playback records the current whole second and never pauses.
    await read(`document.querySelector('#player-toggle-button')?.click()`);
    await waitFor("playback resumed for the marker test", `document.querySelector('#player-toggle-button')?.textContent === '暂停'`);
    await waitFor("playback position advanced", `Number(document.querySelector('#player-seek')?.value) >= 2`);
    const seekBeforeMarker = Number(await read(`document.querySelector('#player-seek')?.value`));
    await read(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB' }))`);
    await waitFor("marker tick after B", `document.querySelectorAll('#player-marker-ticks .player-marker-tick').length === 1`);
    assert.equal(await read(`document.querySelector('#player-marker-ticks')?.hidden`), false, "the tick layer appears once the file has a marker");
    const firstTick = await read<{ positionSec: string; left: string } | null>(`(() => {
      const tick = document.querySelector('#player-marker-ticks .player-marker-tick');
      return tick ? { positionSec: tick.dataset.positionSec ?? '', left: tick.style.left } : null;
    })()`);
    assert.equal(Number.isInteger(Number(firstTick?.positionSec)), true, "the marker is a whole second");
    assert.ok(
      Math.abs(Number(firstTick?.positionSec) - Math.floor(seekBeforeMarker)) <= 1,
      "the marker sits on the second playback had reached",
    );
    assert.equal(firstTick?.left.endsWith("%"), true, "the tick is positioned as a percentage of the duration");
    assert.equal(await read(`document.querySelector('#player-toggle-button')?.textContent`), "暂停", "recording a marker never interrupts playback");

    // A second marker at a later second joins the layer in ascending order.
    const firstMarkerSec = Number(firstTick?.positionSec);
    await waitFor("playback advanced past the first marker", `Number(document.querySelector('#player-seek')?.value) >= ${firstMarkerSec + 1}`);
    await read(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB' }))`);
    await waitFor("second marker tick", `document.querySelectorAll('#player-marker-ticks .player-marker-tick').length === 2`);
    const tickPositions = await read<number[]>(`[...document.querySelectorAll('#player-marker-ticks .player-marker-tick')].map((tick) => Number(tick.dataset.positionSec))`);
    assert.equal(tickPositions.length, 2);
    assert.equal(Number.isInteger(tickPositions[0]) && Number.isInteger(tickPositions[1]), true);
    assert.ok(tickPositions[0] < tickPositions[1], "ticks keep ascending whole-second order");
    assert.equal(await read(`document.querySelector('#player-toggle-button')?.textContent`), "暂停", "the second B press also leaves playback running");

    // Ticket 22b: clicking a tick jumps to that second, selects the marker and
    // exposes one explicit inline delete confirmation (no context menu, no dialog).
    await read(`document.querySelector('#player-toggle-button')?.click()`);
    await waitFor("paused before the marker interaction", `document.querySelector('#player-toggle-button')?.textContent === '播放'`);
    assert.equal(
      await read(`document.querySelector('#player-marker-delete')?.hidden`),
      true,
      "a marker is not selected until a tick is clicked",
    );
    const jumpMarkerSec = tickPositions[0];
    await read(`document.querySelector('#player-marker-tick-${jumpMarkerSec}')?.click()`);
    await waitFor("seek to the clicked marker", `(() => {
      const position = Number(document.querySelector('#player-seek')?.value);
      return Number.isFinite(position) && Math.abs(position - ${jumpMarkerSec}) <= 2;
    })()`);
    assert.equal(await read(`document.querySelector('#player-marker-delete')?.hidden`), false, "a selected marker exposes the delete control");
    assert.match(await read<string>(`document.querySelector('#player-marker-delete')?.textContent ?? ''`), /删除标记/u, "the delete control names the marker action");
    assert.equal(
      await read(`document.querySelector('#player-marker-tick-${jumpMarkerSec}')?.dataset.selected`),
      "true",
      "the clicked tick is marked as selected",
    );
    await read(`document.querySelector('#player-marker-delete')?.click()`);
    await waitFor("deleted tick disappears", `document.querySelectorAll('#player-marker-ticks .player-marker-tick').length === 1`);
    assert.equal(
      await read(`document.querySelector('#player-marker-delete')?.hidden`),
      true,
      "the delete control disappears once its marker is gone",
    );
    assert.equal(await read(`Boolean(document.querySelector('#player-marker-tick-${jumpMarkerSec}'))`), false, "the deleted second is no longer a tick");
    assert.match(
      await read<string>(`document.querySelector('#player-control-notice-text')?.textContent ?? ''`),
      /已删除标记/u,
      "a successful delete is visible",
    );

    // A failed delete keeps the stored marker, keeps it selected for retry and
    // reports the failure in the visible non-blocking strip.
    const keepMarkerSec = tickPositions[1];
    await read(`document.querySelector('#player-marker-tick-${keepMarkerSec}')?.click()`);
    await waitFor("second marker selected", `document.querySelector('#player-marker-delete')?.hidden === false`);
    ipcMain.removeHandler("local-library:markers-remove");
    ipcMain.handle("local-library:markers-remove", () => { throw new Error("database is locked"); });
    await read(`document.querySelector('#player-marker-delete')?.click()`);
    await waitFor(
      "visible marker delete failure feedback",
      `document.querySelector('#player-control-notice')?.hidden === false && (document.querySelector('#player-control-notice-text')?.textContent ?? '').includes('标记没有删除成功')`,
    );
    assert.equal(
      await read(`document.querySelectorAll('#player-marker-ticks .player-marker-tick').length`),
      1,
      "a failed delete keeps the stored marker on the bar",
    );
    assert.equal(await read(`document.querySelector('#player-marker-delete')?.hidden`), false, "a failed delete keeps the marker selected for retry");
    assert.equal(await read(`document.querySelector('#player-marker-delete')?.disabled`), false, "a failed delete leaves the retry control enabled");
    assert.equal(
      await read(`document.querySelector('#player-marker-tick-${keepMarkerSec}')?.dataset.selected`),
      "true",
      "a failed delete keeps the marker visually selected",
    );
    await read(`document.querySelector('#player-toggle-button')?.click()`);
    await waitFor("playback resumed after the marker interaction", `document.querySelector('#player-toggle-button')?.textContent === '暂停'`);

    await read(`document.querySelector('#player-fullscreen-button')?.click()`);
    await waitForWindow("window fullscreen on", () => window.isFullScreen());
    assert.equal(await read(`document.querySelector('#player-fullscreen-button')?.textContent`), "退出全屏");
    await read(`document.querySelector('#player-fullscreen-button')?.click()`);
    await waitForWindow("window fullscreen off", () => !window.isFullScreen());
    assert.equal(await read(`document.querySelector('#player-fullscreen-button')?.textContent`), "全屏");

    const holdMs = Number(process.env.Z_VIDEO_PLAYER_SMOKE_HOLD_MS ?? 0);
    if (Number.isFinite(holdMs) && holdMs > 0) await delay(holdMs);

    // Ticket 22a: a failed marker write is visible and never paints a phantom tick.
    ipcMain.removeHandler("local-library:markers-add");
    ipcMain.handle("local-library:markers-add", () => { throw new Error("database is locked"); });
    await read(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB' }))`);
    await waitFor(
      "visible marker failure feedback",
      `document.querySelector('#player-control-notice')?.hidden === false && (document.querySelector('#player-control-notice-text')?.textContent ?? '').includes('标记没有记录成功')`,
    );
    // Ticket 22b deleted the first of the two markers above, so one tick remains.
    assert.equal(
      await read(`document.querySelectorAll('#player-marker-ticks .player-marker-tick').length`),
      1,
      "a failed add never paints a phantom tick",
    );
    assert.equal(await read(`document.querySelector('#player-toggle-button')?.textContent`), "暂停", "a failed marker never pauses playback");

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

    console.log("PASS: real native playback controls, marker click-to-seek/delete, failed open, close fallback and idempotent teardown");
  } finally {
    await fixture.cleanup();
    await app.quit();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
