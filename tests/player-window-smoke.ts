import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { app, BrowserWindow } from "electron";

import type { PlaybackEvent } from "../src/shared/contracts";
import { IPC_CHANNELS } from "../src/shared/ipc-channels";
import { MpvNativePlayer } from "../src/main/mpv-player";
import { PlaybackCoordinator } from "../src/main/player";

const samplePath = join(process.cwd(), "assets", "test_video.mp4");
const subtitlePath = join(process.cwd(), "tests", "fixtures", "test_subtitle.srt");

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
}

async function run(): Promise<void> {
  assert.equal(process.platform, "win32", "native player smoke is Windows-only");
  assert.equal(existsSync(samplePath), true, "local sample is required");
  assert.equal(existsSync(subtitlePath), true, "external subtitle fixture is required");
  await app.whenReady();
  const window = new BrowserWindow({ width: 1000, height: 760, show: true, backgroundColor: "#08090b" });
  await window.loadFile(join(resolve(__dirname, "..", "src", "renderer", "index.html")));
  const events: PlaybackEvent[] = [];
  const player = new MpvNativePlayer(window);
  const coordinator = new PlaybackCoordinator(
    player,
    (event) => {
      events.push(event);
      window.webContents.send(IPC_CHANNELS.playerEvent, event);
    },
    (enabled) => window.setFullScreen(enabled),
  );

  try {
    await coordinator.openLocal(join(process.cwd(), "assets", "missing-player-fixture.mp4"), "missing-fixture");
    assert.equal(events.some((event) => event.type === "error" && event.episodeId === "missing-fixture"), true);
    await coordinator.openLocal(samplePath, "local-fixture");
    await waitFor("native ready event", () => events.some((event) => event.type === "ready"));
    await coordinator.handle({ type: "pause" });
    await waitFor("paused state", () => events.some((event) => event.type === "state" && event.state === "paused"));
    await coordinator.handle({ type: "seek", positionSec: 1 });
    await waitFor("position event", () => events.some((event) => event.type === "position" && event.positionSec >= 0));
    assert.equal(events.some((event) => event.type === "tracks"), true, "track enumeration event is required");
    assert.equal(await coordinator.addExternalSubtitle(subtitlePath), true, "main-owned subtitle add should succeed");
    await waitFor("external subtitle track", () => events.some((event) => event.type === "tracks" && event.subtitles.length > 0));
    const subtitleEvent = [...events].reverse().find((event): event is Extract<PlaybackEvent, { type: "tracks" }> => event.type === "tracks" && event.subtitles.length > 0);
    assert.ok(subtitleEvent, "external subtitle track should be enumerated");
    const subtitleId = subtitleEvent.subtitles[subtitleEvent.subtitles.length - 1].id;
    await coordinator.handle({ type: "set-subtitle-track", trackId: subtitleId });
    await waitFor("external subtitle selection", () => player.getSelectedSubtitleTrackId() === subtitleId);
    await coordinator.handle({ type: "set-subtitle-track", trackId: null });
    await waitFor("subtitle off", () => player.getSelectedSubtitleTrackId() === "no");
    window.setSize(1100, 800);
    await coordinator.handle({ type: "fullscreen", enabled: true });
    await coordinator.handle({ type: "fullscreen", enabled: false });
    const holdMs = Number(process.env.Z_VIDEO_PLAYER_SMOKE_HOLD_MS ?? 0);
    if (Number.isFinite(holdMs) && holdMs > 0) {
      await window.webContents.executeJavaScript(
        `(() => {
          document.querySelector('[data-view="login"]')?.setAttribute('hidden', '');
          document.querySelector('[data-view="library"]')?.setAttribute('hidden', '');
          document.querySelector('[data-view="player"]')?.removeAttribute('hidden');
        })()`,
        true,
      );
      const ready = events.find((event): event is Extract<PlaybackEvent, { type: "ready" }> => event.type === "ready");
      if (ready) window.webContents.send(IPC_CHANNELS.playerEvent, ready);
      window.webContents.send(IPC_CHANNELS.playerEvent, { type: "state", state: "paused" });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, holdMs));
    }
    await coordinator.close();
    assert.equal(events.some((event) => event.type === "closed"), true);
  } finally {
    if (!window.isDestroyed()) window.close();
    await app.quit();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
