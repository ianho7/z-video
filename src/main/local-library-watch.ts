import { watch as watchFilesystem } from "node:fs";
import { stat as statDirectory } from "node:fs/promises";
import koffi from "koffi";
import { isAbsolute, join, relative } from "node:path";

import type { LocalSourceDirectories } from "../shared/local-library-contracts";
import type { LocalWatchedDirectory } from "./local-library-refresh";

/**
 * Ticket 24a: local change discovery. Ticket 24b adds the network fallback.
 *
 * A `ChangeSource` is the injectable boundary around one recursive filesystem
 * watch. The production implementation wraps Windows' native recursive
 * `fs.watch`; tests inject a fake and push events, so debounce, merging, ignore
 * rules and teardown are verified without depending on OS event timing.
 *
 * `LocalLibraryWatcher` owns one subscription per registered Source, keeps only
 * the *containing directory* of every reported change (never the file path),
 * drops temporary/system junk, merges the burst into one debounced flush and
 * hands source-relative dirty directories to the Ticket 23b scheduler. It never
 * scans, never pushes a result and never surfaces an error: a source that
 * cannot be watched silently falls back to the focus refresh.
 *
 * A Source on a network share (a UNC root or a mapped remote drive) is never
 * watched: Windows delivers unreliable or no events there, and a watch that
 * appears to work would be worse than no watch. `LocalLibraryNetworkPoller`
 * replaces it with a low-frequency known-directory mtime check that only runs
 * while the main window is focused. Both paths end in the same scheduler call.
 */

/** How long a burst of filesystem events is collected before one change check. */
export const LOCAL_LIBRARY_WATCH_DEBOUNCE_MS = 1_500;

/**
 * Ticket 24b: how often a network Source's known directories are checked.
 * Five minutes is a fallback cadence, not a promise of near-real-time updates;
 * it is deliberately fixed (no preference, no per-source tuning).
 */
export const LOCAL_LIBRARY_NETWORK_POLL_INTERVAL_MS = 5 * 60_000;

/** Exact entry names that are OS/system junk and never make the library stale. */
const IGNORED_ENTRY_NAMES = new Set(["thumbs.db", "@eadir", "#recycle"]);
/** Suffixes of in-progress downloads and save files. */
const IGNORED_ENTRY_SUFFIXES = [".tmp", ".part"];
/** Prefixes of Office/document lock files. */
const IGNORED_ENTRY_PREFIXES = ["~$"];

/**
 * True for entry names whose creation, edit or removal cannot change what the
 * library shows. Matching is case-insensitive so `Thumbs.DB` and `@EADir` are
 * covered by the same rule on Windows.
 */
