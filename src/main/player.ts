import type { PlaybackCommand, PlaybackEvent } from "../shared/contracts";

export type PlayerEngineEvent =
  | { type: "ready"; durationSec?: number }
  | { type: "state"; state: "playing" | "paused" | "buffering" | "ended" }
  | { type: "position"; positionSec: number; durationSec?: number }
  | { type: "tracks"; audio: Array<{ id: string; label: string; selected?: boolean }>; subtitles: Array<{ id: string; label: string; selected?: boolean }> }
  | { type: "error"; message: string }
  | { type: "closed" };

/**
 * The main-process native boundary. The selected file path never crosses this
 * interface into renderer-facing events; it is only consumed by the engine.
 */
export interface PlayerEngine {
  start(path: string, startPositionSec: number | undefined, onEvent: (event: PlayerEngineEvent) => void): void | Promise<void>;
  stop(): void | Promise<void>;
  play(): void | Promise<void>;
  pause(): void | Promise<void>;
  seek(positionSec: number): void | Promise<void>;
  setAudioTrack(trackId: string): void | Promise<void>;
  setSubtitleTrack(trackId: string | null): void | Promise<void>;
  addSubtitleFile(path: string): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export class PlaybackCoordinator {
  private generation = 0;
  private activeEpisodeId: string | undefined;

  constructor(
    private readonly engine: PlayerEngine,
    private readonly emit: (event: PlaybackEvent) => void,
    private readonly setWindowFullscreen: (enabled: boolean) => void,
  ) {}

  async openLocal(path: string, episodeId = "local-file", startPositionSec?: number): Promise<void> {
    const generation = ++this.generation;
    this.activeEpisodeId = episodeId;
    await this.engine.stop();
    this.emit({ type: "loading", episodeId });
    try {
      await this.engine.start(path, startPositionSec, (event) => {
        if (generation !== this.generation || this.activeEpisodeId !== episodeId) return;
        this.onEngineEvent(episodeId, event);
      });
    } catch {
      if (generation === this.generation) this.emit({ type: "error", episodeId, message: "本地媒体加载失败。" });
    }
  }

  async handle(command: PlaybackCommand): Promise<void> {
    if (command.type === "open") {
      this.emit({ type: "error", episodeId: command.episodeId, message: "当前播放来源尚未连接到媒体流。" });
      return;
    }
    if (command.type === "fullscreen") {
      this.setWindowFullscreen(command.enabled);
      return;
    }
    if (command.type === "close") {
      const episodeId = this.activeEpisodeId;
      this.generation += 1;
      this.activeEpisodeId = undefined;
      await this.engine.stop();
      await this.engine.destroy?.();
      this.emit({ type: "closed", ...(episodeId ? { episodeId } : {}) });
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
        await this.engine.seek(command.positionSec);
        break;
      case "set-audio-track":
        await this.engine.setAudioTrack(command.trackId);
        break;
      case "set-subtitle-track":
        await this.engine.setSubtitleTrack(command.trackId);
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
    await this.handle({ type: "close" });
  }

  private onEngineEvent(episodeId: string, event: PlayerEngineEvent): void {
    switch (event.type) {
      case "ready":
        this.emit({ type: "ready", episodeId, ...(event.durationSec === undefined ? {} : { durationSec: event.durationSec }) });
        break;
      case "state":
        this.emit({ type: "state", state: event.state });
        break;
      case "position":
        this.emit({
          type: "position",
          episodeId,
          positionSec: event.positionSec,
          ...(event.durationSec === undefined ? {} : { durationSec: event.durationSec }),
        });
        break;
      case "tracks":
        this.emit({ type: "tracks", audio: event.audio, subtitles: event.subtitles });
        break;
      case "error":
        this.emit({ type: "error", episodeId, message: "本地媒体加载失败。" });
        break;
      case "closed":
        this.activeEpisodeId = undefined;
        this.emit({ type: "closed", episodeId });
        break;
    }
  }
}
