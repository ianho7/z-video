import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LOCAL_LIBRARY_NETWORK_POLL_INTERVAL_MS,
  LocalLibraryNetworkPoller,
  LocalNetworkPollError,
  LocalLibraryWatcher,
  RecursiveFsWatchChangeSource,
  createLocalSourceClassifier,
  isUncSourcePath,
  type ChangeSource,
  type ChangeSourceEvent,
  type LocalSourceKind,
  type LocalWatchSource,
  type LocalWatchTimers,
} from "../src/main/local-library-watch";
import type { LocalWatchedDirectory } from "../src/main/local-library-refresh";
import type { LocalSourceDirectories } from "../src/shared/local-library-contracts";

const SOURCE_A = "source_11111111-1111-4111-8111-111111111111";
const SOURCE_B = "source_22222222-2222-4222-8222-222222222222";

/** The injected change source: tests push events instead of relying on `fs.watch` timing. */
interface FakeStart {
  rootPath: string;
  onEvent: (event: ChangeSourceEvent) => void;
  stopped: boolean;
}

class FakeChangeSource implements ChangeSource {
  readonly starts: FakeStart[] = [];
  readonly failRoots = new Set<string>();
  start(rootPath: string, onEvent: (event: ChangeSourceEvent) => void): { stop(): void } {
    if (this.failRoots.has(rootPath)) throw Object.assign(new Error("watch unavailable"), { code: "EPERM" });
    const record: FakeStart = { rootPath, onEvent, stopped: false };
    this.starts.push(record);
    return { stop: () => { record.stopped = true; } };
  }

  startFor(rootPath: string): FakeStart {
    const record = this.starts.find((candidate) => candidate.rootPath === rootPath);
    if (!record) throw new Error(`no fake watcher for ${rootPath}`);
    return record;
  }

  emit(path: string | undefined, rootPath: string): void {
    this.startFor(rootPath).onEvent({ type: "change", ...(path === undefined ? {} : { path }) });
  }

  emitUnavailable(rootPath: string): void {
    this.startFor(rootPath).onEvent({ type: "unavailable" });
  }
}

/** Deterministic debounce: the test decides when the 1.5 s window elapses. */
function createFakeTimers(): {
  timers: LocalWatchTimers;
  pendingCount: () => number;
  fire: () => void;
} {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    timers: {
      setTimeout: (callback: () => void) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, callback);
        return id;
      },
      clearTimeout: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    pendingCount: () => pending.size,
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
  };
}

interface Harness {
  watcher: LocalLibraryWatcher;
  source: FakeChangeSource;
  flushes: LocalWatchedDirectory[][];
  errors: unknown[];
  pendingCount: () => number;
  fire: () => void;
}

function createHarness(options: { rootA?: string; rootB?: string; classifySource?: (rootPath: string) => LocalSourceKind } = {}): Harness {
  const rootA = options.rootA ?? join(tmpdir(), "z-video-watch-fake", "library-a");
  const rootB = options.rootB ?? join(tmpdir(), "z-video-watch-fake", "library-b");
  const source = new FakeChangeSource();
  const clocks = createFakeTimers();
  const flushes: LocalWatchedDirectory[][] = [];
  const errors: unknown[] = [];
  const inventory: LocalWatchSource[] = [
    { sourceId: SOURCE_A, rootPath: rootA },
    { sourceId: SOURCE_B, rootPath: rootB },
  ];
  const watcher = new LocalLibraryWatcher({
    sources: { listSources: async () => inventory },
    changeSource: source,
    timers: clocks.timers,
    // Unit tests never probe the real drive type; the production default is
    // exercised through its injected resolver below.
    classifySource: options.classifySource ?? (() => "local"),
    onError: (error) => errors.push(error),
    onChange: (directories) => flushes.push([...directories]),
  });
  return { watcher, source, flushes, errors, pendingCount: clocks.pendingCount, fire: clocks.fire };
}