function isIgnoredLibraryEntry(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return IGNORED_ENTRY_NAMES.has(normalized)
    || IGNORED_ENTRY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    || IGNORED_ENTRY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * One report from a change source. `unavailable` means the subscription died
 * (a removed/offline drive, a rejected handle): the watcher releases it and the
 * focus refresh takes over without telling the user.
 */
export type ChangeSourceEvent =
  | { readonly type: "change"; readonly path?: string; readonly kind?: string }
  | { readonly type: "unavailable" };

/* ------------------------------------------------------------------ *
 * Ticket 24b: network-source classification.
 * ------------------------------------------------------------------ */

/** How change discovery treats one Source root. */
export type LocalSourceKind = "local" | "network";

/** `DRIVE_REMOTE` from `kernel32!GetDriveTypeW`. */
export const WINDOWS_DRIVE_REMOTE = 4;

/**
 * True for a UNC root (`\\server\share`, `//server/share`, `\\?\UNC\...`).
 * The local device namespaces (`\\?\C:`, `\\.\X:`) are not shares.
 */
export function isUncSourcePath(rootPath: string): boolean {
  if (typeof rootPath !== "string") return false;
  if (/^\\\\[?.]\\UNC\\/iu.test(rootPath)) return true;
  if (/^\\\\[?.]\\/u.test(rootPath)) return false;
  return /^[\\/]{2}[^\\/]/u.test(rootPath);
}

/** The injected seam: one root path in, one change-discovery treatment out. */
export type LocalSourceClassifier = (rootPath: string) => LocalSourceKind;

type DriveTypeResolver = (rootPath: string) => number | undefined;

let driveTypeFunction: ((path: string) => number) | undefined;
let driveTypeUnavailable = false;

/**
 * `kernel32!GetDriveTypeW` through the already-installed koffi dependency, so a
 * mapped network drive can be told apart from a local one without a new module.
 * `undefined` means "cannot decide": a non-Windows host, or a kernel32 handle
 * that failed to load. The caller then treats the Source as local.
 */
function resolveWindowsDriveType(rootPath: string): number | undefined {
  if (process.platform !== "win32" || driveTypeUnavailable) return undefined;
  const drive = /^([a-zA-Z]):/u.exec(rootPath)?.[1]?.toUpperCase();
  if (!drive) return undefined;
  try {
    if (!driveTypeFunction) {
      const kernel32 = koffi.load("kernel32.dll");
      driveTypeFunction = kernel32.func("__stdcall", "GetDriveTypeW", "uint32_t", ["str16"]) as unknown as (path: string) => number;
    }
    return driveTypeFunction(`${drive}:\\`);
  } catch {
    // A host where the Win32 call cannot be bound keeps working with local
    // classification; the fallback is documented in contracts.md.
    driveTypeUnavailable = true;
    return undefined;
  }
}

/**
 * Build the Source classifier used by the watcher and the network poller. UNC
 * roots are decided by shape; a drive letter consults the injected resolver.
 * Anything undecidable is local, which preserves the pre-24b behaviour for
 * every path the app cannot prove to be a share.
 */
export function createLocalSourceClassifier(resolveDriveType: DriveTypeResolver = resolveWindowsDriveType): LocalSourceClassifier {
  return (rootPath) => {
    if (typeof rootPath !== "string" || !rootPath) return "local";
    if (isUncSourcePath(rootPath)) return "network";
    if (!/^[a-zA-Z]:/u.test(rootPath)) return "local";
    return resolveDriveType(rootPath) === WINDOWS_DRIVE_REMOTE ? "network" : "local";
  };
}

/** Production classifier: UNC plus mapped remote drive; local otherwise. */
export const classifyLocalSourceKind: LocalSourceClassifier = createLocalSourceClassifier();

export interface ChangeSourceHandle {
  /** Release the OS watch; safe to call more than once. */
  stop(): void;
}

/** The injectable change source seam: one recursive watch per Source root. */
export interface ChangeSource {
  /** Begin watching `rootPath`. Throws when the root cannot be watched. */
  start(rootPath: string, onEvent: (event: ChangeSourceEvent) => void): ChangeSourceHandle;
}

/** One registered Source as the watcher needs it: identity plus its private root. */
export interface LocalWatchSource {
  sourceId: string;
  rootPath: string;
}

/** Main-only view of the registered Sources; the renderer never sees a root path. */
export interface LocalWatchSourcePort {
  listSources(): Promise<readonly LocalWatchSource[]>;
}

/**
 * What the IPC layer needs from the watcher (Ticket 24a): re-read the Source
 * list after a folder add/remove, or release the removed Source immediately.
 */
export interface LocalWatchSyncPort {
  sync(): Promise<void>;
  forgetSources(sourceIds: readonly string[]): void;
}

/** Test seam for the debounce timer, so a test can assert "no timer left". */
export interface LocalWatchTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const nodeTimers: LocalWatchTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LocalLibraryWatcherOptions {
  sources: LocalWatchSourcePort;
  /** Receives the debounced, merged, deduplicated dirty directories. */
  onChange: (directories: readonly LocalWatchedDirectory[]) => void;
  /** Production default: the native recursive filesystem watch. */
  changeSource?: ChangeSource;
  /**
   * Ticket 24b: a network Source is never watched (a mapped drive accepts the
   * handle but misses events, a UNC root fails outright); it is polled instead.
   */
  classifySource?: LocalSourceClassifier;
  timers?: LocalWatchTimers;
  debounceMs?: number;
  /** Diagnostics only; a watch failure is never a user-visible error. */
  onError?: (error: unknown) => void;
}

interface WatchEntry {
  readonly rootPath: string;
  readonly handle: ChangeSourceHandle;
}

/**
 * The production change source: one recursive `fs.watch` per Source root.
 *
 * `persistent: false` keeps a watch from holding the process open, which is what
 * makes quit deterministic. A missing/unwatchable root throws from `start`; an
 * `error` emitted later (drive removed, share disconnected) is reported once as
 * `unavailable` after the handle closed itself.
 */
export class RecursiveFsWatchChangeSource implements ChangeSource {
  start(rootPath: string, onEvent: (event: ChangeSourceEvent) => void): ChangeSourceHandle {
    const watcher = watchFilesystem(rootPath, { recursive: true, persistent: false }, (kind, filename) => {
      const name = typeof filename === "string" ? filename : "";
      onEvent({ type: "change", kind, ...(name ? { path: join(rootPath, name) } : {}) });
    });
    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      try {
        watcher.close();
      } catch {
        // Already closed by the OS; nothing left to release.
      }
    };
    watcher.on("error", () => {
      stop();
      onEvent({ type: "unavailable" });
    });
    return { stop };
  }
}

