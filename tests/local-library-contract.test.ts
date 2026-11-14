import assert from "node:assert/strict";
import test from "node:test";

import {
  isCompletedWatch,
  isEffectiveWatch,
  isOpaqueMediaId,
  LOCAL_LIBRARY_SCHEMA_TABLES,
  LOCAL_LIBRARY_SCHEMA_VERSION,
} from "../src/shared/local-library-contracts";
import { safeSourceLabel, safeSourceLocationHint } from "../src/main/local-library-label";
import { localLibraryErrorMessage } from "../src/main/local-library-errors";

test("local library foundation exposes the stable schema tables for metadata and playback owners", () => {
  // v4 adds sources.degraded (partial traversal) on top of the v3 viewing ledger.
  assert.equal(LOCAL_LIBRARY_SCHEMA_VERSION, 4);
  assert.deepEqual(LOCAL_LIBRARY_SCHEMA_TABLES, [
    "sources",
    "collections",
    "media_files",
    "artwork",
    "playback_state",
    "scan_runs",
    "viewing_sessions",
    "media_history",
  ]);
});

test("effective watch needs 30 seconds and 3% while completion needs ended or 90%", () => {
  assert.equal(isEffectiveWatch(29, 100), false);
  assert.equal(isEffectiveWatch(30, 1000), true, "30 seconds without a 3% duty is still the absolute floor");
  assert.equal(isEffectiveWatch(31, 1000), true, "3.1% of a long file is effective");
  assert.equal(isEffectiveWatch(30, 2000), false, "1.5% is below the 3% threshold");
  assert.equal(isEffectiveWatch(30, undefined), true, "an unknown duration relies on the 30-second floor");
  assert.equal(isEffectiveWatch(30, 0), true);

  assert.equal(isCompletedWatch(29, 300, 299), false, "completion needs at least 30 played seconds");
  assert.equal(isCompletedWatch(31, 300, 269), false, "89.6% is below the completion threshold");
  assert.equal(isCompletedWatch(31, 300, 270), true, "exactly 90% with 31 played seconds completes");
  assert.equal(isCompletedWatch(5, 300, 295), false, "seeking to the end without playing never completes");
  assert.equal(isCompletedWatch(31, undefined, 31), false, "unknown duration completes only through ended");
});

test("public media identity is opaque and cannot carry a private path", () => {
  assert.equal(isOpaqueMediaId("media_123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(isOpaqueMediaId("C:\\Media\\movie.mkv"), false);
  assert.equal(isOpaqueMediaId("\\\\nas\\share\\movie.mkv"), false);
  assert.equal(isOpaqueMediaId("/private/movie.mkv"), false);
});

test("source labels never fall back to an absolute drive root", () => {
  assert.equal(safeSourceLabel("C:\\"), "C 盘");
  assert.equal(safeSourceLabel("\\\\server\\share\\"), "share");
  assert.equal(safeSourceLabel("C:\\Users\\owned\\Videos"), "Videos");
});

test("source location hints distinguish same-name folders without exposing the full path", () => {
  assert.equal(safeSourceLocationHint("D:\\影片\\Movies"), "D 盘 · 上级：影片");
  assert.equal(safeSourceLocationHint("E:\\备份\\Movies\\"), "E 盘 · 上级：备份");
  assert.equal(safeSourceLocationHint("D:\\"), "D 盘");
  assert.equal(safeSourceLocationHint("\\\\server\\share\\Movies"), "网络位置 · 上级：share");
  assert.equal(safeSourceLocationHint("\\\\server\\share"), "网络位置");
  for (const root of ["D:\\影片\\Movies", "C:\\Users\\owner\\Videos", "\\\\server\\share\\Movies"]) {
    const hint = safeSourceLocationHint(root);
    assert.equal(hint.includes(root), false);
    assert.equal(/[\\/]/u.test(hint), false);
  }
});

test("storage errors use stable renderer-safe messages", () => {
  assert.equal(localLibraryErrorMessage("storage", "SQLite failed at C:\\private\\library.sqlite"), "本地片库暂时无法读取，请检查应用存储权限后重试。");
  assert.equal(localLibraryErrorMessage("invalid-input", "新的片库目录与已有来源重叠"), "新的片库目录与已有来源重叠");
  assert.doesNotMatch(localLibraryErrorMessage("unknown", "C:\\private\\secret"), /private|secret/u);
});
