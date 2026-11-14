import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalArtworkCache } from "../src/main/local-artwork-cache";

test("artwork cache reuses an offline derivative without exposing its source path", async () => {
  const profile = await mkdtemp(join(tmpdir(), "z-video-artwork-cache-"));
  try {
    const cacheDirectory = join(profile, "artwork-cache");
    const sourcePath = join(profile, "poster.jpg");
    await writeFile(sourcePath, Buffer.from("owned-artwork-bytes"));
    const cache = new LocalArtworkCache(cacheDirectory, 1024);
    const key = `artwork_${"a".repeat(64)}`;
    const first = await cache.load(key, sourcePath);
    assert.equal(first?.mimeType, "image/jpeg");
    assert.match(first?.dataUrl ?? "", /^data:image\/jpeg;base64,/);
    await rm(sourcePath);
    const second = await cache.load(key, sourcePath);
    assert.equal(second?.dataUrl, first?.dataUrl);
    assert.equal((await readFile(join(cacheDirectory, `${key}.bin`))).toString(), "owned-artwork-bytes");
    assert.equal(await cache.load("not-an-artwork-key", sourcePath), undefined);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("artwork disk usage stays within the cap when cache misses complete concurrently", async () => {
  const profile = await mkdtemp(join(tmpdir(), "z-video-artwork-cache-concurrent-"));
  try {
    const cacheDirectory = join(profile, "artwork-cache");
    const cache = new LocalArtworkCache(cacheDirectory, 100);
    const loads: Array<Promise<unknown>> = [];
    for (let index = 0; index < 8; index += 1) {
      const sourcePath = join(profile, `poster-${index}.jpg`);
      await writeFile(sourcePath, Buffer.alloc(80, index));
      const key = `artwork_${index.toString(16).padStart(64, "0")}`;
      loads.push(cache.load(key, sourcePath));
    }
    await Promise.all(loads);
    const entries = await readdir(cacheDirectory, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".bin")) total += Number((await stat(join(cacheDirectory, entry.name))).size);
    }
    assert.equal(total <= 100, true);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("a failed cache initialization is retried by the next load instead of staying latched", async () => {
  const profile = await mkdtemp(join(tmpdir(), "z-video-artwork-cache-retry-"));
  try {
    const sourcePath = join(profile, "poster-retry.jpg");
    await writeFile(sourcePath, Buffer.from("retry-artwork-bytes"));
    // A plain file where the cache directory should be makes mkdir fail.
    const blocker = join(profile, "blocked");
    await writeFile(blocker, Buffer.from("not-a-directory"));
    const cache = new LocalArtworkCache(join(blocker, "artwork-cache"), 1024);
    const key = `artwork_${"c".repeat(64)}`;
    await assert.rejects(() => cache.load(key, sourcePath), "an unusable cache directory fails the first load");
    await rm(blocker, { force: true });
    const retried = await cache.load(key, sourcePath);
    assert.match(retried?.dataUrl ?? "", /^data:image\/jpeg;base64,/u, "a later load initializes the cache again");
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("concurrent loads of one cache key read the source once and share one result", async () => {
  const profile = await mkdtemp(join(tmpdir(), "z-video-artwork-cache-dedup-"));
  try {
    const cacheDirectory = join(profile, "artwork-cache");
    const sourcePath = join(profile, "poster-shared.jpg");
    await writeFile(sourcePath, Buffer.from("shared-artwork-bytes"));
    const cache = new LocalArtworkCache(cacheDirectory, 1024);
    const key = `artwork_${"d".repeat(64)}`;
    // Count source reads at the module boundary: a same-key load must share one.
    const fsPromises = require("node:fs/promises") as { readFile: (...args: unknown[]) => Promise<unknown> };
    const originalReadFile = fsPromises.readFile.bind(fsPromises);
    let sourceReads = 0;
    fsPromises.readFile = ((...args: unknown[]) => {
      if (String(args[0]) === sourcePath) sourceReads += 1;
      return originalReadFile(...args);
    }) as typeof fsPromises.readFile;
    try {
      const results = await Promise.all([
        cache.load(key, sourcePath),
        cache.load(key, sourcePath),
        cache.load(key, sourcePath),
        cache.load(key, sourcePath),
      ]);
      assert.equal(sourceReads, 1, "four concurrent misses share exactly one source read");
      assert.equal(new Set(results.map((result) => result?.dataUrl)).size, 1, "every caller receives the same derivative");
      assert.equal(results.every((result) => result?.mimeType === "image/jpeg"), true);
      const cached = await cache.load(key, sourcePath);
      assert.equal(cached?.dataUrl, results[0]?.dataUrl, "a later load reuses the stored derivative");
      assert.equal(sourceReads, 1, "a served hit never touches the source file again");
    } finally {
      fsPromises.readFile = originalReadFile as typeof fsPromises.readFile;
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
