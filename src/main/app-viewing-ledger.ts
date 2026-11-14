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
  /** `positionSec` is undefined when the engine never reported one; a resume position is not an end position. */
  finish(reason: LocalViewingCloseReason, positionSec: number | undefined, durationSec?: number): Promise<void>;
}

/** Which ledger store call failed; used for the main-process diagnostics trace. */
export type ViewingLedgerErrorContext = "start" | "heartbeat" | "finish";

interface ActiveViewingSession {
  mediaId: `media_${string}`;
  startedAtMs: number;
  startPositionSec: number;
  playedSec: number;
  playingSinceMs?: number;
  endPositionSec: number;
  /** True once the engine reported a position for this attempt. */
  observedPosition: boolean;
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
    private readonly reportError?: (context: ViewingLedgerErrorContext, error: unknown) => void,
  ) {}

  begin(mediaId: `media_${string}`, startPositionSec: number): void {
    const previous = this.session;
    // A second begin() without a finish() (media switch, replay) would leave
    // the previous row open forever, so settle it before starting the new one.
    if (previous) void this.finish("interrupted", previous.observedPosition ? previous.endPositionSec : undefined, previous.durationSec);
    const startedAtMs = this.now();
    const startPosition = finiteNonNegative(startPositionSec);
    const startPromise = this.store
      .startViewingSession({ mediaId, startedAtMs, startPositionSec: startPosition })
      .then((result) => result.sessionId)
      .catch((error: unknown) => {
        // The attempt is still playable; only the ledger row is missing, so it
        // must be observable rather than silently dropped.
        this.reportError?.("start", error);
        return undefined;
      });
    this.session = {
      mediaId,
      startedAtMs,
      startPositionSec: startPosition,
      playedSec: 0,
      endPositionSec: startPosition,
      observedPosition: false,
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
    if (Number.isFinite(positionSec) && positionSec >= 0) {
      session.endPositionSec = positionSec;
      session.observedPosition = true;
    }
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
      try {
        await this.store.heartbeatViewingSession({ ...this.heartbeatSnapshot(session, timestamp), sessionId });
      } catch (error) {
        this.reportError?.("heartbeat", error);
      }
    });
    return this.queue;
  }

  finish(reason: LocalViewingCloseReason, positionSec: number | undefined, durationSec?: number): Promise<void> {
    const session = this.session;
    if (!session) return this.queue;
    session.finished = true;
    this.session = undefined;
    const timestamp = this.now();
    if (session.playingSinceMs !== undefined) {
      session.playedSec += secondsBetween(session.playingSinceMs, timestamp);
      session.playingSinceMs = undefined;
    }
    if (positionSec !== undefined && Number.isFinite(positionSec) && positionSec >= 0) {
      session.endPositionSec = positionSec;
      session.observedPosition = true;
    }
    if (durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0) session.durationSec = durationSec;
    const playedSec = roundMillis(Math.max(0, session.playedSec));
    const wallSec = roundMillis(secondsBetween(session.startedAtMs, timestamp));
    // `ended` without any reported position still watched the file to its end,
    // so the duration is the end position; otherwise the last known position
    // stays (a resume position when nothing was observed).
    const endPositionSec = session.observedPosition
      ? session.endPositionSec
      : reason === "ended" && session.durationSec !== undefined
        ? session.durationSec
        : session.endPositionSec;
    // Completion: an explicit `ended` report, or an observed position at 90%+.
    // A load failure never completes and the resume position alone never counts.
    const completed = reason !== "error"
      && (reason === "ended" || (session.observedPosition && isCompletedWatch(playedSec, session.durationSec, endPositionSec)));
    const input: LocalViewingSessionFinishInput = {
      mediaId: session.mediaId,
      sessionId: "",
      playedSec,
      wallSec,
      endPositionSec: finiteNonNegative(endPositionSec),
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
      try {
        await this.store.finishViewingSession({ ...input, sessionId });
      } catch (error) {
        this.reportError?.("finish", error);
      }
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