export class LocalLibraryWatcher {
  private readonly sources: LocalWatchSourcePort;
  private readonly changeSource: ChangeSource;
  private readonly classifySource: LocalSourceClassifier;
  private readonly timers: LocalWatchTimers;
  private readonly debounceMs: number;
  private readonly changeListener: (directories: readonly LocalWatchedDirectory[]) => void;
  private readonly errorListener: ((error: unknown) => void) | undefined;
  private readonly entries = new Map<string, WatchEntry>();
  /** sourceId → source-relative directories collected for the next flush. */
  private readonly pending = new Map<string, Set<string>>();
  /** Sources whose last `start` failed; retried by the next sync, not by a timer. */
  private readonly unavailable = new Set<string>();
  private pendingTimer: { handle: unknown } | undefined;
  private disposed = false;

  constructor(options: LocalLibraryWatcherOptions) {
    this.sources = options.sources;
    this.changeSource = options.changeSource ?? new RecursiveFsWatchChangeSource();
    this.classifySource = options.classifySource ?? classifyLocalSourceKind;
    this.timers = options.timers ?? nodeTimers;
    this.debounceMs = typeof options.debounceMs === "number" && options.debounceMs >= 0
      ? options.debounceMs
      : LOCAL_LIBRARY_WATCH_DEBOUNCE_MS;
    this.changeListener = options.onChange;
    this.errorListener = options.onError;
  }

  /** Re-read the registered Sources and reconcile the live subscriptions. */
  async sync(): Promise<void> {
    if (this.disposed) return;
    let sources: readonly LocalWatchSource[];
    try {
      sources = await this.sources.listSources();
    } catch (error) {
      this.report(error);
      return;
    }
    if (this.disposed) return;
    this.syncSources(sources);
  }

  /**
   * Reconcile with the given Source list: removed Sources stop watching, new or
   * moved roots restart, an unchanged root keeps its existing subscription.
   */
  syncSources(sources: readonly LocalWatchSource[]): void {
    if (this.disposed) return;
    const wanted = new Map<string, string>();
    for (const source of sources) {
      if (!source || typeof source.sourceId !== "string" || !source.sourceId) continue;
      if (typeof source.rootPath !== "string" || !source.rootPath) continue;
      wanted.set(source.sourceId, source.rootPath);
    }
    for (const sourceId of [...this.entries.keys()]) {
      if (!wanted.has(sourceId)) this.stopSource(sourceId);
    }
    for (const [sourceId, rootPath] of wanted) {
      // Ticket 24b: a share is not watched at all. A mapped drive would accept
      // the recursive handle and then silently miss events, and a UNC root
      // usually fails; either way the network poller owns this Source. Any
      // local handle left from an earlier classification is released.
      if (this.classifySource(rootPath) === "network") {
        this.stopSource(sourceId);
        continue;
      }
      const entry = this.entries.get(sourceId);
      if (entry && entry.rootPath === rootPath) continue;
      if (entry) this.stopSource(sourceId);
      this.startSource({ sourceId, rootPath });
    }
  }

  /** Release one or more Sources immediately (a source removal does not wait for a sync). */
  forgetSources(sourceIds: readonly string[]): void {
    for (const sourceId of sourceIds) {
      if (typeof sourceId === "string" && sourceId) this.stopSource(sourceId);
    }
  }

  isWatching(sourceId: string): boolean {
    return this.entries.has(sourceId);
  }

