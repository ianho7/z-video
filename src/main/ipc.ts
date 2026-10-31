import { ipcMain } from "electron";

import type { LibraryQuery, NavigationContext, LoginInput, PlaybackCommand } from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { LibraryController, type LibraryDetailRequest, type LibraryImageRequest } from "./library-controller";
import { NasApiClient } from "./nas-client";
import type { PlaybackHost } from "./player-host";
import { SessionController } from "./session-controller";
import { DiscoveryController } from "./discovery";

export { IPC_CHANNELS } from "../shared/ipc-channels";

export function registerIpcHandlers(
  controller: SessionController,
  library = new LibraryController(controller, new NasApiClient()),
  player?: PlaybackHost,
  discovery = new DiscoveryController(),
): void {
  ipcMain.handle(IPC_CHANNELS.restore, () => controller.restore());
  ipcMain.handle(IPC_CHANNELS.login, async (_event, value: unknown) => ({ state: await controller.login(parseLoginInput(value)) }));
  ipcMain.handle(IPC_CHANNELS.sendMfa, async (_event, value: unknown) => ({ state: await controller.sendMfaCode(parseOptionalString(value)) }));
  ipcMain.handle(IPC_CHANNELS.verifyMfa, async (_event, value: unknown) => ({ state: await controller.verifyMfa(parseRequiredString(value, "验证码")) }));
  ipcMain.handle(IPC_CHANNELS.logout, async () => ({ state: await controller.logout() }));
  ipcMain.handle(IPC_CHANNELS.listClassifications, () => controller.listClassifications());
  if (player) {
    ipcMain.handle(IPC_CHANNELS.playerChooseLocalFile, () => player.chooseLocalFile());
    ipcMain.handle(IPC_CHANNELS.playerChooseSubtitleFile, () => player.chooseSubtitleFile());
    ipcMain.handle(IPC_CHANNELS.playerCommand, (_event, value: unknown) => player.handle(parsePlaybackCommand(value)));
  }

  ipcMain.handle(IPC_CHANNELS.listCollections, (_event, value: unknown) => library.listCollections(parseLibraryQuery(value)));
  ipcMain.handle(IPC_CHANNELS.getCollectionDetail, (_event, value: unknown) => library.getDetail(parseLibraryDetail(value)));
  ipcMain.handle(IPC_CHANNELS.listContinueWatching, () => library.listContinueWatching());
  ipcMain.handle(IPC_CHANNELS.loadImage, (_event, value: unknown) => library.loadImage(parseLibraryImage(value)));
  ipcMain.handle(IPC_CHANNELS.getNavigation, () => library.getNavigation());
  ipcMain.handle(IPC_CHANNELS.setNavigation, (_event, value: unknown) => library.setNavigation(parseNavigation(value)));
  ipcMain.handle(IPC_CHANNELS.discoveryStart, () => discovery.start());
  ipcMain.handle(IPC_CHANNELS.discoveryCancel, () => discovery.cancel());
}

function parsePlaybackCommand(value: unknown): PlaybackCommand {
  const record = asRecord(value, "播放命令");
  const type = parseRequiredString(record.type, "播放命令类型");
  switch (type) {
    case "open":
      return {
        type,
        collectionId: parseRequiredString(record.collectionId, "Collection").slice(0, 200),
        classificationId: parseRequiredString(record.classificationId, "分类").slice(0, 200),
        episodeId: parseRequiredString(record.episodeId, "Episode").slice(0, 200),
        ...(record.startPositionSec === undefined ? {} : { startPositionSec: parseFiniteNumber(record.startPositionSec, "起始位置") }),
      };
    case "play":
    case "pause":
    case "close":
      return { type };
    case "seek":
      return { type, positionSec: parseFiniteNumber(record.positionSec, "跳转位置") };
    case "set-audio-track":
      return { type, trackId: parseRequiredString(record.trackId, "音轨") };
    case "set-subtitle-track":
      return { type, trackId: record.trackId === null ? null : parseRequiredString(record.trackId, "字幕轨道") };
    case "fullscreen":
      if (typeof record.enabled !== "boolean") throw new Error("全屏参数格式无效");
      return { type, enabled: record.enabled };
    default:
      throw new Error("播放命令类型无效");
  }
}

