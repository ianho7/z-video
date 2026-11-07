import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, dialog } from "electron";

const LONG_TITLE = "Owned UX Audit Feature Film 2026 — Long Detail Title";
const LONG_PLOT = "这是用于本地片库窗口验收的自有长剧情素材。它故意包含多行文字，验证详情页在长标题和长剧情下仍然把播放操作放在首屏，并允许用户展开或收起剧情简介。第二段继续描述一个不应遮挡播放按钮的本地媒体故事，内容只服务于隔离测试，不代表真实用户片名或路径。";
const INDEX_FILE_COUNT = 1_500;
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
      (value) => value.scanStatus.includes("扫描中") && value.cardTitle === LONG_TITLE && value.sourceCount > 0,
      20_000,
    );
    assert.equal(running.cardTitle, LONG_TITLE);
    assert.ok(running.sourceCount > 0);

    await waitFor(
      "scan completion",
      () => evaluate(window, "({ status: document.querySelector('#scan-status')?.textContent || '', count: Number((document.querySelector('#page-scope')?.textContent || '').match(/\\d+/)?.[0] || 0) })"),
      (value) => value.status.includes("扫描完成") && value.count >= INDEX_FILE_COUNT + 1,
      35_000,
    );

    await evaluate(window, "(() => { const search = document.querySelector('#library-search-input'); if (!(search instanceof HTMLInputElement)) throw new Error('search missing'); search.value = 'Owned UX Audit Feature Film 2026'; search.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor("long title card", () => evaluate(window, "document.querySelector('.media-card-title')?.textContent || ''"), (value) => value === LONG_TITLE);
    await evaluate(window, "document.querySelector('[data-media-id]')?.click()");

    const detail = await waitFor(
      "long detail view",
      () => evaluate(window, "(() => { const button = document.querySelector('#media-detail-open')?.getBoundingClientRect(); return { hidden: document.querySelector('#media-detail')?.hidden, title: document.querySelector('#media-detail-title')?.textContent || '', plot: document.querySelector('#media-detail-plot')?.textContent || '', button: button ? { left: button.left, right: button.right, top: button.top, bottom: button.bottom } : undefined, viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight } }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.plot.length >= LONG_PLOT.length && Boolean(value.button),
    );
    assert.equal(detail.title, LONG_TITLE);
    assert.equal(detail.plot, LONG_PLOT);

    window.setSize(900, 640);
    const minDetail = await evaluate(window, "(() => { const button = document.querySelector('#media-detail-open')?.getBoundingClientRect(); const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }; return { visible: Boolean(button && button.left >= 0 && button.right <= viewport.width && button.top >= 0 && button.bottom <= viewport.height) }; })()");
    assert.equal(minDetail.visible, true);

    await evaluate(window, "document.querySelector('#library-search-clear')?.click()");
    await evaluate(window, "document.querySelector('#media-detail-open')?.click()");
    const player = await waitFor(
      "player title and controls",
      () => evaluate(window, "(() => { const view = document.querySelector('[data-view=\"player\"]'); const surface = document.querySelector('.player-surface')?.getBoundingClientRect(); const controls = document.querySelector('.player-controls')?.getBoundingClientRect(); const title = document.querySelector('#player-current-title')?.getBoundingClientRect(); const toggle = document.querySelector('#player-toggle-button'); return { visible: view?.hidden === false, currentTitle: document.querySelector('#player-current-title')?.textContent || '', ready: toggle?.disabled === false, controlsHeight: controls?.height || 0, titleInControls: Boolean(title && controls && title.top >= controls.top && title.bottom <= controls.bottom), titleOutsideSurface: Boolean(title && surface && title.top >= surface.bottom) }; })()"),
      (value) => value.visible && value.currentTitle === LONG_TITLE && value.controlsHeight >= 152 && value.titleInControls && value.titleOutsideSurface && value.ready,
      15_000,
    );
    assert.equal(player.currentTitle, LONG_TITLE);

    await evaluate(window, "window.zVideo.localPlayback.command({ type: 'seek', positionSec: 5 })");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await evaluate(window, "document.querySelector('#player-close-button')?.click()");
    const continueMin = await waitFor(
      "continue row at minimum size",
      () => evaluate(window, "(() => { const card = document.querySelector('.continue-card strong'); return { hidden: document.querySelector('#continue-section')?.hidden, title: card?.textContent || '', top: card?.getBoundingClientRect().top || -1, bottom: card?.getBoundingClientRect().bottom || -1, height: document.documentElement.clientHeight }; })()"),
      (value) => value.hidden === false && value.title === LONG_TITLE && value.top >= 0 && value.bottom <= value.height,
      10_000,
    );
    assert.equal(continueMin.title, LONG_TITLE);

    window.setSize(1040, 720);
    const continueDefault = await waitFor(
      "continue row at default size",
      () => evaluate(window, "({ outer: window.outerWidth, content: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }, hidden: document.querySelector('#continue-section')?.hidden, title: document.querySelector('.continue-card strong')?.textContent || '' })"),
      (value) => value.hidden === false && value.title === LONG_TITLE,
    );
    assert.ok(continueDefault.outer >= 1040);
    assert.ok(continueDefault.content.width > 0 && continueDefault.content.height > 0);

    await quitProductionApp();
    const diagnostics = await readFile(join(logDir, "diagnostics.jsonl"), "utf8").catch(() => "");
    assert.match(diagnostics, /"operation":"window\.renderer-ready"/);
    assert.match(diagnostics, /"operation":"local-library\.list"/);
    assert.doesNotMatch(diagnostics, /session\.restore|session\.login|discovery\.start/);
    process.stdout.write("PASS: production local-library UX smoke (running scan, detail/player layout, continue row)\n");
  } finally {
    dialog.showOpenDialog = originalShowOpenDialog;
    if (app.isReady()) await quitProductionApp();
    await rm(profile, { recursive: true, force: true });
  }
}

void run().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  app.exit(1);
});
