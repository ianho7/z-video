/**
 * Ticket 38: first-instance side of the single-instance smoke.
 *
 * The runner launches this entry with a throwaway `--user-data-dir` profile. The
 * entry loads the production main (so the instance under test is the real app),
 * seeds an in-flight `scan_runs` row and a healthy Source in that profile, then
 * launches a second real instance of the same app against the same profile.
 *
 * The second launch must be a single-instance exit: it may not reach the library
 * bootstrap, so the seeded in-flight scan stays open, the Source stays
 * undegraded, the window is raised and the profile keeps one SQLite owner.
 *
 * Evidence carriers (the smoke asserts all of them):
 * - the production SQLite file: the seeded rows carry the exact state that the
 *   second instance's startup recovery would rewrite;
 * - the primary diagnostics log: `single-instance.second-instance` proves the
 *   primary handled the event instead of a second bootstrap;
 * - the second process' own log directory: a bootstrapping instance would have
 *   written `local-library.start` and `window.renderer-ready` there;
 * - the real BrowserWindow: minimized before the second launch, restored after.
 */
import assert from "node:assert/strict";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { BrowserWindow, app } from "electron";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const RESULT_PATH = process.env.Z_VIDEO_SINGLE_INSTANCE_RESULT;
const ROOT = process.env.Z_VIDEO_SINGLE_INSTANCE_ROOT;
const PROFILE = process.env.Z_VIDEO_SINGLE_INSTANCE_PROFILE;
const PRIMARY_LOG_DIR = process.env.Z_VIDEO_LOG_DIR;
const SECONDARY_LOG_DIR = process.env.Z_VIDEO_SINGLE_INSTANCE_SECONDARY_LOG_DIR;
const EVIDENCE_DIR = process.env.Z_VIDEO_SINGLE_INSTANCE_EVIDENCE_DIR;

/** The second process must exit on its own, not be killed by the smoke. */
const SECONDARY_EXIT_TIMEOUT_MS = 20_000;
/** Startup of the primary instance (library + window) in a throwaway profile. */
const PRIMARY_READY_TIMEOUT_MS = 90_000;

const SOURCE_ID = "source_single_instance_smoke";
const SCAN_ID = "scan_single_instance_smoke";

function requireEnvironment(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const resultPath = requireEnvironment("Z_VIDEO_SINGLE_INSTANCE_RESULT", RESULT_PATH);
const root = requireEnvironment("Z_VIDEO_SINGLE_INSTANCE_ROOT", ROOT);
const profile = requireEnvironment("Z_VIDEO_SINGLE_INSTANCE_PROFILE", PROFILE);
const primaryLogDir = requireEnvironment("Z_VIDEO_LOG_DIR", PRIMARY_LOG_DIR);
const secondaryLogDir = requireEnvironment("Z_VIDEO_SINGLE_INSTANCE_SECONDARY_LOG_DIR", SECONDARY_LOG_DIR);
const evidenceDir = requireEnvironment("Z_VIDEO_SINGLE_INSTANCE_EVIDENCE_DIR", EVIDENCE_DIR);
const dbPath = join(profile, "local-library", "library.sqlite");

// Load the production main only after the environment is known: it requests the
// single-instance lock at module load, exactly like a packaged launch.
require("../src/main/main.js");

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitFor<T>(label: string, read: () => Promise<T> | T, predicate: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!predicate(last)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
    last = await read();
  }
  return last;
}

function readDiagnostics(logDir: string): Promise<string> {
  return readFile(join(logDir, "diagnostics.jsonl"), "utf8").catch(() => "");
}

function mainWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed() && !window.getParentWindow());
}

async function waitForMainWindow(): Promise<BrowserWindow> {
  const windows = await waitFor(
    "primary BrowserWindow",
    () => mainWindows(),
    (candidates) => candidates.length === 1 && !candidates[0].webContents.isLoading(),
    PRIMARY_READY_TIMEOUT_MS,
  );
  return windows[0];
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })));
}

