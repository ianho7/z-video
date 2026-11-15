import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { app, ipcMain } from "electron";
import type { BrowserWindow } from "electron";

import { registerLocalPlaybackIpcHandlers } from "../src/main/local-playback-ipc";
import { MainLocalPlaybackHost } from "../src/main/player-host";
import { createMainWindow } from "../src/main/window";
import {
  LOCAL_LIBRARY_SCHEMA_VERSION,
  type LocalCollectionSummary,
  type LocalLibraryState,
  type LocalMarker,
  type LocalMediaDetail,
  type LocalMediaItem,
} from "../src/shared/local-library-contracts";
import type { LocalPlaybackMediaId, LocalPlaybackStore } from "../src/shared/local-playback-contracts";

/**
 * Window fixtures for the two real-playback smokes. The renderer opens the
 * player through its production flow (`local-library:*` -> detail -> open), so
 * the fixture feeds a two-item local library and a real native playback host;
 * only the SQLite/scanning owner is replaced by in-memory handlers.
 */

export const SAMPLE_MEDIA_ID = "media_123e4567-e89b-42d3-a456-426614174010" as const;
export const MISSING_MEDIA_ID = "media_123e4567-e89b-42d3-a456-426614174011" as const;

export const SAMPLE_TITLE = "窗口测试影片";
export const MISSING_TITLE = "缺失媒体";

export const samplePath = join(process.cwd(), "assets", "test_video.mp4");
export const subtitlePath = join(process.cwd(), "tests", "fixtures", "test_subtitle.srt");

type DialogResult = { canceled: boolean; filePaths: string[] };

export interface PlayerWindowFixture {
  window: BrowserWindow;
  host: MainLocalPlaybackHost;
  read<T = unknown>(expression: string): Promise<T>;
  waitFor(label: string, expression: string, timeoutMs?: number): Promise<void>;
  openFromLibrary(mediaId: string): Promise<void>;
  cleanup(): Promise<void>;
}

