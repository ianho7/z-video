import assert from "node:assert/strict";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

const smokeUserData = process.env.Z_VIDEO_WINDOW_SMOKE_PROFILE ?? join(process.env.TEMP ?? process.cwd(), `z-video-electron-window-smoke-${process.pid}`);
app.setPath("userData", smokeUserData);
app.setPath("sessionData", join(smokeUserData, "session"));

interface SmokeItem {
  mediaId: string;
  sourceId: string;
  title: string;
  kind: string;
  sizeBytes: number;
  modifiedAtMs: number;
  available: boolean;
  artwork?: Array<{ kind: "poster" | "fanart"; cacheKey: string }>;
}

const item: SmokeItem = {
  mediaId: "media_123e4567-e89b-12d3-a456-426614174000",
  sourceId: "source_123e4567-e89b-12d3-a456-426614174000",
  title: "窗口测试影片",
  kind: "movie",
  sizeBytes: 1_048_576,
  modifiedAtMs: 1_793_440_000_000,
  available: true,
};
const broken: SmokeItem = { ...item, mediaId: "media_123e4567-e89b-12d3-a456-426614174001", title: "损坏海报", artwork: [{ kind: "poster", cacheKey: "broken" }] };
const delayed: SmokeItem = { ...item, mediaId: "media_123e4567-e89b-12d3-a456-426614174002", title: "延迟海报", artwork: [{ kind: "poster", cacheKey: "delayed" }] };
const replacement: SmokeItem = { ...item, mediaId: "media_123e4567-e89b-12d3-a456-426614174003", title: "新详情", artwork: [] };
const fanartOnly: SmokeItem = { ...item, mediaId: "media_123e4567-e89b-12d3-a456-426614174004", title: "仅有背景", artwork: [{ kind: "fanart", cacheKey: "fanart" }] };
const good: SmokeItem = { ...item, mediaId: "media_123e4567-e89b-12d3-a456-426614174005", title: "有效海报", artwork: [{ kind: "poster", cacheKey: "good" }] };
const items: SmokeItem[] = [item, broken, delayed, replacement, fanartOnly, good];
const otherSourceId = "source_123e4567-e89b-12d3-a456-426614174001";
const state = {
  status: "ready",
  schemaVersion: 2,
  sqliteAvailable: true,
  sources: [
    { sourceId: item.sourceId, label: "Movies", locationHint: "D 盘 · 上级：影片", available: true, itemCount: 34, collectionCount: 12 },
    { sourceId: otherSourceId, label: "Movies", locationHint: "E 盘 · 上级：备份", available: false, itemCount: 9, collectionCount: 4 },
  ],
};

