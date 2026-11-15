import assert from "node:assert/strict";
import { mkdir, rm, stat as statFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { BrowserWindow, app, ipcMain } from "electron";

import {
  DEFAULT_CLEANUP_SETTINGS,
  type CleanupSettings,
  type LocalCleanupCandidate,
  type LocalCleanupQueue,
} from "../src/shared/cleanup-contracts";
import { IPC_CHANNELS } from "../src/shared/ipc-channels";
import {
  LOCAL_LIBRARY_SCHEMA_VERSION,
  type LocalCollectionSummary,
  type LocalContinueWatchingItem,
  type LocalLibraryState,
  type LocalMediaDetail,
  type LocalMediaItem,
  type LocalSourceSummary,
} from "../src/shared/local-library-contracts";
import type {
  LocalPlaybackControlCommand,
  LocalPlaybackMediaId,
  LocalPlaybackOpenOptions,
  LocalPlaybackStore,
} from "../src/shared/local-playback-contracts";
import { registerLocalPlaybackIpcHandlers } from "../src/main/local-playback-ipc";
import type { LocalPlaybackHost } from "../src/main/player-host";
import { LocalPlaybackCoordinator, type PlayerEngine, type PlayerEngineEvent } from "../src/main/player";
import { createMainWindow } from "../src/main/window";

/**
 * Ticket 20b: automated acceptance for the six UX-audit interactions that Ticket
 * 20 fixed but could not re-run without a human click (F-01, F-04, F-05, P-07,
 * B-06, CL-08).
 *
 * One Electron process runs one scenario, selected by
 * `Z_VIDEO_ACCEPTANCE_SCENARIO`; `scripts/run-acceptance-window-smoke.mjs`
 * starts every scenario with its own throw-away profile and user-data dir.
 *
 * Production code is never modified and never gains a test switch:
 * - F-01/F-04 import the real `src/main/main.ts` bootstrap against a user-data
 *   directory whose `local-library/library.sqlite` path is a directory.
 * - F-05/P-07/B-06/CL-08 build a main process at the public IPC seam: the real
 *   production renderer + real `createMainWindow()`, with in-memory library
 *   handlers. CL-08 drives the real `LocalPlaybackCoordinator` with a fake
 *   engine, so replay goes through the production owner, not a stub.
 */

const SCENARIO = process.env.Z_VIDEO_ACCEPTANCE_SCENARIO ?? "";
const PROFILE = process.env.Z_VIDEO_ACCEPTANCE_PROFILE ?? "";
const RESULT_PATH = process.env.Z_VIDEO_ACCEPTANCE_RESULT ?? "";

const SOURCE_ID = "source_123e4567-e89b-42d3-a456-426614174000";
const MEDIA_ID: LocalPlaybackMediaId = "media_123e4567-e89b-42d3-a456-426614174010";
const MEDIA_PATH = "C:\\fixtures\\acceptance-sample.mp4";
const PLAYBACK_DURATION_SEC = 1_800;
const PLAYBACK_RESUME_SEC = 900;

/* Fixture DTOs ------------------------------------------------------------- */

const mediaItem: LocalMediaItem = {
  mediaId: MEDIA_ID,
  sourceId: SOURCE_ID,
  collectionId: "collection_acceptance",
  title: "验收样本影片",
  kind: "movie",
  sizeBytes: 2_265_535,
  modifiedAtMs: Date.UTC(2026, 0, 2),
  available: true,
  year: 2026,
  premieredDate: null,
};

function sourceSummary(): LocalSourceSummary {
  return {
    sourceId: SOURCE_ID,
    label: "验收样本",
    locationHint: "D 盘",
    available: true,
    degraded: false,
    itemCount: 1,
    collectionCount: 1,
  };
}

function libraryState(sources: LocalSourceSummary[]): LocalLibraryState {
  return {
    status: "ready",
    schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION,
    sqliteAvailable: true,
    sources,
  };
}

const collectionSummary: LocalCollectionSummary = {
  collectionId: "collection_acceptance",
  title: mediaItem.title,
  kind: "movie",
  premieredDate: null,
  episodeCount: 1,
  watchedEpisodeCount: 0,
  availableEpisodeCount: 1,
  available: true,
  representativeMediaId: MEDIA_ID,
  coverMediaId: MEDIA_ID,
  addedAtMs: mediaItem.modifiedAtMs,
  updatedAtMs: mediaItem.modifiedAtMs,
};

const continueEntry: LocalContinueWatchingItem = {
  item: mediaItem,
  playback: {
    mediaId: MEDIA_ID,
    positionSec: 120,
    durationSec: PLAYBACK_DURATION_SEC,
    watched: false,
    updatedAtMs: mediaItem.modifiedAtMs,
  },
  collectionTitle: mediaItem.title,
  collectionKind: "movie",
  episodeTitle: mediaItem.title,
};

const mediaDetail: LocalMediaDetail = { item: mediaItem, episodes: [mediaItem] };

const cleanupCandidate: LocalCleanupCandidate = {
  item: mediaItem,
  rule: "D",
  cleanupState: "none",
  addedAtMs: mediaItem.modifiedAtMs,
};

function cleanupQueue(): LocalCleanupQueue {
  return {
    query: { rule: "all", state: "none", page: 1, pageSize: 50 },
    candidates: [cleanupCandidate],
    totalCount: 1,
    totalBytes: mediaItem.sizeBytes,
    deleteQueue: [],
    deleteCount: 0,
    deleteBytes: 0,
    nowMs: Date.now(),
  };
}

function preferences(sort = "recent", cleanup: CleanupSettings = DEFAULT_CLEANUP_SETTINGS) {
  return { volume: 100, muted: false, speed: 1, sort, cleanup };
}

/* In-memory library at the public IPC seam -------------------------------- */

interface MockLibraryControl {
  state: LocalLibraryState;
  failSearch: boolean;
  searchCalls: number;
  searchFailures: number;
  listThrows: boolean;
  listCalls: number;
  removeDelayMs: number;
  removeShouldFail: boolean;
  removeCalls: number;
}

function registerMockLibrary(): { control: MockLibraryControl; unregister: () => void } {
  const control: MockLibraryControl = {
    state: libraryState([sourceSummary()]),
    failSearch: false,
    searchCalls: 0,
    searchFailures: 0,
    listThrows: false,
    listCalls: 0,
    removeDelayMs: 0,
    removeShouldFail: false,
    removeCalls: 0,
  };

  ipcMain.handle(IPC_CHANNELS.localLibraryState, () => control.state);
  ipcMain.handle(IPC_CHANNELS.localLibraryList, (_event, query?: { page?: number; pageSize?: number }) => {
    control.listCalls += 1;
    if (control.listThrows) throw new Error("片库服务未启动（测试夹具）");
    return {
      state: control.state,
      page: {
        query: { page: 1, pageSize: 50, ...(query ?? {}) },
        page: 1,
        pageSize: 50,
        totalCount: 1,
        items: [mediaItem],
      },
    };
  });
  ipcMain.handle(IPC_CHANNELS.localLibraryListCollections, (_event, query?: { query?: string; filter?: string }) => {
    control.listCalls += 1;
    if (control.listThrows) throw new Error("片库服务未启动（测试夹具）");
    const term = typeof query?.query === "string" ? query.query.trim() : "";
    if (term.length > 0) {
      control.searchCalls += 1;
      if (control.failSearch) {
        control.searchFailures += 1;
        throw new Error("搜索索引暂时不可用（测试夹具）");
      }
      // A successful search with no match: this is the honest "0 部作品" state.
      return { state: control.state, page: { query: query ?? {}, page: 1, pageSize: 50, totalCount: 0, items: [] } };
    }
    const items = query?.filter === "show" ? [] : [collectionSummary];
    return {
      state: control.state,
      page: { query: query ?? { page: 1, pageSize: 50 }, page: 1, pageSize: 50, totalCount: items.length, items },
    };
  });
  ipcMain.handle(IPC_CHANNELS.localLibraryGet, (_event, mediaId?: string) => mediaId === MEDIA_ID
    ? { state: control.state, detail: mediaDetail, item: mediaItem }
    : { state: control.state });
  ipcMain.handle(IPC_CHANNELS.localLibraryContinueWatching, () => ({ state: control.state, items: [continueEntry] }));
  ipcMain.handle(IPC_CHANNELS.localLibraryArtwork, () => ({ state: control.state }));
  ipcMain.handle(IPC_CHANNELS.localLibraryCleanupQueue, () => ({ state: control.state, queue: cleanupQueue() }));
  ipcMain.handle(IPC_CHANNELS.localLibraryCleanupSetState, () => ({ state: control.state, queue: cleanupQueue() }));
  ipcMain.handle(IPC_CHANNELS.localLibraryCleanupReveal, () => ({ revealed: true }));
  ipcMain.handle(IPC_CHANNELS.localLibraryRemoveSource, async (_event, sourceId?: string) => {
    control.removeCalls += 1;
    if (control.removeDelayMs > 0) await delay(control.removeDelayMs);
    if (control.removeShouldFail) throw new Error("片库文件暂时被占用，请重试。");
    control.state = libraryState(control.state.sources.filter((source) => source.sourceId !== sourceId));
    return control.state;
  });
  ipcMain.handle(IPC_CHANNELS.appPreferencesGet, () => preferences());
  ipcMain.handle(IPC_CHANNELS.appPreferencesSetSort, (_event, sort?: string) => preferences(typeof sort === "string" ? sort : "recent"));
  ipcMain.handle(IPC_CHANNELS.appPreferencesSetCleanup, (_event, cleanup?: CleanupSettings) => preferences("recent", cleanup ?? DEFAULT_CLEANUP_SETTINGS));

  const unregister = () => {
    for (const channel of [
      IPC_CHANNELS.localLibraryState,
      IPC_CHANNELS.localLibraryList,
      IPC_CHANNELS.localLibraryListCollections,
      IPC_CHANNELS.localLibraryGet,
      IPC_CHANNELS.localLibraryContinueWatching,
      IPC_CHANNELS.localLibraryArtwork,
      IPC_CHANNELS.localLibraryCleanupQueue,
      IPC_CHANNELS.localLibraryCleanupSetState,
      IPC_CHANNELS.localLibraryCleanupReveal,
      IPC_CHANNELS.localLibraryRemoveSource,
      IPC_CHANNELS.appPreferencesGet,
      IPC_CHANNELS.appPreferencesSetSort,
      IPC_CHANNELS.appPreferencesSetCleanup,
    ]) ipcMain.removeHandler(channel);
  };
  return { control, unregister };
}

/* Generic window helpers --------------------------------------------------- */

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function read<T>(window: BrowserWindow, expression: string): Promise<T> {
  return window.webContents.executeJavaScript(expression, true) as Promise<T>;
}

async function waitForValue<T>(
  label: string,
  readValue: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await readValue();
    if (predicate(last)) return last;
    await delay(50);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms: ${JSON.stringify(last)}`);
}

async function waitUntil<T>(
  label: string,
  readValue: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await readValue();
    if (predicate(last)) return last;
    await delay(25);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms: ${JSON.stringify(last)}`);
}

