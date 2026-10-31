import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import { isOpaqueMediaId } from "../src/shared/local-library-contracts";
import { LocalLibraryDatabase } from "../src/main/local-library-database";

async function run(): Promise<void> {
  const profile = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "z-video-local-db-smoke-"));
  const fixtureRoot = join(profile, "owned-fixture");
  await mkdir(fixtureRoot, { recursive: true });
  const moviePath = join(fixtureRoot, "Owned Movie 2026.mkv");
  await writeFile(moviePath, Buffer.from("owned local fixture; not a playable sample"));
  const metadataRoot = join(profile, "metadata");
  const cancelledRoot = join(profile, "cancelled-fixture");
  const movieDirectory = join(metadataRoot, "Metadata Movie");
  const showDirectory = join(metadataRoot, "Example Show");
  const brokenDirectory = join(metadataRoot, "Broken Movie");
  await mkdir(movieDirectory, { recursive: true });
  await mkdir(showDirectory, { recursive: true });
  await mkdir(brokenDirectory, { recursive: true });
  await mkdir(cancelledRoot, { recursive: true });
  const metadataMoviePath = join(movieDirectory, "Metadata Movie.mkv");
  const episodePath = join(showDirectory, "Example Show - S01E02.mkv");
  const brokenMoviePath = join(brokenDirectory, "Broken Movie.mkv");
  await writeFile(metadataMoviePath, Buffer.from("metadata movie fixture"));
  await writeFile(episodePath, Buffer.from("episode fixture"));
  await writeFile(brokenMoviePath, Buffer.from("broken nfo fixture"));
  await writeFile(join(movieDirectory, "Metadata Movie.nfo"), `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Metadata Movie Title</title>
  <year>2026</year>
  <plot>A local-only plot.</plot>
  <genre>Drama</genre>
  <genre>Indie</genre>
  <rating>8.4</rating>
  <thumb aspect="poster">poster.jpg</thumb>
</movie>`);
  await writeFile(join(movieDirectory, "poster.jpg"), Buffer.from("poster bytes"));
  await writeFile(join(showDirectory, "tvshow.nfo"), `<tvshow>
  <title>Example Show</title>
  <year>2025</year>
  <plot>Show plot.</plot>
  <genre>Drama</genre>
  <fanart><thumb>fanart.webp</thumb></fanart>
</tvshow>`);
  await writeFile(join(showDirectory, "fanart.webp"), Buffer.from("fanart bytes"));
  await writeFile(join(showDirectory, "Example Show - S01E02.nfo"), `<episodedetails>
  <title>Second Episode</title>
  <season>1</season>
  <episode>2</episode>
</episodedetails>`);
  await writeFile(join(brokenDirectory, "Broken Movie.nfo"), `<movie><title>broken`);
  for (let index = 0; index < 40; index += 1) await writeFile(join(cancelledRoot, `cancel-${index}.mkv`), Buffer.from(`cancel ${index}`));

  try {
    app.setPath("userData", join(profile, "user-data"));
    await app.whenReady();
    const dbPath = join(profile, "user-data", "local-library", "library.sqlite");
    const workerPath = join(__dirname, "..", "src", "main", "local-library-worker.js");
    const database = new LocalLibraryDatabase({
      dbPath,
      workerPath,
    });
    const state = await database.start();
    assert.equal(state.status, "ready");
    assert.equal(state.sqliteAvailable, true);
    assert.equal(state.schemaVersion, 1);

    const imported = await database.importFirstMovieInFolder(fixtureRoot);
    assert.equal(imported.status, "imported");
    if (imported.status !== "imported") throw new Error("owned fixture was not imported");
    assert.equal(imported.item.title, "Owned Movie 2026");
    assert.equal(isOpaqueMediaId(imported.item.mediaId), true);
    assert.equal(JSON.stringify(imported.item).includes(fixtureRoot), false);

    const repeated = await database.importVideo(moviePath, fixtureRoot);
    assert.equal(repeated.status, "imported");
    if (repeated.status !== "imported") throw new Error("repeat import was not accepted");
    assert.equal(repeated.item.mediaId, imported.item.mediaId);

    const page = await database.list({ page: 1, pageSize: 50 });
    assert.equal(page.totalCount, 1);
    assert.equal(page.items.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(page.items[0], "path"), false);
    assert.equal(await database.resolveMediaPath(imported.item.mediaId), moviePath);

    const scan = await database.scanFolder(metadataRoot);
    assert.equal(scan.status, "completed");
    assert.equal(scan.scannedFiles, 3);
    assert.equal(scan.importedFiles, 3);
    assert.equal(scan.updatedFiles, 0);
    assert.equal(scan.warningCount, 1);
    const scanned = await database.list({ page: 1, pageSize: 50, query: "Metadata Movie Title" });
    assert.equal(scanned.totalCount, 1);
    assert.equal(scanned.items[0]?.title, "Metadata Movie Title");
    assert.equal(scanned.items[0]?.year, 2026);
    assert.deepEqual(scanned.items[0]?.genres, ["Drama", "Indie"]);
    assert.equal(scanned.items[0]?.rating, 8.4);
    assert.equal(scanned.items[0]?.artwork?.[0]?.kind, "poster");
    assert.equal(JSON.stringify(scanned.items[0]).includes(movieDirectory), false);
    const episodePage = await database.list({ page: 1, pageSize: 50, query: "Second Episode" });
    assert.equal(episodePage.totalCount, 1);
    assert.equal(episodePage.items[0]?.kind, "episode");
    assert.equal(episodePage.items[0]?.seasonNumber, 1);
    assert.equal(episodePage.items[0]?.episodeNumber, 2);
    assert.equal(episodePage.items[0]?.title, "Second Episode");

    const metadataMediaId = scanned.items[0]?.mediaId;
    await writeFile(join(movieDirectory, "Metadata Movie.nfo"), `<movie><title>Metadata Movie Updated</title><year>2026</year><plot>Updated plot.</plot><genre>Drama</genre><rating>8.7</rating><thumb aspect="poster">poster.jpg</thumb></movie>`);
    const repeatedScan = await database.scanFolder(metadataRoot);
    assert.equal(repeatedScan.status, "completed");
    assert.equal(repeatedScan.importedFiles, 0);
    assert.equal(repeatedScan.updatedFiles, 3);
    const updated = await database.list({ page: 1, pageSize: 50, query: "Metadata Movie Updated" });
    assert.equal(updated.items[0]?.mediaId, metadataMediaId);
    assert.equal(updated.items[0]?.rating, 8.7);

    const episodeId = episodePage.items[0]?.mediaId;
    if (!episodeId) throw new Error("episode fixture did not produce a mediaId");
    const savedPlayback = await database.savePlayback({
      mediaId: episodeId,
      positionSec: 42,
      durationSec: 180,
      audioTrackId: "audio-1",
      subtitleTrackId: null,
      watched: false,
      updatedAtMs: Date.now(),
    });
    assert.equal(savedPlayback.positionSec, 42);
    assert.equal((await database.getPlayback(episodeId))?.audioTrackId, "audio-1");

    await rm(metadataRoot, { recursive: true, force: true });
    const unavailable = await database.scanFolder(metadataRoot);
    assert.equal(unavailable.status, "unavailable");
    assert.equal((await database.get(episodeId))?.available, false);
    assert.equal((await database.getPlayback(episodeId))?.positionSec, 42);

    const unsubscribeScan = database.onScanProgress((progress) => {
      if (progress.status === "running" && progress.scannedFiles === 1) void database.cancelScan(progress.scanId);
    });
    const cancelledScan = await database.scanFolder(cancelledRoot);
    unsubscribeScan();
    assert.equal(cancelledScan.status, "cancelled");
    assert.equal(cancelledScan.scannedFiles < 40, true);

    const cancelled = await database.cancelScan(scan.scanId);
    assert.equal(cancelled, false);

    await database.close();
    const reopened = new LocalLibraryDatabase({ dbPath, workerPath });
    const reopenedState = await reopened.start();
    assert.equal(reopenedState.status, "ready");
    const reopenedPage = await reopened.list({ page: 1, pageSize: 50 });
    assert.equal(reopenedPage.items[0]?.mediaId, imported.item.mediaId);
    await reopened.close();
    process.stdout.write("PASS: local DB owner imported one fixture, reused stable opaque mediaId, listed without paths, and resolved only in main owner\n");
  } finally {
    if (app.isReady()) app.quit();
    await rm(profile, { recursive: true, force: true });
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
