import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { IPC_CHANNELS } from "../src/shared/ipc-channels";

const LONG_TITLE = "Owned UX Audit Feature Film 2026 — Long Detail Title";
const LONG_PLOT = "海边小城的旧电影院迎来新经理，他计划修复影厅并重新放映。".repeat(6);
const INDEX_FILE_COUNT = 8_000;
const APP_TIMEOUT_MS = 180_000;
let appDeadline = 0;
let delayNextLibraryList = false;
let failNextCollectionList = false;
let failNextSourceRemove = false;
let delayNextDetail = false;
let failNextDetail = false;
const originalIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalIpcHandle(channel, async (event, ...args) => {
  if ((channel === IPC_CHANNELS.localLibraryList || channel === IPC_CHANNELS.localLibraryListCollections) && delayNextLibraryList) {
    delayNextLibraryList = false;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (channel === IPC_CHANNELS.localLibraryListCollections && failNextCollectionList) {
    failNextCollectionList = false;
    throw new Error("这一页读取失败（测试夹具）");
  }
  if (channel === IPC_CHANNELS.localLibraryRemoveSource && failNextSourceRemove) {
    failNextSourceRemove = false;
    throw new Error("片库文件暂时被占用，请重试。");
  }
  if (channel === IPC_CHANNELS.localLibraryGet && delayNextDetail) {
    delayNextDetail = false;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (channel === IPC_CHANNELS.localLibraryGet && failNextDetail) {
    failNextDetail = false;
    throw new Error("详情读取失败（测试夹具）");
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
    await waitFor("custom restore after minimize", async () => window.isMinimized(), (minimized) => minimized === false);

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
    const errorState = await waitFor("library error card", () => evaluate(window, `({ visible: !document.querySelector('#library-error').hidden, title: document.querySelector('#library-error-title')?.textContent || '', text: document.querySelector('#library-error').textContent, buttons: [...document.querySelectorAll('#library-error button')].map(button => button.textContent), tech: document.querySelector('#library-error .tech-details p')?.textContent || '', techOpen: document.querySelector('#library-error .tech-details')?.open })`), (value) => value.visible);
    await capture("error");
    assert.equal(errorState.title, "片库文件暂时无法读写", "a storage failure uses plain language instead of a raw error code");
    assert.match(errorState.text, /storage/);
    assert.deepEqual(errorState.buttons, ["重试", "复制诊断信息", "查看文件夹"], "the storage failure offers concrete next steps");
    assert.match(errorState.tech, /错误代码：storage/, "the raw error code lives in technical details");
    assert.equal(errorState.techOpen, false, "technical details stay collapsed by default");
    await evaluate(window, "document.querySelector('#library-error-copy')?.click()");
    const copied = await waitFor("diagnostics copy feedback", () => evaluate(window, "document.querySelector('#library-message')?.textContent || ''"), (value) => /诊断信息已复制|无法自动复制/.test(value));
    assert.match(copied, /诊断信息已复制|无法自动复制/);
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
        scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY,
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

    await evaluate(window, "document.querySelector('[data-nav=folder]')?.click()");
    await waitFor("scan panel running", readScanUi, (value) => value.scanPanelTitle.includes("正在扫描"));
    await capture("scan");
    await evaluate(window, "document.querySelector('[data-nav=home]')?.click()");
    await waitFor("home scan card after sources page", readScanUi, (value) => value.cardVisible);

    const firstContent = await waitFor("first content appears during scan", readScanUi, (value) => value.cards > 0, 20_000);
    assert.ok(firstContent.pageTotal > 0);
    assert.equal(await evaluate(window, "(() => { const cards = [...document.querySelectorAll('#library-grid .media-card')]; cards.forEach((card) => { card.dataset.scanProbe = 'kept'; }); return cards.length > 0; })()"), true);
    await waitFor("welcome card retires after first content", readScanUi, (value) => value.onboardingVisible === false);

    await evaluate(window, "document.querySelector('#scan-pill-cancel')?.click()");
    const cancelled = await waitFor("cancelled scan summary", readScanUi, (value) => value.noticeVisible && /扫描已取消/.test(value.noticeTitle), 20_000);
    assert.match(cancelled.noticeText, /保留/);
    assert.equal(cancelled.cardHidden, true);
    assert.equal(cancelled.pillHidden, true);
    const preserved = await waitFor("cancelled scan keeps the partial index", readScanUi, (value) => value.pageTotal > 0 && value.cards > 0);
    assert.ok(preserved.pageTotal > 0);
    // Verify in-place reuse on a settled list: the same data must keep the same
    // card nodes. Marking a single scan-time card was racy because committed
    // rows can legitimately push it off page one.
    await evaluate(window, "document.querySelectorAll('#library-grid .media-card').forEach((card) => { card.dataset.scanProbe = 'kept'; })");
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=all]')?.click()");
    const reusedCards = await waitFor(
      "library refresh reuses existing cards",
      () => evaluate(window, "({ probes: document.querySelectorAll('#library-grid [data-scan-probe=kept]').length, cards: document.querySelectorAll('#library-grid .media-card').length, skeletons: document.querySelectorAll('#library-grid .media-skeleton').length, busy: document.querySelector('#library-grid')?.getAttribute('aria-busy') })"),
      (value) => value.busy === null && Number(value.cards) > 0,
    );
    assert.equal(reusedCards.skeletons, 0, "a later refresh never replaces the grid with skeletons");
    assert.equal(reusedCards.probes, reusedCards.cards, "a later refresh reuses every existing card node instead of replacing the grid");
    await evaluate(window, "document.querySelector('#app-notice-close')?.click()");
    await waitFor("cancelled notice dismissed", readScanUi, (value) => value.noticeVisible === false);

    await evaluate(window, "document.querySelector('#choose-folder-button')?.click()");
    const secondRunning = await waitFor("second scan running", readScanUi, (value) => value.pillVisible && value.cardVisible && /owned-fixture/.test(value.cardText), 20_000);
    assert.match(secondRunning.cardText, /owned-fixture/);
    // The ticket's known flake: the compact scan-pill check must not depend on
    // whatever scroll offset an earlier assertion left behind. Reset first,
    // then prove the sticky header keeps the pill on screen while scrolled.
    const stickyHeader = await waitFor("sticky header while the page is scrolled", () => evaluate(window, `(() => {
      window.scrollTo(0, 400);
      const scroller = document.scrollingElement;
      const bar = document.querySelector('.window-bar')?.getBoundingClientRect();
      const header = document.querySelector('.app-header')?.getBoundingClientRect();
      const pill = document.querySelector('#scan-status')?.getBoundingClientRect();
      return { scrollTop: scroller ? scroller.scrollTop : window.scrollY, barTop: bar?.top, headerTop: header?.top, pillTop: pill?.top };
    })()`), (value) => value.scrollTop > 100 && Math.abs(Number(value.headerTop) - 36) <= 1 && Number(value.pillTop) >= 36, 5_000);
    assert.equal(stickyHeader.barTop, 0, "the window bar stays visible while scrolling");
    await evaluate(window, "(() => { const scroller = document.scrollingElement; if (scroller) scroller.scrollTop = 0; window.scrollTo(0, 0); })()");
    window.setSize(900, 640);
    const compactScan = await waitFor("second scan at 900x640", readScanUi, (value) => value.viewport.width <= 900 && value.scrollTop === 0 && value.pillVisible && value.cardVisible);
    assertInside("900 scan pill", compactScan.pillRect, compactScan.viewport);
    assertInside("900 home scan card", compactScan.cardRect, compactScan.viewport);
    assertInside("900 home scan cancel", compactScan.cardCancelRect, compactScan.viewport);

    const complete = await waitFor("completed scan summary", readScanUi, (value) => value.noticeVisible && /扫描完成/.test(value.noticeTitle), 90_000);
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

    await evaluate(window, "document.querySelector('[data-nav=home]')?.click()");
    const homeShelves = await waitFor(
      "home shelves use one collection card per work",
      () => evaluate(window, `(() => {
        const read = (selector) => [...document.querySelectorAll(selector + ' .media-card')].map((card) => ({
          title: card.querySelector('.media-card-title')?.textContent || '',
          meta: card.querySelector('.media-card-meta')?.textContent || '',
          progress: card.querySelector('.media-card-progress')?.textContent || '',
        }));
        return {
          recentHidden: document.querySelector('#recent-section')?.hidden,
          showsHidden: document.querySelector('#shows-section')?.hidden,
          recentHeading: document.querySelector('#recent-section h2')?.textContent || '',
          recent: read('#recent-row'),
          shows: read('#shows-row'),
          continueScope: document.querySelector('#continue-scope')?.textContent || '',
          sortLabels: [...document.querySelectorAll('#library-sort option')].map((option) => option.textContent || ''),
        };
      })()`),
      (value) => value.recentHidden === false && value.showsHidden === false && value.shows.length === 1 && value.shows[0]?.title === "Owned Next Show",
    );
    assert.equal(homeShelves.shows.length, 1, "the three episodes of one show become one home shelf card");
    assert.match(homeShelves.shows[0]!.meta, /3 集/);
    assert.doesNotMatch(homeShelves.shows[0]!.meta, /(KB|MB|GB)/, "work cards never show a file size");
    assert.match(homeShelves.shows[0]!.progress, /已看 0 集/);
    assert.ok(homeShelves.recent.length > 0 && homeShelves.recent.length <= 12, "the recent shelf stays bounded");
    assert.doesNotMatch(homeShelves.recent[0]!.meta, /(KB|MB|GB)/, "the recent home shelf uses work cards");
    assert.ok(homeShelves.recent.every((item: { progress: string }) => item.progress.length > 0), "home shelf work cards expose watched state");
    assert.equal(homeShelves.recentHeading, "最近加入", "the home shelf is named after the work-level added date");
    assert.deepEqual(homeShelves.sortLabels.slice(0, 3), ["最近观看", "最近加入", "最近发布"], "sort labels describe work-level ordering");
    await capture("home-shelves");

    await evaluate(window, "document.querySelector('[data-nav=all]')?.click()");
    await waitFor("visible all-media page", () => evaluate(window, "document.querySelector('#collection-section')?.hidden"), (hidden) => hidden === false);
    await waitFor("all navigation active", () => evaluate(window, "document.querySelector('[data-nav=all]')?.getAttribute('aria-current')"), (value) => value === "page");
    const allWorks = await waitFor(
      "all view counts works",
      () => evaluate(window, "(() => { const scope = document.querySelector('#page-scope')?.textContent || ''; return { scope, busy: document.querySelector('#library-grid')?.getAttribute('aria-busy'), count: Number(scope.match(/共 (\\d+) 部作品/)?.[1] || 0) }; })()"),
      (value) => value.busy === null && value.count > 0,
    );
    assert.match(allWorks.scope, /部作品/);
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=movie]')?.click()");
    const movieWorks = await waitFor(
      "movie view counts works",
      () => evaluate(window, "(() => { const cards = [...document.querySelectorAll('#library-grid .media-card')]; return { scope: document.querySelector('#page-scope')?.textContent || '', busy: document.querySelector('#library-grid')?.getAttribute('aria-busy'), count: Number((document.querySelector('#page-scope')?.textContent || '').match(/共 (\\d+) 部作品/)?.[1] || 0), firstMeta: cards[0]?.querySelector('.media-card-meta')?.textContent || '' }; })()"),
      (value) => value.busy === null && value.count > 0,
    );
    assert.match(movieWorks.scope, /部作品/);
    assert.match(movieWorks.firstMeta, /电影/);
    assert.doesNotMatch(movieWorks.firstMeta, /(KB|MB|GB)/, "movie work cards omit file size too");
    assert.equal(movieWorks.count, allWorks.count - 1, "only the one show work is excluded from the movie work count");
    await capture("movie-works");
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=show]')?.click()");
    const showCards = await waitFor(
      "one card per show",
      () => evaluate(window, "(() => { const cards = [...document.querySelectorAll('#library-grid .media-card')]; return { count: cards.length, title: cards[0]?.querySelector('.media-card-title')?.textContent || '', meta: cards[0]?.querySelector('.media-card-meta')?.textContent || '', progress: cards[0]?.querySelector('.media-card-progress')?.textContent || '', scope: document.querySelector('#page-scope')?.textContent || '' }; })()"),
      (value) => value.count === 1 && value.title === "Owned Next Show",
    );
    assert.equal(showCards.count, 1, "three episodes of one show collapse into a single work card");
    assert.match(showCards.meta, /3 集/, "work card shows the episode count");
    assert.doesNotMatch(showCards.meta, /(KB|MB|GB)/, "work cards do not show a file size");
    assert.match(showCards.progress, /已看 0 集/, "work card shows watched count and resume state");
    assert.match(showCards.scope, /部作品/, "work view counts works, not files");
    await capture("show-cards");

    const readShowDetail = () => evaluate(window, `(() => {
      const rows = [...document.querySelectorAll('#detail-episodes .episode-row')];
      const currentIndex = rows.findIndex((row) => row.classList.contains('current'));
      return {
        hidden: document.querySelector('#media-detail')?.hidden,
        title: document.querySelector('#media-detail-title')?.textContent || '',
        count: rows.length,
        currentIndex,
        currentNumber: currentIndex >= 0 ? rows[currentIndex]?.querySelector('.episode-number')?.textContent || '' : '',
        navCurrent: document.querySelector('[data-nav][aria-current="page"]')?.dataset.nav || '',
        backLabel: document.querySelector('#media-detail-back')?.textContent || '',
        playText: document.querySelector('#media-detail-open')?.textContent || '',
        playDisabled: document.querySelector('#media-detail-open')?.disabled,
        rows: rows.map((row) => ({
          meta: row.querySelector('.episode-duration')?.textContent || '',
          progress: Boolean(row.querySelector('.episode-progress')),
          watched: row.classList.contains('watched'),
          current: row.classList.contains('current'),
        })),
      };
    })()`);
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    const showDetail = await waitFor(
      "show work detail with per-episode state",
      readShowDetail,
      (value) => value.hidden === false && value.title === "Owned Next Show" && value.count === 3,
    );
    assert.equal(showDetail.currentIndex, 0, "opening the work card selects the first unwatched episode");
    assert.equal(showDetail.currentNumber, "01");
    assert.equal(showDetail.navCurrent, "all", "detail keeps the navigation item of the page it came from");
    assert.match(showDetail.backLabel, /返回片库/, "detail back label names the work-list origin");
    assert.equal(showDetail.playText, "播放", "an unwatched episode uses the plain play label");
    assert.deepEqual(showDetail.rows.map((row: { meta: string }) => row.meta), ["未看", "未看", "未看"], "every episode starts with its own unwatched state");
    assert.equal(showDetail.rows.some((row: { progress: boolean }) => row.progress), false, "an unwatched episode never draws a progress bar");
    await capture("show-detail");

    await evaluate(window, "document.querySelector('#media-detail-open')?.click()");
    await waitFor("show episode playback ready", () => evaluate(window, "document.querySelector('#player-toggle-button')?.disabled === false"), Boolean, 15_000);
    await evaluate(window, "window.zVideo.localPlayback.command({ type: 'seek', positionSec: 5 })");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await evaluate(window, "document.querySelector('#player-close-button')?.click()");
    await waitFor("player closed after saving episode progress", () => evaluate(window, "document.querySelector('[data-view=player]')?.hidden === true"), Boolean);
    const returnedDetail = await evaluate(window, "document.querySelector('#media-detail')?.hidden === false");
    if (!returnedDetail) {
      await waitFor("show list after playback close", () => evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.dataset.mediaId || ''"), Boolean);
      await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    }
    const episodeStates = await waitFor("per-episode watched/progress state", readShowDetail, (value) => value.hidden === false && value.title === "Owned Next Show" && value.count === 3);
    assert.ok(episodeStates.rows[0]?.meta !== "未看", `the played episode keeps its own progress: ${JSON.stringify(episodeStates.rows)}`);
    assert.equal(episodeStates.rows[1]?.meta, "未看", "a later episode stays unwatched when only the first episode was played");
    assert.equal(episodeStates.rows[2]?.meta, "未看", "the last episode stays unwatched");
    assert.equal(episodeStates.rows[0]?.progress || episodeStates.rows[0]?.watched, true, "the played episode shows its own progress or watched mark");
    if (episodeStates.currentIndex === 0 && /^看到 /.test(episodeStates.rows[0]?.meta ?? "")) {
      assert.equal(episodeStates.playText, "继续播放 · 第 1 季 第 1 集", "the main action names the exact episode it continues");
    } else if (episodeStates.currentIndex === 0 && episodeStates.rows[0]?.watched) {
      assert.equal(episodeStates.playText, "重新播放", "a finished selected episode uses the replay label");
    }
    await capture("show-detail-episode-states");
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    await waitFor("back to show work list", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === true);

    delayNextDetail = true;
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    const loadingState = await evaluate(window, `(() => ({
      detailVisible: document.querySelector('#media-detail')?.hidden === false,
      skeletonVisible: document.querySelector('#detail-skeleton')?.hidden === false,
      contentHidden: document.querySelector('#detail-content')?.hidden,
      errorHidden: document.querySelector('#detail-error')?.hidden,
      title: document.querySelector('#media-detail-title')?.textContent || '',
      posterImages: document.querySelectorAll('#detail-poster img').length,
      episodes: document.querySelectorAll('#detail-episodes .episode-row').length,
      playText: document.querySelector('#media-detail-open')?.textContent || '',
      busy: document.querySelector('#media-detail')?.getAttribute('aria-busy'),
      skeletonBlocks: document.querySelectorAll('#detail-skeleton .detail-skeleton-block').length,
    }))()`);
    assert.equal(loadingState.detailVisible, true);
    assert.equal(loadingState.skeletonVisible, true, "detail loading uses a local skeleton");
    assert.equal(loadingState.contentHidden, true, "loading hides the previous work's title, cover and actions");
    assert.equal(loadingState.errorHidden, true);
    assert.equal(loadingState.title, "", "the previous title is cleared while the next detail loads");
    assert.equal(loadingState.posterImages, 0, "the previous cover is not kept during loading");
    assert.equal(loadingState.episodes, 0, "the previous episode list is not kept during loading");
    assert.equal(loadingState.playText, "播放");
    assert.equal(loadingState.busy, "true", "the detail region reports busy while loading");
    assert.ok(loadingState.skeletonBlocks >= 3, "the detail skeleton has poster and text blocks");
    await capture("detail-loading");
    await waitFor("detail loaded after skeleton", readShowDetail, (value) => value.hidden === false && value.title === "Owned Next Show" && value.count === 3);
    assert.equal(await evaluate(window, "document.querySelector('#media-detail')?.getAttribute('aria-busy')"), null);

    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    await waitFor("back after skeleton", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === true);

    failNextDetail = true;
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    const detailError = await waitFor(
      "detail error state",
      () => evaluate(window, `(() => ({
        errorVisible: document.querySelector('#detail-error')?.hidden === false,
        skeletonHidden: document.querySelector('#detail-skeleton')?.hidden,
        contentHidden: document.querySelector('#detail-content')?.hidden,
        title: document.querySelector('#media-detail-title')?.textContent || '',
        posterImages: document.querySelectorAll('#detail-poster img').length,
        message: document.querySelector('#detail-error-message')?.textContent || '',
        buttons: [...document.querySelectorAll('#detail-error button')].map((button) => button.textContent || ''),
        errorTitle: document.querySelector('#detail-error-title')?.textContent || '',
        focusedId: document.activeElement instanceof HTMLElement ? document.activeElement.id : '',
      }))()`),
      (value) => value.errorVisible === true,
    );
    assert.equal(detailError.skeletonHidden, true, "a failed load stops the skeleton");
    assert.equal(detailError.contentHidden, true, "a failed load never keeps the previous cover, title or play button");
    assert.equal(detailError.title, "", "a failed load clears the stale title");
    assert.equal(detailError.posterImages, 0, "a failed load clears the stale cover");
    assert.match(detailError.message, /详情读取失败/);
    assert.equal(detailError.errorTitle, "详情加载失败");
    assert.deepEqual(detailError.buttons, ["重试", "返回片库"]);
    assert.ok(detailError.focusedId === "detail-error-title" || detailError.focusedId === "detail-error-retry", `error state moves focus into the failure panel: ${detailError.focusedId}`);
    await capture("detail-error");
    await evaluate(window, "document.querySelector('#detail-error-retry')?.click()");
    await waitFor("detail retry recovers", readShowDetail, (value) => value.hidden === false && value.title === "Owned Next Show" && value.count === 3);
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    await waitFor("back after retry", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === true);

    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=episode]')?.click()");
    const episodeCards = await waitFor(
      "single-episode file list",
      () => evaluate(window, "(() => { const cards = [...document.querySelectorAll('#library-grid .media-card')]; return { count: cards.length, titles: cards.map((card) => card.querySelector('.media-card-title')?.textContent || ''), meta: cards[0]?.querySelector('.media-card-meta')?.textContent || '', scope: document.querySelector('#page-scope')?.textContent || '' }; })()"),
      (value) => value.count === 3 && value.titles.includes("Next Episode 1"),
    );
    assert.equal(episodeCards.count, 3, "the single-episode view keeps one card per file");
    assert.match(episodeCards.meta, /(KB|MB|GB)/, "single-episode cards keep file-level metadata");
    assert.match(episodeCards.scope, /集/);
    assert.doesNotMatch(episodeCards.scope, /部作品/);
    await capture("episodes");
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    const episodeOrigin = await waitFor(
      "single-episode detail origin",
      () => evaluate(window, "({ hidden: document.querySelector('#media-detail')?.hidden, backLabel: document.querySelector('#media-detail-back')?.textContent || '', navCurrent: document.querySelector('[data-nav][aria-current=\"page\"]')?.dataset.nav || '' })"),
      (value) => value.hidden === false && /返回单集列表/.test(value.backLabel),
    );
    assert.match(episodeOrigin.backLabel, /返回单集列表/, "detail opened from the file-level episode list names that origin");
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    await waitFor("back to episode list", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === true);
    assert.equal(await evaluate(window, "document.querySelector('#library-filter')?.value"), "episode", "returning from a single-episode detail keeps the file-level filter");
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=all]')?.click()");
    await waitFor("all works after single-episode check", () => evaluate(window, "document.querySelector('#library-grid')?.getAttribute('aria-busy') || ''"), (value) => value === "");

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
    const storedSort = await evaluate(window, "window.zVideo.appPreferences.get()");
    assert.equal(storedSort.sort, "released_desc", "the renderer persists the work-level sort preference through main");
    await evaluate(window, "(() => { const input = document.querySelector('#library-search-input'); if (!(input instanceof HTMLInputElement)) throw new Error('search missing'); input.value = 'Index fixture index-00000'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    const unknownDate = await waitFor(
      "unknown premiere date label",
      () => evaluate(window, "(() => ({ meta: document.querySelector('#library-grid .media-card-meta')?.textContent || '', cards: document.querySelectorAll('#library-grid .media-card').length, skeletons: document.querySelectorAll('#library-grid .media-skeleton').length, message: document.querySelector('#library-message')?.textContent || '', scope: document.querySelector('#page-scope')?.textContent || '', query: document.querySelector('#library-search-input')?.value || '', filter: document.querySelector('#library-filter')?.value || '', sort: document.querySelector('#library-sort')?.value || '', busy: document.querySelector('#library-grid')?.getAttribute('aria-busy') }))()"),
      (value) => value.meta.includes("发布日期未知"),
    );
    assert.match(unknownDate.meta, /发布日期未知/);
    assert.doesNotMatch(unknownDate.meta, /发布日期 (19|20)\d{2}/, "a year is never shown as a premiere date");
    await evaluate(window, "document.querySelector('#library-search-clear')?.click()");
    // The search input debounce outlives the clear click; let it settle before
    // reloading, so the preference check observes a completed library request.
    await new Promise((resolve) => setTimeout(resolve, 300));
    window.webContents.reload();
    const restoredSort = await waitFor(
      "saved work-level sort preference restored after reload",
      () => evaluate(window, "({ sort: document.querySelector('#library-sort')?.value || '', busy: document.querySelector('#library-grid')?.getAttribute('aria-busy') })"),
      (value) => value.sort === "released_desc" && value.busy === null,
      20_000,
    );
    assert.equal(restoredSort.sort, "released_desc", "a saved sort preference still wins after a fresh renderer load");
    await evaluate(window, "(() => { const select = document.querySelector('#library-sort'); select.value = 'recent'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await waitFor("sort restored", () => evaluate(window, "document.querySelector('#library-sort')?.value"), (value) => value === "recent");
    await waitFor("library settled after sort restore", () => evaluate(window, "document.querySelector('#library-grid')?.getAttribute('aria-busy')"), (value) => value === null);
    await evaluate(window, "document.querySelector('[data-nav=folder]')?.click()");
    await waitFor("sources visible", () => evaluate(window, "document.querySelector('#source-list')?.getBoundingClientRect().width > 0"), Boolean);
    await capture("sources");
    await evaluate(window, "document.querySelector('[data-nav=all]')?.click()");
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=unclassified]')?.click()");
    const filterEmpty = await waitFor("filter empty state with a next step", () => evaluate(window, `(() => ({
      visible: document.querySelector('#library-empty')?.hidden === false,
      title: document.querySelector('#library-empty-title')?.textContent || '',
      viewAllHidden: document.querySelector('#empty-view-all')?.hidden,
      paginationHidden: document.querySelector('#library-pagination')?.hidden,
    }))()`), (value) => value.visible && value.title === "当前类型没有媒体");
    assert.equal(filterEmpty.viewAllHidden, false, "a filter with no results offers 查看全部");
    assert.equal(filterEmpty.paginationHidden, true, "an empty filter result has no pages");
    await evaluate(window, "document.querySelector('#empty-view-all')?.click()");
    await waitFor("view all recovers from the empty filter", () => evaluate(window, "({ hidden: document.querySelector('#library-empty')?.hidden, count: document.querySelectorAll('#library-grid .media-card').length, filter: document.querySelector('#library-filter')?.value })"), (value) => value.hidden === true && Number(value.count) > 0 && value.filter === "all");
    const readPagination = () => evaluate(window, `(() => {
      const nav = document.querySelector('#library-pagination');
      const status = document.querySelector('#pagination-status')?.textContent || '';
      const scope = document.querySelector('#page-scope')?.textContent || '';
      const current = nav?.querySelector('[aria-current="page"]');
      const disabled = (role) => Boolean(nav?.querySelector('[data-page-role="' + role + '"]')?.disabled);
      return {
        hidden: nav?.hidden,
        status,
        scope,
        cards: document.querySelectorAll('#library-grid .media-card').length,
        current: current?.textContent || '',
        firstDisabled: disabled('first'),
        previousDisabled: disabled('previous'),
        nextDisabled: disabled('next'),
        lastDisabled: disabled('last'),
        scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY,
      };
    })()`);
    const firstPage = await waitFor("pagination on the first work page", readPagination, (value) => value.hidden === false && value.status === "第 1 / 334 页");
    assert.equal(firstPage.firstDisabled, true, "page one disables the first-page action");
    assert.equal(firstPage.previousDisabled, true, "page one disables the previous-page action");
    assert.equal(firstPage.nextDisabled, false);
    assert.equal(firstPage.current, "1");
    assert.equal(firstPage.cards, 24, "the work list stays at 24 works per page");
    assert.match(firstPage.scope, /第 1 页/);

    await evaluate(window, "window.scrollTo(0, 240)");
    await evaluate(window, "document.querySelector('#library-pagination [data-page-role=next]')?.click()");
    const pageTwo = await waitFor(
      "second library page",
      () => evaluate(window, "({ scope: document.querySelector('#page-scope')?.textContent || '', mediaId: document.querySelector('#library-grid [data-media-id]')?.dataset.mediaId || '', title: document.querySelector('#library-grid .media-card-title')?.textContent || '', top: document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY, status: document.querySelector('#pagination-status')?.textContent || '' })"),
      (value) => value.scope.includes("第 2 页") && Boolean(value.mediaId && value.title),
    );
    assert.equal(pageTwo.status, "第 2 / 334 页");
    assert.equal(pageTwo.top, 0, "changing page returns the result area to the top");

    await evaluate(window, "document.querySelector('#library-pagination [data-page-role=last]')?.click()");
    const lastPage = await waitFor("last work page", readPagination, (value) => value.status === "第 334 / 334 页");
    assert.equal(lastPage.lastDisabled, true, "the last page disables the last-page action");
    assert.equal(lastPage.nextDisabled, true, "the last page disables the next-page action");
    assert.equal(lastPage.scrollTop, 0, "jumping to the last page stays at the top");
    assert.ok(lastPage.cards > 0 && lastPage.cards <= 24, `the last page keeps a bounded 24-item page: ${lastPage.cards}`);
    assert.equal(await evaluate(window, "document.querySelector('#library-pagination [data-page-role=first]')?.disabled"), false);
    await evaluate(window, "document.querySelector('#library-pagination [data-page-role=first]')?.click()");
    await waitFor("first work page again", readPagination, (value) => value.status === "第 1 / 334 页");

    const submitJump = (value: string) => evaluate(window, `(() => {
      const input = document.querySelector('#pagination-jump-input');
      if (!(input instanceof HTMLInputElement)) throw new Error('jump input missing');
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#pagination-jump')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`);
    await submitJump("abc");
    const invalidJump = await waitFor("invalid jump input feedback", () => evaluate(window, "({ invalid: document.querySelector('#pagination-jump-input')?.getAttribute('aria-invalid'), error: document.querySelector('#pagination-jump-error')?.textContent || '', errorHidden: document.querySelector('#pagination-jump-error')?.hidden, status: document.querySelector('#pagination-status')?.textContent || '' })"), (value) => value.invalid === "true" && value.errorHidden === false);
    assert.match(invalidJump.error, /1–334/, "invalid jump input says which page range is valid");
    assert.equal(invalidJump.status, "第 1 / 334 页", "invalid jump input never changes the page");

    await submitJump("9999");
    const clampedJump = await waitFor("out-of-range jump clamps to the last page", readPagination, (value) => value.status === "第 334 / 334 页");
    assert.equal(clampedJump.scrollTop, 0, "jumping to a clamped page returns to the top");

    await submitJump("2");
    await waitFor("jump back to the second page", readPagination, (value) => value.status === "第 2 / 334 页");

    failNextCollectionList = true;
    await evaluate(window, "document.querySelector('#library-pagination [data-page-role=next]')?.click()");
    const pageError = await waitFor("page read failure card", () => evaluate(window, `(() => ({
      visible: document.querySelector('#library-page-error')?.hidden === false,
      message: document.querySelector('#library-page-error-message')?.textContent || '',
      buttons: [...document.querySelectorAll('#library-page-error button')].map((button) => button.textContent || ''),
      tech: document.querySelector('#library-page-error-code')?.textContent || '',
      emptyHidden: document.querySelector('#library-empty')?.hidden,
      paginationHidden: document.querySelector('#library-pagination')?.hidden,
      focusedId: document.activeElement instanceof HTMLElement ? document.activeElement.id : '',
    }))()`), (value) => value.visible);
    assert.match(pageError.message, /不是空片库/, "a failed page is never described as an empty library");
    assert.deepEqual(pageError.buttons, ["重试当前页", "返回首页"]);
    assert.match(pageError.tech, /collection_page_read_failed/);
    assert.match(pageError.tech, /page=3/);
    assert.equal(pageError.emptyHidden, true, "a failed page hides the empty-state card");
    assert.equal(pageError.paginationHidden, true, "a failed page hides the pager");
    assert.equal(pageError.focusedId, "library-page-error-title", "focus moves into the page failure card");
    await capture("page-error");
    await evaluate(window, "document.querySelector('#library-page-error-retry')?.click()");
    await waitFor("page retry recovers", readPagination, (value) => value.hidden === false && value.status === "第 3 / 334 页");
    assert.equal(await evaluate(window, "document.querySelector('#library-page-error')?.hidden"), true);
    await evaluate(window, "document.querySelector('#library-pagination [data-page-role=previous]')?.click()");
    await waitFor("back to the second page after retry", readPagination, (value) => value.status === "第 2 / 334 页");

    window.setSize(900, 640);
    const compactPagination = await waitFor("pagination at 900x640", () => evaluate(window, `(() => {
      const nav = document.querySelector('#library-pagination');
      nav?.scrollIntoView({ block: 'end' });
      const rect = nav?.getBoundingClientRect();
      return {
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null,
        buttons: document.querySelectorAll('#library-pagination button').length,
      };
    })()`), (value) => value.viewport.width <= 900 && Boolean(value.rect) && value.rect!.left >= 0 && value.rect!.right <= value.viewport.width + 1 && value.rect!.bottom <= value.viewport.height + 1);
    assert.ok(compactPagination.rect!.top >= 0, "the compact pager is not clipped above the viewport");
    assert.ok(compactPagination.buttons >= 9, "the compact pager keeps first/previous/pages/next/last buttons");
    await capture("pagination-compact");

    const originScroll = await evaluate(window, `(() => {
      window.scrollTo(0, 240);
      const scroller = document.scrollingElement;
      return { top: scroller ? scroller.scrollTop : window.scrollY, y: window.scrollY, max: scroller ? scroller.scrollHeight - window.innerHeight : 0 };
    })()`);
    assert.ok(originScroll.top > 100, `the work list is tall enough to restore a scroll position: ${JSON.stringify(originScroll)}`);
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    const secondPageDetail = await waitFor(
      "second-page detail",
      () => evaluate(window, "({ hidden: document.querySelector('#media-detail')?.hidden, backLabel: document.querySelector('#media-detail-back')?.textContent || '', top: document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY })"),
      (value) => value.hidden === false,
    );
    assert.match(secondPageDetail.backLabel, /返回片库/);
    assert.equal(secondPageDetail.top, 0, "opening detail starts at the detail title rather than the old list offset");
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    const restoredPage = await waitFor(
      "restored second page and focus",
      () => evaluate(window, "({ scope: document.querySelector('#page-scope')?.textContent || '', activeMediaId: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.mediaId || '' : '' })"),
      (value) => value.scope.includes("第 2 页") && value.activeMediaId === pageTwo.mediaId,
    );
    assert.equal(restoredPage.activeMediaId, pageTwo.mediaId);
    await waitFor(
      "restored list scroll position",
      () => evaluate(window, "document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY"),
      (top) => Math.abs(Number(top) - originScroll.top) <= 4,
    );
    await evaluate(window, "(() => { const search = document.querySelector('#library-search-input'); if (!(search instanceof HTMLInputElement)) throw new Error('search missing'); search.value = 'Next Episode 1'; search.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor("episode search returns its show work card", () => evaluate(window, "document.querySelector('#library-grid .media-card-title')?.textContent || ''"), (title) => title === "Owned Next Show");
    assert.equal(await evaluate(window, "document.querySelectorAll('#library-grid .media-card').length"), 1, "an episode-name search returns the show card once");
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    await waitFor("episode detail", () => evaluate(window, "document.querySelector('#media-detail-open')?.disabled === false"), Boolean);
    await waitFor("episode detail title", () => evaluate(window, "document.querySelector('#media-detail-title')?.textContent"), (title) => title === "Owned Next Show");
    const showEpisodeIds = await evaluate(window, "[...document.querySelectorAll('#detail-episodes .episode-row')].map((row) => row.dataset.mediaId || '')");
    assert.equal(showEpisodeIds.length, 3, "the show detail lists three episodes");
    assert.equal(showEpisodeIds.every(Boolean), true);
    await capture("episode-detail");
    await evaluate(window, "document.querySelector('#media-detail-open')?.click()");
    await waitFor("episode playback", () => evaluate(window, "document.querySelector('#player-toggle-button')?.disabled === false"), Boolean);
    await capture("player");
    await evaluate(window, "document.querySelector('#player-settings-button')?.click()");
    await waitFor("player settings visible", () => evaluate(window, "document.querySelector('#player-settings')?.hidden === false"), Boolean);
    await capture("player-menu");
    await evaluate(window, "document.querySelector('#player-settings-close')?.click()");
    await evaluate(window, "window.zVideo.localPlayback.command({ type: 'seek', positionSec: 1 })");
    await new Promise((resolve) => setTimeout(resolve, 400));
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
    await waitFor("next episode ready", () => evaluate(window, "({ title: document.querySelector('#player-current-title')?.textContent || '', ready: document.querySelector('#player-toggle-button')?.disabled === false })"), (value) => value.title === "Next Episode 2" && value.ready);
    await evaluate(window, "window.zVideo.localPlayback.command({ type: 'seek', positionSec: 1 })");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await evaluate(window, "window.zVideo.localPlayback.command({ type: 'pause' })");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(window, "document.querySelector('#player-close-button')?.click()");
    await waitFor("player closed", () => evaluate(window, "document.querySelector('[data-view=player]')?.hidden"), Boolean);
    const episodeProgress = await waitFor(
      "both show episodes keep in-progress playback",
      () => evaluate(window, `Promise.all(${JSON.stringify(showEpisodeIds.slice(0, 2))}.map((mediaId) => window.zVideo.localLibrary.get(mediaId))).then((results) => results.map((result) => result.detail?.playback?.positionSec ?? 0))`),
      (positions: number[]) => positions.every((position) => position > 0),
    );
    assert.equal(episodeProgress.length, 2, "two episodes of the same work hold progress before the dedupe check");

    await evaluate(window, "(() => { const search = document.querySelector('#library-search-input'); if (!(search instanceof HTMLInputElement)) throw new Error('search missing'); search.value = 'Owned UX Audit Feature Film 2026'; search.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor("long title card", () => evaluate(window, "document.querySelector('#library-grid .media-card-title')?.textContent || ''"), (value) => value === LONG_TITLE);
    const openedMediaId = await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.dataset.mediaId || ''");
    assert.ok(openedMediaId, "search result exposes an openable movie card");
    await evaluate(window, "document.querySelector('#library-filter-buttons [data-filter=show]')?.click()");
    await waitFor("filtered search empty state", () => evaluate(window, "({ title: document.querySelector('#library-empty-title')?.textContent || '', actionHidden: document.querySelector('#search-all-types-button')?.hidden, clearHidden: document.querySelector('#empty-clear-search')?.hidden, filter: document.querySelector('#library-filter')?.value, query: document.querySelector('#library-search-input')?.value })"), (value) => value.title === "没有匹配结果" && value.actionHidden === false && value.clearHidden === false && value.filter === "show" && value.query === "Owned UX Audit Feature Film 2026");
    await evaluate(window, "document.querySelector('#search-all-types-button')?.click()");
    await waitFor("search all media keeps query", () => evaluate(window, "({ title: document.querySelector('#library-grid .media-card-title')?.textContent || '', filter: document.querySelector('#library-filter')?.value, query: document.querySelector('#library-search-input')?.value })"), (value) => value.title === LONG_TITLE && value.filter === "all" && value.query === "Owned UX Audit Feature Film 2026");
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");

    const detail = await waitFor(
      "long detail view",
      () => evaluate(window, "(() => { const button = document.querySelector('#media-detail-open')?.getBoundingClientRect(); const plot = document.querySelector('#media-detail-plot'); const toggle = document.querySelector('#media-detail-plot-toggle'); const rating = document.querySelector('.detail-rating-badge'); const style = plot ? getComputedStyle(plot) : undefined; const titleElement = document.querySelector('#media-detail-title'); const titleStyle = titleElement ? getComputedStyle(titleElement) : undefined; return { hidden: document.querySelector('#media-detail')?.hidden, title: titleElement?.textContent || '', titleLayout: titleElement && titleStyle ? { whiteSpace: titleStyle.whiteSpace, textOverflow: titleStyle.textOverflow, lineHeight: Number.parseFloat(titleStyle.lineHeight), clientHeight: titleElement.clientHeight, scrollHeight: titleElement.scrollHeight, clientWidth: titleElement.clientWidth, scrollWidth: titleElement.scrollWidth } : undefined, focusedTitle: document.activeElement?.id === 'media-detail-title', backLabel: document.querySelector('#media-detail-back')?.textContent || '', navCurrent: document.querySelector('[data-nav][aria-current=\"page\"]')?.dataset.nav || '', meta: document.querySelector('#media-detail-meta')?.textContent || '', ratingLabel: rating?.getAttribute('aria-label') || '', ratingShape: rating?.querySelector('path')?.getAttribute('d') || '', plot: plot?.textContent || '', plotCollapsed: plot?.classList.contains('collapsed'), plotMeasure: plot && style ? { width: plot.clientWidth, scrollHeight: plot.scrollHeight, lineHeight: style.lineHeight, display: style.display } : undefined, toggleHidden: toggle?.hidden, plotExpanded: toggle?.getAttribute('aria-expanded'), movieInfo: document.querySelector('#detail-file-info')?.textContent || '', episodesHidden: document.querySelector('#detail-episodes-section')?.hidden, button: button ? { left: button.left, right: button.right, top: button.top, bottom: button.bottom } : undefined, viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight } }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.plot.length >= LONG_PLOT.length && Boolean(value.button),
    );
    await capture("movie-detail");
    assert.equal(detail.title, LONG_TITLE);
    assert.ok(detail.titleLayout, "the detail title exposes its layout");
    assert.notEqual(detail.titleLayout.whiteSpace, "nowrap", "long detail titles wrap instead of staying on one clipped line");
    assert.notEqual(detail.titleLayout.textOverflow, "ellipsis", "long detail titles are never ellipsized");
    assert.ok(detail.titleLayout.scrollHeight >= detail.titleLayout.lineHeight * 1.5, `a long title occupies multiple visual lines: ${JSON.stringify(detail.titleLayout)}`);
    assert.ok(detail.titleLayout.scrollWidth <= detail.titleLayout.clientWidth + 1, "the wrapped title never overflows horizontally");
    assert.match(detail.backLabel, /返回搜索结果/, "detail opened from search names the search origin");
    assert.equal(detail.navCurrent, "all", "search results keep the navigation item they were entered from");
    assert.equal(detail.focusedTitle, true, "opening a detail moves focus to its title");
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
    const repeatedMovie = await waitFor(
      "movie detail ready after focus check",
      () => evaluate(window, "({ hidden: document.querySelector('#media-detail')?.hidden, contentHidden: document.querySelector('#detail-content')?.hidden, openDisabled: document.querySelector('#media-detail-open')?.disabled, title: document.querySelector('#media-detail-title')?.textContent || '', playText: document.querySelector('#media-detail-open')?.textContent || '', restartHidden: document.querySelector('#media-detail-restart')?.hidden, restartDisabled: document.querySelector('#media-detail-restart')?.disabled })"),
      (value) => value.hidden === false && value.contentHidden === false && value.openDisabled === false && value.title === LONG_TITLE,
    );
    assert.equal(repeatedMovie.playText, "播放", "a movie with no saved progress uses the plain play label");
    assert.equal(repeatedMovie.restartHidden, true, "the secondary restart action only appears once progress exists");

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
    await evaluate(window, "(() => { const input = document.querySelector('#library-search-input'); if (!(input instanceof HTMLInputElement)) throw new Error('search missing'); input.value = 'Owned UX Audit Feature Film 2026'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await new Promise((resolve) => setTimeout(resolve, 350));
    await waitFor("movie card after playback", () => evaluate(window, "document.querySelector('#library-grid .media-card-title')?.textContent || ''"), (title) => title === LONG_TITLE);
    await evaluate(window, `document.querySelector('#library-grid [data-media-id="${openedMediaId}"]')?.click()`);
    const resumedMovie = await waitFor(
      "resumed movie main action",
      () => evaluate(window, "({ hidden: document.querySelector('#media-detail')?.hidden, contentHidden: document.querySelector('#detail-content')?.hidden, title: document.querySelector('#media-detail-title')?.textContent || '', playText: document.querySelector('#media-detail-open')?.textContent || '', restartHidden: document.querySelector('#media-detail-restart')?.hidden, restartDisabled: document.querySelector('#media-detail-restart')?.disabled, focusedTitle: document.activeElement?.id === 'media-detail-title' })"),
      (value) => value.hidden === false && value.contentHidden === false && value.title === LONG_TITLE,
    );
    const savedMoviePlayback = await evaluate(window, `window.zVideo.localLibrary.get(${JSON.stringify(openedMediaId)}).then((result) => ({ watched: result.detail?.playback?.watched === true }))`);
    if (savedMoviePlayback.watched) {
      assert.equal(resumedMovie.playText, "重新播放", "a finished movie uses the replay label");
      assert.equal(resumedMovie.restartHidden, true, "a finished movie has no separate restart action");
    } else {
      assert.match(resumedMovie.playText, /^继续播放 · 00:0[5-9]$/, "a movie with progress uses the continue label");
      assert.equal(resumedMovie.restartHidden, false, "progress keeps the secondary restart action visible");
      assert.equal(resumedMovie.restartDisabled, false, "restart is enabled while the source is online");
    }
    assert.equal(resumedMovie.focusedTitle, true);
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    await waitFor("back from resumed movie detail", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === true);
    await evaluate(window, "document.querySelector('#choose-folder-button')?.click()");
    await waitFor("cancel-preservation scan running", readScanUi, (value) => value.pillVisible && value.pillCancelVisible && value.pillCancelDisabled === false, 20_000);
    await evaluate(window, "document.querySelector('#scan-pill-cancel')?.click()");
    const preservationCancelled = await waitFor("cancel-preservation summary", readScanUi, (value) => value.noticeVisible && /扫描已取消/.test(value.noticeTitle), 20_000);
    assert.match(preservationCancelled.noticeText, /播放进度/);
    await waitFor("cancel-preservation scan fully settled", readScanUi, (value) => value.pillHidden === true && value.cardHidden === true);
    await evaluate(window, "document.querySelector('#app-notice-close')?.click()");
    const playbackAfterCancel = await evaluate(window, `window.zVideo.localLibrary.get(${JSON.stringify(openedMediaId)}).then((result) => result.detail?.playback?.positionSec ?? 0)`);
    assert.equal(playbackAfterCancel, savedPlayback, "cancelling a scan preserves saved playback progress");
    await evaluate(window, "document.querySelector('[data-nav=home]')?.click()");
    await waitFor("home navigation active before continue shelf", () => evaluate(window, "document.querySelector('[data-nav=home]')?.getAttribute('aria-current')"), (value) => value === "page");
    const continueMin = await waitFor(
      "continue row at minimum size",
      () => evaluate(window, "(() => { const card = document.querySelector('.continue-card .continue-copy > strong'); const firstTitle = document.querySelector('.media-card-title'); const firstRect = firstTitle?.getBoundingClientRect(); const cards = [...document.querySelectorAll('.continue-card')]; return { hidden: document.querySelector('#continue-section')?.hidden, title: card?.textContent || '', top: card?.getBoundingClientRect().top || -1, bottom: card?.getBoundingClientRect().bottom || -1, firstTitle: firstTitle?.textContent || '', firstTop: firstRect?.top || -1, firstBottom: firstRect?.bottom || -1, height: document.documentElement.clientHeight, scope: document.querySelector('#continue-scope')?.textContent || '', cards: cards.map((entry) => ({ title: entry.querySelector('.continue-copy > strong')?.textContent || '', detail: entry.querySelector('.continue-copy > span')?.textContent || '', collectionId: entry.dataset.collectionId || '', mediaId: entry.dataset.mediaId || '' })) }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.title.length > 0 && value.firstTitle.length > 0 && value.cards.length > 1,
      10_000,
    );
    await capture("home");
    assert.equal(continueMin.title, LONG_TITLE);
    assert.ok(continueMin.firstTitle.length > 0);
    assert.equal(continueMin.cards.length, 2, "continue watching shows one movie and one show work");
    assert.equal(new Set(continueMin.cards.map((entry: { collectionId: string }) => entry.collectionId)).size, continueMin.cards.length, "each work appears at most once in continue watching");
    assert.equal(continueMin.cards.every((entry: { collectionId: string; mediaId: string }) => Boolean(entry.collectionId && entry.mediaId)), true, "continue cards keep the opaque work and episode identities");
    const showContinueCard = continueMin.cards.find((entry: { title: string }) => entry.title === "Owned Next Show");
    assert.ok(showContinueCard, "continue watching uses the collection title instead of an episode file title");
    assert.match(showContinueCard!.detail, /第 1 季 第 2 集/, `continue copy names the season and episode: ${JSON.stringify(showContinueCard)}`);
    assert.doesNotMatch(continueMin.cards.map((entry: { title: string }) => entry.title).join(" | "), /Next Episode/, "episode file titles never leak into the home continue shelf");
    assert.match(continueMin.scope, /2 部作品/, "continue count matches the number of work cards");
    assert.equal(Number(continueMin.scope.match(/(\d+) 部作品/)?.[1] ?? 0), continueMin.cards.length);

    await evaluate(window, "document.querySelector('#hero-detail')?.click()");
    const homeDetail = await waitFor(
      "home hero detail origin",
      () => evaluate(window, "({ hidden: document.querySelector('#media-detail')?.hidden, title: document.querySelector('#media-detail-title')?.textContent || '', backLabel: document.querySelector('#media-detail-back')?.textContent || '', navCurrent: document.querySelector('[data-nav][aria-current=\"page\"]')?.dataset.nav || '' })"),
      (value) => value.hidden === false && value.title === LONG_TITLE,
    );
    assert.match(homeDetail.backLabel, /返回首页/, "detail opened from home names the home origin");
    assert.equal(homeDetail.navCurrent, "home", "home stays the highlighted navigation item while its detail is open");
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    await waitFor("back to home from hero detail", () => evaluate(window, "document.querySelector('#media-detail')?.hidden"), (hidden) => hidden === true);
    await waitFor("home restored after detail", () => evaluate(window, "({ nav: document.querySelector('[data-nav][aria-current=\"page\"]')?.dataset.nav || '', hero: document.querySelector('#home-hero')?.hidden })"), (value) => value.nav === "home" && value.hero === false);

    window.restore();
    window.show();
    window.focus();
    await waitFor("window focus for default size check", async () => window.isMinimized(), (minimized) => minimized === false);
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
    assert.equal(await stat(fixtureRoot).then(() => true).catch(() => false), false, "the fixture root is gone before the offline rescan");
    await evaluate(window, "document.querySelector('[data-nav=folder]')?.click()");
    const readFolders = () => evaluate(window, `(() => {
      const cards = [...document.querySelectorAll('#source-list [data-source-card-id]')].map((card) => ({ text: card.textContent || '', sourceId: card.dataset.sourceCardId || '', available: card.dataset.available !== 'false' }));
      return {
        visible: document.querySelector('#sources-page')?.hidden === false,
        navCurrent: document.querySelector('[data-nav=folder]')?.getAttribute('aria-current') || '',
        cards,
        sourceText: document.querySelector('#source-list')?.textContent || '',
        rescanAllVisible: Boolean(document.querySelector('#rescan-all-button')),
        refreshDisabled: document.querySelector('[data-refresh-source-id]')?.disabled === true,
        message: document.querySelector('#sources-message')?.textContent || '',
        offlineOpen: document.querySelector('#offline-source-dialog')?.open === true,
        offlineTitle: document.querySelector('#offline-source-title')?.textContent || '',
        offlineCopy: document.querySelector('#offline-source-copy')?.textContent || '',
        activeId: document.activeElement?.id || '',
        removeOpen: document.querySelector('#remove-source-dialog')?.open === true,
        removeCopy: document.querySelector('#remove-source-copy')?.textContent || '',
        removeConfirmClass: document.querySelector('#remove-source-confirm')?.className || '',
        removeConfirmText: document.querySelector('#remove-source-confirm')?.textContent || '',
        removeError: document.querySelector('#remove-source-error')?.textContent || '',
        removeErrorHidden: document.querySelector('#remove-source-error')?.hidden !== false,
        libraryCards: document.querySelectorAll('#library-grid .media-card').length,
      };
    })()`);
    const folderPage = await waitFor("folder page for the scanned folder", readFolders, (value) => value.visible && value.navCurrent === "page" && value.cards.length === 1);
    assert.match(folderPage.cards[0].text, /部作品/);
    assert.match(folderPage.cards[0].text, /集/);
    assert.match(folderPage.cards[0].text, /上级：|盘/u);
    assert.equal(folderPage.rescanAllVisible, true, "the folder page offers a rescan-all action");
    assert.equal(folderPage.sourceText.includes(fixtureRoot), false, "folder cards never expose the root path");
    await capture("folders");

    await evaluate(window, "document.querySelector('[data-refresh-source-id]')?.click()");
    const offlinePrompt = await waitFor("offline source question after rescan", readFolders, (value) => value.offlineOpen === true, 20_000);
    assert.match(offlinePrompt.offlineTitle, /现在不可用/);
    assert.match(offlinePrompt.offlineCopy, /暂时断开/);
    assert.match(offlinePrompt.offlineCopy, /已删除/);
    assert.match(offlinePrompt.offlineCopy, /观看进度/);
    assert.equal(offlinePrompt.activeId, "offline-source-keep", "the safe choice owns the default focus");
    assert.equal(await evaluate(window, "document.querySelector('#offline-source-delete')?.textContent"), "已删除（清理记录）");
    await evaluate(window, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
    await waitFor("offline question dismissed as temporary", readFolders, (value) => value.offlineOpen === false);
    const keptOffline = await waitFor("offline folder keeps its record", readFolders, (value) => value.cards.length === 1 && value.cards[0].available === false && /离线/.test(value.cards[0].text));
    assert.match(keptOffline.cards[0].text, /部作品/);
    await capture("folders-offline");

    await evaluate(window, "document.querySelector('#rescan-all-button')?.click()");
    const offlinePromptAll = await waitFor("rescan all asks the offline question", readFolders, (value) => value.offlineOpen === true, 20_000);
    assert.match(offlinePromptAll.offlineCopy, /暂时断开/);
    await evaluate(window, "document.querySelector('#offline-source-keep')?.click()");
    await waitFor("offline question dismissed after rescan all", readFolders, (value) => value.offlineOpen === false);
    assert.equal((await readFolders()).cards.length, 1, "temporarily disconnected folders stay registered");

    await evaluate(window, "document.querySelector('[data-nav=all]')?.click()");
    const offlineNotice = await waitFor("library offline banner", () => evaluate(window, `(() => ({
      visible: document.querySelector('#library-offline-notice')?.hidden === false,
      text: document.querySelector('#library-offline-text')?.textContent || '',
      button: document.querySelector('#library-offline-folders')?.textContent || '',
    }))()`), (value) => value.visible);
    assert.match(offlineNotice.text, /离线/, "the work list states that a folder is offline");
    assert.match(offlineNotice.text, /重新扫描/, "the offline banner explains how to recover");
    assert.equal(offlineNotice.button, "查看文件夹");
    await evaluate(window, "document.querySelector('#library-offline-folders')?.click()");
    await waitFor("offline banner opens the folder page", () => evaluate(window, "({ sources: document.querySelector('#sources-page')?.hidden === false, nav: document.querySelector('[data-nav][aria-current=page]')?.dataset.nav || '' })"), (value) => value.sources === true && value.nav === "folder");
    await evaluate(window, "document.querySelector('[data-nav=all]')?.click()");
    await evaluate(window, "(() => { const search = document.querySelector('#library-search-input'); search.value = 'Owned UX Audit Feature Film 2026'; search.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor("offline movie card", () => evaluate(window, "document.querySelector('#library-grid .media-card-title')?.textContent || ''"), (value) => value === LONG_TITLE);
    await evaluate(window, "document.querySelector('#library-grid [data-media-id]')?.click()");
    const offlineDetail = await waitFor(
      "offline movie detail",
      () => evaluate(window, `(() => ({
        bannerVisible: document.querySelector('#detail-offline-banner')?.hidden === false,
        bannerText: document.querySelector('#detail-offline-banner')?.textContent || '',
        openDisabled: document.querySelector('#media-detail-open')?.disabled === true,
        playText: document.querySelector('#media-detail-open')?.textContent || '',
        restartDisabled: document.querySelector('#media-detail-restart')?.disabled === true,
        restartHidden: document.querySelector('#media-detail-restart')?.hidden,
        noteHidden: document.querySelector('#detail-playback-note')?.hidden,
        noteText: document.querySelector('#detail-playback-note')?.textContent || '',
        resumeText: document.querySelector('#media-detail-resume')?.textContent || '',
        backLabel: document.querySelector('#media-detail-back')?.textContent || '',
        navCurrent: document.querySelector('[data-nav][aria-current="page"]')?.dataset.nav || '',
      }))()`),
      (value) => value.bannerVisible && value.openDisabled,
    );
    assert.equal(offlineDetail.restartDisabled, true, "offline movie cannot restart playback");
    assert.equal(offlineDetail.restartHidden, false, "saved progress keeps the restart action visible but disabled");
    assert.match(offlineDetail.bannerText, /重新连接|重新扫描/, "offline banner explains how to recover");
    assert.equal(offlineDetail.noteHidden, false, "the disabled play actions state their reason nearby");
    assert.match(offlineDetail.noteText, /离线|重新连接/, "the reason is written next to the buttons");
    assert.doesNotMatch(offlineDetail.resumeText, /可继续/, "an offline detail never claims playback can be resumed");
    assert.match(offlineDetail.backLabel, /返回搜索结果/, "offline detail keeps the search origin");
    assert.equal(offlineDetail.navCurrent, "all");
    await capture("movie-offline");
    await evaluate(window, "document.querySelector('#media-detail-back')?.click()");
    await waitFor("offline detail back to search", () => evaluate(window, "({ hidden: document.querySelector('#media-detail')?.hidden, query: document.querySelector('#library-search-input')?.value || '', title: document.querySelector('#library-grid .media-card-title')?.textContent || '' })"), (value) => value.hidden === true && value.query === "Owned UX Audit Feature Film 2026" && value.title === LONG_TITLE);

    await evaluate(window, "document.querySelector('[data-nav=folder]')?.click()");
    await waitFor("folder page before removal", readFolders, (value) => value.visible && value.cards.length === 1);
    await evaluate(window, "document.querySelector('[data-remove-source-id]')?.click()");
    const removePrompt = await waitFor("remove dialog with counts", readFolders, (value) => value.removeOpen === true);
    assert.match(removePrompt.removeCopy, /将从片库移除 \d+ 部作品、\d+ 集/);
    assert.match(removePrompt.removeCopy, /观看进度/);
    assert.match(removePrompt.removeCopy, /不会删除源文件/);
    assert.match(removePrompt.removeConfirmClass, /destructive-button/);
    assert.equal(removePrompt.removeConfirmText, "移除并删除进度");
    assert.equal(removePrompt.activeId, "remove-source-cancel", "cancel is the default focus");
    await evaluate(window, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
    await waitFor("remove dialog dismissed by Esc", readFolders, (value) => value.removeOpen === false);
    assert.equal((await readFolders()).cards.length, 1, "Esc cancels removal without changing the folder");

    await evaluate(window, "document.querySelector('[data-remove-source-id]')?.click()");
    await waitFor("remove dialog reopened", readFolders, (value) => value.removeOpen === true);
    failNextSourceRemove = true;
    await evaluate(window, "document.querySelector('#remove-source-confirm')?.click()");
    const removeFailure = await waitFor("remove failure stays in the dialog", readFolders, (value) => value.removeOpen === true && value.removeErrorHidden === false);
    assert.match(removeFailure.removeError, /占用|重试/);
    assert.equal(removeFailure.removeConfirmText, "重试移除");
    assert.equal(removeFailure.cards.length, 1, "a failed removal leaves the folder record intact");
    await evaluate(window, "document.querySelector('#remove-source-confirm')?.click()");
    const removed = await waitFor("remove retry succeeds", readFolders, (value) => value.removeOpen === false && value.cards.length === 0 && /还没有添加文件夹/.test(value.sourceText), 20_000);
    assert.equal(removed.libraryCards, 0, "removing the folder refreshes the library too");
    assert.match(await evaluate(window, "document.querySelector('#app-notice')?.textContent || ''"), /源文件没有被删除/);
    await capture("folders-removed");

    window.setSize(900, 640);
    await evaluate(window, "document.querySelector('[data-nav=all]')?.click()");
    const compactEmpty = await waitFor("no-source empty CTA at 900x640", () => evaluate(window, `(() => {
      const card = document.querySelector('#library-empty');
      card?.scrollIntoView({ block: 'end' });
      const rect = card?.getBoundingClientRect();
      return {
        visible: card?.hidden === false,
        title: document.querySelector('#library-empty-title')?.textContent || '',
        addFolder: document.querySelector('#empty-add-folder')?.hidden === false,
        addVideo: document.querySelector('#empty-add-video')?.hidden === false,
        clearSearchHidden: document.querySelector('#empty-clear-search')?.hidden !== false,
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null,
      };
    })()`), (value) => value.viewport.width <= 900 && value.visible && value.title === "还没有本地来源");
    assert.equal(compactEmpty.addFolder, true, "the no-source empty state offers 添加文件夹");
    assert.equal(compactEmpty.addVideo, true, "the no-source empty state offers 添加单个视频");
    assert.equal(compactEmpty.clearSearchHidden, true, "a no-source empty state does not offer 清除搜索");
    assert.ok(compactEmpty.rect!.left >= 0 && compactEmpty.rect!.right <= compactEmpty.viewport.width + 1 && compactEmpty.rect!.top >= 0 && compactEmpty.rect!.bottom <= compactEmpty.viewport.height + 1, `the empty state is not clipped at 900x640: ${JSON.stringify(compactEmpty)}`);
    await capture("empty-compact");

    window.webContents.send(IPC_CHANNELS.localLibraryState, { status: "error", schemaVersion: 2, sqliteAvailable: false, sources: [], error: { code: "storage", message: "片库暂时不可用" } });
    const compactError = await waitFor("storage error card at 900x640", () => evaluate(window, `(() => {
      const card = document.querySelector('#library-error');
      card?.scrollIntoView({ block: 'end' });
      const rect = card?.getBoundingClientRect();
      return {
        visible: card?.hidden === false,
        title: document.querySelector('#library-error-title')?.textContent || '',
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null,
      };
    })()`), (value) => value.viewport.width <= 900 && value.visible);
    assert.equal(compactError.title, "片库文件暂时无法读写");
    assert.ok(compactError.rect!.left >= 0 && compactError.rect!.right <= compactError.viewport.width + 1 && compactError.rect!.top >= 0 && compactError.rect!.bottom <= compactError.viewport.height + 1, `the error card is not clipped at 900x640: ${JSON.stringify(compactError)}`);
    await capture("error-compact");
    await evaluate(window, "document.querySelector('#library-error-retry')?.click()");
    await waitFor("storage error retry recovers at compact size", () => evaluate(window, "document.querySelector('#library-error')?.hidden"), (hidden) => hidden === true);
    window.setSize(1040, 720);
    await waitFor("default size restored after compact state checks", () => evaluate(window, "document.documentElement.clientWidth"), (width) => Number(width) > 1000);

    const diagnostics = await readFile(join(logDir, "diagnostics.jsonl"), "utf8").catch(() => "");
    assert.match(diagnostics, /"operation":"window\.renderer-ready"/);
    assert.match(diagnostics, /"operation":"local-library\.list"/);
    assert.match(diagnostics, /"operation":"local-library\.list-collections"/);
    assert.doesNotMatch(diagnostics, /session\.restore|session\.login|discovery\.start/);
    const resultPath = process.env.Z_VIDEO_LOCAL_LIBRARY_APP_RESULT;
    if (!resultPath) throw new Error("Z_VIDEO_LOCAL_LIBRARY_APP_RESULT is required");
    await writeFile(resultPath, JSON.stringify({
      schemaVersion: 1,
      proof: "local-library-ux",
      scan: { runningPill: firstRunning.pillText, runningCard: firstRunning.cardText.slice(0, 160), welcomeCoexists: firstRunning.onboardingVisible, cancelledPageTotal: preserved.pageTotal, cancelledNotice: cancelled.noticeTitle, completedPageTotal: completedTotal.pageTotal, completedNotice: complete.noticeTitle, summary: summaryText.slice(0, 200), compact: { pill: compactScan.pillRect, card: compactScan.cardRect, viewport: compactScan.viewport } },
      home: { recentHeading: homeShelves.recentHeading, recentCount: homeShelves.recent.length, recent: homeShelves.recent.slice(0, 3), shows: homeShelves.shows, sortLabels: homeShelves.sortLabels },
      collections: {
        showCards,
        showDetail: { title: showDetail.title, episodeRows: showDetail.count, currentIndex: showDetail.currentIndex, currentNumber: showDetail.currentNumber },
        episodeCards: { count: episodeCards.count, titles: episodeCards.titles, scope: episodeCards.scope },
        allScope: allWorks.scope,
        movieScope: movieWorks.scope,
      },
      releaseSort: { menu: sortMenu.options, firstTitle: released.firstTitle, firstMeta: released.firstMeta, secondMeta: released.secondMeta, unknownLabel: unknownDate, restored: restoredSort },
      defaultWindow: { outer: defaultOuter },
      detail: { default: { title: detail.title, plotLength: detail.plot.length, play: detail.button, viewport: detail.viewport }, minimum: { outer: minOuter, content: minContent, playVisible: minDetail.visible, viewport: minDetail.viewport } },
      player: { currentTitle: player.currentTitle, controlsHeight: player.controlsHeight, titleInControls: player.titleInControls, titleOutsideSurface: player.titleOutsideSurface },
      detailStates: {
        perEpisode: episodeStates.rows,
        loading: { skeleton: loadingState.skeletonVisible, contentHidden: loadingState.contentHidden, title: loadingState.title, posterImages: loadingState.posterImages, blocks: loadingState.skeletonBlocks },
        error: { message: detailError.message, buttons: detailError.buttons, contentHidden: detailError.contentHidden, focusedId: detailError.focusedId },
        longTitle: { text: detail.title, layout: detail.titleLayout, backLabel: detail.backLabel, nav: detail.navCurrent },
        origin: { secondPageBack: secondPageDetail.backLabel, episodeBack: episodeOrigin.backLabel, homeBack: homeDetail.backLabel, offlineBack: offlineDetail.backLabel, restoredScroll: originScroll.top },
        offline: { banner: offlineDetail.bannerText, note: offlineDetail.noteText, resume: offlineDetail.resumeText, disabled: { play: offlineDetail.openDisabled, restart: offlineDetail.restartDisabled } },
      },
      continueWatching: { minimum: continueMin, scope: continueMin.scope, cards: continueMin.cards, default: continueDefault, defaultContent: continueDefault.windowContent, defaultOuter: defaultAfterContinueOuter },
      removeFailure: { prompt: removePrompt.removeCopy, title: removePrompt.removeTitle, destructive: /destructive-button/.test(removePrompt.removeConfirmClass), defaultFocus: removePrompt.activeId, error: removeFailure.removeError, retryLabel: removeFailure.removeConfirmText },
      folders: { page: folderPage.cards.map((card: { text: string }) => card.text.slice(0, 160)), notice: folderPage.sourceText.includes(fixtureRoot) ? "root-leaked" : "safe", offline: { title: offlinePrompt.offlineTitle, copy: offlinePrompt.offlineCopy, kept: keptOffline.cards[0]?.text.slice(0, 120) }, rescanAllPrompt: offlinePromptAll.offlineCopy },
      pagination: {
        first: firstPage.status,
        last: lastPage.status,
        restored: restoredPage.scope,
        jumpError: invalidJump.error,
        clampedJump: clampedJump.status,
        pageError: { message: pageError.message, buttons: pageError.buttons, tech: pageError.tech },
        compact: compactPagination.rect,
        compactButtons: compactPagination.buttons,
        restoredScroll: originScroll.top,
      },
      states: {
        storage: { title: errorState.title, buttons: errorState.buttons, tech: errorState.tech },
        filterEmpty: filterEmpty.title,
        searchEmpty: { clearSearch: true },
        offline: offlineNotice.text,
        compactEmpty: { title: compactEmpty.title, addFolder: compactEmpty.addFolder, addVideo: compactEmpty.addVideo },
        compactError: compactError.title,
      },
    }, null, 2) + "\n", "utf8");
    process.stdout.write("PASS: production local-library UX smoke (home work shelves, continue row, all/movie/work counts, single-episode fallback, saved sort)\n");
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
