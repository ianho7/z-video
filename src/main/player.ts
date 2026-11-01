import type { PlaybackCommand, PlaybackEvent } from "../shared/contracts";
import type { LocalPlaybackControlCommand, LocalPlaybackEvent, LocalPlaybackMediaId, LocalPlaybackStore } from "../shared/local-playback-contracts";
import type { LocalPlaybackState } from "../shared/local-library-contracts";

export type PlayerEngineEvent =
  | { type: "ready"; durationSec?: number }
  | { type: "state"; state: "playing" | "paused" | "buffering" | "ended" }
  | { type: "position"; positionSec: number; durationSec?: number }
  | { type: "settings"; volume: number; muted: boolean; speed: number }
  | { type: "control-error"; message: string }
  | { type: "tracks"; audio: Array<{ id: string; label: string; selected?: boolean }>; subtitles: Array<{ id: string; label: string; selected?: boolean }> }
  | { type: "error"; message: string }
  | { type: "closed" };

/** Main-process identity for one playback attempt. It contains no URI/path. */
export interface PlaybackIdentity {
  collectionId: string;
  classificationId: string;
  episodeId: string;
}

/** Main-only result of resolving an Episode to a server-provided stream. */
export interface PlaybackTarget {
  source: string;
  videoId: string;
  /** Main-resolved NAS history for this exact Episode. Renderer hints are ignored. */
  resumePositionSec?: number;
  /** Main-only session binding used to reject late progress from an old Account. */
  sessionKey?: string;
  durationSec?: number;
  audioIndex?: number;
  subtitleIndex?: number;
  chapter?: number;
  subtitleHash?: string;
  subtitleSetting?: string;
}

export interface PlaybackProgressSnapshot {
  positionSec: number;
  durationSec?: number;
  audioIndex: number;
  subtitleIndex: number;
}

export interface PlaybackCoordinatorOptions {
  resolve?: (command: Extract<PlaybackCommand, { type: "open" }>) => Promise<PlaybackTarget>;
  reportProgress?: (identity: PlaybackIdentity, target: PlaybackTarget, snapshot: PlaybackProgressSnapshot) => Promise<void>;
  rememberPlayback?: (identity: PlaybackIdentity) => Promise<void>;
  onUnauthorized?: (error: unknown, sessionKey?: string) => Promise<void> | void;
}

/**
 * The main-process native boundary. The selected file path or stream URI never
 * crosses this interface into renderer-facing events; it is only consumed by
 * the engine.
 */
export interface PlayerEngine {
  start(source: string, startPositionSec: number | undefined, onEvent: (event: PlayerEngineEvent) => void): void | Promise<void>;
  stop(): void | Promise<void>;
  play(): void | Promise<void>;
  pause(): void | Promise<void>;
  seek(positionSec: number): void | Promise<void>;
  setVolume(volume: number): void | Promise<void>;
  setMuted(muted: boolean): void | Promise<void>;
  setSpeed(speed: number): void | Promise<void>;
  setAudioTrack(trackId: string): void | Promise<void>;
  setSubtitleTrack(trackId: string | null): void | Promise<void>;
  addSubtitleFile(path: string): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

interface ActiveLocalPlayback {
  generation: number;
  mediaId: LocalPlaybackMediaId;
  state?: LocalPlaybackState;
  loadFailed: boolean;
  positionSec: number;
  durationSec?: number;
  audioTrackId?: string;
  subtitleTrackId?: string | null;
  watched: boolean;
  observedPosition: boolean;
  trackPreferencesApplied: boolean;
  lastPersistedFingerprint?: string;
  queuedPersistFingerprint?: string;
}

/**
 * Main-process local playback owner. It resolves an opaque mediaId through the
 * local-library owner, gives the private path only to the native engine, and
 * sends renderer-safe events containing the mediaId only.
 */
export class LocalPlaybackCoordinator {
  private generation = 0;
  private active: ActiveLocalPlayback | undefined;
  private progressTimer: NodeJS.Timeout | undefined;
  private flushQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly engine: PlayerEngine,
    private readonly emit: (event: LocalPlaybackEvent) => void,
    private readonly setWindowFullscreen: (enabled: boolean) => void,
    private readonly store: LocalPlaybackStore,
    private readonly now: () => number = Date.now,
  ) {}