  /** Quit path: release every handle and every pending debounce timer. */
  dispose(): void {
    this.disposed = true;
    const timer = this.pendingTimer;
    this.pendingTimer = undefined;
    if (timer) this.timers.clearTimeout(timer.handle);
    this.pending.clear();
    for (const sourceId of [...this.entries.keys()]) this.stopSource(sourceId);
    this.unavailable.clear();
  }

  private startSource(source: LocalWatchSource): void {
    try {
      const handle = this.changeSource.start(source.rootPath, (event) => this.handleEvent(source.sourceId, event));
      this.entries.set(source.sourceId, { rootPath: source.rootPath, handle });
      this.unavailable.delete(source.sourceId);
    } catch (error) {
      // A removed drive, a UNC share or a rejected handle cannot be watched
      // recursively. The focus refresh still works, so this stays silent for the
      // user and is only reported once per failure streak.
      if (!this.unavailable.has(source.sourceId)) this.report(error);
      this.unavailable.add(source.sourceId);
    }
  }

  private stopSource(sourceId: string): void {
    const entry = this.entries.get(sourceId);
    this.entries.delete(sourceId);
    this.pending.delete(sourceId);
    if (!entry) return;
    try {
      entry.handle.stop();
    } catch (error) {
      this.report(error);
    }
  }

  private handleEvent(sourceId: string, event: ChangeSourceEvent): void {
    if (this.disposed) return;
    const entry = this.entries.get(sourceId);
    if (!entry) return;
    if (event.type === "unavailable") {
      this.stopSource(sourceId);
      this.unavailable.add(sourceId);
      this.report(new Error("local library watch unavailable"));
      return;
    }
    const relativeDirectory = this.directoryForChange(entry.rootPath, event.path);
    if (relativeDirectory === undefined) return;
    const collected = this.pending.get(sourceId) ?? new Set<string>();
    collected.add(relativeDirectory);
    this.pending.set(sourceId, collected);
    this.armFlush();
  }

  /**
   * The source-relative containing directory of one changed path, or
   * `undefined` when the path is outside the source or nothing but junk.
   *
   * A change is collected at the directory that contains it: a rename or a
   * delete therefore points at a directory that still exists (the deleted
   * child's parent), and the rescan reconciles it. An unnamed event can only be
   * attributed to the source root.
   */
  private directoryForChange(rootPath: string, changedPath: string | undefined): string | undefined {
    if (changedPath === undefined || changedPath === "") return "";
    const relativePath = relative(rootPath, changedPath);
    if (relativePath === "" || relativePath === ".") return "";
    if (isAbsolute(relativePath)) return undefined;
    const segments = relativePath.split(/[\\/]+/u).filter(Boolean);
    if (segments.length === 0) return "";
    if (segments[0] === "..") return undefined;
    if (segments.some((segment) => isIgnoredLibraryEntry(segment))) return undefined;
    return segments.slice(0, -1).join("/");
  }

  private armFlush(): void {
    if (this.pendingTimer || this.disposed) return;
    const timer: { handle: unknown } = { handle: undefined };
    timer.handle = this.timers.setTimeout(() => {
      if (this.pendingTimer === timer) this.pendingTimer = undefined;
      this.flush();
    }, this.debounceMs);
    this.pendingTimer = timer;
  }

  private flush(): void {
    if (this.disposed) {
      this.pending.clear();
      return;
    }
    const directories: LocalWatchedDirectory[] = [];
    for (const [sourceId, relativeDirectories] of this.pending) {
      for (const relativeDirectory of relativeDirectories) directories.push({ sourceId, relativeDirectory });
    }
    this.pending.clear();
    if (directories.length === 0) return;
    try {
      this.changeListener(directories);
    } catch (error) {
      this.report(error);
    }
  }

  /** Diagnostics never change the watch behaviour and never reach the renderer. */
  private report(error: unknown): void {
    try {
      this.errorListener?.(error);
    } catch {
      // A broken diagnostics hook must not break teardown.
    }
  }
}

/* ------------------------------------------------------------------ *
 * Ticket 24b: network-share fallback polling.
 * ------------------------------------------------------------------ */

/** The known-directory inventory the network poller needs; main owns the paths. */
export interface LocalNetworkDirectoryPort {
  listScanDirectories(): Promise<readonly LocalSourceDirectories[]>;
  sourceRoot(sourceId: string): Promise<string | undefined>;
}

