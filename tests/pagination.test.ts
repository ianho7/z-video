import assert from "node:assert/strict";
import { test } from "node:test";

import { clampPage, paginationModel, parseJumpTarget } from "../src/renderer/pagination";

test("pagination model reports 8000 items as 334 pages of 24", () => {
  const model = paginationModel(8_000, 24, 167);
  assert.equal(model.totalPages, 334);
  assert.equal(model.page, 167);
  assert.equal(model.status, "第 167 / 334 页");
  assert.deepEqual(model.pages, [165, 166, 167, 168, 169]);
});

test("first page disables backward navigation and keeps five page buttons", () => {
  const model = paginationModel(8_000, 24, 1);
  assert.deepEqual(model.pages, [1, 2, 3, 4, 5]);
  assert.equal(model.firstDisabled, true);
  assert.equal(model.previousDisabled, true);
  assert.equal(model.nextDisabled, false);
  assert.equal(model.lastDisabled, false);
  assert.equal(model.status, "第 1 / 334 页");
});

test("last page disables forward navigation and shifts the window inside the last page", () => {
  const model = paginationModel(8_000, 24, 334);
  assert.deepEqual(model.pages, [330, 331, 332, 333, 334]);
  assert.equal(model.firstDisabled, false);
  assert.equal(model.previousDisabled, false);
  assert.equal(model.nextDisabled, true);
  assert.equal(model.lastDisabled, true);
  assert.equal(model.status, "第 334 / 334 页");
});

test("a short result set never invents pages", () => {
  const model = paginationModel(100, 24, 5);
  assert.equal(model.totalPages, 5);
  assert.deepEqual(model.pages, [1, 2, 3, 4, 5]);
  assert.equal(model.nextDisabled, true);
  assert.equal(model.lastDisabled, true);
});

test("an empty result set still yields one valid page", () => {
  const model = paginationModel(0, 24, 1);
  assert.equal(model.totalPages, 1);
  assert.deepEqual(model.pages, [1]);
  assert.equal(model.firstDisabled, true);
  assert.equal(model.previousDisabled, true);
  assert.equal(model.nextDisabled, true);
  assert.equal(model.lastDisabled, true);
  assert.equal(model.status, "第 1 / 1 页");
});

test("an out-of-range current page is clamped to a valid page", () => {
  assert.equal(paginationModel(8_000, 24, 999).page, 334);
  assert.equal(paginationModel(8_000, 24, 0).page, 1);
  assert.equal(paginationModel(8_000, 24, -3).page, 1);
  assert.equal(paginationModel(8_000, 24, Number.NaN).page, 1);
});

test("clampPage accepts only whole pages inside the range", () => {
  assert.equal(clampPage(999, 334), 334);
  assert.equal(clampPage(0, 334), 1);
  assert.equal(clampPage(-1, 334), 1);
  assert.equal(clampPage(Number.NaN, 334), 1);
  assert.equal(clampPage(2.5, 334), 1);
  assert.equal(clampPage(1, 1), 1);
});

test("jump input accepts whole numbers and clamps them into range", () => {
  assert.equal(parseJumpTarget("240", 334), 240);
  assert.equal(parseJumpTarget(" 12 ", 334), 12);
  assert.equal(parseJumpTarget("9999", 334), 334);
  assert.equal(parseJumpTarget("0", 334), 1);
});

test("jump input rejects empty and non-numeric values instead of guessing", () => {
  for (const raw of ["", "   ", "abc", "1.5", "-3", "12abc", Number.NaN.toString()]) {
    assert.equal(parseJumpTarget(raw, 334), undefined, `jump target rejects ${JSON.stringify(raw)}`);
  }
});
