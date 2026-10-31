import assert from "node:assert/strict";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import { LocalLibraryDatabase } from "../src/main/local-library-database";

const scaleCounts = [2_000, 20_000] as const;
const filesPerDirectory = 100;

async function createFixture(root: string, count: number): Promise<void> {
  await mkdir(root, { recursive: true });
  const directoryCount = Math.ceil(count / filesPerDirectory);
  for (let directoryIndex = 0; directoryIndex < directoryCount; directoryIndex += 1) {
    const directory = join(root, `batch-${String(directoryIndex).padStart(4, "0")}`);
    await mkdir(directory, { recursive: true });
    const first = directoryIndex * filesPerDirectory;
    const last = Math.min(count, first + filesPerDirectory);
    await Promise.all(Array.from({ length: last - first }, (_, offset) => {
      const fileIndex = first + offset;
      return writeFile(join(directory, `scale-${String(fileIndex).padStart(6, "0")}.mkv`), "owned-scale-fixture");
    }));
  }
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms safety bound`)), timeoutMs)),
  ]);
}

async function run(): Promise<void> {
  const profile = process.env.Z_VIDEO_SCALE_PROFILE ?? join(process.env.TEMP ?? process.cwd(), `z-video-local-scale-${process.pid}`);
  const fixtureRoot = join(profile, "scale-fixtures");
  const userData = join(profile, "user-data");
  await mkdir(profile, { recursive: true });
  app.setPath("userData", userData);
  await app.whenReady();

  const workerPath = join(__dirname, "..", "src", "main", "local-library-worker.js");
  const database = new LocalLibraryDatabase({ dbPath: join(userData, "local-library", "library.sqlite"), workerPath });
  const reports: Array<Record<string, unknown>> = [];
  try {
    const state = await database.start();
    assert.equal(state.status, "ready");
    for (const count of scaleCounts) {
      const root = join(fixtureRoot, `index-${count}`);
      await createFixture(root, count);
      let firstProgressResolve: (() => void) | undefined;
      const firstProgress = new Promise<void>((resolve) => { firstProgressResolve = resolve; });
      const unsubscribe = database.onScanProgress((progress) => {
        if (progress.status === "running" && progress.scannedFiles > 0) firstProgressResolve?.();
      });
      const scanStartedAt = Date.now();
      const scanPromise = database.scanFolder(root);
      await timeout(firstProgress, 15_000, `scale ${count} first progress`);
      const queryStartedAt = Date.now();
      const queryPromise = database.list({ page: 1, pageSize: 1, query: "scale-" });
      const duringScan = await timeout(queryPromise, 5_000, `scale ${count} concurrent list`);
      const queryFinishedAt = Date.now();
      const scan = await timeout(scanPromise, count === 20_000 ? 180_000 : 60_000, `scale ${count} scan`);
      const scanFinishedAt = Date.now();
      unsubscribe();
      assert.equal(scan.status, "completed");
      assert.equal(scan.scannedFiles, count);
      assert.equal(scan.importedFiles, count);
      assert.equal(queryFinishedAt < scanFinishedAt, true);
      assert.equal(duringScan.items.length, 1);
      assert.match(duringScan.items[0]?.mediaId ?? "", /^media_[0-9a-f-]{36}$/i);
      const finalPage = await database.list({ page: 1, pageSize: 1, sourceId: scan.sourceId });
      assert.equal(finalPage.totalCount, count);
      const metrics = app.getAppMetrics().map((metric) => ({
        type: metric.type,
        pid: metric.pid,
        workingSetSize: metric.memory.workingSetSize,
        privateBytes: metric.memory.privateBytes,
      }));
      reports.push({
        count,
        scannedFiles: scan.scannedFiles,
        importedFiles: scan.importedFiles,
        scanElapsedMs: Date.now() - scanStartedAt,
        concurrentListLatencyMs: queryFinishedAt - queryStartedAt,
        concurrentListCompletedBeforeScan: queryFinishedAt < scanFinishedAt,
        indexedCount: finalPage.totalCount,
        metrics,
      });

      if (count === 20_000) {
        const sourceId = scan.sourceId;
        await rm(root, { recursive: true, force: true });
        const unavailable = await database.scanFolder(root);
        assert.equal(unavailable.status, "unavailable");
        const offlinePage = await database.list({ page: 1, pageSize: 1, sourceId });
        assert.equal(offlinePage.totalCount, count);
        assert.equal(offlinePage.items[0]?.available, false);
        reports[reports.length - 1] = { ...reports.at(-1), offlineStatus: unavailable.status, offlineIndexedCount: offlinePage.totalCount, offlineItemUnavailable: offlinePage.items[0]?.available === false };
      } else {
        await rm(root, { recursive: true, force: true });
      }
    }
    const databaseBytes = Number((await stat(join(userData, "local-library", "library.sqlite"))).size);
    process.stdout.write(`SCALE_RESULT: ${JSON.stringify({ counts: scaleCounts, reports, databaseBytes })}\n`);
  } finally {
    await database.close();
    if (app.isReady()) app.quit();
    await rm(profile, { recursive: true, force: true });
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
