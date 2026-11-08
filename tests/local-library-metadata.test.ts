import assert from "node:assert/strict";
import test from "node:test";

import { parseNfo } from "../src/main/local-library-metadata";

test("NFO premiered parses a real YYYY-MM-DD instead of a year", () => {
  const dated = parseNfo("<movie><title>Dated</title><year>2026</year><premiered>2026-11-08</premiered></movie>");
  assert.equal(dated.premieredDate, "2026-11-08");

  const fallback = parseNfo("<movie><title>Fallback</title><releasedate>2019-05-01</releasedate></movie>");
  assert.equal(fallback.premieredDate, "2019-05-01");
});

test("NFO premiered wins over releasedate", () => {
  const both = parseNfo("<movie><premiered>2026-02-03</premiered><releasedate>2019-05-01</releasedate></movie>");
  assert.equal(both.premieredDate, "2026-02-03");
});

test("NFO invalid, year-only, or missing premiere dates are null", () => {
  for (const value of ["2026", "2026-13-40", "2026-02-30", "not-a-date", "2026-1-1", "2026-11-08T20:00:00"]) {
    const parsed = parseNfo(`<movie><title>Invalid</title><premiered>${value}</premiered><year>2026</year></movie>`);
    assert.equal(parsed.premieredDate, null, `${value} is not a real YYYY-MM-DD date`);
  }
  assert.equal(parseNfo("<movie><title>No Date</title></movie>").premieredDate, null);
  assert.equal(parseNfo("<movie><title>Missing</title><year>2026</year></movie>").premieredDate, null);
});
