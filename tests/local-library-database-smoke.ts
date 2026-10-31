import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";

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
  await writeFile(join(brokenDirectory, "Broken Movie.nfo"), `<unsupported />`);
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

    const reparseRoot = join(profile, "reparse-fixture");
    const reparseMovieDirectory = join(reparseRoot, "Reparse Movie");
    const reparseOutsideDirectory = join(profile, "reparse-outside");
    await mkdir(reparseMovieDirectory, { recursive: true });
    await mkdir(reparseOutsideDirectory, { recursive: true });
    const reparseMovie = join(reparseMovieDirectory, "Reparse Movie.mkv");
    await writeFile(reparseMovie, Buffer.from("reparse indexed media"));
    await writeFile(join(reparseMovieDirectory, "movie.nfo"), "<movie><title>Reparse Movie</title><thumb>poster.jpg</thumb></movie>");
    await writeFile(join(reparseMovieDirectory, "poster.jpg"), Buffer.from("reparse indexed artwork"));
    const outsideMovie = join(reparseOutsideDirectory, "Reparse Movie.mkv");
    const outsideArtwork = join(reparseOutsideDirectory, "poster.jpg");
    await writeFile(outsideMovie, Buffer.from("outside media must never resolve"));
    await writeFile(outsideArtwork, Buffer.from("outside artwork must never resolve"));
    const reparseScan = await database.scanFolder(reparseRoot);
    assert.equal(reparseScan.status, "completed");
    const reparsePage = await database.list({ page: 1, pageSize: 50, query: "Reparse Movie" });
    const reparseItem = reparsePage.items[0];
    assert(reparseItem?.artwork?.length, "reparse fixture artwork was not indexed");
    let reparseProofAvailable = false;
    if (process.platform === "win32") {
      await rm(reparseMovieDirectory, { recursive: true, force: true });
      try {
        await symlink(reparseOutsideDirectory, reparseMovieDirectory, "junction");
        reparseProofAvailable = true;
      } catch {
        reparseProofAvailable = false;
      }
    }
    const reparseEvidencePath = process.env.Z_VIDEO_REPARSE_EVIDENCE_PATH ?? join(process.cwd(), ".scratch", "local-library", "reparse-proof-latest.json");
    await mkdir(dirname(reparseEvidencePath), { recursive: true });
    if (reparseProofAvailable && reparseItem) {
      assert.equal(await database.resolveMediaPath(reparseItem.mediaId), undefined);
      assert.equal(await database.resolveArtwork(reparseItem.mediaId, "poster"), undefined);
      await writeFile(reparseEvidencePath, JSON.stringify({ proof: "real-directory-junction-replacement", mediaResolved: false, artworkResolved: false }));
      process.stderr.write("PASS: real Windows junction replacement stayed outside local playback/artwork resolution\n");
    } else {
      await writeFile(reparseEvidencePath, JSON.stringify({ proof: "skipped", reason: "junction-permission" }));
      process.stderr.write("SKIP: real reparse-point boundary proof requires Windows junction permission\n");
    }
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
    const detail = await database.getDetail(episodeId);
    assert.equal(detail?.collectionTitle, "Example Show");
    assert.equal(detail?.collectionKind, "show");
    assert.equal(detail?.episodes.length, 1);
    assert.equal(detail?.episodes[0]?.mediaId, episodeId);
    const episodeFilter = await database.list({ page: 1, pageSize: 1, filter: "episode", sort: "title" });
    assert.equal(episodeFilter.totalCount, 1);
    assert.equal(episodeFilter.items[0]?.mediaId, episodeId);
    const titlePage = await database.list({ page: 1, pageSize: 1, sort: "title" });
    assert.equal(titlePage.pageSize, 1);
    assert.equal(titlePage.items.length, 1);
    assert.equal(titlePage.totalCount >= 3, true);
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
    const continueWatching = await database.listContinueWatching();
    assert.equal(continueWatching.some((entry) => entry.item.mediaId === episodeId && entry.playback.positionSec === 42), true);

    const sourceCountBeforeNestedImport = (await database.getState()).sources.length;
    const nestedImport = await database.importVideo(episodePath, showDirectory);
    assert.equal(nestedImport.status, "imported");
    if (nestedImport.status !== "imported") throw new Error("nested file import was not accepted");
    assert.equal(nestedImport.item.sourceId, scanned.items[0]?.sourceId);
    assert.equal((await database.getState()).sources.length, sourceCountBeforeNestedImport);

    const overlapContainer = join(profile, "overlap-container");
    const overlapSource = join(overlapContainer, "indexed");
    await mkdir(overlapSource, { recursive: true });
    await writeFile(join(overlapSource, "indexed.mkv"), Buffer.from("overlap source fixture"));
    await database.scanFolder(overlapSource);
    const siblingVideo = join(overlapContainer, "sibling.mkv");
    await writeFile(siblingVideo, Buffer.from("sibling fixture"));
    await assert.rejects(
      () => database.importVideo(siblingVideo, overlapContainer),
      (error: unknown) => error instanceof Error && error.message === "新的片库目录与已有来源重叠" && !error.message.includes(overlapContainer),
    );

    const disconnectRoot = join(profile, "disconnect-fixture");
    const disconnectNested = join(disconnectRoot, "z-nested");
    await mkdir(disconnectNested, { recursive: true });
    await writeFile(join(disconnectRoot, "00-first.mkv"), Buffer.from("disconnect first"));
    await writeFile(join(disconnectNested, "01-second.mkv"), Buffer.from("disconnect second"));
    let disconnected = false;
    const unsubscribeDisconnect = database.onScanProgress((progress) => {
      if (!disconnected && progress.status === "running" && progress.scannedFiles === 1) {
        disconnected = true;
        rmSync(disconnectNested, { recursive: true, force: true });
      }
    });
    const partialDisconnect = await database.scanFolder(disconnectRoot);
    unsubscribeDisconnect();
    assert.equal(partialDisconnect.status, "partial");
    assert.equal((await database.getState()).sources.find((source) => source.sourceId === partialDisconnect.sourceId)?.available, false);

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

    const removedState = await database.removeSource(imported.item.sourceId);
    assert.equal(removedState.sources.some((source) => source.sourceId === imported.item.sourceId), false);
    assert.equal((await database.list({ page: 1, pageSize: 50, query: "Owned Movie 2026" })).totalCount, 0);
    assert.equal((await stat(moviePath)).isFile(), true);

    await database.close();
    const reopened = new LocalLibraryDatabase({ dbPath, workerPath });
    const reopenedState = await reopened.start();
    assert.equal(reopenedState.status, "ready");
    const reopenedPage = await reopened.list({ page: 1, pageSize: 50 });
    assert.equal(reopenedPage.items.some((item) => item.mediaId === imported.item.mediaId), false);
    await reopened.close();
    process.stdout.write("PASS: local DB owner imported one fixture, reused stable opaque mediaId, listed without paths, and resolved only in main owner\n");
  } finally {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

void run().then(
  () => app.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  },
);
