import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import { normalizeScanRelativeDirectory } from "../shared/local-library-contracts";
import type {
  LocalDirectoryScanResult,
  LocalLibraryRefreshResult,
  LocalRefreshCause,
  LocalRefreshOutcome,
  LocalRefreshTrigger,
  LocalScanCounts,
  LocalSourceDirectories,
} from "../shared/local-library-contracts";

/**
 * Ticket 23b: the mtime coarse filter in front of the directory rescan.
 *
 * A window focus, or a return from the detail/player layer, asks this scheduler
 * for one change check. It compares a cheap directory signature against a
 * baseline persisted beside the SQLite database, and hands only the directories
 * that actually changed to `scanDirectories` (Ticket 23a). An unchanged library
 * therefore produces no scan, no progress event and no status flicker.
 *
 * The signature is per known directory: the directory's own mtime (so adding or
 * removing an entry is enough) plus size + mtime of the entries that can change
 * what the library shows (videos, NFO sidecars, artwork). A directory mtime
 * alone cannot see an NFO edit in place, so the file part is what makes "edit an
 * NFO, come back" work. Walk cost is one listing per known directory; the file
 * tree is never traversed and no schema is added.
 */
export const LOCAL_LIBRARY_REFRESH_THROTTLE_MS = 5_000;
export const LOCAL_LIBRARY_REFRESH_BASELINE_VERSION = 1 as const;
export const LOCAL_LIBRARY_REFRESH_BASELINE_FILE = "directory-mtime.json";

/** Entries whose size/mtime can change the indexed library. Other files are ignored. */
const LIBRARY_ENTRY_EXTENSIONS = new Set([
  ".avi", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4", ".ts", ".webm",
  ".nfo",
  ".avif", ".jpeg", ".jpg", ".png", ".webp",
]);

/** One directory's cheap identity: its own mtime plus the library-relevant entries. */
export interface LocalDirectorySignature {
  mtimeMs: number;
  /** Entry name → `${sizeBytes}:${mtimeMs}`. Relative names only; no path leaves the machine. */
  files: Record<string, string>;
}

/**
 * A directory the local filesystem watcher proved dirty (Ticket 24a). The value
 * is source-relative and POSIX-shaped; `""` is the source root. It never leaves
 * the main process: the watcher hands it to `LocalLibraryRefreshScheduler`,
 * which turns it into a directory-scoped owner rescan.
 */
export interface LocalWatchedDirectory {
  sourceId: string;
  relativeDirectory: string;
}

interface LocalRefreshBaselineSource {
  directories: Record<string, LocalDirectorySignature>;
}

interface LocalRefreshBaselineFile {
  version: typeof LOCAL_LIBRARY_REFRESH_BASELINE_VERSION;
  updatedAtMs: number;
  sources: Record<string, LocalRefreshBaselineSource>;
}

/** Main-only database surface the scheduler needs. The renderer never sees these calls. */
export interface LocalRefreshDatabasePort {
  listScanDirectories(): Promise<readonly LocalSourceDirectories[]>;
  sourceRoot(sourceId: string): Promise<string | undefined>;
  scanDirectories(sourceId: string, relativeDirectories: readonly string[]): Promise<LocalDirectoryScanResult>;
}

export interface LocalLibraryRefreshOptions {
  /** Minimum gap between two automatic checks; `force` bypasses it for a return to the library. */
  throttleMs?: number;
  now?: () => number;
  /** Test seam: the default reads the real directory. */
  statDirectory?: (directoryPath: string) => Promise<LocalDirectorySignature | undefined>;
  /** Called once per completed automatic scan; an unchanged check reports nothing. */
  onResult?: (result: LocalLibraryRefreshResult) => void;
  /** Diagnostic hook: coarse-check failures are swallowed so they never disturb the UI. */
  onError?: (error: unknown) => void;
}

/**
 * Reads one directory's signature. A missing or unreadable directory yields
 * `undefined` so a temporarily offline source is not treated as "everything
 * changed"; the previous baseline entry is kept and compared on a later check.
 */
