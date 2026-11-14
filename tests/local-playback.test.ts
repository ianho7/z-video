import assert from "node:assert/strict";
import test from "node:test";

import { isLocalPlaybackControlCommand, isLocalPlaybackOpenOptions, type LocalPlaybackEvent, type LocalPlaybackStore } from "../src/shared/local-playback-contracts";
import type { LocalPlaybackState, LocalViewingCloseReason } from "../src/shared/local-library-contracts";
import { LocalPlaybackCoordinator, type PlayerEngine, type PlayerEngineEvent } from "../src/main/player";
import type { ViewingLedger } from "../src/main/app-viewing-ledger";

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
  /** Test hook: blocking the gate keeps one save in flight (close must await it). */
  saveGate?: Promise<void>;

  resolveMediaPath(mediaId: LocalPlaybackState["mediaId"]): Promise<string | undefined> {
    return Promise.resolve(this.paths.get(mediaId));
  }

  getPlayback(mediaId: LocalPlaybackState["mediaId"]): Promise<LocalPlaybackState | undefined> {
    const state = this.states.get(mediaId);
    return Promise.resolve(state ? { ...state } : undefined);
  }

  async savePlayback(state: LocalPlaybackState): Promise<LocalPlaybackState> {
    if (this.saveGate) await this.saveGate;
    this.saves.push({ ...state });
    this.states.set(state.mediaId, { ...state });
    return { ...state };
  }
}

function createCoordinator(
  engine: FakeLocalEngine,
  store: MemoryPlaybackStore,
  events: LocalPlaybackEvent[],
  fullscreenCalls: boolean[] = [],
  ledger?: ViewingLedger,
): LocalPlaybackCoordinator {
  return new LocalPlaybackCoordinator(engine, (event) => events.push(event), (enabled) => fullscreenCalls.push(enabled), store, Date.now, ledger);
}

class FakeViewingLedger implements ViewingLedger {
  readonly begins: Array<{ mediaId: string; startPositionSec: number }> = [];
  readonly playing: boolean[] = [];
  readonly positions: Array<{ positionSec: number; durationSec?: number }> = [];
  readonly finishes: Array<{ reason: LocalViewingCloseReason; positionSec?: number; durationSec?: number }> = [];
  pauseCount = 0;
  seekCount = 0;
  speeds: number[] = [];

  begin(mediaId: `media_${string}`, startPositionSec: number): void {
    this.begins.push({ mediaId, startPositionSec });
  }

  setPlaying(playing: boolean): void {
    this.playing.push(playing);
  }

  observePosition(positionSec: number, durationSec?: number): void {
    this.positions.push({ positionSec, ...(durationSec === undefined ? {} : { durationSec }) });
  }

  countPause(): void {
    this.pauseCount += 1;
  }

  countSeek(): void {
    this.seekCount += 1;
  }

  setSpeed(speed: number): void {
    this.speeds.push(speed);
  }

  async heartbeat(): Promise<void> {}

  async finish(reason: LocalViewingCloseReason, positionSec: number | undefined, durationSec?: number): Promise<void> {
    this.finishes.push({
      reason,
      ...(positionSec === undefined ? {} : { positionSec }),
      ...(durationSec === undefined ? {} : { durationSec }),
    });
  }
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

test("local playback open options accept only the restart flag", () => {
  assert.equal(isLocalPlaybackOpenOptions({}), true);
  assert.equal(isLocalPlaybackOpenOptions({ restart: true }), true);
  assert.equal(isLocalPlaybackOpenOptions({ restart: "yes" }), false);
  assert.equal(isLocalPlaybackOpenOptions({ path: "C:\\private\\movie.mp4" }), false);
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

test("saved track preferences that this file does not offer are kept instead of cleared", async () => {
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

  // The saved preference survives the missing target and nothing was dispatched.
  assert.deepEqual(engine.calls, ["stop", "stop"]);
  assert.equal(store.saves[0]?.audioTrackId, "missing-audio");
  assert.equal(store.saves[0]?.subtitleTrackId, "missing-subtitle");
});

test("an empty track list never consumes the preference latch", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  store.states.set(mediaOne, {
    mediaId: mediaOne,
    positionSec: 0,
    audioTrackId: "2",
    subtitleTrackId: "7",
    watched: false,
    updatedAtMs: 1,
  });
  const coordinator = createCoordinator(engine, store, []);
  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "tracks", audio: [], subtitles: [] });
  engine.starts[0].onEvent({ type: "tracks", audio: [{ id: "1", label: "English" }, { id: "2", label: "中文" }], subtitles: [{ id: "7", label: "简体" }] });
  engine.starts[0].onEvent({ type: "position", positionSec: 5, durationSec: 20 });
  await coordinator.close();

  assert.equal(engine.calls.includes("audio:2"), true, "the saved audio track is applied once real tracks arrive");
  assert.equal(engine.calls.includes("subtitle:7"), true, "the saved subtitle is applied on the same event");
  assert.equal(store.saves[0]?.audioTrackId, "2", "the pre-application default must not overwrite the applied preference");
  assert.equal(store.saves[0]?.subtitleTrackId, "7");
});

