import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalLibraryRefreshScheduler } from "../src/main/local-library-refresh";
import type { LocalDirectoryScanResult, LocalLibraryRefreshResult, LocalSourceDirectories } from "../src/shared/local-library-contracts";
// Registered from here so `npm test` runs the Ticket 24a watcher seam too; the
// runner's module list is not part of this ticket's boundary.
import "./local-library-watch.test";

interface ScanCall {
  sourceId: string;
  directories: string[];
}

function scanResult(sourceId: string, directories: readonly string[]): LocalDirectoryScanResult {
  return {
    scanId: "scan_123e4567-e89b-42d3-a456-426614174000",
    sourceId,
    status: "completed",
    scannedFiles: directories.length,
    importedFiles: 0,
    updatedFiles: directories.length,
    warningCount: 0,
    warnings: [],
    counts: { imported: 0, updated: directories.length, unchanged: 0, removed: 0 },
    nfoUpdatedFiles: directories.length,
    fingerprintReplacedFiles: 0,
  };
}

async function createFixture(): Promise<{ profile: string; root: string }> {
  const profile = await mkdtemp(join(tmpdir(), "z-video-refresh-unit-"));
  const root = join(profile, "library");
  await mkdir(join(root, "A-dir", "nested"), { recursive: true });
  await mkdir(join(root, "B-dir"), { recursive: true });
  await writeFile(join(root, "direct.nfo"), "<movie><title>Direct</title></movie>");
  await writeFile(join(root, "A-dir", "a.nfo"), "<movie><title>A</title></movie>");
  await writeFile(join(root, "B-dir", "b.nfo"), "<movie><title>B</title></movie>");
  return { profile, root };
}

function createPort(root: string, inventory: LocalSourceDirectories[], calls: ScanCall[], sourceId = "source_123e4567-e89b-42d3-a456-426614174000") {
  return {
    listScanDirectories: async () => inventory,
    sourceRoot: async (candidate: string) => candidate === sourceId ? root : undefined,
    scanDirectories: async (candidate: string, directories: readonly string[]) => {
      calls.push({ sourceId: candidate, directories: [...directories] });
      return scanResult(candidate, directories);
    },
  };
}

