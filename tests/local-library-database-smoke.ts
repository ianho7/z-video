import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "electron";

import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import { LOCAL_LIBRARY_SCHEMA_VERSION, isOpaqueMediaId, type LocalLibraryRefreshResult } from "../src/shared/local-library-contracts";
import { CLEANUP_PRESETS, DAY_MS, GIB, defaultCleanupSettings } from "../src/shared/cleanup-contracts";
import { LocalLibraryDatabase } from "../src/main/local-library-database";
import { LocalLibraryRefreshScheduler, type LocalRefreshDatabasePort } from "../src/main/local-library-refresh";

function openSqlite(filePath: string): DatabaseSyncType {
  const sqlite = require("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseSyncType };
  if (typeof sqlite.DatabaseSync !== "function") throw new Error("node:sqlite is unavailable");
  return new sqlite.DatabaseSync(filePath);
}

/** Fail the step instead of letting a wedged call hide a hang. */
function withDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
    timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

interface RecordedSessionSeed {
  startedAtMs: number;
  playedSec: number;
  wallSec: number;
  endPositionSec: number;
  durationSec?: number;
  completed: boolean;
  closeReason: "ended" | "user-close" | "error" | "app-quit" | "interrupted";
}

async function recordViewingSession(database: LocalLibraryDatabase, mediaId: `media_${string}`, seed: RecordedSessionSeed): Promise<void> {
  const { sessionId } = await database.startViewingSession({ mediaId, startedAtMs: seed.startedAtMs, startPositionSec: 0 });
  const heartbeat = {
    sessionId,
    playedSec: seed.playedSec,
    wallSec: seed.wallSec,
    endPositionSec: seed.endPositionSec,
    ...(seed.durationSec === undefined ? {} : { durationSec: seed.durationSec }),
    pauseCount: 1,
    seekCount: 2,
    speed: 1,
    heartbeatAtMs: seed.startedAtMs + seed.wallSec * 1000,
  };
  await database.heartbeatViewingSession(heartbeat);
  await database.finishViewingSession({
    ...heartbeat,
    mediaId,
    endedAtMs: heartbeat.heartbeatAtMs,
    completed: seed.completed,
    closeReason: seed.closeReason,
  });
}

interface CleanupSeed {
  mediaId: string;
  sizeBytes: number;
  addedAtMs: number;
  history?: {
    openCount: number;
    effectiveWatchCount: number;
    completedCount: number;
    totalPlayedSec: number;
    lastOpenedAtMs: number;
  };
}

/**
 * Test-only fixture shaping: there is no facade call to fake 45-day-old
 * protection windows or multi-GB files, so the smoke writes the input facts
 * directly. Every assertion after this still goes through the public facade.
 */
function seedCleanupFacts(dbPath: string, nowMs: number, seeds: CleanupSeed[]): void {
  const sqlite = openSqlite(dbPath);
  try {
    for (const seed of seeds) {
      sqlite.prepare("UPDATE media_files SET size_bytes = ?, added_at = ? WHERE media_id = ?").run(seed.sizeBytes, seed.addedAtMs, seed.mediaId);
      if (!seed.history) continue;
      sqlite.prepare(`
        INSERT OR REPLACE INTO media_history (
          media_id, open_count, effective_watch_count, completed_count, inspection_open_count, total_played_sec,
          first_seen_at, last_opened_at, last_played_at, last_session_played_sec, last_session_wall_sec,
          last_position_sec, last_duration_sec, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 0, 0, NULL, ?)
      `).run(
        seed.mediaId,
        seed.history.openCount,
        seed.history.effectiveWatchCount,
        seed.history.completedCount,
        seed.history.totalPlayedSec,
        seed.addedAtMs,
        seed.history.lastOpenedAtMs,
        seed.history.lastOpenedAtMs,
        nowMs,
      );
    }
  } finally {
    sqlite.close();
  }
}

async function run(): Promise<void> {
  const profile = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "z-video-local-db-smoke-"));
  const fixtureRoot = join(profile, "owned-fixture");
  await mkdir(fixtureRoot, { recursive: true });
  const moviePath = join(fixtureRoot, "Owned Movie 2026.mkv");
  await writeFile(moviePath, Buffer.from("owned local fixture; not a playable sample"));
  const rootScanRoot = join(profile, "root-scan-fixture");
  await mkdir(rootScanRoot, { recursive: true });
  const rootScanMoviePath = join(rootScanRoot, "Root Scan Movie.mkv");
  await writeFile(rootScanMoviePath, Buffer.from("root scan fixture"));
  await writeFile(join(rootScanRoot, "Root Scan Movie.nfo"), `<movie>
  <title>Root Scan Movie Title</title>
  <year>2026</year>
  <rating>8.7</rating>
</movie>`);
  const metadataRoot = join(profile, "metadata");
  const cancelledRoot = join(profile, "cancelled-fixture");
  const movieDirectory = join(metadataRoot, "Metadata Movie");
  const showDirectory = join(metadataRoot, "Example Show");
  const brokenDirectory = join(metadataRoot, "Broken Movie");
  await mkdir(movieDirectory, { recursive: true });
  await mkdir(showDirectory, { recursive: true });
  await mkdir(brokenDirectory, { recursive: true });
  await mkdir(cancelledRoot, { recursive: true });
  const collectionRoot = join(profile, "collection-fixture");
  const aggregateShowDirectory = join(collectionRoot, "Aggregate Show");
  await mkdir(aggregateShowDirectory, { recursive: true });
  await writeFile(join(aggregateShowDirectory, "tvshow.nfo"), `<tvshow>
  <title>Aggregate Show</title>
  <year>2020</year>
  <premiered>2020-05-01</premiered>
</tvshow>`);
  for (const number of [1, 2, 3]) {
    const stem = `Aggregate Show - S01E0${number}`;
    await writeFile(join(aggregateShowDirectory, `${stem}.mkv`), Buffer.from(`aggregate episode ${number}`));
    await writeFile(join(aggregateShowDirectory, `${stem}.nfo`), `<episodedetails><title>Aggregate Episode ${number}</title><season>1</season><episode>${number}</episode></episodedetails>`);
  }
  await writeFile(join(collectionRoot, "Aggregate Film.mkv"), Buffer.from("aggregate film fixture"));
  await writeFile(join(collectionRoot, "Aggregate Film.nfo"), `<movie><title>Aggregate Film</title><year>2019</year></movie>`);
  await writeFile(join(collectionRoot, "Second Film.mkv"), Buffer.from("second film fixture"));
  await writeFile(join(collectionRoot, "Second Film.nfo"), `<movie><title>Second Film</title><year>2018</year></movie>`);
  const continueRoot = join(profile, "continue-fixture");
  const continueShowDirectory = join(continueRoot, "Continue Show");
  await mkdir(continueShowDirectory, { recursive: true });
  await writeFile(join(continueShowDirectory, "tvshow.nfo"), `<tvshow><title>Continue Show</title><year>2024</year></tvshow>`);
  for (const number of [1, 2]) {
    const stem = `Continue Show - S01E0${number}`;
    await writeFile(join(continueShowDirectory, `${stem}.mkv`), Buffer.from(`continue episode ${number}`));
    await writeFile(join(continueShowDirectory, `${stem}.nfo`), `<episodedetails><title>Continue Episode ${number}</title><season>1</season><episode>${number}</episode></episodedetails>`);
  }
  await writeFile(join(continueRoot, "Continue Movie.mkv"), Buffer.from("continue movie fixture"));
  await writeFile(join(continueRoot, "Continue Movie.nfo"), `<movie><title>Continue Movie</title></movie>`);
  await writeFile(join(continueRoot, "Continue Short Movie.mkv"), Buffer.from("continue short movie fixture"));
  await writeFile(join(continueRoot, "Continue Short Movie.nfo"), `<movie><title>Continue Short Movie</title></movie>`);
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
  <premiered>2026-10-05</premiered>
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
    assert.equal(state.schemaVersion, 5);

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

    const ownedMediaId = imported.item.mediaId;
    await recordViewingSession(database, ownedMediaId, {
      startedAtMs: 1_000,
      playedSec: 400,
      wallSec: 500,
      endPositionSec: 1_200,
      durationSec: 1_200,
      completed: true,
      closeReason: "ended",
    });
    await recordViewingSession(database, ownedMediaId, {
      startedAtMs: 2_000,
      playedSec: 5,
      wallSec: 8,
      endPositionSec: 5,
      durationSec: 1_200,
      completed: false,
      closeReason: "user-close",
    });
    await recordViewingSession(database, ownedMediaId, {
      startedAtMs: 3_000,
      playedSec: 60,
      wallSec: 70,
      endPositionSec: 60,
      durationSec: 1_200,
      completed: false,
      closeReason: "user-close",
    });
    const viewing = await database.getViewingHistory(ownedMediaId);
    assert.ok(viewing, "finished sessions produce a viewing aggregate");
    assert.equal(viewing.openCount, 3, "every session counts as one open");
    assert.equal(viewing.effectiveWatchCount, 2, "400s and 60s are effective; 5s is an inspection open");
    assert.equal(viewing.completedCount, 1, "only the ended session completes");
    assert.equal(viewing.inspectionOpenCount, 1);
    assert.equal(viewing.totalPlayedSec, 465);
    assert.equal(viewing.lastOpenedAtMs, 3_000, "the newest session owns the last-open time");
    assert.equal(viewing.lastSessionPlayedSec, 60);
    assert.equal(viewing.lastSessionWallSec, 70);
    assert.equal(viewing.lastPositionSec, 60);
    assert.equal(viewing.lastDurationSec, 1_200);
    assert.equal(JSON.stringify(viewing).includes(fixtureRoot), false, "viewing history never exposes the source root");
    for (const key of Object.keys(viewing)) assert.doesNotMatch(key, /path|root|relative|title|file/i, `viewing history must not expose ${key}`);
    const viewingDetail = await database.getDetail(ownedMediaId);
    assert.deepEqual(viewingDetail?.viewing, viewing, "detail carries the same renderer-safe aggregate");
    assert.equal(JSON.stringify(viewingDetail).includes(moviePath), false, "detail never leaks the media path through the viewing block");

    const rootScan = await database.scanFolder(rootScanRoot);
    assert.equal(rootScan.status, "completed");
    assert.equal(rootScan.scannedFiles, 1);
    assert.equal(rootScan.importedFiles, 1);
    assert.equal(rootScan.updatedFiles, 0);
    assert.equal(rootScan.warningCount, 0);
    assert.deepEqual(rootScan.warnings, []);
    const rootScanned = await database.list({ page: 1, pageSize: 50, query: "Root Scan Movie Title" });
    assert.equal(rootScanned.totalCount, 1);
    assert.equal(rootScanned.items[0]?.title, "Root Scan Movie Title");
    assert.equal(rootScanned.items[0]?.year, 2026);
    await database.removeSource(rootScan.sourceId);

    const scan = await database.scanFolder(metadataRoot);
    assert.equal(scan.status, "completed");
    assert.equal(scan.scannedFiles, 3);
    assert.equal(scan.importedFiles, 3);
    assert.equal(scan.updatedFiles, 0);
    assert.equal(scan.warningCount, 1);
    const completeSource = (await database.getState()).sources.find((source) => source.sourceId === scan.sourceId);
    assert.equal(completeSource?.available, true);
    assert.equal(completeSource?.degraded, false, "a complete traversal clears the degraded flag");
    const scanned = await database.list({ page: 1, pageSize: 50, query: "Metadata Movie Title" });
    assert.equal(scanned.totalCount, 1);
    assert.equal(scanned.items[0]?.title, "Metadata Movie Title");
    assert.equal(scanned.items[0]?.year, 2026);
    assert.deepEqual(scanned.items[0]?.genres, ["Drama", "Indie"]);
    assert.equal(scanned.items[0]?.rating, 8.4);
    assert.equal(scanned.items[0]?.artwork?.[0]?.kind, "poster");
    assert.equal(scanned.items[0]?.premieredDate, "2026-10-05");
    assert.equal(JSON.stringify(scanned.items[0]).includes(movieDirectory), false);

    const collectionScan = await database.scanFolder(collectionRoot);
    assert.equal(collectionScan.status, "completed");
    assert.equal(collectionScan.importedFiles, 5);
    const aggregateFiles = await database.list({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId });
    assert.equal(aggregateFiles.totalCount, 5, "the file-level list still counts every media file");
    const aggregateEpisodes = await database.list({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId, filter: "episode" });
    assert.equal(aggregateEpisodes.totalCount, 3);
    const episodeByTitle = new Map(aggregateEpisodes.items.map((item) => [item.title, item]));
    const aggregateEpisodeOne = episodeByTitle.get("Aggregate Episode 1");
    const aggregateEpisodeTwo = episodeByTitle.get("Aggregate Episode 2");
    const aggregateEpisodeThree = episodeByTitle.get("Aggregate Episode 3");
    assert.ok(aggregateEpisodeOne, "first aggregate episode was indexed");
    assert.ok(aggregateEpisodeTwo, "second aggregate episode was indexed");
    assert.ok(aggregateEpisodeThree, "third aggregate episode was indexed");
    const collectionPage = await database.listCollections({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId });
    assert.equal(collectionPage.totalCount, 3, "work counts count collections, not files");
    assert.equal(collectionPage.items.length, 3);
    assert.equal(JSON.stringify(collectionPage.items).includes(collectionRoot), false, "work summaries never expose the source root");
    for (const summary of collectionPage.items) {
      for (const key of Object.keys(summary)) assert.doesNotMatch(key, /path|root|relative/i, `work summary must not expose ${key}`);
    }
    const aggregateShow = collectionPage.items.find((summary) => summary.title === "Aggregate Show");
    assert.ok(aggregateShow, "aggregate show collection summary exists");
    assert.equal(aggregateShow.kind, "show");
    assert.equal(aggregateShow.year, 2020);
    assert.equal(aggregateShow.premieredDate, "2020-05-01");
    assert.equal(aggregateShow.episodeCount, 3);
    assert.equal(aggregateShow.availableEpisodeCount, 3);
    assert.equal(aggregateShow.watchedEpisodeCount, 0);
    assert.equal(aggregateShow.available, true);
    assert.equal(aggregateShow.representativeMediaId, aggregateEpisodeOne.mediaId, "default episode is the first episode when nothing was watched");
    assert.equal(aggregateShow.resume, undefined);
    assert.equal(aggregateShow.coverMediaId, aggregateEpisodeOne.mediaId);
    const aggregateFilm = collectionPage.items.find((summary) => summary.title === "Aggregate Film");
    assert.ok(aggregateFilm, "movie collection summary exists");
    assert.equal(aggregateFilm.kind, "movie");
    assert.equal(aggregateFilm.episodeCount, 1);
    const secondFilm = collectionPage.items.find((summary) => summary.title === "Second Film");
    assert.ok(secondFilm, "a second movie file in the same folder is its own work");
    assert.equal(secondFilm.kind, "movie");
    assert.notEqual(secondFilm.collectionId, aggregateFilm.collectionId, "two movies in one folder never share a work card");

    const showOnly = await database.listCollections({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId, filter: "show" });
    assert.equal(showOnly.totalCount, 1, "the show filter lists one card per show");
    assert.equal(showOnly.items[0]?.collectionId, aggregateShow.collectionId);
    const episodeTitleSearch = await database.listCollections({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId, filter: "show", query: "Aggregate Episode 2" });
    assert.equal(episodeTitleSearch.totalCount, 1, "an episode-title match is returned once, not once per episode");
    assert.equal(episodeTitleSearch.items[0]?.collectionId, aggregateShow.collectionId);
    assert.equal(episodeTitleSearch.items[0]?.matchedEpisode?.mediaId, aggregateEpisodeTwo.mediaId);
    assert.equal(episodeTitleSearch.items[0]?.matchedEpisode?.seasonNumber, 1);
    assert.equal(episodeTitleSearch.items[0]?.matchedEpisode?.episodeNumber, 2);

    await database.savePlayback(aggregateEpisodeTwo.mediaId, { positionSec: 120, durationSec: 1800, watched: false, updatedAtMs: Date.now() });
    const resumedShow = (await database.listCollections({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId, filter: "show" })).items[0];
    assert.equal(resumedShow?.representativeMediaId, aggregateEpisodeTwo.mediaId, "an in-progress episode becomes the representative episode");
    assert.equal(resumedShow?.resume?.mediaId, aggregateEpisodeTwo.mediaId);
    assert.equal(resumedShow?.resume?.positionSec, 120);
    assert.equal(resumedShow?.resume?.seasonNumber, 1);
    assert.equal(resumedShow?.resume?.episodeNumber, 2);
    assert.equal(resumedShow?.resume?.episodeTitle, "Aggregate Episode 2");
    await database.savePlayback(aggregateEpisodeOne.mediaId, { positionSec: 1800, durationSec: 1800, watched: true, updatedAtMs: Date.now() + 10 });
    const afterWatched = (await database.listCollections({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId, filter: "show" })).items[0];
    assert.equal(afterWatched?.watchedEpisodeCount, 1, "watched episodes are counted per work");
    assert.equal(afterWatched?.representativeMediaId, aggregateEpisodeTwo.mediaId);
    const perEpisodeDetail = await database.getDetail(aggregateEpisodeOne.mediaId);
    assert.equal(perEpisodeDetail?.collectionTitle, "Aggregate Show");
    assert.equal(perEpisodeDetail?.episodes.length, 3);
    assert.ok(perEpisodeDetail?.episodePlayback, "detail exposes playback state for every episode");
    const episodeStates = new Map((perEpisodeDetail?.episodePlayback ?? []).map((state) => [state.mediaId, state]));
    assert.equal(episodeStates.size, 2, "only episodes with saved playback appear in the state list");
    assert.equal(episodeStates.get(aggregateEpisodeOne.mediaId)?.watched, true, "the watched episode carries its own watched flag");
    assert.equal(episodeStates.get(aggregateEpisodeTwo.mediaId)?.watched, false);
    assert.equal(episodeStates.get(aggregateEpisodeTwo.mediaId)?.positionSec, 120, "the in-progress episode carries its own position");
    assert.equal(episodeStates.has(aggregateEpisodeThree.mediaId), false, "an unwatched episode is absent rather than borrowing another episode's state");
    assert.equal(JSON.stringify(perEpisodeDetail).includes(collectionRoot), false, "per-episode playback detail never exposes the source root");
    for (const state of perEpisodeDetail?.episodePlayback ?? []) {
      for (const key of Object.keys(state)) assert.doesNotMatch(key, /path|root|relative/i, `episode playback must not expose ${key}`);
    }
    await database.savePlayback(aggregateEpisodeTwo.mediaId, { positionSec: 1800, durationSec: 1800, watched: true, updatedAtMs: Date.now() + 20 });
    const firstUnwatched = (await database.listCollections({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId, filter: "show" })).items[0];
    assert.equal(firstUnwatched?.representativeMediaId, aggregateEpisodeThree.mediaId, "after resume is gone, the first unwatched episode is selected");
    await database.savePlayback(aggregateEpisodeThree.mediaId, { positionSec: 1800, durationSec: 1800, watched: true, updatedAtMs: Date.now() + 30 });
    const fullyWatched = (await database.listCollections({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId, filter: "show" })).items[0];
    assert.equal(fullyWatched?.watchedEpisodeCount, 3);
    assert.equal(fullyWatched?.representativeMediaId, aggregateEpisodeOne.mediaId, "when every episode is watched the first episode is the fallback");
    const fullyWatchedDetail = await database.getDetail(aggregateEpisodeThree.mediaId);
    assert.equal(fullyWatchedDetail?.episodePlayback?.length, 3, "every episode keeps its own watched state");
    assert.equal(fullyWatchedDetail?.episodePlayback?.every((state) => state.watched === true), true);

    const collectionFirstPage = await database.listCollections({ page: 1, pageSize: 1, sourceId: collectionScan.sourceId, sort: "title" });
    const collectionSecondPage = await database.listCollections({ page: 2, pageSize: 1, sourceId: collectionScan.sourceId, sort: "title" });
    assert.equal(collectionFirstPage.totalCount, 3);
    assert.equal(collectionFirstPage.items.length, 1);
    assert.equal(collectionSecondPage.items.length, 1);
    assert.notEqual(collectionFirstPage.items[0]?.collectionId, collectionSecondPage.items[0]?.collectionId);
    const releasedCollections = await database.listCollections({ page: 1, pageSize: 10, sourceId: collectionScan.sourceId, sort: "released_desc" });
    assert.equal(releasedCollections.items[0]?.title, "Aggregate Show", "a dated work sorts before undated works");
    assert.equal(releasedCollections.items[0]?.premieredDate, "2020-05-01");
    assert.equal(releasedCollections.items.length, 3);
    assert.equal(releasedCollections.items.slice(1).every((summary) => summary.premieredDate === null), true, "undated works stay last and never borrow a year");

    const collectionSource = (await database.getState()).sources.find((source) => source.sourceId === collectionScan.sourceId);
    assert.ok(collectionSource, "the scanned folder is summarized");
    assert.equal(collectionSource.collectionCount, 3, "the folder card counts works, not files");
    assert.equal(collectionSource.itemCount, 5, "the folder card counts indexed files");
    assert.equal(collectionSource.locationHint.includes(collectionRoot), false, "the location hint never exposes the root path");
    assert.equal(/[\\/]/u.test(collectionSource.locationHint), false, "the location hint only contains safe clues");
    assert.match(collectionSource.locationHint, /上级：|盘/u);

    const rescanAllResults = await database.rescanAll();
    assert.equal(rescanAllResults.length, (await database.getState()).sources.length, "rescan all visits every registered folder");
    assert.equal(rescanAllResults.every((result) => result.status === "completed"), true, "rescan all reports each folder's result");

    const releaseRoot = join(profile, "release-sort-fixture");
    await mkdir(releaseRoot, { recursive: true });
    const releaseMovies: Array<{ stem: string; nfo: string }> = [
      { stem: "Newest Movie", nfo: "<movie><title>Newest Movie</title><year>2020</year><premiered>2026-03-01</premiered></movie>" },
      { stem: "Older Movie", nfo: "<movie><title>Older Movie</title><year>2030</year><premiered>2024-01-15</premiered></movie>" },
      { stem: "Released Only Movie", nfo: "<movie><title>Released Only Movie</title><year>2001</year><releasedate>2022-07-04</releasedate></movie>" },
      { stem: "Year Only Movie", nfo: "<movie><title>Year Only Movie</title><year>2035</year></movie>" },
      { stem: "Invalid Date Movie", nfo: "<movie><title>Invalid Date Movie</title><year>2031</year><premiered>2026-02-30</premiered></movie>" },
    ];
    for (const movie of releaseMovies) {
      await writeFile(join(releaseRoot, `${movie.stem}.mkv`), Buffer.from("release sort fixture"));
      await writeFile(join(releaseRoot, `${movie.stem}.nfo`), movie.nfo);
    }
    const releaseScan = await database.scanFolder(releaseRoot);
    assert.equal(releaseScan.status, "completed");
    assert.equal(releaseScan.importedFiles, 5);
    const releasedPage = await database.list({ page: 1, pageSize: 10, sourceId: releaseScan.sourceId, sort: "released_desc" });
    assert.deepEqual(
      releasedPage.items.map((item) => item.title),
      ["Newest Movie", "Older Movie", "Released Only Movie", "Year Only Movie", "Invalid Date Movie"],
      "released_desc sorts real dates newest-first, then year/added tiebreakers, and never by a disguised year",
    );
    assert.deepEqual(
      releasedPage.items.map((item) => item.premieredDate),
      ["2026-03-01", "2024-01-15", "2022-07-04", null, null],
      "missing or invalid dates stay null instead of borrowing the year",
    );
    assert.equal(releasedPage.items.some((item) => item.premieredDate === "2035" || item.premieredDate === "2031"), false);
    assert.equal(JSON.stringify(releasedPage.items).includes(releaseRoot), false);
    const defaultPage = await database.list({ page: 1, pageSize: 10, sourceId: releaseScan.sourceId });
    assert.equal(defaultPage.totalCount, 5);
    assert.equal(defaultPage.items.length, 5);

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
    await writeFile(join(movieDirectory, "Metadata Movie.nfo"), `<movie><title>Metadata Movie Updated</title><year>2026</year><premiered>2026-10-05</premiered><plot>Updated plot.</plot><genre>Drama</genre><rating>8.7</rating><thumb aspect="poster">poster.jpg</thumb></movie>`);
    const repeatedScan = await database.scanFolder(metadataRoot);
    assert.equal(repeatedScan.status, "completed");
    assert.equal(repeatedScan.importedFiles, 0);
    assert.equal(repeatedScan.updatedFiles, 3);
    const updated = await database.list({ page: 1, pageSize: 50, query: "Metadata Movie Updated" });
    assert.equal(updated.items[0]?.mediaId, metadataMediaId);
    assert.equal(updated.items[0]?.rating, 8.7);
    assert.equal(updated.items[0]?.premieredDate, "2026-10-05");

    const episodeId = episodePage.items[0]?.mediaId;
    if (!episodeId) throw new Error("episode fixture did not produce a mediaId");
    let concurrentPlayback: Promise<unknown> | undefined;
    const unsubscribeConcurrentPlayback = database.onScanProgress((progress) => {
      if (!concurrentPlayback && progress.status === "running" && progress.scannedFiles === 1) {
        concurrentPlayback = database.savePlayback(episodeId, {
          positionSec: 37,
          durationSec: 180,
          audioTrackId: "audio-concurrent",
          subtitleTrackId: null,
          watched: false,
          updatedAtMs: Date.now(),
        });
      }
    });
    const concurrentScan = await database.scanFolder(metadataRoot);
    unsubscribeConcurrentPlayback();
    assert.equal(concurrentScan.status, "completed");
    if (!concurrentPlayback) throw new Error("scan progress did not observe a concurrent playback write");
    await concurrentPlayback;
    assert.equal((await database.getPlayback(episodeId))?.positionSec, 37);
    assert.equal((await database.getPlayback(episodeId))?.audioTrackId, "audio-concurrent");
    const detail = await database.getDetail(episodeId);
    assert.equal(detail?.collectionTitle, "Example Show");
    assert.equal(detail?.collectionKind, "show");
    assert.equal(detail?.episodes.length, 1);
    assert.equal(detail?.episodes[0]?.mediaId, episodeId);
    assert.equal(detail?.playback?.mediaId, episodeId);
    assert.equal(detail?.playback?.positionSec, 37);
    assert.equal(detail?.playback?.durationSec, 180);
    const episodeFilter = await database.list({ page: 1, pageSize: 50, filter: "episode", sort: "title" });
    assert.equal(episodeFilter.totalCount, 4);
    assert.equal(episodeFilter.items.every((item) => item.kind === "episode"), true);
    assert.equal(episodeFilter.items.some((item) => item.mediaId === episodeId), true);
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
    assert.equal(savedPlayback.subtitleTrackId, null, "the explicit subtitle-off choice is part of the saved state");
    assert.equal((await database.getPlayback(episodeId))?.audioTrackId, "audio-1");
    assert.equal((await database.getPlayback(episodeId))?.subtitleTrackId, null, "an explicit off choice reads back as null, not as a missing field");
    const updatedDetail = await database.getDetail(episodeId);
    assert.equal(updatedDetail?.playback?.mediaId, episodeId);
    assert.equal(updatedDetail?.playback?.positionSec, 42);
    assert.equal(updatedDetail?.playback?.audioTrackId, "audio-1");
    assert.equal(updatedDetail?.playback?.subtitleTrackId, null);
    const continueWatching = await database.listContinueWatching();
    assert.equal(continueWatching.some((entry) => entry.item.mediaId === episodeId && entry.playback.positionSec === 42), true);
    // `undefined` means "never chosen" and must stay an absent field, distinct
    // from the explicit off choice above (Ticket 09).
    await database.savePlayback(episodeId, { positionSec: 42, durationSec: 180, audioTrackId: "audio-1", watched: false });
    assert.equal(
      Object.prototype.hasOwnProperty.call((await database.getPlayback(episodeId)) ?? {}, "subtitleTrackId"),
      false,
      "an unspecified subtitle preference stays an absent field",
    );

    const continueScan = await database.scanFolder(continueRoot);
    assert.equal(continueScan.status, "completed");
    const continueFiles = await database.list({ page: 1, pageSize: 50, sourceId: continueScan.sourceId });
    const continueEpisodeOne = continueFiles.items.find((item) => item.title === "Continue Episode 1");
    const continueEpisodeTwo = continueFiles.items.find((item) => item.title === "Continue Episode 2");
    const continueMovie = continueFiles.items.find((item) => item.title === "Continue Movie");
    const continueShortMovie = continueFiles.items.find((item) => item.title === "Continue Short Movie");
    assert.ok(continueEpisodeOne && continueEpisodeTwo && continueMovie && continueShortMovie, "continue fixture was indexed");
    const earlier = Date.now();
    await database.savePlayback(continueEpisodeOne.mediaId, { positionSec: 42, durationSec: 1800, watched: false, updatedAtMs: earlier });
    await database.savePlayback(continueMovie.mediaId, { positionSec: 42, durationSec: 1800, watched: false, updatedAtMs: earlier + 5 });
    await database.savePlayback(continueEpisodeTwo.mediaId, { positionSec: 50, durationSec: 1800, watched: false, updatedAtMs: earlier + 10 });
    await database.savePlayback(continueShortMovie.mediaId, { positionSec: 2, durationSec: 100, watched: false, updatedAtMs: earlier + 15 });
    const groupedContinue = await database.listContinueWatching();
    const showEntries = groupedContinue.filter((entry) => entry.collectionTitle === "Continue Show");
    assert.equal(showEntries.length, 1, "one work has at most one continue-watching entry");
    assert.equal(showEntries[0]?.item.mediaId, continueEpisodeTwo.mediaId, "the most recent in-progress episode represents the work");
    assert.equal(showEntries[0]?.collectionKind, "show");
    assert.equal(showEntries[0]?.episodeTitle, "Continue Episode 2");
    assert.equal(showEntries[0]?.seasonNumber, 1);
    assert.equal(showEntries[0]?.episodeNumber, 2);
    assert.equal(groupedContinue.some((entry) => entry.collectionTitle === "Continue Movie"), true, "movies keep one continue entry per work");
    assert.equal(new Set(groupedContinue.map((entry) => entry.item.collectionId)).size, groupedContinue.length, "continue watching never duplicates a work");
    assert.equal(groupedContinue.some((entry) => entry.collectionTitle === "Continue Short Movie"), false, "a two-percent position on a ten-minute work is not resume-worthy");
    assert.equal(JSON.stringify(groupedContinue).includes(continueRoot), false, "continue entries never expose the source root");
    await database.savePlayback(continueShortMovie.mediaId, { positionSec: 4, durationSec: 100, watched: false, updatedAtMs: earlier + 20 });
    const shortMovieQualified = await database.listContinueWatching();
    assert.equal(shortMovieQualified.some((entry) => entry.collectionTitle === "Continue Short Movie"), true, "a four-percent position on a short work qualifies");

    const sourceCountBeforeNestedImport = (await database.getState()).sources.length;
    const metadataWorksBeforeImport = await database.listCollections({ page: 1, pageSize: 50, sourceId: scanned.items[0]?.sourceId });
    const episodeItemBeforeImport = await database.get(episodeId);
    const nestedImport = await database.importVideo(episodePath, showDirectory);
    assert.equal(nestedImport.status, "imported");
    if (nestedImport.status !== "imported") throw new Error("nested file import was not accepted");
    assert.equal(nestedImport.item.sourceId, scanned.items[0]?.sourceId);
    // Ticket 07: importing an already indexed episode must not move it into a new
    // minimal "movie" work or clear the metadata a scan derived from the NFO.
    const importedEpisodeDetail = await database.getDetail(episodeId);
    assert.equal(importedEpisodeDetail?.collectionKind, "show", "an import never relabels an indexed episode as a movie work");
    assert.equal(importedEpisodeDetail?.collectionTitle, "Example Show");
    assert.equal(importedEpisodeDetail?.episodes.length, 1);
    assert.equal(importedEpisodeDetail?.episodes[0]?.title, "Second Episode", "the scan-derived episode title survives the import");
    assert.equal(importedEpisodeDetail?.episodes[0]?.seasonNumber, 1);
    assert.equal(importedEpisodeDetail?.episodes[0]?.episodeNumber, 2);
    const episodeItemAfterImport = await database.get(episodeId);
    assert.equal(episodeItemAfterImport?.mediaId, episodeItemBeforeImport?.mediaId);
    assert.equal(episodeItemAfterImport?.title, episodeItemBeforeImport?.title, "the work title is not replaced by the file name");
    assert.equal(episodeItemAfterImport?.kind, episodeItemBeforeImport?.kind);
    assert.equal(episodeItemAfterImport?.plot, episodeItemBeforeImport?.plot, "the NFO plot survives a single-file import");
    assert.equal(episodeItemAfterImport?.year, episodeItemBeforeImport?.year, "the NFO year survives a single-file import");
    assert.equal(episodeItemAfterImport?.premieredDate, episodeItemBeforeImport?.premieredDate);
    const metadataWorksAfterImport = await database.listCollections({ page: 1, pageSize: 50, sourceId: scanned.items[0]?.sourceId });
    assert.equal(metadataWorksAfterImport.totalCount, metadataWorksBeforeImport.totalCount, "an import never creates a second work for an indexed episode");
    assert.equal(metadataWorksAfterImport.items.find((summary) => summary.title === "Example Show")?.episodeCount, 1);
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
    const disconnectFirst = join(disconnectRoot, "a-first");
    const disconnectNested = join(disconnectRoot, "z-nested");
    await mkdir(disconnectFirst, { recursive: true });
    await mkdir(disconnectNested, { recursive: true });
    await writeFile(join(disconnectFirst, "00-first.mkv"), Buffer.from("disconnect first"));
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
    // Ticket 08: an unreadable subdirectory degrades the source instead of taking
    // the whole folder offline, so its indexed entries stay playable.
    const partialSource = (await database.getState()).sources.find((source) => source.sourceId === partialDisconnect.sourceId);
    assert.equal(partialSource?.available, true, "a partial traversal no longer reports the source offline");
    assert.equal(partialSource?.degraded, true, "the source reports a degraded index");
    const partialItems = await database.list({ page: 1, pageSize: 50, sourceId: partialDisconnect.sourceId });
    assert.equal(partialItems.totalCount, 1);
    assert.equal(partialItems.items[0]?.title, "00-first");
    assert.equal(partialItems.items[0]?.available, true, "entries of a degraded source remain playable");
    // A degraded source is still online, so `WHERE sources.available = 1` keeps
    // its files in the cleanup queue instead of emptying it.
    const partialMediaId = partialItems.items[0]?.mediaId;
    if (!partialMediaId) throw new Error("partial fixture did not produce a mediaId");
    const partialFactDb = openSqlite(dbPath);
    try {
      partialFactDb.prepare("UPDATE media_files SET size_bytes = ?, added_at = ? WHERE media_id = ?").run(3 * GIB, Date.now() - 45 * DAY_MS, partialMediaId);
    } finally {
      partialFactDb.close();
    }
    const partialQueue = await database.listCleanupQueue({ page: 1, pageSize: 50, rule: "all", state: "none" }, defaultCleanupSettings());
    assert.equal(partialQueue.candidates.some((candidate) => candidate.item.mediaId === partialMediaId), true, "a degraded source never clears its cleanup candidates");

    await rm(metadataRoot, { recursive: true, force: true });
    const unavailable = await database.scanFolder(metadataRoot);
    assert.equal(unavailable.status, "unavailable");
    assert.equal((await database.get(episodeId))?.available, false);
    assert.equal((await database.getPlayback(episodeId))?.positionSec, 42);

    await rm(collectionRoot, { recursive: true, force: true });
    const unavailableCollectionsScan = await database.scanFolder(collectionRoot);
    assert.equal(unavailableCollectionsScan.status, "unavailable");
    const offlineCollections = await database.listCollections({ page: 1, pageSize: 50, sourceId: collectionScan.sourceId });
    assert.equal(offlineCollections.totalCount, 3, "offline sources keep their indexed works");
    assert.equal(offlineCollections.items.every((summary) => summary.available === false), true);
    assert.equal(offlineCollections.items.every((summary) => summary.availableEpisodeCount === 0), true);
    assert.equal(offlineCollections.items.find((summary) => summary.title === "Aggregate Show")?.episodeCount, 3, "offline works keep their episode counts");
    assert.ok(await database.getPlayback(aggregateEpisodeOne.mediaId), "watch progress exists before the folder is removed");
    await database.removeSource(collectionScan.sourceId);
    assert.equal(await database.getPlayback(aggregateEpisodeOne.mediaId), undefined, "removing a folder deletes its watch progress");

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
    assert.equal(await database.getViewingHistory(imported.item.mediaId), undefined, "removing a source deletes its viewing history");
    assert.equal((await database.list({ page: 1, pageSize: 50, query: "Owned Movie 2026" })).totalCount, 0);
    assert.equal((await stat(moviePath)).isFile(), true);

    await database.close();
    const reopened = new LocalLibraryDatabase({ dbPath, workerPath });
    const reopenedState = await reopened.start();
    assert.equal(reopenedState.status, "ready");
    assert.equal(reopenedState.schemaVersion, 5);
    const reopenedPage = await reopened.list({ page: 1, pageSize: 50 });
    assert.equal(reopenedPage.items.some((item) => item.mediaId === imported.item.mediaId), false);
    await reopened.close();

    const viewingRoot = join(profile, "viewing-ledger-fixture");
    await mkdir(viewingRoot, { recursive: true });
    const viewingFilePath = join(viewingRoot, "Viewing Ledger Movie.mkv");
    const viewingBytes = Buffer.from("viewing ledger fixture");
    await writeFile(viewingFilePath, viewingBytes);
    const ledgerDb = new LocalLibraryDatabase({ dbPath, workerPath });
    await ledgerDb.start();
    const ledgerScan = await ledgerDb.scanFolder(viewingRoot);
    assert.equal(ledgerScan.status, "completed");
    const ledgerItem = (await ledgerDb.list({ page: 1, pageSize: 10, sourceId: ledgerScan.sourceId })).items[0];
    assert.ok(ledgerItem, "viewing ledger fixture was indexed");
    await recordViewingSession(ledgerDb, ledgerItem.mediaId, {
      startedAtMs: 10_000,
      playedSec: 120,
      wallSec: 150,
      endPositionSec: 120,
      durationSec: 1_200,
      completed: false,
      closeReason: "user-close",
    });
    assert.equal((await ledgerDb.getViewingHistory(ledgerItem.mediaId))?.openCount, 1);

    // A completed scan that no longer sees the file confirms the user deleted
    // it, so its ledger rows disappear even though the media row is retained.
    await rm(viewingFilePath, { force: true });
    const missingScan = await ledgerDb.scanFolder(viewingRoot);
    assert.equal(missingScan.status, "completed");
    assert.equal(await ledgerDb.getViewingHistory(ledgerItem.mediaId), undefined, "a scan-confirmed missing file forgets its viewing history");
    const missingDb = openSqlite(dbPath);
    try {
      const sessionCount = missingDb.prepare("SELECT COUNT(*) AS count FROM viewing_sessions WHERE media_id = ?").get(ledgerItem.mediaId) as { count?: number } | undefined;
      assert.equal(Number(sessionCount?.count), 0, "missing-file cleanup deletes the raw sessions too");
    } finally {
      missingDb.close();
    }

    // Re-adding the file starts a fresh record instead of reviving the old one.
    await writeFile(viewingFilePath, viewingBytes);
    await utimes(viewingFilePath, new Date(Date.now() + 2_000), new Date(Date.now() + 2_000));
    const readdedScan = await ledgerDb.scanFolder(viewingRoot);
    assert.equal(readdedScan.status, "completed");
    const readdedItem = (await ledgerDb.list({ page: 1, pageSize: 10, sourceId: ledgerScan.sourceId })).items[0];
    assert.ok(readdedItem, "re-added file was indexed again");
    assert.notEqual(readdedItem.mediaId, ledgerItem.mediaId, "a re-added file gets a fresh opaque identity");
    assert.equal(await ledgerDb.getViewingHistory(readdedItem.mediaId), undefined, "re-adding starts with no viewing history");
    await recordViewingSession(ledgerDb, readdedItem.mediaId, {
      startedAtMs: 20_000,
      playedSec: 60,
      wallSec: 65,
      endPositionSec: 60,
      durationSec: 1_200,
      completed: false,
      closeReason: "user-close",
    });

    // A temporarily unavailable source keeps its records; only an explicit
    // removal or a readable scan that confirms the file is missing clears them.
    await rename(viewingRoot, `${viewingRoot}-offline`);
    const offlineScan = await ledgerDb.scanFolder(viewingRoot);
    assert.equal(offlineScan.status, "unavailable");
    assert.equal((await ledgerDb.getViewingHistory(readdedItem.mediaId))?.openCount, 1, "an offline source keeps viewing history");
    await rename(`${viewingRoot}-offline`, viewingRoot);
    const backOnlineScan = await ledgerDb.scanFolder(viewingRoot);
    assert.equal(backOnlineScan.status, "completed");
    assert.equal((await ledgerDb.getViewingHistory(readdedItem.mediaId))?.openCount, 1, "coming back online keeps the same history");
    await ledgerDb.removeSource(readdedScan.sourceId);
    assert.equal(await ledgerDb.getViewingHistory(readdedItem.mediaId), undefined, "removing the source forgets the history");
    await ledgerDb.close();

    // Ticket 22a: markers are whole-second points keyed by the opaque media ID.
    // They list by position, survive an owner restart, cascade with the source,
    // and reject invalid ids and out-of-range positions without clamping.
    const markerRoot = join(profile, "marker-fixture");
    await mkdir(markerRoot, { recursive: true });
    await writeFile(join(markerRoot, "Marker Movie.mkv"), Buffer.from("marker fixture"));
    const markerDb = new LocalLibraryDatabase({ dbPath, workerPath });
    await markerDb.start();
    const markerScan = await markerDb.scanFolder(markerRoot);
    assert.equal(markerScan.status, "completed");
    const markerItem = (await markerDb.list({ page: 1, pageSize: 10, sourceId: markerScan.sourceId })).items[0];
    assert.ok(markerItem, "marker fixture was indexed");
    const markerMediaId = markerItem.mediaId;
    assert.deepEqual(await markerDb.listMarkers(markerMediaId), [], "a new media file starts without markers");
    const firstMarker = await markerDb.addMarker({ mediaId: markerMediaId, positionSec: 90 });
    assert.deepEqual(
      Object.keys(firstMarker).sort(),
      ["createdAtMs", "mediaId", "positionSec"],
      "the marker DTO carries only the opaque id, whole-second position and creation time",
    );
    assert.equal(firstMarker.mediaId, markerMediaId);
    assert.equal(firstMarker.positionSec, 90);
    assert.equal(Number.isInteger(firstMarker.createdAtMs), true);
    assert.equal(JSON.stringify(firstMarker).includes(markerRoot), false, "a marker never exposes the source root");
    const duplicateMarker = await markerDb.addMarker({ mediaId: markerMediaId, positionSec: 90 });
    assert.equal(duplicateMarker.createdAtMs, firstMarker.createdAtMs, "re-adding the same second is idempotent and keeps its original time");
    await markerDb.addMarker({ mediaId: markerMediaId, positionSec: 30 });
    assert.deepEqual(
      (await markerDb.listMarkers(markerMediaId)).map((marker) => marker.positionSec),
      [30, 90],
      "markers list ordered by position",
    );
    await assert.rejects(
      () => markerDb.addMarker({ mediaId: "C:\\Media\\movie.mkv" as `media_${string}`, positionSec: 10 }),
      /mediaId/u,
      "a path is not an opaque media id",
    );
    await assert.rejects(() => markerDb.addMarker({ mediaId: markerMediaId, positionSec: -1 }), /标记位置/u, "a negative position is rejected, not clamped");
    await assert.rejects(() => markerDb.addMarker({ mediaId: markerMediaId, positionSec: 10.5 }), /标记位置/u, "a fractional position is rejected instead of being rounded");
    await assert.rejects(
      () => markerDb.addMarker({ mediaId: markerMediaId, positionSec: 3_601, durationSec: 3_600 }),
      /超出/u,
      "a position past the reported duration is rejected",
    );
    await assert.rejects(
      () => markerDb.addMarker({ mediaId: "media_123e4567-e89b-42d3-a456-426614174099", positionSec: 10 }),
      /不存在/u,
      "an unknown opaque media id cannot be marked",
    );
    // The stored playback duration is an independent second upper bound.
    await markerDb.savePlayback({ mediaId: markerMediaId, positionSec: 0, durationSec: 1_200, watched: false, updatedAtMs: Date.now() });
    await assert.rejects(
      () => markerDb.addMarker({ mediaId: markerMediaId, positionSec: 1_300 }),
      /超出/u,
      "a position past the stored playback duration is rejected even without a caller-supplied duration",
    );
    assert.deepEqual(
      (await markerDb.listMarkers(markerMediaId)).map((marker) => marker.positionSec),
      [30, 90],
      "rejected markers never reach the table",
    );
    // Ticket 22b: deletion is keyed by the same opaque id + whole second, and a
    // marker that is already gone is an idempotent no-op instead of an error.
    assert.equal(
      await markerDb.removeMarker({ mediaId: markerMediaId, positionSec: 10 }),
      false,
      "deleting a second that has no marker reports no removal",
    );
    assert.equal(
      await markerDb.removeMarker({ mediaId: "media_123e4567-e89b-42d3-a456-426614174099", positionSec: 30 }),
      false,
      "deleting from a well-formed but unknown media id removes nothing",
    );
    assert.equal(await markerDb.removeMarker({ mediaId: markerMediaId, positionSec: 90 }), true, "deleting a stored marker reports the removal");
    assert.deepEqual(
      (await markerDb.listMarkers(markerMediaId)).map((marker) => marker.positionSec),
      [30],
      "deleting one marker leaves the other seconds untouched",
    );
    assert.equal(await markerDb.removeMarker({ mediaId: markerMediaId, positionSec: 90 }), false, "deleting the same second twice is idempotent");
    await assert.rejects(
      () => markerDb.removeMarker({ mediaId: "C:\\Media\\movie.mkv" as `media_${string}`, positionSec: 30 }),
      /mediaId/u,
      "a path is not an opaque media id for deletion",
    );
    await assert.rejects(() => markerDb.removeMarker({ mediaId: markerMediaId, positionSec: -1 }), /标记位置/u, "a negative delete position is rejected");
    await assert.rejects(() => markerDb.removeMarker({ mediaId: markerMediaId, positionSec: 30.5 }), /标记位置/u, "a fractional delete position is rejected instead of being rounded");
    assert.deepEqual(
      (await markerDb.listMarkers(markerMediaId)).map((marker) => marker.positionSec),
      [30],
      "rejected deletes never remove a marker",
    );
    await markerDb.close();
    const markerReopened = new LocalLibraryDatabase({ dbPath, workerPath });
    await markerReopened.start();
    assert.deepEqual(
      (await markerReopened.listMarkers(markerMediaId)).map((marker) => marker.positionSec),
      [30],
      "a deleted marker stays gone after an owner restart",
    );
    await markerReopened.removeSource(markerScan.sourceId);
    assert.deepEqual(await markerReopened.listMarkers(markerMediaId), [], "removing the Source forgets its markers");
    const markerRows = openSqlite(dbPath);
    try {
      const orphanCount = markerRows.prepare("SELECT COUNT(*) AS count FROM markers WHERE media_id = ?").get(markerMediaId) as { count?: number } | undefined;
      assert.equal(Number(orphanCount?.count), 0, "removing the Source leaves no orphan marker rows");
    } finally {
      markerRows.close();
    }
    await markerReopened.close();

    // A2 cleanup rules and queue. Sizes/ages are seeded directly because the
    // public facade intentionally has no "pretend this is a 6 GB file from last
    // year" switch; every read/decision below still goes through the facade.
    const cleanupRoot = join(profile, "cleanup-fixture");
    await mkdir(cleanupRoot, { recursive: true });
    const cleanupTitles = [
      "Cleanup Never Opened",
      "Cleanup Glanced",
      "Cleanup Few Opens",
      "Cleanup Low Return",
      "Cleanup Low Revisit",
      "Cleanup Recent Control",
      "Cleanup Protected",
    ];
    for (const title of cleanupTitles) await writeFile(join(cleanupRoot, `${title}.mkv`), Buffer.from(`cleanup fixture ${title}`));
    for (let index = 0; index < 18; index += 1) await writeFile(join(cleanupRoot, `Cleanup Extra ${index}.mkv`), Buffer.from(`cleanup extra ${index}`));
    const cleanupDbPath = join(profile, "cleanup.sqlite");
    const cleanupDb = new LocalLibraryDatabase({ dbPath: cleanupDbPath, workerPath });
    await cleanupDb.start();
    const cleanupScan = await cleanupDb.scanFolder(cleanupRoot);
    assert.equal(cleanupScan.status, "completed");
    assert.equal(cleanupScan.importedFiles, cleanupTitles.length + 18);
    const cleanupItems = (await cleanupDb.list({ page: 1, pageSize: 100, sourceId: cleanupScan.sourceId })).items;
    const mediaIdByTitle = new Map(cleanupItems.map((item) => [item.title, item.mediaId]));
    const cleanupId = (title: string): `media_${string}` => {
      const mediaId = mediaIdByTitle.get(title);
      if (!mediaId) throw new Error(`cleanup fixture is missing ${title}`);
      return mediaId;
    };
    const cleanupNow = Date.now();
    const standard = defaultCleanupSettings();
    const activeQuery = { page: 1, pageSize: 50, rule: "all", state: "none" } as const;
    seedCleanupFacts(cleanupDbPath, cleanupNow, [
      { mediaId: cleanupId("Cleanup Never Opened"), sizeBytes: 3 * GIB, addedAtMs: cleanupNow - 45 * DAY_MS },
      { mediaId: cleanupId("Cleanup Glanced"), sizeBytes: 3 * GIB, addedAtMs: cleanupNow - 60 * DAY_MS, history: { openCount: 2, effectiveWatchCount: 0, completedCount: 0, totalPlayedSec: 40, lastOpenedAtMs: cleanupNow - 40 * DAY_MS } },
      { mediaId: cleanupId("Cleanup Few Opens"), sizeBytes: 6 * GIB, addedAtMs: cleanupNow - 60 * DAY_MS, history: { openCount: 2, effectiveWatchCount: 1, completedCount: 0, totalPlayedSec: 1_000, lastOpenedAtMs: cleanupNow - 100 * DAY_MS } },
      { mediaId: cleanupId("Cleanup Low Return"), sizeBytes: 6 * GIB, addedAtMs: cleanupNow - 60 * DAY_MS, history: { openCount: 3, effectiveWatchCount: 1, completedCount: 0, totalPlayedSec: 300, lastOpenedAtMs: cleanupNow - 10 * DAY_MS } },
      { mediaId: cleanupId("Cleanup Low Revisit"), sizeBytes: 6 * GIB, addedAtMs: cleanupNow - 60 * DAY_MS, history: { openCount: 2, effectiveWatchCount: 2, completedCount: 1, totalPlayedSec: 2_000, lastOpenedAtMs: cleanupNow - 200 * DAY_MS } },
      { mediaId: cleanupId("Cleanup Recent Control"), sizeBytes: 3 * GIB, addedAtMs: cleanupNow - 60 * DAY_MS, history: { openCount: 1, effectiveWatchCount: 1, completedCount: 0, totalPlayedSec: 1_000, lastOpenedAtMs: cleanupNow - 5 * DAY_MS } },
      { mediaId: cleanupId("Cleanup Protected"), sizeBytes: Math.floor(2.8 * GIB), addedAtMs: cleanupNow - 5 * DAY_MS },
    ]);

    const active = await cleanupDb.listCleanupQueue(activeQuery, standard);
    assert.equal(active.totalCount, 5, "only the five rule fixtures are cleanup candidates");
    assert.deepEqual(active.candidates.map((candidate) => candidate.rule), ["C", "D", "A", "B", "E"], "candidates sort C → D → A → B → E");
    assert.deepEqual(active.candidates.map((candidate) => candidate.item.title), [
      "Cleanup Few Opens",
      "Cleanup Low Return",
      "Cleanup Never Opened",
      "Cleanup Glanced",
      "Cleanup Low Revisit",
    ]);
    assert.equal(active.totalBytes, 24 * GIB, "the summary adds only current candidate sizes");
    assert.equal(active.relativeLargeBytes, 3 * GIB, "a 25-file library enables the relative-large percentile");
    assert.equal(active.candidates[2].viewing, undefined, "a never-played candidate has no fabricated viewing record");
    assert.equal(active.candidates[3].viewing?.openCount, 2, "a glanced candidate carries its real open count");
    assert.ok(active.candidates.every((candidate) => candidate.cleanupState === "none"));
    assert.ok(active.candidates.every((candidate) => candidate.addedAtMs > 0));
    assert.equal(JSON.stringify(active).includes(cleanupRoot), false, "the cleanup queue never exposes a source root");
    for (const key of Object.keys(active.candidates[0].item)) assert.doesNotMatch(key, /path|root|relative/i, `cleanup item must not expose ${key}`);
    assert.equal((await stat(join(cleanupRoot, "Cleanup Never Opened.mkv"))).isFile(), true, "reading candidates never deletes a source file");

    const onlyC = await cleanupDb.listCleanupQueue({ ...activeQuery, rule: "C" }, standard);
    assert.equal(onlyC.totalCount, 1);
    assert.equal(onlyC.candidates[0].item.title, "Cleanup Few Opens");

    const withoutA = await cleanupDb.listCleanupQueue(activeQuery, { ...standard, rules: { ...standard.rules, A: false } });
    assert.equal(withoutA.totalCount, 4, "closing rule A removes never-opened candidates");
    assert.equal(withoutA.candidates.some((candidate) => candidate.item.title === "Cleanup Never Opened"), false);

    const aggressive = await cleanupDb.listCleanupQueue(activeQuery, { ...standard, preset: "aggressive", thresholds: { ...CLEANUP_PRESETS.aggressive } });
    assert.equal(aggressive.totalCount, 5, "the aggressive preset keeps the seeded candidates");
    const strict = await cleanupDb.listCleanupQueue(activeQuery, {
      ...standard,
      preset: "custom",
      thresholds: { ...standard.thresholds, largeBytes: 8 * GIB, veryLargeBytes: 8 * GIB, hugeBytes: 8 * GIB },
    });
    assert.equal(strict.totalCount, 0, "a custom size threshold changes the candidate set on the next query");

    const neverOpenedId = cleanupId("Cleanup Never Opened");
    const glancedId = cleanupId("Cleanup Glanced");
    const fewOpensId = cleanupId("Cleanup Few Opens");
    const lowReturnId = cleanupId("Cleanup Low Return");
    const lowRevisitId = cleanupId("Cleanup Low Revisit");
    await cleanupDb.setCleanupState({ mediaId: neverOpenedId, state: "snooze" }, standard.keepDays, standard.snoozeDays);
    await cleanupDb.setCleanupState({ mediaId: glancedId, state: "keep" }, standard.keepDays, standard.snoozeDays);
    assert.equal((await cleanupDb.getDetail(neverOpenedId))?.viewing, undefined, "a cleanup mark does not fabricate a viewing record");
    const afterMarks = await cleanupDb.listCleanupQueue(activeQuery, standard);
    assert.equal(afterMarks.totalCount, 3, "snoozed and kept files leave the active queue");
    const snoozed = await cleanupDb.listCleanupQueue({ ...activeQuery, state: "snooze" }, standard);
    assert.equal(snoozed.totalCount, 1);
    assert.equal(snoozed.candidates[0].cleanupState, "snooze");
    assert.ok((snoozed.candidates[0].cleanupUntilMs ?? 0) > cleanupNow + 29 * DAY_MS, "snooze uses the configured day count");
    const kept = await cleanupDb.listCleanupQueue({ ...activeQuery, state: "keep" }, standard);
    assert.equal(kept.totalCount, 1);
    assert.equal(kept.candidates[0].item.title, "Cleanup Glanced");
    assert.equal(kept.candidates[0].cleanupUntilMs, undefined, "keep is terminal, so it stores no deadline");

    // Ticket 14: a keep mark written by an older client that still stored a
    // deadline is immediately terminal; an expired date never returns the file.
    const legacyKeepDb = openSqlite(cleanupDbPath);
    try {
      legacyKeepDb.prepare("UPDATE media_history SET cleanup_state = 'keep', cleanup_until = ? WHERE media_id = ?").run(cleanupNow - DAY_MS, glancedId);
    } finally {
      legacyKeepDb.close();
    }
    const legacyKeep = await cleanupDb.listCleanupQueue({ ...activeQuery, state: "keep" }, standard);
    assert.equal(legacyKeep.candidates.some((candidate) => candidate.item.mediaId === glancedId), true, "an expired keep deadline is ignored");
    assert.equal((await cleanupDb.listCleanupQueue(activeQuery, standard)).candidates.some((candidate) => candidate.item.mediaId === glancedId), false, "a kept file never returns to the active queue");

    await cleanupDb.setCleanupState({ mediaId: fewOpensId, state: "delete-candidate" }, standard.keepDays, standard.snoozeDays);
    await cleanupDb.setCleanupState({ mediaId: lowReturnId, state: "delete-candidate" }, standard.keepDays, standard.snoozeDays);
    const queued = await cleanupDb.listCleanupQueue(activeQuery, standard);
    assert.equal(queued.totalCount, 1, "delete candidates leave the active queue");
    assert.equal(queued.deleteCount, 2);
    assert.equal(queued.deleteBytes, 12 * GIB);
    assert.equal(queued.deleteQueue[0].item.title, "Cleanup Few Opens", "the delete list sorts by releasable space");
    assert.equal(queued.deleteQueue.every((entry) => entry.cleanupState === "delete-candidate"), true);
    await cleanupDb.setCleanupState({ mediaId: lowReturnId, state: "none" }, standard.keepDays, standard.snoozeDays);
    const reset = await cleanupDb.listCleanupQueue(activeQuery, standard);
    assert.equal(reset.deleteCount, 1, "clearing a delete mark returns the file to the active queue");
    assert.equal(reset.candidates.some((candidate) => candidate.item.title === "Cleanup Low Return"), true);
    await cleanupDb.setCleanupState({ mediaId: lowRevisitId, state: "delete-candidate" }, standard.keepDays, standard.snoozeDays);
    assert.equal((await cleanupDb.listCleanupQueue(activeQuery, standard)).deleteCount, 2);

    await assert.rejects(
      () => cleanupDb.setCleanupState({ mediaId: "media_123e4567-e89b-42d3-a456-426614174000", state: "keep" }, 180, 30),
      /媒体不存在/,
      "an unknown media id cannot be marked",
    );
    await assert.rejects(
      () => cleanupDb.setCleanupState({ mediaId: neverOpenedId, state: "deleted" as never }, 180, 30),
      /状态无效/,
      "an unknown cleanup state is rejected",
    );

    await cleanupDb.close();
    const cleanupReopened = new LocalLibraryDatabase({ dbPath: cleanupDbPath, workerPath });
    await cleanupReopened.start();
    try {
      const persistedSnooze = await cleanupReopened.listCleanupQueue({ ...activeQuery, state: "snooze" }, standard);
      assert.equal(persistedSnooze.candidates[0]?.item.title, "Cleanup Never Opened", "snooze marks survive a worker restart");
      assert.equal((await cleanupReopened.listCleanupQueue({ ...activeQuery, state: "keep" }, standard)).candidates[0]?.item.title, "Cleanup Glanced");
      const persistedDelete = await cleanupReopened.listCleanupQueue(activeQuery, standard);
      assert.equal(persistedDelete.deleteCount, 2, "delete candidates survive a worker restart");
      assert.equal(persistedDelete.candidates.some((candidate) => candidate.item.title === "Cleanup Never Opened"), false);
      assert.equal(persistedDelete.candidates.every((candidate) => candidate.cleanupState === "none"), true);
    } finally {
      await cleanupReopened.close();
    }

    // The delete list only ever contains files that are still on disk: a
    // scan-confirmed missing file drops out of the list.
    const cleanupMissingRoot = join(profile, "cleanup-missing-fixture");
    await mkdir(cleanupMissingRoot, { recursive: true });
    const cleanupMissingPath = join(cleanupMissingRoot, "Cleanup Missing.mkv");
    await writeFile(cleanupMissingPath, Buffer.from("cleanup missing fixture"));
    const cleanupMissingDb = new LocalLibraryDatabase({ dbPath: join(profile, "cleanup-missing.sqlite"), workerPath });
    await cleanupMissingDb.start();
    try {
      const missingCleanupScan = await cleanupMissingDb.scanFolder(cleanupMissingRoot);
      const missingCleanupItem = (await cleanupMissingDb.list({ page: 1, pageSize: 10, sourceId: missingCleanupScan.sourceId })).items[0];
      assert.ok(missingCleanupItem);
      await cleanupMissingDb.setCleanupState({ mediaId: missingCleanupItem.mediaId, state: "delete-candidate" }, 180, 30);
      assert.equal((await cleanupMissingDb.listCleanupQueue(activeQuery, standard)).deleteCount, 1);
      await rm(cleanupMissingPath, { force: true });
      await cleanupMissingDb.scanFolder(cleanupMissingRoot);
      const missingQueue = await cleanupMissingDb.listCleanupQueue(activeQuery, standard);
      assert.equal(missingQueue.deleteCount, 0, "the delete list drops scan-confirmed missing files");
      assert.equal(missingQueue.totalCount, 0, "missing files never appear as current candidates");
    } finally {
      await cleanupMissingDb.close();
    }

    // Crash recovery: a session left open by a dead process is settled from its
    // last heartbeat as interrupted, not lost.
    const recoveryDbPath = join(profile, "recovery.sqlite");
    const recoveryRoot = join(profile, "recovery-fixture");
    await mkdir(recoveryRoot, { recursive: true });
    await writeFile(join(recoveryRoot, "Recovery Movie.mkv"), Buffer.from("recovery fixture"));
    const recoveryDb = new LocalLibraryDatabase({ dbPath: recoveryDbPath, workerPath });
    await recoveryDb.start();
    const recoveryScan = await recoveryDb.scanFolder(recoveryRoot);
    const recoveryItem = (await recoveryDb.list({ page: 1, pageSize: 10, sourceId: recoveryScan.sourceId })).items[0];
    assert.ok(recoveryItem, "recovery fixture was indexed");
    const interrupted = await recoveryDb.startViewingSession({ mediaId: recoveryItem.mediaId, startedAtMs: 50_000, startPositionSec: 0 });
    await recoveryDb.heartbeatViewingSession({
      sessionId: interrupted.sessionId,
      playedSec: 45,
      wallSec: 60,
      endPositionSec: 45,
      durationSec: 600,
      pauseCount: 2,
      seekCount: 1,
      speed: 1,
      heartbeatAtMs: 110_000,
    });
    await recoveryDb.close();
    const recovered = new LocalLibraryDatabase({ dbPath: recoveryDbPath, workerPath });
    await recovered.start();
    const recoveredHistory = await recovered.getViewingHistory(recoveryItem.mediaId);
    assert.ok(recoveredHistory, "the interrupted session was recovered, not dropped");
    assert.equal(recoveredHistory.openCount, 1);
    assert.equal(recoveredHistory.effectiveWatchCount, 1, "45 played seconds are an effective watch");
    assert.equal(recoveredHistory.completedCount, 0, "recovery applies the same 90% completion rule as the live close");
    assert.equal(recoveredHistory.totalPlayedSec, 45);
    assert.equal(recoveredHistory.lastSessionWallSec, 60);
    await recovered.close();
    const recoveredDb = openSqlite(recoveryDbPath);
    try {
      const sessionRow = recoveredDb.prepare("SELECT close_reason AS closeReason, ended_at AS endedAt FROM viewing_sessions WHERE session_id = ?").get(interrupted.sessionId) as { closeReason?: string; endedAt?: number } | undefined;
      assert.equal(sessionRow?.closeReason, "interrupted");
      assert.equal(sessionRow?.endedAt, 110_000, "recovery settles at the last heartbeat");
    } finally {
      recoveredDb.close();
    }

    // Ticket 20 / P-05: completion has exactly one judge — the viewing ledger.
    // A close at 90%+ without an engine `ended` must flip the playback projection
    // in the same write, otherwise detail/continue-watching keep saying
    // "继续播放" while the record says "完整看完 1 次".
    const completionDbPath = join(profile, "completion.sqlite");
    const completionRoot = join(profile, "completion-fixture");
    await mkdir(completionRoot, { recursive: true });
    await writeFile(join(completionRoot, "Completion Movie.mkv"), Buffer.from("completion fixture"));
    await writeFile(join(completionRoot, "Half Watched Movie.mkv"), Buffer.from("half watched fixture"));
    const completionDb = new LocalLibraryDatabase({ dbPath: completionDbPath, workerPath });
    await completionDb.start();
    try {
      const completionScan = await completionDb.scanFolder(completionRoot);
      const completionItems = (await completionDb.list({ page: 1, pageSize: 10, sourceId: completionScan.sourceId })).items;
      const completionItem = completionItems.find((item) => item.title === "Completion Movie");
      const halfWatchedItem = completionItems.find((item) => item.title === "Half Watched Movie");
      assert.ok(completionItem && halfWatchedItem, "completion fixtures were indexed");
      // The player flushes 95% with watched=false right before the ledger closes.
      await completionDb.savePlayback(completionItem!.mediaId, { positionSec: 950, durationSec: 1000, watched: false, updatedAtMs: 1_000 });
      await completionDb.savePlayback(halfWatchedItem!.mediaId, { positionSec: 500, durationSec: 1000, watched: false, updatedAtMs: 1_000 });
      assert.equal((await completionDb.getDetail(completionItem!.mediaId))?.playback?.watched, false);
      assert.equal((await completionDb.listContinueWatching()).some((entry) => entry.item.mediaId === completionItem!.mediaId), true, "an in-progress 95% work is listed before the ledger settles");

      await recordViewingSession(completionDb, completionItem!.mediaId, { startedAtMs: 2_000, playedSec: 900, wallSec: 1_000, endPositionSec: 950, durationSec: 1_000, completed: false, closeReason: "user-close" });
      await recordViewingSession(completionDb, halfWatchedItem!.mediaId, { startedAtMs: 4_000, playedSec: 500, wallSec: 600, endPositionSec: 500, durationSec: 1_000, completed: false, closeReason: "user-close" });

      const completedDetail = await completionDb.getDetail(completionItem!.mediaId);
      assert.equal(completedDetail?.playback?.watched, true, "a 95% close writes the ledger's completion into playback_state");
      assert.equal(completedDetail?.viewing?.completedCount, 1, "the record counts the same close as one completed watch");
      assert.equal((await completionDb.listContinueWatching()).some((entry) => entry.item.mediaId === completionItem!.mediaId), false, "a completed work leaves continue watching");

      const halfDetail = await completionDb.getDetail(halfWatchedItem!.mediaId);
      assert.equal(halfDetail?.playback?.watched, false, "a 50% close never becomes a completed watch");
      assert.equal(halfDetail?.viewing?.completedCount, 0);
      assert.equal((await completionDb.listContinueWatching()).some((entry) => entry.item.mediaId === halfWatchedItem!.mediaId), true, "a 50% close stays in continue watching");
      await completionDb.close();

      // The interrupted-session recovery writes through the same completion
      // conclusion, so a crash after 95% cannot leave the projection behind either.
      const recoveredCompletionDb = new LocalLibraryDatabase({ dbPath: completionDbPath, workerPath });
      await recoveredCompletionDb.start();
      try {
        await recoveredCompletionDb.savePlayback(completionItem!.mediaId, { positionSec: 970, durationSec: 1_000, watched: false, updatedAtMs: 10_000 });
      } finally {
        await recoveredCompletionDb.close();
      }
      const interruptedCompletion = openSqlite(completionDbPath);
      try {
        interruptedCompletion.prepare(`
          INSERT INTO viewing_sessions (session_id, media_id, started_at, ended_at, played_sec, wall_sec, end_position_sec, duration_sec, pause_count, seek_count, speed, close_reason, completed, last_heartbeat_at)
          VALUES (?, ?, 20000, NULL, 960, 1000, 970, 1000, 0, 0, 1, NULL, 0, 30000)
        `).run("session_22222222-2222-4222-8222-222222222222", completionItem!.mediaId);
      } finally {
        interruptedCompletion.close();
      }
      const recoveredCompletion = new LocalLibraryDatabase({ dbPath: completionDbPath, workerPath });
      await recoveredCompletion.start();
      try {
        const recoveredDetail = await recoveredCompletion.getDetail(completionItem!.mediaId);
        assert.equal(recoveredDetail?.playback?.watched, true, "recovery applies the same completion verdict to playback_state");
        assert.equal(recoveredDetail?.viewing?.completedCount, 2, "the recovered session is the second completed watch");
      } finally {
        await recoveredCompletion.close();
      }
    } finally {
      await completionDb.close().catch(() => undefined);
    }

    // Ticket 20 / F-04 (owner side): a failed start discards the unusable worker
    // and the next owner call — the one behind the renderer's retry button —
    // re-runs initialization instead of reusing a process that never opened the
    // database (which made the button appear to do nothing).
    const retryDbPath = join(profile, "retry-initialization.sqlite");
    await mkdir(retryDbPath, { recursive: true });
    const retryDb = new LocalLibraryDatabase({ dbPath: retryDbPath, workerPath });
    await assert.rejects(() => withDeadline(retryDb.start(), 30_000, "failed start"), /存储不可用|无法读取|重试/);
    assert.equal(retryDb.getState().status, "error");
    await rm(retryDbPath, { recursive: true, force: true });
    const retriedPage = await withDeadline(retryDb.list({ page: 1, pageSize: 5 }), 30_000, "list after a failed start");
    assert.equal(retriedPage.totalCount, 0);
    assert.equal(retryDb.getState().status, "ready", "an owner call after a failed start re-initializes the library");
    await retryDb.close();

    // Ticket 09: the subtitle three-state choice survives a worker restart.
    const subtitleDbPath = join(profile, "subtitle-sentinel.sqlite");
    const subtitleRoot = join(profile, "subtitle-fixture");
    await mkdir(subtitleRoot, { recursive: true });
    await writeFile(join(subtitleRoot, "Subtitle Sentinels.mkv"), Buffer.from("subtitle sentinel fixture"));
    const subtitleDb = new LocalLibraryDatabase({ dbPath: subtitleDbPath, workerPath });
    await subtitleDb.start();
    const subtitleScan = await subtitleDb.scanFolder(subtitleRoot);
    const subtitleItem = (await subtitleDb.list({ page: 1, pageSize: 10, sourceId: subtitleScan.sourceId })).items[0];
    assert.ok(subtitleItem, "subtitle fixture was indexed");
    await subtitleDb.savePlayback(subtitleItem.mediaId, { positionSec: 10, durationSec: 600, watched: false, subtitleTrackId: null });
    assert.equal((await subtitleDb.getPlayback(subtitleItem.mediaId))?.subtitleTrackId, null);
    await subtitleDb.close();
    const subtitleRaw = openSqlite(subtitleDbPath);
    try {
      const row = subtitleRaw.prepare("SELECT subtitle_track_id AS subtitleTrackId FROM playback_state WHERE media_id = ?").get(subtitleItem.mediaId) as { subtitleTrackId?: string | null } | undefined;
      assert.equal(row?.subtitleTrackId, "off", "an explicit off choice is stored as the sentinel");
    } finally {
      subtitleRaw.close();
    }
    const subtitleReopened = new LocalLibraryDatabase({ dbPath: subtitleDbPath, workerPath });
    await subtitleReopened.start();
    assert.equal((await subtitleReopened.getPlayback(subtitleItem.mediaId))?.subtitleTrackId, null, "the off choice survives a restart");
    await subtitleReopened.savePlayback(subtitleItem.mediaId, { positionSec: 11, durationSec: 600, watched: false, subtitleTrackId: "subtitle-track-2" });
    assert.equal((await subtitleReopened.getPlayback(subtitleItem.mediaId))?.subtitleTrackId, "subtitle-track-2");
    await subtitleReopened.savePlayback(subtitleItem.mediaId, { positionSec: 12, durationSec: 600, watched: false });
    const clearedPreference = await subtitleReopened.getPlayback(subtitleItem.mediaId);
    assert.equal(
      Object.prototype.hasOwnProperty.call(clearedPreference ?? {}, "subtitleTrackId"),
      false,
      "an unspecified subtitle preference stays an absent field after a restart",
    );
    await subtitleReopened.close();
    const subtitleClearedRaw = openSqlite(subtitleDbPath);
    try {
      const row = subtitleClearedRaw.prepare("SELECT subtitle_track_id AS subtitleTrackId FROM playback_state WHERE media_id = ?").get(subtitleItem.mediaId) as { subtitleTrackId?: string | null } | undefined;
      assert.equal(row?.subtitleTrackId, null, "an unspecified choice is stored as NULL");
    } finally {
      subtitleClearedRaw.close();
    }

    // Ticket 11: a replaced file leaves a tombstone that never becomes a card,
    // never inflates a work's episode count, and has no detail to open.
    const visibilityRoot = join(profile, "visibility-fixture");
    await mkdir(visibilityRoot, { recursive: true });
    const visibilityPath = join(visibilityRoot, "Visibility Movie.mkv");
    await writeFile(visibilityPath, Buffer.from("visibility fixture before replacement"));
    const visibilityDb = new LocalLibraryDatabase({ dbPath: join(profile, "visibility.sqlite"), workerPath });
    await visibilityDb.start();
    const visibilityScan = await visibilityDb.scanFolder(visibilityRoot);
    assert.equal(visibilityScan.status, "completed");
    const oldVisibilityItem = (await visibilityDb.list({ page: 1, pageSize: 10, sourceId: visibilityScan.sourceId })).items[0];
    assert.ok(oldVisibilityItem, "visibility fixture was indexed");
    await writeFile(visibilityPath, Buffer.from("visibility fixture after replacement, longer bytes"));
    await utimes(visibilityPath, new Date(Date.now() + 5_000), new Date(Date.now() + 5_000));
    const replacedScan = await visibilityDb.scanFolder(visibilityRoot);
    assert.equal(replacedScan.status, "completed");
    const replacedItems = await visibilityDb.list({ page: 1, pageSize: 10, sourceId: replacedScan.sourceId });
    assert.equal(replacedItems.totalCount, 1, "a replaced file leaves one current card");
    assert.equal(replacedItems.items.length, 1);
    const newVisibilityItem = replacedItems.items[0];
    assert.ok(newVisibilityItem, "the replacement was indexed");
    assert.notEqual(newVisibilityItem.mediaId, oldVisibilityItem.mediaId, "a changed fingerprint is a new opaque identity");
    assert.equal(await visibilityDb.getDetail(oldVisibilityItem.mediaId), undefined, "a tombstone has an explicit unavailable detail, not an empty episode list");
    const replacedDetail = await visibilityDb.getDetail(newVisibilityItem.mediaId);
    assert.equal(replacedDetail?.episodes.length, 1, "detail lists current files only");
    assert.equal(replacedDetail?.episodes[0]?.mediaId, newVisibilityItem.mediaId);
    assert.equal(JSON.stringify(replacedDetail).includes(visibilityRoot), false);
    const replacedWorks = await visibilityDb.listCollections({ page: 1, pageSize: 10, sourceId: replacedScan.sourceId });
    assert.equal(replacedWorks.totalCount, 1);
    assert.equal(replacedWorks.items[0]?.episodeCount, 1, "a tombstone never inflates the work's episode count");
    assert.equal(replacedWorks.items[0]?.availableEpisodeCount, 1);
    assert.equal(replacedWorks.items[0]?.representativeMediaId, newVisibilityItem.mediaId);
    assert.equal(replacedWorks.items[0]?.watchedEpisodeCount, 0);
    const replacedSource = (await visibilityDb.getState()).sources.find((source) => source.sourceId === replacedScan.sourceId);
    assert.equal(replacedSource?.itemCount, 1, "the folder card counts current files, not tombstones");
    await visibilityDb.close();

    // Ticket 07: one file failing to index is not a deletion. A trigger makes the
    // per-file write fail the way an NFO parse or SQLITE error would.
    const resilientDbPath = join(profile, "index-failure.sqlite");
    const resilientRoot = join(profile, "index-failure-fixture");
    await mkdir(resilientRoot, { recursive: true });
    for (const title of ["Index Good One", "Index Broken", "Index Good Two"]) {
      await writeFile(join(resilientRoot, `${title}.mkv`), Buffer.from(`index failure fixture ${title}`));
    }
    const resilientDb = new LocalLibraryDatabase({ dbPath: resilientDbPath, workerPath });
    await resilientDb.start();
    const resilientScan = await resilientDb.scanFolder(resilientRoot);
    assert.equal(resilientScan.status, "completed");
    assert.equal(resilientScan.importedFiles, 3);
    const resilientItems = (await resilientDb.list({ page: 1, pageSize: 10, sourceId: resilientScan.sourceId })).items;
    const brokenItem = resilientItems.find((item) => item.title === "Index Broken");
    assert.ok(brokenItem, "the failing fixture was indexed once");
    await recordViewingSession(resilientDb, brokenItem.mediaId, {
      startedAtMs: 30_000,
      playedSec: 90,
      wallSec: 100,
      endPositionSec: 90,
      durationSec: 600,
      completed: false,
      closeReason: "user-close",
    });
    assert.equal((await resilientDb.getViewingHistory(brokenItem.mediaId))?.openCount, 1);
    const resilientSqlite = openSqlite(resilientDbPath);
    try {
      resilientSqlite.exec(`
        CREATE TRIGGER fail_index_broken BEFORE UPDATE ON media_files
        WHEN NEW.relative_path = 'Index Broken.mkv'
        BEGIN SELECT RAISE(ABORT, 'injected index failure'); END;
      `);
    } finally {
      resilientSqlite.close();
    }
    const resilientRescan = await resilientDb.scanFolder(resilientRoot);
    assert.equal(resilientRescan.status, "completed", "a per-file index failure does not fail the whole scan");
    assert.equal(resilientRescan.warningCount > 0, true, "the failure is reported as a scan warning");
    assert.equal(resilientRescan.updatedFiles, 2, "the two healthy files were still refreshed");
    assert.equal((await resilientDb.getViewingHistory(brokenItem.mediaId))?.openCount, 1, "a failed index attempt never deletes the viewing ledger");
    assert.equal((await resilientDb.get(brokenItem.mediaId))?.available, true, "the failed file keeps its current row");
    // Ticket 10: a load failure never completes, even when its resume position
    // is above 90%; only real playback or the player's `ended` completes.
    await recordViewingSession(resilientDb, brokenItem.mediaId, {
      startedAtMs: 40_000,
      playedSec: 400,
      wallSec: 410,
      endPositionSec: 580,
      durationSec: 600,
      completed: false,
      closeReason: "error",
    });
    const failedLoadHistory = await resilientDb.getViewingHistory(brokenItem.mediaId);
    assert.equal(failedLoadHistory?.openCount, 2);
    assert.equal(failedLoadHistory?.completedCount, 0, "a failed load never counts as a completed watch");
    const resilientCheck = openSqlite(resilientDbPath);
    try {
      const row = resilientCheck.prepare("SELECT available FROM media_files WHERE media_id = ?").get(brokenItem.mediaId) as { available?: number } | undefined;
      assert.equal(Number(row?.available), 1, "reconcile does not mark an unindexed-but-present file unavailable");
      resilientCheck.exec("DROP TRIGGER IF EXISTS fail_index_broken;");
    } finally {
      resilientCheck.close();
    }
    await resilientDb.close();

    // Ticket 23a: a directory-scoped rescan traverses only the requested
    // directories and reports imported/updated/unchanged/removed derived from
    // the stored rows, not from "files seen again".
    const scopeDbPath = join(profile, "scan-scope.sqlite");
    const scopeRoot = join(profile, "scan-scope-fixture");
    const scopeDirectoryA = join(scopeRoot, "A-dir");
    const scopeDirectoryB = join(scopeRoot, "B-dir");
    await mkdir(scopeDirectoryA, { recursive: true });
    await mkdir(scopeDirectoryB, { recursive: true });
    const scopeKeepA = join(scopeDirectoryA, "A Keep.mkv");
    const scopeEditA = join(scopeDirectoryA, "A Edit.mkv");
    const scopeDeleteA = join(scopeDirectoryA, "A Delete.mkv");
    const scopeKeepB = join(scopeDirectoryB, "B Keep.mkv");
    for (const filePath of [scopeKeepA, scopeEditA, scopeDeleteA, scopeKeepB]) {
      await writeFile(filePath, Buffer.from("scan scope fixture"));
    }
    await writeFile(join(scopeDirectoryA, "A Edit.nfo"), "<movie><title>A Edit Before</title><year>2020</year></movie>");
    await writeFile(join(scopeDirectoryB, "B Keep.nfo"), "<movie><title>B Keep Before</title><year>2021</year></movie>");
    const scopeDb = new LocalLibraryDatabase({ dbPath: scopeDbPath, workerPath });
    await scopeDb.start();
    const scopeBaseline = await scopeDb.scanFolder(scopeRoot);
    assert.equal(scopeBaseline.status, "completed");
    assert.deepEqual(scopeBaseline.counts, { imported: 4, updated: 0, unchanged: 0, removed: 0 }, "a first scan imports every file and reports no phantom updates");
    assert.equal(scopeBaseline.nfoUpdatedFiles, 0);
    assert.equal(scopeBaseline.fingerprintReplacedFiles, 0);
    // Ticket 23b: the coarse filter reads the known directory inventory from
    // the owner. It is the source root (so a new top-level folder changes the
    // root's mtime) plus every stored media file's parent directory.
    const scopeDirectoryInventory = (await scopeDb.listScanDirectories()).find((source) => source.sourceId === scopeBaseline.sourceId);
    assert.ok(scopeDirectoryInventory, "every registered source has a directory inventory");
    assert.deepEqual(scopeDirectoryInventory.relativeDirectories, ["", "A-dir", "B-dir"], "known directories are the root plus each media parent, sorted and unique");
    assert.equal(JSON.stringify(scopeDirectoryInventory).includes(scopeRoot), false, "the inventory carries source-relative directories only");
    const scopeBaselineItems = (await scopeDb.list({ page: 1, pageSize: 20, sourceId: scopeBaseline.sourceId })).items;
    const scopeItem = (title: string) => {
      const item = scopeBaselineItems.find((candidate) => candidate.title === title);
      if (!item) throw new Error(`scan scope fixture item ${title} was not indexed`);
      return item;
    };
    const scopeKeepAItem = scopeItem("A Keep");
    const scopeEditAItem = scopeItem("A Edit Before");
    const scopeDeleteAItem = scopeItem("A Delete");
    const scopeKeepBItem = scopeItem("B Keep Before");
    await scopeDb.savePlayback(scopeEditAItem.mediaId, { positionSec: 300, durationSec: 1_200, watched: false, updatedAtMs: Date.now() });
    await recordViewingSession(scopeDb, scopeEditAItem.mediaId, {
      startedAtMs: 50_000,
      playedSec: 120,
      wallSec: 130,
      endPositionSec: 300,
      durationSec: 1_200,
      completed: false,
      closeReason: "user-close",
    });
    await scopeDb.savePlayback(scopeKeepBItem.mediaId, { positionSec: 77, durationSec: 900, watched: false, updatedAtMs: Date.now() });
    const scopeFactsBefore = openSqlite(scopeDbPath);
    let scopeKeepBUpdatedAt = 0;
    let scopeKeepBCollectionUpdatedAt = 0;
    try {
      scopeKeepBUpdatedAt = Number((scopeFactsBefore.prepare("SELECT updated_at AS updatedAt FROM media_files WHERE media_id = ?").get(scopeKeepBItem.mediaId) as { updatedAt?: number } | undefined)?.updatedAt);
      scopeKeepBCollectionUpdatedAt = Number((scopeFactsBefore.prepare("SELECT updated_at AS updatedAt FROM collections WHERE collection_id = ?").get(scopeKeepBItem.collectionId) as { updatedAt?: number } | undefined)?.updatedAt);
    } finally {
      scopeFactsBefore.close();
    }
    await writeFile(join(scopeDirectoryA, "A Edit.nfo"), "<movie><title>A Edit After</title><year>2025</year><plot>Edited plot.</plot><rating>9.1</rating></movie>");
    await writeFile(join(scopeDirectoryA, "A New.mkv"), Buffer.from("scan scope new fixture"));
    await rm(scopeDeleteA);
    // A change in the directory that is not rescanned must stay unapplied.
    await writeFile(join(scopeDirectoryB, "B Keep.nfo"), "<movie><title>B Keep After</title><year>2026</year></movie>");
    const scopeProgressStatuses: string[] = [];
    const unsubscribeScopeProgress = scopeDb.onScanProgress((progress) => scopeProgressStatuses.push(progress.status));
    const scopeRescan = await scopeDb.scanDirectories(scopeBaseline.sourceId, ["A-dir"]);
    unsubscribeScopeProgress();
    assert.equal(scopeRescan.status, "completed");
    assert.equal(scopeRescan.scannedFiles, 3, "only the requested directory's current files are traversed");
    assert.equal(scopeProgressStatuses.includes("running"), true, "a directory rescan streams the same progress events");
    assert.equal(scopeProgressStatuses.at(-1), "completed");
    assert.deepEqual(scopeRescan.counts, { imported: 1, updated: 1, unchanged: 1, removed: 1 }, "the four counts compare stored rows with what this run saw");
    assert.equal(scopeRescan.nfoUpdatedFiles, 1, "the NFO edit is reported as an NFO-only change");
    assert.equal(scopeRescan.fingerprintReplacedFiles, 0);
    assert.equal(scopeRescan.importedFiles, 1, "the existing per-file counter keeps counting created rows");
    assert.equal(scopeRescan.updatedFiles, 2, "the existing streaming counter keeps counting re-seen rows");
    const scopeItemsAfterRescan = (await scopeDb.list({ page: 1, pageSize: 20, sourceId: scopeBaseline.sourceId })).items;
    const scopeAfter = (title: string) => {
      const item = scopeItemsAfterRescan.find((candidate) => candidate.title === title);
      if (!item) throw new Error(`scan scope fixture item ${title} was not indexed after the rescan`);
      return item;
    };
    const scopeEditAfter = scopeAfter("A Edit After");
    assert.equal(scopeEditAfter.mediaId, scopeEditAItem.mediaId, "an NFO-only change keeps the stored identity");
    assert.equal((await scopeDb.getPlayback(scopeEditAfter.mediaId))?.positionSec, 300, "an NFO-only change keeps playback progress");
    assert.equal((await scopeDb.getViewingHistory(scopeEditAfter.mediaId))?.openCount, 1, "an NFO-only change keeps the viewing history");
    assert.equal(scopeAfter("A New").available, true, "the added file is listed");
    assert.equal((await scopeDb.get(scopeDeleteAItem.mediaId))?.available, false, "the deleted file's row becomes unavailable");
    assert.equal((await scopeDb.get(scopeKeepAItem.mediaId))?.title, "A Keep", "an unchanged row keeps its identity and data");
    const scopeKeepBAfter = await scopeDb.get(scopeKeepBItem.mediaId);
    assert.equal(scopeKeepBAfter?.title, "B Keep Before", "a directory outside the scan scope is never re-parsed");
    assert.equal(scopeKeepBAfter?.year, 2021);
    assert.equal(scopeKeepBAfter?.available, true);
    assert.equal((await scopeDb.getPlayback(scopeKeepBItem.mediaId))?.positionSec, 77, "the unscanned directory keeps its progress");
    const scopeFactsAfter = openSqlite(scopeDbPath);
    try {
      assert.equal(
        Number((scopeFactsAfter.prepare("SELECT updated_at AS updatedAt FROM media_files WHERE media_id = ?").get(scopeKeepBItem.mediaId) as { updatedAt?: number } | undefined)?.updatedAt),
        scopeKeepBUpdatedAt,
        "the unscanned directory's rows are never written",
      );
      assert.equal(
        Number((scopeFactsAfter.prepare("SELECT updated_at AS updatedAt FROM collections WHERE collection_id = ?").get(scopeKeepBItem.collectionId) as { updatedAt?: number } | undefined)?.updatedAt),
        scopeKeepBCollectionUpdatedAt,
        "the unscanned directory's work is never written",
      );
      const scopeRun = scopeFactsAfter.prepare("SELECT completed, error FROM scan_runs WHERE scan_id = ?").get(scopeRescan.scanId) as { completed?: number; error?: string | null } | undefined;
      assert.equal(Number(scopeRun?.completed), 1, "the directory rescan reuses the existing Scan run record");
      assert.equal(scopeRun?.error, null);
    } finally {
      scopeFactsAfter.close();
    }

    // Ticket 23a: a changed video fingerprint keeps the existing semantics —
    // the old row becomes a tombstone, a new identity is created and progress is
    // not inherited — and is reported separately from an NFO-only edit.
    await scopeDb.savePlayback(scopeKeepAItem.mediaId, { positionSec: 123, durationSec: 900, watched: false, updatedAtMs: Date.now() });
    await writeFile(scopeKeepA, Buffer.from("scan scope fixture replaced with new bytes"));
    await utimes(scopeKeepA, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
    const scopeReplaced = await scopeDb.scanDirectories(scopeBaseline.sourceId, ["A-dir"]);
    assert.equal(scopeReplaced.status, "completed");
    assert.deepEqual(scopeReplaced.counts, { imported: 1, updated: 0, unchanged: 2, removed: 1 });
    assert.equal(scopeReplaced.fingerprintReplacedFiles, 1, "a changed fingerprint is reported as a replacement, not an update");
    assert.equal(scopeReplaced.nfoUpdatedFiles, 0);
    const scopeReplacedItems = (await scopeDb.list({ page: 1, pageSize: 20, sourceId: scopeBaseline.sourceId })).items;
    const scopeReplacedKeepA = scopeReplacedItems.find((item) => item.title === "A Keep");
    assert.ok(scopeReplacedKeepA, "the replacement is listed as one current card");
    assert.notEqual(scopeReplacedKeepA.mediaId, scopeKeepAItem.mediaId, "a changed fingerprint is a new opaque identity");
    assert.equal((await scopeDb.get(scopeKeepAItem.mediaId))?.available, false, "the superseded identity becomes unavailable");
    assert.equal(await scopeDb.getPlayback(scopeReplacedKeepA.mediaId), undefined, "a replaced identity never inherits progress");
    assert.equal((await scopeDb.getPlayback(scopeKeepAItem.mediaId))?.positionSec, 123, "the superseded identity keeps its own progress row");

    // Ticket 23a: an illegal, escaping, absolute or missing relative directory
    // is rejected without an unhandled exception and without touching the
    // library; the worker still answers a valid scope afterwards.
    const scopeRowsBeforeRejects = (await scopeDb.list({ page: 1, pageSize: 50, sourceId: scopeBaseline.sourceId })).totalCount;
    for (const invalidScope of ["../outside", "A-dir/../../escape", "Missing Directory", scopeDirectoryA]) {
      await assert.rejects(
        () => scopeDb.scanDirectories(scopeBaseline.sourceId, [invalidScope]),
        (error: unknown) => error instanceof Error && !error.message.includes(scopeRoot) && !error.message.includes(profile),
        `the invalid scope ${JSON.stringify(invalidScope)} is rejected without leaking the source root`,
      );
    }
    await assert.rejects(
      () => scopeDb.scanDirectories(scopeBaseline.sourceId, ["A-dir", "../escape"]),
      /相对目录/u,
      "one illegal directory rejects the whole scope",
    );
    await assert.rejects(
      () => scopeDb.scanDirectories(scopeBaseline.sourceId, []),
      /至少需要一个相对目录/u,
      "an empty scope is rejected instead of silently rescanning nothing",
    );
    await assert.rejects(
      () => scopeDb.scanDirectories("source_11111111-2222-4333-8444-555555555555", ["A-dir"]),
      /来源不存在/u,
      "an unknown source is rejected instead of creating one",
    );
    assert.equal(
      (await scopeDb.list({ page: 1, pageSize: 50, sourceId: scopeBaseline.sourceId })).totalCount,
      scopeRowsBeforeRejects,
      "a rejected scope never changes library rows",
    );
    const scopeAfterRejects = await scopeDb.scanDirectories(scopeBaseline.sourceId, ["A-dir"]);
    assert.equal(scopeAfterRejects.status, "completed", "the worker still answers a valid scope after rejections");
    assert.deepEqual(scopeAfterRejects.counts, { imported: 0, updated: 0, unchanged: 3, removed: 0 });
    await scopeDb.close();

    // Ticket 23a: an incomplete directory never confirms deletion inside it,
    // while a fully scanned sibling directory still reconciles.
    const partialScopeRoot = join(profile, "scan-scope-partial-fixture");
    const partialScopeA = join(partialScopeRoot, "A-dir");
    const partialScopeB = join(partialScopeRoot, "B-dir");
    const partialScopeNested = join(partialScopeA, "z-nested");
    await mkdir(partialScopeNested, { recursive: true });
    await mkdir(partialScopeB, { recursive: true });
    await writeFile(join(partialScopeA, "00-visible.mkv"), Buffer.from("partial scope visible"));
    await writeFile(join(partialScopeNested, "01-nested.mkv"), Buffer.from("partial scope nested"));
    await writeFile(join(partialScopeB, "B-old.mkv"), Buffer.from("partial scope deleted sibling"));
    const partialScopeDb = new LocalLibraryDatabase({ dbPath: join(profile, "scan-scope-partial.sqlite"), workerPath });
    await partialScopeDb.start();
    const partialScopeBaseline = await partialScopeDb.scanFolder(partialScopeRoot);
    assert.equal(partialScopeBaseline.status, "completed");
    assert.deepEqual(partialScopeBaseline.counts, { imported: 3, updated: 0, unchanged: 0, removed: 0 });
    const partialScopeItems = (await partialScopeDb.list({ page: 1, pageSize: 20, sourceId: partialScopeBaseline.sourceId })).items;
    const partialNestedItem = partialScopeItems.find((item) => item.title === "01-nested");
    const partialSiblingItem = partialScopeItems.find((item) => item.title === "B-old");
    assert.ok(partialNestedItem && partialSiblingItem, "the partial scope fixture was indexed");
    await rm(join(partialScopeB, "B-old.mkv"));
    let partialScopeNestedRemoved = false;
    const unsubscribePartialScope = partialScopeDb.onScanProgress((progress) => {
      if (!partialScopeNestedRemoved && progress.status === "running" && progress.scannedFiles === 1) {
        partialScopeNestedRemoved = true;
        rmSync(partialScopeNested, { recursive: true, force: true });
      }
    });
    const partialScopeScan = await partialScopeDb.scanDirectories(partialScopeBaseline.sourceId, ["A-dir", "B-dir"]);
    unsubscribePartialScope();
    assert.equal(partialScopeScan.status, "partial", "an unreadable directory makes the rescan partial");
    assert.equal(partialScopeScan.counts.removed, 1, "only the fully scanned directory confirms a deletion");
    assert.equal(
      (await partialScopeDb.get(partialNestedItem.mediaId))?.available,
      true,
      "an unseen file in an incomplete directory is never tombstoned",
    );
    assert.equal(
      (await partialScopeDb.get(partialSiblingItem.mediaId))?.available,
      false,
      "a fully scanned sibling directory still reconciles",
    );
    assert.equal(
      (await partialScopeDb.getState()).sources.find((source) => source.sourceId === partialScopeBaseline.sourceId)?.degraded,
      true,
      "an incomplete directory rescan never claims the source is proven complete",
    );
    await partialScopeDb.close();

    // Ticket 23b: the mtime coarse filter only scans changed directories, never
    // produces an observable scan for an unchanged library, and its persisted
    // baseline still detects a change made while the app was closed (a fresh
    // scheduler with the same sidecar is the process restart).
    const refreshRoot = join(profile, "refresh-fixture");
    const refreshA = join(refreshRoot, "A-dir");
    const refreshB = join(refreshRoot, "B-dir");
    await mkdir(refreshA, { recursive: true });
    await mkdir(refreshB, { recursive: true });
    await writeFile(join(refreshA, "Refresh A.mkv"), Buffer.from("refresh a fixture"));
    await writeFile(join(refreshB, "Refresh B.mkv"), Buffer.from("refresh b fixture"));
    await writeFile(join(refreshA, "Refresh A.nfo"), "<movie><title>Refresh A Before</title></movie>");
    await writeFile(join(refreshB, "Refresh B.nfo"), "<movie><title>Refresh B Before</title></movie>");
    const refreshDb = new LocalLibraryDatabase({ dbPath: join(profile, "refresh.sqlite"), workerPath });
    await refreshDb.start();
    const refreshScan = await refreshDb.scanFolder(refreshRoot);
    assert.equal(refreshScan.status, "completed");
    const refreshInventory = (await refreshDb.listScanDirectories()).find((source) => source.sourceId === refreshScan.sourceId);
    assert.deepEqual(refreshInventory?.relativeDirectories, ["", "A-dir", "B-dir"], "the fixture exposes the root and both media parents");
    const refreshCalls: Array<{ sourceId: string; directories: string[] }> = [];
    const refreshPort: LocalRefreshDatabasePort = {
      listScanDirectories: () => refreshDb.listScanDirectories(),
      sourceRoot: (sourceId) => refreshDb.sourceRoot(sourceId),
      scanDirectories: (sourceId, directories) => {
        refreshCalls.push({ sourceId, directories: [...directories] });
        return refreshDb.scanDirectories(sourceId, directories);
      },
    };
    const refreshBaselinePath = join(profile, "user-data", "local-library", "directory-mtime.json");
    const makeRefreshScheduler = () => new LocalLibraryRefreshScheduler(refreshPort, refreshBaselinePath, { throttleMs: 0, now: () => Date.now() });
    const refreshResults: LocalLibraryRefreshResult[] = [];
    const refreshScheduler = makeRefreshScheduler();
    refreshScheduler.onResult((result) => refreshResults.push(result));
    await refreshScheduler.recordBaselineForSource(refreshScan.sourceId);
    const refreshProgressStatuses: string[] = [];
    const unsubscribeRefreshProgress = refreshDb.onScanProgress((progress) => refreshProgressStatuses.push(progress.status));
    assert.deepEqual(await refreshScheduler.request("focus", { force: true }), { status: "unchanged" }, "an unchanged library reports unchanged");
    unsubscribeRefreshProgress();
    assert.deepEqual(refreshCalls, [], "no directory is handed to the rescan when nothing changed");
    assert.deepEqual(refreshProgressStatuses, [], "an unchanged check emits no scan progress, so the status line cannot flicker");
    assert.equal(refreshResults.length, 0, "an unchanged check pushes no result");
    const refreshBaselineText = await readFile(refreshBaselinePath, "utf8");
    assert.equal(refreshBaselineText.includes(profile), false, "the baseline sidecar stores source-relative directories, never an absolute path");
    const refreshNfoA = join(refreshA, "Refresh A.nfo");
    await writeFile(refreshNfoA, "<movie><title>Refresh A After</title></movie>");
    await utimes(refreshNfoA, new Date(Date.now() + 5_000), new Date(Date.now() + 5_000));
    assert.deepEqual(await refreshScheduler.request("focus", { force: true }), { status: "refreshed" }, "an NFO edit is detected on the next check");
    assert.deepEqual(refreshCalls, [{ sourceId: refreshScan.sourceId, directories: ["A-dir"] }], "only the edited directory is rescanned");
    assert.equal(refreshResults.length, 1);
    assert.equal(refreshResults[0]?.trigger, "focus");
    assert.deepEqual(refreshResults[0]?.counts, { imported: 0, updated: 1, unchanged: 0, removed: 0 }, "the result carries the precise updated count, not the re-seen counter");
    assert.equal(refreshResults[0]?.nfoUpdatedFiles, 1, "an NFO-only change stays separable from a video replacement");
    assert.equal((await refreshDb.list({ page: 1, pageSize: 20, sourceId: refreshScan.sourceId, query: "Refresh A After" })).totalCount, 1, "the rescan applied the edited title");
    assert.equal((await refreshDb.list({ page: 1, pageSize: 20, sourceId: refreshScan.sourceId, query: "Refresh B Before" })).totalCount, 1, "the untouched directory keeps its title");
    refreshScheduler.dispose();
    // Restart: a different scheduler instance reads the sidecar above, so a
    // change written while the app was closed is still detected.
    const refreshNfoB = join(refreshB, "Refresh B.nfo");
    await writeFile(refreshNfoB, "<movie><title>Refresh B After</title></movie>");
    await utimes(refreshNfoB, new Date(Date.now() + 6_000), new Date(Date.now() + 6_000));
    const restartScheduler = makeRefreshScheduler();
    const restartResults: LocalLibraryRefreshResult[] = [];
    restartScheduler.onResult((result) => restartResults.push(result));
    assert.deepEqual(await restartScheduler.request("focus", { force: true }), { status: "refreshed" }, "a fresh scheduler still detects a change from the persisted baseline");
    assert.deepEqual(refreshCalls, [
      { sourceId: refreshScan.sourceId, directories: ["A-dir"] },
      { sourceId: refreshScan.sourceId, directories: ["B-dir"] },
    ], "the restart rescans only the directory changed while the app was closed");
    assert.deepEqual(restartResults[0]?.counts, { imported: 0, updated: 1, unchanged: 0, removed: 0 });
    assert.equal((await refreshDb.list({ page: 1, pageSize: 20, sourceId: refreshScan.sourceId, query: "Refresh B After" })).totalCount, 1, "the restart applied the offline edit");
    restartScheduler.dispose();
    await refreshDb.close();

    // Ticket 07: an import never runs concurrently with a scan.
    const guardRoot = join(profile, "import-guard-fixture");
    await mkdir(guardRoot, { recursive: true });
    for (let index = 0; index < 30; index += 1) await writeFile(join(guardRoot, `guard-${index}.mkv`), Buffer.from(`import guard ${index}`));
    const guardDb = new LocalLibraryDatabase({ dbPath: join(profile, "import-guard.sqlite"), workerPath });
    await guardDb.start();
    let guardImport: Promise<{ ok: boolean; message?: string }> | undefined;
    const unsubscribeGuard = guardDb.onScanProgress((progress) => {
      if (!guardImport && progress.status === "running" && progress.scannedFiles === 1) {
        guardImport = guardDb.importVideo(join(guardRoot, "guard-5.mkv"), guardRoot).then(
          () => ({ ok: true }),
          (error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }),
        );
      }
    });
    const guardScan = await guardDb.scanFolder(guardRoot);
    unsubscribeGuard();
    assert.equal(guardScan.status, "completed");
    if (!guardImport) throw new Error("scan progress never reached the import guard");
    const guardOutcome = await guardImport;
    assert.equal(guardOutcome.ok, false, "an import during a scan is rejected instead of racing it");
    assert.match(guardOutcome.message ?? "", /扫描正在进行/u);
    await guardDb.close();

    // Ticket 07: a scan run that never finished is closed as interrupted on the
    // next initialization, and its source stays degraded until a successful scan
    // re-reconciles.
    const scanRunDbPath = join(profile, "scan-run-recovery.sqlite");
    const scanRunRoot = join(profile, "scan-run-recovery-fixture");
    await mkdir(scanRunRoot, { recursive: true });
    await writeFile(join(scanRunRoot, "Interrupted Scan Movie.mkv"), Buffer.from("interrupted scan fixture"));
    const scanRunDb = new LocalLibraryDatabase({ dbPath: scanRunDbPath, workerPath });
    await scanRunDb.start();
    const scanRunScan = await scanRunDb.scanFolder(scanRunRoot);
    await scanRunDb.close();
    const scanRunSqlite = openSqlite(scanRunDbPath);
    try {
      const generation = Number((scanRunSqlite.prepare("SELECT COALESCE(MAX(generation), 0) AS generation FROM scan_runs WHERE source_id = ?").get(scanRunScan.sourceId) as { generation?: number } | undefined)?.generation ?? 0) + 1;
      scanRunSqlite.prepare("INSERT INTO scan_runs (scan_id, source_id, generation, completed, started_at) VALUES (?, ?, ?, 0, ?)")
        .run("scan_11111111-2222-4333-8444-555555555555", scanRunScan.sourceId, generation, Date.now());
    } finally {
      scanRunSqlite.close();
    }
    const scanRunRecovered = new LocalLibraryDatabase({ dbPath: scanRunDbPath, workerPath });
    await scanRunRecovered.start();
    assert.equal(
      (await scanRunRecovered.getState()).sources.find((source) => source.sourceId === scanRunScan.sourceId)?.degraded,
      true,
      "an unfinished scan run degrades its source at startup",
    );
    const interruptedRun = openSqlite(scanRunDbPath);
    try {
      const row = interruptedRun.prepare("SELECT completed, error, completed_at AS completedAt FROM scan_runs WHERE scan_id = ?").get("scan_11111111-2222-4333-8444-555555555555") as { completed?: number; error?: string; completedAt?: number } | undefined;
      assert.equal(Number(row?.completed), 0, "an interrupted run never looks completed");
      assert.equal(row?.error, "interrupted");
      assert.equal(typeof row?.completedAt, "number", "the interrupted run is closed with a completion time");
    } finally {
      interruptedRun.close();
    }
    const scanRunRescan = await scanRunRecovered.scanFolder(scanRunRoot);
    assert.equal(scanRunRescan.status, "completed");
    assert.equal(
      (await scanRunRecovered.getState()).sources.find((source) => source.sourceId === scanRunScan.sourceId)?.degraded,
      false,
      "a complete scan clears the degraded flag",
    );
    await scanRunRecovered.close();

    // Ticket 13: an unexpected exit — including code 0 — must reject pending
    // work, stop reporting ready, and allow one controlled restart.
    const restartMarker = join(profile, "restart-worker-first-run.txt");
    const restartWorkerPath = join(profile, "restart-worker.js");
    await writeFile(restartWorkerPath, `
const fs = require("node:fs");
const markerPath = ${JSON.stringify(restartMarker)};
const port = process.parentPort;
if (!port) process.exit(1);
if (!fs.existsSync(markerPath)) {
  fs.writeFileSync(markerPath, "1");
  process.exit(0);
}
port.on("message", (event) => {
  const request = event.data;
  if (request.command === "initialize") {
    port.postMessage({ id: request.id, ok: true, result: { schemaVersion: ${LOCAL_LIBRARY_SCHEMA_VERSION}, sqliteAvailable: true, sources: [] } });
  } else if (request.command === "list") {
    port.postMessage({ id: request.id, ok: true, result: { totalCount: 0, items: [] } });
  } else if (request.command === "close") {
    port.postMessage({ id: request.id, ok: true, result: undefined });
  }
});
`);
    const restartDb = new LocalLibraryDatabase({ dbPath: join(profile, "restart.sqlite"), workerPath: restartWorkerPath });
    const restartStateEvents: string[] = [];
    const unsubscribeRestartState = restartDb.onState((next) => restartStateEvents.push(next.status));
    await assert.rejects(() => restartDb.start(), "a worker that exits before initialize never becomes ready");
    const crashedState = restartDb.getState();
    assert.equal(crashedState.status, "error", "an unexpected exit stops reporting ready");
    assert.equal(crashedState.sqliteAvailable, false);
    assert.equal(typeof crashedState.error?.message, "string", "the crashed state carries a readable message");
    assert.equal(restartStateEvents.includes("error"), true, "state listeners were notified about the crash");
    const restartedPage = await withDeadline(restartDb.list({ page: 1, pageSize: 10 }), 10_000, "restart list");
    assert.equal(restartedPage.totalCount, 0);
    assert.equal(restartDb.getState().status, "ready", "one controlled restart restores the ready state");
    unsubscribeRestartState();
    await restartDb.close();

    // Ticket 13: a worker that never answers rejects the call instead of leaving
    // the renderer's busy state forever.
    const hangingWorkerPath = join(profile, "hanging-worker.js");
    await writeFile(hangingWorkerPath, `
const port = process.parentPort;
if (!port) process.exit(1);
port.on("message", (event) => {
  const request = event.data;
  if (request.command === "initialize") {
    port.postMessage({ id: request.id, ok: true, result: { schemaVersion: ${LOCAL_LIBRARY_SCHEMA_VERSION}, sqliteAvailable: true, sources: [] } });
  } else if (request.command === "close") {
    port.postMessage({ id: request.id, ok: true, result: undefined });
  }
});
`);
    const hangingDb = new LocalLibraryDatabase({ dbPath: join(profile, "hanging.sqlite"), workerPath: hangingWorkerPath, callTimeoutMs: 3_000 });
    assert.equal((await hangingDb.start()).status, "ready", "the stub answers initialization");
    await assert.rejects(
      () => withDeadline(hangingDb.list({ page: 1, pageSize: 10 }), 10_000, "timed-out call"),
      /本地片库/u,
      "a wedged worker rejects the call with a readable error instead of hanging",
    );
    await hangingDb.close();

    // v2 → v3 migration: an existing v2 database gains the two ledger tables
    // without touching its rows, and re-opening is idempotent.
    const versionTwoPath = join(profile, "version-two.sqlite");
    const v2Snapshot = openSqlite(dbPath);
    try {
      v2Snapshot.exec(`VACUUM INTO '${versionTwoPath.replace(/'/g, "''")}'`);
    } finally {
      v2Snapshot.close();
    }
    const v2 = openSqlite(versionTwoPath);
    try {
      v2.exec("DROP TABLE IF EXISTS media_history;");
      v2.exec("DROP TABLE IF EXISTS viewing_sessions;");
      v2.exec("PRAGMA user_version = 2;");
    } finally {
      v2.close();
    }
    const v2Db = new LocalLibraryDatabase({ dbPath: versionTwoPath, workerPath });
    assert.equal((await v2Db.start()).schemaVersion, 5, "a v2 database migrates through v3/v4 to the current v5 schema");
    await v2Db.close();
    const v3 = openSqlite(versionTwoPath);
    try {
      const version = v3.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      assert.equal(Number(version?.user_version), 5);
      const tables = v3.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('viewing_sessions', 'media_history') ORDER BY name").all() as Array<{ name?: string }>;
      assert.deepEqual(tables.map((row) => row.name), ["media_history", "viewing_sessions"], "the v3 step of the migration creates both ledger tables");
    } finally {
      v3.close();
    }
    const v2Again = new LocalLibraryDatabase({ dbPath: versionTwoPath, workerPath });
    assert.equal((await v2Again.start()).schemaVersion, 5, "re-running the v2 → v5 migration is idempotent");
    await v2Again.close();

    // v3 → v4 (Ticket 08): an existing v3 database gains sources.degraded with
    // default 0, keeps every row and viewing record, and re-running is a no-op.
    // v5 (Ticket 22a) then adds the markers table in the same idempotent pass.
    const versionThreePath = join(profile, "version-three.sqlite");
    const v3Snapshot = openSqlite(dbPath);
    try {
      v3Snapshot.exec(`VACUUM INTO '${versionThreePath.replace(/'/g, "''")}'`);
    } finally {
      v3Snapshot.close();
    }
    let mediaRowsBeforeV4 = 0;
    let historyRowsBeforeV4 = 0;
    const v3Shaped = openSqlite(versionThreePath);
    try {
      v3Shaped.exec("ALTER TABLE sources DROP COLUMN degraded;");
      v3Shaped.exec("PRAGMA user_version = 3;");
      mediaRowsBeforeV4 = Number((v3Shaped.prepare("SELECT COUNT(*) AS count FROM media_files").get() as { count?: number } | undefined)?.count ?? 0);
      historyRowsBeforeV4 = Number((v3Shaped.prepare("SELECT COUNT(*) AS count FROM media_history").get() as { count?: number } | undefined)?.count ?? 0);
      const v3Columns = v3Shaped.prepare("PRAGMA table_info(sources)").all() as Array<{ name?: string }>;
      assert.equal(v3Columns.some((column) => column.name === "degraded"), false);
    } finally {
      v3Shaped.close();
    }
    const v3Db = new LocalLibraryDatabase({ dbPath: versionThreePath, workerPath });
    const v4State = await v3Db.start();
    assert.equal(v4State.schemaVersion, 5);
    assert.equal(v4State.sources.length > 0, true, "the migrated database keeps its sources");
    assert.equal(v4State.sources.every((source) => source.degraded === false), true, "pre-v4 rows read as not degraded");
    await v3Db.close();
    const v4File = openSqlite(versionThreePath);
    try {
      const version = v4File.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      assert.equal(Number(version?.user_version), 5);
      const columns = v4File.prepare("PRAGMA table_info(sources)").all() as Array<{ name?: string; dflt_value?: string | null; notnull?: number }>;
      const degraded = columns.find((column) => column.name === "degraded");
      assert.ok(degraded, "v4 migration adds sources.degraded");
      assert.equal(Number(degraded?.notnull), 1, "degraded is NOT NULL");
      assert.equal(String(degraded?.dflt_value), "0", "existing rows default to not degraded");
      assert.equal(Number((v4File.prepare("SELECT COUNT(*) AS count FROM media_files").get() as { count?: number } | undefined)?.count), mediaRowsBeforeV4, "migration never drops media rows");
      assert.equal(Number((v4File.prepare("SELECT COUNT(*) AS count FROM media_history").get() as { count?: number } | undefined)?.count), historyRowsBeforeV4, "migration never drops viewing history");
    } finally {
      v4File.close();
    }
    const v3Again = new LocalLibraryDatabase({ dbPath: versionThreePath, workerPath });
    assert.equal((await v3Again.start()).schemaVersion, 5, "re-running the v3 → v5 migration is idempotent");
    await v3Again.close();

    // v4 → v5 (Ticket 22a): an existing v4 database gains the markers table, keeps
    // every media row and viewing record, and re-opening it is a no-op.
    const versionFourPath = join(profile, "version-four.sqlite");
    const v4Snapshot = openSqlite(dbPath);
    try {
      v4Snapshot.exec(`VACUUM INTO '${versionFourPath.replace(/'/g, "''")}'`);
    } finally {
      v4Snapshot.close();
    }
    let mediaRowsBeforeV5 = 0;
    let historyRowsBeforeV5 = 0;
    const v4Shaped = openSqlite(versionFourPath);
    try {
      v4Shaped.exec("DROP TABLE IF EXISTS markers;");
      v4Shaped.exec("PRAGMA user_version = 4;");
      mediaRowsBeforeV5 = Number((v4Shaped.prepare("SELECT COUNT(*) AS count FROM media_files").get() as { count?: number } | undefined)?.count ?? 0);
      historyRowsBeforeV5 = Number((v4Shaped.prepare("SELECT COUNT(*) AS count FROM media_history").get() as { count?: number } | undefined)?.count ?? 0);
      assert.equal(mediaRowsBeforeV5 > 0, true, "the fixture database has media rows before the v5 step");
      const v4Tables = v4Shaped.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'markers'").all() as Array<{ name?: string }>;
      assert.deepEqual(v4Tables, [], "a v4 database has no markers table");
    } finally {
      v4Shaped.close();
    }
    const v4Db = new LocalLibraryDatabase({ dbPath: versionFourPath, workerPath });
    assert.equal((await v4Db.start()).schemaVersion, 5);
    await v4Db.close();
    const v5File = openSqlite(versionFourPath);
    try {
      const version = v5File.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      assert.equal(Number(version?.user_version), 5);
      const tables = v5File.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'markers'").all() as Array<{ name?: string }>;
      assert.deepEqual(tables.map((row) => row.name), ["markers"], "the v5 step creates the markers table");
      assert.equal(Number((v5File.prepare("SELECT COUNT(*) AS count FROM media_files").get() as { count?: number } | undefined)?.count), mediaRowsBeforeV5, "migration never drops media rows");
      assert.equal(Number((v5File.prepare("SELECT COUNT(*) AS count FROM media_history").get() as { count?: number } | undefined)?.count), historyRowsBeforeV5, "migration never drops viewing history");
      const columns = v5File.prepare("PRAGMA table_info(markers)").all() as Array<{ name?: string; notnull?: number }>;
      assert.deepEqual(columns.map((column) => column.name), ["media_id", "position_sec", "created_at"], "the marker table stores only the opaque id, position and creation time");
    } finally {
      v5File.close();
    }
    const v4Again = new LocalLibraryDatabase({ dbPath: versionFourPath, workerPath });
    assert.equal((await v4Again.start()).schemaVersion, 5, "re-running the v4 → v5 migration is idempotent");
    await v4Again.close();

    const legacyPath = join(profile, "legacy-v1.sqlite");
    const snapshot = openSqlite(dbPath);
    try {
      snapshot.exec(`VACUUM INTO '${legacyPath.replace(/'/g, "''")}'`);
    } finally {
      snapshot.close();
    }
    const legacy = openSqlite(legacyPath);
    try {
      legacy.exec("DROP INDEX IF EXISTS collections_premiered_at;");
      legacy.exec("ALTER TABLE collections DROP COLUMN premiered_at;");
      legacy.exec("ALTER TABLE sources DROP COLUMN degraded;");
      legacy.exec("DROP TABLE IF EXISTS markers;");
      legacy.exec("PRAGMA user_version = 1;");
      const legacyVersion = legacy.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      assert.equal(Number(legacyVersion?.user_version), 1);
      const legacyColumns = legacy.prepare("PRAGMA table_info(collections)").all() as Array<{ name?: string }>;
      assert.equal(legacyColumns.some((column) => column.name === "premiered_at"), false);
    } finally {
      legacy.close();
    }
    const legacyDb = new LocalLibraryDatabase({ dbPath: legacyPath, workerPath });
    assert.equal((await legacyDb.start()).schemaVersion, 5);
    const migratedPage = await legacyDb.list({ page: 1, pageSize: 50, sort: "released_desc" });
    assert.equal(migratedPage.totalCount > 0, true);
    assert.equal(migratedPage.items.every((item) => item.premieredDate === null), true, "migration never guesses a date for old rows");
    await legacyDb.close();
    const migratedAgain = new LocalLibraryDatabase({ dbPath: legacyPath, workerPath });
    assert.equal((await migratedAgain.start()).schemaVersion, 5, "re-running the migration is idempotent");
    const migratedAgainPage = await migratedAgain.list({ page: 1, pageSize: 50, sort: "released_desc" });
    assert.equal(migratedAgainPage.totalCount, migratedPage.totalCount);
    assert.equal(migratedAgainPage.items.every((item) => item.premieredDate === null), true);
    await migratedAgain.close();
    const migratedDb = openSqlite(legacyPath);
    try {
      const version = migratedDb.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      assert.equal(Number(version?.user_version), 5);
      const columns = migratedDb.prepare("PRAGMA table_info(collections)").all() as Array<{ name?: string }>;
      assert.equal(columns.some((column) => column.name === "premiered_at"), true);
      const index = migratedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'collections_premiered_at'").get();
      assert.ok(index, "v2 migration creates the premiere-date index");
      const sourceColumns = migratedDb.prepare("PRAGMA table_info(sources)").all() as Array<{ name?: string }>;
      assert.equal(sourceColumns.some((column) => column.name === "degraded"), true, "v4 migration adds sources.degraded to a v1 database");
      const markerTable = migratedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'markers'").get();
      assert.ok(markerTable, "v5 migration adds the markers table to a v1 database");
    } finally {
      migratedDb.close();
    }
    process.stdout.write("PASS: local DB owner imported one fixture, reused stable opaque mediaId, listed without paths, resolved only in main owner, parsed real premiere dates, sorted released_desc with unknown dates last, split partial scans from offline sources, stored and deleted whole-second markers with restart/cascade/idempotent/rejection behavior, and migrated v1/v2/v3/v4 data without guessing dates or dropping rows\n");
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
