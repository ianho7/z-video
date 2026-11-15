import assert from "node:assert/strict";
import test from "node:test";

import {
  isCompletedWatch,
  isEffectiveWatch,
  isLocalRefreshTrigger,
  isMarkerDurationSec,
  isMarkerPositionSec,
  isMarkerWithinDuration,
  isOpaqueMediaId,
  LOCAL_LIBRARY_SCHEMA_TABLES,
  LOCAL_LIBRARY_SCHEMA_VERSION,
  normalizeScanRelativeDirectory,
  type LocalLibraryRefreshResult,
} from "../src/shared/local-library-contracts";
import { safeSourceLabel, safeSourceLocationHint } from "../src/main/local-library-label";
import { localLibraryErrorMessage } from "../src/main/local-library-errors";

test("local library foundation exposes the stable schema tables for metadata and playback owners", () => {
  // v5 adds the markers table (whole-second points) on top of the v4 source state.
  assert.equal(LOCAL_LIBRARY_SCHEMA_VERSION, 5);
  assert.deepEqual(LOCAL_LIBRARY_SCHEMA_TABLES, [
    "sources",
    "collections",
    "media_files",
    "artwork",
    "playback_state",
    "scan_runs",
    "viewing_sessions",
    "media_history",
    "markers",
  ]);
});

test("marker positions are whole non-negative seconds and are never clamped past a known duration", () => {
  assert.equal(isMarkerPositionSec(0), true, "a marker at the very start is valid");
  assert.equal(isMarkerPositionSec(90), true);
  assert.equal(isMarkerPositionSec(-1), false, "a negative position is rejected, not clamped to zero");
  assert.equal(isMarkerPositionSec(10.5), false, "fractional seconds are rejected instead of silently rounded");
  assert.equal(isMarkerPositionSec(Number.NaN), false);
  assert.equal(isMarkerPositionSec("90"), false);

  assert.equal(isMarkerDurationSec(0), true, "an unknown (zero) duration disables only the upper bound");
  assert.equal(isMarkerDurationSec(1200), true);
  assert.equal(isMarkerDurationSec(Number.POSITIVE_INFINITY), false);
  assert.equal(isMarkerDurationSec(-5), false);

  assert.equal(isMarkerWithinDuration(90, 1200), true);
  assert.equal(isMarkerWithinDuration(1200, 1200), true, "the last whole second of the file is inside its duration");
  assert.equal(isMarkerWithinDuration(1201, 1200), false, "a position past the known duration is an error");
  assert.equal(isMarkerWithinDuration(90, undefined), true, "without a known duration only the position rules apply");
  assert.equal(isMarkerWithinDuration(-1, 1200), false);
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

test("a directory rescan scope stays inside the source and never names another root", () => {
  assert.equal(normalizeScanRelativeDirectory("Season 1"), "Season 1");
  assert.equal(normalizeScanRelativeDirectory("Shows\\Season 1"), "Shows/Season 1", "both separators normalize to the library's POSIX form");
  assert.equal(normalizeScanRelativeDirectory("./Movies/"), "Movies");
  assert.equal(normalizeScanRelativeDirectory("."), "", "the source root itself is addressable");
  assert.equal(normalizeScanRelativeDirectory(""), undefined, "an empty value names no directory");
  for (const rejected of [
    "../Movies",
    "Movies/../../escape",
    "\\\\server\\share\\Movies",
    "//server/share/Movies",
    "C:\\Movies",
    "C:Movies",
    "\\\\?\\C:\\Movies",
    "/Movies",
    "file:///Movies",
    "Movies\u0000Season",
    42,
    null,
    undefined,
  ]) {
    assert.equal(normalizeScanRelativeDirectory(rejected), undefined, `${String(rejected)} is not a source-relative directory`);
  }
});

test("the watcher refresh cause stays main-only and the pushed result is still the counts-only payload", () => {
  // Ticket 24a: the watcher is a third cause of an automatic refresh. It is not
  // a new renderer entry point, so the renderer-side validation is unchanged and
  // a renderer call can never claim it.
  assert.equal(isLocalRefreshTrigger("focus"), true);
  assert.equal(isLocalRefreshTrigger("return"), true);
  assert.equal(isLocalRefreshTrigger("watch"), false, "the filesystem watcher cause is main-only");
  assert.equal(isLocalRefreshTrigger("auto"), false);
  // The renderer's refresh handler reads only `counts` (the status line) and
  // never branches on the cause; the payload still carries no path or source id.
  const watchResult: LocalLibraryRefreshResult = {
    trigger: "watch",
    scannedDirectories: 2,
    counts: { imported: 1, updated: 2, unchanged: 3, removed: 4 },
    nfoUpdatedFiles: 2,
    fingerprintReplacedFiles: 0,
    warningCount: 0,
  };
  const roundTripped = structuredClone(watchResult) as LocalLibraryRefreshResult;
  assert.deepEqual(roundTripped, watchResult, "the watch result is structured-clone safe across the IPC boundary");
  assert.deepEqual(
    Object.keys(roundTripped).sort(),
    ["counts", "fingerprintReplacedFiles", "nfoUpdatedFiles", "scannedDirectories", "trigger", "warningCount"],
    "the payload adds no path, source id or scan id",
  );
  assert.deepEqual(roundTripped.counts, { imported: 1, updated: 2, unchanged: 3, removed: 4 }, "the status line keeps reading the same four counts");
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
