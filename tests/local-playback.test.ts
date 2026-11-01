import assert from "node:assert/strict";
import test from "node:test";

import { isLocalPlaybackControlCommand, type LocalPlaybackEvent, type LocalPlaybackStore } from "../src/shared/local-playback-contracts";
import type { LocalPlaybackState } from "../src/shared/local-library-contracts";
import { LocalPlaybackCoordinator, type PlayerEngine, type PlayerEngineEvent } from "../src/main/player";

const mediaOne = "media_11111111-1111-4111-8111-111111111111" as const;
const mediaTwo = "media_22222222-2222-4222-8222-222222222222" as const;

class FakeLocalEngine implements PlayerEngine {
  readonly starts: Array<{ path: string; startPositionSec: number | undefined; onEvent: (event: PlayerEngineEvent) => void }> = [];
  readonly calls: string[] = [];
  startError?: Error;
  subtitleError?: Error;

  start(path: string, startPositionSec: number | undefined, onEvent: (event: PlayerEngineEvent) => void): void {
    this.starts.push({ path, startPositionSec, onEvent });
    if (this.startError) throw this.startError;
  }

  stop(): void { this.calls.push("stop"); }
  play(): void { this.calls.push("play"); }
  pause(): void { this.calls.push("pause"); }
  seek(positionSec: number): void { this.calls.push(`seek:${positionSec}`); }
  setVolume(volume: number): void { this.calls.push(`volume:${volume}`); }
  setMuted(muted: boolean): void { this.calls.push(`muted:${muted}`); }
  setSpeed(speed: number): void { this.calls.push(`speed:${speed}`); }
  setAudioTrack(trackId: string): void { this.calls.push(`audio:${trackId}`); }
  setSubtitleTrack(trackId: string | null): void { this.calls.push(`subtitle:${trackId ?? "off"}`); }
  addSubtitleFile(path: string): void {
    if (this.subtitleError) throw this.subtitleError;
    this.calls.push(`subtitle-file:${path}`);
  }
}

class MemoryPlaybackStore implements LocalPlaybackStore {
  readonly paths = new Map<string, string>();
  readonly states = new Map<string, LocalPlaybackState>();
  readonly saves: LocalPlaybackState[] = [];

  resolveMediaPath(mediaId: LocalPlaybackState["mediaId"]): Promise<string | undefined> {
    return Promise.resolve(this.paths.get(mediaId));
  }

  getPlayback(mediaId: LocalPlaybackState["mediaId"]): Promise<LocalPlaybackState | undefined> {
    const state = this.states.get(mediaId);
    return Promise.resolve(state ? { ...state } : undefined);
  }

  savePlayback(state: LocalPlaybackState): Promise<LocalPlaybackState> {
    this.saves.push({ ...state });
    this.states.set(state.mediaId, { ...state });
    return Promise.resolve({ ...state });
  }
}

function createCoordinator(
  engine: FakeLocalEngine,
  store: MemoryPlaybackStore,
  events: LocalPlaybackEvent[],
  fullscreenCalls: boolean[] = [],
): LocalPlaybackCoordinator {
  return new LocalPlaybackCoordinator(engine, (event) => events.push(event), (enabled) => fullscreenCalls.push(enabled), store);
}

test("local playback resolves by opaque mediaId, restores state, and flushes observed native progress", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "C:\\private\\video.mp4");
  store.states.set(mediaOne, {
    mediaId: mediaOne,
    positionSec: 12,
    durationSec: 120,
    audioTrackId: "2",
    subtitleTrackId: "7",
    watched: false,
    updatedAtMs: 100,
  });
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  await coordinator.open(mediaOne);
  assert.deepEqual(engine.starts[0], { path: "C:\\private\\video.mp4", startPositionSec: 12, onEvent: engine.starts[0]?.onEvent });
  engine.starts[0].onEvent({ type: "ready", durationSec: 120 });
  engine.starts[0].onEvent({ type: "position", positionSec: 37, durationSec: 120 });
  await coordinator.handle({ type: "set-audio-track", trackId: "2" });
  await coordinator.handle({ type: "pause" });

  assert.equal(store.saves.length, 1);
  assert.deepEqual(store.saves[0], {
    mediaId: mediaOne,
    positionSec: 37,
    durationSec: 120,
    audioTrackId: "2",
    subtitleTrackId: "7",
    watched: false,
    updatedAtMs: store.saves[0].updatedAtMs,
  });
  assert.equal(events.some((event) => JSON.stringify(event).includes("C:\\\\private")), false);
  await coordinator.close();
});

