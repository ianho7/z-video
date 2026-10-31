import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