async function click(window: BrowserWindow, selector: string): Promise<void> {
  await read<boolean>(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`missing element ${selector}`)});
    element.click();
    return true;
  })()`);
}

function escapeKeyScript(): string {
  return `(() => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  })()`;
}

async function pressEscape(window: BrowserWindow): Promise<void> {
  await read<boolean>(window, escapeKeyScript());
}

async function prepareFixtureProfile(): Promise<void> {
  assert.ok(PROFILE.length > 0, "Z_VIDEO_ACCEPTANCE_PROFILE is required");
  app.setPath("userData", join(PROFILE, "userdata"));
  app.setPath("sessionData", join(PROFILE, "session"));
  await mkdir(join(PROFILE, "userdata"), { recursive: true });
  await mkdir(join(PROFILE, "session"), { recursive: true });
}

async function startFixtureWindow(): Promise<BrowserWindow> {
  await app.whenReady();
  const userData = resolve(app.getPath("userData"));
  assert.ok(
    userData.toLowerCase().startsWith(resolve(PROFILE).toLowerCase()),
    `fixture userData stays inside the throw-away profile: ${userData}`,
  );
  const window = createMainWindow();
  window.webContents.setBackgroundThrottling(false);
  if (window.webContents.isLoading()) {
    await new Promise<void>((resolveLoad) => window.webContents.once("did-finish-load", () => resolveLoad()));
  }
  await waitForValue("renderer preload bridge", () => read<boolean>(window, "typeof window.zVideo?.localLibrary?.getState === 'function'"), Boolean);
  return window;
}

/* Scenario: F-01 + F-04 (production bootstrap) ---------------------------- */

async function waitForProductionWindow(): Promise<BrowserWindow> {
  await app.whenReady();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed()
      && candidate.webContents.getURL().endsWith("/index.html"));
    if (window) return window;
    await delay(100);
  }
  throw new Error("production main did not create a renderer window");
}

async function runStartupFailureRetryScenario(): Promise<string[]> {
  assert.ok(PROFILE.length > 0, "Z_VIDEO_ACCEPTANCE_PROFILE is required");
  await app.whenReady();
  const userData = app.getPath("userData");
  assert.ok(
    resolve(userData).toLowerCase().startsWith(resolve(PROFILE).toLowerCase()),
    `production userData stays inside the throw-away profile: ${userData} (profile ${PROFILE})`,
  );
  // F-01 fixture: the database *path* is a directory, so every SQLite open fails.
  const dbPath = join(userData, "local-library", "library.sqlite");
  await mkdir(dbPath, { recursive: true });

  // Importing the real production main runs the real bootstrap().
  require("../src/main/main.js");
  const window = await waitForProductionWindow();
  window.webContents.setBackgroundThrottling(false);
  const rendererWebContentsId = window.webContents.id;
  const nativeWindowId = window.id;

  const readErrorCard = () => read<{
    visible: boolean;
    title: string;
    message: string;
    code: string;
    retryText: string;
    retryDisabled: boolean;
    retryHint: string;
    pageErrorVisible: boolean;
  }>(window, `(() => ({
    visible: document.querySelector('#library-error')?.hidden === false,
    title: document.querySelector('#library-error-title')?.textContent ?? '',
    message: document.querySelector('#library-error-message')?.textContent ?? '',
    code: document.querySelector('#library-error-code')?.textContent ?? '',
    retryText: document.querySelector('#library-error-retry')?.textContent ?? '',
    retryDisabled: document.querySelector('#library-error-retry')?.disabled === true,
    retryHint: document.querySelector('#library-error-retry-hint')?.textContent ?? '',
    pageErrorVisible: document.querySelector('#library-page-error')?.hidden === false,
  }))()`);
  const startup = await waitForValue("startup error card", readErrorCard, (value) => value.visible, 30_000);
  assert.equal(
    BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed()
      && candidate.webContents.getURL().endsWith("/index.html")).length,
    1,
    "F-01: a failed local-library start still creates exactly one renderer window",
  );
  assert.equal(startup.title, "片库文件暂时无法读写", "F-01: the error card names the storage failure");
  assert.match(startup.message, /本地片库存储不可用/, "F-01: the error card carries the failure message");
  assert.equal(startup.code, "错误代码：sqlite-unavailable", "F-01: the technical details keep the stable error code");
  assert.equal(startup.retryText, "重试");
  assert.equal(startup.retryDisabled, false);
  assert.match(startup.retryHint, /不需要重启应用/, "F-04: the card promises the retry works without a restart");
  assert.equal(startup.pageErrorVisible, false, "F-01: the list-level error never replaces the global error card");

  // F-04 red half: retry while the database path is still unusable must be visible.
  await click(window, "#library-error-retry");
  const failedRetry = await waitForValue(
    "first retry failure note",
    () => read<{ noteVisible: boolean; noteText: string; errorVisible: boolean; retryText: string; retryDisabled: boolean }>(window, `(() => ({
      noteVisible: document.querySelector('#library-error-retry-note')?.hidden === false,
      noteText: document.querySelector('#library-error-retry-note')?.textContent ?? '',
      errorVisible: document.querySelector('#library-error')?.hidden === false,
      retryText: document.querySelector('#library-error-retry')?.textContent ?? '',
      retryDisabled: document.querySelector('#library-error-retry')?.disabled === true,
    }))()`),
    (value) => value.noteVisible,
    30_000,
  );
  assert.match(failedRetry.noteText, /第 1 次重试仍失败/, "F-04: a failed retry reports its attempt number instead of doing nothing");
  assert.equal(failedRetry.errorVisible, true, "F-04: a failed retry keeps the error card");
  assert.equal(failedRetry.retryText, "重试", "F-04: the retry button returns to its idle label");
  assert.equal(failedRetry.retryDisabled, false);

  // F-04 green half: repair the storage, retry again in the same process.
  await rm(dbPath, { recursive: true, force: true });
  await click(window, "#library-error-retry");
  const recovered = await waitForValue(
    "recovered library after retry",
    () => read<{
      errorVisible: boolean;
      noteVisible: boolean;
      retryText: string;
      emptyVisible: boolean;
      onboardingVisible: boolean;
      message: string;
    }>(window, `(() => ({
      errorVisible: document.querySelector('#library-error')?.hidden === false,
      noteVisible: document.querySelector('#library-error-retry-note')?.hidden === false,
      retryText: document.querySelector('#library-error-retry')?.textContent ?? '',
      emptyVisible: document.querySelector('#library-empty')?.hidden === false,
      onboardingVisible: document.querySelector('#onboarding')?.hidden === false,
      message: document.querySelector('#library-message')?.textContent ?? '',
    }))()`),
    (value) => value.errorVisible === false
      && value.noteVisible === false
      && value.retryText === "重试"
      && (value.emptyVisible || value.onboardingVisible),
    40_000,
  );
  const state = await read<{ status: string }>(window, "window.zVideo.localLibrary.getState().then((value) => ({ status: value.status }))");
  assert.equal(state.status, "ready", "F-04: one retry returns the owner to `ready` without restarting the app");
  assert.equal(recovered.noteVisible, false, "F-04: recovery clears the failure note");
  assert.equal(recovered.retryText, "重试");
  assert.ok(recovered.emptyVisible || recovered.onboardingVisible, "F-04: the recovered app renders its normal empty surface");
  assert.equal((await statFile(dbPath)).isFile(), true, "F-04: the retry created the SQLite file at the repaired path");
  assert.equal(window.webContents.id, rendererWebContentsId, "F-04: recovery reuses the same renderer, never a restarted app");
  assert.equal(window.id, nativeWindowId, "F-04: recovery reuses the same native window");

  return [
    "F-01: failed start still opens one window and shows the sqlite-unavailable error card",
    "F-04: first retry reports “第 1 次重试仍失败” while storage is broken",
    "F-04: after repairing the path, retry reaches ready/empty state in the same window",
  ];
}

/* Scenario: F-04 retry is not a silent no-op (renderer-level fixture) ----- */

/**
 * F-01 makes the startup error card unreachable at the pre-fix commit, so this
 * scenario isolates F-04 itself: the renderer is loaded against a library in
 * `error` and the retry click has to re-issue an owner read and recover the
 * visible surface without a process restart.
 */
async function runRetryRecoveryScenario(): Promise<string[]> {
  const { control, unregister } = registerMockLibrary();
  try {
    await prepareFixtureProfile();
    control.state = {
      status: "error",
      schemaVersion: LOCAL_LIBRARY_SCHEMA_VERSION,
      sqliteAvailable: false,
      sources: [],
      error: { code: "storage", message: "片库暂时不可用（测试夹具）" },
    };
    control.listThrows = true;
    const window = await startFixtureWindow();
    const errorCard = await waitForValue(
      "library error card from the owner state",
      () => read<{ visible: boolean; retryText: string; retryDisabled: boolean }>(window, `(() => ({
        visible: document.querySelector('#library-error')?.hidden === false,
        retryText: document.querySelector('#library-error-retry')?.textContent ?? '',
        retryDisabled: document.querySelector('#library-error-retry')?.disabled === true,
      }))()`),
      (value) => value.visible,
    );
    assert.equal(errorCard.retryText, "重试");
    assert.equal(errorCard.retryDisabled, false);

    // F-04 red target: with the owner still broken, a retry click used to return
    // silently (`loadLibrary()` bails while status==="error"). It must instead
    // attempt one owner call and report the failed attempt in the card.
    const callsBeforeFailure = control.listCalls;
    await click(window, "#library-error-retry");
    const failedRetry = await waitForValue(
      "failed retry is reported",
      () => read<{ errorVisible: boolean; noteVisible: boolean; noteText: string; retryText: string; retryDisabled: boolean }>(window, `(() => ({
        errorVisible: document.querySelector('#library-error')?.hidden === false,
        noteVisible: document.querySelector('#library-error-retry-note')?.hidden === false,
        noteText: document.querySelector('#library-error-retry-note')?.textContent ?? '',
        retryText: document.querySelector('#library-error-retry')?.textContent ?? '',
        retryDisabled: document.querySelector('#library-error-retry')?.disabled === true,
      }))()`),
      (value) => value.noteVisible,
      10_000,
    );
    assert.ok(control.listCalls > callsBeforeFailure, "F-04: the retry attempted an owner call instead of returning silently");
    assert.match(failedRetry.noteText, /第 1 次重试仍失败/, "F-04: a failed retry reports its attempt number");
    assert.equal(failedRetry.errorVisible, true, "F-04: a failed retry keeps the error card");
    assert.equal(failedRetry.retryText, "重试");
    assert.equal(failedRetry.retryDisabled, false);

    // The owner is repaired without restarting the renderer.
    control.listThrows = false;
    control.state = libraryState([sourceSummary()]);
    const callsBefore = control.listCalls;
    await click(window, "#library-error-retry");
    const recovered = await waitForValue(
      "error card cleared by retry",
      () => read<{ errorVisible: boolean; noteVisible: boolean; retryText: string; cards: number }>(window, `(() => ({
        errorVisible: document.querySelector('#library-error')?.hidden === false,
        noteVisible: document.querySelector('#library-error-retry-note')?.hidden === false,
        retryText: document.querySelector('#library-error-retry')?.textContent ?? '',
        cards: document.querySelectorAll('#library-grid .media-card').length,
      }))()`),
      (value) => value.errorVisible === false && value.retryText === "重试" && value.cards >= 1,
      20_000,
    );
    assert.ok(control.listCalls > callsBefore, "F-04: retry really calls the owner instead of returning silently");
    assert.equal(recovered.noteVisible, false, "F-04: a successful retry has no failure note");
    assert.equal(recovered.retryText, "重试");
    assert.ok(recovered.cards >= 1, "F-04: the recovered library renders its work cards");
    return [
      "F-04: a retry while the owner is still broken reports “第 1 次重试仍失败” instead of doing nothing",
      "F-04: after the repair the same retry click clears the error card without restarting the renderer",
    ];
  } finally {
    unregister();
  }
}

/* Scenario: F-05 search failure ------------------------------------------ */

async function runSearchFailureScenario(): Promise<string[]> {
  const { control, unregister } = registerMockLibrary();
  try {
    await prepareFixtureProfile();
    const window = await startFixtureWindow();
    control.failSearch = true;
    await read<boolean>(window, `(() => {
      const input = document.querySelector('#library-search-input');
      input.value = '验收样本';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#library-search-form').requestSubmit();
      return true;
    })()`);

    const readSearch = () => read<{
      sectionVisible: boolean;
      emptyVisible: boolean;
      title: string;
      message: string;
      retryVisible: boolean;
      retryText: string;
      count: string;
      cards: number;
      inputValue: string;
    }>(window, `(() => ({
      sectionVisible: document.querySelector('#search-section')?.hidden === false,
      emptyVisible: document.querySelector('#search-empty')?.hidden === false,
      title: document.querySelector('#search-empty-title')?.textContent ?? '',
      message: document.querySelector('#search-empty-message')?.textContent ?? '',
      retryVisible: document.querySelector('#search-empty-retry')?.hidden === false,
      retryText: document.querySelector('#search-empty-retry')?.textContent ?? '',
      count: document.querySelector('#search-count')?.textContent ?? '',
      cards: document.querySelectorAll('#search-grid .media-card').length,
      inputValue: document.querySelector('#library-search-input')?.value ?? '',
    }))()`);

    const failure = await waitForValue("search failure state", readSearch, (value) => value.retryVisible || /读取失败/.test(value.count));
    assert.equal(failure.sectionVisible, true, "F-05: the failure is shown inside the search view");
    assert.equal(failure.emptyVisible, true);
    assert.equal(failure.title, "搜索暂时不可用");
    assert.match(failure.message, /读取失败/, "F-05: the message says the read failed");
    assert.match(failure.message, /不代表没有匹配作品/, "F-05: a read failure never claims the library has no matches");
    assert.equal(failure.retryVisible, true, "F-05: the failure offers one explicit retry entry");
    assert.equal(failure.retryText, "重试搜索");
    assert.match(failure.count, /读取失败，未得到结果数/, "F-05: the count line reports the unknown result count");
    assert.doesNotMatch(failure.count, /共 0 部作品/, "F-05: a read failure never renders “共 0 部作品”");
    assert.equal(failure.cards, 0, "F-05: the previous result grid is cleared");
    assert.equal(failure.inputValue, "验收样本", "F-05: the query stays in the field for the retry");
    assert.equal(control.searchFailures, 1);
    assert.equal(control.searchCalls, 1);

    // Recovered read with no match: a genuine empty result may say 0 works again.
    control.failSearch = false;
    await click(window, "#search-empty-retry");
    const empty = await waitForValue("honest empty search after retry", readSearch, (value) => !value.retryVisible && /共 0 部作品/.test(value.count));
    assert.equal(empty.emptyVisible, true);
    assert.match(empty.title, /没有找到作品/, "F-05: the retry reaches the real empty-result copy");
    assert.doesNotMatch(empty.count, /读取失败/, "F-05: a successful read clears the failure count line");
    assert.equal(control.searchCalls, 2, "F-05: the retry really re-sent the search");
    assert.equal(control.searchFailures, 1);
    return [
      "F-05: a failing search shows “搜索暂时不可用” + “重试搜索” and never “共 0 部作品”",
      "F-05: the retry re-sends the search and only then shows the honest 0-result count",
    ];
  } finally {
    unregister();
  }
}

/* Scenario: P-07 control failure ----------------------------------------- */

async function runControlFailureScenario(): Promise<string[]> {
  const { unregister } = registerMockLibrary();
  const commands: LocalPlaybackControlCommand[] = [];
  ipcMain.handle(IPC_CHANNELS.localPlaybackOpen, () => ({ opened: true }));
  ipcMain.handle(IPC_CHANNELS.localPlaybackCommand, (_event, command: LocalPlaybackControlCommand) => {
    commands.push(command);
    throw new Error("播放控制失败（测试夹具）");
  });
  try {
    await prepareFixtureProfile();
    const window = await startFixtureWindow();
    await waitForValue("home hero play button", () => read<boolean>(window, "document.querySelector('#hero-play')?.disabled === false && document.querySelector('#home-hero')?.hidden === false"), Boolean);
    await click(window, "#hero-play");
    await waitForValue("player layer visible", () => read<boolean>(window, "document.querySelector('[data-view=player]')?.hidden === false"), Boolean);

    // Fake engine events: the player only becomes controllable after `ready`.
    window.webContents.send(IPC_CHANNELS.localPlaybackEvent, { type: "loading", mediaId: MEDIA_ID });
    window.webContents.send(IPC_CHANNELS.localPlaybackEvent, { type: "ready", mediaId: MEDIA_ID, durationSec: 600 });
    await waitForValue("player controls enabled", () => read<boolean>(window, "document.querySelector('#player-toggle-button')?.disabled === false"), Boolean);
    window.webContents.send(IPC_CHANNELS.localPlaybackEvent, { type: "position", mediaId: MEDIA_ID, positionSec: 30, durationSec: 600 });

    const readPlayer = () => read<{
      noticeHidden: boolean;
      noticeText: string;
      seekValue: string;
      seekMax: string;
      status: string;
      endedHidden: boolean;
    }>(window, `(() => ({
      noticeHidden: document.querySelector('#player-control-notice')?.hidden !== false,
      noticeText: document.querySelector('#player-control-notice-text')?.textContent ?? '',
      seekValue: document.querySelector('#player-seek')?.value ?? '',
      seekMax: document.querySelector('#player-seek')?.max ?? '',
      status: document.querySelector('#player-status')?.textContent ?? '',
      endedHidden: document.querySelector('#player-ended')?.hidden !== false,
    }))()`);

    const before = await waitForValue("seek position from the engine", readPlayer, (value) => value.seekValue === "30");
    assert.equal(before.noticeHidden, true, "P-07: no failure strip before a command fails");
    assert.equal(before.seekMax, "600");

    // Optimistically drag to 420s, then have the command reject.
    await read<boolean>(window, `(() => {
      const seek = document.querySelector('#player-seek');
      seek.value = '420';
      seek.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const failed = await waitForValue("visible playback control failure", readPlayer, (value) => value.noticeHidden === false && value.seekValue === "30");
    assert.match(failed.noticeText, /调整进度没有生效，界面已恢复到上一次状态。/, "P-07: the failure names the rejected control");
    assert.equal(failed.seekValue, "30", "P-07: the slider snaps back to the last position the engine reported");
    assert.equal(failed.status, "播放控制失败，请重试。", "P-07: the sr-only status still records the failure");
    assert.equal(commands.filter((command) => command.type === "seek").length, 1, "P-07: the rejected seek really crossed the IPC boundary");
    return [
      "P-07: a rejected seek shows a visible notice and rolls the slider back to 30s",
    ];
  } finally {
    unregister();
    ipcMain.removeHandler(IPC_CHANNELS.localPlaybackOpen);
    ipcMain.removeHandler(IPC_CHANNELS.localPlaybackCommand);
  }
}

