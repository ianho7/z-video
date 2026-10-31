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

  addSubtitleFile(path: string): void {
    this.calls.push(`subtitle-file:${path}`);
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

test("external subtitles stay main-owned and can be selected or turned off", async () => {
  const engine = new FakePlayerEngine();
  const events: PlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, events);

  await coordinator.openLocal("sample.mp4", "episode");
  assert.equal(await coordinator.addExternalSubtitle("private-subtitle.srt"), true);
  await coordinator.handle({ type: "set-subtitle-track", trackId: "2" });
  await coordinator.handle({ type: "set-subtitle-track", trackId: null });

  assert.deepEqual(engine.calls, ["stop", "subtitle-file:private-subtitle.srt", "subtitle:2", "subtitle:off"]);
  assert.equal(JSON.stringify(events).includes("private-subtitle.srt"), false);
});

test("NAS playback resolves a private stream in main and flushes only its matching progress", async () => {
  const engine = new FakePlayerEngine();
  const events: PlaybackEvent[] = [];
  const progress: Array<{ identity: unknown; target: unknown; snapshot: unknown }> = [];
  const coordinator = new PlaybackCoordinator(
    engine,
    (event) => events.push(event),
    () => undefined,
    {
      resolve: async () => ({
        source: "http://127.0.0.1:5055/stream/opaque",
        videoId: "video-01",
        durationSec: 120,
        audioIndex: 1,
        subtitleIndex: -1,
        chapter: 2,
        subtitleHash: "hash-01",
        subtitleSetting: '{"font":"small"}',
      }),
      reportProgress: async (identity, target, snapshot) => {
        progress.push({ identity, target, snapshot });
      },
    },
  );

  await coordinator.handle({ type: "open", collectionId: "collection-01", classificationId: "movie", episodeId: "episode-01", startPositionSec: 18 });
  engine.starts[0].onEvent({ type: "ready", durationSec: 120 });
  engine.starts[0].onEvent({ type: "position", positionSec: 42, durationSec: 120 });
  await coordinator.handle({ type: "close" });

  assert.equal(engine.starts[0]?.path, "http://127.0.0.1:5055/stream/opaque");
  assert.deepEqual(progress, [{
    identity: { collectionId: "collection-01", classificationId: "movie", episodeId: "episode-01" },
    target: {
      source: "http://127.0.0.1:5055/stream/opaque",
      videoId: "video-01",
      durationSec: 120,
      audioIndex: 1,
      subtitleIndex: -1,
      chapter: 2,
      subtitleHash: "hash-01",
      subtitleSetting: '{"font":"small"}',
    },
    snapshot: { positionSec: 42, durationSec: 120, audioIndex: 1, subtitleIndex: -1 },
  }]);
  assert.equal(events.some((event) => event.type === "error"), false);
  assert.deepEqual(events.at(-1), { type: "closed", episodeId: "episode-01" });
});

test("stale NAS stream resolution cannot start or report the replaced Episode", async () => {
  const engine = new FakePlayerEngine();
  const events: PlaybackEvent[] = [];
  const resolvers: Array<(target: { source: string; videoId: string }) => void> = [];
  const progress: string[] = [];
  const coordinator = new PlaybackCoordinator(engine, (event) => events.push(event), () => undefined, {
    resolve: async (command) => new Promise((resolve) => {
      resolvers.push((target) => resolve(target));
      if (command.episodeId === "episode-02") resolvers.at(-1)?.({ source: "http://127.0.0.1:5055/two", videoId: "video-02" });
    }),
    reportProgress: async (identity) => { progress.push(identity.episodeId); },
  });

  const first = coordinator.handle({ type: "open", collectionId: "collection-01", classificationId: "movie", episodeId: "episode-01" });
  await new Promise((resolve) => setImmediate(resolve));
  const second = coordinator.handle({ type: "open", collectionId: "collection-01", classificationId: "movie", episodeId: "episode-02" });
  await second;
  resolvers[0]?.({ source: "http://127.0.0.1:5055/one", videoId: "video-01" });
  await first;

  assert.deepEqual(engine.starts.map((start) => start.path), ["http://127.0.0.1:5055/two"]);
  assert.deepEqual(progress, []);
  assert.equal(events.some((event) => event.type === "error" && event.episodeId === "episode-01"), false);
  await coordinator.handle({ type: "close" });
});

test("native closed events flush the active NAS identity before closing", async () => {
  const engine = new FakePlayerEngine();
  const events: PlaybackEvent[] = [];
  const progress: string[] = [];
  const coordinator = new PlaybackCoordinator(engine, (event) => events.push(event), () => undefined, {
    resolve: async () => ({ source: "http://127.0.0.1:5055/stream", videoId: "video-01" }),
    reportProgress: async (identity) => { progress.push(identity.episodeId); },
  });

  await coordinator.handle({ type: "open", collectionId: "collection-01", classificationId: "movie", episodeId: "episode-01" });
  engine.starts[0].onEvent({ type: "position", positionSec: 5 });
  engine.starts[0].onEvent({ type: "closed" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(progress, ["episode-01"]);
  assert.deepEqual(events.at(-1), { type: "closed", episodeId: "episode-01" });
});