  async open(mediaId: LocalPlaybackMediaId): Promise<void> {
    const generation = await this.beginTransition();
    if (generation === undefined) return;
    this.active = {
      generation,
      mediaId,
      loadFailed: false,
      positionSec: 0,
      watched: false,
      observedPosition: false,
      trackPreferencesApplied: false,
    };
    this.emit({ type: "loading", mediaId });
    try {
      const [state, path] = await Promise.all([
        this.store.getPlayback(mediaId),
        this.store.resolveMediaPath(mediaId),
      ]);
      if (!this.isCurrent(generation, mediaId)) return;
      if (!path) throw new Error("indexed media is unavailable");
      const active = this.active;
      if (!active) return;
      active.state = state;
      active.positionSec = finiteNonNegative(state?.positionSec) ?? 0;
      active.durationSec = finiteNonNegative(state?.durationSec);
      active.audioTrackId = state?.audioTrackId;
      active.subtitleTrackId = state?.subtitleTrackId;
      active.watched = state?.watched === true;
      await this.engine.start(path, finiteNonNegative(state?.positionSec), (event) => {
        if (this.isCurrent(generation, mediaId)) this.onEngineEvent(generation, mediaId, event);
      });
      if (!this.isCurrent(generation, mediaId)) await this.engine.stop();
    } catch {
      const active = this.active;
      if (!active || !this.isCurrent(generation, mediaId)) return;
      active.loadFailed = true;
      this.clearProgressTimer();
      this.emit({ type: "error", mediaId, message: "本地媒体加载失败。" });
    }
  }

  async handle(command: LocalPlaybackControlCommand): Promise<void> {
    if (command.type === "fullscreen") {
      this.setWindowFullscreen(command.enabled);
      return;
    }
    if (command.type === "close") {
      await this.close();
      return;
    }
    const active = this.active;
    if (!active) return;
    switch (command.type) {
      case "play":
        await this.engine.play();
        break;
      case "pause":
        await this.engine.pause();
        await this.flushProgress(active, active.generation);
        break;
      case "seek":
        // Do not persist the requested value until libmpv reports time-pos.
        await this.engine.seek(command.positionSec);
        break;
      case "set-volume":
        await this.engine.setVolume(command.volume);
        break;
      case "set-muted":
        await this.engine.setMuted(command.muted);
        break;
      case "set-speed":
        await this.engine.setSpeed(command.speed);
        break;
      case "set-audio-track":
        await this.engine.setAudioTrack(command.trackId);
        active.audioTrackId = command.trackId;
        break;
      case "set-subtitle-track":
        await this.engine.setSubtitleTrack(command.trackId);
        active.subtitleTrackId = command.trackId;
        break;
    }
  }

  async chooseExternalSubtitle(pickFile: () => Promise<string | undefined>): Promise<{ loaded: boolean }> {
    const active = this.active;
    if (!active || active.loadFailed) return { loaded: false };
    const { generation, mediaId } = active;
    let path: string | undefined;
    try {
      path = await pickFile();
    } catch {
      if (this.isCurrent(generation, mediaId)) this.emit({ type: "control-error", mediaId, message: "无法打开字幕选择器。" });
      return { loaded: false };
    }
    if (!path || !this.isCurrent(generation, mediaId)) return { loaded: false };
    try {
      await this.engine.addSubtitleFile(path);
      return { loaded: true };
    } catch {
      if (this.isCurrent(generation, mediaId)) this.emit({ type: "control-error", mediaId, message: "外部字幕加载失败。" });
      return { loaded: false };
    }
  }