async function readDirectorySignature(directoryPath: string): Promise<LocalDirectorySignature | undefined> {
  let directoryStat;
  try {
    directoryStat = await stat(directoryPath);
  } catch {
    return undefined;
  }
  if (!directoryStat.isDirectory()) return undefined;
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const files: Record<string, string> = {};
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue;
    if (!LIBRARY_ENTRY_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    try {
      const entryStat = await stat(join(directoryPath, entry.name));
      if (!entryStat.isFile()) continue;
      files[entry.name] = `${entryStat.size}:${entryStat.mtimeMs}`;
    } catch {
      // The entry disappeared between the listing and its stat; the next check
      // sees the settled directory instead of reporting a phantom change.
    }
  }
  return { mtimeMs: directoryStat.mtimeMs, files };
}

/** Absolute path for one source-relative directory; `""` (or `/`) is the source root. */
function directoryPath(rootPath: string, relativeDirectory: string): string {
  const segments = relativeDirectory.split("/").filter(Boolean);
  return segments.length ? join(rootPath, ...segments) : rootPath;
}

function signatureKey(sourceId: string, relativeDirectory: string): string {
  return `${sourceId}\u0000${relativeDirectory}`;
}

function sameSignature(left: LocalDirectorySignature, right: LocalDirectorySignature): boolean {
  if (left.mtimeMs !== right.mtimeMs) return false;
  const leftNames = Object.keys(left.files);
  const rightNames = Object.keys(right.files);
  if (leftNames.length !== rightNames.length) return false;
  return leftNames.every((name) => left.files[name] === right.files[name]);
}

function signatureCopy(signature: LocalDirectorySignature): LocalDirectorySignature {
  return { mtimeMs: signature.mtimeMs, files: { ...signature.files } };
}

/**
 * Keep only the topmost directories: an ancestor rescan already visits its
 * descendants, and passing both would count the same files twice.
 */
function collapseDirectories(directories: readonly string[]): string[] {
  const sorted = [...directories].sort((left, right) => left.localeCompare(right));
  const kept: string[] = [];
  for (const directory of sorted) {
    const covered = kept.some((ancestor) => ancestor === "" || ancestor === directory || directory.startsWith(`${ancestor}/`));
    if (!covered) kept.push(directory);
  }
  return kept;
}

function emptyCounts(): LocalScanCounts {
  return { imported: 0, updated: 0, unchanged: 0, removed: 0 };
}

function addCounts(target: LocalScanCounts, source: LocalScanCounts): void {
  target.imported += source.imported;
  target.updated += source.updated;
  target.unchanged += source.unchanged;
  target.removed += source.removed;
}

/**
 * The owner's accepted spelling of a scan scope. The library names the source
 * root `""` internally (that is the baseline and inventory key), but
 * `scanDirectories` validates its input as a non-empty relative directory where
 * `"."` is the root. Without this translation a change in the source root would
 * be rejected before any scan starts.
 */
function scanScopeArgument(relativeDirectory: string): string {
  return relativeDirectory === "" ? "." : relativeDirectory;
}

function emptyBaseline(nowMs: number): LocalRefreshBaselineFile {
  return { version: LOCAL_LIBRARY_REFRESH_BASELINE_VERSION, updatedAtMs: nowMs, sources: {} };
}

