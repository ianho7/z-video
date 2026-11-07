import { strict as assert } from "node:assert";
import { test } from "node:test";
import { biscuitPath, wavePath, waterlinePath } from "../src/renderer/shapes";

test("shape paths are stable and preserve their endpoints", () => {
  assert.equal(biscuitPath(42, 6, 8), biscuitPath(42, 6, 8));
  assert.match(biscuitPath(42, 6, 8), /^M 90 48 /);
  assert.match(biscuitPath(42, 6, 8), / Z$/);
  assert.equal(wavePath(20, 10, 2, 5), wavePath(20, 10, 2, 5));
  assert.match(wavePath(20, 10, 2, 5), /^M 0 10 /);
  assert.match(wavePath(20, 10, 2, 5), /L 20 8\.486$/);
  assert.match(waterlinePath(20, 10, 2, 5, 30), /L 20 30 L 0 30 Z$/);
});
