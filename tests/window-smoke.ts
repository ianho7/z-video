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
  seasonNumber?: number;
  episodeNumber?: number;
  collectionId?: string;
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
const episodeOne: SmokeItem = { ...item, mediaId: "media_123e4567-e89b-12d3-a456-426614174006", title: "第一集", kind: "episode", collectionId: "collection_episode", seasonNumber: 1, episodeNumber: 1 };
const episodeTwo: SmokeItem = { ...item, mediaId: "media_123e4567-e89b-12d3-a456-426614174007", title: "第二集", kind: "episode", collectionId: "collection_episode", seasonNumber: 1, episodeNumber: 2 };
const items: SmokeItem[] = [item, broken, delayed, replacement, fanartOnly, good, episodeOne, episodeTwo];
const otherSourceId = "source_123e4567-e89b-12d3-a456-426614174001";
const state = {
  status: "ready",
  schemaVersion: 3,
  sqliteAvailable: true,
  sources: [
    { sourceId: item.sourceId, label: "Movies", locationHint: "D 盘 · 上级：影片", available: true, degraded: false, itemCount: 34, collectionCount: 12 },
    { sourceId: otherSourceId, label: "Movies", locationHint: "E 盘 · 上级：备份", available: false, degraded: false, itemCount: 9, collectionCount: 4 },
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
      collectionId: entry.collectionId ?? `collection_${entry.mediaId}`,
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
  ipcMain.handle("local-library:get", async (_event, mediaId: string) => {
    if (mediaId === episodeOne.mediaId) {
      return { state, detail: { item: episodeOne, collectionTitle: "窗口测试剧", collectionKind: "show", episodes: [episodeOne, episodeTwo] } };
    }
    return { state, item: items.find((candidate) => candidate.mediaId === mediaId) };
  });
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
  const playbackOpens: string[] = [];
  ipcMain.handle("local-playback:open", async (_event, request: { mediaId: string }) => {
    playbackOpens.push(request.mediaId);
    return { opened: true };
  });
  ipcMain.handle("local-playback:command", async () => undefined);

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
  window.show();
  window.focus();

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

  // B6a: app-native controls, font and desktop feel.
  const readFeel = () => window.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    const searchBox = document.querySelector('#library-search-form');
    const searchInput = document.querySelector('#library-search-input');
    const sortTrigger = document.querySelector('#library-sort-trigger');
    const textTarget = document.querySelector('#library-title');
    const prevented = (element, type) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      nativeSelects: document.querySelectorAll('select').length,
      sortTrigger: Boolean(sortTrigger),
      sortValue: document.querySelector('#library-sort-value')?.textContent || '',
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontLoaded: document.fonts.check('400 16px Nunito') && document.fonts.check('900 16px Nunito'),
      cardMetaFont: document.querySelector('.media-card-meta') ? getComputedStyle(document.querySelector('.media-card-meta')).fontFamily : '',
      cardMetaSize: document.querySelector('.media-card-meta') ? getComputedStyle(document.querySelector('.media-card-meta')).fontSize : '',
      bodySelect: getComputedStyle(document.body).userSelect,
      textSelect: getComputedStyle(textTarget).userSelect,
      inputSelect: getComputedStyle(searchInput).userSelect,
      searchBoxBorder: getComputedStyle(searchBox).borderTopWidth,
      searchInputBorder: getComputedStyle(searchInput).borderTopWidth,
      searchInputOutline: getComputedStyle(searchInput).outlineStyle,
      contextPrevented: prevented(textTarget, 'contextmenu'),
      dragPrevented: prevented(textTarget, 'dragstart'),
      selectTextPrevented: prevented(textTarget, 'selectstart'),
      selectInputAllowed: !prevented(searchInput, 'selectstart'),
    };
  })()`, true) as Promise<Record<string, unknown>>;
  const feel = await readFeel();
  assert.equal(feel.nativeSelects, 0, "the app window exposes zero native select controls");
  assert.equal(feel.sortTrigger, true, "sorting is an app menu trigger");
  assert.equal(feel.sortValue, "最近观看", "the sort trigger names the active order");
  assert.match(String(feel.fontFamily), /^Nunito,/, "Nunito leads the app font stack");
  assert.match(String(feel.fontFamily), /Microsoft YaHei UI/, "Chinese falls back to the system UI face");
  assert.equal(feel.fontLoaded, true, "the embedded Nunito woff2 covers body and heavy weights");
  assert.match(String(feel.cardMetaFont), /^Nunito,/, "font shorthands keep the same Nunito-first stack");
  assert.equal(feel.cardMetaSize, "12px", "font shorthands with the shared family stay valid");
  assert.equal(feel.bodySelect, "none", "app text is not selectable");
  assert.equal(feel.textSelect, "none", "body copy is not selectable");
  assert.equal(feel.inputSelect, "text", "inputs keep native text selection");
  assert.equal(feel.searchBoxBorder, "0px", "the search shell has no rectangular border");
  assert.equal(feel.searchInputBorder, "0px", "the search input has no rectangular border");
  assert.equal(feel.searchInputOutline, "none", "the search input never paints its own focus box");
  assert.equal(feel.contextPrevented, true, "text context menus are suppressed");
  assert.equal(feel.dragPrevented, true, "text dragging is suppressed");
  assert.equal(feel.selectTextPrevented, true, "non-input text selection is suppressed");
  assert.equal(feel.selectInputAllowed, true, "input selection stays native");

  const focusFeel = await window.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('#library-sort-trigger');
    trigger.focus();
    const programmatic = { visible: trigger.matches(':focus-visible'), outline: getComputedStyle(trigger).outlineStyle };
    trigger.blur();
    const input = document.querySelector('#library-search-input');
    input.focus();
    const box = document.querySelector('#library-search-form');
    const search = { outline: getComputedStyle(input).outlineStyle, shadow: getComputedStyle(box).boxShadow, visible: input.matches(':focus-visible') };
    input.blur();
    return { programmatic, search };
  })()`, true) as { programmatic: { visible: boolean; outline: string }; search: { outline: string; shadow: string; visible: boolean } };
  assert.equal(focusFeel.programmatic.visible, false, "pointer/programmatic focus does not match :focus-visible");
  assert.equal(focusFeel.programmatic.outline, "none", "a mouse-focused control never paints a rectangle");
  assert.equal(focusFeel.search.outline, "none", "the search input itself never paints a focus rectangle");
  assert.match(focusFeel.search.shadow, /inset/, "search focus is expressed by the outer pill");
  assert.match(focusFeel.search.shadow, /rgb\(201, 184, 255\) 0px 0px 0px 2px/, "the outer pill inset ring uses the lavender token");

  await window.webContents.executeJavaScript("document.querySelector('[data-nav=all]').click()", true);
  await waitFor(
    "all-media toolbar for the sort menu",
    () => window.webContents.executeJavaScript("(() => { const toolbar = document.querySelector('.all-media-toolbar'); return toolbar ? getComputedStyle(toolbar).display : ''; })()", true) as Promise<string>,
    (display) => display === "flex",
  );

  const openSortMenu = () => window.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('#library-sort-trigger');
    const popover = document.querySelector('#library-sort-options');
    if (popover?.hidden !== false) trigger?.click();
    const options = [...(popover?.querySelectorAll('[role="option"]') ?? [])];
    return {
      hidden: popover?.hidden,
      expanded: trigger?.getAttribute('aria-expanded') || '',
      haspopup: trigger?.getAttribute('aria-haspopup') || '',
      count: options.length,
      labels: options.map((option) => option.textContent || ''),
      selected: options.filter((option) => option.getAttribute('aria-selected') === 'true').map((option) => option.textContent || ''),
      focusedRole: document.activeElement?.getAttribute('role') || '',
      focusedId: document.activeElement?.id || '',
      triggerId: trigger?.id || '',
    };
  })()`, true) as Promise<{ hidden: boolean; expanded: string; haspopup: string; count: number; labels: string[]; selected: string[]; focusedRole: string; focusedId: string; triggerId: string }>;
  const sortMenu = await openSortMenu();
  assert.equal(sortMenu.hidden, false, "the sort trigger opens the app listbox");
  assert.equal(sortMenu.expanded, "true");
  assert.equal(sortMenu.haspopup, "listbox");
  assert.equal(sortMenu.count, 6, "the sort listbox exposes every supported order");
  assert.deepEqual(sortMenu.labels.slice(0, 3), ["最近观看", "最近加入", "最近发布"]);
  assert.deepEqual(sortMenu.selected, ["最近观看"], "the active order is aria-selected");
  assert.equal(sortMenu.focusedRole, "option", `opening the menu focuses the current option: ${JSON.stringify(sortMenu)}`);
  const pressMenuKey = (key: string) => window.webContents.executeJavaScript(`(() => {
    const target = document.activeElement;
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return {
      focusedId: document.activeElement?.id || '',
      focusedText: document.activeElement?.textContent || '',
      hidden: document.querySelector('#library-sort-options')?.hidden,
      expanded: document.querySelector('#library-sort-trigger')?.getAttribute('aria-expanded') || '',
      value: document.querySelector('#library-sort-value')?.textContent || '',
    };
  })()`, true) as Promise<{ focusedId: string; focusedText: string; hidden: boolean; expanded: string; value: string }>;
  const moved = await pressMenuKey("ArrowDown");
  assert.notEqual(moved.focusedId, sortMenu.focusedId, "arrow keys move between sort options");
  const last = await pressMenuKey("End");
  assert.equal(last.focusedText, "评分", "End moves to the last sort option");
  const first = await pressMenuKey("Home");
  assert.equal(first.focusedText, "最近观看", "Home moves to the first sort option");
  const chosen = await pressMenuKey("Enter");
  assert.equal(chosen.hidden, true, "Enter selects and closes the listbox");
  assert.equal(chosen.expanded, "false");
  assert.equal(chosen.focusedId, "library-sort-trigger", "selection returns focus to the trigger");
  assert.equal(chosen.value, "最近观看");
  await window.webContents.executeJavaScript("document.querySelector('#library-sort-trigger').click()", true);
  const escaped = await pressMenuKey("Escape");
  assert.equal(escaped.hidden, true, "Escape closes the listbox");
  assert.equal(escaped.focusedId, "library-sort-trigger", "Escape returns focus to the trigger");
  await window.webContents.executeJavaScript("document.querySelector('#library-sort-trigger').click()", true);
  const tabbed = await pressMenuKey("Tab");
  assert.equal(tabbed.hidden, true, "Tab closes the listbox");
  assert.equal(tabbed.focusedId, "library-sort-trigger", "Tab returns focus to the trigger");
  await window.webContents.executeJavaScript("document.querySelector('#library-sort-trigger').click()", true);
  const spaced = await pressMenuKey(" ");
  assert.equal(spaced.hidden, true, "Space selects the focused option");
  assert.equal(spaced.focusedId, "library-sort-trigger");
  await window.webContents.executeJavaScript("document.querySelector('#library-sort-trigger').click()", true);
  await window.webContents.executeJavaScript("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))", true);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#library-sort-options')?.hidden", true), true, "clicking outside closes the listbox");

  window.setSize(900, 640);
  await waitFor("900x640 sort menu layout", async () => window.webContents.executeJavaScript("document.documentElement.clientWidth", true) as Promise<number>, (width) => width <= 905);
  const compactFeel = await window.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('#library-sort-trigger');
    trigger?.click();
    const popover = document.querySelector('#library-sort-options');
    const menu = popover?.getBoundingClientRect();
    const triggerBox = trigger?.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const result = {
      viewport,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hidden: popover?.hidden,
      menu: menu ? { left: menu.left, right: menu.right, top: menu.top, bottom: menu.bottom } : null,
      trigger: triggerBox ? { left: triggerBox.left, right: triggerBox.right, top: triggerBox.top, bottom: triggerBox.bottom } : null,
    };
    popover && (popover.hidden = true);
    trigger?.setAttribute('aria-expanded', 'false');
    return result;
  })()`, true) as { viewport: { width: number; height: number }; overflowX: number; hidden: boolean; menu: { left: number; right: number; top: number; bottom: number } | null; trigger: { left: number; right: number; top: number; bottom: number } | null };
  assert.ok(compactFeel.trigger, "the sort trigger keeps a layout box at 900x640");
  assert.ok(compactFeel.trigger!.left >= 0 && compactFeel.trigger!.right <= compactFeel.viewport.width + 1, "the sort trigger stays inside 900x640");
  assert.ok(compactFeel.menu, "the sort listbox opens at 900x640");
  assert.ok(compactFeel.menu!.left >= 0 && compactFeel.menu!.right <= compactFeel.viewport.width + 1 && compactFeel.menu!.top >= 0 && compactFeel.menu!.bottom <= compactFeel.viewport.height + 1, `the sort listbox is not clipped at 900x640: ${JSON.stringify(compactFeel.menu)}`);
  assert.ok(compactFeel.overflowX <= 1, "900x640 never overflows horizontally");
  window.setSize(1040, 720);
  await waitFor("default size restored after B6a checks", async () => window.webContents.executeJavaScript("document.documentElement.clientWidth", true) as Promise<number>, (width) => width > 1000);
  await window.webContents.executeJavaScript("document.querySelector('[data-nav=home]').click()", true);
  await waitFor("home view restored after B6a checks", () => window.webContents.executeJavaScript("document.querySelector('#collection-section')?.hidden", true) as Promise<boolean>, (hidden) => hidden === true);

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
      cardState: document.querySelector('#home-scan-card')?.dataset.state || '',
      pillHidden: document.querySelector('#scan-status')?.hidden,
      scanPanelHidden: document.querySelector('#scan-panel')?.hidden,
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
  // Ticket 08: a finished scan collapses the folder-page panel. The summary
  // notice owns the counts while it is up, and the home result card takes over
  // once that notice is dismissed.
  assert.equal(cancelledNotice.scanPanelHidden, true, "the folder-page scan panel is collapsed on a terminal status");
  assert.equal(cancelledNotice.cardHidden, true, "the scan summary notice is the only summary while it is open");
  assert.equal(cancelledNotice.pillHidden, true);
  await window.webContents.executeJavaScript("document.querySelector('#app-notice-close').click()", true);
  const cancelledResult = await waitFor("cancelled result card after the notice", readScanState, (value) => value.noticeVisible === false && value.cardVisible);
  assert.match(cancelledResult.cardText, /上次扫描：扫描已取消/);
  assert.match(cancelledResult.cardText, /窗口测试文件夹/);
  assert.match(cancelledResult.cardText, /已扫描/);
  assert.match(cancelledResult.cardText, /已加入/);
  assert.match(cancelledResult.cardText, /已用时间/);
  assert.equal(cancelledResult.homeCancelVisible, false, "a finished scan offers no cancel action");
  assert.equal(cancelledResult.cardState, "done", "a kept result never looks like a running scan");

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
  assert.equal(completedNotice.cardHidden, true, "the completed scan summary notice owns the counts");
  assert.equal(completedNotice.scanPanelHidden, true);
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
  const completedResult = await waitFor("completed result card after the notice", readScanState, (value) => value.cardVisible && value.cardState === "done");
  assert.match(completedResult.cardText, /上次扫描：扫描完成/);
  assert.match(completedResult.cardText, /窗口测试文件夹/);
  assert.match(completedResult.cardText, /新增 986/);
  assert.match(completedResult.cardText, /更新 18/);
  assert.match(completedResult.cardText, /2 条警告/);
  assert.equal(completedResult.homeCancelVisible, false);

  await window.webContents.executeJavaScript("document.querySelector('[data-media-id]').click()", true);
  const detail = await waitFor("detail view", () => window.webContents.executeJavaScript(`({ hidden: document.querySelector('#media-detail')?.hidden, title: document.querySelector('#media-detail-title')?.textContent || '', viewingHidden: document.querySelector('#detail-viewing-section')?.hidden, viewingEmpty: document.querySelector('#detail-viewing-empty')?.textContent || '' })`, true) as Promise<{ hidden: boolean; title: string; viewingHidden: boolean; viewingEmpty: string }>, (value) => value.hidden === false && Boolean(value.title));
  assert.equal(detail.hidden, false);
  assert.equal(detail.title, "窗口测试影片");
  assert.equal(detail.viewingHidden, false, `detail always renders the viewing-record block: ${JSON.stringify(detail)}`);
  assert.match(detail.viewingEmpty, /还没有记录/, "a file without sessions renders one sentence, not zero counters");

  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  const queriesBeforeTyping = queries.length;
  await window.webContents.executeJavaScript("document.querySelector('#library-search-input').value = '窗口'; document.querySelector('#library-search-input').dispatchEvent(new Event('input', { bubbles: true }))", true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(queries.length, queriesBeforeTyping, "typing alone never issues a background library query");
  await window.webContents.executeJavaScript("document.querySelector('#library-search-form').requestSubmit()", true);
  await waitFor("search query", async () => queries.at(-1)?.query, (value) => value === "窗口");
  assert.equal(queries.at(-1)?.query, "窗口");
  const searchView = await waitFor(
    "explicit search view",
    () => window.webContents.executeJavaScript("({ hidden: document.querySelector('#search-section')?.hidden, title: document.querySelector('#search-title')?.textContent || '', count: document.querySelector('#search-count')?.textContent || '', back: document.querySelector('#search-back')?.textContent || '', cards: document.querySelectorAll('#search-grid .media-card').length })", true) as Promise<{ hidden: boolean; title: string; count: string; back: string; cards: number }>,
    (value) => value.hidden === false && value.title === "搜索「窗口」",
  );
  assert.match(searchView.count, /共 \d+ 部作品/);
  assert.match(searchView.back, /清空搜索/);
  assert.ok(searchView.cards > 0);
  await window.webContents.executeJavaScript("document.querySelector('[data-nav=folder]').click()", true);
  await waitFor(
    "top navigation clears the search query",
    () => window.webContents.executeJavaScript("({ query: document.querySelector('#library-search-input')?.value || '', searchHidden: document.querySelector('#search-section')?.hidden })", true) as Promise<{ query: string; searchHidden: boolean }>,
    (value) => value.query === "" && value.searchHidden === true,
  );
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

  // Ticket 08: degraded means "some directories were not read"; it is not offline
  // and it must never borrow the offline copy.
  const degradedSourceId = "source_123e4567-e89b-12d3-a456-426614174002";
  const baseSources = state.sources.map((source) => ({ ...source }));
  state.sources = [...baseSources, { sourceId: degradedSourceId, label: "Movies", locationHint: "F 盘 · 上级：片段", available: true, degraded: true, itemCount: 3, collectionCount: 1 }];
  window.webContents.send("local-library:state", state);
  const degradedFolder = await waitFor("degraded folder copy", readFolders, (value) => value.cards.length === 3 && /部分目录未读取/.test(value.cards[2]?.text || ""));
  assert.match(degradedFolder.cards[2].text, /部分目录未读取/);
  assert.doesNotMatch(degradedFolder.cards[2].text, /离线/, "a degraded folder is not an offline folder");
  assert.match(degradedFolder.cards[2].text, /仍可播放/);
  assert.equal(degradedFolder.cards[2].available, true, "a degraded folder stays usable");
  state.sources = baseSources;
  window.webContents.send("local-library:state", state);
  await waitFor("degraded folder reverted", readFolders, (value) => value.cards.length === 2);

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

  // B6b · motion system. Only a visible window advances CSS transitions, so this
  // block runs after window.show() and asserts real animation names/durations.
  const setMotionMedia = async (value: "reduce" | "no-preference") => {
    const debuggerSession = window.webContents.debugger;
    if (!debuggerSession.isAttached()) debuggerSession.attach("1.3");
    await debuggerSession.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value }] });
    await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
  };
  const readMotionEnv = () => window.webContents.executeJavaScript(`(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      dataMotion: document.documentElement.dataset.motion || '',
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      tokens: { one: root.getPropertyValue('--mo-1').trim(), two: root.getPropertyValue('--mo-2').trim(), three: root.getPropertyValue('--mo-3').trim(), four: root.getPropertyValue('--mo-4').trim(), back: root.getPropertyValue('--mo-return').trim() },
      easeOut: root.getPropertyValue('--ease-out').trim(),
      easeInout: root.getPropertyValue('--ease-inout').trim(),
    };
  })()`, true) as Promise<{ dataMotion: string; reduced: boolean; tokens: Record<string, string>; easeOut: string; easeInout: string }>;
  const readButtonMotion = (selector: string) => window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const style = element ? getComputedStyle(element) : null;
    return style ? { property: style.transitionProperty, duration: style.transitionDuration, animationName: style.animationName, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, focusVisible: element.matches(':focus-visible'), animations: element.getAnimations().map((animation) => ({ property: animation.transitionProperty || '', name: animation.animationName || '', duration: animation.effect ? animation.effect.getTiming().duration : null })) } : null;
  })()`, true) as Promise<{ property: string; duration: string; animationName: string; outlineStyle: string; outlineWidth: string; focusVisible: boolean; animations: Array<{ property: string; name: string; duration: number | null }> } | null>;
  const readFlight = () => window.webContents.executeJavaScript(`(() => {
    const flight = document.querySelector('#motion-flight');
    const content = document.querySelector('#detail-content');
    const poster = document.querySelector('#detail-poster');
    const animations = (element) => element ? element.getAnimations().map((animation) => ({ property: animation.transitionProperty || '', name: animation.animationName || '', duration: animation.effect ? animation.effect.getTiming().duration : null, easing: animation.effect ? animation.effect.getTiming().easing : '', properties: animation.effect ? animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key))) : [] })) : [];
    return {
      flight: flight ? { willChange: getComputedStyle(flight).willChange, duration: getComputedStyle(flight).transitionDuration, transform: getComputedStyle(flight).transform, animations: animations(flight), posterVisibility: poster ? getComputedStyle(poster).visibility : '' } : null,
      content: animations(content),
      contentDuration: content ? getComputedStyle(content).transitionDuration : '',
      contentProperty: content ? getComputedStyle(content).transitionProperty : '',
      willChangeCount: [...document.querySelectorAll('*')].filter((element) => { const value = getComputedStyle(element).willChange; return value !== 'auto' && value !== ''; }).length,
      detailHidden: document.querySelector('#media-detail')?.hidden,
    };
  })()`, true) as Promise<{ flight: { willChange: string; duration: string; transform: string; animations: Array<{ property: string; name: string; duration: number | null; easing: string; properties: string[] }>; posterVisibility: string } | null; content: Array<{ property: string; name: string; duration: number | null; easing: string; properties: string[] }>; contentDuration: string; contentProperty: string; willChangeCount: number; detailHidden: boolean }>;

  await window.webContents.executeJavaScript("document.querySelector('[data-nav=home]').click()", true);
  await waitFor("home shelves before motion checks", () => window.webContents.executeJavaScript("document.querySelectorAll('#recent-row .media-card').length", true) as Promise<number>, (count) => count > 0);

  await setMotionMedia("no-preference");
  const motionEnv = await readMotionEnv();
  assert.equal(motionEnv.dataMotion, "auto", "motion follows the system by default");
  assert.equal(motionEnv.reduced, false);
  assert.deepEqual(motionEnv.tokens, { one: "90ms", two: "140ms", three: "200ms", four: "420ms", back: "160ms" }, "the four motion tokens and the 160ms return are real CSS values");
  assert.equal(motionEnv.easeOut, "cubic-bezier(.2,.7,.3,1)");
  assert.equal(motionEnv.easeInout, "cubic-bezier(.4,0,.2,1)");

  // ① feedback: 90ms sink + 140ms colour, no radius morph.
  const feedbackButton = await readButtonMotion("[data-nav=home]");
  assert.match(feedbackButton!.property, /background-color/);
  assert.match(feedbackButton!.property, /transform/);
  assert.match(feedbackButton!.duration, /0\.09s/);
  assert.match(feedbackButton!.duration, /0\.14s/);
  const navRect = await window.webContents.executeJavaScript("(() => { const box = document.querySelector('[data-nav=home]').getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()", true) as { x: number; y: number };
  window.webContents.sendInputEvent({ type: "mouseDown", x: Math.round(navRect.x), y: Math.round(navRect.y), button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const pressed = await window.webContents.executeJavaScript("(() => { const button = document.querySelector('[data-nav=home]'); return button.getAnimations().map((animation) => ({ property: animation.transitionProperty || '', duration: animation.effect ? animation.effect.getTiming().duration : null })); })()", true) as Array<{ property: string; duration: number | null }>;
  assert.ok(pressed.some((animation) => animation.property === "transform" && Math.round(Number(animation.duration)) === 90), `press feedback sinks for 90ms: ${JSON.stringify(pressed)}`);
  window.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(navRect.x), y: Math.round(navRect.y), button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 200));

  // ④ process: scanning is the only infinite animation.
  window.webContents.send("local-library:scan-progress", scanProgress({ scanId: "scan_123e4567-e89b-42d3-a456-426614174020" }));
  await waitFor("running scan for motion", () => window.webContents.executeJavaScript("document.querySelector('#scan-status')?.hidden === false", true) as Promise<boolean>, Boolean);
  const scanMotion = await window.webContents.executeJavaScript(`(() => {
    const running = [...document.querySelectorAll('*')].map((element) => ({ element, style: getComputedStyle(element) })).filter(({ style }) => style.animationName !== 'none' && style.animationIterationCount.includes('infinite'));
    return {
      text: document.querySelector('#scan-status-text')?.textContent || '',
      infinite: running.map(({ element, style }) => ({ id: element.id, className: typeof element.className === 'string' ? element.className : '', name: style.animationName, duration: style.animationDuration })),
    };
  })()`, true) as { text: string; infinite: Array<{ id: string; className: string; name: string; duration: string }> };
  assert.match(scanMotion.text, /扫描中 · 1204/);
  assert.equal(scanMotion.infinite.length, 1, `only the scan activity is allowed to loop: ${JSON.stringify(scanMotion.infinite)}`);
  assert.equal(scanMotion.infinite[0].name, "mo-pulse");
  assert.equal(scanMotion.infinite[0].duration, "1.6s");
  window.webContents.send("local-library:scan-progress", scanProgress({ scanId: "scan_123e4567-e89b-42d3-a456-426614174020", status: "cancelled", error: "扫描已取消，已保留此前索引和播放历史" }));
  await waitFor("cancelled scan notice for motion", () => window.webContents.executeJavaScript("document.querySelector('#app-notice')?.hidden === false", true) as Promise<boolean>, Boolean);
  await window.webContents.executeJavaScript("document.querySelector('#app-notice-close').click()", true);

  // ③ view transition: home card poster flies to the detail poster in 200ms.
  await window.webContents.executeJavaScript("document.querySelector('#recent-row .media-card [data-media-id]').click()", true);
  const enterFlight = await waitFor("home → detail flight", readFlight, (value) => value.flight !== null);
  assert.equal(enterFlight.flight!.duration, "0.2s", "the entrance transition uses the 200ms token");
  assert.equal(enterFlight.flight!.willChange, "transform", "will-change is attached only for the flight window");
  assert.equal(enterFlight.flight!.posterVisibility, "hidden", "the destination poster waits for the flying clone");
  assert.ok(enterFlight.flight!.animations.some((animation) => animation.property === "transform" && Number(animation.duration) === 200), `flight animates only transform: ${JSON.stringify(enterFlight.flight!.animations)}`);
  assert.ok(enterFlight.flight!.animations.every((animation) => animation.properties.every((property) => property === "transform" || property === "opacity")), "the shared element moves only transform/opacity");
  assert.ok(enterFlight.content.some((animation) => animation.property === "opacity" && Number(animation.duration) === 200), `detail content fades independently: ${JSON.stringify(enterFlight.content)}`);
  await waitFor("detail transition settles", readFlight, (value) => value.flight === null && value.detailHidden === false);
  const settledDetail = await readFlight();
  assert.equal(settledDetail.willChangeCount, 0, "will-change is removed when the transition ends");
  assert.equal(settledDetail.flight, null);
  assert.equal(await window.webContents.executeJavaScript("getComputedStyle(document.querySelector('#detail-poster')).visibility", true), "visible");

  // Return transition: 160ms reverse, then home is interactive again.
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  const returnFlight = await waitFor("detail → home return flight", readFlight, (value) => value.flight !== null);
  assert.equal(returnFlight.flight!.duration, "0.16s", "the return transition uses the 160ms token");
  await waitFor("return transition settles", readFlight, (value) => value.flight === null);
  await waitFor("home restored after return", () => window.webContents.executeJavaScript("document.querySelectorAll('#recent-row .media-card').length", true) as Promise<number>, (count) => count > 0);

  // Playback path: the flight yields immediately and the player fade is ≤200ms.
  await window.webContents.executeJavaScript("document.querySelector('#recent-row .media-card [data-media-id]').click()", true);
  await waitFor("flight before playback", readFlight, (value) => value.flight !== null);
  const playbackClick = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('#media-detail-open')?.click();
    return {
      playerVisible: document.querySelector('[data-view="player"]')?.hidden === false,
      flight: Boolean(document.querySelector('#motion-flight')),
      shell: document.querySelector('.player-shell')?.getAnimations().map((animation) => ({ property: animation.transitionProperty || '', duration: animation.effect ? animation.effect.getTiming().duration : null })) || [],
    };
  })()`, true) as { playerVisible: boolean; flight: boolean; shell: Array<{ property: string; duration: number | null }> };
  assert.equal(playbackClick.playerVisible, true, "clicking continue during the transition shows the player immediately");
  assert.equal(playbackClick.flight, false, "the in-flight shared element yields to playback");
  assert.ok(playbackClick.shell.some((animation) => animation.property === "opacity" && animation.duration !== null && Number(animation.duration) <= 200), `the player fade stays within 200ms: ${JSON.stringify(playbackClick.shell)}`);
  await waitFor("playback open recorded", async () => playbackOpens.length, (count) => count > 0);
  window.webContents.send("local-playback:event", { type: "closed" });
  await waitFor("player closed back to detail", () => window.webContents.executeJavaScript("document.querySelector('[data-view=player]')?.hidden === true && document.querySelector('#media-detail')?.hidden === false", true) as Promise<boolean>, Boolean);
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  await waitFor("home restored after playback", () => window.webContents.executeJavaScript("document.querySelectorAll('#recent-row .media-card').length", true) as Promise<number>, (count) => count > 0);

  // Ticket 06: a lost `closed` event must not leave the player view stuck.
  await window.webContents.executeJavaScript("document.querySelector('#recent-row .media-card [data-media-id]').click()", true);
  await waitFor("detail before the close fallback", () => window.webContents.executeJavaScript("document.querySelector('#media-detail')?.hidden === false && Boolean(document.querySelector('#media-detail-title')?.textContent)", true) as Promise<boolean>, Boolean);
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-open').click()", true);
  await waitFor("player for the close fallback", () => window.webContents.executeJavaScript("document.querySelector('[data-view=player]')?.hidden === false", true) as Promise<boolean>, Boolean);
  // The fixture's command channel never answers `close`, so only the local 1.5s
  // fallback can leave the player view.
  await window.webContents.executeJavaScript("document.querySelector('#player-close-button').click()", true);
  await waitFor(
    "close fallback leaves the player",
    () => window.webContents.executeJavaScript("document.querySelector('[data-view=player]')?.hidden === true", true) as Promise<boolean>,
    Boolean,
    4_000,
  );
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#media-detail')?.hidden === false", true), true, "the fallback returns to the detail that started playback");
  window.webContents.send("local-playback:event", { type: "closed" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(
    await window.webContents.executeJavaScript("document.querySelector('[data-view=player]')?.hidden === true && document.querySelector('#media-detail')?.hidden === false", true),
    true,
    "a late duplicate closed event never dismantles the view twice",
  );
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  await waitFor("home after the close fallback", () => window.webContents.executeJavaScript("document.querySelectorAll('#recent-row .media-card').length", true) as Promise<number>, (count) => count > 0);

  // ⑤ narrative: end-of-episode copy + a linear, opacity-only countdown ring.
  await window.webContents.executeJavaScript(`document.querySelector('#recent-row [data-media-id="${episodeOne.mediaId}"]').click()`, true);
  await waitFor("episode detail", () => window.webContents.executeJavaScript("document.querySelector('#media-detail-title')?.textContent", true) as Promise<string>, (title) => title === "窗口测试剧");
  assert.match(await window.webContents.executeJavaScript("document.querySelector('#detail-episodes')?.textContent || ''", true), /第一集/);
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-open').click()", true);
  await waitFor("player visible for end panel", () => window.webContents.executeJavaScript("document.querySelector('[data-view=player]')?.hidden === false", true) as Promise<boolean>, Boolean);
  window.webContents.send("local-playback:event", { type: "state", mediaId: episodeOne.mediaId, state: "ended" });
  const ended = await waitFor("end panel with next episode", () => window.webContents.executeJavaScript(`(() => ({
    hidden: document.querySelector('#player-ended')?.hidden,
    next: document.querySelector('#player-next-title')?.textContent || '',
    countdown: document.querySelector('#player-countdown')?.textContent || '',
    remaining: document.querySelector('#player-ended')?.style.getPropertyValue('--remaining') || '',
    segments: document.querySelectorAll('.player-countdown-segment').length,
    segment: (() => { const segment = document.querySelectorAll('.player-countdown-segment')[9]; const style = segment ? getComputedStyle(segment) : null; return style ? { property: style.transitionProperty, duration: style.transitionDuration, timing: style.transitionTimingFunction } : null; })(),
  }))()`, true) as Promise<any>, (value) => value.hidden === false && /第二集/.test(value.next));
  assert.match(ended.countdown, /10 秒/);
  assert.match(ended.next, /第二集/);
  assert.equal(ended.segments, 10, "the ring is drawn as ten fixed arcs");
  assert.match(ended.segment.property, /opacity/);
  assert.equal(ended.segment.duration, "1s");
  assert.equal(ended.segment.timing, "linear", "countdown progress only uses linear timing");
  const ticked = await waitFor("linear countdown tick", () => window.webContents.executeJavaScript(`(() => {
    const ended = document.querySelector('#player-ended');
    const segment = document.querySelectorAll('.player-countdown-segment')[9];
    const animation = segment?.getAnimations().find((candidate) => candidate.transitionProperty === 'opacity');
    return { remaining: ended?.style.getPropertyValue('--remaining') || '', animation: animation ? { duration: animation.effect ? animation.effect.getTiming().duration : null, easing: animation.effect ? animation.effect.getTiming().easing : '' } : null };
  })()`, true) as Promise<any>, (value) => Boolean(value.animation));
  assert.equal(ticked.animation.duration, 1000);
  assert.equal(ticked.animation.easing, "linear");

  // Reduced motion keeps the static next-episode and countdown copy.
  await setMotionMedia("reduce");
  const reducedEnded = await window.webContents.executeJavaScript(`(() => ({
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    next: document.querySelector('#player-next-title')?.textContent || '',
    countdown: document.querySelector('#player-countdown')?.textContent || '',
    segment: (() => { const segment = document.querySelectorAll('.player-countdown-segment')[9]; const style = segment ? getComputedStyle(segment) : null; return style ? { property: style.transitionProperty, duration: style.transitionDuration } : null; })(),
  }))()`, true) as any;
  assert.equal(reducedEnded.reduced, true);
  assert.match(reducedEnded.next, /第二集/, "the next episode is still written out when motion is reduced");
  assert.match(reducedEnded.countdown, /秒后自动播放下一集/);
  assert.match(reducedEnded.segment.property, /opacity/, "reduced motion keeps opacity");
  assert.doesNotMatch(reducedEnded.segment.property, /transform/, "reduced motion drops movement");
  assert.equal(reducedEnded.segment.duration, "0.14s");
  await window.webContents.executeJavaScript("document.querySelector('#player-cancel-next').click()", true);
  window.webContents.send("local-playback:event", { type: "closed" });
  await waitFor("detail after reduced end panel", () => window.webContents.executeJavaScript("document.querySelector('#media-detail')?.hidden === false", true) as Promise<boolean>, Boolean);
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  await waitFor("home after reduced end panel", () => window.webContents.executeJavaScript("document.querySelectorAll('#recent-row .media-card').length", true) as Promise<number>, (count) => count > 0);

  // Reduced motion: no shared-element flight, 140ms opacity only.
  await window.webContents.executeJavaScript("document.querySelector('#recent-row .media-card [data-media-id]').click()", true);
  await waitFor("reduced detail", () => window.webContents.executeJavaScript("document.querySelector('#media-detail')?.hidden === false && Boolean(document.querySelector('#media-detail-title')?.textContent)", true) as Promise<boolean>, Boolean);
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('#motion-flight'))", true), false, "reduced motion never creates the shared-element clone");
  const reducedDetail = await readFlight();
  assert.match(reducedDetail.contentProperty, /opacity/);
  assert.doesNotMatch(reducedDetail.contentProperty, /transform/);
  assert.equal(reducedDetail.contentDuration, "0.14s");
  assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('#recent-row .media-card-progress').length > 0", true), true);
  const progressCopy = await window.webContents.executeJavaScript("[...document.querySelectorAll('#recent-row .media-card-progress')].map((element) => element.textContent || '').join(' | ')", true) as string;
  assert.match(progressCopy, /已看|还没看|看到|已看完/, "watched/progress stays readable without motion");
  await window.webContents.executeJavaScript("document.querySelector('#media-detail-back').click()", true);
  await waitFor("home after reduced detail", () => window.webContents.executeJavaScript("document.querySelectorAll('#recent-row .media-card').length", true) as Promise<number>, (count) => count > 0);

  // Reduced process: scan text + static dot, no loop.
  window.webContents.send("local-library:scan-progress", scanProgress({ scanId: "scan_123e4567-e89b-42d3-a456-426614174021" }));
  const reducedScan = await waitFor("reduced scan", () => window.webContents.executeJavaScript(`(() => ({ text: document.querySelector('#scan-status-text')?.textContent || '', animation: getComputedStyle(document.querySelector('#home-scan-card .scan-pill-dot')).animationName }))()`, true) as Promise<{ text: string; animation: string }>, (value) => /扫描中/.test(value.text));
  assert.match(reducedScan.text, /扫描中 · 1204/);
  assert.equal(reducedScan.animation, "none", "reduced motion keeps a static scan dot instead of looping");
  window.webContents.send("local-library:scan-progress", scanProgress({ scanId: "scan_123e4567-e89b-42d3-a456-426614174021", status: "cancelled", error: "扫描已取消，已保留此前索引和播放历史" }));
  await waitFor("reduced cancelled notice", () => window.webContents.executeJavaScript("document.querySelector('#app-notice')?.hidden === false", true) as Promise<boolean>, Boolean);
  await window.webContents.executeJavaScript("document.querySelector('#app-notice-close').click()", true);

  // Focus rings are never animated, in either tier.
  const focusRing = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-nav=home]');
    button.focus({ focusVisible: true });
    const style = getComputedStyle(button);
    return { visible: button.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, duration: style.transitionDuration, animations: button.getAnimations().length };
  })()`, true) as { visible: boolean; outlineStyle: string; outlineWidth: string; duration: string; animations: number };
  assert.equal(focusRing.visible, true);
  assert.equal(focusRing.outlineStyle, "solid");
  assert.ok(Number.parseFloat(focusRing.outlineWidth) > 0, `the focus ring is visible: ${focusRing.outlineWidth}`);
  assert.equal(focusRing.duration, "0s", "focus rings do not animate");
  assert.equal(focusRing.animations, 0);

  // Manual "off" tier exists for the future settings surface and is instant.
  const offTier = await window.webContents.executeJavaScript(`(() => {
    document.documentElement.dataset.motion = 'off';
    const style = getComputedStyle(document.querySelector('[data-nav=home]'));
    const result = { duration: style.transitionDuration, animation: style.animationName };
    document.documentElement.dataset.motion = 'auto';
    return result;
  })()`, true) as { duration: string; animation: string };
  assert.equal(offTier.duration, "0s");
  assert.equal(offTier.animation, "none");

  await setMotionMedia("no-preference");
  assert.equal((await readMotionEnv()).reduced, false, "the emulated system setting is restored for later checks");

  window.close();
  for (const channel of ["local-library:state", "local-library:source-remove", "local-library:source-refresh", "local-library:rescan-all", "local-library:choose-folder", "local-library:open-video", "local-library:list", "local-library:list-collections", "local-library:scan-cancel", "local-library:get", "local-library:artwork", "local-library:continue-watching", "app-preferences:get", "app-preferences:set-sort", "local-playback:open", "local-playback:command"]) ipcMain.removeHandler(channel);
}

run().then(() => app.quit()).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