test("local playback controls stay within the supported settings ranges and report engine state", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  assert.equal(isLocalPlaybackControlCommand({ type: "set-volume", volume: 0 }), true);
  assert.equal(isLocalPlaybackControlCommand({ type: "set-volume", volume: 100 }), true);
  assert.equal(isLocalPlaybackControlCommand({ type: "set-volume", volume: 101 }), false);
  assert.equal(isLocalPlaybackControlCommand({ type: "set-muted", muted: true }), true);
  assert.equal(isLocalPlaybackControlCommand({ type: "set-muted", muted: "yes" }), false);
  assert.equal(isLocalPlaybackControlCommand({ type: "set-speed", speed: 0.25 }), true);
  assert.equal(isLocalPlaybackControlCommand({ type: "set-speed", speed: 3 }), true);
  assert.equal(isLocalPlaybackControlCommand({ type: "set-speed", speed: 3.01 }), false);

  await coordinator.open(mediaOne);
  await coordinator.handle({ type: "set-volume", volume: 42 });
  await coordinator.handle({ type: "set-muted", muted: true });
  await coordinator.handle({ type: "set-speed", speed: 1.5 });
  engine.starts[0].onEvent({ type: "settings", volume: 42, muted: true, speed: 1.5 });
  engine.starts[0].onEvent({ type: "control-error", message: "播放控制失败。" });
  engine.starts[0].onEvent({ type: "position", positionSec: 8, durationSec: 20 });
  await coordinator.handle({ type: "pause" });

  assert.deepEqual(engine.calls, ["stop", "volume:42", "muted:true", "speed:1.5", "pause"]);
  assert.equal(events.some((event) => event.type === "error"), false);
  assert.deepEqual(events.find((event) => event.type === "settings"), { type: "settings", mediaId: mediaOne, volume: 42, muted: true, speed: 1.5 });
  assert.deepEqual(events.find((event) => event.type === "control-error"), { type: "control-error", mediaId: mediaOne, message: "播放控制失败。" });
  assert.equal(store.saves.length, 1);
  await coordinator.close();
});

test("native EOF state marks the observed local playback as watched", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "position", positionSec: 29, durationSec: 30 });
  engine.starts[0].onEvent({ type: "state", state: "ended" });
  await coordinator.close();

  assert.deepEqual(events.find((event) => event.type === "state"), { type: "state", mediaId: mediaOne, state: "ended" });
  assert.equal(store.saves.length, 1);
  assert.equal(store.saves[0]?.positionSec, 29);
  assert.equal(store.saves[0]?.watched, true);
});

