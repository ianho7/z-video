import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalLibraryRefreshScheduler } from "../src/main/local-library-refresh";
import type { LocalDirectoryScanResult, LocalLibraryRefreshResult, LocalSourceDirectories } from "../src/shared/local-library-contracts";

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
    assert.deepEqual(calls, [{ sourceId, directories: [""] }], "the root rescan already visits the nested directory");
    // The descendant baseline moved with the ancestor scan, so the next check is
    // quiet instead of rescanning the child the root already covered.
    now += 60_000;
    assert.deepEqual(await scheduler.request("focus"), { status: "unchanged" }, "the covered child does not stay dirty");
    assert.deepEqual(calls, [{ sourceId, directories: [""] }], "no second rescan is issued for the covered child");
    scheduler.dispose();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