async function run(): Promise<void> {
  await app.whenReady();
  const queries: Array<Record<string, unknown>> = [];
  const artworkRequests: string[] = [];
  const delayedResponses: Array<(value: { dataUrl: string }) => void> = [];
  const cancelledScans: string[] = [];
  const removedSources: string[] = [];
  let refreshedSources: string[] = [];
  let rescanAllCalls = 0;
  let failNextRemove = false;
  let delayNextList = false;
  const scanProgress = (overrides: Record<string, unknown> = {}) => ({
    scanId: "scan_123e4567-e89b-42d3-a456-426614174000",
    sourceId: item.sourceId,
    status: "running",
    scannedFiles: 1_204,
    importedFiles: 986,
    updatedFiles: 18,
    warningCount: 2,
    sourceLabel: "窗口测试文件夹",
    ...overrides,
  });
  const preferences = { volume: 100, muted: false, speed: 1, sort: "recent" };
  ipcMain.handle("local-library:state", async () => state);
  ipcMain.handle("local-library:choose-folder", async () => ({
    status: "completed",
    scanId: "scan_123e4567-e89b-12d3-a456-426614174000",
    sourceId: item.sourceId,
    scannedFiles: 1,
    importedFiles: 1,
    updatedFiles: 0,
    warningCount: 0,
    warnings: [],
  }));
  ipcMain.handle("local-library:source-remove", async (_event, sourceId: string) => {
    if (failNextRemove) {
      failNextRemove = false;
      throw new Error("片库文件暂时被占用，请重试。");
    }
    removedSources.push(sourceId);
    state.sources = state.sources.filter((source) => source.sourceId !== sourceId);
    return state;
  });
  ipcMain.handle("local-library:source-refresh", async (_event, sourceId: string) => {
    refreshedSources.push(sourceId);
    return {
      status: "completed",
      scanId: "scan_123e4567-e89b-42d3-a456-426614174010",
      sourceId,
      sourceLabel: "Movies",
      scannedFiles: 34,
      importedFiles: 0,
      updatedFiles: 34,
      warningCount: 0,
      warnings: [],
    };
  });
  ipcMain.handle("local-library:rescan-all", async () => {
    rescanAllCalls += 1;
    return [{
      status: "unavailable",
      scanId: "scan_123e4567-e89b-42d3-a456-426614174011",
      sourceId: otherSourceId,
      sourceLabel: "Movies",
      scannedFiles: 0,
      importedFiles: 0,
      updatedFiles: 0,
      warningCount: 0,
      warnings: [],
      error: "来源不可用，已保留此前索引和播放历史",
    }];
  });
  ipcMain.handle("local-library:open-video", async () => ({ status: "imported", item, state }));
  ipcMain.handle("local-library:list", async (_event, query) => {
    queries.push((query ?? {}) as Record<string, unknown>);
    if (delayNextList) {
      delayNextList = false;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return { state, page: { query: query ?? { page: 1, pageSize: 50 }, page: 1, pageSize: 50, totalCount: items.length, items } };
  });
  ipcMain.handle("local-library:list-collections", async (_event, query) => {
    queries.push((query ?? {}) as Record<string, unknown>);
    if (delayNextList) {
      delayNextList = false;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const collections = items.map((entry) => ({
      collectionId: `collection_${entry.mediaId}`,
      title: entry.title,
      kind: entry.kind === "movie" || entry.kind === "show" || entry.kind === "unclassified" ? entry.kind : "unclassified",
      premieredDate: null,
      episodeCount: 1,
      watchedEpisodeCount: 0,
      availableEpisodeCount: 1,
      available: true,
      representativeMediaId: entry.mediaId,
      coverMediaId: entry.mediaId,
      ...(entry.artwork ? { artwork: entry.artwork } : {}),
      addedAtMs: 0,
      updatedAtMs: entry.modifiedAtMs,
    }));
    return { state, page: { query: query ?? { page: 1, pageSize: 50 }, page: 1, pageSize: 50, totalCount: collections.length, items: collections } };
  });
  ipcMain.handle("local-library:scan-cancel", async (_event, scanId: string) => {
    cancelledScans.push(scanId);
    return true;
  });
  ipcMain.handle("local-library:get", async (_event, mediaId: string) => ({ state, item: items.find((candidate) => candidate.mediaId === mediaId) }));
  ipcMain.handle("local-library:artwork", async (_event, request: { mediaId: string }) => {
    const { mediaId } = request;
    artworkRequests.push(mediaId);
    if (mediaId === delayed.mediaId) return new Promise<{ dataUrl: string }>((resolve) => { delayedResponses.push(resolve); });
    if (mediaId === good.mediaId) return { dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='18'%3E%3Crect width='12' height='18' fill='red'/%3E%3C/svg%3E" };
    return { dataUrl: "data:image/png;base64,aW52YWxpZA==" };
  });
  ipcMain.handle("local-library:continue-watching", async () => ({ state, items: [] }));
  ipcMain.handle("app-preferences:get", async () => ({ ...preferences }));
  ipcMain.handle("app-preferences:set-sort", async (_event, sort) => ({ ...preferences, sort }));

  const window = new BrowserWindow({
    show: false,
    width: 1040,
    height: 720,
    webPreferences: {
      preload: join(__dirname, "..", "src", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(join(__dirname, "..", "src", "renderer", "index.html"));

  async function waitFor<T>(label: string, read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: T | undefined;
    while (Date.now() < deadline) {
      last = await read();
      if (predicate(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`${label} did not become ready within ${timeoutMs}ms: ${JSON.stringify(last)}`);
  }

  const readInitial = () => window.webContents.executeJavaScript(`({
    bridge: typeof window.zVideo === "object",
    nodeRequire: typeof require,
    nodeProcess: typeof process,
    localApi: typeof window.zVideo.localLibrary === "object",
    loginView: Boolean(document.querySelector('[data-view="login"]')),
    folderButton: Boolean(document.querySelector('#choose-folder-button')),
    openButton: Boolean(document.querySelector('#open-video-button')),
    card: document.querySelector('[data-media-id]')?.textContent || ''
  })`, true) as Promise<{ bridge: boolean; nodeRequire: string; nodeProcess: string; localApi: boolean; loginView: boolean; folderButton: boolean; openButton: boolean; card: string }>;
  const initial = await waitFor("renderer card", readInitial, (value) => value.bridge && Boolean(value.card));

  assert.equal(initial.bridge, true);
  assert.equal(initial.nodeRequire, "undefined");
  assert.equal(initial.nodeProcess, "undefined");
  assert.equal(initial.localApi, true);
  assert.equal(initial.loginView, false);
  assert.equal(initial.folderButton, true);
  assert.equal(initial.openButton, true);
  assert.match(initial.card, /窗口测试影片/);

  // A fanart-only item must render a generated cover without requesting fanart as a poster.
  await window.webContents.executeJavaScript("document.querySelector('[data-media-id=\"media_123e4567-e89b-12d3-a456-426614174004\"]').click()", true);
  await waitFor("fanart-only detail", () => window.webContents.executeJavaScript("document.querySelector('#media-detail-title')?.textContent", true) as Promise<string>, (title) => title === fanartOnly.title);
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('#detail-poster .poster-fallback'))", true), true);
  assert.equal(artworkRequests.includes(fanartOnly.mediaId), false);
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);

  await waitFor("broken card", () => window.webContents.executeJavaScript("Boolean(document.querySelector('[data-media-id=\"media_123e4567-e89b-12d3-a456-426614174001\"]'))", true) as Promise<boolean>, Boolean);
  await window.webContents.executeJavaScript("document.querySelector('[data-media-id=\"media_123e4567-e89b-12d3-a456-426614174001\"]').click()", true);
  await waitFor("broken image decoded", () => window.webContents.executeJavaScript("document.querySelector('#detail-poster')?.dataset.artworkLoading", true) as Promise<string>, (loading) => loading === "false");
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('#detail-poster .poster-fallback'))", true), true);
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);

  await waitFor("delayed card", () => window.webContents.executeJavaScript("Boolean(document.querySelector('[data-media-id=\"media_123e4567-e89b-12d3-a456-426614174002\"]'))", true) as Promise<boolean>, Boolean);
  await window.webContents.executeJavaScript("document.querySelector('[data-media-id=\"media_123e4567-e89b-12d3-a456-426614174002\"]').click()", true);
  await waitFor("delayed artwork request", () => window.webContents.executeJavaScript("document.querySelector('#detail-poster')?.dataset.artworkLoading", true) as Promise<string>, (loading) => loading === "true" && delayedResponses.length > 0);
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  await waitFor("replacement card", () => window.webContents.executeJavaScript("Boolean(document.querySelector('[data-media-id=\"media_123e4567-e89b-12d3-a456-426614174003\"]'))", true) as Promise<boolean>, Boolean);
  await window.webContents.executeJavaScript("document.querySelector('[data-media-id=\"media_123e4567-e89b-12d3-a456-426614174003\"]').click()", true);
  await waitFor("replacement detail", () => window.webContents.executeJavaScript("document.querySelector('#media-detail-title')?.textContent", true) as Promise<string>, (title) => title === replacement.title);
  for (const resolve of delayedResponses) resolve({ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" });
  await window.webContents.executeJavaScript("new Promise(resolve => setTimeout(resolve, 100))", true);
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('#detail-poster .poster-fallback'))", true), true);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#media-detail-title')?.textContent", true), replacement.title);
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  await waitFor("initial card restored", () => window.webContents.executeJavaScript("Boolean(document.querySelector('[data-media-id]'))", true) as Promise<boolean>, Boolean);
  await waitFor("home shelves", () => window.webContents.executeJavaScript(`({ recent: document.querySelector('#recent-row')?.textContent || '', shows: document.querySelector('#shows-row')?.textContent || '' })`, true) as Promise<{ recent: string; shows: string }>, (value) => Boolean(value.recent && value.shows));
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#hero-title')?.textContent", true), item.title);
  const setHero = async (target: typeof item) => {
    items.splice(0, items.length, target as typeof items[number], ...items.filter((value) => value.mediaId !== target.mediaId));
    await window.webContents.executeJavaScript("document.querySelector('[data-nav=home]').click()", true);
    await waitFor("hero item", () => window.webContents.executeJavaScript("document.querySelector('#hero-title')?.textContent", true) as Promise<string>, (title) => title === target.title);
  };
  await setHero(good);
  await waitFor("hero poster loaded", () => window.webContents.executeJavaScript("Boolean(document.querySelector('#hero-poster img'))", true) as Promise<boolean>, Boolean);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#home-hero').style.getPropertyValue('--tone-container')", true), "#f4a07c");
  assert.equal(await window.webContents.executeJavaScript("getComputedStyle(document.querySelector('#hero-poster img')).objectFit", true), "contain");
  await setHero(broken);
  await waitFor("broken hero fallback", () => window.webContents.executeJavaScript("document.querySelector('#hero-poster')?.dataset.artworkLoading", true) as Promise<string>, (loading) => loading === "false");
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('#hero-poster .poster-fallback'))", true), true);
  await setHero(delayed);
  await waitFor("delayed hero", () => window.webContents.executeJavaScript("document.querySelector('#hero-poster')?.dataset.artworkLoading", true) as Promise<string>, (loading) => loading === "true");
  await setHero(replacement);
  const replacementTone = await window.webContents.executeJavaScript("document.querySelector('#home-hero').style.getPropertyValue('--tone-container')", true);
  for (const resolve of delayedResponses) resolve({ dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='18'%3E%3Crect width='12' height='18' fill='red'/%3E%3C/svg%3E" });
  await window.webContents.executeJavaScript("new Promise(resolve => setTimeout(resolve, 100))", true);
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('#hero-poster .poster-fallback'))", true), true);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#hero-title')?.textContent", true), replacement.title);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#home-hero').style.getPropertyValue('--tone-container')", true), replacementTone);
  await setHero(item);
  assert.ok(queries.some((query) => query.sort === "added_desc" && query.pageSize === 12));
  assert.ok(queries.some((query) => query.filter === "show" && query.pageSize === 12));
  await window.webContents.executeJavaScript("document.querySelector('[data-nav=movie]').click()", true);
  await waitFor("movie filter", async () => queries.at(-1)?.filter, (value) => value === "movie");
  await window.webContents.executeJavaScript("document.querySelector('[data-nav=home]').click()", true);

  await window.webContents.send("local-library:scan-progress", scanProgress());
  const readScanState = () => window.webContents.executeJavaScript(`(() => {
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const rect = (selector) => { const element = document.querySelector(selector); const box = element?.getBoundingClientRect(); return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null; };
    const pill = document.querySelector('#scan-status');
    const card = document.querySelector('#home-scan-card');
    const pillCancel = document.querySelector('#scan-pill-cancel');
    const homeCancel = document.querySelector('#home-scan-cancel');
    return {
      viewport,
      pillVisible: Boolean(pill && !pill.hidden && rect('#scan-status')?.right > 0),
      pillText: pill?.textContent || '',
      pillRect: rect('#scan-status'),
      pillCancelVisible: Boolean(pillCancel && !pillCancel.hidden),
      cardVisible: Boolean(card && !card.hidden && rect('#home-scan-card')?.right > 0),
      cardText: card?.textContent || '',
      cardRect: rect('#home-scan-card'),
      cardCancelRect: rect('#home-scan-cancel'),
      homeCancelVisible: Boolean(homeCancel && !homeCancel.hidden),
      noticeVisible: Boolean(document.querySelector('#app-notice') && !document.querySelector('#app-notice').hidden),
      noticeTitle: document.querySelector('#app-notice-title')?.textContent || '',
      noticeText: document.querySelector('#app-notice')?.textContent || '',
      skeletons: document.querySelectorAll('#library-grid .media-skeleton').length,
      cards: document.querySelectorAll('#library-grid .media-card').length,
      busy: document.querySelector('#library-grid')?.getAttribute('aria-busy'),
      cardHidden: document.querySelector('#home-scan-card')?.hidden,
      pillHidden: document.querySelector('#scan-status')?.hidden,
    };
  })()`, true) as Promise<any>;
  const assertInside = (label: string, rect: { left: number; right: number; top: number; bottom: number } | null, viewport: { width: number; height: number }) => {
    assert.ok(rect, `${label} has a layout box`);
    assert.ok(rect!.left >= 0 && rect!.right <= viewport.width + 1 && rect!.top >= 0 && rect!.bottom <= viewport.height + 1, `${label} stays inside ${viewport.width}x${viewport.height}: ${JSON.stringify(rect)}`);
  };
  const runningScan = await waitFor("running scan pill and home scan card", readScanState, (value) => value.pillVisible && value.cardVisible);
  assert.match(runningScan.pillText, /扫描中/);
  assert.match(runningScan.pillText, /1204/);
  assert.match(runningScan.cardText, /窗口测试文件夹/);
  assert.match(runningScan.cardText, /已扫描/);
  assert.match(runningScan.cardText, /已加入/);
  assert.match(runningScan.cardText, /已用时间/);
  assert.doesNotMatch(runningScan.cardText, /%/);
  assert.equal(runningScan.homeCancelVisible, true);
  assert.equal(runningScan.pillCancelVisible, true);
  assertInside("default-width scan pill", runningScan.pillRect, runningScan.viewport);
  assertInside("default-width home scan card", runningScan.cardRect, runningScan.viewport);
  assertInside("default-width home scan cancel", runningScan.cardCancelRect, runningScan.viewport);

  window.setSize(900, 640);
  const compactScan = await waitFor("compact scan layout", readScanState, (value) => value.viewport.width <= 905 && value.pillVisible && value.cardVisible);
  assertInside("900px scan pill", compactScan.pillRect, compactScan.viewport);
  assertInside("900px home scan card", compactScan.cardRect, compactScan.viewport);
  assertInside("900px home scan cancel", compactScan.cardCancelRect, compactScan.viewport);
  window.setSize(1040, 720);
  await waitFor("default size restored", readScanState, (value) => value.viewport.width > 1000);

  await window.webContents.executeJavaScript("document.querySelector('#home-scan-cancel').click()", true);
  await waitFor("home cancel invokes scan cancel", async () => cancelledScans.length, (count) => count === 1);
  assert.equal(cancelledScans[0], scanProgress().scanId);
  window.webContents.send("local-library:scan-progress", scanProgress({ status: "cancelled", error: "扫描已取消，已保留此前索引和播放历史" }));
  const cancelledNotice = await waitFor("cancelled scan notice", readScanState, (value) => value.noticeVisible && /扫描已取消/.test(value.noticeTitle));
  assert.match(cancelledNotice.noticeText, /保留/);
  assert.equal(cancelledNotice.cardHidden, true);
  assert.equal(cancelledNotice.pillHidden, true);
  await window.webContents.executeJavaScript("document.querySelector('#app-notice-close').click()", true);
  await waitFor("cancelled notice dismissed", readScanState, (value) => value.noticeVisible === false);

  window.webContents.send("local-library:scan-progress", scanProgress({ scanId: "scan_123e4567-e89b-42d3-a456-426614174001" }));
  await waitFor("second running scan", readScanState, (value) => value.pillVisible && value.cardVisible);
  await window.webContents.executeJavaScript("document.querySelector('#scan-pill-cancel').click()", true);
  await waitFor("topbar cancel invokes scan cancel", async () => cancelledScans.length, (count) => count === 2);
  assert.equal(cancelledScans[1], "scan_123e4567-e89b-42d3-a456-426614174001");
  window.webContents.send("local-library:scan-progress", scanProgress({ scanId: "scan_123e4567-e89b-42d3-a456-426614174001", status: "cancelled", error: "扫描已取消，已保留此前索引和播放历史" }));
  await waitFor("second cancelled notice", readScanState, (value) => value.noticeVisible && /扫描已取消/.test(value.noticeTitle));
  await window.webContents.executeJavaScript("document.querySelector('#app-notice-close').click()", true);

  window.webContents.send("local-library:scan-progress", scanProgress({ scanId: "scan_123e4567-e89b-42d3-a456-426614174002" }));
  await waitFor("completing scan running", readScanState, (value) => value.pillVisible && value.cardVisible);
  window.webContents.send("local-library:scan-progress", scanProgress({ scanId: "scan_123e4567-e89b-42d3-a456-426614174002", status: "completed" }));
  const completedNotice = await waitFor("completed scan summary", readScanState, (value) => value.noticeVisible && /扫描完成/.test(value.noticeTitle));
  assert.match(completedNotice.noticeText, /新增 986/);
  assert.match(completedNotice.noticeText, /更新 18/);
  assert.match(completedNotice.noticeText, /2 条警告/);
  assert.equal(completedNotice.cardHidden, true);
  assert.equal(completedNotice.pillHidden, true);

  delayNextList = true;
  await window.webContents.executeJavaScript("document.querySelector('#library-filter-buttons [data-filter=movie]').click()", true);
  const refreshing = await waitFor("later library refresh without skeleton", readScanState, (value) => value.busy === "true");
  assert.equal(refreshing.skeletons, 0, "only the first list load may replace the grid with skeletons");
  assert.ok(refreshing.cards > 0, "later list refreshes keep existing cards on screen");
  assert.equal(refreshing.noticeText, completedNotice.noticeText, "list refresh does not overwrite the scan summary");
  await waitFor("refreshed list settled", readScanState, (value) => !value.busy);
  await window.webContents.executeJavaScript("document.querySelector('#app-notice-close').click()", true);
  await waitFor("completed notice dismissed", readScanState, (value) => value.noticeVisible === false);

  await window.webContents.executeJavaScript("document.querySelector('[data-media-id]').click()", true);
  const detail = await waitFor("detail view", () => window.webContents.executeJavaScript(`({ hidden: document.querySelector('#media-detail')?.hidden, title: document.querySelector('#media-detail-title')?.textContent || '' })`, true) as Promise<{ hidden: boolean; title: string }>, (value) => value.hidden === false && Boolean(value.title));
  assert.equal(detail.hidden, false);
  assert.equal(detail.title, "窗口测试影片");

  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  await window.webContents.executeJavaScript("document.querySelector('#library-search-input').value = '窗口'; document.querySelector('#library-search-input').dispatchEvent(new Event('input', { bubbles: true }))", true);
  await waitFor("search query", async () => queries.at(-1)?.query, (value) => value === "窗口");
  assert.equal(queries.at(-1)?.query, "窗口");

  await window.webContents.executeJavaScript("document.querySelector('[data-nav=folder]').click()", true);
  const readFolders = () => window.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('#source-list [data-source-card-id]')].map((card) => ({
      text: card.textContent || '',
      sourceId: card.dataset.sourceCardId || '',
      available: card.dataset.available !== 'false',
    }));
    return {
      visible: document.querySelector('#sources-page')?.hidden === false,
      navCurrent: document.querySelector('[data-nav=folder]')?.getAttribute('aria-current') || '',
      cards,
      removeOpen: document.querySelector('#remove-source-dialog')?.open === true,
      offlineOpen: document.querySelector('#offline-source-dialog')?.open === true,
      removeCopy: document.querySelector('#remove-source-copy')?.textContent || '',
      removeTitle: document.querySelector('#remove-source-title')?.textContent || '',
      removeConfirmText: document.querySelector('#remove-source-confirm')?.textContent || '',
      removeConfirmClass: document.querySelector('#remove-source-confirm')?.className || '',
      removeError: document.querySelector('#remove-source-error')?.textContent || '',
      removeErrorHidden: document.querySelector('#remove-source-error')?.hidden !== false,
      offlineTitle: document.querySelector('#offline-source-title')?.textContent || '',
      offlineCopy: document.querySelector('#offline-source-copy')?.textContent || '',
      offlineError: document.querySelector('#offline-source-error')?.textContent || '',
      activeId: document.activeElement?.id || '',
      noticeTitle: document.querySelector('#app-notice-title')?.textContent || '',
    };
  })()`, true) as Promise<any>;

  const folderPage = await waitFor("folder page with distinct same-name folders", readFolders, (value) => value.visible && value.navCurrent === "page" && value.cards.length === 2);
  assert.match(folderPage.cards[0].text, /12 部作品/);
  assert.match(folderPage.cards[0].text, /34 集/);
  assert.match(folderPage.cards[0].text, /D 盘 · 上级：影片/);
  assert.match(folderPage.cards[0].text, /可用/);
  assert.match(folderPage.cards[1].text, /4 部作品/);
  assert.match(folderPage.cards[1].text, /9 集/);
  assert.match(folderPage.cards[1].text, /E 盘 · 上级：备份/);
  assert.match(folderPage.cards[1].text, /离线/);
  assert.equal(folderPage.cards[1].available, false);

  await window.webContents.executeJavaScript("document.querySelector('#open-video-button').click()", true);
  const singleVideo = await waitFor("single-video folder note", readFolders, (value) => /由添加单个视频登记/.test(value.cards[0]?.text || ""));
  assert.match(singleVideo.cards[0].text, /重新扫描会把整个文件夹/);
  assert.match(await window.webContents.executeJavaScript("document.querySelector('#app-notice').textContent", true), /登记为片库文件夹/);
  await waitFor("single-video import settles", () => window.webContents.executeJavaScript("document.querySelector('#open-video-button').disabled", true) as Promise<boolean>, (disabled) => disabled === false);

  await window.webContents.executeJavaScript("document.querySelector('[data-refresh-source-id]').click()", true);
  await waitFor("single-folder rescan", async () => refreshedSources, (value) => value.includes(item.sourceId));
  await waitFor("single-folder rescan settles", () => window.webContents.executeJavaScript("document.querySelector('#rescan-all-button').disabled", true) as Promise<boolean>, (disabled) => disabled === false);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#offline-source-dialog').open", true), false, "a readable folder never asks the offline question");

  await window.webContents.executeJavaScript("document.querySelector('#rescan-all-button').click()", true);
  const offlinePrompt = await waitFor("offline source question", readFolders, (value) => value.offlineOpen === true);
  assert.equal(rescanAllCalls, 1);
  assert.match(offlinePrompt.offlineTitle, /Movies/);
  assert.match(offlinePrompt.offlineCopy, /4 部作品、9 集/);
  assert.match(offlinePrompt.offlineCopy, /暂时断开/);
  assert.match(offlinePrompt.offlineCopy, /已删除/);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#offline-source-keep').textContent", true), "暂时断开（保留记录）");
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#offline-source-delete').textContent", true), "已删除（清理记录）");
  assert.equal(offlinePrompt.activeId, "offline-source-keep");
  await window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))", true);
  await waitFor("offline question dismissed by Esc", readFolders, (value) => value.offlineOpen === false);
  assert.equal((await readFolders()).cards.length, 2, "temporarily disconnecting keeps the folder record");
  assert.match((await readFolders()).cards[1].text, /4 部作品/);

  await window.webContents.executeJavaScript("document.querySelector('#rescan-all-button').click()", true);
  await waitFor("offline source question again", readFolders, (value) => value.offlineOpen === true);
  await window.webContents.executeJavaScript("document.querySelector('#offline-source-delete').click()", true);
  const deletedOffline = await waitFor("confirmed deletion cleans the offline folder", readFolders, (value) => value.offlineOpen === false && value.cards.length === 1);
  assert.equal(removedSources.includes(otherSourceId), true, "only the confirmed-deleted folder is removed");
  assert.match(deletedOffline.cards[0].text, /D 盘/u);

  await window.webContents.executeJavaScript("document.querySelector('[data-remove-source-id]').click()", true);
  const removeDialog = await waitFor("remove dialog", readFolders, (value) => value.removeOpen === true);
  assert.match(removeDialog.removeTitle, /移除「Movies」/);
  assert.match(removeDialog.removeCopy, /12 部作品、34 集/);
  assert.match(removeDialog.removeCopy, /观看进度/);
  assert.match(removeDialog.removeCopy, /不会删除源文件/);
  assert.match(removeDialog.removeConfirmClass, /destructive-button/);
  assert.equal(removeDialog.removeConfirmText, "移除并删除进度");
  assert.equal(removeDialog.activeId, "remove-source-cancel", "cancel owns the default focus");
  await window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))", true);
  await waitFor("remove dialog dismissed by Esc", readFolders, (value) => value.removeOpen === false);
  assert.equal((await readFolders()).cards.length, 1, "Esc cancels without removing the folder");

  await window.webContents.executeJavaScript("document.querySelector('[data-remove-source-id]').click()", true);
  await waitFor("remove dialog reopened", readFolders, (value) => value.removeOpen === true);
  failNextRemove = true;
  await window.webContents.executeJavaScript("document.querySelector('#remove-source-confirm').click()", true);
  const removeFailure = await waitFor("remove failure stays inside the dialog", readFolders, (value) => !value.removeErrorHidden && value.removeOpen === true);
  assert.match(removeFailure.removeError, /占用|重试/);
  assert.equal(removeFailure.removeConfirmText, "重试移除");
  assert.equal(removeFailure.cards.length, 1, "a failed removal leaves the folder record unchanged");
  await window.webContents.executeJavaScript("document.querySelector('#remove-source-confirm').click()", true);
  const removed = await waitFor("remove retry succeeds", readFolders, (value) => value.removeOpen === false && value.cards.length === 0);
  assert.equal(removedSources.includes(item.sourceId), true);
  assert.match(await window.webContents.executeJavaScript("document.querySelector('#app-notice').textContent", true), /源文件没有被删除/);

  window.close();
  for (const channel of ["local-library:state", "local-library:source-remove", "local-library:source-refresh", "local-library:rescan-all", "local-library:choose-folder", "local-library:open-video", "local-library:list", "local-library:list-collections", "local-library:scan-cancel", "local-library:get", "local-library:artwork", "local-library:continue-watching", "app-preferences:get", "app-preferences:set-sort"]) ipcMain.removeHandler(channel);
}

run().then(() => app.quit()).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
