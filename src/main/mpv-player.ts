import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrowserWindow } from "electron";
import koffi from "koffi";

import { NativeVideoWindow } from "./native-window";
import type { PlayerEngine, PlayerEngineEvent } from "./player";

const MPV_EVENT_SHUTDOWN = 1;
const MPV_EVENT_START_FILE = 6;
const MPV_EVENT_END_FILE = 7;
const MPV_EVENT_FILE_LOADED = 8;
const MPV_EVENT_VIDEO_RECONFIG = 17;
const MPV_EVENT_PROPERTY_CHANGE = 22;
const MPV_END_FILE_REASON_EOF = 0;

const MPV_EVENT = koffi.struct("MpvEvent", {
  event_id: "int",
  error: "int",
  reply_userdata: "uint64_t",
  data: "void *",
});

const MPV_END_FILE = koffi.struct("MpvEndFile", {
  reason: "int",
  error: "int",
  playlist_entry_id: "int64_t",
  playlist_insert_id: "int64_t",
  playlist_insert_num_entries: "int",
});

type NativeFunction = (...args: any[]) => any;

interface MpvApi {
  create: NativeFunction;
  setOptionString: NativeFunction;
  initialize: NativeFunction;
  command: NativeFunction;
  setPropertyString: NativeFunction;
  getPropertyString: NativeFunction;
  free: NativeFunction;
  waitEvent: NativeFunction;
  terminateDestroy: NativeFunction;
  errorString: NativeFunction;
}

