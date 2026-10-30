import assert from "node:assert/strict";
import test from "node:test";

import { safePath } from "../src/main/diagnostics";

test("diagnostic route sanitization drops query secrets and private media paths", () => {
  assert.equal(safePath("https://nas.example/auth/login?token=secret&password=secret"), "/auth/login");
  assert.equal(safePath("http://nas/splay/opaque/private/movie.mkv?token=secret"), "/[REDACTED_MEDIA_PATH]");
});
