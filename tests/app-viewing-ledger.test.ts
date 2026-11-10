import assert from "node:assert/strict";
import test from "node:test";

import { AppViewingLedger } from "../src/main/app-viewing-ledger";
import type { LocalViewingSessionStore } from "../src/shared/local-playback-contracts";
import type { LocalViewingSessionFinishInput, LocalViewingSessionHeartbeatInput, LocalViewingSessionStartInput } from "../src/shared/local-library-contracts";

const mediaOne = "media_11111111-1111-4111-8111-111111111111" as const;

class MemoryViewingStore implements LocalViewingSessionStore {
  readonly starts: LocalViewingSessionStartInput[] = [];
  readonly heartbeats: LocalViewingSessionHeartbeatInput[] = [];
  readonly finishes: LocalViewingSessionFinishInput[] = [];
  private nextId = 0;

  async startViewingSession(input: LocalViewingSessionStartInput): Promise<{ sessionId: string }> {
    this.starts.push({ ...input });
    this.nextId += 1;
    return { sessionId: `session_00000000-0000-4000-8000-${String(this.nextId).padStart(12, "0")}` };
  }

  async heartbeatViewingSession(input: LocalViewingSessionHeartbeatInput): Promise<void> {
    this.heartbeats.push({ ...input });
  }

  async finishViewingSession(input: LocalViewingSessionFinishInput): Promise<undefined> {
    this.finishes.push({ ...input });
    return undefined;
  }
}

function fakeClock(start = 1_700_000_000_000): { now: () => number; advance: (seconds: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (seconds: number) => { current += seconds * 1000; },
  };
}

test("viewing ledger counts actual playing time only and keeps pause/wall clock separate", async () => {
  const store = new MemoryViewingStore();
  const clock = fakeClock();
  const ledger = new AppViewingLedger(store, clock.now);

  ledger.begin(mediaOne, 12);
  clock.advance(5);
  ledger.setPlaying(true);
  clock.advance(20);
  ledger.setPlaying(false);
  ledger.countPause();
  clock.advance(100);
  ledger.setPlaying(true);
  clock.advance(15);
  ledger.countSeek();
  ledger.observePosition(80, 600);
  ledger.setSpeed(1.5);
  await ledger.finish("user-close", 80, 600);

  assert.equal(store.starts.length, 1);
  assert.deepEqual(store.starts[0], { mediaId: mediaOne, startedAtMs: 1_700_000_000_000, startPositionSec: 12 });
  assert.equal(store.finishes.length, 1);
  const finish = store.finishes[0];
  assert.equal(finish.mediaId, mediaOne);
  assert.equal(finish.playedSec, 35, "paused wall time is not actual playing time");
  assert.equal(finish.wallSec, 140, "wall time spans open to close");
  assert.equal(finish.pauseCount, 1);
  assert.equal(finish.seekCount, 1);
  assert.equal(finish.speed, 1.5);
  assert.equal(finish.endPositionSec, 80);
  assert.equal(finish.durationSec, 600);
  assert.equal(finish.closeReason, "user-close");
  assert.equal(finish.completed, false, "5 seconds of actual playback never completes a ten-minute file");
});

test("viewing ledger heartbeats use the last heartbeat and finish settles once", async () => {
  const store = new MemoryViewingStore();
  const clock = fakeClock();
  const ledger = new AppViewingLedger(store, clock.now);

  ledger.begin(mediaOne, 0);
  ledger.setPlaying(true);
  clock.advance(10);
  await ledger.heartbeat();
  clock.advance(5);
  await ledger.finish("user-close", 15, 3600);
  await ledger.finish("user-close", 15, 3600);

  assert.equal(store.heartbeats.length, 1);
  assert.equal(store.heartbeats[0].playedSec, 10);
  assert.equal(store.heartbeats[0].wallSec, 10);
  assert.equal(store.finishes.length, 1, "a second finish is ignored");
  assert.equal(store.finishes[0].playedSec, 15);
  assert.equal(store.finishes[0].wallSec, 15);
});

test("completion needs an ended event or 90% plus real playback", async () => {
  async function finishWith(options: { playedSec: number; durationSec?: number; endPositionSec: number; reason: "ended" | "user-close" }) {
    const store = new MemoryViewingStore();
    const clock = fakeClock();
    const ledger = new AppViewingLedger(store, clock.now);
    ledger.begin(mediaOne, 0);
    ledger.setPlaying(true);
    clock.advance(options.playedSec);
    await ledger.finish(options.reason, options.endPositionSec, options.durationSec);
    return store.finishes[0];
  }

  assert.equal((await finishWith({ playedSec: 31, durationSec: 300, endPositionSec: 250, reason: "user-close" })).completed, false, "83% is not completion");
  assert.equal((await finishWith({ playedSec: 31, durationSec: 300, endPositionSec: 280, reason: "user-close" })).completed, true, "93% with 31 played seconds completes");
  assert.equal((await finishWith({ playedSec: 5, durationSec: 300, endPositionSec: 295, reason: "user-close" })).completed, false, "a seek to the end never fakes completion");
  assert.equal((await finishWith({ playedSec: 5, durationSec: 300, endPositionSec: 295, reason: "ended" })).completed, true, "an explicit ended event completes");
  assert.equal((await finishWith({ playedSec: 31, endPositionSec: 31, reason: "user-close" })).completed, false, "unknown duration completes only through ended");
});