/**
 * Diagnostics-only failure for one Source whose directories could not be read
 * during a poll. It keeps no path and no file name; main records the error kind
 * only. It is not a user-visible error and never changes source availability.
 */
export class LocalNetworkPollError extends Error {
  readonly code = "unreachable";
  constructor() {
    super("local library network source unavailable");
    this.name = "LocalNetworkPollError";
  }
}

export interface LocalLibraryNetworkPollerOptions {
  directories: LocalNetworkDirectoryPort;
  /** Receives only the directories whose mtime moved; goes to `requestWatch`. */
  onChange: (directories: readonly LocalWatchedDirectory[]) => void;
  /** True only while the main window is focused; a background tick is skipped. */
  isForeground: () => boolean;
  /** Production default: UNC plus mapped remote drive. */
  classifySource?: LocalSourceClassifier;
  /** Test seam: the default stats the real directory, directory mtime only. */
  statDirectoryMtime?: (directoryPath: string) => Promise<number | undefined>;
  timers?: LocalWatchTimers;
  intervalMs?: number;
  /** Diagnostics only; a poll failure is never a user-visible error. */
  onError?: (error: unknown) => void;
}

/** Directory mtime only: no listing, no file stats, no tree walk. */
async function readDirectoryMtimeMs(directoryPath: string): Promise<number | undefined> {
  try {
    const info = await statDirectory(directoryPath);
    return info.isDirectory() ? info.mtimeMs : undefined;
  } catch {
    // An offline share, a disconnected drive or a removed directory. The poller
    // keeps the previous observation so recovery compares against it instead of
    // reporting the whole Source as changed.
    return undefined;
  }
}

/** Absolute path for one source-relative directory; `""` is the source root. */
function networkDirectoryPath(rootPath: string, relativeDirectory: string): string {
  const segments = relativeDirectory.split("/").filter(Boolean);
  return segments.length ? join(rootPath, ...segments) : rootPath;
}

/**
 * Ticket 24b: the fallback change source for network shares.
 *
 * The poller owns one fixed-interval timer and, per tick, stats only the
 * directories the library already indexes for each network Source (directory
 * mtime alone; no readdir, no file tree). A directory whose mtime moved is
 * handed to the Ticket 23b scheduler through `requestWatch`, so the network
 * path shares the single-flight gate, the queued drain and the silent
 * `"watch"` result push with the local watcher. It never scans itself, never
 * reports availability, and never tells the renderer anything.
 *
 * A Source that cannot be stat'ed is treated as unreachable, not as empty or
 * as "all changed": no directory is reported, one path-free diagnostic is
 * written per failure streak, polling continues, and recovery compares against
 * the last successful observation so a change made while offline still lands.
 */
export class LocalLibraryNetworkPoller {
  private readonly directories: LocalNetworkDirectoryPort;
  private readonly classifySource: LocalSourceClassifier;
  private readonly statDirectoryMtime: (directoryPath: string) => Promise<number | undefined>;
  private readonly timers: LocalWatchTimers;
  private readonly intervalMs: number;
  private readonly foreground: () => boolean;
  private readonly changeListener: (directories: readonly LocalWatchedDirectory[]) => void;
  private readonly errorListener: ((error: unknown) => void) | undefined;
  /** sourceId → source-relative directory → mtime of the last successful stat. */
  private readonly observed = new Map<string, Map<string, number>>();
  /** Sources already reported in the current unreachable streak. */
  private readonly unreachable = new Set<string>();
  private timer: { handle: unknown } | undefined;
  private evaluating = false;
  private disposed = false;

  constructor(options: LocalLibraryNetworkPollerOptions) {
    this.directories = options.directories;
    this.classifySource = options.classifySource ?? classifyLocalSourceKind;
    this.statDirectoryMtime = options.statDirectoryMtime ?? readDirectoryMtimeMs;
    this.timers = options.timers ?? nodeTimers;
    this.intervalMs = typeof options.intervalMs === "number" && Number.isFinite(options.intervalMs) && options.intervalMs > 0
      ? options.intervalMs
      : LOCAL_LIBRARY_NETWORK_POLL_INTERVAL_MS;
    this.foreground = options.isForeground;
    this.changeListener = options.onChange;
    this.errorListener = options.onError;
  }

