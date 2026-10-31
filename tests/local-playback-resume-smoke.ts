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
    const result = await window.webContents.executeJavaScript(`(async () => {
      const imported = await window.zVideo.localLibrary.openVideo();
      if (imported.status !== "imported") throw new Error("owned fixture import was not accepted");
      const events = [];
      const unsubscribe = window.zVideo.localPlayback.onEvent((event) => events.push(event));
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
        return {
          playerVisible: view?.hidden === false,
          surfaceWidth: surfaceRect?.width ?? 0,
          surfaceHeight: surfaceRect?.height ?? 0,
          controlsHeight: controlsRect?.height ?? 0,
          toggleEnabled: document.querySelector("#player-toggle-button")?.disabled === false,
        };
      })();
      if (!playerLayout.playerVisible) throw new Error("production renderer did not expose the native player view after local open");
      if (!(playerLayout.surfaceWidth > 0 && playerLayout.surfaceHeight > 0)) throw new Error("native player surface did not get a real layout rectangle");
      if (!(playerLayout.controlsHeight >= 140)) throw new Error("native player controls did not reserve the native child height");
      if (!playerLayout.toggleEnabled) throw new Error("native playback controls did not become enabled after ready");
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
      await window.zVideo.localPlayback.command({ type: "fullscreen", enabled: true });
      const visualHoldMs = Number(${JSON.stringify(Number(process.env.Z_VIDEO_LOCAL_PLAYBACK_HOLD_MS ?? 0))});
      if (Number.isFinite(visualHoldMs) && visualHoldMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, visualHoldMs));
      }
      await window.zVideo.localPlayback.command({ type: "close" });
      const closeDeadline = Date.now() + 5_000;
      while (Date.now() < closeDeadline && (!events.some((event) => event.type === "closed") || document.querySelector('[data-view="player"]')?.hidden !== true)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      unsubscribe();
      const closedLayout = document.querySelector('[data-view="player"]')?.hidden === true;
      if (!closedLayout) throw new Error("production renderer did not return to the library after local close");
      return {
        mediaId: imported.item.mediaId,
        positionSec: observed.positionSec,
        durationSec: observed.durationSec,
        playerLayout,
        fullscreenCommandIssued: true,
        events,
        fixturePathLeaked: JSON.stringify(events).includes(${JSON.stringify(fixturePath)}),
      };
    })()`, true) as {
      mediaId: string;
      positionSec: number;
      durationSec?: number;
      playerLayout: {
        playerVisible: boolean;
        surfaceWidth: number;
        surfaceHeight: number;
        controlsHeight: number;
        toggleEnabled: boolean;
      };
      fullscreenCommandIssued: boolean;
      events: LocalPlaybackEvent[];
      fixturePathLeaked: boolean;
    };
    assert.equal(isOpaqueMediaId(result.mediaId), true);
    assert.ok(result.positionSec >= 6.5, `expected an observed position >= 6.5, got ${result.positionSec}`);
    assert.equal(result.fixturePathLeaked, false);
    assert.ok(result.events.some((event) => event.type === "ready"));
    assert.ok(result.events.some((event) => event.type === "state" && event.state === "paused"));
    assert.ok(result.events.some((event) => event.type === "closed"));
    assert.equal(result.fullscreenCommandIssued, true);
    assert.equal(window.isFullScreen(), false, "closing local playback must leave the BrowserWindow out of fullscreen");
    await writeFile(resultPath, JSON.stringify(result), "utf8");
  } finally {
    dialog.showOpenDialog = originalShowOpenDialog;
  }
  await quitProductionApp();
}

async function runSecondProcess(): Promise<void> {
  const first = JSON.parse(await readFile(firstResultPath, "utf8")) as { mediaId: string; positionSec: number };
  assert.equal(isOpaqueMediaId(first.mediaId), true);
  require("../src/main/main.js");
  const window = await waitForProductionWindow();
  const minimumResumePosition = Math.max(6.0, first.positionSec - 0.75);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const page = await window.zVideo.localLibrary.list({ page: 1, pageSize: 50 });
    const item = page.page?.items.find((candidate) => candidate.mediaId === ${JSON.stringify(first.mediaId)});
    if (!item) throw new Error("fresh process could not find the persisted mediaId");
    const events = [];
    const unsubscribe = window.zVideo.localPlayback.onEvent((event) => events.push(event));
    const opened = await window.zVideo.localPlayback.open(item.mediaId);
    if (!opened.opened) throw new Error("fresh process local playback open returned false");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !events.some((event) => event.type === "position" && event.positionSec >= ${JSON.stringify(minimumResumePosition)})) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const resumed = events.find((event) => event.type === "position" && event.positionSec >= ${JSON.stringify(minimumResumePosition)});
    if (!resumed || resumed.type !== "position") throw new Error("fresh process did not observe persisted resume position");
    await window.zVideo.localPlayback.command({ type: "close" });
    unsubscribe();
    return { mediaId: item.mediaId, positionSec: resumed.positionSec, events };
  })()`, true) as { mediaId: string; positionSec: number; events: LocalPlaybackEvent[] };
  assert.equal(result.mediaId, first.mediaId);
  assert.ok(result.positionSec >= minimumResumePosition, `expected fresh process resume near ${first.positionSec}, got ${result.positionSec}`);
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