test("a burst of filesystem events becomes one debounced, merged and deduplicated flush", async () => {
  const harness = createHarness();
  const rootA = join(tmpdir(), "z-video-watch-fake", "library-a");
  await harness.watcher.sync();
  assert.equal(harness.source.starts.length, 2, "each registered source gets one change source");

  harness.source.emit(join(rootA, "A-dir", "a.nfo"), rootA);
  harness.source.emit(join(rootA, "A-dir", "a.nfo"), rootA);
  harness.source.emit(join(rootA, "A-dir", "second.mkv"), rootA);
  harness.source.emit(join(rootA, "B-dir", "b.mkv"), rootA);

  assert.deepEqual(harness.flushes, [], "nothing is delivered before the debounce window elapses");
  assert.equal(harness.pendingCount(), 1, "one debounce timer covers the whole burst");

  harness.fire();

  assert.deepEqual(harness.flushes, [[
    { sourceId: SOURCE_A, relativeDirectory: "A-dir" },
    { sourceId: SOURCE_A, relativeDirectory: "B-dir" },
  ]], "one flush carries the merged, deduplicated dirty directories");
  assert.equal(harness.pendingCount(), 0, "the debounce timer is released after the flush");
  harness.watcher.dispose();
});

test("temporary and system junk entries never schedule a refresh", async () => {
  const harness = createHarness();
  const rootA = join(tmpdir(), "z-video-watch-fake", "library-a");
  await harness.watcher.sync();

  for (const name of ["download.tmp", "movie.mkv.part", "~$draft.nfo", "Thumbs.db", "thumbs.DB", "@eaDir/thumb.jpg", "#recycle/old.mkv", "@eaDir"]) {
    harness.source.emit(join(rootA, name), rootA);
  }

  assert.equal(harness.pendingCount(), 0, "an ignored entry does not even arm the debounce timer");
  assert.deepEqual(harness.flushes, [], "an ignored entry never reaches the refresh scheduler");

  harness.source.emit(join(rootA, "A-dir", "real.mkv"), rootA);
  assert.equal(harness.pendingCount(), 1, "the same watcher still reports a real library entry");
  harness.fire();
  assert.deepEqual(harness.flushes, [[{ sourceId: SOURCE_A, relativeDirectory: "A-dir" }]]);
  harness.watcher.dispose();
});

test("an unnamed event marks the source root dirty instead of guessing a directory", async () => {
  const harness = createHarness();
  const rootA = join(tmpdir(), "z-video-watch-fake", "library-a");
  await harness.watcher.sync();

  harness.source.emit(undefined, rootA);
  harness.fire();

  assert.deepEqual(harness.flushes, [[{ sourceId: SOURCE_A, relativeDirectory: "" }]]);
  harness.watcher.dispose();
});

test("removing or forgetting a source stops its subscription and drops its pending directories", async () => {
  const harness = createHarness();
  const rootA = join(tmpdir(), "z-video-watch-fake", "library-a");
  const rootB = join(tmpdir(), "z-video-watch-fake", "library-b");
  await harness.watcher.sync();

  harness.source.emit(join(rootA, "A-dir", "a.mkv"), rootA);
  harness.watcher.forgetSources([SOURCE_A]);
  assert.equal(harness.source.startFor(rootA).stopped, true, "the removed source's watcher is released");
  harness.source.emit(join(rootA, "A-dir", "late.mkv"), rootA);
  harness.fire();
  assert.deepEqual(harness.flushes, [], "a late event from a removed source never flushes");

  harness.source.emit(join(rootB, "B-dir", "b.mkv"), rootB);
  harness.fire();
  assert.deepEqual(harness.flushes, [[{ sourceId: SOURCE_B, relativeDirectory: "B-dir" }]], "the remaining source still reports");

  harness.watcher.syncSources([{ sourceId: SOURCE_B, rootPath: rootB }]);
  assert.equal(harness.source.startFor(rootB).stopped, false, "a still-registered source keeps its subscription");
  harness.watcher.dispose();
  assert.equal(harness.source.startFor(rootB).stopped, true, "dispose releases every remaining watcher");
});

test("dispose clears the pending debounce timer and ignores later events", async () => {
  const harness = createHarness();
  const rootA = join(tmpdir(), "z-video-watch-fake", "library-a");
  await harness.watcher.sync();
  harness.source.emit(join(rootA, "A-dir", "a.mkv"), rootA);
  assert.equal(harness.pendingCount(), 1);

  harness.watcher.dispose();
  assert.equal(harness.pendingCount(), 0, "quit leaves no timer behind");
  harness.source.emit(join(rootA, "A-dir", "late.mkv"), rootA);
  assert.equal(harness.pendingCount(), 0, "an event after dispose cannot arm a timer again");
  assert.deepEqual(harness.flushes, [], "an event after dispose is never delivered");
});