test("an unchanged directory inventory never scans and never reports a result", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    const results: LocalLibraryRefreshResult[] = [];
    let now = 1_000;
    const scheduler = new LocalLibraryRefreshScheduler(
      createPort(root, [{ sourceId: "source_123e4567-e89b-42d3-a456-426614174000", relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls),
      join(profile, "baseline.json"),
      { now: () => now, onResult: (result) => results.push(result) },
    );
    const first = await scheduler.request("focus");
    assert.deepEqual(first, { status: "unchanged" }, "the first observation only records the baseline");
    now += 10_000;
    const second = await scheduler.request("focus");
    assert.deepEqual(second, { status: "unchanged" }, "an unchanged inventory is reported as unchanged");
    assert.deepEqual(calls, [], "the owner is never asked to scan when no directory changed");
    assert.deepEqual(results, [], "an unchanged check pushes no observable result");
    scheduler.dispose();
    const baseline = JSON.parse(await readFile(join(profile, "baseline.json"), "utf8")) as { sources: Record<string, { directories: Record<string, unknown> }> };
    assert.deepEqual(Object.keys(baseline.sources["source_123e4567-e89b-42d3-a456-426614174000"]?.directories ?? {}).sort(), ["", "A-dir", "A-dir/nested", "B-dir"]);
    assert.equal(JSON.stringify(baseline).includes(profile), false, "the baseline sidecar stores no absolute path");
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("an NFO edit marks only its own directory dirty and hands just that directory to the rescan", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    const results: LocalLibraryRefreshResult[] = [];
    let now = 1_000;
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    const scheduler = new LocalLibraryRefreshScheduler(
      createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls),
      join(profile, "baseline.json"),
      { now: () => now, onResult: (result) => results.push(result) },
    );
    await scheduler.request("focus");
    const nfoPath = join(root, "A-dir", "a.nfo");
    await writeFile(nfoPath, "<movie><title>A edited</title></movie>");
    const future = new Date(Date.now() + 5_000);
    await utimes(nfoPath, future, future);
    now += 60_000;
    const outcome = await scheduler.request("focus");
    assert.deepEqual(outcome, { status: "refreshed" });
    assert.deepEqual(calls, [{ sourceId, directories: ["A-dir"] }], "only the changed directory is rescanned");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.trigger, "focus");
    assert.equal(results[0]?.scannedDirectories, 1);
    assert.deepEqual(results[0]?.counts, { imported: 0, updated: 1, unchanged: 0, removed: 0 });
    assert.equal(results[0]?.nfoUpdatedFiles, 1, "the NFO-only change stays separable from a video replacement");
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("a check inside the throttle window is dropped instead of rescanning", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    let now = 1_000;
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    const scheduler = new LocalLibraryRefreshScheduler(
      createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls),
      join(profile, "baseline.json"),
      { now: () => now, throttleMs: 5_000 },
    );
    await scheduler.request("focus");
    await writeFile(join(root, "A-dir", "a.nfo"), "<movie><title>A edited</title></movie>");
    now += 1_000;
    assert.deepEqual(await scheduler.request("focus"), { status: "throttled" }, "a quick refocus is throttled");
    assert.deepEqual(calls, [], "a throttled check reads no directory and starts no scan");
    now += 5_000;
    assert.deepEqual(await scheduler.request("focus"), { status: "refreshed" }, "the next check after the throttle window still detects the edit");
    assert.deepEqual(calls, [{ sourceId, directories: ["A-dir"] }]);
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("a check requested while a manual scan runs is queued and flushed when the scan finishes", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    const results: LocalLibraryRefreshResult[] = [];
    let now = 1_000;
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    const scheduler = new LocalLibraryRefreshScheduler(
      createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls),
      join(profile, "baseline.json"),
      { now: () => now, onResult: (result) => results.push(result) },
    );
    await scheduler.request("focus");
    await writeFile(join(root, "B-dir", "b.nfo"), "<movie><title>B edited</title></movie>");
    let releaseManual: (() => void) | undefined;
    const manual = scheduler.runScan(() => new Promise<void>((resolve) => { releaseManual = resolve; }));
    const queued = await scheduler.request("focus");
    assert.deepEqual(queued, { status: "queued" }, "the automatic check never overlaps the manual scan");
    assert.deepEqual(calls, [], "the dirty directory waits instead of racing the manual scan");
    assert.ok(releaseManual);
    releaseManual();
    await manual;
    const deadline = Date.now() + 2_000;
    while (results.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(calls, [{ sourceId, directories: ["B-dir"] }], "the queued dirty directory is rescanned after the manual scan");
    assert.equal(results.length, 1);
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("a dirty ancestor swallows its dirty children in one rescan", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    let now = 1_000;
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    const scheduler = new LocalLibraryRefreshScheduler(
      createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls),
      join(profile, "baseline.json"),
      { now: () => now },
    );
    await scheduler.request("focus");
    await writeFile(join(root, "direct.nfo"), "<movie><title>Direct edited</title></movie>");
    await writeFile(join(root, "A-dir", "nested", "nested.nfo"), "<movie><title>Nested</title></movie>");
    now += 60_000;
    assert.deepEqual(await scheduler.request("focus"), { status: "refreshed" });
    assert.deepEqual(calls, [{ sourceId, directories: ["."] }], "the root rescan already visits the nested directory (the owner's root scope is spelled '.')");
    // The descendant baseline moved with the ancestor scan, so the next check is
    // quiet instead of rescanning the child the root already covered.
    now += 60_000;
    assert.deepEqual(await scheduler.request("focus"), { status: "unchanged" }, "the covered child does not stay dirty");
    assert.deepEqual(calls, [{ sourceId, directories: ["."] }], "no second rescan is issued for the covered child");
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("a watched dirty directory is rescanned through the shared gate and leaves the baseline current", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    const results: LocalLibraryRefreshResult[] = [];
    let now = 1_000;
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    const scheduler = new LocalLibraryRefreshScheduler(
      createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls),
      join(profile, "baseline.json"),
      { now: () => now, onResult: (result) => results.push(result) },
    );
    await scheduler.request("focus");
    await writeFile(join(root, "A-dir", "a.nfo"), "<movie><title>A watched</title></movie>");
    const outcome = await scheduler.requestWatch([{ sourceId, relativeDirectory: "A-dir" }]);
    assert.deepEqual(outcome, { status: "refreshed" });
    assert.deepEqual(calls, [{ sourceId, directories: ["A-dir"] }], "only the watched directory is handed to the owner");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.trigger, "watch", "the watcher is its own cause; the renderer only reads counts");
    assert.deepEqual(results[0]?.counts, { imported: 0, updated: 1, unchanged: 0, removed: 0 });
    // The watch scan records the signatures it saw, so the next focus check is
    // quiet instead of rescanning the same directory.
    now += 60_000;
    assert.deepEqual(await scheduler.request("focus"), { status: "unchanged" });
    assert.equal(calls.length, 1, "the watch scan leaves no stale baseline behind");
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("a watch flush during a manual scan is queued and then flushed, never dropped", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    const results: LocalLibraryRefreshResult[] = [];
    let now = 1_000;
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    const scheduler = new LocalLibraryRefreshScheduler(
      createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls),
      join(profile, "baseline.json"),
      { now: () => now, onResult: (result) => results.push(result) },
    );
    await scheduler.request("focus");
    await writeFile(join(root, "B-dir", "b.nfo"), "<movie><title>B watched</title></movie>");
    let releaseManual: (() => void) | undefined;
    const manual = scheduler.runScan(() => new Promise<void>((resolve) => { releaseManual = resolve; }));
    const queued = await scheduler.requestWatch([{ sourceId, relativeDirectory: "B-dir" }]);
    assert.deepEqual(queued, { status: "queued" }, "the watch scan never overlaps the manual scan");
    assert.deepEqual(calls, [], "the dirty directory waits instead of racing the manual scan");
    assert.ok(releaseManual);
    releaseManual();
    await manual;
    const deadline = Date.now() + 2_000;
    while (results.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(calls, [{ sourceId, directories: ["B-dir"] }], "the queued watch directory is rescanned after the manual scan");
    assert.equal(results[0]?.trigger, "watch");
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("a watched directory that vanished falls back to its nearest existing ancestor", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    const scheduler = new LocalLibraryRefreshScheduler(
      createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls),
      join(profile, "baseline.json"),
      { now: () => 1_000 },
    );
    await scheduler.request("focus");
    // The watcher reports the directory that contained the change; a delete or a
    // rename can leave a path that no longer exists. The scan must still run.
    assert.deepEqual(await scheduler.requestWatch([{ sourceId, relativeDirectory: "A-dir/gone" }]), { status: "refreshed" });
    assert.deepEqual(calls, [{ sourceId, directories: ["A-dir"] }], "the nearest existing ancestor is rescanned instead of failing");
    const before = calls.length;
    assert.deepEqual(await scheduler.requestWatch([{ sourceId, relativeDirectory: "../escape" }]), { status: "unchanged" }, "an out-of-source scope is rejected, never clamped");
    assert.deepEqual(await scheduler.requestWatch([{ sourceId, relativeDirectory: "/absolute" }]), { status: "unchanged" });
    assert.equal(calls.length, before, "a rejected scope starts no scan");
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("two watch flushes never overlap: the second one queues while the first is still resolving", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    let inventoryCalls = 0;
    let releaseInventory: (() => void) | undefined;
    const port = createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls);
    const scheduler = new LocalLibraryRefreshScheduler(
      {
        ...port,
        listScanDirectories: async () => {
          inventoryCalls += 1;
          // The second call is the first watch check; hold it so a second flush
          // arrives while that check is mid-flight.
          if (inventoryCalls === 2) await new Promise<void>((resolve) => { releaseInventory = resolve; });
          return port.listScanDirectories();
        },
      },
      join(profile, "baseline.json"),
      { now: () => 1_000 },
    );
    await scheduler.request("focus");
    await writeFile(join(root, "B-dir", "b.nfo"), "<movie><title>B watched</title></movie>");
    const first = scheduler.requestWatch([{ sourceId, relativeDirectory: "B-dir" }]);
    const deadline = Date.now() + 2_000;
    while (releaseInventory === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(releaseInventory, "the first watch check is in flight");
    assert.deepEqual(await scheduler.requestWatch([{ sourceId, relativeDirectory: "B-dir" }]), { status: "queued" }, "a second flush waits instead of starting a second check");
    assert.deepEqual(calls, [], "no scan starts while the first check is still resolving");
    releaseInventory();
    assert.deepEqual(await first, { status: "refreshed" });
    assert.deepEqual(calls[0], { sourceId, directories: ["B-dir"] }, "the first check scanned the dirty directory");
    scheduler.dispose();
  } finally {
    // The queued flush drains right after the first check, so its baseline write
    // can still be settling while this cleanup runs on Windows.
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("a watch-triggered root rescan is automatic and addressed as the owner's root scope", async () => {
  const { profile, root } = await createFixture();
  try {
    const calls: ScanCall[] = [];
    const sourceId = "source_123e4567-e89b-42d3-a456-426614174000";
    let automaticDuringScan: boolean | undefined;
    let scheduler: LocalLibraryRefreshScheduler | undefined;
    const port = createPort(root, [{ sourceId, relativeDirectories: ["", "A-dir", "A-dir/nested", "B-dir"] }], calls);
    scheduler = new LocalLibraryRefreshScheduler(
      {
        ...port,
        scanDirectories: async (candidate: string, directories: readonly string[]) => {
          automaticDuringScan = scheduler?.isAutomaticScanActive();
          calls.push({ sourceId: candidate, directories: [...directories] });
          return scanResult(candidate, directories);
        },
      },
      join(profile, "baseline.json"),
      { now: () => 1_000 },
    );
    await scheduler.request("focus");
    const outcome = await scheduler.requestWatch([{ sourceId, relativeDirectory: "" }]);
    assert.deepEqual(outcome, { status: "refreshed" });
    assert.deepEqual(calls, [{ sourceId, directories: ["."] }], "the source root is requested as '.', the spelling the owner accepts");
    assert.equal(automaticDuringScan, true, "a watch rescan is silent: it must not forward scan progress");
    assert.equal(scheduler.isAutomaticScanActive(), false, "the silent flag is released after the scan");
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
