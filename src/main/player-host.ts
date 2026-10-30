import { dialog } from "electron";
import type { BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { PlaybackCommand, PlaybackEvent } from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { MpvNativePlayer } from "./mpv-player";
import { PlaybackCoordinator } from "./player";

export interface PlaybackHost {
  chooseLocalFile(): Promise<{ opened: boolean }>;
  chooseSubtitleFile(): Promise<{ loaded: boolean }>;
  handle(command: PlaybackCommand): Promise<void>;
  close(): Promise<void>;
}

export class MainPlaybackHost implements PlaybackHost {
  private readonly coordinator: PlaybackCoordinator;

  constructor(private readonly window: BrowserWindow) {
    const engine = new MpvNativePlayer(window);
    this.coordinator = new PlaybackCoordinator(
      engine,
      (event) => this.send(event),
      (enabled) => {
        if (!window.isDestroyed()) window.setFullScreen(enabled);
      },
    );
  }

  async chooseLocalFile(): Promise<{ opened: boolean }> {
    if (this.window.isDestroyed()) return { opened: false };
    const result = await dialog.showOpenDialog(this.window, {
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
    const result = await dialog.showOpenDialog(this.window, {
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
}

function findSamplePath(): string | undefined {
  const candidates = [
    join(process.cwd(), "assets", "test_video.mp4"),
    join(process.resourcesPath, "assets", "test_video.mp4"),
  ];
  return candidates.find((value) => existsSync(value));
}