async function killTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  await new Promise((resolveKill) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", resolveKill);
    killer.once("exit", resolveKill);
  });
}

interface SeededState {
  scanRun: { completed: number; error: string | null; completedAt: number | null };
  source: { available: number; degraded: number };
}

/** Reads the exact rows the second instance's startup recovery would rewrite. */
function readSeededState(): SeededState {
  const sqlite = require("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseSyncType };
  if (!sqlite.DatabaseSync) throw new Error("node:sqlite DatabaseSync is unavailable");
  const db = new sqlite.DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    const scanRow = db.prepare("SELECT completed, error, completed_at AS completedAt FROM scan_runs WHERE scan_id = ?").get(SCAN_ID) as
      | { completed?: number; error?: string | null; completedAt?: number | null }
      | undefined;
    const sourceRow = db.prepare("SELECT available, degraded FROM sources WHERE source_id = ?").get(SOURCE_ID) as
      | { available?: number; degraded?: number }
      | undefined;
    if (!scanRow || !sourceRow) throw new Error("seeded single-instance fixture rows are missing");
    return {
      scanRun: { completed: Number(scanRow.completed), error: scanRow.error ?? null, completedAt: scanRow.completedAt ?? null },
      source: { available: Number(sourceRow.available), degraded: Number(sourceRow.degraded) },
    };
  } finally {
    db.close();
  }
}

function closeDatabase(db: DatabaseSyncType): void {
  db.close();
}

/**
 * Writes the state the second instance would corrupt: one Source that is healthy
 * (`available = 1, degraded = 0`) and one scan run that is still in flight
 * (`completed_at IS NULL`). A fresh profile has no pending run, so any change to
 * these rows after the second launch can only come from that launch.
 */
async function seedInFlightScan(): Promise<SeededState> {
  const sourceRoot = join(evidenceDir, "seeded-source");
  await mkdir(sourceRoot, { recursive: true });
  const sqlite = require("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseSyncType };
  if (!sqlite.DatabaseSync) throw new Error("node:sqlite DatabaseSync is unavailable");
  const db = new sqlite.DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    const pending = db.prepare("SELECT COUNT(*) AS pending FROM scan_runs WHERE completed_at IS NULL").get() as { pending?: number };
    assert.equal(Number(pending.pending ?? 0), 0, "a fresh profile must not already have a pending scan run");
    const now = Date.now();
    db.prepare("INSERT INTO sources (source_id, root_path, label, available, degraded, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)")
      .run(SOURCE_ID, sourceRoot, "single-instance smoke source", now, now);
    db.prepare("INSERT INTO scan_runs (scan_id, source_id, generation, completed, error, started_at, completed_at) VALUES (?, ?, 1, 0, NULL, ?, NULL)")
      .run(SCAN_ID, SOURCE_ID, now);
  } finally {
    closeDatabase(db);
  }
  return readSeededState();
}

/**
 * The second launch is the same application (production entry, same profile) but
 * gets its own diagnostics directory, so any bootstrap work it did is separable
 * from the primary's log.
 */
async function launchSecondInstance(): Promise<{ exitCode: number | null; exitSignal: NodeJS.Signals | null; elapsedMs: number }> {
  const stdioLog = join(evidenceDir, "second-instance.stdio.log");
  const logFd = openSync(stdioLog, "w");
  const startedAt = Date.now();
  const child = spawn(process.execPath, [".", "--disable-gpu", `--user-data-dir=${profile}`], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      // Keep the production entry (`.`) as the second launch; only the
      // diagnostics directory is redirected for evidence.
      Z_VIDEO_LOG_DIR: secondaryLogDir,
      Z_VIDEO_SINGLE_INSTANCE_RESULT: undefined,
    },
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  try {
    const exited = await Promise.race([
      waitForExit(child).then((result) => ({ ...result, timedOut: false })),
      sleep(SECONDARY_EXIT_TIMEOUT_MS).then(() => ({ code: null, signal: null, timedOut: true })),
    ]);
    if (exited.timedOut) {
      await killTree(child.pid);
      throw new Error(`the second instance stayed alive for ${SECONDARY_EXIT_TIMEOUT_MS} ms instead of exiting`);
    }
    return { exitCode: exited.code, exitSignal: exited.signal, elapsedMs: Date.now() - startedAt };
  } finally {
    closeSync(logFd);
  }
}

