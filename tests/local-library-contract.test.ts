import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpaqueMediaId,
  LOCAL_LIBRARY_SCHEMA_TABLES,
  LOCAL_LIBRARY_SCHEMA_VERSION,
} from "../src/shared/local-library-contracts";

test("local library foundation exposes the stable schema tables for metadata and playback owners", () => {
  assert.equal(LOCAL_LIBRARY_SCHEMA_VERSION, 1);
  assert.deepEqual(LOCAL_LIBRARY_SCHEMA_TABLES, [
    "sources",
    "collections",
    "media_files",
    "artwork",
    "playback_state",
    "scan_runs",
  ]);
});

test("public media identity is opaque and cannot carry a private path", () => {
  assert.equal(isOpaqueMediaId("media_123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(isOpaqueMediaId("C:\\Media\\movie.mkv"), false);
  assert.equal(isOpaqueMediaId("\\\\nas\\share\\movie.mkv"), false);
  assert.equal(isOpaqueMediaId("/private/movie.mkv"), false);
});
