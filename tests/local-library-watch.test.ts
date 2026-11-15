import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LocalLibraryWatcher,
  RecursiveFsWatchChangeSource,
  type ChangeSource,
  type ChangeSourceEvent,
  type LocalWatchSource,
  type LocalWatchTimers,
} from "../src/main/local-library-watch";
import type { LocalWatchedDirectory } from "../src/main/local-library-refresh";

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

function createHarness(options: { rootA?: string; rootB?: string } = {}): Harness {
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
