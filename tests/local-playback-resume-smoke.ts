import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, dialog } from "electron";

import type { LocalPlaybackEvent } from "../src/shared/local-playback-contracts";
import { isOpaqueMediaId } from "../src/shared/local-library-contracts";

const stage = process.env.Z_VIDEO_LOCAL_PLAYBACK_STAGE;
const profile = requiredEnv("Z_VIDEO_LOCAL_PLAYBACK_PROFILE");
const fixturePath = requiredEnv("Z_VIDEO_LOCAL_PLAYBACK_FIXTURE");
const resultPath = requiredEnv("Z_VIDEO_LOCAL_PLAYBACK_RESULT");
const firstResultPath = requiredEnv("Z_VIDEO_LOCAL_PLAYBACK_FIRST_RESULT");

async function run(): Promise<void> {
  await mkdir(profile, { recursive: true });
  app.setPath("userData", profile);
  app.setPath("sessionData", join(profile, "session"));

  if (stage === "first") {
    await runFirstProcess();
  } else if (stage === "second") {
    await runSecondProcess();
  } else {
    throw new Error(`unknown local playback smoke stage: ${stage ?? "missing"}`);
  }
}

async function runFirstProcess(): Promise<void> {
  // Replace only the native picker response for this smoke. Import, opaque-ID
  // generation, playback open, and progress save still use production IPC.
  const originalShowOpenDialog = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixturePath] });
  try {
    require("../src/main/main.js");
    const window = await waitForProductionWindow();
    window.setSize(900, 640);
    const actualWindowSize = window.getSize();
    const actualContentSize = window.getContentSize();
    assert.ok(actualWindowSize[0] >= 900 && actualWindowSize[1] >= 640, "production BrowserWindow should honor the 900×640 minimum size");
    const result = await window.webContents.executeJavaScript(`(async () => {
      const imported = await window.zVideo.localLibrary.openVideo();
      if (imported.status !== "imported") throw new Error("owned fixture import was not accepted");
      const events = [];
      const unsubscribe = window.zVideo.localPlayback.onEvent((event) => events.push(event));
      window.__localPlaybackSmoke = { events, unsubscribe };
      const opened = await window.zVideo.localPlayback.open(imported.item.mediaId);
      if (!opened.opened) throw new Error("production local playback open returned false");
      const readyDeadline = Date.now() + 20_000;
      while (Date.now() < readyDeadline && !events.some((event) => event.type === "ready")) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!events.some((event) => event.type === "ready")) throw new Error("libmpv did not report ready");
      const playerLayout = (() => {
        const view = document.querySelector('[data-view="player"]');
        const surface = document.querySelector(".player-surface");
        const controls = document.querySelector(".player-controls");
        const surfaceRect = surface?.getBoundingClientRect();
        const controlsRect = controls?.getBoundingClientRect();
        const requiredControlSelectors = [
          "#player-close-button",
          "#player-toggle-button",
          "#player-seek",
          "#player-speed",
          "#player-fullscreen-button",
          "#player-audio-track",
          "#player-subtitle-track",
          "#player-subtitle-file-button",
          "#player-volume",
          "#player-mute-button",
        ];
        const controlsVisible = !!controls && !!controlsRect && requiredControlSelectors.every((selector) => {
          const control = document.querySelector(selector);
          const rect = control?.getBoundingClientRect();
          return !!control && !!rect && rect.width > 0 && rect.height > 0
            && rect.left >= controlsRect.left && rect.right <= controlsRect.right
            && rect.top >= controlsRect.top && rect.bottom <= controlsRect.bottom
            && rect.left >= 0 && rect.right <= document.documentElement.clientWidth
            && rect.top >= 0 && rect.bottom <= document.documentElement.clientHeight;
        }) && controls.scrollWidth <= controls.clientWidth && controls.scrollHeight <= controls.clientHeight;
        return {
          playerVisible: view?.hidden === false,
          surfaceWidth: surfaceRect?.width ?? 0,
          surfaceHeight: surfaceRect?.height ?? 0,
          controlsHeight: controlsRect?.height ?? 0,
          controlsVisible,
          toggleEnabled: document.querySelector("#player-toggle-button")?.disabled === false,
        };
      })();
      if (!playerLayout.playerVisible) throw new Error("production renderer did not expose the native player view after local open");
      if (!(playerLayout.surfaceWidth > 0 && playerLayout.surfaceHeight > 0)) throw new Error("native player surface did not get a real layout rectangle");
      if (!(playerLayout.controlsHeight >= 140)) throw new Error("native player controls did not reserve the native child height");
      if (!playerLayout.controlsVisible) throw new Error("one or more player controls overflowed or were clipped at the minimum window size");
      if (!playerLayout.toggleEnabled) throw new Error("native playback controls did not become enabled after ready");
      const savedPreferences = await window.zVideo.appPreferences.setSort("score_desc");
      if (savedPreferences.sort !== "score_desc") throw new Error("main preferences did not confirm the requested library sort");
      await window.zVideo.localPlayback.command({ type: "set-volume", volume: 35 });
      await window.zVideo.localPlayback.command({ type: "set-muted", muted: true });
      await window.zVideo.localPlayback.command({ type: "set-speed", speed: 1.25 });
      const settingsDeadline = Date.now() + 5_000;
      let confirmedSettings;
      while (Date.now() < settingsDeadline && !confirmedSettings) {
        confirmedSettings = events.find((event) => event.type === "settings" && event.volume === 35 && event.muted === true && event.speed === 1.25);
        if (!confirmedSettings) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!confirmedSettings || confirmedSettings.type !== "settings") throw new Error("native playback did not confirm the requested settings");
      await window.zVideo.localPlayback.command({ type: "seek", positionSec: 7 });
      const positionDeadline = Date.now() + 12_000;
      while (Date.now() < positionDeadline && !events.some((event) => event.type === "position" && event.positionSec >= 6.5)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const observed = events.filter((event) => event.type === "position").at(-1);
      if (!observed || observed.type !== "position" || observed.positionSec < 6.5) {
        throw new Error("libmpv did not report the requested observed position");
      }
      await window.zVideo.localPlayback.command({ type: "pause" });
      const pauseDeadline = Date.now() + 5_000;
      while (Date.now() < pauseDeadline && !events.some((event) => event.type === "state" && event.state === "paused")) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const hiddenResizeHoldMs = Number(${JSON.stringify(Number(process.env.Z_VIDEO_LOCAL_PLAYBACK_HIDDEN_RESIZE_HOLD_MS ?? 0))});
      if (Number.isFinite(hiddenResizeHoldMs) && hiddenResizeHoldMs > 0) {
        const retry = await window.zVideo.localPlayback.open("media_33333333-3333-4333-8333-333333333333");
        if (!retry.opened) throw new Error("production local playback retry did not enter the missing-media path");
        const retryDeadline = Date.now() + 5_000;
        while (Date.now() < retryDeadline && !events.some((event) => event.type === "error" && event.mediaId === "media_33333333-3333-4333-8333-333333333333")) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!events.some((event) => event.type === "error" && event.mediaId === "media_33333333-3333-4333-8333-333333333333")) {
          throw new Error("production local playback retry did not report the missing-media error");
        }
        window.resizeTo(window.outerWidth + 2, window.outerHeight + 2);
        await new Promise((resolve) => setTimeout(resolve, hiddenResizeHoldMs));
      }
      return {
        mediaId: imported.item.mediaId,
        positionSec: observed.positionSec,
        durationSec: observed.durationSec,
        sort: savedPreferences.sort,
        settings: confirmedSettings,
        playerLayout,
        events,
        fixturePathLeaked: JSON.stringify(events).includes(${JSON.stringify(fixturePath)}),
      };
    })()`, true) as {
      mediaId: string;
      positionSec: number;
      durationSec?: number;
      sort: string;
      playerLayout: {
        playerVisible: boolean;
        surfaceWidth: number;
        surfaceHeight: number;
        controlsHeight: number;
        controlsVisible: boolean;
        toggleEnabled: boolean;
      };
      events: LocalPlaybackEvent[];
      settings: Extract<LocalPlaybackEvent, { type: "settings" }>;
      fixturePathLeaked: boolean;
    };
    assert.equal(isOpaqueMediaId(result.mediaId), true);
    assert.ok(result.positionSec >= 6.5, `expected an observed position >= 6.5, got ${result.positionSec}`);
    assert.equal(result.fixturePathLeaked, false);
    assert.ok(result.events.some((event) => event.type === "ready"));
    assert.ok(result.events.some((event) => event.type === "state" && event.state === "paused"));

    const spaceShortcut = await window.webContents.executeJavaScript(`(() => {
      const smoke = window.__localPlaybackSmoke;
      const position = smoke.events.filter((event) => event.type === "position").at(-1);
      const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      const eventIndex = smoke.events.length;
      window.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, key: event.key, code: event.code, eventIndex, positionSec: position?.positionSec ?? 0 };
    })()`, true) as { defaultPrevented: boolean; key: string; code: string; eventIndex: number; positionSec: number };
    assert.equal(spaceShortcut.defaultPrevented, true, "renderer should handle a key-only Space shortcut");
    assert.equal(spaceShortcut.key, " ");
    assert.equal(spaceShortcut.code, "", "Space smoke must omit the physical code");
    let spacePlayedAndAdvanced = false;
    const spaceDeadline = Date.now() + 5_000;
    while (Date.now() < spaceDeadline && !spacePlayedAndAdvanced) {
      spacePlayedAndAdvanced = await window.webContents.executeJavaScript(`(() => {
        const events = window.__localPlaybackSmoke.events.slice(${JSON.stringify(spaceShortcut.eventIndex)});
        const playing = events.some((event) => event.type === "state" && event.state === "playing");
        const position = events.filter((event) => event.type === "position").at(-1);
        return playing && position?.positionSec > ${JSON.stringify(spaceShortcut.positionSec + 0.25)};
      })()`, true) as boolean;
      if (!spacePlayedAndAdvanced) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(spacePlayedAndAdvanced, true, "key-only Space should start native playback and advance observed time");

    const pauseStartIndex = await window.webContents.executeJavaScript(`(async () => {
      const eventIndex = window.__localPlaybackSmoke.events.length;
      await window.zVideo.localPlayback.command({ type: "pause" });
      return eventIndex;
    })()`, true) as number;
    let pausedAgain = false;
    const pauseAgainDeadline = Date.now() + 5_000;
    while (Date.now() < pauseAgainDeadline && !pausedAgain) {
      pausedAgain = await window.webContents.executeJavaScript(`window.__localPlaybackSmoke.events.slice(${JSON.stringify(pauseStartIndex)}).some((event) => event.type === "state" && event.state === "paused")`, true) as boolean;
      if (!pausedAgain) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(pausedAgain, true, "native playback should pause before the arrow seek proof");

    const arrowShortcut = await window.webContents.executeJavaScript(`(() => {
      const smoke = window.__localPlaybackSmoke;
      const position = smoke.events.filter((event) => event.type === "position").at(-1);
      const duration = position?.durationSec ?? 0;
      const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
      const eventIndex = smoke.events.length;
      window.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, key: event.key, code: event.code, eventIndex, positionSec: position?.positionSec ?? 0, targetSec: Math.min(duration, (position?.positionSec ?? 0) + 4.5) };
    })()`, true) as { defaultPrevented: boolean; key: string; code: string; eventIndex: number; positionSec: number; targetSec: number };
    assert.equal(arrowShortcut.defaultPrevented, true, "renderer should handle a key-only ArrowRight shortcut");
    assert.equal(arrowShortcut.key, "ArrowRight");
    assert.equal(arrowShortcut.code, "", "ArrowRight smoke must omit the physical code");
    let arrowSeekObserved = false;
    const arrowDeadline = Date.now() + 5_000;
    while (Date.now() < arrowDeadline && !arrowSeekObserved) {
      arrowSeekObserved = await window.webContents.executeJavaScript(`(() => {
        const events = window.__localPlaybackSmoke.events;
        const afterArrow = events.slice(${JSON.stringify(arrowShortcut.eventIndex)});
        const position = afterArrow.filter((event) => event.type === "position").at(-1);
        const state = events.filter((event) => event.type === "state").at(-1);
        return position?.positionSec >= ${JSON.stringify(arrowShortcut.targetSec)} && state?.state === "paused";
      })()`, true) as boolean;
      if (!arrowSeekObserved) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(arrowSeekObserved, true, "key-only ArrowRight should seek native playback by 5 seconds and preserve pause");

    const fullscreenShortcutHandled = await window.webContents.executeJavaScript(`(() => {
      const event = new KeyboardEvent("keydown", { key: "f", code: "KeyF", bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()`, true) as boolean;
    assert.equal(fullscreenShortcutHandled, true, "renderer should handle the F fullscreen shortcut");
    const fullscreenDeadline = Date.now() + 5_000;
    while (Date.now() < fullscreenDeadline && !window.isFullScreen()) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(window.isFullScreen(), true, "F shortcut should enter fullscreen");

    const focusedEscapeHandled = await window.webContents.executeJavaScript(`(() => {
      document.querySelector("#player-speed")?.focus();
      const event = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()`, true) as boolean;
    assert.equal(focusedEscapeHandled, false, "form-control focus should retain native Escape handling");
    assert.equal(window.isFullScreen(), true, "Escape on a form control should not exit fullscreen");

    await window.webContents.executeJavaScript('document.querySelector(".player-surface")?.focus()', true);
    const escapeShortcutHandled = await window.webContents.executeJavaScript(`(() => {
      const event = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()`, true) as boolean;
    assert.equal(escapeShortcutHandled, true, "renderer should handle Escape while the player surface is focused");
    const exitFullscreenDeadline = Date.now() + 5_000;
    while (Date.now() < exitFullscreenDeadline && window.isFullScreen()) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(window.isFullScreen(), false, "Escape shortcut should exit fullscreen");

    const closeFullscreenShortcutHandled = await window.webContents.executeJavaScript(`(() => {
      const event = new KeyboardEvent("keydown", { key: "f", code: "KeyF", bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()`, true) as boolean;
    assert.equal(closeFullscreenShortcutHandled, true, "renderer should handle F before closing local playback");
    const closeFullscreenDeadline = Date.now() + 5_000;
    while (Date.now() < closeFullscreenDeadline && !window.isFullScreen()) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(window.isFullScreen(), true, "local playback should be closed while fullscreen is active");

    const visualHoldMs = Number(process.env.Z_VIDEO_LOCAL_PLAYBACK_HOLD_MS ?? 0);
    if (Number.isFinite(visualHoldMs) && visualHoldMs > 0) await new Promise((resolve) => setTimeout(resolve, visualHoldMs));
    const closed = await window.webContents.executeJavaScript(`(async () => {
      await window.zVideo.localPlayback.command({ type: "close" });
      const closeDeadline = Date.now() + 5_000;
      const smoke = window.__localPlaybackSmoke;
      while (Date.now() < closeDeadline && (!smoke.events.some((event) => event.type === "closed") || document.querySelector('[data-view="player"]')?.hidden !== true)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const closedLayout = document.querySelector('[data-view="player"]')?.hidden === true;
      if (!closedLayout) throw new Error("production renderer did not return to the library after local close");
      smoke.unsubscribe();
      return { closedLayout, events: smoke.events };
    })()`, true) as { closedLayout: boolean; events: LocalPlaybackEvent[] };
    assert.equal(closed.closedLayout, true);
    assert.ok(closed.events.some((event) => event.type === "closed"));
    assert.equal(window.isFullScreen(), false, "closing local playback must leave the BrowserWindow out of fullscreen");
    const finalPosition = closed.events.filter((event) => event.type === "position").at(-1);
    assert.ok(finalPosition && finalPosition.type === "position", "close should retain a final observed native position");
    await writeFile(resultPath, JSON.stringify({ ...result, initialPositionSec: result.positionSec, positionSec: finalPosition.positionSec, requestedWindowSize: [900, 640], actualWindowSize, actualContentSize, events: closed.events }), "utf8");
  } finally {
    dialog.showOpenDialog = originalShowOpenDialog;
  }
  await quitProductionApp();
}

async function runSecondProcess(): Promise<void> {
  const first = JSON.parse(await readFile(firstResultPath, "utf8")) as { mediaId: string; positionSec: number; sort: string; settings: { volume: number; muted: boolean; speed: number } };
  assert.equal(isOpaqueMediaId(first.mediaId), true);
  require("../src/main/main.js");
  const window = await waitForProductionWindow();
  const result = await window.webContents.executeJavaScript(`(async () => {
    const page = await window.zVideo.localLibrary.list({ page: 1, pageSize: 50 });
    const item = page.page?.items.find((candidate) => candidate.mediaId === ${JSON.stringify(first.mediaId)});
    if (!item) throw new Error("fresh process could not find the persisted mediaId");
    const events = [];
    const unsubscribe = window.zVideo.localPlayback.onEvent((event) => events.push(event));
    const opened = await window.zVideo.localPlayback.open(item.mediaId);
    if (!opened.opened) throw new Error("fresh process local playback open returned false");
    const readyDeadline = Date.now() + 20_000;
    while (Date.now() < readyDeadline && !events.some((event) => event.type === "ready")) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!events.some((event) => event.type === "ready")) throw new Error("fresh process playback did not become ready");
    const preferences = await window.zVideo.appPreferences.get();
    if (preferences.sort !== ${JSON.stringify(first.sort)}) throw new Error("fresh process did not restore the persisted library sort");
    const settings = events.find((event) => event.type === "settings");
    if (!settings || settings.type !== "settings" || settings.volume !== ${JSON.stringify(first.settings.volume)} || settings.muted !== ${JSON.stringify(first.settings.muted)} || settings.speed !== ${JSON.stringify(first.settings.speed)}) {
      throw new Error("fresh process did not restore persisted native playback settings");
    }
    const resumeObservationStart = events.length;
    await window.zVideo.localPlayback.command({ type: "pause" });
    const pauseDeadline = Date.now() + 5_000;
    let resumed;
    let paused = false;
    while (Date.now() < pauseDeadline && (!resumed || !paused)) {
      const observations = events.slice(resumeObservationStart);
      resumed = observations.find((event) => event.type === "position");
      paused = observations.some((event) => event.type === "state" && event.state === "paused");
      if (!resumed || !paused) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!resumed || resumed.type !== "position") throw new Error("fresh process did not promptly observe the native resume position");
    if (!paused) throw new Error("fresh process did not pause promptly after becoming ready");
    await window.zVideo.localPlayback.command({ type: "close" });
    unsubscribe();
    return { mediaId: item.mediaId, positionSec: resumed.positionSec, events };
  })()`, true) as { mediaId: string; positionSec: number; events: LocalPlaybackEvent[] };
  assert.equal(result.mediaId, first.mediaId);
  assert.ok(result.events.some((event) => event.type === "ready"));
  assert.ok(result.events.some((event) => event.type === "closed"));
  await writeFile(resultPath, JSON.stringify({ ...result, expectedPositionSec: first.positionSec }), "utf8");
  await quitProductionApp();
}

async function waitForProductionWindow(): Promise<BrowserWindow> {
  await app.whenReady();
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window && !window.isDestroyed() && window.webContents.getURL().endsWith("/index.html")) return window;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("production main did not create a renderer window");
}

async function quitProductionApp(): Promise<void> {
  await new Promise<void>((resolve) => {
    app.once("will-quit", () => resolve());
    app.quit();
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