  /**
   * Arm the fixed interval and, when the window is already focused, record the
   * starting mtime baseline right away so a change made in the first interval
   * is still detected. Safe to call again: an armed interval is kept, and the
   * baseline is taken on the first call that happens in the foreground (main
   * calls this again when the freshly created window gains focus).
   */
  async start(): Promise<void> {
    if (this.disposed) return;
    this.arm();
    if (this.foreground()) await this.poll();
  }

  /**
   * One low-frequency check. A background tick stats nothing, and a check that
   * is already running is not overlapped; the caller (the timer) re-arms after
   * it settles either way.
   */
  async poll(): Promise<void> {
    if (this.disposed || this.evaluating) return;
    if (!this.foreground()) return;
    this.evaluating = true;
    try {
      await this.evaluate();
    } catch (error) {
      this.report(error);
    } finally {
      this.evaluating = false;
    }
  }

  /** Quit path: release the interval and forget every observation. */
  dispose(): void {
    this.disposed = true;
    const timer = this.timer;
    this.timer = undefined;
    if (timer) this.timers.clearTimeout(timer.handle);
    this.observed.clear();
    this.unreachable.clear();
  }

  private arm(): void {
    if (this.disposed || this.timer) return;
    const timer: { handle: unknown } = { handle: undefined };
    timer.handle = this.timers.setTimeout(() => {
      if (this.timer === timer) this.timer = undefined;
      void this.poll().finally(() => this.arm());
    }, this.intervalMs);
    this.timer = timer;
  }

  /**
   * One sweep over the known directories of every network Source. Local Sources
   * are skipped without a stat, and nothing is reported unless a directory that
   * was observed before has a different mtime now.
   */
  private async evaluate(): Promise<void> {
    const inventory = await this.directories.listScanDirectories();
    const dirty: LocalWatchedDirectory[] = [];
    const live = new Set<string>();
    for (const source of inventory) {
      if (!source || typeof source.sourceId !== "string" || !source.sourceId) continue;
      if (!Array.isArray(source.relativeDirectories)) continue;
      const rootPath = await this.directories.sourceRoot(source.sourceId).catch(() => undefined);
      if (!rootPath) continue;
      if (this.classifySource(rootPath) !== "network") continue;
      live.add(source.sourceId);
      dirty.push(...(await this.collectDirtyDirectories(source, rootPath)));
    }
    for (const sourceId of [...this.observed.keys()]) {
      if (!live.has(sourceId)) this.observed.delete(sourceId);
    }
    if (dirty.length === 0) return;
    try {
      this.changeListener(dirty);
    } catch (error) {
      this.report(error);
    }
  }

  private async collectDirtyDirectories(source: LocalSourceDirectories, rootPath: string): Promise<LocalWatchedDirectory[]> {
    const observed = this.observed.get(source.sourceId) ?? new Map<string, number>();
    this.observed.set(source.sourceId, observed);
    const known = new Set<string>();
    const dirty: LocalWatchedDirectory[] = [];
    let unreachable = false;
    for (const relativeDirectory of source.relativeDirectories) {
      if (typeof relativeDirectory !== "string") continue;
      known.add(relativeDirectory);
      const mtimeMs = await this.statDirectoryMtime(networkDirectoryPath(rootPath, relativeDirectory));
      if (mtimeMs === undefined) {
        unreachable = true;
        continue;
      }
      const previous = observed.get(relativeDirectory);
      observed.set(relativeDirectory, mtimeMs);
      if (previous !== undefined && previous !== mtimeMs) dirty.push({ sourceId: source.sourceId, relativeDirectory });
    }
    if (unreachable) {
      // Keep every previous observation: recovery compares against what the
      // share looked like last time instead of treating it as all-new.
      this.reportUnreachable(source.sourceId);
      return [];
    }
    this.unreachable.delete(source.sourceId);
    for (const relativeDirectory of [...observed.keys()]) {
      if (!known.has(relativeDirectory)) observed.delete(relativeDirectory);
    }
    return dirty;
  }

  /** One diagnostic per offline streak; a share that stays down never spams. */
  private reportUnreachable(sourceId: string): void {
    if (this.unreachable.has(sourceId)) return;
    this.unreachable.add(sourceId);
    this.report(new LocalNetworkPollError());
  }

  private report(error: unknown): void {
    try {
      this.errorListener?.(error);
    } catch {
      // A broken diagnostics hook must not break polling.
    }
  }
}