async function run(): Promise<void> {
  assert.equal(resolve(app.getPath("userData")), resolve(profile), "--user-data-dir must own this instance's profile");
  await app.whenReady();

  const window = await waitForMainWindow();
  await waitFor(
    "primary local library start",
    () => readDiagnostics(primaryLogDir),
    (log) => log.includes("\"operation\":\"local-library.start\"") && log.includes("\"result\":\"success\""),
    PRIMARY_READY_TIMEOUT_MS,
  );
  assert.ok(existsSync(dbPath), "primary instance did not create its library database");

  const seeded = await seedInFlightScan();

  // A minimized primary is the state a second launch must recover from.
  window.minimize();
  const minimized = await waitFor("primary window minimization", () => window.isMinimized(), (value) => value, 5_000).catch(() => false);
  if (!minimized) {
    // Some desktop-less sessions refuse to minimize; hiding still proves the
    // second launch re-shows the existing window instead of opening a new one.
    window.hide();
  }

  const secondary = await launchSecondInstance();

  // 1. The second launch exits by itself with the single-instance exit code.
  assert.equal(secondary.exitSignal, null, `second instance was killed by a signal (${secondary.exitSignal})`);
  assert.equal(secondary.exitCode, 0, `second instance must exit with code 0, got ${secondary.exitCode}`);
  assert.ok(secondary.elapsedMs < SECONDARY_EXIT_TIMEOUT_MS, `second instance took ${secondary.elapsedMs} ms to exit`);

  // 2. The first instance survives and its window is raised (restored, visible).
  assert.equal(mainWindows().length, 1, "the second launch must not create a second window");
  if (minimized) {
    await waitFor("primary window restore", () => window.isMinimized(), (value) => !value, 5_000);
  } else {
    await waitFor("primary window re-show", () => window.isVisible(), (value) => value, 5_000);
  }
  await waitFor("primary window focus", () => window.isFocused(), (value) => value, 5_000);

  // 3. The primary handled the event; the secondary never bootstrapped.
  const primaryLog = await readDiagnostics(primaryLogDir);
  assert.ok(primaryLog.includes("\"operation\":\"single-instance.second-instance\""), "primary did not record the second-instance event");
  const secondaryLog = await readDiagnostics(secondaryLogDir);
  assert.ok(!secondaryLog.includes("\"operation\":\"local-library.start\""), "the second instance started the local library");
  assert.ok(!secondaryLog.includes("\"operation\":\"window.renderer-ready\""), "the second instance created a renderer window");

  // 4. The seeded in-flight scan and the healthy Source were not rewritten.
  const after = readSeededState();
  assert.deepEqual(after, seeded, "the second instance rewrote the seeded scan/source state");
  assert.equal(after.scanRun.completedAt, null, "the in-flight scan run was closed by the second instance");
  assert.equal(after.scanRun.error, null, "the in-flight scan run was marked interrupted by the second instance");
  assert.equal(after.source.degraded, 0, "the Source was marked degraded by the second instance");

  await writeFile(resultPath, `${JSON.stringify({
    schemaVersion: 1,
    proof: "single-instance",
    windowRaise: minimized ? "minimized-restored" : "hidden-reshown",
    secondaryExitCode: secondary.exitCode,
    secondaryExitMs: secondary.elapsedMs,
    seededBefore: seeded,
    seededAfter: after,
  }, null, 2)}\n`, "utf8");
}

void (async () => {
  try {
    await run();
    app.quit();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(resultPath, `${JSON.stringify({ schemaVersion: 1, proof: "single-instance", ok: false, error: message }, null, 2)}\n`, "utf8")
      .catch(() => undefined);
    app.exit(1);
  }
})();