/* Scenario: B-06 Escape while a removal is in flight --------------------- */

async function runBusyEscapeScenario(): Promise<string[]> {
  const { control, unregister } = registerMockLibrary();
  try {
    await prepareFixtureProfile();
    const window = await startFixtureWindow();
    await click(window, "[data-nav=folder]");
    await waitForValue("source card", () => read<boolean>(window, "document.querySelector('#sources-page')?.hidden === false && document.querySelectorAll('#source-list [data-source-card-id]').length === 1"), Boolean);

    const readDialog = () => read<{
      open: boolean;
      errorVisible: boolean;
      errorText: string;
      confirmText: string;
      cancelDisabled: boolean;
      sourceCards: number;
      noticeTitle: string;
    }>(window, `(() => ({
      open: document.querySelector('#remove-source-dialog')?.open === true,
      errorVisible: document.querySelector('#remove-source-error')?.hidden === false,
      errorText: document.querySelector('#remove-source-error')?.textContent ?? '',
      confirmText: document.querySelector('#remove-source-confirm')?.textContent ?? '',
      cancelDisabled: document.querySelector('#remove-source-cancel')?.disabled === true,
      sourceCards: document.querySelectorAll('#source-list [data-source-card-id]').length,
      noticeTitle: document.querySelector('#app-notice-title')?.textContent ?? '',
    }))()`);

    // Phase 1: slow-but-successful removal; Escape lands while the write is in flight.
    control.removeDelayMs = 1_500;
    await click(window, "[data-remove-source-id]");
    await waitForValue("remove dialog open", readDialog, (value) => value.open);
    await read<boolean>(window, `(() => {
      document.querySelector('#remove-source-confirm').click();
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`);
    const busy = await readDialog();
    assert.equal(busy.open, true, "B-06: Escape cannot close the dialog while the removal is running");
    assert.equal(busy.errorVisible, true, "B-06: the refusal is written into the visible dialog");
    assert.match(busy.errorText, /正在移除/, "B-06: the refusal says the removal is still running");
    assert.equal(busy.confirmText, "正在移除…", "B-06: the confirm button reports the in-flight state");
    assert.equal(busy.cancelDisabled, true, "B-06: the cancel button is disabled while the write is in flight");

    const removed = await waitForValue("removal finishes", readDialog, (value) => value.open === false);
    assert.match(removed.noticeTitle, /已移除文件夹/, "B-06: the finished removal reports on the visible notice");
    assert.equal(removed.sourceCards, 0);

    // Phase 2: slow-and-failing removal; the failure must land in the open dialog.
    window.webContents.send(IPC_CHANNELS.localLibraryState, libraryState([sourceSummary()]));
    await waitForValue("source card restored", () => read<boolean>(window, "document.querySelectorAll('#source-list [data-source-card-id]').length === 1"), Boolean);
    control.removeShouldFail = true;
    control.removeDelayMs = 1_200;
    await click(window, "[data-remove-source-id]");
    await waitForValue("second remove dialog open", readDialog, (value) => value.open);
    await read<boolean>(window, `(() => {
      document.querySelector('#remove-source-confirm').click();
      document.querySelector('#remove-source-dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`);
    const busyAgain = await readDialog();
    assert.equal(busyAgain.open, true, "B-06: the native dialog cancel path is refused too");
    assert.match(busyAgain.errorText, /正在移除/, "B-06: the cancel refusal is visible inside the dialog");

    const failure = await waitForValue(
      "removal failure inside the open dialog",
      readDialog,
      (value) => /占用|重试/.test(value.errorText) && value.confirmText === "重试移除",
      15_000,
    );
    assert.equal(failure.open, true, "B-06: a failed removal leaves the dialog open to report it");
    assert.match(failure.errorText, /占用/, "B-06: the failure message is the real owner error");
    assert.equal(failure.confirmText, "重试移除", "B-06: the dialog offers an in-place retry");
    assert.equal(failure.cancelDisabled, false, "B-06: the dialog is usable again once the write settles");
    assert.equal(failure.sourceCards, 1, "B-06: a failed removal keeps the folder record");
    assert.equal(control.removeCalls, 2);
    await click(window, "#remove-source-cancel");
    await waitForValue("dialog closed by the user", readDialog, (value) => value.open === false);
    return [
      "B-06: Escape (key and native cancel) cannot dismiss a running removal; the dialog reports “正在移除”",
      "B-06: a late failure stays inside the still-open dialog with “重试移除”",
    ];
  } finally {
    unregister();
  }
}