function parseLoginInput(value: unknown): LoginInput {
  const record = asRecord(value, "登录参数");
  return {
    serverUrl: parseRequiredString(record.serverUrl, "NAS 地址"),
    username: parseRequiredString(record.username, "账号"),
    password: parseRequiredString(record.password, "密码"),
    remember: typeof record.remember === "boolean" ? record.remember : false,
  };
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseRequiredString(value, "参数");
}

function parseRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label}格式无效`);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}

function parseLibraryQuery(value: unknown): LibraryQuery {
  const record = asRecord(value, "片库查询参数");
  const page = parseInteger(record.page, "页码");
  const pageSize = parseInteger(record.pageSize, "分页大小");
  if (page < 1 || pageSize < 1 || pageSize > 100) throw new Error("片库分页参数无效");
  const filter = record.filter === undefined ? "all" : parseEnum(record.filter, ["all", "movie", "tv", "anime", "show", "diy"] as const, "类型筛选");
  const sort = record.sort === undefined ? "recent" : parseEnum(record.sort, ["recent", "title", "score_desc", "release_year_desc"] as const, "排序");
  return {
    classificationId: parseRequiredString(record.classificationId, "分类"),
    page,
    pageSize,
    ...(record.query === undefined ? {} : { query: parseOptionalString(record.query) }),
    filter,
    sort,
  };
}

function parseLibraryDetail(value: unknown): LibraryDetailRequest {
  const record = asRecord(value, "详情请求");
  return {
    collectionId: parseRequiredString(record.collectionId, "影视条目"),
    classificationId: parseRequiredString(record.classificationId, "分类"),
  };
}

function parseLibraryImage(value: unknown): LibraryImageRequest {
  const record = asRecord(value, "图片请求");
  const kind = parseEnum(record.kind, ["cover", "background"], "图片类型");
  return { collectionId: parseRequiredString(record.collectionId, "影视条目"), kind };
}

function parseNavigation(value: unknown): NavigationContext {
  const record = asRecord(value, "导航状态");
  const library = asRecord(record.library, "导航片库状态");
  return {
    view: parseEnum(record.view, ["library", "detail"], "页面") as NavigationContext["view"],
    library: {
      classificationId: parseRequiredString(library.classificationId, "分类"),
      page: parseInteger(library.page, "页码"),
      pageSize: parseInteger(library.pageSize, "分页大小"),
      ...(library.query === undefined ? {} : { query: parseOptionalString(library.query) }),
      filter: library.filter === undefined ? "all" : parseEnum(library.filter, ["all", "movie", "tv", "anime", "show", "diy"] as const, "类型筛选"),
      sort: library.sort === undefined ? "recent" : parseEnum(library.sort, ["recent", "title", "score_desc", "release_year_desc"] as const, "排序"),
      scrollTop: typeof library.scrollTop === "number" && Number.isFinite(library.scrollTop) && library.scrollTop >= 0 ? library.scrollTop : 0,
    },
    ...(record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)
      ? {
          detail: {
            collectionId: parseRequiredString((record.detail as Record<string, unknown>).collectionId, "详情影视条目"),
            ...((record.detail as Record<string, unknown>).episodeId === undefined ? {} : { episodeId: parseRequiredString((record.detail as Record<string, unknown>).episodeId, "Episode") }),
            ...((record.detail as Record<string, unknown>).focusCollectionId === undefined ? {} : { focusCollectionId: parseRequiredString((record.detail as Record<string, unknown>).focusCollectionId, "焦点影视条目") }),
          },
        }
      : {}),
  };
}

function parseInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${label}必须是整数`);
  return value;
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label}格式无效`);
  return value as T;
}
