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
