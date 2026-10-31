import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NasApiClient, NasError, type AuthenticatedSession } from "../src/main/nas-client";
import { diagnosticLogPath, recordUiOperation, safePath } from "../src/main/diagnostics";

test("diagnostic route sanitization drops query secrets and private media paths", () => {
  assert.equal(safePath("https://nas.example/auth/login?token=secret&password=secret"), "/auth/login");
  assert.equal(safePath("http://nas/splay/opaque/private/movie.mkv?token=secret"), "/[REDACTED_MEDIA_PATH]");
});

test("HTTP 200 business failures are logged as business errors, not parse successes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "z-video-diagnostics-"));
  const previous = process.env.Z_VIDEO_LOG_DIR;
  process.env.Z_VIDEO_LOG_DIR = directory;
  const session: AuthenticatedSession = {
    baseUrl: "http://fixture-nas:5055",
    username: "fixture-user",
    token: "synthetic-token",
    nasId: "synthetic-nas",
    nasSign: "synthetic-sign",
  };
  try {
    await assert.rejects(
      () => new NasApiClient({ fetcher: async () => new Response(JSON.stringify({ code: "T000001", message: "synthetic failure" }), { status: 200 }) }).getClassifications(session),
      (error: unknown) => error instanceof NasError && error.kind === "business" && error.code === "T000001",
    );
    const events = (await readFile(diagnosticLogPath(), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event_type: string; result: string; details?: { businessResult?: string; errorCode?: string } });
    assert.equal(events.some((event) => event.result === "success" && event.details?.businessResult === "success"), false);
    assert.equal(events.some((event) => event.result === "error" && event.details?.businessResult === "error" && event.details?.errorCode === "T000001"), true);
  } finally {
    if (previous === undefined) delete process.env.Z_VIDEO_LOG_DIR;
    else process.env.Z_VIDEO_LOG_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("UI operation diagnostics carry no input payload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "z-video-ui-diagnostics-"));
  const previous = process.env.Z_VIDEO_LOG_DIR;
  process.env.Z_VIDEO_LOG_DIR = directory;
  try {
    await recordUiOperation("session.login", "success", Date.now());
    const contents = await readFile(diagnosticLogPath(), "utf8");
    const event = JSON.parse(contents.trim()) as { event_type: string; operation: string; details: Record<string, unknown> };
    assert.equal(event.event_type, "ui.operation");
    assert.equal(event.operation, "session.login");
    assert.deepEqual(event.details, {});
  } finally {
    if (previous === undefined) delete process.env.Z_VIDEO_LOG_DIR;
    else process.env.Z_VIDEO_LOG_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
