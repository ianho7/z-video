import assert from "node:assert/strict";
import test from "node:test";

import { parseLoginInput } from "../src/main/ipc-validation";

test("login IPC validation preserves leading and trailing password bytes", () => {
  const password = "  synthetic password  ";
  const input = parseLoginInput({
    serverUrl: "  http://127.0.0.1:5055  ",
    username: "  fixture-user  ",
    password,
    remember: true,
  });

  assert.equal(input.serverUrl, "http://127.0.0.1:5055");
  assert.equal(input.username, "fixture-user");
  assert.equal(input.password, password);
});