  async close(): Promise<void> {
    const generation = ++this.generation;
    const previous = this.active;
    const mediaId = previous?.mediaId;
    this.active = undefined;
    this.clearProgressTimer();
    this.setWindowFullscreen(false);
    await this.flushProgress(previous, generation);
    if (generation !== this.generation) return;
    await this.engine.stop();
    await this.engine.destroy?.();
    if (mediaId) this.emit({ type: "closed", mediaId });
  }

  private async beginTransition(): Promise<number | undefined> {
    const generation = ++this.generation;
    const previous = this.active;
    this.active = undefined;
    this.clearProgressTimer();
    await this.flushProgress(previous, generation);
    if (generation !== this.generation) return undefined;
    await this.engine.stop();
    return generation;
  }

  private async flushProgress(active: ActiveLocalPlayback | undefined, generation: number): Promise<void> {
    if (!active || active.loadFailed || !active.observedPosition || !finiteNonNegative(active.positionSec)) return;
    const state: LocalPlaybackState = {
      mediaId: active.mediaId,
      positionSec: Math.max(0, active.positionSec),
      ...(finiteNonNegative(active.durationSec) === undefined ? {} : { durationSec: active.durationSec }),
      ...(active.audioTrackId === undefined ? {} : { audioTrackId: active.audioTrackId }),
      ...(active.subtitleTrackId === undefined ? {} : { subtitleTrackId: active.subtitleTrackId }),
      watched: active.watched,
      updatedAtMs: this.now(),
    };
    const fingerprint = JSON.stringify({
      mediaId: state.mediaId,
      positionSec: state.positionSec,
      durationSec: state.durationSec,
      audioTrackId: state.audioTrackId,
      subtitleTrackId: state.subtitleTrackId,
      watched: state.watched,
    });
    if (active.lastPersistedFingerprint === fingerprint || active.queuedPersistFingerprint === fingerprint) return;
    active.queuedPersistFingerprint = fingerprint;
    await this.enqueueFlush(async () => {
      try {
        await this.store.savePlayback(state);
        active.lastPersistedFingerprint = fingerprint;
      } catch {
        if (generation === this.generation) this.emit({ type: "error", mediaId: active.mediaId, message: "播放进度保存失败。" });
      } finally {
        if (active.queuedPersistFingerprint === fingerprint) active.queuedPersistFingerprint = undefined;
      }
    });
  }

  private enqueueFlush(work: () => Promise<void>): Promise<void> {
    const next = this.flushQueue.catch(() => undefined).then(work);
    this.flushQueue = next.catch(() => undefined);
    return next;
  }

  private onEngineEvent(generation: number, mediaId: LocalPlaybackMediaId, event: PlayerEngineEvent): void {
    const active = this.active;
    if (!active || !this.isCurrent(generation, mediaId)) return;
    switch (event.type) {
      case "ready":
        active.durationSec = finiteNonNegative(event.durationSec) ?? active.durationSec;
        this.emit({ type: "ready", mediaId, ...(active.durationSec === undefined ? {} : { durationSec: active.durationSec }) });
        break;
      case "state":
        if (event.state === "ended") {
          active.watched = true;
          void this.flushProgress(active, generation);
        } else if (event.state === "paused") {
          void this.flushProgress(active, generation);
        }
        this.emit({ type: "state", mediaId, state: event.state });
        break;
      case "position": {
        const position = finiteNonNegative(event.positionSec);
        if (position === undefined) return;
        active.observedPosition = true;
        active.positionSec = position;
        active.durationSec = finiteNonNegative(event.durationSec) ?? active.durationSec;
        this.startProgressTimer(generation, mediaId);
        this.emit({ type: "position", mediaId, positionSec: position, ...(active.durationSec === undefined ? {} : { durationSec: active.durationSec }) });
        break;
      }
      case "settings":
        this.emit({ type: "settings", mediaId, volume: event.volume, muted: event.muted, speed: event.speed });
        break;
      case "control-error":
        this.emit({ type: "control-error", mediaId, message: event.message });
        break;
      case "tracks":
        this.applyTrackPreferences(active, event);
        this.updateSelectedTracks(active, event);
        this.emit({ type: "tracks", mediaId, audio: event.audio, subtitles: event.subtitles });
        break;
      case "error":
        active.loadFailed = true;
        this.clearProgressTimer();
        this.emit({ type: "error", mediaId, message: "本地媒体加载失败。" });
        break;
      case "closed":
        void this.handleNativeClosed(active, generation);
        break;
    }
  }

