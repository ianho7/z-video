import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import { LocalLibraryDatabase } from "../src/main/local-library-database";

const itemCount = 23;
const cacheProbeCount = 520;

async function writeMovieFixture(root: string, index: number): Promise<void> {
  const directory = join(root, "movies", `Movie-${String(index + 1).padStart(2, "0")}`);
  await mkdir(directory, { recursive: true });
  const title = `Owned Movie ${index + 1}`;
  const artworkReferences = index < 6 ? "<thumb>poster.jpg</thumb><fanart>fanart.webp</fanart>" : "";
  await Promise.all([
    writeFile(join(directory, `${title}.mkv`), `owned movie ${index + 1}`),
    writeFile(join(directory, `${title}.nfo`), `<movie><title>${title}</title><year>2026</year><genre>Drama</genre>${artworkReferences}</movie>`),
    writeFile(join(directory, "poster.jpg"), `poster ${index + 1}`),
    writeFile(join(directory, "fanart.webp"), `fanart ${index + 1}`),
  ]);
}

async function writeShowFixture(root: string): Promise<void> {
  const directory = join(root, "shows", "Owned Show");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "tvshow.nfo"), "<tvshow><title>Owned Show</title><year>2025</year><genre>Drama</genre><fanart><thumb>fanart.webp</thumb></fanart></tvshow>"),
    writeFile(join(directory, "poster.jpg"), "show poster"),
    writeFile(join(directory, "fanart.webp"), "show fanart"),
    writeFile(join(directory, "episode-poster.jpg"), "episode poster"),
  ]);
  await Promise.all(Array.from({ length: 11 }, async (_, index) => {
    const episode = index + 1;
    const name = `Owned Show - S01E${String(episode).padStart(2, "0")}`;
    const files = [writeFile(join(directory, `${name}.mkv`), `owned episode ${episode}`)];
    if (episode % 2 === 1) {
      files.push(writeFile(join(directory, `${name}.nfo`), `<episodedetails><title>Episode ${episode}</title><season>1</season><episode>${episode}</episode><thumb>episode-poster.jpg</thumb></episodedetails>`));
    }
    await Promise.all(files);
  }));
}

async function writeCacheProbeFixture(root: string): Promise<void> {
  const directory = join(root, "cache-limit", "movies");
  await mkdir(directory, { recursive: true });
  await Promise.all(Array.from({ length: cacheProbeCount }, async (_, index) => {
    const title = `Cache Probe ${index + 1}`;
    await Promise.all([
      writeFile(join(directory, `${title}.mkv`), `cache probe ${index + 1}`),
      writeFile(join(directory, `${title}.nfo`), `<movie><title>${title}</title><year>2026</year></movie>`),
    ]);
  }));
}

async function run(): Promise<void> {
  const profile = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "z-video-local-scan-profile-"));
  const fixtureRoot = join(profile, "owned-fixture");
  await mkdir(fixtureRoot, { recursive: true });
  await Promise.all(Array.from({ length: 12 }, (_, index) => writeMovieFixture(fixtureRoot, index)));
  await writeShowFixture(fixtureRoot);

  app.setPath("userData", join(profile, "user-data"));
  await app.whenReady();
  const dbPath = join(profile, "user-data", "local-library", "library.sqlite");
  const workerPath = join(__dirname, "..", "src", "main", "local-library-worker.js");
  const database = new LocalLibraryDatabase({
    dbPath,
    workerPath,
  });
  let invalidProfileDatabase: LocalLibraryDatabase | undefined;
  try {
    assert.equal((await database.start()).status, "ready");
    const first = await database.scanFolder(fixtureRoot);
    assert.equal(first.status, "completed");
    assert.equal(first.scannedFiles, itemCount);
    assert.equal(first.importedFiles, itemCount);
    await writeFile(join(fixtureRoot, "movies", "Movie-01", "Owned Movie 1.nfo"), "<movie><title>Owned Movie 1 Updated</title><year>2026</year><genre>Drama</genre><plot>Changed NFO must be re-read.</plot></movie>");
    const repeated = await database.scanFolder(fixtureRoot);
    assert.equal(repeated.status, "completed");
    assert.equal(repeated.scannedFiles, itemCount);
    assert.equal(repeated.importedFiles, 0);
    assert.equal(repeated.updatedFiles, itemCount);
    const page = await database.list({ page: 1, pageSize: 1, query: "Owned Movie 1 Updated" });
    assert.equal(page.totalCount, 1);
    assert.equal(page.items[0]?.title, "Owned Movie 1 Updated");
    await writeCacheProbeFixture(profile);
    const cacheProbe = await database.scanFolder(join(profile, "cache-limit"));
    assert.equal(cacheProbe.status, "completed");
    assert.equal(cacheProbe.scannedFiles, cacheProbeCount);
    assert.equal(cacheProbe.importedFiles, cacheProbeCount);
    const invalidProfilePath = join(profile, "invalid-profile-output");
    await mkdir(invalidProfilePath, { recursive: true });
    await database.close();
    process.env.Z_VIDEO_SCAN_PROFILE_PATH = invalidProfilePath;
    invalidProfileDatabase = new LocalLibraryDatabase({ dbPath, workerPath });
    assert.equal((await invalidProfileDatabase.start()).status, "ready");
    const invalidProfileScan = await invalidProfileDatabase.scanFolder(fixtureRoot);
    assert.equal(invalidProfileScan.status, "completed");
    process.stdout.write(`SCAN_PROFILE_RESULT: ${JSON.stringify({ itemCount, firstStatus: first.status, repeatedStatus: repeated.status, repeatedUpdatedFiles: repeated.updatedFiles, cacheProbeCount, invalidProfileScanStatus: invalidProfileScan.status })}\n`);
  } finally {
    await invalidProfileDatabase?.close();
    await database.close();
    if (app.isReady()) app.quit();
    await rm(profile, { recursive: true, force: true });
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
