import { app } from "electron";
import { join } from "node:path";

import { registerLocalLibraryIpcHandlers } from "./local-library-ipc";
import { registerLocalPlaybackIpcHandlers } from "./local-playback-ipc";
import { registerAppPreferencesIpcHandlers } from "./app-preferences-ipc";
import { LocalLibraryDatabase } from "./local-library-database";
import { LOCAL_LIBRARY_REFRESH_BASELINE_FILE, LocalLibraryRefreshScheduler } from "./local-library-refresh";
import { LocalLibraryWatcher, LocalLibraryNetworkPoller, type LocalWatchSource } from "./local-library-watch";
import { LocalArtworkCache } from "./local-artwork-cache";
import { MainLocalPlaybackHost } from "./player-host";
import type { LocalPlaybackStore } from "../shared/local-playback-contracts";
import { createMainWindow, raiseMainWindow } from "./window";
import { AppPreferencesStore } from "./app-preferences";
import { recordUiOperation } from "./diagnostics";

let mainWindow: ReturnType<typeof createMainWindow> | undefined;
let localLibrary: LocalLibraryDatabase | undefined;
let localArtworkCache: LocalArtworkCache | undefined;
let appPreferences: AppPreferencesStore | undefined;
let unregisterLocalLibraryIpc: (() => void) | undefined;
let localPlayback: MainLocalPlaybackHost | undefined;
let unregisterLocalPlaybackIpc: (() => void) | undefined;
let unregisterAppPreferencesIpc: (() => void) | undefined;
/**
 * Ticket 23b: the mtime coarse filter lives for one window and persists its
 * directory baseline beside the SQLite file, so a change made while the app was
 * closed is still detected on the first focus of the next run.
 */
let localRefresh: LocalLibraryRefreshScheduler | undefined;
/**
 * Ticket 24a: one recursive filesystem watch per registered Source. It hands
 * dirty directories to `localRefresh`; both are released with the window.
 */
let localWatch: LocalLibraryWatcher | undefined;
/**
 * Ticket 24b: the network fallback. No watch is created for a share; this
 * low-frequency known-directory mtime poll runs only while the window is
 * focused and hands changed directories to the same `localRefresh` scheduler.
 */
let localNetworkPoll: LocalLibraryNetworkPoller | undefined;
let playbackClosing: Promise<void> | undefined;
let quitting = false;

/**
 * Ticket 38 (G-01): a second launch is a request to surface the running app, not
 * a second app. The owner raises its window (restoring a minimized one); the
 * launching process exits on the lock below without creating a window, a worker,
 * a SQLite connection or a preferences write.
 */
function handleSecondInstance(): void {
  const raised = raiseMainWindow(mainWindow);
  // No title, path or profile data: this trace is the evidence that the launch
  // was handed to the owner instead of bootstrapping a second library.
  void recordUiOperation("single-instance.second-instance", "success", Date.now(), raised ? {} : { errorKind: "no-window" });
}

function attachWindowLifecycle(window: ReturnType<typeof createMainWindow>): void {
  window.once("closed", () => {
    void closePlayback();
    mainWindow = undefined;
  });
}

function createLocalWindow(): void {
  if (!localLibrary) throw new Error("本地片库尚未启动");
  const window = createMainWindow();
  mainWindow = window;
  if (!appPreferences) throw new Error("应用设置尚未启动");
  localPlayback = new MainLocalPlaybackHost(window, localLibrary as unknown as LocalPlaybackStore, undefined, appPreferences);
  if (!localArtworkCache) throw new Error("本地 artwork cache 尚未启动");
  if (!localRefresh) {
    localRefresh = new LocalLibraryRefreshScheduler(localLibrary, join(app.getPath("userData"), "local-library", LOCAL_LIBRARY_REFRESH_BASELINE_FILE));
  }
  if (!localWatch) {
    const database = localLibrary;
    localWatch = new LocalLibraryWatcher({
      // Main-only: the renderer never learns a root path. An offline or removed
      // Source still yields its stored root; the watch start then fails silently.
      sources: {
        listSources: async (): Promise<LocalWatchSource[]> => {
          const state = await database.refreshState();
          const sources: LocalWatchSource[] = [];
          for (const source of state.sources) {
            const rootPath = await database.sourceRoot(source.sourceId);
            if (rootPath) sources.push({ sourceId: source.sourceId, rootPath });
          }
          return sources;
        },
      },
      onChange: (directories) => {
        // Ticket 24a hands the dirty directories to the 23b scheduler: it owns
        // the single flight, the queue and the silent result push. The watcher
        // never scans and never reports a failure to the UI.
        void localRefresh?.requestWatch(directories).catch(() => undefined);
      },
      onError: (error) => {
        // Silent fallback to the focus refresh; this trace is the only evidence,
        // and it carries no path.
        void recordUiOperation("local-library.watch", "error", Date.now(), {
          errorKind: error instanceof Error ? error.name : "unknown",
          ...(error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? { errorCode: (error as { code: string }).code } : {}),
        });
      },
    });
  }
  void localWatch.sync();
  if (!localNetworkPoll) {
    const database = localLibrary;
    localNetworkPoll = new LocalLibraryNetworkPoller({
      // The inventory is the same known-directory list Ticket 23b uses, so a
      // poll never walks the share's file tree; only these directories are stat'ed.
      directories: {
        listScanDirectories: () => database.listScanDirectories(),
        sourceRoot: (sourceId) => database.sourceRoot(sourceId),
      },
      // Ticket 24b: a background app does not touch the share at all. The check
      // is read at every tick, so minimize/restore needs no extra wiring.
      isForeground: () => {
        const current = mainWindow;
        return current !== undefined && !current.isDestroyed() && current.isFocused();
      },
      onChange: (directories) => {
        // Same destination as the local watcher: the 23b scheduler owns the
        // single flight, the queue, the silent push and the main-only "watch" cause.
        void localRefresh?.requestWatch(directories).catch(() => undefined);
      },
      onError: (error) => {
        // An offline share must not look available and must not spam the user;
        // this trace carries the error kind/code only, never a path.
        void recordUiOperation("local-library.network-poll", "error", Date.now(), {
          errorKind: error instanceof Error ? error.name : "unknown",
          ...(error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? { errorCode: (error as { code: string }).code } : {}),
        });
      },
    });
    void localNetworkPoll.start();
    // The window is created hidden, so the first start happens before it can be
    // focused. Taking the baseline at the first real focus keeps the first
    // polling interval honest: a change made right after startup is detected on
    // the next tick instead of being mistaken for the baseline.
    window.once("focus", () => {
      void localNetworkPoll?.start();
    });
  }
  unregisterLocalLibraryIpc = registerLocalLibraryIpcHandlers(localLibrary, window, localArtworkCache, appPreferences, localRefresh, localWatch);
  unregisterLocalPlaybackIpc = registerLocalPlaybackIpcHandlers(localPlayback);
  unregisterAppPreferencesIpc = registerAppPreferencesIpcHandlers(appPreferences);
  attachWindowLifecycle(window);
}

