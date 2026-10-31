import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import { LocalLibraryDatabase } from "../src/main/local-library-database";

const itemCount = 23;

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

async function run(): Promise<void> {
  const profile = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "z-video-local-scan-profile-"));
  const fixtureRoot = join(profile, "owned-fixture");
  await mkdir(fixtureRoot, { recursive: true });
  await Promise.all(Array.from({ length: 12 }, (_, index) => writeMovieFixture(fixtureRoot, index)));
  await writeShowFixture(fixtureRoot);

  app.setPath("userData", join(profile, "user-data"));
  await app.whenReady();
  const database = new LocalLibraryDatabase({
    dbPath: join(profile, "user-data", "local-library", "library.sqlite"),
    workerPath: join(__dirname, "..", "src", "main", "local-library-worker.js"),
  });
  try {
    assert.equal((await database.start()).status, "ready");
    const first = await database.scanFolder(fixtureRoot);
    assert.equal(first.status, "completed");
    assert.equal(first.scannedFiles, itemCount);
    assert.equal(first.importedFiles, itemCount);
    const repeated = await database.scanFolder(fixtureRoot);
    assert.equal(repeated.status, "completed");
    assert.equal(repeated.scannedFiles, itemCount);
    assert.equal(repeated.importedFiles, 0);
    assert.equal(repeated.updatedFiles, itemCount);
    const page = await database.list({ page: 1, pageSize: 1, query: "Owned" });
    assert.equal(page.totalCount, itemCount);
    process.stdout.write(`SCAN_PROFILE_RESULT: ${JSON.stringify({ itemCount, firstStatus: first.status, repeatedStatus: repeated.status, repeatedUpdatedFiles: repeated.updatedFiles })}\n`);
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