test("an explicit subtitle-off preference dispatches sid=no when the file lists subtitles", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  store.states.set(mediaOne, { mediaId: mediaOne, positionSec: 0, subtitleTrackId: null, watched: false, updatedAtMs: 1 });
  const coordinator = createCoordinator(engine, store, []);
  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "tracks", audio: [{ id: "1", label: "English" }], subtitles: [{ id: "7", label: "简体", selected: true }] });
  engine.starts[0].onEvent({ type: "position", positionSec: 5, durationSec: 20 });
  await coordinator.close();

  assert.equal(engine.calls.includes("subtitle:off"), true);
  assert.equal(store.saves[0]?.subtitleTrackId, null, "the explicit off preference stays null and is not replaced by the default track");
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

test("restart opens from zero and a failed restart preserves the committed history", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  const previous: LocalPlaybackState = {
    mediaId: mediaOne,
    positionSec: 48,
    durationSec: 90,
    watched: true,
    updatedAtMs: 123,
  };
  store.states.set(mediaOne, previous);
  const coordinator = createCoordinator(engine, store, []);

  engine.startError = new Error("decoder failed");
  await coordinator.open(mediaOne, { restart: true });
  assert.equal(engine.starts[0]?.startPositionSec, 0);
  assert.deepEqual(store.states.get(mediaOne), previous);
  assert.equal(store.saves.length, 0);

  engine.startError = undefined;
  await coordinator.open(mediaOne, { restart: true });
  assert.equal(engine.starts[1]?.startPositionSec, 0);
  engine.starts[1].onEvent({ type: "position", positionSec: 3, durationSec: 90 });
  await coordinator.handle({ type: "close" });
  assert.equal(store.saves[0]?.watched, false);
  assert.equal(store.states.get(mediaOne)?.positionSec, 3);
  assert.equal(store.states.get(mediaOne)?.watched, false);
  assert.equal(store.saves.length, 1);
  await coordinator.close();
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

test("local playback records a viewing session with observed positions, pause/seek counts, and the ended reason", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  store.states.set(mediaOne, { mediaId: mediaOne, positionSec: 12, durationSec: 300, watched: false, updatedAtMs: 1 });
  const ledger = new FakeViewingLedger();
  const coordinator = createCoordinator(engine, store, [], [], ledger);

  await coordinator.open(mediaOne);
  assert.deepEqual(ledger.begins, [{ mediaId: mediaOne, startPositionSec: 12 }]);
  engine.starts[0].onEvent({ type: "ready", durationSec: 300 });
  engine.starts[0].onEvent({ type: "state", state: "playing" });
  engine.starts[0].onEvent({ type: "position", positionSec: 20, durationSec: 300 });
  engine.starts[0].onEvent({ type: "settings", volume: 80, muted: false, speed: 1.5 });
  await coordinator.handle({ type: "pause" });
  await coordinator.handle({ type: "seek", positionSec: 200 });
  engine.starts[0].onEvent({ type: "position", positionSec: 280, durationSec: 300 });
  engine.starts[0].onEvent({ type: "state", state: "ended" });
  await coordinator.close();

  assert.equal(ledger.pauseCount, 1, "a user pause is counted once");
  assert.equal(ledger.seekCount, 1, "a user seek is counted once");
  assert.deepEqual(ledger.speeds, [1.5]);
  assert.deepEqual(ledger.positions.at(-1), { positionSec: 280, durationSec: 300 });
  assert.equal(ledger.finishes.length, 1);
  assert.deepEqual(ledger.finishes[0], { reason: "ended", positionSec: 280, durationSec: 300 });
  assert.equal(ledger.playing.at(-1), false, "ended leaves the ledger in a non-playing state");
});

test("a local load failure still closes its viewing session as an error", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "broken.mp4");
  const ledger = new FakeViewingLedger();
  engine.startError = new Error("decoder failed");
  const coordinator = createCoordinator(engine, store, [], [], ledger);

  await coordinator.open(mediaOne);
  await coordinator.close();

  assert.equal(ledger.begins.length, 1);
  assert.equal(ledger.finishes.length, 1);
  assert.equal(ledger.finishes[0]?.reason, "error");
});

test("switching local media and native close both finish the previous viewing session", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  store.paths.set(mediaTwo, "second.mp4");
  const ledger = new FakeViewingLedger();
  const coordinator = createCoordinator(engine, store, [], [], ledger);

  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "position", positionSec: 8, durationSec: 20 });
  await coordinator.open(mediaTwo);
  assert.deepEqual(ledger.finishes.map((entry) => entry.reason), ["user-close"]);
  assert.equal(ledger.begins.length, 2);

  engine.starts[1].onEvent({ type: "position", positionSec: 4, durationSec: 20 });
  engine.starts[1].onEvent({ type: "closed" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ledger.finishes.map((entry) => entry.reason), ["user-close", "user-close"]);
  assert.equal(ledger.finishes.at(-1)?.positionSec, 4);
});