  private async handleNativeClosed(active: ActiveLocalPlayback, generation: number): Promise<void> {
    if (!this.active || this.active !== active) return;
    this.generation += 1;
    this.active = undefined;
    this.clearProgressTimer();
    this.setWindowFullscreen(false);
    await this.flushProgress(active, this.generation);
    await this.engine.destroy?.();
    if (this.generation === generation + 1) this.emit({ type: "closed", mediaId: active.mediaId });
  }

  private applyTrackPreferences(active: ActiveLocalPlayback, event: Extract<PlayerEngineEvent, { type: "tracks" }>): void {
    if (active.trackPreferencesApplied) return;
    active.trackPreferencesApplied = true;
    if (active.audioTrackId !== undefined) {
      if (event.audio.some((track) => track.id === active.audioTrackId)) {
        void Promise.resolve(this.engine.setAudioTrack(active.audioTrackId)).catch(() => undefined);
      } else {
        active.audioTrackId = undefined;
      }
    }
    if (active.subtitleTrackId === null) {
      void Promise.resolve(this.engine.setSubtitleTrack(null)).catch(() => undefined);
    } else if (active.subtitleTrackId !== undefined) {
      if (event.subtitles.some((track) => track.id === active.subtitleTrackId)) {
        void Promise.resolve(this.engine.setSubtitleTrack(active.subtitleTrackId)).catch(() => undefined);
      } else {
        active.subtitleTrackId = undefined;
      }
    }
  }

  private updateSelectedTracks(active: ActiveLocalPlayback, event: Extract<PlayerEngineEvent, { type: "tracks" }>): void {
    const selectedAudio = event.audio.find((track) => track.selected);
    const selectedSubtitle = event.subtitles.find((track) => track.selected);
    if (selectedAudio) active.audioTrackId = selectedAudio.id;
    if (selectedSubtitle) active.subtitleTrackId = selectedSubtitle.id;
  }

  private startProgressTimer(generation: number, mediaId: LocalPlaybackMediaId): void {
    if (this.progressTimer) return;
    this.progressTimer = setInterval(() => {
      const active = this.active;
      if (active && this.isCurrent(generation, mediaId)) void this.flushProgress(active, generation);
    }, 10_000);
  }

  private clearProgressTimer(): void {
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = undefined;
  }

  private isCurrent(generation: number, mediaId: LocalPlaybackMediaId): boolean {
    return generation === this.generation && this.active?.mediaId === mediaId;
  }
}

interface ActivePlayback {
  generation: number;
  episodeId: string;
  identity?: PlaybackIdentity;
  target?: PlaybackTarget;
  progressEnabled: boolean;
  loadFailed: boolean;
  positionSec: number;
  durationSec?: number;
  audioIndex: number;
  subtitleIndex: number;
  local: boolean;
}

