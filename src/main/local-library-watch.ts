import { watch as watchFilesystem } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import type { LocalWatchedDirectory } from "./local-library-refresh";

/**
 * Ticket 24a: local change discovery.
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
 */

/** How long a burst of filesystem events is collected before one change check. */
export const LOCAL_LIBRARY_WATCH_DEBOUNCE_MS = 1_500;

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