test("two close commands emit closed exactly once", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "position", positionSec: 5, durationSec: 20 });
  await Promise.all([coordinator.close(), coordinator.close()]);

  assert.equal(events.filter((event) => event.type === "closed").length, 1);
  assert.equal(store.saves.length, 1);
});

test("a native shutdown and close converge on exactly one closed event", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  store.paths.set(mediaTwo, "second.mp4");
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  // close() first, then the native shutdown arrives while it is still settling.
  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "position", positionSec: 5, durationSec: 20 });
  const closing = coordinator.close();
  engine.starts[0].onEvent({ type: "closed" });
  await closing;
  assert.equal(events.filter((event) => event.type === "closed").length, 1);

  // The other order: the shutdown starts the exit and close() joins it.
  await coordinator.open(mediaTwo);
  engine.starts[1].onEvent({ type: "position", positionSec: 3, durationSec: 20 });
  engine.starts[1].onEvent({ type: "closed" });
  await coordinator.close();
  assert.equal(events.filter((event) => event.type === "closed").length, 2);
});

test("a failed load keeps no usable active session", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "broken.mp4");
  engine.startError = new Error("decoder failed");
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  await coordinator.open(mediaOne);
  // Late engine reports for the failed attempt are dropped instead of being
  // projected as a working player.
  engine.starts[0].onEvent({ type: "ready", durationSec: 90 });
  engine.starts[0].onEvent({ type: "position", positionSec: 1, durationSec: 90 });
  engine.starts[0].onEvent({ type: "tracks", audio: [{ id: "1", label: "English" }], subtitles: [] });
  await coordinator.handle({ type: "play" });
  await coordinator.handle({ type: "seek", positionSec: 4 });
  await coordinator.handle({ type: "set-volume", volume: 20 });
  await coordinator.close();

  assert.deepEqual(events.map((event) => event.type), ["loading", "error", "closed"]);
  assert.deepEqual(engine.calls.filter((call) => call !== "stop"), [], "no control command reaches the engine after a failed load");
  assert.deepEqual(store.saves, []);
});

test("close waits for the queued progress write of the same state", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  let releaseSave!: () => void;
  store.saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const events: LocalPlaybackEvent[] = [];
  const coordinator = createCoordinator(engine, store, events);

  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "position", positionSec: 29, durationSec: 30 });
  engine.starts[0].onEvent({ type: "state", state: "ended" });
  let closed = false;
  const closing = coordinator.close().then(() => { closed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false, "close must not resolve while the same state is still being written");
  assert.equal(events.some((event) => event.type === "closed"), false);

  releaseSave();
  await closing;
  assert.equal(closed, true);
  assert.equal(store.saves.length, 1, "the identical state is written once");
  assert.equal(store.saves[0]?.watched, true);
  assert.equal(events.filter((event) => event.type === "closed").length, 1);
});

test("an ended attempt without a position event still persists watched", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  const coordinator = createCoordinator(engine, store, []);

  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "ready", durationSec: 600 });
  engine.starts[0].onEvent({ type: "state", state: "ended" });
  await coordinator.close();

  assert.equal(store.saves.length, 1);
  assert.equal(store.saves[0]?.watched, true, "watched is not dropped just because the engine never reported a position");
  assert.equal(store.saves[0]?.positionSec, 600, "the duration is the end position of a completed attempt");
});

test("replay after ended starts a new viewing attempt and clears watched", async () => {
  const engine = new FakeLocalEngine();
  const store = new MemoryPlaybackStore();
  store.paths.set(mediaOne, "first.mp4");
  const ledger = new FakeViewingLedger();
  const coordinator = createCoordinator(engine, store, [], [], ledger);

  await coordinator.open(mediaOne);
  engine.starts[0].onEvent({ type: "position", positionSec: 95, durationSec: 100 });
  engine.starts[0].onEvent({ type: "state", state: "ended" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.saves.at(-1)?.watched, true);

  await coordinator.handle({ type: "play" });

  assert.equal(engine.calls.includes("play"), true);
  assert.deepEqual(ledger.finishes, [{ reason: "ended", positionSec: 95, durationSec: 100 }], "the completed attempt is recorded once");
  assert.deepEqual(ledger.begins, [
    { mediaId: mediaOne, startPositionSec: 0 },
    { mediaId: mediaOne, startPositionSec: 0 },
  ], "the replay opens a new viewing session from the start");

  engine.starts[0].onEvent({ type: "position", positionSec: 6, durationSec: 100 });
  await coordinator.close();

  assert.equal(store.saves.at(-1)?.watched, false, "the replayed attempt is not completed");
  assert.equal(store.saves.at(-1)?.positionSec, 6);
  assert.equal(ledger.finishes.at(-1)?.reason, "user-close");
});
