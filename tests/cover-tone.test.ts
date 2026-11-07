import { strict as assert } from "node:assert";
import { test } from "node:test";
import { coverData } from "../src/renderer/cover.js";
import { toneFromPixels } from "../src/renderer/tone.js";

const item = { mediaId: "media_12345678-1234-4123-8123-123456789abc" as const, sourceId: "s", collectionId: "c", title: "[01] 星际穿越.mp4", kind: "movie" as const, sizeBytes: 1, modifiedAtMs: 1, available: true };
test("generated cover is stable and uses title and metadata priorities", () => {
  const cover = coverData({ ...item, year: 2014 }, 6);
  assert.deepEqual(cover, coverData({ ...item, year: 2014 }, 6));
  assert.equal(cover.initial, "星");
  assert.equal(cover.subtitle, "2014");
  assert.equal(coverData(item, 6).subtitle, "6 集");
  assert.equal(coverData(item).subtitle, "MP4");
  assert.equal(coverData({ ...item, kind: "episode", episodeNumber: 4 }).subtitle, "E04");
});
test("poster sampling falls back for black, gray and mixed hues", () => {
  const pixels = (...colors: number[][]) => new Uint8ClampedArray(colors.flatMap((c) => Array(64).fill(c).flat()));
  assert.equal(toneFromPixels(pixels([0, 0, 0, 255]), "mint"), "mint");
  assert.equal(toneFromPixels(pixels([128, 128, 128, 255]), "mint"), "mint");
  assert.equal(toneFromPixels(pixels([180, 60, 60, 255], [60, 180, 60, 255], [60, 60, 180, 255]), "mint"), "mint");
  assert.equal(toneFromPixels(pixels([100, 150, 210, 255]), "mint"), "blue");
});
