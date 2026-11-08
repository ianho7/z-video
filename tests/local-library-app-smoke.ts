import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { IPC_CHANNELS } from "../src/shared/ipc-channels";

const LONG_TITLE = "Owned UX Audit Feature Film 2026 — Long Detail Title";
const LONG_PLOT = "海边小城的旧电影院迎来新经理，他计划修复影厅并重新放映。".repeat(6);
const INDEX_FILE_COUNT = 8_000;
const APP_TIMEOUT_MS = 100_000;
let appDeadline = 0;
let delayNextLibraryList = false;
const originalIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalIpcHandle(channel, async (event, ...args) => {
  if (channel === IPC_CHANNELS.localLibraryList && delayNextLibraryList) {
    delayNextLibraryList = false;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return listener(event, ...args);
});

async function createFixture(profile: string): Promise<string> {
  const root = join(profile, "owned-fixture");
  const indexRoot = join(root, "zz-index");
  await mkdir(indexRoot, { recursive: true });
  await copyFile(join(process.cwd(), "assets", "test_video.mp4"), join(root, "00-owned-feature.mp4"));
  const featureNfo = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<movie>",
    "  <title>" + LONG_TITLE + "</title>",
    "  <year>2026</year>",
    "  <premiered>2026-02-14</premiered>",
    "  <rating>8.7</rating>",
    "  <genre>Drama</genre>",
    "  <plot>" + LONG_PLOT + "</plot>",
    "</movie>",
    "",
  ].join("\n");
  await writeFile(join(root, "00-owned-feature.nfo"), featureNfo, "utf8");

  const showRoot = join(root, "owned-show");
  await mkdir(showRoot);
  await writeFile(join(showRoot, "tvshow.nfo"), "<tvshow><title>Owned Next Show</title><premiered>2025-09-01</premiered></tvshow>");
  for (const number of [1, 2, 3]) {
    const stem = `Owned Next Show - S01E0${number}`;
    await copyFile(join(process.cwd(), "assets", "test_video.mp4"), join(showRoot, stem + ".mp4"));
    await writeFile(join(showRoot, stem + ".nfo"), `<episodedetails><title>Next Episode ${number}</title><season>1</season><episode>${number}</episode></episodedetails>`);
  }

  const batchSize = 100;
  for (let first = 0; first < INDEX_FILE_COUNT; first += batchSize) {
    const directory = join(indexRoot, "batch-" + String(first / batchSize).padStart(3, "0"));
    await mkdir(directory, { recursive: true });
    const count = Math.min(batchSize, INDEX_FILE_COUNT - first);
    await Promise.all(Array.from({ length: count }, (_, offset) => {
      const stem = "index-" + String(first + offset).padStart(5, "0");
      return Promise.all([
        writeFile(join(directory, stem + ".mkv"), new Uint8Array(0)),
        writeFile(join(directory, stem + ".nfo"), "<movie><title>Index fixture " + stem + "</title></movie>", "utf8"),
      ]);
    }));
  }
  return root;
}

function evaluate<T = any>(window: BrowserWindow, script: string): Promise<T> {
  return window.webContents.executeJavaScript(script, true) as Promise<T>;
}

async function waitFor<T>(label: string, read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Math.min(Date.now() + timeoutMs, appDeadline);
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(label + " did not become ready within " + timeoutMs + "ms: " + JSON.stringify(last));
}

async function waitForProductionWindow(): Promise<BrowserWindow> {
  const deadline = Math.min(Date.now() + 15_000, appDeadline);
  await app.whenReady();
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window && !window.isDestroyed() && window.webContents.getURL().endsWith("/index.html")) return window;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("production main did not create a renderer window");
}

async function quitProductionApp(): Promise<void> {
  if (!app.isReady()) return;
  await new Promise<void>((resolve) => {
    app.once("will-quit", () => resolve());
    app.quit();
  });
}