/* Scenario: CL-08 inspection replay -------------------------------------- */

class FakeEngine implements PlayerEngine {
  readonly starts: Array<{ source: string; startPositionSec: number | undefined }> = [];
  private onEvent: ((event: PlayerEngineEvent) => void) | undefined;

  start(source: string, startPositionSec: number | undefined, onEvent: (event: PlayerEngineEvent) => void): void {
    this.starts.push({ source, startPositionSec });
    this.onEvent = onEvent;
    // The production coordinator expects the engine to announce readiness.
    setTimeout(() => onEvent({ type: "ready", durationSec: PLAYBACK_DURATION_SEC }), 0);
  }

  stop(): void {}
  play(): void {}
  pause(): void {}
  seek(): void {}
  setVolume(): void {}
  setMuted(): void {}
  setSpeed(): void {}
  setAudioTrack(): void {}
  setSubtitleTrack(): void {}
  addSubtitleFile(): void {}
  destroy(): void {}

  emit(event: PlayerEngineEvent): void {
    this.onEvent?.(event);
  }
}

async function runReviewReplayScenario(): Promise<string[]> {
  const { unregister } = registerMockLibrary();
  const engine = new FakeEngine();
  const opens: Array<{ mediaId: string; options?: LocalPlaybackOpenOptions }> = [];
  try {
    await prepareFixtureProfile();
    await app.whenReady();
    const store: LocalPlaybackStore = {
      resolveMediaPath: async (mediaId) => (mediaId === MEDIA_ID ? MEDIA_PATH : undefined),
      getPlayback: async (mediaId) => ({
        mediaId,
        positionSec: PLAYBACK_RESUME_SEC,
        durationSec: PLAYBACK_DURATION_SEC,
        watched: false,
        updatedAtMs: 0,
      }),
      savePlayback: async (value) => value,
    };
    const window = createMainWindow();
    window.webContents.setBackgroundThrottling(false);
    const coordinator = new LocalPlaybackCoordinator(
      engine,
      (event) => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.localPlaybackEvent, event);
      },
      () => undefined,
      store,
    );
    const host: LocalPlaybackHost = {
      open: async (mediaId, options) => {
        opens.push({ mediaId, ...(options ? { options } : {}) });
        await coordinator.open(mediaId as LocalPlaybackMediaId, options);
        return { opened: true };
      },
      handle: (command) => coordinator.handle(command),
      chooseSubtitleFile: async () => ({ loaded: false }),
      close: () => coordinator.close(),
    };
    const unregisterPlayback = registerLocalPlaybackIpcHandlers(host);
    try {
      if (window.webContents.isLoading()) {
        await new Promise<void>((resolveLoad) => window.webContents.once("did-finish-load", () => resolveLoad()));
      }
      await waitForValue("renderer preload bridge", () => read<boolean>(window, "typeof window.zVideo?.localLibrary?.getState === 'function'"), Boolean);
      await waitForValue("cleanup entry", () => read<boolean>(window, "document.querySelector('#cleanup-entry') !== null"), Boolean);
      await click(window, "#cleanup-entry");
      await waitForValue(
        "cleanup candidate card",
        () => read<{ visible: boolean; cards: number }>(window, `(() => ({
          visible: document.querySelector('#cleanup-section')?.hidden === false,
          cards: document.querySelectorAll('#cleanup-candidates .cleanup-card').length,
        }))()`),
        (value) => value.visible && value.cards === 1,
      );

      await click(window, "#cleanup-candidates [data-cleanup-media-id] [data-cleanup-action=review]");
      await waitUntil("inspection open request", () => opens.length, (count) => count >= 1);
      await waitUntil("inspection engine start", () => engine.starts.length, (count) => count >= 1);
      await waitForValue("inspection player ready", () => read<boolean>(window, "document.querySelector('#player-toggle-button')?.disabled === false"), Boolean);
      assert.deepEqual(opens[0], { mediaId: MEDIA_ID }, "CL-08: the inspection opens the candidate without a restart flag");
      assert.equal(engine.starts[0]?.startPositionSec, PLAYBACK_RESUME_SEC, "CL-08: the first inspection resumes from the saved 900s position");
      assert.equal(engine.starts[0]?.source, MEDIA_PATH);

      // Play to the end through the production coordinator.
      engine.emit({ type: "position", positionSec: PLAYBACK_RESUME_SEC, durationSec: PLAYBACK_DURATION_SEC });
      await waitForValue("inspection position", () => read<string>(window, "document.querySelector('#player-seek')?.value ?? ''"), (value) => value === String(PLAYBACK_RESUME_SEC));
      engine.emit({ type: "state", state: "ended" });
      const ended = await waitForValue(
        "ended panel with replay",
        () => read<{ endedVisible: boolean; replayVisible: boolean; replayDisabled: boolean; reviewBarVisible: boolean }>(window, `(() => ({
          endedVisible: document.querySelector('#player-ended')?.hidden === false,
          replayVisible: document.querySelector('#player-replay')?.hidden === false,
          replayDisabled: document.querySelector('#player-replay')?.disabled === true,
          reviewBarVisible: document.querySelector('#player-review-bar')?.hidden === false,
        }))()`),
        (value) => value.endedVisible && value.replayVisible,
      );
      assert.equal(ended.replayDisabled, false, "CL-08: the replay action is usable after the inspection ends");
      assert.equal(ended.reviewBarVisible, true, "CL-08: the ended panel stays in inspection mode");

      await click(window, "#player-replay");
      await waitUntil("replay open request", () => opens.length, (count) => count >= 2);
      await waitUntil("replay engine start", () => engine.starts.length, (count) => count >= 2);
      assert.equal(opens.length, 2, "CL-08: one replay issues exactly one open request");
      assert.equal(opens[1]?.mediaId, MEDIA_ID, "CL-08: the replay re-opens the same candidate");
      assert.equal(opens[1]?.options?.restart, true, "CL-08: the replay asks the owner for a restart");
      assert.equal(engine.starts[1]?.source, MEDIA_PATH, "CL-08: the restart uses the same indexed media");
      assert.equal(engine.starts[1]?.startPositionSec, 0, "CL-08: the restart starts at 0s instead of the saved 900s");
      const replayed = await waitForValue(
        "replayed inspection",
        () => read<{ endedHidden: boolean; seekValue: string; reviewBarVisible: boolean; decisionOpen: boolean; title: string }>(window, `(() => ({
          endedHidden: document.querySelector('#player-ended')?.hidden !== false,
          seekValue: document.querySelector('#player-seek')?.value ?? '',
          reviewBarVisible: document.querySelector('#player-review-bar')?.hidden === false,
          decisionOpen: document.querySelector('#review-decision-dialog')?.open === true,
          title: document.querySelector('#player-current-title')?.textContent ?? '',
        }))()`),
        (value) => value.endedHidden && value.seekValue === "0",
      );
      assert.equal(replayed.decisionOpen, false, "CL-08: replay keeps the inspection session instead of asking for a close-time mark");
      assert.equal(replayed.reviewBarVisible, true, "CL-08: the replay stays in the same inspection");
      assert.equal(replayed.title, mediaItem.title, "CL-08: the replayed media keeps its title");
      return [
        "CL-08: a finished inspection shows “重新播放”, and the click re-opens the same mediaId with restart=true at 0s",
        "CL-08: the replayed session keeps the inspection bar and never opens the close-time mark dialog",
      ];
    } finally {
      unregisterPlayback();
      await coordinator.close("app-quit");
    }
  } finally {
    unregister();
  }
}

