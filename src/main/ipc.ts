import { ipcMain } from "electron";

import type { LibraryQuery, NavigationContext, LoginInput } from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { LibraryController, type LibraryDetailRequest, type LibraryImageRequest } from "./library-controller";
import { NasApiClient } from "./nas-client";
import { SessionController } from "./session-controller";

export { IPC_CHANNELS } from "../shared/ipc-channels";

export function registerIpcHandlers(controller: SessionController, library = new LibraryController(controller, new NasApiClient())): void {
  ipcMain.handle(IPC_CHANNELS.restore, () => controller.restore());
  ipcMain.handle(IPC_CHANNELS.login, (_event, value: unknown) => controller.login(parseLoginInput(value)));
  ipcMain.handle(IPC_CHANNELS.sendMfa, (_event, value: unknown) => controller.sendMfaCode(parseOptionalString(value)));
  ipcMain.handle(IPC_CHANNELS.verifyMfa, (_event, value: unknown) => controller.verifyMfa(parseRequiredString(value, "验证码")));
  ipcMain.handle(IPC_CHANNELS.logout, () => controller.logout());
  ipcMain.handle(IPC_CHANNELS.listClassifications, () => controller.listClassifications());
  ipcMain.handle(IPC_CHANNELS.listCollections, (_event, value: unknown) => library.listCollections(parseLibraryQuery(value)));
  ipcMain.handle(IPC_CHANNELS.getCollectionDetail, (_event, value: unknown) => library.getDetail(parseLibraryDetail(value)));
  ipcMain.handle(IPC_CHANNELS.listContinueWatching, () => library.listContinueWatching());
  ipcMain.handle(IPC_CHANNELS.loadImage, (_event, value: unknown) => library.loadImage(parseLibraryImage(value)));
  ipcMain.handle(IPC_CHANNELS.getNavigation, () => library.getNavigation());
  ipcMain.handle(IPC_CHANNELS.setNavigation, (_event, value: unknown) => library.setNavigation(parseNavigation(value)));
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