async function run(): Promise<void> {
  const profile = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "z-video-local-app-ux-"));
  const logDir = join(profile, "logs");
  const fixtureRoot = await createFixture(profile);
  const originalShowOpenDialog = dialog.showOpenDialog;
  process.env.Z_VIDEO_LOG_DIR = logDir;
  app.setPath("userData", profile);
  app.setPath("sessionData", join(profile, "session"));
  appDeadline = Date.now() + APP_TIMEOUT_MS;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtureRoot] });

  try {
    require("../src/main/main.js");
    const window = await waitForProductionWindow();
    // CI/automation desktop may mark the test window occluded despite focus.
    window.webContents.setBackgroundThrottling(false);
    assert.equal(window.isMenuBarVisible(), false);
    await evaluate(window, "document.querySelector('[data-window-action=maximize]').click()");
    await waitFor("custom maximize", async () => window.isMaximized(), Boolean);
    await waitFor("restore label", () => evaluate(window, "document.querySelector('[data-window-action=maximize]').getAttribute('aria-label')"), (label) => label === "还原窗口");
    await evaluate(window, "document.querySelector('[data-window-action=maximize]').click()");
    await waitFor("custom restore", async () => window.isMaximized(), (maximized) => !maximized);
    await waitFor("maximize label", () => evaluate(window, "document.querySelector('[data-window-action=maximize]').getAttribute('aria-label')"), (label) => label === "最大化窗口");
    await evaluate(window, "document.querySelector('[data-window-action=minimize]').click()");
    await waitFor("custom minimize", async () => window.isMinimized(), Boolean);
    window.restore();

    const initial = await waitFor(
      "fresh local-library empty state",
      () => evaluate(window, "({ localApi: typeof window.zVideo.localLibrary === 'object', emptyTitle: document.querySelector('#library-empty-title')?.textContent || '', sourceText: document.querySelector('#source-list')?.textContent || '' })"),
      (value) => value.localApi && value.emptyTitle.length > 0,
    );
    assert.equal(initial.localApi, true);
    const capture = async (name: string): Promise<void> => { if (process.env.Z_VIDEO_CAPTURE_DIR) { await mkdir(process.env.Z_VIDEO_CAPTURE_DIR, { recursive: true }); await new Promise((resolve) => setTimeout(resolve, 150)); await writeFile(join(process.env.Z_VIDEO_CAPTURE_DIR, `${name}.png`), (await window.webContents.capturePage()).toPNG()); } };
    await waitFor("onboarding visible", () => evaluate(window, "document.querySelector('#onboarding')?.hidden === false"), Boolean);
    await capture("onboarding");

    window.webContents.send(IPC_CHANNELS.localLibraryState, { status: "error", schemaVersion: 2, sqliteAvailable: false, sources: [], error: { code: "storage", message: "片库暂时不可用" } });
    const errorState = await waitFor("library error card", () => evaluate(window, `({ visible: !document.querySelector('#library-error').hidden, text: document.querySelector('#library-error').textContent, buttons: [...document.querySelectorAll('#library-error button')].map(button => button.textContent) })`), (value) => value.visible);
    await capture("error");
    assert.match(errorState.text, /storage/);
    assert.deepEqual(errorState.buttons, ["重试"]);
    await evaluate(window, "document.querySelector('#library-error-retry').click()");
    await waitFor("library retry", () => evaluate(window, "document.querySelector('#library-error').hidden"), (hidden) => hidden === true);

    const readScanUi = () => evaluate(window, `(() => {
      const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
      const rect = (selector) => { const element = document.querySelector(selector); const box = element?.getBoundingClientRect(); return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null; };
      const pill = document.querySelector('#scan-status');
      const card = document.querySelector('#home-scan-card');
      const pillCancel = document.querySelector('#scan-pill-cancel');
      const homeCancel = document.querySelector('#home-scan-cancel');
      const scope = document.querySelector('#page-scope')?.textContent || '';
      return {
        viewport,
        pillVisible: Boolean(pill && !pill.hidden && rect('#scan-status')?.right > 0),
        pillText: pill?.textContent || '',
        pillRect: rect('#scan-status'),
        pillCancelVisible: Boolean(pillCancel && !pillCancel.hidden && rect('#scan-pill-cancel')?.right > 0),
        pillCancelDisabled: Boolean(pillCancel && pillCancel.disabled),
        cardVisible: Boolean(card && !card.hidden && rect('#home-scan-card')?.right > 0),
        cardText: card?.textContent || '',
        cardRect: rect('#home-scan-card'),
        cardCancelRect: rect('#home-scan-cancel'),
        homeCancelVisible: Boolean(homeCancel && !homeCancel.hidden && rect('#home-scan-cancel')?.right > 0),
        onboardingVisible: document.querySelector('#onboarding')?.hidden === false,
        noticeVisible: document.querySelector('#app-notice')?.hidden === false,
        noticeTitle: document.querySelector('#app-notice-title')?.textContent || '',
        noticeText: document.querySelector('#app-notice')?.textContent || '',
        noticeRect: rect('#app-notice'),
        cardHidden: card?.hidden,
        pillHidden: pill?.hidden,
        cards: document.querySelectorAll('#library-grid .media-card').length,
        skeletons: document.querySelectorAll('#library-grid .media-skeleton').length,
        busy: document.querySelector('#library-grid')?.getAttribute('aria-busy'),
        pageTotal: Number(scope.match(/\\d+/)?.[0] || 0),
        scanPanelTitle: document.querySelector('#scan-panel-title')?.textContent || '',
      };
    })()`);
    const assertInside = (label: string, rect: { left: number; right: number; top: number; bottom: number } | null, viewport: { width: number; height: number }) => {
      assert.ok(rect, `${label} has a layout box`);
      assert.ok(rect!.left >= 0 && rect!.right <= viewport.width + 1 && rect!.top >= 0 && rect!.bottom <= viewport.height + 1, `${label} stays inside ${viewport.width}x${viewport.height}: ${JSON.stringify(rect)}`);
    };

    window.setSize(1040, 720);
    const defaultOuter = window.getSize();
    assert.ok(defaultOuter[0] >= 1040 && defaultOuter[1] >= 720);

    await evaluate(window, "document.querySelector('#choose-folder-button')?.click()");
    const firstRunning = await waitFor("first scan visible with welcome card", readScanUi, (value) => value.pillVisible && value.cardVisible && value.onboardingVisible && value.cards === 0 && /owned-fixture/.test(value.cardText), 20_000);
    assert.match(firstRunning.pillText, /扫描中/);
    assert.match(firstRunning.cardText, /owned-fixture/);
    assert.equal(firstRunning.cardText.includes(fixtureRoot), false, "scan status never exposes the source root path");
    assert.match(firstRunning.cardText, /已扫描/);
    assert.match(firstRunning.cardText, /已加入/);
    assert.match(firstRunning.cardText, /已用时间/);
    assert.doesNotMatch(firstRunning.cardText, /%/);
    assert.equal(firstRunning.pillCancelVisible, true);
    assert.equal(firstRunning.homeCancelVisible, true);
    assertInside("1040 scan pill", firstRunning.pillRect, firstRunning.viewport);
    assertInside("1040 home scan card", firstRunning.cardRect, firstRunning.viewport);
    assertInside("1040 home scan cancel", firstRunning.cardCancelRect, firstRunning.viewport);
    await capture("first-scan");

    await evaluate(window, "document.querySelector('#manage-sources-button')?.click()");
    await waitFor("scan panel running", readScanUi, (value) => value.scanPanelTitle.includes("正在扫描"));
    await capture("scan");
    await evaluate(window, "document.querySelector('[data-nav=home]')?.click()");
    await waitFor("home scan card after sources page", readScanUi, (value) => value.cardVisible);

    const firstContent = await waitFor("first content appears during scan", readScanUi, (value) => value.cards > 0, 20_000);
    assert.ok(firstContent.pageTotal > 0);
    assert.equal(await evaluate(window, "(() => { const card = document.querySelector('#library-grid .media-card'); if (!card) return false; card.dataset.scanProbe = 'kept'; return true; })()"), true);
    await waitFor("welcome card retires after first content", readScanUi, (value) => value.onboardingVisible === false);

    await evaluate(window, "document.querySelector('#scan-pill-cancel')?.click()");
    const cancelled = await waitFor("cancelled scan summary", readScanUi, (value) => value.noticeVisible && /扫描已取消/.test(value.noticeTitle), 20_000);
    assert.match(cancelled.noticeText, /保留/);
    assert.equal(cancelled.cardHidden, true);
    assert.equal(cancelled.pillHidden, true);
    const preserved = await waitFor("cancelled scan keeps the partial index", readScanUi, (value) => value.pageTotal > 0 && value.cards > 0);
    assert.ok(preserved.pageTotal > 0);
    assert.equal(await evaluate(window, "Boolean(document.querySelector('#library-grid [data-scan-probe=kept]'))"), true, "scan refresh reuses existing cards instead of replacing the grid");
    await evaluate(window, "document.querySelector('#app-notice-close')?.click()");
    await waitFor("cancelled notice dismissed", readScanUi, (value) => value.noticeVisible === false);

    await evaluate(window, "document.querySelector('#choose-folder-button')?.click()");
    const secondRunning = await waitFor("second scan running", readScanUi, (value) => value.pillVisible && value.cardVisible && /owned-fixture/.test(value.cardText), 20_000);
    assert.match(secondRunning.cardText, /owned-fixture/);
    window.setSize(900, 640);
    const compactScan = await waitFor("second scan at 900x640", readScanUi, (value) => value.viewport.width <= 900 && value.pillVisible && value.cardVisible);
    assertInside("900 scan pill", compactScan.pillRect, compactScan.viewport);
    assertInside("900 home scan card", compactScan.cardRect, compactScan.viewport);
    assertInside("900 home scan cancel", compactScan.cardCancelRect, compactScan.viewport);

    const complete = await waitFor("completed scan summary", readScanUi, (value) => value.noticeVisible && /扫描完成/.test(value.noticeTitle), 40_000);
    assert.match(complete.noticeText, /新增/);
    assert.match(complete.noticeText, /更新/);
    assert.match(complete.noticeText, /警告/);
    assertInside("900 scan summary notice", complete.noticeRect, complete.viewport);
    const completedTotal = await waitFor("completed scan index count", readScanUi, (value) => value.pageTotal >= INDEX_FILE_COUNT + 1, 20_000);
    assert.ok(completedTotal.pageTotal >= INDEX_FILE_COUNT + 1, `completed scan indexes the fixture: ${completedTotal.pageTotal}`);
    const summaryText = complete.noticeText;

    delayNextLibraryList = true;
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=movie]')?.click()");
    const loading = await waitFor("later library refresh without skeleton", readScanUi, (value) => value.busy === "true");
    assert.equal(loading.skeletons, 0, "only the first list load replaces the grid with skeletons");
    assert.ok(loading.cards > 0, "later list refreshes keep the existing cards on screen");
    assert.equal(loading.noticeText, summaryText, "list refresh does not overwrite the scan summary");
    await waitFor("movie list after refresh", readScanUi, (value) => !value.busy);
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=all]')?.click()");
    await waitFor("all media after refresh", readScanUi, (value) => !value.busy);
    window.setSize(1040, 720);
    const wideNotice = await waitFor("scan summary at 1040", readScanUi, (value) => value.viewport.width > 1000 && value.noticeVisible && value.noticeText === summaryText);
    assertInside("1040 scan summary notice", wideNotice.noticeRect, wideNotice.viewport);
    await evaluate(window, "document.querySelector('#app-notice-close')?.click()");
    await waitFor("completed notice dismissed", readScanUi, (value) => value.noticeVisible === false);

    await evaluate(window, "document.querySelector('[data-nav=all]')?.click()");
    await waitFor("visible all-media page", () => evaluate(window, "document.querySelector('#collection-section')?.hidden"), (hidden) => hidden === false);
    await waitFor("all navigation active", () => evaluate(window, "document.querySelector('[data-nav=all]')?.getAttribute('aria-current')"), (value) => value === "page");
    await capture("all");
    const sortMenu = await evaluate(window, "(() => { const select = document.querySelector('#library-sort'); return { options: [...select.options].map((option) => ({ value: option.value, label: option.textContent })), value: select.value }; })()");
    assert.ok(sortMenu.options.some((option: { value: string; label: string }) => option.value === "released_desc" && option.label === "最近发布"), "sort menu exposes 最近发布");
    await evaluate(window, "(() => { const select = document.querySelector('#library-sort'); select.value = 'released_desc'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
    const released = await waitFor(
      "released_desc ordering",
      () => evaluate(window, "(() => { const cards = [...document.querySelectorAll('#library-grid .media-card')]; return { value: document.querySelector('#library-sort')?.value, firstTitle: cards[0]?.querySelector('.media-card-title')?.textContent || '', firstMeta: cards[0]?.querySelector('.media-card-meta')?.textContent || '', secondMeta: cards[1]?.querySelector('.media-card-meta')?.textContent || '' }; })()"),
      (value) => value.value === "released_desc" && value.firstTitle === LONG_TITLE,
    );
    assert.match(released.firstMeta, /2026-02-14/, "dated work shows its real NFO premiere date");
    assert.match(released.secondMeta, /2025-09-01/, "dated show ranks after the newer movie");
    await evaluate(window, "(() => { const input = document.querySelector('#library-search-input'); if (!(input instanceof HTMLInputElement)) throw new Error('search missing'); input.value = 'Index fixture index-00000'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    const unknownDate = await waitFor(
      "unknown premiere date label",
      () => evaluate(window, "document.querySelector('#library-grid .media-card-meta')?.textContent || ''"),
      (meta) => meta.includes("发布日期未知"),
    );
    assert.match(unknownDate, /发布日期未知/);
    assert.doesNotMatch(unknownDate, /发布日期 (19|20)\d{2}/, "a year is never shown as a premiere date");
    await evaluate(window, "document.querySelector('#library-search-clear')?.click()");
    // The search input debounce outlives the clear click; let it settle before
    // restoring the sort so it cannot reset the later pagination step.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await evaluate(window, "(() => { const select = document.querySelector('#library-sort'); select.value = 'recent'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await waitFor("sort restored", () => evaluate(window, "document.querySelector('#library-sort')?.value"), (value) => value === "recent");
    await waitFor("library settled after sort restore", () => evaluate(window, "document.querySelector('#library-grid')?.getAttribute('aria-busy')"), (value) => value === null);
    await evaluate(window, "document.querySelector('#manage-sources-button')?.click()");
    await waitFor("sources visible", () => evaluate(window, "document.querySelector('#source-list')?.getBoundingClientRect().width > 0"), Boolean);
    await capture("sources");
    await evaluate(window, "document.querySelector('[data-nav=all]')?.click()");
    await evaluate(window, "document.querySelector('#library-pagination button:last-child')?.click()");
    const pageTwo = await waitFor(
      "second library page",
      () => evaluate(window, "({ scope: document.querySelector('#page-scope')?.textContent || '', mediaId: document.querySelector('#library-grid [data-media-id]')?.dataset.mediaId || '', title: document.querySelector('#library-grid .media-card-title')?.textContent || '' })"),
      (value) => value.scope.includes("第 2 页") && Boolean(value.mediaId && value.title),
    );
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    await waitFor("second-page detail", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === false);
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    const restoredPage = await waitFor(
      "restored second page and focus",
      () => evaluate(window, "({ scope: document.querySelector('#page-scope')?.textContent || '', activeMediaId: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.mediaId || '' : '' })"),
      (value) => value.scope.includes("第 2 页") && value.activeMediaId === pageTwo.mediaId,
    );
    assert.equal(restoredPage.activeMediaId, pageTwo.mediaId);
    await evaluate(window, "(() => { const search = document.querySelector('#library-search-input'); if (!(search instanceof HTMLInputElement)) throw new Error('search missing'); search.value = 'Next Episode 1'; search.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor("episode search", () => evaluate(window, "document.querySelector('#library-grid .media-card-title')?.textContent || ''"), (title) => title === "Next Episode 1");
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    await waitFor("episode detail", () => evaluate(window, "document.querySelector('#media-detail-open')?.disabled === false"), Boolean);
    await waitFor("episode detail title", () => evaluate(window, "document.querySelector('#media-detail-title')?.textContent"), (title) => title === "Owned Next Show");
    await capture("episode-detail");
    await evaluate(window, "document.querySelector('#media-detail-open')?.click()");
    await waitFor("episode playback", () => evaluate(window, "document.querySelector('#player-toggle-button')?.disabled === false"), Boolean);
    await capture("player");
    await evaluate(window, "document.querySelector('#player-settings-button')?.click()");
    await waitFor("player settings visible", () => evaluate(window, "document.querySelector('#player-settings')?.hidden === false"), Boolean);
    await capture("player-menu");
    await evaluate(window, "document.querySelector('#player-settings-close')?.click()");
    await evaluate(window, "window.zVideo.localPlayback.command({ type: 'pause' })");
    await waitFor("episode paused", () => evaluate(window, "document.querySelector('#player-toggle-button')?.textContent"), (text) => text === "播放");
    window.webContents.send("local-playback:event", { type: "state", state: "ended" });
    await waitFor("next episode prompt", () => evaluate(window, "document.querySelector('#player-ended')?.hidden === false"), Boolean);
    await capture("next-episode");
    await evaluate(window, "document.querySelector('#player-cancel-next')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 10_500));
    assert.equal(await evaluate(window, "document.querySelector('#player-current-title')?.textContent"), "Next Episode 1", "cancel prevents automatic playback");
    window.webContents.send("local-playback:event", { type: "state", state: "playing" });
    window.webContents.send("local-playback:event", { type: "state", state: "ended" });
    await evaluate(window, "document.querySelector('#player-play-next')?.click()");
    await waitFor("next episode opened", () => evaluate(window, "document.querySelector('#player-current-title')?.textContent"), (title) => title === "Next Episode 2");
    await evaluate(window, "document.querySelector('#player-close-button')?.click()");
    await waitFor("player closed", () => evaluate(window, "document.querySelector('[data-view=player]')?.hidden"), Boolean);

    await evaluate(window, "(() => { const search = document.querySelector('#library-search-input'); if (!(search instanceof HTMLInputElement)) throw new Error('search missing'); search.value = 'Owned UX Audit Feature Film 2026'; search.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor("long title card", () => evaluate(window, "document.querySelector('#library-grid .media-card-title')?.textContent || ''"), (value) => value === LONG_TITLE);
    const openedMediaId = await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.dataset.mediaId || ''");
    assert.ok(openedMediaId, "search result exposes an openable movie card");
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=show]')?.click()");
    await waitFor("filtered search empty state", () => evaluate(window, "({ title: document.querySelector('#library-empty-title')?.textContent || '', actionHidden: document.querySelector('#search-all-types-button')?.hidden, filter: document.querySelector('#library-filter')?.value, query: document.querySelector('#library-search-input')?.value })"), (value) => value.title === "没有匹配结果" && value.actionHidden === false && value.filter === "show" && value.query === "Owned UX Audit Feature Film 2026");
    await evaluate(window, "document.querySelector('#search-all-types-button')?.click()");
    await waitFor("search all media keeps query", () => evaluate(window, "({ title: document.querySelector('#library-grid .media-card-title')?.textContent || '', filter: document.querySelector('#library-filter')?.value, query: document.querySelector('#library-search-input')?.value })"), (value) => value.title === LONG_TITLE && value.filter === "all" && value.query === "Owned UX Audit Feature Film 2026");
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");

    const detail = await waitFor(
      "long detail view",
      () => evaluate(window, "(() => { const button = document.querySelector('#media-detail-open')?.getBoundingClientRect(); const plot = document.querySelector('#media-detail-plot'); const toggle = document.querySelector('#media-detail-plot-toggle'); const rating = document.querySelector('.detail-rating-badge'); const style = plot ? getComputedStyle(plot) : undefined; return { hidden: document.querySelector('#media-detail')?.hidden, title: document.querySelector('#media-detail-title')?.textContent || '', meta: document.querySelector('#media-detail-meta')?.textContent || '', ratingLabel: rating?.getAttribute('aria-label') || '', ratingShape: rating?.querySelector('path')?.getAttribute('d') || '', plot: plot?.textContent || '', plotCollapsed: plot?.classList.contains('collapsed'), plotMeasure: plot && style ? { width: plot.clientWidth, scrollHeight: plot.scrollHeight, lineHeight: style.lineHeight, display: style.display } : undefined, toggleHidden: toggle?.hidden, plotExpanded: toggle?.getAttribute('aria-expanded'), movieInfo: document.querySelector('#detail-file-info')?.textContent || '', episodesHidden: document.querySelector('#detail-episodes-section')?.hidden, button: button ? { left: button.left, right: button.right, top: button.top, bottom: button.bottom } : undefined, viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight } }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.plot.length >= LONG_PLOT.length && Boolean(value.button),
    );
    await capture("movie-detail");
    assert.equal(detail.title, LONG_TITLE);
    assert.equal(detail.plot, LONG_PLOT);
    assert.equal(detail.plotCollapsed, true, `synopsis starts collapsed to three visual lines: ${JSON.stringify(detail.plotMeasure)}`);
    assert.equal(detail.toggleHidden, false, "a short synopsis spanning four visual lines can be expanded");
    assert.equal(detail.plotExpanded, "false");
    assert.match(detail.meta, /2026/);
    assert.match(detail.meta, /2026-02-14/, "detail exposes the NFO premiere date");
    assert.equal(detail.ratingLabel, "评分 8.7");
    assert.ok(detail.ratingShape.length > 0, "rating is rendered on a biscuit shape");
    assert.match(detail.movieInfo, /owned-fixture/i);
    assert.equal(detail.episodesHidden, true, "movies do not show an episode list");
    assert.ok(detail.button.left >= 0 && detail.button.right <= detail.viewport.width && detail.button.top >= 0 && detail.button.bottom <= detail.viewport.height);

    await evaluate(window, "document.querySelector('#media-detail-plot-toggle')?.click()");
    assert.equal(await evaluate(window, "document.querySelector('#media-detail-plot-toggle')?.getAttribute('aria-expanded')"), "true", "synopsis expands from its disclosure control");
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    await waitFor("detail back navigation", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === true);
    await waitFor("movie card focus restoration", () => evaluate(window, "document.activeElement?.dataset.mediaId || ''"), (mediaId) => mediaId === openedMediaId);
    assert.equal(await evaluate(window, "document.activeElement?.dataset.mediaId"), openedMediaId, "return restores focus to the opened movie card");
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    await waitFor("movie detail after focus check", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === false);

    window.setSize(900, 640);
    const minOuter = window.getSize();
    const minDetail = await waitFor("minimum window resize", async () => {
      const view = await evaluate(window, "(() => { const button = document.querySelector('#media-detail-open')?.getBoundingClientRect(); const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }; const inner = { width: window.innerWidth, height: window.innerHeight }; return { visible: Boolean(button && button.left >= 0 && button.right <= viewport.width && button.top >= 0 && button.bottom <= viewport.height), viewport, inner }; })()");
      return { ...view, content: window.getContentSize() };
    }, (value) => Math.abs(value.content[0] - value.inner.width) <= 4 && Math.abs(value.content[1] - value.inner.height) <= 4);
    const minContent = minDetail.content;
    assert.ok(minOuter[0] >= 900 && minOuter[1] >= 640);
    assert.equal(minDetail.visible, true);
    await evaluate(window, "document.querySelector('#library-search-clear')?.click()");
    await evaluate(window, "document.querySelector('#media-detail-open')?.click()");
    const player = await waitFor(
      "player title and controls",
      () => evaluate(window, "(() => { const view = document.querySelector('[data-view=\"player\"]'); const surface = document.querySelector('.player-surface')?.getBoundingClientRect(); const controls = document.querySelector('.player-controls')?.getBoundingClientRect(); const title = document.querySelector('#player-current-title')?.getBoundingClientRect(); const toggle = document.querySelector('#player-toggle-button'); return { visible: view?.hidden === false, currentTitle: document.querySelector('#player-current-title')?.textContent || '', ready: toggle?.disabled === false, controlsHeight: controls?.height || 0, titleInControls: Boolean(title && controls && title.top >= controls.top && title.bottom <= controls.bottom), titleOutsideSurface: Boolean(title && surface && title.bottom <= surface.top) }; })()"),
      (value) => value.visible && value.currentTitle === LONG_TITLE && Math.abs(value.controlsHeight - 152) < 1 && !value.titleInControls && value.titleOutsideSurface && value.ready,
      15_000,
    );
    assert.equal(player.currentTitle, LONG_TITLE);

    await evaluate(window, "window.zVideo.localPlayback.command({ type: 'seek', positionSec: 5 })");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await evaluate(window, "document.querySelector('#player-close-button')?.click()");
    await waitFor("player close complete", () => evaluate(window, "document.querySelector('[data-view=player]')?.hidden === true"), Boolean);
    const savedPlayback = await evaluate(window, `window.zVideo.localLibrary.get(${JSON.stringify(openedMediaId)}).then((result) => result.detail?.playback?.positionSec ?? 0)`);
    assert.ok(savedPlayback > 0, "playback progress exists before the preservation check");
    await evaluate(window, "document.querySelector('#choose-folder-button')?.click()");
    await waitFor("cancel-preservation scan running", readScanUi, (value) => value.pillVisible && value.pillCancelVisible && value.pillCancelDisabled === false, 20_000);
    await evaluate(window, "document.querySelector('#scan-pill-cancel')?.click()");
    const preservationCancelled = await waitFor("cancel-preservation summary", readScanUi, (value) => value.noticeVisible && /扫描已取消/.test(value.noticeTitle), 20_000);
    assert.match(preservationCancelled.noticeText, /播放进度/);
    await evaluate(window, "document.querySelector('#app-notice-close')?.click()");
    const playbackAfterCancel = await evaluate(window, `window.zVideo.localLibrary.get(${JSON.stringify(openedMediaId)}).then((result) => result.detail?.playback?.positionSec ?? 0)`);
    assert.equal(playbackAfterCancel, savedPlayback, "cancelling a scan preserves saved playback progress");
    await evaluate(window, "document.querySelector('[data-nav=home]')?.click()");
    const continueMin = await waitFor(
      "continue row at minimum size",
      () => evaluate(window, "(() => { const card = document.querySelector('.continue-card .continue-copy > strong'); const firstTitle = document.querySelector('.media-card-title'); const firstRect = firstTitle?.getBoundingClientRect(); return { hidden: document.querySelector('#continue-section')?.hidden, title: card?.textContent || '', top: card?.getBoundingClientRect().top || -1, bottom: card?.getBoundingClientRect().bottom || -1, firstTitle: firstTitle?.textContent || '', firstTop: firstRect?.top || -1, firstBottom: firstRect?.bottom || -1, height: document.documentElement.clientHeight }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.title.length > 0 && value.firstTitle.length > 0,
      10_000,
    );
    await capture("home");
    assert.equal(continueMin.title, LONG_TITLE);
    assert.ok(continueMin.firstTitle.length > 0);

    window.setSize(1040, 720);
    const defaultAfterContinueOuter = window.getSize();
    const continueDefault = await waitFor(
      "continue row at default size",
      async () => ({ ...(await evaluate(window, "(() => { const firstTitle = document.querySelector('.media-card-title'); const rect = firstTitle?.getBoundingClientRect(); return { outer: { width: window.outerWidth, height: window.outerHeight }, content: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }, inner: { width: window.innerWidth, height: window.innerHeight }, hidden: document.querySelector('#continue-section')?.hidden, title: document.querySelector('.continue-card .continue-copy > strong')?.textContent || '', firstTitle: firstTitle?.textContent || '', firstTop: rect?.top || -1, firstBottom: rect?.bottom || -1 }; })()")), windowContent: window.getContentSize() }),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.firstTitle.length > 0 && Math.abs(value.windowContent[0] - value.inner.width) <= 4 && Math.abs(value.windowContent[1] - value.inner.height) <= 4,
    );
    assert.ok(defaultAfterContinueOuter[0] >= 1040 && defaultAfterContinueOuter[1] >= 720);
    assert.ok(Math.abs(continueDefault.windowContent[0] - continueDefault.inner.width) <= 4 && Math.abs(continueDefault.windowContent[1] - continueDefault.inner.height) <= 4, `content=${JSON.stringify(continueDefault.windowContent)} inner=${JSON.stringify(continueDefault.inner)}`);
    assert.ok(continueDefault.content.width > 0 && continueDefault.content.height > 0);
    assert.ok(continueDefault.firstTitle.length > 0);

    await rename(fixtureRoot, fixtureRoot + "-offline");
    await evaluate(window, "document.querySelector('#manage-sources-button')?.click()");
    await waitFor("source refresh available", () => evaluate(window, "Boolean(document.querySelector('[data-refresh-source-id]'))"), Boolean);
    await evaluate(window, "document.querySelector('[data-refresh-source-id]')?.click()");
    await waitFor("source offline", () => evaluate(window, "document.querySelector('#source-list')?.textContent || ''"), (value) => value.includes("离线"));
    await evaluate(window, "document.querySelector('[data-nav=all]')?.click()");
    await evaluate(window, "(() => { const search = document.querySelector('#library-search-input'); search.value = 'Owned UX Audit Feature Film 2026'; search.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor("offline movie card", () => evaluate(window, "document.querySelector('#library-grid .media-card-title')?.textContent || ''"), (value) => value === LONG_TITLE);
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    await waitFor("offline movie detail", () => evaluate(window, "document.querySelector('#detail-offline-banner')?.hidden === false && document.querySelector('#media-detail-open')?.disabled === true"), Boolean);
    assert.equal(await evaluate(window, "document.querySelector('#media-detail-restart')?.disabled"), true, "offline movie cannot restart playback");
    await capture("movie-offline");

    const diagnostics = await readFile(join(logDir, "diagnostics.jsonl"), "utf8").catch(() => "");
    assert.match(diagnostics, /"operation":"window\.renderer-ready"/);
    assert.match(diagnostics, /"operation":"local-library\.list"/);
    assert.doesNotMatch(diagnostics, /session\.restore|session\.login|discovery\.start/);
    const resultPath = process.env.Z_VIDEO_LOCAL_LIBRARY_APP_RESULT;
    if (!resultPath) throw new Error("Z_VIDEO_LOCAL_LIBRARY_APP_RESULT is required");
    await writeFile(resultPath, JSON.stringify({
      schemaVersion: 1,
      proof: "local-library-ux",
      scan: { runningPill: firstRunning.pillText, runningCard: firstRunning.cardText.slice(0, 160), welcomeCoexists: firstRunning.onboardingVisible, cancelledPageTotal: preserved.pageTotal, cancelledNotice: cancelled.noticeTitle, completedPageTotal: completedTotal.pageTotal, completedNotice: complete.noticeTitle, summary: summaryText.slice(0, 200), compact: { pill: compactScan.pillRect, card: compactScan.cardRect, viewport: compactScan.viewport } },
      releaseSort: { menu: sortMenu.options, firstTitle: released.firstTitle, firstMeta: released.firstMeta, secondMeta: released.secondMeta, unknownLabel: unknownDate },
      defaultWindow: { outer: defaultOuter },
      detail: { default: { title: detail.title, plotLength: detail.plot.length, play: detail.button, viewport: detail.viewport }, minimum: { outer: minOuter, content: minContent, playVisible: minDetail.visible, viewport: minDetail.viewport } },
      player: { currentTitle: player.currentTitle, controlsHeight: player.controlsHeight, titleInControls: player.titleInControls, titleOutsideSurface: player.titleOutsideSurface },
      continueWatching: { minimum: continueMin, default: continueDefault, defaultContent: continueDefault.windowContent, defaultOuter: defaultAfterContinueOuter },
    }, null, 2) + "\n", "utf8");
    process.stdout.write("PASS: production local-library UX smoke (running scan, detail/player layout, continue row)\n");
    await quitProductionApp();
  } finally {
    dialog.showOpenDialog = originalShowOpenDialog;
  }
  await rm(profile, { recursive: true, force: true });
}

void run().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  app.exit(1);
});
