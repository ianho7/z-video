import assert from "node:assert/strict";
import test from "node:test";

import type { PlaybackEvent } from "../src/shared/contracts";
import { PlaybackCoordinator, type PlayerEngine, type PlayerEngineEvent } from "../src/main/player";

class FakePlayerEngine implements PlayerEngine {
  readonly starts: Array<{ path: string; onEvent: (event: PlayerEngineEvent) => void }> = [];
  readonly calls: string[] = [];

  start(path: string, _startPositionSec: number | undefined, onEvent: (event: PlayerEngineEvent) => void): void {
    this.starts.push({ path, onEvent });
  }

  stop(): void {
    this.calls.push("stop");
  }

  play(): void {
    this.calls.push("play");
  }

  pause(): void {
    this.calls.push("pause");
  }

  seek(positionSec: number): void {
    this.calls.push(`seek:${positionSec}`);
  }

  setAudioTrack(trackId: string): void {
    this.calls.push(`audio:${trackId}`);
  }

  setSubtitleTrack(trackId: string | null): void {
    this.calls.push(`subtitle:${trackId ?? "off"}`);
  }
}

function createCoordinator(engine: FakePlayerEngine, events: PlaybackEvent[]): PlaybackCoordinator {
  return new PlaybackCoordinator(engine, (event) => events.push(event), () => undefined);
}

test("player commands stay on the active local Playback session", async () => {
  const engine = new FakePlayerEngine();
  const events: PlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, events);

  await coordinator.openLocal("private-first.mp4", "episode-first", 12);
  engine.starts[0].onEvent({ type: "ready", durationSec: 90 });
  await coordinator.openLocal("private-second.mp4", "episode-second");
  engine.starts[0].onEvent({ type: "position", positionSec: 42, durationSec: 90 });
  engine.starts[1].onEvent({ type: "position", positionSec: 3, durationSec: 60 });
  await coordinator.handle({ type: "pause" });
  await coordinator.handle({ type: "seek", positionSec: 8 });

  assert.deepEqual(events, [
    { type: "loading", episodeId: "episode-first" },
    { type: "ready", episodeId: "episode-first", durationSec: 90 },
    { type: "loading", episodeId: "episode-second" },
    { type: "position", episodeId: "episode-second", positionSec: 3, durationSec: 60 },
  ]);
  assert.deepEqual(engine.calls, ["stop", "stop", "pause", "seek:8"]);
});

test("native failures are observable without exposing the selected path", async () => {
  const engine = new FakePlayerEngine();
  const events: PlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, events);

  await coordinator.openLocal("C:\\Users\\private\\Videos\\secret.mp4", "local-file");
  engine.starts[0].onEvent({ type: "error", message: "C:\\Users\\private\\Videos\\secret.mp4: decoder unavailable" });

  assert.deepEqual(events, [
    { type: "loading", episodeId: "local-file" },
    { type: "error", episodeId: "local-file", message: "本地媒体加载失败。" },
  ]);
  assert.equal(JSON.stringify(events).includes("secret.mp4"), false);
});

test("close discards late native events and forwards track controls", async () => {
  const engine = new FakePlayerEngine();
  const events: PlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, events);

  await coordinator.openLocal("sample.mp4", "episode");
  await coordinator.handle({ type: "set-audio-track", trackId: "2" });
  await coordinator.handle({ type: "set-subtitle-track", trackId: null });
  await coordinator.handle({ type: "close" });
  engine.starts[0].onEvent({ type: "ready", durationSec: 20 });

  assert.deepEqual(engine.calls, ["stop", "audio:2", "subtitle:off", "stop"]);
  assert.deepEqual(events, [
    { type: "loading", episodeId: "episode" },
    { type: "closed", episodeId: "episode" },
  ]);
});
