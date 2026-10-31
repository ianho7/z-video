import { dialog } from "electron";
import type { BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { PlaybackCommand, PlaybackEvent } from "../shared/contracts";
import {
  assertLocalPlaybackMediaId,
  type LocalPlaybackControlCommand,
  type LocalPlaybackEvent,
  type LocalPlaybackOpenResult,
  type LocalPlaybackStore,
} from "../shared/local-playback-contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { MpvNativePlayer } from "./mpv-player";
import { LocalPlaybackCoordinator, PlaybackCoordinator, type PlaybackIdentity, type PlaybackProgressSnapshot, type PlaybackTarget } from "./player";
import { NasError, type AuthenticatedSession, type NasCollectionDetail, type NasEpisode, type NasPlaybackProgress, type NasPlaybackStream } from "./nas-client";
import type { SessionController } from "./session-controller";
import { rendererEpisodeId } from "./episode-identity";

export interface PlaybackHost {
  chooseLocalFile(): Promise<{ opened: boolean }>;
  chooseSubtitleFile(): Promise<{ loaded: boolean }>;
  handle(command: PlaybackCommand): Promise<void>;
  close(): Promise<void>;
}

export interface LocalPlaybackHost {
  open(mediaId: string): Promise<LocalPlaybackOpenResult>;
  handle(command: LocalPlaybackControlCommand): Promise<void>;
  close(): Promise<void>;
}

export interface PlaybackNasGateway {
  getCollectionDetail(session: AuthenticatedSession, collectionId: string, classificationId: string): Promise<NasCollectionDetail>;
  getPlaybackStream(session: AuthenticatedSession, episode: NasEpisode): Promise<NasPlaybackStream>;
  updatePlaybackProgress(session: AuthenticatedSession, progress: NasPlaybackProgress): Promise<void>;
}

export interface PlaybackContext {
  sessions: SessionController;
  nas: PlaybackNasGateway;
  onProgressSaved?: (identity: PlaybackIdentity) => void | Promise<void>;
}

type PlaybackFileDialog = Pick<typeof dialog, "showOpenDialog">;

export class MainPlaybackHost implements PlaybackHost {
  private readonly coordinator: PlaybackCoordinator;

  constructor(
    private readonly window: BrowserWindow,
    private readonly fileDialog: PlaybackFileDialog = dialog,
    private readonly context?: PlaybackContext,
  ) {
    const engine = new MpvNativePlayer(window);
    this.coordinator = new PlaybackCoordinator(
      engine,
      (event) => this.send(event),
      (enabled) => {
        if (!window.isDestroyed()) window.setFullScreen(enabled);
      },
      context
        ? {
            resolve: (command) => this.resolveNasTarget(command),
            reportProgress: (identity, target, snapshot) => this.reportProgress(identity, target, snapshot),
            rememberPlayback: (identity) => context.sessions.setLastPlayback(identity),
            onUnauthorized: (error, sessionKey) => this.invalidateSession(error, sessionKey),
          }
        : undefined,
    );
  }

  async chooseLocalFile(): Promise<{ opened: boolean }> {
    if (this.window.isDestroyed()) return { opened: false };
    const result = await this.fileDialog.showOpenDialog(this.window, {
      title: "打开本地视频",
      defaultPath: findSamplePath(),
      properties: ["openFile"],
      filters: [{ name: "视频文件", extensions: ["mp4", "mkv", "webm", "mov", "avi", "m4v"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { opened: false };
    await this.coordinator.openLocal(result.filePaths[0], "local-file");
    return { opened: true };
  }

  async chooseSubtitleFile(): Promise<{ loaded: boolean }> {
    if (this.window.isDestroyed()) return { loaded: false };
    const result = await this.fileDialog.showOpenDialog(this.window, {
      title: "加载外部字幕",
      properties: ["openFile"],
      filters: [{ name: "字幕文件", extensions: ["srt", "ass", "ssa", "vtt", "sub"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { loaded: false };
    return { loaded: await this.coordinator.addExternalSubtitle(result.filePaths[0]) };
  }

  handle(command: PlaybackCommand): Promise<void> {
    return this.coordinator.handle(command);
  }

  close(): Promise<void> {
    return this.coordinator.close();
  }

  private send(event: PlaybackEvent): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.playerEvent, event);
    }
  }

  private async resolveNasTarget(command: Extract<PlaybackCommand, { type: "open" }>): Promise<PlaybackTarget> {
    const context = this.context;
    const session = context?.sessions.getAuthenticatedSession();
    if (!context || !session) throw new NasError("unauthorized", "当前会话未认证", undefined, 401);
    const sessionKey = context.sessions.getSessionKey();
    try {
      const detail = await context.nas.getCollectionDetail(session, command.collectionId, command.classificationId);
      if (context.sessions.getSessionKey() !== sessionKey) throw new NasError("stale", "播放会话已切换");
      const episode = detail.seasons.flatMap((season) => season.episodes).find((candidate) => episodeMatches(candidate, command.episodeId, command.collectionId));
      if (!episode) throw new NasError("malformed", "详情中未找到所选 Episode");
      if (!episode.videoId?.trim()) throw new NasError("malformed", "所选 Episode 缺少 video_id");
      const stream = await context.nas.getPlaybackStream(session, episode);
      if (context.sessions.getSessionKey() !== sessionKey) throw new NasError("stale", "播放会话已切换");
      const history = matchingHistory(detail, episode);
      return {
        source: stream.uri,
        videoId: episode.videoId,
        ...(sessionKey ? { sessionKey } : {}),
        ...(history?.playDurationSec !== undefined && history.playDurationSec > 0 ? { resumePositionSec: history.playDurationSec } : {}),
        ...(episode.durationSec !== undefined ? { durationSec: episode.durationSec } : {}),
        ...(history?.audioIndex !== undefined ? { audioIndex: history.audioIndex } : {}),
        ...(history?.subtitleIndex !== undefined ? { subtitleIndex: history.subtitleIndex } : {}),
        ...(history?.playChapter !== undefined ? { chapter: history.playChapter } : {}),
        ...(history?.subtitleHash ? { subtitleHash: history.subtitleHash } : {}),
        ...(history?.subtitleSetting ? { subtitleSetting: history.subtitleSetting } : {}),
      };
    } catch (error) {
      if (context.sessions.getSessionKey() !== sessionKey) throw new NasError("stale", "播放会话已切换");
      throw error;
    }
  }

  private async reportProgress(identity: PlaybackIdentity, target: PlaybackTarget, snapshot: PlaybackProgressSnapshot): Promise<void> {
    const context = this.context;
    const session = context?.sessions.getAuthenticatedSession();
    if (!context || !session) throw new NasError("unauthorized", "当前会话未认证", undefined, 401);
    if (target.sessionKey && context.sessions.getSessionKey() !== target.sessionKey) throw new NasError("stale", "播放会话已切换");
    try {
      await context.nas.updatePlaybackProgress(session, {
        collectionId: identity.collectionId,
        classificationId: identity.classificationId,
        videoId: target.videoId,
        sec: snapshot.positionSec,
        chapter: target.chapter ?? 0,
        audioIndex: snapshot.audioIndex,
        subtitleIndex: snapshot.subtitleIndex,
        ...(target.subtitleHash ? { subtitleHash: target.subtitleHash } : {}),
        ...(snapshot.durationSec !== undefined ? { videoDuration: snapshot.durationSec } : {}),
        ...(target.subtitleSetting ? { subtitleSetting: target.subtitleSetting } : {}),
      });
    } catch (error) {
      if (target.sessionKey && context.sessions.getSessionKey() !== target.sessionKey) throw new NasError("stale", "播放会话已切换");
      throw error;
    }
    if (target.sessionKey && context.sessions.getSessionKey() !== target.sessionKey) throw new NasError("stale", "播放会话已切换");
    await context.onProgressSaved?.(identity);
  }

  private async invalidateSession(error: unknown, expectedSessionKey?: string): Promise<void> {
    const context = this.context;
    if (!context) return;
    const state = await context.sessions.invalidate({ kind: "unauthorized", code: errorCode(error), message: "NAS 登录已失效，请重新登录。" }, expectedSessionKey);
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.send(IPC_CHANNELS.sessionState, state);
  }
}

/** Main-owned local player. It deliberately has no Session/NAS dependency. */
export class MainLocalPlaybackHost implements LocalPlaybackHost {
  private readonly coordinator: LocalPlaybackCoordinator;
  private closed = false;

  constructor(
    private readonly window: BrowserWindow,
    store: LocalPlaybackStore,
  ) {
    const engine = new MpvNativePlayer(window);
    this.coordinator = new LocalPlaybackCoordinator(
      engine,
      (event) => this.send(event),
      (enabled) => {
        if (!window.isDestroyed()) window.setFullScreen(enabled);
      },
      store,
    );
  }

  async open(mediaId: string): Promise<LocalPlaybackOpenResult> {
    if (this.closed || this.window.isDestroyed()) return { opened: false };
    assertLocalPlaybackMediaId(mediaId);
    await this.coordinator.open(mediaId);
    return { opened: true };
  }

  handle(command: LocalPlaybackControlCommand): Promise<void> {
    return this.coordinator.handle(command);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.coordinator.close();
  }

  private send(event: LocalPlaybackEvent): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.localPlaybackEvent, event);
    }
  }
}

function episodeMatches(episode: NasEpisode, identifier: string, collectionId?: string): boolean {
  const expected = identifier.trim();
  return Boolean(expected) && [episode.episodeId, episode.videoId, episode.filePath, episode.versionId].some((candidate) => Boolean(candidate?.trim()) && candidate!.trim() === expected)
    || Boolean(collectionId && rendererEpisodeId(episode, collectionId) === expected);
}

function matchingHistory(detail: NasCollectionDetail, episode: NasEpisode): NasCollectionDetail["history"] {
  const history = detail.history;
  if (!history || (history.playDurationSec !== undefined && history.playDurationSec <= 0)) return undefined;
  const episodes = detail.seasons.flatMap((season) => season.episodes);
  if (history.lastVideoId && episodeMatches(episode, history.lastVideoId)) return history;
  if (!history.lastVideoId && episodes.length === 1) return history;
  if (history.lastVideoId && episodes.length === 1 && episodeMatches(episodes[0], episode.episodeId)) return history;
  return undefined;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown };
  return typeof value.code === "string" ? value.code : undefined;
}

function findSamplePath(): string | undefined {
  const candidates = [
    join(process.cwd(), "assets", "test_video.mp4"),
    join(process.resourcesPath, "assets", "test_video.mp4"),
  ];
  return candidates.find((value) => existsSync(value));
}