export class PlaybackCoordinator {
  private generation = 0;
  private activeEpisodeId: string | undefined;
  private active: ActivePlayback | undefined;
  private progressTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly engine: PlayerEngine,
    private readonly emit: (event: PlaybackEvent) => void,
    private readonly setWindowFullscreen: (enabled: boolean) => void,
    private readonly options: PlaybackCoordinatorOptions = {},
  ) {}

  async openLocal(path: string, episodeId = "local-file", startPositionSec?: number): Promise<void> {
    const generation = await this.beginTransition();
    if (generation === undefined) return;
    this.activeEpisodeId = episodeId;
    this.active = {
      generation,
      episodeId,
      progressEnabled: false,
      loadFailed: false,
      positionSec: 0,
      local: true,
      audioIndex: 0,
      subtitleIndex: 0,
    };
    this.emit({ type: "loading", episodeId });
    try {
      await this.engine.start(path, startPositionSec, (event) => {
        if (!this.isCurrent(generation, episodeId)) return;
        this.onEngineEvent(episodeId, event);
      });
    } catch {
      if (this.isCurrent(generation, episodeId)) this.emit({ type: "error", episodeId, message: "本地媒体加载失败。" });
    }
  }

  async handle(command: PlaybackCommand): Promise<void> {
    if (command.type === "open") {
      if (!this.options.resolve) {
        this.emit({ type: "error", episodeId: command.episodeId, message: "NAS 播放模块尚未就绪。" });
        return;
      }
      await this.openNas(command);
      return;
    }
    if (command.type === "fullscreen") {
      this.setWindowFullscreen(command.enabled);
      return;
    }
    if (command.type === "close") {
      await this.close();
      return;
    }
    if (!this.activeEpisodeId) return;
    switch (command.type) {
      case "play":
        await this.engine.play();
        break;
      case "pause":
        await this.engine.pause();
        break;
      case "seek":
        {
          const active = this.active;
          const generation = active?.generation;
          const episodeId = active?.episodeId;
          await this.engine.seek(command.positionSec);
          if (active && generation !== undefined && episodeId && this.isCurrent(generation, episodeId) && this.active === active) active.positionSec = Math.max(0, command.positionSec);
        }
        break;
      case "set-audio-track":
        await this.engine.setAudioTrack(command.trackId);
        if (this.active) this.updateTrackIndex("audio", command.trackId);
        break;
      case "set-subtitle-track":
        await this.engine.setSubtitleTrack(command.trackId);
        if (this.active) this.updateTrackIndex("subtitle", command.trackId);
        break;
    }
  }

  async addExternalSubtitle(path: string): Promise<boolean> {
    const episodeId = this.activeEpisodeId;
    if (!episodeId) return false;
    try {
      await this.engine.addSubtitleFile(path);
      return true;
    } catch {
      this.emit({ type: "error", episodeId, message: "外部字幕加载失败。" });
      return false;
    }
  }

  async close(): Promise<void> {
    const generation = ++this.generation;
    const previous = this.active;
    const episodeId = this.activeEpisodeId;
    this.active = undefined;
    this.activeEpisodeId = undefined;
    this.clearProgressTimer();
    this.setWindowFullscreen(false);
    await this.flushProgress(previous, generation);
    if (generation !== this.generation) return;
    await this.engine.stop();
    await this.engine.destroy?.();
    this.emit({ type: "closed", ...(episodeId ? { episodeId } : {}) });
  }

  private async openNas(command: Extract<PlaybackCommand, { type: "open" }>): Promise<void> {
    const generation = await this.beginTransition();
    if (generation === undefined) return;
    const episodeId = command.episodeId;
    this.activeEpisodeId = episodeId;
    this.emit({ type: "loading", episodeId });
    let target: PlaybackTarget;
    try {
      target = await this.options.resolve!(command);
    } catch (error) {
      if (generation !== this.generation) return;
      await this.handleResolutionError(episodeId, error);
      return;
    }
    if (generation !== this.generation || this.activeEpisodeId !== episodeId) return;
    const position = target.resumePositionSec !== undefined && Number.isFinite(target.resumePositionSec) && target.resumePositionSec >= 0 ? target.resumePositionSec : undefined;
    this.active = {
      generation,
      episodeId,
      identity: { collectionId: command.collectionId, classificationId: command.classificationId, episodeId },
      target,
      progressEnabled: false,
      loadFailed: false,
      positionSec: position ?? 0,
      durationSec: target.durationSec,
      audioIndex: target.audioIndex ?? 0,
      subtitleIndex: target.subtitleIndex ?? 0,
      local: false,
    };
    try {
      await this.engine.start(target.source, position, (event) => {
        if (!this.isCurrent(generation, episodeId)) return;
        this.onEngineEvent(episodeId, event);
      });
      if (!this.isCurrent(generation, episodeId)) return;
    } catch {
      if (this.isCurrent(generation, episodeId)) {
        if (this.active) this.active.loadFailed = true;
        this.clearProgressTimer();
        this.emit({ type: "error", episodeId, message: "NAS 媒体加载失败。" });
      }
    }
  }

  private async beginTransition(): Promise<number | undefined> {
    const generation = ++this.generation;
    const previous = this.active;
    this.active = undefined;
    this.activeEpisodeId = undefined;
    this.clearProgressTimer();
    await this.flushProgress(previous, generation);
    if (generation !== this.generation) return undefined;
    await this.engine.stop();
    return generation;
  }

  private async flushProgress(active: ActivePlayback | undefined, generation: number): Promise<void> {
    if (!active?.identity || !active.target || !active.progressEnabled || active.loadFailed || !this.options.reportProgress) return;
    try {
      await this.options.reportProgress(active.identity, active.target, this.snapshot(active));
    } catch (error) {
      if (isStalePlaybackError(error)) return;
      if (isUnauthorizedError(error)) {
        await this.options.onUnauthorized?.(error, active.target.sessionKey);
        return;
      }
      if (generation === this.generation) this.emit({ type: "error", episodeId: active.episodeId, message: "播放进度保存失败，NAS 未确认写入。" });
    }
  }

  private startProgressTimer(generation: number, episodeId: string): void {
    this.clearProgressTimer();
    if (!this.options.reportProgress) return;
    this.progressTimer = setInterval(() => {
      void this.reportCurrentProgress(generation, episodeId);
    }, 10_000);
  }

  private async reportCurrentProgress(generation: number, episodeId: string): Promise<void> {
    const active = this.active;
    if (!active || !active.identity || !active.target || !active.progressEnabled || active.loadFailed || !this.isCurrent(generation, episodeId) || !this.options.reportProgress) return;
    try {
      await this.options.reportProgress(active.identity, active.target, this.snapshot(active));
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await this.stopAfterUnauthorized(generation, episodeId, error, active.target.sessionKey);
        return;
      }
      if (isStalePlaybackError(error)) return;
      if (this.isCurrent(generation, episodeId)) this.emit({ type: "error", episodeId, message: "播放进度保存失败，NAS 未确认写入。" });
    }
  }

  private async stopAfterUnauthorized(generation: number, episodeId: string, error: unknown, sessionKey?: string): Promise<void> {
    if (!this.isCurrent(generation, episodeId)) return;
    await this.options.onUnauthorized?.(error, sessionKey);
    if (!this.isCurrent(generation, episodeId)) return;
    this.generation += 1;
    this.active = undefined;
    this.activeEpisodeId = undefined;
    this.clearProgressTimer();
    this.setWindowFullscreen(false);
    await this.engine.stop();
    await this.engine.destroy?.();
    this.emit({ type: "error", episodeId, message: "登录已失效，请重新登录。" });
    this.emit({ type: "closed", episodeId });
  }

  private snapshot(active: ActivePlayback): PlaybackProgressSnapshot {
    return {
      positionSec: Math.max(0, active.positionSec),
      ...(active.durationSec === undefined ? {} : { durationSec: Math.max(0, active.durationSec) }),
      audioIndex: Number.isFinite(active.audioIndex) ? Math.round(active.audioIndex) : 0,
      subtitleIndex: Number.isFinite(active.subtitleIndex) ? Math.round(active.subtitleIndex) : 0,
    };
  }

  private isCurrent(generation: number, episodeId: string): boolean {
    return generation === this.generation && this.activeEpisodeId === episodeId;
  }

  private async handleResolutionError(episodeId: string, error: unknown): Promise<void> {
    if (isStalePlaybackError(error)) return;
    if (isUnauthorizedError(error)) {
      await this.options.onUnauthorized?.(error);
      this.emit({ type: "error", episodeId, message: "登录已失效，请重新登录。" });
      return;
    }
    this.emit({ type: "error", episodeId, message: "无法获取 NAS 媒体。" });
  }

  private onEngineEvent(episodeId: string, event: PlayerEngineEvent): void {
    const active = this.active;
    if (!active || active.episodeId !== episodeId) return;
    switch (event.type) {
      case "ready":
        if (active.loadFailed) return;
        active.durationSec = event.durationSec ?? active.durationSec;
        this.enableProgress(active);
        if (!active.local) {
          if (active.target?.audioIndex !== undefined) void Promise.resolve(this.engine.setAudioTrack(String(active.target.audioIndex))).catch(() => undefined);
          if (active.target?.subtitleIndex !== undefined) void Promise.resolve(this.engine.setSubtitleTrack(active.target.subtitleIndex < 0 ? null : String(active.target.subtitleIndex))).catch(() => undefined);
        }
        this.emit({ type: "ready", episodeId, ...(active.durationSec === undefined ? {} : { durationSec: active.durationSec }) });
        break;
      case "state":
        this.emit({ type: "state", state: event.state });
        break;
      case "position":
        if (active.loadFailed) return;
        this.enableProgress(active);
        active.positionSec = Number.isFinite(event.positionSec) ? Math.max(0, event.positionSec) : active.positionSec;
        active.durationSec = event.durationSec ?? active.durationSec;
        this.emit({
          type: "position",
          episodeId,
          positionSec: active.positionSec,
          ...(active.durationSec === undefined ? {} : { durationSec: active.durationSec }),
        });
        break;
      case "tracks":
        this.updateSelectedTrackIndexes(active, event);
        this.emit({ type: "tracks", audio: event.audio, subtitles: event.subtitles });
        break;
      case "error":
        active.loadFailed = true;
        this.clearProgressTimer();
        this.emit({ type: "error", episodeId, message: active.local ? "本地媒体加载失败。" : "NAS 媒体加载失败。" });
        break;
      case "closed":
        void this.handleNativeClosed(active);
        break;
    }
  }

  private async handleNativeClosed(active: ActivePlayback): Promise<void> {
    const generation = ++this.generation;
    this.active = undefined;
    this.activeEpisodeId = undefined;
    this.clearProgressTimer();
    this.setWindowFullscreen(false);
    await this.flushProgress(active, generation);
    if (generation === this.generation) this.emit({ type: "closed", episodeId: active.episodeId });
  }

  private updateSelectedTrackIndexes(active: ActivePlayback, event: Extract<PlayerEngineEvent, { type: "tracks" }>): void {
    const selectedAudio = event.audio.find((track) => track.selected);
    const selectedSubtitle = event.subtitles.find((track) => track.selected);
    if (selectedAudio) this.updateTrackIndex("audio", selectedAudio.id);
    if (selectedSubtitle) this.updateTrackIndex("subtitle", selectedSubtitle.id);
    if (event.subtitles.length > 0 && !selectedSubtitle && active.target?.subtitleIndex !== undefined && active.target.subtitleIndex < 0) active.subtitleIndex = -1;
  }

  private enableProgress(active: ActivePlayback): void {
    if (active.local || active.progressEnabled || active.loadFailed || !active.identity) return;
    active.progressEnabled = true;
    void Promise.resolve(this.options.rememberPlayback?.(active.identity)).catch(() => {
      if (this.isCurrent(active.generation, active.episodeId)) this.emit({ type: "error", episodeId: active.episodeId, message: "无法保存播放上下文，进度仍由 NAS 管理。" });
    });
    this.startProgressTimer(active.generation, active.episodeId);
  }

  private updateTrackIndex(kind: "audio" | "subtitle", trackId: string | null): void {
    if (!this.active) return;
    if (kind === "subtitle" && trackId === null) {
      this.active.subtitleIndex = -1;
      return;
    }
    const parsed = Number(trackId);
    if (Number.isFinite(parsed)) {
      if (kind === "audio") this.active.audioIndex = Math.round(parsed);
      else this.active.subtitleIndex = Math.round(parsed);
    }
  }

  private clearProgressTimer(): void {
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = undefined;
  }
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "unauthorized" || value.status === 401 || value.status === 403;
}

function isStalePlaybackError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { kind?: unknown }).kind === "stale";
}