function resolveMpvPath(): string | undefined {
  const candidates = [
    process.env.Z_VIDEO_MPV_DLL,
    join(process.cwd(), "vendor", "mpv", "libmpv-2.dll"),
    join(resolve(process.cwd(), "..", ".."), "vendor", "mpv", "libmpv-2.dll"),
    join(resolve(__dirname, "..", ".."), "vendor", "mpv", "libmpv-2.dll"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((value) => existsSync(value));
}

function loadMpvApi(): MpvApi {
  const path = resolveMpvPath();
  if (!path) throw new Error("libmpv is unavailable");
  const library = koffi.load(path);
  return {
    create: library.func("void * mpv_create()"),
    setOptionString: library.func("int mpv_set_option_string(void *, str, str)"),
    initialize: library.func("int mpv_initialize(void *)"),
    command: library.func("int mpv_command(void *, char * const *)"),
    setPropertyString: library.func("int mpv_set_property_string(void *, str, str)"),
    getPropertyString: library.func("void * mpv_get_property_string(void *, str)"),
    free: library.func("void mpv_free(void *)"),
    waitEvent: library.func("void * mpv_wait_event(void *, double)"),
    terminateDestroy: library.func("void mpv_terminate_destroy(void *)"),
    errorString: library.func("str mpv_error_string(int)"),
  };
}

function asFiniteNumber(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class MpvNativePlayer implements PlayerEngine {
  private readonly parent: BrowserWindow;
  private host: NativeVideoWindow | undefined;
  private api: MpvApi | undefined;
  private handle: bigint | undefined;
  private eventTimer: NodeJS.Timeout | undefined;
  private stateTimer: NodeJS.Timeout | undefined;
  private onEvent: ((event: PlayerEngineEvent) => void) | undefined;
  private pendingStartPosition: number | undefined;
  private lastState: string | undefined;
  private lastTrackSignature: string | undefined;

  constructor(parent: BrowserWindow) {
    this.parent = parent;
  }

  async start(path: string, startPositionSec: number | undefined, onEvent: (event: PlayerEngineEvent) => void): Promise<void> {
    if (process.platform !== "win32") throw new Error("native libmpv playback is currently Windows-only");
    if (!isRemoteMediaSource(path) && !existsSync(path)) throw new Error("selected media is unavailable");
    await this.stop();
    this.onEvent = onEvent;
    this.pendingStartPosition = Number.isFinite(startPositionSec) && (startPositionSec ?? 0) > 0 ? startPositionSec : undefined;
    try {
      this.host ??= NativeVideoWindow.create(this.parent);
      this.api ??= loadMpvApi();
      const api = this.api;
      const handle = api.create() as bigint;
      if (!handle) throw new Error("mpv_create failed");
      this.handle = handle;
      this.setOption("config", "no");
      this.setOption("terminal", "no");
      this.setOption("idle", "yes");
      this.setOption("osc", "no");
      this.setOption("input-default-bindings", "no");
      this.setOption("input-vo-keyboard", "no");
      this.setOption("vo", "gpu");
      this.setOption("gpu-api", "d3d11");
      this.setOption("hwdec", "auto-safe");
      this.setOption("wid", this.host.handle.toString());
      this.assertSuccess(api.initialize(handle));
      this.assertSuccess(api.command(handle, ["loadfile", path, "replace", null]));
      this.eventTimer = setInterval(() => this.pumpEvents(), 25);
      this.stateTimer = setInterval(() => this.syncState(), 250);
      this.host.resize();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  stop(): void {
    this.clearTimers();
    const api = this.api;
    const handle = this.handle;
    this.handle = undefined;
    this.onEvent = undefined;
    this.pendingStartPosition = undefined;
    this.lastState = undefined;
    this.lastTrackSignature = undefined;
    if (api && handle) api.terminateDestroy(handle);
  }

  destroy(): void {
    this.stop();
    this.host?.destroy();
    this.host = undefined;
  }

  play(): void {
    this.setProperty("pause", "no");
  }

  pause(): void {
    this.setProperty("pause", "yes");
  }

  seek(positionSec: number): void {
    if (!Number.isFinite(positionSec)) return;
    this.setProperty("time-pos", String(Math.max(0, positionSec)));
  }

  setAudioTrack(trackId: string): void {
    this.setProperty("aid", trackId);
  }

  setSubtitleTrack(trackId: string | null): void {
    this.setProperty("sid", trackId ?? "no");
  }

  addSubtitleFile(path: string): void {
    if (!existsSync(path)) throw new Error("subtitle file is unavailable");
    const extension = path.toLowerCase().slice(path.lastIndexOf("."));
    if (![".srt", ".ass", ".ssa", ".vtt", ".sub"].includes(extension)) throw new Error("unsupported subtitle file");
    const api = this.api;
    const handle = this.handle;
    if (!api || !handle) throw new Error("mpv is not initialized");
    this.assertSuccess(api.command(handle, ["sub-add", path, "select", null]));
  }

  private setOption(name: string, value: string): void {
    const api = this.api;
    const handle = this.handle;
    if (!api || !handle) throw new Error("mpv is not initialized");
    this.assertSuccess(api.setOptionString(handle, name, value));
  }

  private setProperty(name: string, value: string): void {
    const api = this.api;
    const handle = this.handle;
    if (!api || !handle) return;
    const result = api.setPropertyString(handle, name, value);
    if (result < 0) this.emit({ type: "error", message: "播放控制失败。" });
  }

  private pumpEvents(): void {
    const api = this.api;
    const handle = this.handle;
    if (!api || !handle) return;
    for (let count = 0; count < 32; count += 1) {
      const pointer = api.waitEvent(handle, 0) as bigint;
      if (!pointer) return;
      const event = koffi.decode(pointer, MPV_EVENT) as { event_id: number; error: number; data: bigint };
      switch (event.event_id) {
        case MPV_EVENT_FILE_LOADED:
          if (this.pendingStartPosition !== undefined) {
            this.setProperty("time-pos", String(this.pendingStartPosition));
            this.pendingStartPosition = undefined;
          }
          this.emit({ type: "ready", durationSec: this.readNumber("duration") });
          this.emitTracks();
          this.syncState(true);
          break;
        case MPV_EVENT_END_FILE:
          this.handleEndFile(event.data);
          break;
        case MPV_EVENT_SHUTDOWN:
          this.clearTimers();
          this.handle = undefined;
          this.emit({ type: "closed" });
          return;
        case MPV_EVENT_PROPERTY_CHANGE:
        case MPV_EVENT_VIDEO_RECONFIG:
        case MPV_EVENT_START_FILE:
          break;
        default:
          break;
      }
    }
  }

  private handleEndFile(pointer: bigint): void {
    if (!pointer) return;
    const end = koffi.decode(pointer, MPV_END_FILE) as { reason: number; error: number };
    if (end.error < 0) {
      this.emit({ type: "error", message: "本地媒体加载失败。" });
      return;
    }
    if (end.reason === MPV_END_FILE_REASON_EOF) {
      this.lastState = "ended";
      this.emit({ type: "state", state: "ended" });
    }
  }

  private syncState(force = false): void {
    if (!this.handle) return;
    const paused = this.readProperty("pause") === "yes";
    const idle = this.readProperty("idle-active") === "yes";
    const position = this.readNumber("time-pos");
    const duration = this.readNumber("duration");
    const state = idle ? "ended" : paused ? "paused" : "playing";
    if (force || this.lastState !== state) {
      this.lastState = state;
      this.emit({ type: "state", state });
    }
    if (position !== undefined) this.emit({ type: "position", positionSec: position, durationSec: duration });
    this.emitTracks();
  }

  private emitTracks(): void {
    const audio: Array<{ id: string; label: string; selected?: boolean }> = [];
    const subtitles: Array<{ id: string; label: string; selected?: boolean }> = [];
    const count = Math.floor(this.readNumber("track-list/count") ?? 0);
    for (let index = 0; index < count && index < 128; index += 1) {
      const type = this.readProperty(`track-list/${index}/type`);
      const id = this.readProperty(`track-list/${index}/id`);
      if (!type || !id) continue;
      const title = this.readProperty(`track-list/${index}/title`) ?? this.readProperty(`track-list/${index}/lang`) ?? `${type} ${id}`;
      const selected = this.readProperty(`track-list/${index}/selected`) === "yes";
      if (type === "audio") audio.push({ id, label: title, ...(selected ? { selected: true } : {}) });
      if (type === "sub") subtitles.push({ id, label: title, ...(selected ? { selected: true } : {}) });
    }
    const signature = JSON.stringify({ audio, subtitles });
    if (signature === this.lastTrackSignature) return;
    this.lastTrackSignature = signature;
    this.emit({ type: "tracks", audio, subtitles });
  }

  private readNumber(name: string): number | undefined {
    return asFiniteNumber(this.readProperty(name));
  }

  private readProperty(name: string): string | undefined {
    const api = this.api;
    const handle = this.handle;
    if (!api || !handle) return undefined;
    try {
      const pointer = api.getPropertyString(handle, name) as bigint;
      if (!pointer) return undefined;
      try {
        const value = koffi.decode.string(pointer);
        return typeof value === "string" && value.length > 0 ? value : undefined;
      } finally {
        api.free(pointer);
      }
    } catch {
      return undefined;
    }
  }

  private assertSuccess(result: number): void {
    if (result >= 0) return;
    const message = this.api?.errorString(result);
    throw new Error(typeof message === "string" ? message : "libmpv operation failed");
  }

  private emit(event: PlayerEngineEvent): void {
    this.onEvent?.(event);
  }

  private clearTimers(): void {
    if (this.eventTimer) clearInterval(this.eventTimer);
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.eventTimer = undefined;
    this.stateTimer = undefined;
  }
}

function isRemoteMediaSource(source: string): boolean {
  try {
    const protocol = new URL(source).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