test("external subtitle selection is canceled normally and cannot cross a playback generation", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  store.paths.set(mediaTwo, "second.mp4");
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  await coordinator.open(mediaOne);
  assert.deepEqual(await coordinator.chooseExternalSubtitle(async () => undefined), { loaded: false });
  assert.deepEqual(await coordinator.chooseExternalSubtitle(async () => "C:\\private\\captions.srt"), { loaded: true });
  assert.equal(engine.calls.includes("subtitle-file:C:\\private\\captions.srt"), true);
  assert.equal(JSON.stringify(events).includes("captions.srt"), false);
  engine.subtitleError = new Error("C:\\private\\captions.srt failed to load");
  assert.deepEqual(await coordinator.chooseExternalSubtitle(async () => "C:\\private\\broken.srt"), { loaded: false });
  assert.deepEqual(events.find((event) => event.type === "control-error"), { type: "control-error", mediaId: mediaOne, message: "外部字幕加载失败。" });
  assert.equal(JSON.stringify(events).includes("captions.srt"), false);
  engine.subtitleError = undefined;

  const loadedSubtitles = engine.calls.filter((call) => call.startsWith("subtitle-file:")).length;
  let selectSubtitle!: (path: string) => void;
  const selection = coordinator.chooseExternalSubtitle(() => new Promise((resolve) => { selectSubtitle = resolve; }));
  await coordinator.open(mediaTwo);
  selectSubtitle("C:\\private\\captions.srt");

  assert.deepEqual(await selection, { loaded: false });
  assert.equal(engine.calls.filter((call) => call.startsWith("subtitle-file:")).length, loadedSubtitles);
  assert.equal(JSON.stringify(events).includes("captions.srt"), false);
  assert.equal(events.some((event) => event.type === "error"), false);
  await coordinator.close();
});

test("a failed local load never overwrites the previous playback state", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "C:\\private\\broken.mp4");
  const previous: LocalPlaybackState = {
    mediaId: mediaOne,
    positionSec: 48,
    durationSec: 90,
    audioTrackId: "1",
    subtitleTrackId: null,
    watched: false,
    updatedAtMs: 123,
  };
  store.states.set(mediaOne, previous);
  engine.startError = new Error("decoder failed for C:\\private\\broken.mp4");
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  await coordinator.open(mediaOne);
  await coordinator.close();

  assert.deepEqual(store.saves, []);
  assert.deepEqual(store.states.get(mediaOne), previous);
  assert.deepEqual(events, [
    { type: "loading", mediaId: mediaOne },
    { type: "error", mediaId: mediaOne, message: "本地媒体加载失败。" },
    { type: "closed", mediaId: mediaOne },
  ]);
});

test("missing persisted track IDs are ignored when native tracks are enumerated", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  store.states.set(mediaOne, {
    mediaId: mediaOne,
    positionSec: 4,
    audioTrackId: "missing-audio",
    subtitleTrackId: "missing-subtitle",
    watched: false,
    updatedAtMs: 1,
  });
  const coordinator = createCoordinator(engine, store, []);
  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "tracks", audio: [{ id: "1", label: "English" }], subtitles: [] });
  engine.starts[0].onEvent({ type: "position", positionSec: 5, durationSec: 20 });
  await coordinator.close();

  assert.deepEqual(engine.calls, ["stop", "stop"]);
  assert.equal(store.saves[0]?.audioTrackId, undefined);
  assert.equal(store.saves[0]?.subtitleTrackId, undefined);
});

test("switching files flushes the first media and fresh open restores its committed position", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  store.paths.set(mediaTwo, "second.mp4");
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "position", positionSec: 8, durationSec: 20 });
  await coordinator.open(mediaTwo);
  assert.equal(store.saves[0]?.mediaId, mediaOne);
  assert.equal(store.saves[0]?.positionSec, 8);

  await coordinator.close();
  const secondEngine = new FakeLocalEngine();
  const secondCoordinator = createCoordinator(secondEngine, store, []);
  await secondCoordinator.open(mediaOne);
  assert.equal(secondEngine.starts[0]?.startPositionSec, 8);
  await secondCoordinator.close();
});

test("local close and native shutdown leave fullscreen disabled", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  const events: LocalPlaybackEvent[] = [];
  const fullscreenCalls: boolean[] = [];
  const coordinator = createCoordinator(engine, store, events, fullscreenCalls);

  await coordinator.open(mediaOne);
  await coordinator.handle({ type: "fullscreen", enabled: true });
  fullscreenCalls.length = 0;
  await coordinator.close();
  assert.deepEqual(fullscreenCalls, [false]);

  fullscreenCalls.length = 0;
  await coordinator.open(mediaOne);
  engine.starts[1].onEvent({ type: "closed" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fullscreenCalls, [false]);
  assert.equal(events.at(-1)?.type, "closed");
});