export async function startPlayerWindowFixture(dialogQueue: DialogResult[] = []): Promise<PlayerWindowFixture> {
  assert.equal(process.platform, "win32", "native player smoke is Windows-only");
  assert.equal(existsSync(samplePath), true, "local sample is required");
  assert.equal(existsSync(subtitlePath), true, "external subtitle fixture is required");

  app.setPath("userData", await mkdtemp(join(tmpdir(), "z-video-player-user-data-")));
  app.setPath("sessionData", await mkdtemp(join(tmpdir(), "z-video-player-session-data-")));
  await app.whenReady();

  const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
  const sampleItem: LocalMediaItem = {
    mediaId: SAMPLE_MEDIA_ID,
    sourceId,
    collectionId: "collection_sample",
    title: SAMPLE_TITLE,
    kind: "movie",
    sizeBytes: 2_265_535,
    modifiedAtMs: 1_793_440_000_000,
    available: true,
    year: 2026,
    premieredDate: null,
  };
  const missingItem: LocalMediaItem = {
    ...sampleItem,
    mediaId: MISSING_MEDIA_ID,
    collectionId: "collection_missing",
    title: MISSING_TITLE,
  };
  const items = [sampleItem, missingItem];
  const state: LocalLibraryState = {
    status: "ready",
    schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION,
    sqliteAvailable: true,
    sources: [{ sourceId, label: "影片", locationHint: "D 盘", available: true, degraded: false, itemCount: items.length, collectionCount: items.length }],
  };
  const collection = (item: LocalMediaItem): LocalCollectionSummary => ({
    collectionId: item.collectionId,
    title: item.title,
    kind: "movie",
    premieredDate: null,
    episodeCount: 1,
    watchedEpisodeCount: 0,
    availableEpisodeCount: 1,
    available: true,
    representativeMediaId: item.mediaId,
    coverMediaId: item.mediaId,
    addedAtMs: item.modifiedAtMs,
    updatedAtMs: item.modifiedAtMs,
  });
  const collections = items.map(collection);
  const detail = (item: LocalMediaItem): LocalMediaDetail => ({ item, episodes: [item] });
  const emptyPage = (query: Record<string, unknown>, pageSize = 50) => ({ query, page: 1, pageSize, totalCount: 0, items: [] });

  ipcMain.handle("local-library:state", async () => state);
  ipcMain.handle("local-library:list", async (_event, query: Record<string, unknown>) => ({ state, page: emptyPage(query ?? { page: 1, pageSize: 50 }) }));
  ipcMain.handle("local-library:list-collections", async (_event, query: { filter?: string } | undefined) => {
    // Home asks twice: recent works and shows. The window fixtures only need works.
    const visible = query?.filter === "show" ? [] : collections;
    return { state, page: { query: query ?? { page: 1, pageSize: 50 }, page: 1, pageSize: 50, totalCount: visible.length, items: visible } };
  });
  ipcMain.handle("local-library:get", async (_event, mediaId: string) => {
    const item = items.find((candidate) => candidate.mediaId === mediaId);
    return item ? { state, detail: detail(item) } : { state };
  });
  ipcMain.handle("local-library:continue-watching", async () => ({ state, items: [] }));
  // Ticket 22a: the renderer lists/adds markers through the same preload bridge
  // as production; only the SQLite owner is replaced by this in-memory store.
  const markersByMedia = new Map<string, LocalMarker[]>();
  ipcMain.handle("local-library:markers-list", async (_event, mediaId: string) => [...(markersByMedia.get(mediaId) ?? [])]);
  ipcMain.handle("local-library:markers-add", async (_event, input: { mediaId?: unknown; positionSec?: unknown; durationSec?: unknown }) => {
    const mediaId = typeof input?.mediaId === "string" ? input.mediaId : "";
    if (mediaId !== SAMPLE_MEDIA_ID) throw new Error("标记对应的本地媒体不存在");
    const positionSec = input.positionSec;
    if (typeof positionSec !== "number" || !Number.isInteger(positionSec) || positionSec < 0) throw new Error("标记位置必须是有效的整秒数");
    const durationSec = typeof input.durationSec === "number" ? input.durationSec : undefined;
    if (durationSec !== undefined && positionSec > durationSec) throw new Error("标记位置超出媒体时长，未记录");
    const markers = markersByMedia.get(mediaId) ?? [];
    const existing = markers.find((marker) => marker.positionSec === positionSec);
    if (existing) return existing;
    const marker: LocalMarker = { mediaId: SAMPLE_MEDIA_ID, positionSec, createdAtMs: Date.now() };
    markers.push(marker);
    markers.sort((left, right) => left.positionSec - right.positionSec);
    markersByMedia.set(mediaId, markers);
    return marker;
  });
  // Ticket 22b: deletion is keyed by the same opaque id + whole second; a marker
  // that is already gone returns false instead of throwing.
  ipcMain.handle("local-library:markers-remove", async (_event, input: { mediaId?: unknown; positionSec?: unknown }) => {
    const mediaId = typeof input?.mediaId === "string" ? input.mediaId : "";
    if (mediaId !== SAMPLE_MEDIA_ID) return false;
    const positionSec = input.positionSec;
    if (typeof positionSec !== "number" || !Number.isInteger(positionSec) || positionSec < 0) throw new Error("标记位置必须是有效的整秒数");
    const markers = markersByMedia.get(mediaId) ?? [];
    const index = markers.findIndex((marker) => marker.positionSec === positionSec);
    if (index < 0) return false;
    markers.splice(index, 1);
    return true;
  });
  ipcMain.handle("local-library:artwork", async () => ({ state }));
  ipcMain.handle("app-preferences:get", async () => ({ volume: 100, muted: false, speed: 1, sort: "recent" }));

  const store: LocalPlaybackStore = {
    resolveMediaPath: async (mediaId: LocalPlaybackMediaId) => mediaId === SAMPLE_MEDIA_ID ? samplePath : undefined,
    getPlayback: async () => undefined,
    savePlayback: async (value) => value,
  };
  const window = createMainWindow();
  const fileDialog = {
    showOpenDialog: async (): Promise<DialogResult> => dialogQueue.shift() ?? { canceled: true, filePaths: [] },
  };
  const host = new MainLocalPlaybackHost(window, store, fileDialog);
  const unregister = registerLocalPlaybackIpcHandlers(host);
  if (window.webContents.isLoading()) await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));

  const read = <T = unknown>(expression: string): Promise<T> => window.webContents.executeJavaScript(expression, true) as Promise<T>;
  const waitFor = async (label: string, expression: string, timeoutMs = 15_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!(await read<boolean>(expression))) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  /** Production open path: work card -> detail -> play. */
  const openFromLibrary = async (mediaId: string): Promise<void> => {
    const title = mediaId === SAMPLE_MEDIA_ID ? SAMPLE_TITLE : MISSING_TITLE;
    await waitFor("home work cards", `document.querySelectorAll('#recent-row [data-media-id]').length >= 2`);
    await read(`document.querySelector('#recent-row [data-media-id="${mediaId}"]')?.click()`);
    await waitFor(`detail ${title}`, `document.querySelector('#media-detail')?.hidden === false && document.querySelector('#media-detail-title')?.textContent === ${JSON.stringify(title)}`);
    await read(`document.querySelector('#media-detail-open')?.click()`);
    await waitFor("player view", `document.querySelector('[data-view="player"]')?.hidden === false`);
  };

  const cleanup = async (): Promise<void> => {
    unregister();
    for (const channel of [
      "local-library:state",
      "local-library:list",
      "local-library:list-collections",
      "local-library:get",
      "local-library:markers-list",
      "local-library:markers-add",
      "local-library:markers-remove",
      "local-library:continue-watching",
      "local-library:artwork",
      "app-preferences:get",
    ]) ipcMain.removeHandler(channel);
    await host.close();
    if (!window.isDestroyed()) window.destroy();
  };

  return { window, host, read, waitFor, openFromLibrary, cleanup };
}