/** Tolerantly rebuild a persisted baseline; malformed entries are dropped, never trusted blindly. */
function parseBaseline(value: unknown, nowMs: number): LocalRefreshBaselineFile {
  const baseline = emptyBaseline(nowMs);
  if (!value || typeof value !== "object") return baseline;
  const record = value as { version?: unknown; sources?: unknown };
  if (record.version !== LOCAL_LIBRARY_REFRESH_BASELINE_VERSION) return baseline;
  if (!record.sources || typeof record.sources !== "object" || Array.isArray(record.sources)) return baseline;
  for (const [sourceId, entry] of Object.entries(record.sources as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const directoriesValue = (entry as { directories?: unknown }).directories;
    if (!directoriesValue || typeof directoriesValue !== "object" || Array.isArray(directoriesValue)) continue;
    const directories: Record<string, LocalDirectorySignature> = {};
    for (const [relativeDirectory, signatureValue] of Object.entries(directoriesValue as Record<string, unknown>)) {
      if (!signatureValue || typeof signatureValue !== "object") continue;
      const signature = signatureValue as { mtimeMs?: unknown; files?: unknown };
      if (typeof signature.mtimeMs !== "number" || !Number.isFinite(signature.mtimeMs)) continue;
      if (!signature.files || typeof signature.files !== "object" || Array.isArray(signature.files)) continue;
      const files: Record<string, string> = {};
      for (const [name, fingerprint] of Object.entries(signature.files as Record<string, unknown>)) {
        if (typeof fingerprint === "string") files[name] = fingerprint;
      }
      directories[relativeDirectory] = { mtimeMs: signature.mtimeMs, files };
    }
    baseline.sources[sourceId] = { directories };
  }
  return baseline;
}

/**
 * Serializes manual scans, automatic rescans and baseline writes on the main
 * side. The worker keeps its own single-flight guard; this one makes sure an
 * automatic check never starts a second scan behind a manual one — the dirty
 * directories wait instead.
 */
export class LocalLibraryRefreshScheduler {
  private readonly throttleMs: number;
  private readonly now: () => number;
  private readonly statDirectory: (directoryPath: string) => Promise<LocalDirectorySignature | undefined>;
  private readonly resultListeners = new Set<(result: LocalLibraryRefreshResult) => void>();
  private readonly errorListener: ((error: unknown) => void) | undefined;
  private baseline: LocalRefreshBaselineFile | undefined;
  private lastCheckAtMs: number | undefined;
  private activeScans = 0;
  private checking = false;
  private draining = false;
  private pendingTrigger: LocalRefreshTrigger | undefined;
  private disposed = false;
  private baselineChain: Promise<void> = Promise.resolve();
  /** A single-file serial queue for owner scans; see `runScan`. */
  private scanChain: Promise<void> = Promise.resolve();
  /**
   * Ticket 24a: dirty directories the local watcher proved, grouped by source,
   * waiting for the single-flight gate. They are never discarded: a watch flush
   * that arrives during a manual scan is rescanned as soon as the owner is idle.
   */
  private readonly watchQueue = new Map<string, string[]>();
  /**
   * True only while this scheduler's own directory rescan runs. The IPC layer
   * uses it to suppress scan-progress forwarding: an automatic refresh is
   * silent, so it must not flash the scan pill or raise a completion notice.
   */
  private autoScanning = false;

  constructor(
    private readonly database: LocalRefreshDatabasePort,
    private readonly baselinePath: string,
    options: LocalLibraryRefreshOptions = {},
  ) {
    this.throttleMs = typeof options.throttleMs === "number" && options.throttleMs >= 0 ? options.throttleMs : LOCAL_LIBRARY_REFRESH_THROTTLE_MS;
    this.now = options.now ?? (() => Date.now());
    this.statDirectory = options.statDirectory ?? readDirectorySignature;
    this.errorListener = options.onError;
    if (options.onResult) this.resultListeners.add(options.onResult);
  }

  onResult(listener: (result: LocalLibraryRefreshResult) => void): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  /** The IPC bridge suppresses `scan-progress` forwarding while this is true. */
  isAutomaticScanActive(): boolean {
    return this.autoScanning;
  }

  /**
   * Serialize owner scans: a second scan waits for the first instead of racing
   * it in the worker. This is what keeps a manual rescan and an automatic one
   * from overlapping; the worker's own single-flight guard stays the backstop.
   */
  runScan<T>(task: () => Promise<T>): Promise<T> {
    this.activeScans += 1;
    const run = this.scanChain.then(() => task());
    this.scanChain = run.then(() => undefined, () => undefined);
    return run.finally(() => {
      this.activeScans -= 1;
      if (this.activeScans === 0) this.scheduleDrain();
    });
  }

  /**
   * Run one non-scan owner write (import, source removal). It does not enter the
   * scan chain — the worker keeps its readable rejection for an import during a
   * scan — but it marks the owner busy so an automatic check waits for it.
   */
  async runExclusiveOperation<T>(task: () => Promise<T>): Promise<T> {
    this.activeScans += 1;
    try {
      return await task();
    } finally {
      this.activeScans -= 1;
      if (this.activeScans === 0) this.scheduleDrain();
    }
  }

  /** One change check. `force` is used when the library surface becomes visible again. */
  async request(trigger: LocalRefreshTrigger, options: { force?: boolean } = {}): Promise<LocalRefreshOutcome> {
    if (this.disposed) return { status: "unchanged" };
    if (this.checking || this.activeScans > 0) {
      this.pendingTrigger = trigger;
      return { status: "queued" };
    }
    const nowMs = this.now();
    if (!options.force && this.lastCheckAtMs !== undefined && nowMs - this.lastCheckAtMs < this.throttleMs) {
      return { status: "throttled" };
    }
    this.lastCheckAtMs = nowMs;
    this.checking = true;
    try {
      return await this.check(trigger);
    } catch (error) {
      this.errorListener?.(error);
      return { status: "error" };
    } finally {
      this.checking = false;
      this.scheduleDrain();
    }
  }

  /**
   * Ticket 24a: the local filesystem watcher hands the directories it proved
   * dirty here. They enter the same single-flight gate as every other automatic
   * check (`runScan`), so a watch-triggered rescan never overlaps a manual scan,
   * the worker keeps its own scan guard, and a flush that arrives while the
   * owner is busy waits instead of being dropped.
   *
   * The passed directories are expected-dirty, so no mtime comparison is made;
   * a directory that no longer exists (a delete or a rename) is replaced by its
   * nearest existing ancestor, and a rejected value is ignored rather than
   * clamped. Nothing is pushed to the renderer if the rescan finds no change.
   */
  async requestWatch(directories: readonly LocalWatchedDirectory[]): Promise<LocalRefreshOutcome> {
    if (this.disposed) return { status: "unchanged" };
    if (!this.mergeWatchDirectories(directories)) return { status: "unchanged" };
    if (this.checking || this.activeScans > 0 || this.draining) {
      this.scheduleDrain();
      return { status: "queued" };
    }
    return this.runWatchCheck(this.takeWatchDirectories());
  }

  /**
   * One watch-triggered check. It sets the same `checking` flag as a focus check,
   * so two flushes (or a flush and a focus) never resolve directories and scan at
   * the same time, and it never throws: a drain loop must not stall on one bad
   * directory set.
   */
  private async runWatchCheck(pending: Map<string, string[]>): Promise<LocalRefreshOutcome> {
    this.checking = true;
    try {
      return await this.scanWatchedDirectories(pending);
    } catch (error) {
      this.errorListener?.(error);
      return { status: "error" };
    } finally {
      this.checking = false;
      this.scheduleDrain();
    }
  }

  /**
   * Record the post-scan directory signatures for the given sources. Called
   * after every manual scan/import so the next automatic check compares against
   * the state the scan just wrote, including changes made while the app was
   * closed (the baseline is persisted).
   */
  async recordBaselineForSources(sourceIds: readonly string[]): Promise<void> {
    if (this.disposed) return;
    const wanted = new Set(sourceIds.filter(Boolean));
    try {
      const inventory = await this.database.listScanDirectories();
      const baseline = await this.loadBaseline();
      let changed = false;
      for (const source of inventory) {
        if (wanted.size > 0 && !wanted.has(source.sourceId)) continue;
        const rootPath = await this.database.sourceRoot(source.sourceId);
        if (!rootPath) continue;
        const entry = baseline.sources[source.sourceId] ?? { directories: {} };
        baseline.sources[source.sourceId] = entry;
        const known = new Set(source.relativeDirectories);
        for (const relativeDirectory of Object.keys(entry.directories)) {
          if (!known.has(relativeDirectory)) {
            delete entry.directories[relativeDirectory];
            changed = true;
          }
        }
        for (const relativeDirectory of source.relativeDirectories) {
          const signature = await this.statDirectory(directoryPath(rootPath, relativeDirectory));
          if (!signature) continue;
          const previous = entry.directories[relativeDirectory];
          if (!previous || !sameSignature(previous, signature)) {
            entry.directories[relativeDirectory] = signature;
            changed = true;
          }
        }
      }
      if (changed) await this.saveBaseline(baseline);
    } catch (error) {
      this.errorListener?.(error);
    }
  }

  async recordBaselineForSource(sourceId: string): Promise<void> {
    if (!sourceId) return;
    await this.recordBaselineForSources([sourceId]);
  }

  dispose(): void {
    this.disposed = true;
    this.pendingTrigger = undefined;
    this.watchQueue.clear();
    this.resultListeners.clear();
  }

  private async check(trigger: LocalRefreshTrigger): Promise<LocalRefreshOutcome> {
    const inventory = await this.database.listScanDirectories();
    const baseline = await this.loadBaseline();
    let baselineChanged = false;
    const dirtyBySource = new Map<string, string[]>();
    const observedSignatures = new Map<string, LocalDirectorySignature>();

    const liveSourceIds = new Set(inventory.map((source) => source.sourceId));
    for (const sourceId of Object.keys(baseline.sources)) {
      if (!liveSourceIds.has(sourceId)) {
        delete baseline.sources[sourceId];
        baselineChanged = true;
      }
    }
    for (const source of inventory) {
      const entry = baseline.sources[source.sourceId] ?? { directories: {} };
      baseline.sources[source.sourceId] = entry;
      const known = new Set(source.relativeDirectories);
      for (const relativeDirectory of Object.keys(entry.directories)) {
        if (!known.has(relativeDirectory)) {
          delete entry.directories[relativeDirectory];
          baselineChanged = true;
        }
      }
      const rootPath = await this.database.sourceRoot(source.sourceId);
      if (!rootPath) continue;
      for (const relativeDirectory of source.relativeDirectories) {
        const signature = await this.statDirectory(directoryPath(rootPath, relativeDirectory));
        // Missing/unreadable: keep the previous entry so a source that comes back
        // later is compared against what it was, not scanned as "new".
        if (!signature) continue;
        const previous = entry.directories[relativeDirectory];
        if (!previous) {
          // First observation of this directory (a fresh library, or the first
          // check after a scan): record it. The scan that produced these rows
          // already applied the current state, so rescanning here would be the
          // observable no-op the acceptance criteria forbid.
          entry.directories[relativeDirectory] = signature;
          baselineChanged = true;
          continue;
        }
        if (!sameSignature(previous, signature)) {
          const list = dirtyBySource.get(source.sourceId) ?? [];
          list.push(relativeDirectory);
          dirtyBySource.set(source.sourceId, list);
          observedSignatures.set(signatureKey(source.sourceId, relativeDirectory), signatureCopy(signature));
        }
      }
    }
    if (baselineChanged) await this.saveBaseline(baseline);
    if (dirtyBySource.size === 0) return { status: "unchanged" };
    // A manual scan may have started while the signatures above were read.
    if (this.activeScans > 0) {
      this.pendingTrigger = trigger;
      return { status: "queued" };
    }
    return this.scanDirtyDirectories(trigger, dirtyBySource, observedSignatures, baseline);
  }

  /**
   * The one place where a dirty directory set becomes an owner rescan. Both
   * discovery paths share it (Ticket 23b mtime check and Ticket 24a watcher), so
   * there is exactly one scan path, one set of counts and one silent result push.
   */
  private async scanDirtyDirectories(
    cause: LocalRefreshCause,
    dirtyBySource: Map<string, string[]>,
    observedSignatures: Map<string, LocalDirectorySignature>,
    baseline: LocalRefreshBaselineFile,
  ): Promise<LocalRefreshOutcome> {
    const totals = {
      counts: emptyCounts(),
      scannedDirectories: 0,
      nfoUpdatedFiles: 0,
      fingerprintReplacedFiles: 0,
      warningCount: 0,
    };
    let scannedAny = false;
    let failed = false;
    await this.runScan(async () => {
      this.autoScanning = true;
      try {
        for (const [sourceId, directories] of dirtyBySource) {
          const scope = collapseDirectories(directories);
          try {
            const result = await this.database.scanDirectories(sourceId, scope.map(scanScopeArgument));
            scannedAny = true;
            addCounts(totals.counts, result.counts);
            totals.scannedDirectories += scope.length;
            totals.nfoUpdatedFiles += result.nfoUpdatedFiles;
            totals.fingerprintReplacedFiles += result.fingerprintReplacedFiles;
            totals.warningCount += result.warningCount;
            const entry = baseline.sources[sourceId] ?? { directories: {} };
            baseline.sources[sourceId] = entry;
            // The ancestor rescan also visited every dirty descendant it
            // covers, so all their observed signatures become the new baseline;
            // otherwise the next check would rescan the same children again.
            for (const relativeDirectory of directories) {
              const signature = observedSignatures.get(signatureKey(sourceId, relativeDirectory));
              if (signature) entry.directories[relativeDirectory] = signature;
            }
          } catch (error) {
            // Leave the previous baseline untouched: the same change is retried on
            // the next return instead of being silently forgotten.
            failed = true;
            this.errorListener?.(error);
          }
        }
      } finally {
        this.autoScanning = false;
      }
    });
    if (!scannedAny) return { status: failed ? "error" : "unchanged" };
    await this.saveBaseline(baseline);
    // A directory can be dirty while its contents are equivalent (a temp file
    // that was created and removed, a touched NFO with identical metadata).
    // The data is current, but there is nothing to report: stay silent.
    if (totals.counts.imported + totals.counts.updated + totals.counts.removed === 0) return { status: "unchanged" };
    const result: LocalLibraryRefreshResult = { trigger: cause, ...totals };
    for (const listener of this.resultListeners) listener(result);
    return { status: "refreshed" };
  }

  /**
   * Validate and queue watcher-reported directories. An empty value (or `"."`)
   * is the source root; anything that names another root or escapes the source
   * is dropped rather than clamped into a scan. Returns whether anything new was
   * queued.
   */
  private mergeWatchDirectories(directories: readonly LocalWatchedDirectory[]): boolean {
    let merged = false;
    for (const candidate of directories) {
      if (!candidate || typeof candidate.sourceId !== "string" || !candidate.sourceId) continue;
      if (typeof candidate.relativeDirectory !== "string") continue;
      const relativeDirectory = candidate.relativeDirectory === ""
        ? ""
        : normalizeScanRelativeDirectory(candidate.relativeDirectory);
      if (relativeDirectory === undefined) continue;
      const queued = this.watchQueue.get(candidate.sourceId) ?? [];
      if (!queued.includes(relativeDirectory)) {
        queued.push(relativeDirectory);
        this.watchQueue.set(candidate.sourceId, queued);
        merged = true;
      }
    }
    return merged;
  }

  private takeWatchDirectories(): Map<string, string[]> {
    const pending = new Map<string, string[]>();
    for (const [sourceId, directories] of this.watchQueue) pending.set(sourceId, [...directories]);
    this.watchQueue.clear();
    return pending;
  }

  /** Put the resolved set back when the owner turned out to be busy mid-flight. */
  private requeueWatchDirectories(dirtyBySource: Map<string, string[]>): void {
    for (const [sourceId, directories] of dirtyBySource) {
      const queued = this.watchQueue.get(sourceId) ?? [];
      for (const relativeDirectory of directories) {
        if (!queued.includes(relativeDirectory)) queued.push(relativeDirectory);
      }
      this.watchQueue.set(sourceId, queued);
    }
  }

  /**
   * Resolve the watcher's directories against the live sources and rescan them.
   * A source that was removed (or whose root is unreadable) contributes nothing:
   * its watch handle is being stopped, and the focus refresh covers reconnection.
   */
  private async scanWatchedDirectories(pending: Map<string, string[]>): Promise<LocalRefreshOutcome> {
    if (pending.size === 0) return { status: "unchanged" };
    const inventory = await this.database.listScanDirectories();
    const live = new Set(inventory.map((source) => source.sourceId));
    const baseline = await this.loadBaseline();
    const dirtyBySource = new Map<string, string[]>();
    const observedSignatures = new Map<string, LocalDirectorySignature>();
    for (const [sourceId, directories] of pending) {
      if (!live.has(sourceId)) continue;
      const rootPath = await this.database.sourceRoot(sourceId);
      if (!rootPath) continue;
      const resolved: string[] = [];
      for (const relativeDirectory of directories) {
        const found = await this.resolveExistingDirectory(rootPath, relativeDirectory);
        if (!found) continue;
        if (!resolved.includes(found.relativeDirectory)) resolved.push(found.relativeDirectory);
        observedSignatures.set(signatureKey(sourceId, found.relativeDirectory), found.signature);
      }
      if (resolved.length > 0) dirtyBySource.set(sourceId, resolved);
    }
    if (dirtyBySource.size === 0) return { status: "unchanged" };
    // A manual scan may have started while the directories above were resolved.
    if (this.activeScans > 0) {
      this.requeueWatchDirectories(dirtyBySource);
      this.scheduleDrain();
      return { status: "queued" };
    }
    return this.scanDirtyDirectories("watch", dirtyBySource, observedSignatures, baseline);
  }

  /**
   * The directory to rescan for one watcher report: the directory itself when it
   * is still readable, otherwise its nearest existing ancestor, and `undefined`
   * when even the source root is unreadable (an offline source).
   */
  private async resolveExistingDirectory(
    rootPath: string,
    relativeDirectory: string,
  ): Promise<{ relativeDirectory: string; signature: LocalDirectorySignature } | undefined> {
    let candidate = relativeDirectory === "" ? "" : normalizeScanRelativeDirectory(relativeDirectory);
    if (candidate === undefined) return undefined;
    for (;;) {
      const signature = await this.statDirectory(directoryPath(rootPath, candidate));
      if (signature) return { relativeDirectory: candidate, signature };
      if (candidate === "") return undefined;
      const cut = candidate.lastIndexOf("/");
      candidate = cut === -1 ? "" : candidate.slice(0, cut);
    }
  }

  private scheduleDrain(): void {
    if (this.disposed || this.draining || this.checking || this.activeScans > 0) return;
    const trigger = this.pendingTrigger;
    const hasWatchDirectories = this.watchQueue.size > 0;
    if (!trigger && !hasWatchDirectories) return;
    this.pendingTrigger = undefined;
    this.draining = true;
    // A queued focus/return check already re-reads every known directory, so it
    // wins this round; the watch queue stays and drains right after it.
    const run = trigger
      ? this.request(trigger, { force: true })
      : this.runWatchCheck(this.takeWatchDirectories());
    void run
      .catch(() => undefined)
      .finally(() => {
        this.draining = false;
        this.scheduleDrain();
      });
  }

  private async loadBaseline(): Promise<LocalRefreshBaselineFile> {
    if (this.baseline) return this.baseline;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.baselinePath, "utf8"));
    } catch {
      parsed = undefined;
    }
    this.baseline = parseBaseline(parsed, this.now());
    return this.baseline;
  }

  private saveBaseline(baseline: LocalRefreshBaselineFile): Promise<void> {
    baseline.updatedAtMs = this.now();
    // Serialize writes so two overlapping owners cannot leave a truncated sidecar.
    const next = this.baselineChain.then(async () => {
      const serialized = `${JSON.stringify(baseline, null, 2)}\n`;
      const temporary = `${this.baselinePath}.tmp`;
      try {
        await mkdir(dirname(this.baselinePath), { recursive: true });
        await writeFile(temporary, serialized, "utf8");
        await rename(temporary, this.baselinePath);
      } catch (error) {
        this.errorListener?.(error);
      }
    });
    this.baselineChain = next;
    return next;
  }
}
