import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/**
 * Ticket 38 single-instance smoke.
 *
 * Runs three real launches against one throwaway profile:
 * 1. the primary instance (the test entry, which loads the production main);
 * 2. a second real launch of the packaged entry against the live profile, which
 *    must exit on the single-instance lock without touching the library;
 * 3. a successor launch after the primary quit, which must become the only
 *    instance and start the library normally.
 *
 * The entry asserts 1 and 2 from the inside; this runner owns the profile, the
 * process tree and the final "lock was released" check.
 */
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const dependencyRoot = existsSync(join(root, "node_modules")) ? join(root, "node_modules") : resolve(root, "..", "..", "node_modules");
const electronPackage = join(dependencyRoot, "electron");
const electronBinaryName = (await readFile(join(electronPackage, "path.txt"), "utf8")).trim();
const electronBinary = join(electronPackage, "dist", electronBinaryName);
const entry = join(root, "dist", "tests", "single-instance-primary-smoke.js");

const evidenceDir = join(root, ".scratch", "single-instance", `run-${Date.now()}-${process.pid}`);
const profileDir = join(evidenceDir, "profile");
const primaryLogDir = join(evidenceDir, "logs-primary");
const secondaryLogDir = join(evidenceDir, "logs-secondary");
const successorLogDir = join(evidenceDir, "logs-successor");
const resultPath = join(evidenceDir, "result.json");
const PRIMARY_TIMEOUT_MS = 180_000;
const SUCCESSOR_TIMEOUT_MS = 90_000;
await mkdir(primaryLogDir, { recursive: true });
await mkdir(successorLogDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function readDiagnostics(logDir) {
  return readFile(join(logDir, "diagnostics.jsonl"), "utf8").catch(() => "");
}

async function killTree(pid) {
  if (!pid) return;
  await new Promise((resolveKill) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", resolveKill);
    killer.once("exit", resolveKill);
  });
}

/** Kills a still-running launch and waits for its exit so the profile is not held. */
async function stopLaunch(launch) {
  if (!launch) return;
  if (launch.child.exitCode === null && launch.child.signalCode === null) await killTree(launch.child.pid);
  await Promise.race([new Promise((resolveExit) => launch.child.once("exit", resolveExit)), sleep(5_000)]);
  if (launch.logFd !== undefined) {
    closeSync(launch.logFd);
    launch.logFd = undefined;
  }
}

function spawnElectron(args, logDir, stdioPath, extraEnv = {}) {
  const logFd = openSync(stdioPath, "w");
  const child = spawn(electronBinary, args, {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      Z_VIDEO_LOG_DIR: logDir,
      ...extraEnv,
    },
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  return { child, logFd };
}

let primaryLaunch;
let successorLaunch;
let succeeded = false;
let failure;
try {
  // 1. Primary instance: the test entry loads the production main, then starts
  //    the second launch itself and asserts the lock behaviour.
  primaryLaunch = spawnElectron(
    ["--disable-gpu", `--user-data-dir=${profileDir}`, entry],
    primaryLogDir,
    join(evidenceDir, "primary.stdio.log"),
    {
      Z_VIDEO_SINGLE_INSTANCE_RESULT: resultPath,
      Z_VIDEO_SINGLE_INSTANCE_ROOT: root,
      Z_VIDEO_SINGLE_INSTANCE_PROFILE: profileDir,
      Z_VIDEO_SINGLE_INSTANCE_SECONDARY_LOG_DIR: secondaryLogDir,
      Z_VIDEO_SINGLE_INSTANCE_EVIDENCE_DIR: evidenceDir,
    },
  );
  const primaryExit = new Promise((resolveExit) => primaryLaunch.child.once("exit", (code, signal) => resolveExit({ code, signal })));
  const primaryWatchdog = sleep(PRIMARY_TIMEOUT_MS).then(() => ({ code: null, signal: null, timedOut: true }));
  const primaryResult = await Promise.race([primaryExit, primaryWatchdog]);
  if (primaryResult.timedOut) {
    await stopLaunch(primaryLaunch);
    throw new Error(`primary single-instance smoke timed out after ${PRIMARY_TIMEOUT_MS} ms`);
  }
  if (primaryResult.code !== 0) {
    const primaryStdio = await readFile(join(evidenceDir, "primary.stdio.log"), "utf8").catch(() => "");
    throw new Error(`primary smoke process exited code=${primaryResult.code} signal=${primaryResult.signal ?? "none"}\n${primaryStdio}`);
  }
  await stopLaunch(primaryLaunch);
  let receipt;
  try {
    receipt = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (error) {
    const primaryStdio = await readFile(join(evidenceDir, "primary.stdio.log"), "utf8").catch(() => "");
    throw new Error(`primary smoke exited 0 without a valid receipt result=${resultPath}: ${error instanceof Error ? error.message : String(error)}\n${primaryStdio}`);
  }
  if (!receipt || receipt.schemaVersion !== 1 || receipt.proof !== "single-instance") {
    throw new Error(`primary smoke produced an invalid receipt result=${resultPath}`);
  }
  if (receipt.ok === false) throw new Error(`primary smoke failed its assertions: ${receipt.error}`);

  // 2. The primary is gone, so the lock must be released: a fresh launch has to
  //    become the only instance and start the local library normally.
  successorLaunch = spawnElectron(
    [".", "--disable-gpu", `--user-data-dir=${profileDir}`],
    successorLogDir,
    join(evidenceDir, "successor.stdio.log"),
  );
  let successorExited = false;
  successorLaunch.child.once("exit", () => { successorExited = true; });
  const successorDeadline = Date.now() + SUCCESSOR_TIMEOUT_MS;
  let successorLog = "";
  while (Date.now() < successorDeadline && !successorExited) {
    successorLog = await readDiagnostics(successorLogDir);
    if (successorLog.includes("\"operation\":\"window.renderer-ready\"")) break;
    await sleep(100);
  }
  if (successorExited) {
    const successorStdio = await readFile(join(evidenceDir, "successor.stdio.log"), "utf8").catch(() => "");
    throw new Error(`the successor launch exited although no other instance was running\n${successorStdio}`);
  }
  if (!successorLog.includes("\"operation\":\"local-library.start\"")) {
    throw new Error(`the successor launch did not start the local library (log=${join(successorLogDir, "diagnostics.jsonl")})`);
  }
  if (!successorLog.includes("\"operation\":\"window.renderer-ready\"")) {
    throw new Error(`the successor launch did not create its renderer window (log=${join(successorLogDir, "diagnostics.jsonl")})`);
  }
  succeeded = true;
} catch (error) {
  failure = error;
} finally {
  await stopLaunch(successorLaunch);
  await stopLaunch(primaryLaunch);
}

if (!succeeded) {
  throw new Error(`single-instance smoke failed; profile kept at ${profileDir} (evidence=${evidenceDir}, secondary log=${secondaryLogDir})\n${failure instanceof Error ? failure.message : String(failure)}`);
}

// The throwaway profile is removed once the smoke passed.
await rm(profileDir, { recursive: true, force: true });
console.log(`PASS: single-instance smoke (evidence=${evidenceDir}, profile removed)`);
