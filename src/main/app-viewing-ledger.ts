import {
  isCompletedWatch,
  type LocalViewingCloseReason,
  type LocalViewingSessionFinishInput,
  type LocalViewingSessionHeartbeatInput,
} from "../shared/local-library-contracts";
import type { LocalViewingSessionStore } from "../shared/local-playback-contracts";

/**
 * The main-process seam between a playback attempt and the local-library
 * viewing ledger. It owns the A1 rules (actual playing time, pause/seek
 * accounting, effective-watch and completion thresholds) so the player host and
 * the database owner stay independent.
 */
export interface ViewingLedger {
  begin(mediaId: `media_${string}`, startPositionSec: number): void;
  setPlaying(playing: boolean): void;
  observePosition(positionSec: number, durationSec?: number): void;
  countPause(): void;
  countSeek(): void;
  setSpeed(speed: number): void;
  heartbeat(): Promise<void>;
  finish(reason: LocalViewingCloseReason, positionSec: number, durationSec?: number): Promise<void>;
}

interface ActiveViewingSession {
  mediaId: `media_${string}`;
  startedAtMs: number;
  startPositionSec: number;
  playedSec: number;
  playingSinceMs?: number;
  endPositionSec: number;
  durationSec?: number;
  pauseCount: number;
  seekCount: number;
  speed: number;
  startPromise: Promise<string | undefined>;
  finished: boolean;
}

export class AppViewingLedger implements ViewingLedger {
  private session: ActiveViewingSession | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: LocalViewingSessionStore,
    private readonly now: () => number = Date.now,
  ) {}

  begin(mediaId: `media_${string}`, startPositionSec: number): void {
    const startedAtMs = this.now();
    const startPosition = finiteNonNegative(startPositionSec);
    const startPromise = this.store
      .startViewingSession({ mediaId, startedAtMs, startPositionSec: startPosition })
      .then((result) => result.sessionId)
      .catch(() => undefined);
    this.session = {
      mediaId,
      startedAtMs,
      startPositionSec: startPosition,
      playedSec: 0,
      endPositionSec: startPosition,
      pauseCount: 0,
      seekCount: 0,
      speed: 1,
      startPromise,
      finished: false,
    };
  }

  setPlaying(playing: boolean): void {
    const session = this.session;
    if (!session || session.finished) return;
    const timestamp = this.now();
    if (playing) {
      if (session.playingSinceMs === undefined) session.playingSinceMs = timestamp;
      return;
    }
    if (session.playingSinceMs !== undefined) {
      session.playedSec += secondsBetween(session.playingSinceMs, timestamp);
      session.playingSinceMs = undefined;
    }
  }

  observePosition(positionSec: number, durationSec?: number): void {
    const session = this.session;
    if (!session || session.finished) return;
    if (Number.isFinite(positionSec) && positionSec >= 0) session.endPositionSec = positionSec;
    if (durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0) session.durationSec = durationSec;
  }

  countPause(): void {
    if (this.session && !this.session.finished) this.session.pauseCount += 1;
  }

  countSeek(): void {
    if (this.session && !this.session.finished) this.session.seekCount += 1;
  }

  setSpeed(speed: number): void {
    if (!this.session || this.session.finished) return;
    if (Number.isFinite(speed) && speed > 0) this.session.speed = speed;
  }

  heartbeat(): Promise<void> {
    const session = this.session;
    if (!session || session.finished) return this.queue;
    const timestamp = this.now();
    this.enqueue(async () => {
      if (session.finished) return;
      const sessionId = await session.startPromise;
      if (!sessionId) return;
      await this.store.heartbeatViewingSession({ ...this.heartbeatSnapshot(session, timestamp), sessionId });
    });
    return this.queue;
  }

  finish(reason: LocalViewingCloseReason, positionSec: number, durationSec?: number): Promise<void> {
    const session = this.session;
    if (!session) return this.queue;
    session.finished = true;
    this.session = undefined;
    const timestamp = this.now();
    if (session.playingSinceMs !== undefined) {
      session.playedSec += secondsBetween(session.playingSinceMs, timestamp);
      session.playingSinceMs = undefined;
    }
    if (Number.isFinite(positionSec) && positionSec >= 0) session.endPositionSec = positionSec;
    if (durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0) session.durationSec = durationSec;
    const playedSec = roundMillis(Math.max(0, session.playedSec));
    const wallSec = roundMillis(secondsBetween(session.startedAtMs, timestamp));
    const completed = reason === "ended" || isCompletedWatch(playedSec, session.durationSec, session.endPositionSec);
    const input: LocalViewingSessionFinishInput = {
      mediaId: session.mediaId,
      sessionId: "",
      playedSec,
      wallSec,
      endPositionSec: finiteNonNegative(session.endPositionSec),
      ...(session.durationSec === undefined ? {} : { durationSec: session.durationSec }),
      pauseCount: session.pauseCount,
      seekCount: session.seekCount,
      speed: session.speed,
      heartbeatAtMs: timestamp,
      endedAtMs: timestamp,
      completed,
      closeReason: reason,
    };
    this.enqueue(async () => {
      const sessionId = await session.startPromise;
      if (!sessionId) return;
      await this.store.finishViewingSession({ ...input, sessionId });
    });
    return this.queue;
  }

  private heartbeatSnapshot(session: ActiveViewingSession, timestamp: number): Omit<LocalViewingSessionHeartbeatInput, "sessionId"> {
    return {
      playedSec: roundMillis(this.playedAt(session, timestamp)),
      wallSec: roundMillis(secondsBetween(session.startedAtMs, timestamp)),
      endPositionSec: finiteNonNegative(session.endPositionSec),
      ...(session.durationSec === undefined ? {} : { durationSec: session.durationSec }),
      pauseCount: session.pauseCount,
      seekCount: session.seekCount,
      speed: session.speed,
      heartbeatAtMs: timestamp,
    };
  }

  private playedAt(session: ActiveViewingSession, timestamp: number): number {
    const live = session.playingSinceMs === undefined ? 0 : secondsBetween(session.playingSinceMs, timestamp);
    return Math.max(0, session.playedSec + live);
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.catch(() => undefined).then(work).catch(() => undefined);
  }
}

function secondsBetween(startMs: number, endMs: number): number {
  return Math.max(0, (endMs - startMs) / 1000);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function roundMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}