test("a source that cannot be watched stays silent and is retried on the next sync", async () => {
  const rootA = join(tmpdir(), "z-video-watch-fake", "library-a");
  const source = new FakeChangeSource();
  source.failRoots.add(rootA);
  const flushes: LocalWatchedDirectory[][] = [];
  const errors: unknown[] = [];
  const watcher = new LocalLibraryWatcher({
    sources: { listSources: async () => [{ sourceId: SOURCE_A, rootPath: rootA }] },
    changeSource: source,
    timers: createFakeTimers().timers,
    onError: (error) => errors.push(error),
    onChange: (directories) => flushes.push([...directories]),
  });

  await watcher.sync();
  assert.equal(watcher.isWatching(SOURCE_A), false);
  assert.equal(errors.length, 1, "the diagnostics hook still sees why the watch fell back");
  assert.deepEqual(flushes, [], "the user-visible refresh path stays silent");

  source.failRoots.clear();
  await watcher.sync();
  assert.equal(watcher.isWatching(SOURCE_A), true, "the next sync retries instead of latching the failure");
  watcher.dispose();
});

test("a watch error marks the source unavailable, stops it, and leaves the focus refresh alone", async () => {
  const harness = createHarness();
  const rootA = join(tmpdir(), "z-video-watch-fake", "library-a");
  await harness.watcher.sync();

  harness.source.emitUnavailable(rootA);
  assert.equal(harness.watcher.isWatching(SOURCE_A), false, "an unavailable source has no live watcher");
  assert.equal(harness.source.startFor(rootA).stopped, true, "the failed handle is released");
  assert.deepEqual(harness.flushes, [], "no refresh is triggered by the failure itself");

  harness.source.emit(join(rootA, "A-dir", "a.mkv"), rootA);
  harness.fire();
  assert.deepEqual(harness.flushes, [], "a stale handle cannot produce dirty directories");
  harness.watcher.dispose();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until a flush produced after `from` mentions the expected directory.
 * The production watch is asynchronous by nature; only the wait is time-based,
 * the assertion itself is still "this directory was reported".
 */
async function waitForDirtyDirectory(
  flushes: LocalWatchedDirectory[][],
  from: number,
  expected: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (flushes.slice(from).some((flush) => flush.some((entry) => entry.relativeDirectory === expected))) return;
    await delay(25);
  }
  assert.fail(`no flush reported ${JSON.stringify(expected)} within ${timeoutMs} ms (got ${JSON.stringify(flushes.slice(from))})`);
}

/**
 * The production change source against a real temporary directory. Windows and
 * macOS support recursive `fs.watch`; where it is unavailable the test skips
 * explicitly instead of pretending the behaviour passed.
 */
test("the production recursive watch reports real create, delete and rename events", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "z-video-watch-real-"));
  const changeSource = new RecursiveFsWatchChangeSource();
  const recursiveSupported = (() => {
    try {
      changeSource.start(root, () => undefined).stop();
      return true;
    } catch {
      return false;
    }
  })();
  if (!recursiveSupported) {
    await rm(root, { recursive: true, force: true });
    t.skip("recursive fs.watch is unavailable on this platform");
    return;
  }
  const flushes: LocalWatchedDirectory[][] = [];
  const watcher = new LocalLibraryWatcher({
    sources: { listSources: async () => [{ sourceId: SOURCE_A, rootPath: root }] },
    changeSource,
    debounceMs: 100,
    onChange: (directories) => flushes.push([...directories]),
  });
  try {
    await watcher.sync();
    const seasonDirectory = join(root, "Season 01");
    await mkdir(seasonDirectory, { recursive: true });
    await waitForDirtyDirectory(flushes, 0, "");

    let mark = flushes.length;
    await writeFile(join(seasonDirectory, "episode 01.mkv"), Buffer.from("fixture"));
    await waitForDirtyDirectory(flushes, mark, "Season 01");

    mark = flushes.length;
    await rename(join(seasonDirectory, "episode 01.mkv"), join(seasonDirectory, "episode 01 renamed.mkv"));
    await waitForDirtyDirectory(flushes, mark, "Season 01");

    mark = flushes.length;
    await rm(join(seasonDirectory, "episode 01 renamed.mkv"));
    await waitForDirtyDirectory(flushes, mark, "Season 01");

    // Quit cleanup, proved against the real handle: after dispose no change can
    // produce a callback and no debounce timer is left behind.
    watcher.dispose();
    mark = flushes.length;
    await writeFile(join(seasonDirectory, "after dispose.mkv"), Buffer.from("fixture"));
    await delay(700);
    assert.deepEqual(flushes.slice(mark), [], "a disposed watcher reports nothing for later filesystem changes");
  } finally {
    watcher.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Ticket 24b: network-share fallback polling.
 *
 * The share itself is simulated: classification is injected, the directory
 * stat is injected, and the timer is fake, so none of these tests touch a real
 * SMB server. See docs/local-library/contracts.md for the unverified boundary.
 * ------------------------------------------------------------------ */

const SOURCE_NET = "source_33333333-3333-4333-8333-333333333333";
const SOURCE_LOCAL = "source_44444444-4444-4444-8444-444444444444";

/** Deterministic interval: the test decides when a poll tick happens. */
function createPollTimers(): {
  timers: LocalWatchTimers;
  delays: number[];
  pendingCount: () => number;
  fire: () => void;
} {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    timers: {
      setTimeout: (callback: () => void, delayMs: number) => {
        delays.push(delayMs);
        const id = nextId;
        nextId += 1;
        pending.set(id, callback);
        return id;
      },
      clearTimeout: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    delays,
    pendingCount: () => pending.size,
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
  };
}

/** Let an already-fired fake tick finish its injected async stat/scan work. */
async function flushAsync(turns = 4): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

interface PollHarness {
  poller: LocalLibraryNetworkPoller;
  stats: string[];
  changes: LocalWatchedDirectory[][];
  errors: unknown[];
  mtimes: Map<string, number>;
  unreachable: Set<string>;
  clocks: ReturnType<typeof createPollTimers>;
  networkRoot: string;
  localRoot: string;
  setForeground(value: boolean): void;
}

function createPollHarness(options: {
  relativeDirectories?: string[];
  classifySource?: (rootPath: string) => LocalSourceKind;
} = {}): PollHarness {
  const networkRoot = join(tmpdir(), "z-video-poll-fake", "network-share");
  const localRoot = join(tmpdir(), "z-video-poll-fake", "local-folder");
  const relativeDirectories = options.relativeDirectories ?? ["A-dir", "B-dir"];
  const inventory: LocalSourceDirectories[] = [
    { sourceId: SOURCE_NET, relativeDirectories },
    { sourceId: SOURCE_LOCAL, relativeDirectories: ["Local-Dir"] },
  ];
  const roots: Record<string, string> = { [SOURCE_NET]: networkRoot, [SOURCE_LOCAL]: localRoot };
  const mtimes = new Map<string, number>();
  const unreachable = new Set<string>();
  const stats: string[] = [];
  const changes: LocalWatchedDirectory[][] = [];
  const errors: unknown[] = [];
  const clocks = createPollTimers();
  let foreground = true;
  const poller = new LocalLibraryNetworkPoller({
    directories: {
      listScanDirectories: async () => inventory,
      sourceRoot: async (sourceId) => roots[sourceId],
    },
    classifySource: options.classifySource ?? ((rootPath) => rootPath === networkRoot ? "network" : "local"),
    isForeground: () => foreground,
    statDirectoryMtime: async (directoryPath) => {
      stats.push(directoryPath);
      if (unreachable.has(directoryPath)) return undefined;
      return mtimes.get(directoryPath) ?? 1_000;
    },
    timers: clocks.timers,
    onChange: (directories) => changes.push([...directories]),
    onError: (error) => errors.push(error),
  });
  return {
    poller,
    stats,
    changes,
    errors,
    mtimes,
    unreachable,
    clocks,
    networkRoot,
    localRoot,
    setForeground: (value: boolean) => {
      foreground = value;
    },
  };
}

test("UNC roots and mapped remote drives classify as network; everything else stays local", () => {
  assert.equal(isUncSourcePath("\\\\nas\\media"), true, "a backslash UNC root is a share");
  assert.equal(isUncSourcePath("//nas/media"), true, "a forward-slash UNC root is a share");
  assert.equal(isUncSourcePath("\\\\nas\\media\\movies"), true);
  assert.equal(isUncSourcePath("C:\\media"), false, "a drive path is not UNC");
  assert.equal(isUncSourcePath("\\\\?\\C:\\media"), false, "the local device namespace is not a share");
  assert.equal(isUncSourcePath("\\\\?\\UNC\\nas\\media"), true, "the UNC device spelling still names a share");

  const remote = createLocalSourceClassifier(() => 4);
  assert.equal(remote("X:\\library"), "network", "a mapped DRIVE_REMOTE drive is a network source");
  assert.equal(remote("\\\\nas\\media"), "network", "a UNC root is decided without the API");
  const fixed = createLocalSourceClassifier(() => 3);
  assert.equal(fixed("D:\\library"), "local", "a fixed drive is not polled");
  const unavailable = createLocalSourceClassifier(() => undefined);
  assert.equal(unavailable("X:\\library"), "local", "an unavailable drive-type probe falls back to local");
  assert.equal(fixed("relative\\folder"), "local", "only drive-qualified paths consult the drive type");
});

test("a network source is never given a local filesystem watch", async () => {
  const networkRoot = join(tmpdir(), "z-video-watch-fake", "network-share");
  let networkIsShare = true;
  const harness = createHarness({
    rootB: networkRoot,
    classifySource: (rootPath) => (rootPath === networkRoot && networkIsShare ? "network" : "local"),
  });
  await harness.watcher.sync();

  assert.equal(harness.watcher.isWatching(SOURCE_B), false, "a share gets no recursive watch");
  assert.equal(harness.source.starts.some((start) => start.rootPath === networkRoot), false, "no watch handle is created for the share");
  assert.equal(harness.watcher.isWatching(SOURCE_A), true, "the local source is still watched");
  assert.deepEqual(harness.errors, [], "skipping a share is not a watch failure");

  networkIsShare = false;
  await harness.watcher.sync();
  assert.equal(harness.source.starts.some((start) => start.rootPath === networkRoot), true, "a root that becomes local is watched on the next sync");
  harness.watcher.dispose();
});

test("polling stats only the known directories of network sources and records a silent baseline", async () => {
  const harness = createPollHarness({ relativeDirectories: ["", "A-dir", "B-dir"] });
  await harness.poller.poll();

  assert.deepEqual(harness.stats, [
    harness.networkRoot,
    join(harness.networkRoot, "A-dir"),
    join(harness.networkRoot, "B-dir"),
  ], "exactly the known directories are stat'ed; no file and no local source");
  assert.equal(harness.stats.some((path) => path.includes("Local-Dir")), false, "a local source is never polled");
  assert.deepEqual(harness.changes, [], "the first observation only records the baseline");
  harness.poller.dispose();
});

test("a directory whose mtime changed is reported once and only that directory is handed on", async () => {
  const harness = createPollHarness({ relativeDirectories: ["", "A-dir", "B-dir"] });
  await harness.poller.poll();
  harness.mtimes.set(join(harness.networkRoot, "B-dir"), 2_000);
  await harness.poller.poll();

  assert.deepEqual(harness.changes, [[{ sourceId: SOURCE_NET, relativeDirectory: "B-dir" }]], "only the changed directory is reported");
  assert.equal(harness.stats.length, 6, "one stat per known directory per poll, never a tree walk");

  await harness.poller.poll();
  assert.equal(harness.changes.length, 1, "an unchanged poll reports nothing again");
  harness.mtimes.set(harness.networkRoot, 3_000);
  await harness.poller.poll();
  assert.deepEqual(harness.changes[1], [{ sourceId: SOURCE_NET, relativeDirectory: "" }], "a change at the source root is reported as the root");
  harness.poller.dispose();
});

test("polling is skipped while the main window is not focused and resumes on focus", async () => {
  const harness = createPollHarness();
  await harness.poller.poll();
  const afterBaseline = harness.stats.length;

  harness.setForeground(false);
  harness.mtimes.set(join(harness.networkRoot, "A-dir"), 2_000);
  await harness.poller.poll();
  assert.equal(harness.stats.length, afterBaseline, "a background poll does not stat a single directory");
  assert.deepEqual(harness.changes, [], "a background change is not reported while background");

  harness.setForeground(true);
  await harness.poller.poll();
  assert.deepEqual(harness.changes, [[{ sourceId: SOURCE_NET, relativeDirectory: "A-dir" }]], "the next foreground poll sees the change made in the background");
  harness.poller.dispose();
});

test("an unreachable share reports no dirty directory, logs one path-free diagnostic and is retried", async () => {
  const harness = createPollHarness({ relativeDirectories: ["", "A-dir"] });
  await harness.poller.poll();
  const directory = join(harness.networkRoot, "A-dir");
  harness.unreachable.add(directory);
  const before = harness.stats.length;
  await harness.poller.poll();
  await harness.poller.poll();

  assert.equal(harness.stats.length, before + 4, "polling keeps retrying instead of latching the failure");
  assert.deepEqual(harness.changes, [], "an unreachable share produces no change and no availability claim");
  assert.equal(harness.errors.length, 1, "one diagnostic per failure streak, not one per tick");
  const error = harness.errors[0];
  assert.ok(error instanceof LocalNetworkPollError, "the diagnostic is the dedicated error kind");
  assert.equal(error instanceof Error ? error.name : "", "LocalNetworkPollError");
  assert.equal(String((error as Error).message).includes(harness.networkRoot), false, "the diagnostic carries no path");

  harness.mtimes.set(directory, 9_000);
  harness.unreachable.delete(directory);
  await harness.poller.poll();
  assert.deepEqual(harness.changes, [[{ sourceId: SOURCE_NET, relativeDirectory: "A-dir" }]], "recovery compares against the last observed mtime and retries the change");
  assert.equal(harness.errors.length, 1, "a recovered source clears the failure streak");

  harness.unreachable.add(directory);
  await harness.poller.poll();
  assert.equal(harness.errors.length, 2, "a later failure streak reports once again");
  harness.poller.dispose();
});

test("a recovered share with unchanged mtimes reports no false change", async () => {
  const harness = createPollHarness({ relativeDirectories: ["", "A-dir"] });
  await harness.poller.poll();
  const directory = join(harness.networkRoot, "A-dir");
  await harness.poller.poll();
  harness.unreachable.add(directory);
  await harness.poller.poll();
  harness.unreachable.delete(directory);
  await harness.poller.poll();

  assert.deepEqual(harness.changes, [], "a share that came back unchanged is not treated as everything changed");
  harness.poller.dispose();
});

test("the poller is armed at the fixed five-minute interval, only polls in the foreground and stops on dispose", async () => {
  assert.equal(LOCAL_LIBRARY_NETWORK_POLL_INTERVAL_MS, 5 * 60_000, "the documented default interval is five minutes");
  const harness = createPollHarness({ relativeDirectories: ["A-dir"] });
  await harness.poller.start();
  assert.deepEqual(harness.clocks.delays, [LOCAL_LIBRARY_NETWORK_POLL_INTERVAL_MS], "the first tick uses the fixed interval");
  assert.equal(harness.stats.length, 1, "the foreground start establishes the baseline immediately");

  harness.mtimes.set(join(harness.networkRoot, "A-dir"), 7_000);
  harness.clocks.fire();
  await flushAsync();
  assert.deepEqual(harness.changes, [[{ sourceId: SOURCE_NET, relativeDirectory: "A-dir" }]], "a fired tick polls once");
  assert.equal(harness.clocks.pendingCount(), 1, "the tick re-arms itself after it finishes");

  harness.poller.dispose();
  assert.equal(harness.clocks.pendingCount(), 0, "dispose clears the pending tick");
  harness.clocks.fire();
  await flushAsync();
  assert.equal(harness.changes.length, 1, "a disposed poller ignores a late tick");
});

test("a poller started in the background does not stat anything and baselines on the first foreground start", async () => {
  const harness = createPollHarness({ relativeDirectories: ["A-dir"] });
  harness.setForeground(false);
  await harness.poller.start();
  assert.equal(harness.stats.length, 0, "no foreground, no baseline sweep");
  assert.equal(harness.clocks.pendingCount(), 1, "the tick is still armed for when the window comes back");

  harness.setForeground(true);
  await harness.poller.start();
  assert.equal(harness.stats.length, 1, "the first foreground start records the baseline");
  assert.equal(harness.clocks.pendingCount(), 1, "a second start does not arm a second interval");
  assert.deepEqual(harness.clocks.delays, [LOCAL_LIBRARY_NETWORK_POLL_INTERVAL_MS], "the interval is unchanged");
  harness.poller.dispose();
});
