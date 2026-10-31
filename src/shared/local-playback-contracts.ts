import { isOpaqueMediaId, type LocalPlaybackState } from "./local-library-contracts.js";

export type LocalPlaybackMediaId = LocalPlaybackState["mediaId"];

export type LocalPlaybackControlCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; positionSec: number }
  | { type: "set-audio-track"; trackId: string }
  | { type: "set-subtitle-track"; trackId: string | null }
  | { type: "fullscreen"; enabled: boolean }
  | { type: "close" };

export interface LocalPlaybackTrack {
  id: string;
  label: string;
  selected?: boolean;
}

export type LocalPlaybackEvent =
  | { type: "loading"; mediaId: LocalPlaybackMediaId }
  | { type: "ready"; mediaId: LocalPlaybackMediaId; durationSec?: number }
  | { type: "state"; mediaId: LocalPlaybackMediaId; state: "playing" | "paused" | "buffering" | "ended" }
  | { type: "position"; mediaId: LocalPlaybackMediaId; positionSec: number; durationSec?: number }
  | { type: "tracks"; mediaId: LocalPlaybackMediaId; audio: LocalPlaybackTrack[]; subtitles: LocalPlaybackTrack[] }
  | { type: "error"; mediaId?: LocalPlaybackMediaId; message: string }
  | { type: "closed"; mediaId?: LocalPlaybackMediaId };

export interface LocalPlaybackOpenResult {
  opened: boolean;
}

export interface LocalPlaybackApi {
  open(mediaId: string): Promise<LocalPlaybackOpenResult>;
  command(command: LocalPlaybackControlCommand): Promise<void>;
  onEvent(listener: (event: LocalPlaybackEvent) => void): () => void;
}

export interface LocalPlaybackStore {
  resolveMediaPath(mediaId: LocalPlaybackMediaId): Promise<string | undefined>;
  getPlayback(mediaId: LocalPlaybackMediaId): Promise<LocalPlaybackState | undefined>;
  savePlayback(state: LocalPlaybackState): Promise<LocalPlaybackState>;
}

export function isLocalPlaybackControlCommand(value: unknown): value is LocalPlaybackControlCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "play":
    case "pause":
    case "close":
      return true;
    case "seek":
      return typeof record.positionSec === "number" && Number.isFinite(record.positionSec) && record.positionSec >= 0;
    case "set-audio-track":
      return typeof record.trackId === "string" && record.trackId.trim().length > 0;
    case "set-subtitle-track":
      return record.trackId === null || (typeof record.trackId === "string" && record.trackId.trim().length > 0);
    case "fullscreen":
      return typeof record.enabled === "boolean";
    default:
      return false;
  }
}

export function assertLocalPlaybackMediaId(value: unknown): asserts value is LocalPlaybackMediaId {
  if (!isOpaqueMediaId(value)) throw new Error("mediaId 格式无效");
}