/* Entry point ------------------------------------------------------------- */

async function runScenario(scenario: string): Promise<string[]> {
  switch (scenario) {
    case "startup-failure-retry": return runStartupFailureRetryScenario();
    case "retry-recovery": return runRetryRecoveryScenario();
    case "search-failure": return runSearchFailureScenario();
    case "control-failure": return runControlFailureScenario();
    case "busy-escape": return runBusyEscapeScenario();
    case "review-replay": return runReviewReplayScenario();
    default: throw new Error(`unknown acceptance scenario: ${scenario}`);
  }
}

async function shutdown(code: number): Promise<void> {
  if (code !== 0) {
    app.exit(code);
    return;
  }
  const finished = new Promise<void>((resolveQuit) => {
    const timer = setTimeout(resolveQuit, 4_000);
    app.once("will-quit", () => { clearTimeout(timer); resolveQuit(); });
  });
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
  app.quit();
  await finished;
  app.exit(0);
}

async function run(): Promise<void> {
  assert.ok(SCENARIO.length > 0, "Z_VIDEO_ACCEPTANCE_SCENARIO is required");
  assert.ok(RESULT_PATH.length > 0, "Z_VIDEO_ACCEPTANCE_RESULT is required");
  const checks = await runScenario(SCENARIO);
  await writeFile(RESULT_PATH, `${JSON.stringify({
    schemaVersion: 1,
    proof: "audit-findings-acceptance",
    scenario: SCENARIO,
    checks,
    finishedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  await shutdown(0);
}

void run().catch(async (error: unknown) => {
  console.error(`acceptance window smoke failed (${SCENARIO || "no scenario"})`, error instanceof Error ? error.stack ?? error.message : error);
  await shutdown(1);
});
