import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpaqueMediaId,
  LOCAL_LIBRARY_SCHEMA_TABLES,
  LOCAL_LIBRARY_SCHEMA_VERSION,
} from "../src/shared/local-library-contracts";
import { safeSourceLabel } from "../src/main/local-library-label";
import { localLibraryErrorMessage } from "../src/main/local-library-errors";

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

test("source labels never fall back to an absolute drive root", () => {
  assert.equal(safeSourceLabel("C:\\"), "C drive");
  assert.equal(safeSourceLabel("\\\\server\\share\\"), "share");
  assert.equal(safeSourceLabel("C:\\Users\\owned\\Videos"), "Videos");
});

test("storage errors use stable renderer-safe messages", () => {
  assert.equal(localLibraryErrorMessage("storage", "SQLite failed at C:\\private\\library.sqlite"), "本地片库暂时无法读取，请检查应用存储权限后重试。");
  assert.equal(localLibraryErrorMessage("invalid-input", "新的片库目录与已有来源重叠"), "新的片库目录与已有来源重叠");
  assert.doesNotMatch(localLibraryErrorMessage("unknown", "C:\\private\\secret"), /private|secret/u);
});