function closePlayback(): Promise<void> {
  const previousClose = playbackClosing;
  unregisterLocalPlaybackIpc?.();
  unregisterLocalPlaybackIpc = undefined;
  unregisterLocalLibraryIpc?.();
  unregisterLocalLibraryIpc = undefined;
  unregisterAppPreferencesIpc?.();
  unregisterAppPreferencesIpc = undefined;
  // Ticket 24a: release every watcher and its pending debounce timer before the
  // scheduler goes away, so no callback can arrive after the window closed.
  localWatch?.dispose();
  localWatch = undefined;
  // Ticket 24b: stop the network interval before the scheduler it feeds.
  localNetworkPoll?.dispose();
  localNetworkPoll = undefined;
  // Ticket 23b: drop queued checks with the window; a scan already in flight
  // still finishes and its result has no listener left to disturb.
  localRefresh?.dispose();
  localRefresh = undefined;
  const host = localPlayback;
  localPlayback = undefined;
  const close = Promise.all([previousClose ?? Promise.resolve(), host?.close() ?? Promise.resolve()]).then(() => undefined);
  const tracked = close.finally(() => {
    if (playbackClosing === tracked) playbackClosing = undefined;
  });
  playbackClosing = tracked;
  return tracked;
}

/**
 * Ticket 20 / F-01: a local-library start failure must never be a windowless
 * exit. The window is created first so the renderer can show the global error
 * card (error code, retry, diagnostics); the database owner keeps its `error`
 * state and re-initializes on the next owner call (F-04). Only a failure to
 * create the window itself is unrecoverable.
 */
async function bootstrap(): Promise<void> {
  await app.whenReady();
  const startedAt = Date.now();
  localLibrary = new LocalLibraryDatabase({ dbPath: join(app.getPath("userData"), "local-library", "library.sqlite") });
  localArtworkCache = new LocalArtworkCache(join(app.getPath("userData"), "local-library", "artwork-cache"));
  appPreferences = new AppPreferencesStore(join(app.getPath("userData"), "app-preferences.json"));
  await appPreferences.load();
  try {
    await localLibrary.start();
    void recordUiOperation("local-library.start", "success", startedAt);
  } catch (error) {
    // The renderer's error card is the user-facing report; this trace is for
    // diagnostics after the fact.
    console.error("z-video failed to start local library", error instanceof Error ? error.message : "unknown error");
    void recordUiOperation("local-library.start", "error", startedAt, {
      errorKind: error instanceof Error ? error.name : "unknown",
      ...(error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? { errorCode: (error as { code: string }).code } : {}),
    });
  }
  createLocalWindow();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createLocalWindow();
    }
  });
}

/**
 * Ticket 38 (G-01): the lock is taken before anything can touch the profile.
 * SQLite, the utility-process worker and `app-preferences.json` all live under
 * `userData`, so a second launch must stop here: it exits immediately, and the
 * owner receives `second-instance` and raises its existing window. A crash of
 * the owner releases the lock, so the next launch bootstraps normally.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on("second-instance", () => handleSecondInstance());

  void bootstrap().catch((error: unknown) => {
    // Reaching here means even the window could not be created: there is no
    // surface left to report on.
    console.error("z-video failed to create its main window", error instanceof Error ? error.message : "unknown error");
    void recordUiOperation("main.window", "error", Date.now(), { errorKind: error instanceof Error ? error.name : "unknown" });
    app.exit(1);
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    const close = closePlayback().then(() => localLibrary?.close());
    void close.finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
