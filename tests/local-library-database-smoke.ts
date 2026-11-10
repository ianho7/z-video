import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "electron";

import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import { isOpaqueMediaId } from "../src/shared/local-library-contracts";
import { LocalLibraryDatabase } from "../src/main/local-library-database";

function openSqlite(filePath: string): DatabaseSyncType {
  const sqlite = require("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseSyncType };
  if (typeof sqlite.DatabaseSync !== "function") throw new Error("node:sqlite is unavailable");
  return new sqlite.DatabaseSync(filePath);
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
    assert.equal(state.schemaVersion, 3);

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
    assert.equal((await database.getPlayback(episodeId))?.audioTrackId, "audio-1");
    const updatedDetail = await database.getDetail(episodeId);
    assert.equal(updatedDetail?.playback?.mediaId, episodeId);
    assert.equal(updatedDetail?.playback?.positionSec, 42);
    assert.equal(updatedDetail?.playback?.audioTrackId, "audio-1");
    const continueWatching = await database.listContinueWatching();
    assert.equal(continueWatching.some((entry) => entry.item.mediaId === episodeId && entry.playback.positionSec === 42), true);

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
    assert.equal((await database.getState()).sources.find((source) => source.sourceId === partialDisconnect.sourceId)?.available, false);
    const partialItems = await database.list({ page: 1, pageSize: 50, sourceId: partialDisconnect.sourceId });
    assert.equal(partialItems.totalCount, 1);
    assert.equal(partialItems.items[0]?.title, "00-first");

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
    assert.equal(reopenedState.schemaVersion, 3);
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
    assert.equal((await v2Db.start()).schemaVersion, 3);
    await v2Db.close();
    const v3 = openSqlite(versionTwoPath);
    try {
      const version = v3.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      assert.equal(Number(version?.user_version), 3);
      const tables = v3.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('viewing_sessions', 'media_history') ORDER BY name").all() as Array<{ name?: string }>;
      assert.deepEqual(tables.map((row) => row.name), ["media_history", "viewing_sessions"], "v3 migration creates both ledger tables");
    } finally {
      v3.close();
    }
    const v2Again = new LocalLibraryDatabase({ dbPath: versionTwoPath, workerPath });
    assert.equal((await v2Again.start()).schemaVersion, 3, "re-running the v3 migration is idempotent");
    await v2Again.close();

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
      legacy.exec("PRAGMA user_version = 1;");
      const legacyVersion = legacy.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      assert.equal(Number(legacyVersion?.user_version), 1);
      const legacyColumns = legacy.prepare("PRAGMA table_info(collections)").all() as Array<{ name?: string }>;
      assert.equal(legacyColumns.some((column) => column.name === "premiered_at"), false);
    } finally {
      legacy.close();
    }
    const legacyDb = new LocalLibraryDatabase({ dbPath: legacyPath, workerPath });
    assert.equal((await legacyDb.start()).schemaVersion, 3);
    const migratedPage = await legacyDb.list({ page: 1, pageSize: 50, sort: "released_desc" });
    assert.equal(migratedPage.totalCount > 0, true);
    assert.equal(migratedPage.items.every((item) => item.premieredDate === null), true, "migration never guesses a date for old rows");
    await legacyDb.close();
    const migratedAgain = new LocalLibraryDatabase({ dbPath: legacyPath, workerPath });
    assert.equal((await migratedAgain.start()).schemaVersion, 3, "re-running the migration is idempotent");
    const migratedAgainPage = await migratedAgain.list({ page: 1, pageSize: 50, sort: "released_desc" });
    assert.equal(migratedAgainPage.totalCount, migratedPage.totalCount);
    assert.equal(migratedAgainPage.items.every((item) => item.premieredDate === null), true);
    await migratedAgain.close();
    const migratedDb = openSqlite(legacyPath);
    try {
      const version = migratedDb.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
      assert.equal(Number(version?.user_version), 3);
      const columns = migratedDb.prepare("PRAGMA table_info(collections)").all() as Array<{ name?: string }>;
      assert.equal(columns.some((column) => column.name === "premiered_at"), true);
      const index = migratedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'collections_premiered_at'").get();
      assert.ok(index, "v2 migration creates the premiere-date index");
    } finally {
      migratedDb.close();
    }
    process.stdout.write("PASS: local DB owner imported one fixture, reused stable opaque mediaId, listed without paths, resolved only in main owner, parsed real premiere dates, sorted released_desc with unknown dates last, and migrated v1 data without guessing dates\n");
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
