import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, dialog } from "electron";

const LONG_TITLE = "Owned UX Audit Feature Film 2026 — Long Detail Title";
const LONG_PLOT = "这是用于本地片库窗口验收的自有长剧情素材。它故意包含多行文字，验证详情页在长标题和长剧情下仍然把播放操作放在首屏，并允许用户展开或收起剧情简介。第二段继续描述一个不应遮挡播放按钮的本地媒体故事，内容只服务于隔离测试，不代表真实用户片名或路径。".repeat(3);
const INDEX_FILE_COUNT = 8_000;
const APP_TIMEOUT_MS = 55_000;
let appDeadline = 0;

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
    "  <rating>8.7</rating>",
    "  <genre>Drama</genre>",
    "  <plot>" + LONG_PLOT + "</plot>",
    "</movie>",
    "",
  ].join("\n");
  await writeFile(join(root, "00-owned-feature.nfo"), featureNfo, "utf8");

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

    const initial = await waitFor(
      "fresh local-library empty state",
      () => evaluate(window, "({ localApi: typeof window.zVideo.localLibrary === 'object', emptyTitle: document.querySelector('#library-empty-title')?.textContent || '', sourceText: document.querySelector('#source-list')?.textContent || '' })"),
      (value) => value.localApi && value.emptyTitle === "还没有本地来源" && value.sourceText.includes("尚未添加来源"),
    );
    assert.equal(initial.localApi, true);

    window.setSize(1040, 720);
    const defaultOuter = window.getSize();
    assert.ok(defaultOuter[0] >= 1040 && defaultOuter[1] >= 720);

    await evaluate(window, "document.querySelector('#choose-folder-button')?.click()");
    const running = await waitFor(
      "running scan card and source count",
      () => evaluate(window, "({ scanStatus: document.querySelector('#scan-status')?.textContent || '', cardTitle: document.querySelector('.media-card-title')?.textContent || '', sourceCount: Number(document.querySelector('#all-source-count')?.textContent || 0) })"),
      (value) => value.scanStatus.includes("扫描中") && value.cardTitle.length > 0 && value.sourceCount > 0,
      20_000,
    );
    assert.ok(running.cardTitle.length > 0);
    assert.ok(running.sourceCount > 0);

    const complete = await waitFor(
      "scan completion",
      () => evaluate(window, "({ status: document.querySelector('#scan-status')?.textContent || '', count: Number((document.querySelector('#page-scope')?.textContent || '').match(/\\d+/)?.[0] || 0) })"),
      (value) => value.status.includes("扫描完成") && value.count >= INDEX_FILE_COUNT + 1,
      35_000,
    );

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
      () => evaluate(window, "(() => { const button = document.querySelector('#media-detail-open')?.getBoundingClientRect(); const plot = document.querySelector('#media-detail-plot'); const toggle = document.querySelector('#media-detail-plot-toggle'); return { hidden: document.querySelector('#media-detail')?.hidden, title: document.querySelector('#media-detail-title')?.textContent || '', meta: document.querySelector('#media-detail-meta')?.textContent || '', plot: plot?.textContent || '', plotCollapsed: plot?.classList.contains('collapsed'), plotExpanded: toggle?.getAttribute('aria-expanded'), movieInfo: document.querySelector('#detail-file-info')?.textContent || '', episodesHidden: document.querySelector('#detail-episodes-section')?.hidden, button: button ? { left: button.left, right: button.right, top: button.top, bottom: button.bottom } : undefined, viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight } }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.plot.length >= LONG_PLOT.length && Boolean(value.button),
    );
    assert.equal(detail.title, LONG_TITLE);
    assert.equal(detail.plot, LONG_PLOT);
    assert.equal(detail.plotCollapsed, true, "long synopsis starts collapsed to three lines");
    assert.equal(detail.plotExpanded, "false");
    assert.match(detail.meta, /2026/);
    assert.match(detail.meta, /8\.7/);
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
    const minContent = window.getContentSize();
    const minDetail = await evaluate(window, "(() => { const button = document.querySelector('#media-detail-open')?.getBoundingClientRect(); const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }; const inner = { width: window.innerWidth, height: window.innerHeight }; return { visible: Boolean(button && button.left >= 0 && button.right <= viewport.width && button.top >= 0 && button.bottom <= viewport.height), viewport, inner }; })()");
    assert.ok(minOuter[0] >= 900 && minOuter[1] >= 640);
    assert.ok(Math.abs(minContent[0] - minDetail.inner.width) <= 4 && Math.abs(minContent[1] - minDetail.inner.height) <= 4);
    assert.equal(minDetail.visible, true);

    await evaluate(window, "document.querySelector('#library-search-clear')?.click()");
    await evaluate(window, "document.querySelector('#media-detail-open')?.click()");
    const player = await waitFor(
      "player title and controls",
      () => evaluate(window, "(() => { const view = document.querySelector('[data-view=\"player\"]'); const surface = document.querySelector('.player-surface')?.getBoundingClientRect(); const controls = document.querySelector('.player-controls')?.getBoundingClientRect(); const title = document.querySelector('#player-current-title')?.getBoundingClientRect(); const toggle = document.querySelector('#player-toggle-button'); return { visible: view?.hidden === false, currentTitle: document.querySelector('#player-current-title')?.textContent || '', ready: toggle?.disabled === false, controlsHeight: controls?.height || 0, titleInControls: Boolean(title && controls && title.top >= controls.top && title.bottom <= controls.bottom), titleOutsideSurface: Boolean(title && surface && title.top >= surface.bottom) }; })()"),
      (value) => value.visible && value.currentTitle === LONG_TITLE && Math.abs(value.controlsHeight - 152) < 1 && value.titleInControls && value.titleOutsideSurface && value.ready,
      15_000,
    );
    assert.equal(player.currentTitle, LONG_TITLE);

    await evaluate(window, "window.zVideo.localPlayback.command({ type: 'seek', positionSec: 5 })");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await evaluate(window, "document.querySelector('#player-close-button')?.click()");
    await evaluate(window, "document.querySelector('[data-nav=home]')?.click()");
    const continueMin = await waitFor(
      "continue row at minimum size",
      () => evaluate(window, "(() => { const card = document.querySelector('.continue-card .continue-copy > strong'); const firstTitle = document.querySelector('.media-card-title'); const firstRect = firstTitle?.getBoundingClientRect(); return { hidden: document.querySelector('#continue-section')?.hidden, title: card?.textContent || '', top: card?.getBoundingClientRect().top || -1, bottom: card?.getBoundingClientRect().bottom || -1, firstTitle: firstTitle?.textContent || '', firstTop: firstRect?.top || -1, firstBottom: firstRect?.bottom || -1, height: document.documentElement.clientHeight }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.title.length > 0 && value.firstTitle.length > 0,
      10_000,
    );
    assert.equal(continueMin.title, LONG_TITLE);
    assert.ok(continueMin.firstTitle.length > 0);

    window.setSize(1040, 720);
    const defaultAfterContinueOuter = window.getSize();
    const defaultAfterContinueContent = window.getContentSize();
    const continueDefault = await waitFor(
      "continue row at default size",
      () => evaluate(window, "(() => { const firstTitle = document.querySelector('.media-card-title'); const rect = firstTitle?.getBoundingClientRect(); return { outer: { width: window.outerWidth, height: window.outerHeight }, content: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }, inner: { width: window.innerWidth, height: window.innerHeight }, hidden: document.querySelector('#continue-section')?.hidden, title: document.querySelector('.continue-card .continue-copy > strong')?.textContent || '', firstTitle: firstTitle?.textContent || '', firstTop: rect?.top || -1, firstBottom: rect?.bottom || -1 }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.firstTitle.length > 0,
    );
    assert.ok(defaultAfterContinueOuter[0] >= 1040 && defaultAfterContinueOuter[1] >= 720);
    assert.ok(Math.abs(defaultAfterContinueContent[0] - continueDefault.inner.width) <= 4 && Math.abs(defaultAfterContinueContent[1] - continueDefault.inner.height) <= 4, `content=${JSON.stringify(defaultAfterContinueContent)} inner=${JSON.stringify(continueDefault.inner)}`);
    assert.ok(continueDefault.content.width > 0 && continueDefault.content.height > 0);
    assert.ok(continueDefault.firstTitle.length > 0);

    const diagnostics = await readFile(join(logDir, "diagnostics.jsonl"), "utf8").catch(() => "");
    assert.match(diagnostics, /"operation":"window\.renderer-ready"/);
    assert.match(diagnostics, /"operation":"local-library\.list"/);
    assert.doesNotMatch(diagnostics, /session\.restore|session\.login|discovery\.start/);
    const resultPath = process.env.Z_VIDEO_LOCAL_LIBRARY_APP_RESULT;
    if (!resultPath) throw new Error("Z_VIDEO_LOCAL_LIBRARY_APP_RESULT is required");
    await writeFile(resultPath, JSON.stringify({
      schemaVersion: 1,
      proof: "local-library-ux",
      scan: { runningCardTitle: running.cardTitle, runningSourceCount: running.sourceCount, completedCount: complete.count },
      defaultWindow: { outer: defaultOuter },
      detail: { default: { title: detail.title, plotLength: detail.plot.length, play: detail.button, viewport: detail.viewport }, minimum: { outer: minOuter, content: minContent, playVisible: minDetail.visible, viewport: minDetail.viewport } },
      player: { currentTitle: player.currentTitle, controlsHeight: player.controlsHeight, titleInControls: player.titleInControls, titleOutsideSurface: player.titleOutsideSurface },
      continueWatching: { minimum: continueMin, default: continueDefault, defaultContent: defaultAfterContinueContent, defaultOuter: defaultAfterContinueOuter },
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
