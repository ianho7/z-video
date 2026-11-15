import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/**
 * Ticket 20b: unattended runner for the six audit-finding acceptance scenarios.
 *
 * Every scenario gets its own throw-away user-data dir, APPDATA/LOCALAPPDATA/TEMP
 * and log dir, and exits 0 only after writing a success receipt. The runner also
 * fingerprints the real user-data trees before and after the batch, so "the real
 * profile was never touched" is an assertion, not a promise.
 *
 * Usage: node scripts/run-acceptance-window-smoke.mjs [scenario...]
 */

const SCENARIOS = ["startup-failure-retry", "retry-recovery", "search-failure", "control-failure", "busy-escape", "review-replay"];
const PROOF = "audit-findings-acceptance";
const SCENARIO_TIMEOUT_MS = 150_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const dependencyRoot = existsSync(join(root, "node_modules")) ? join(root, "node_modules") : resolve(root, "..", "..", "node_modules");
const electronPackage = join(dependencyRoot, "electron");
const electronBinaryName = readFileSync(join(electronPackage, "path.txt"), "utf8").trim();
const electronBinary = join(electronPackage, "dist", electronBinaryName);
const entry = join(root, "dist", "tests", "acceptance-window-smoke.js");
const batchStamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const evidenceRoot = join(root, ".scratch", "local-library", "acceptance", batchStamp);

const requested = process.argv.slice(2);
const scenarios = requested.length > 0 ? requested : SCENARIOS;
for (const scenario of scenarios) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`unknown scenario: ${scenario} (expected one of ${SCENARIOS.join(", ")})`);
}

/**
 * Files the current user actually owns; the batch must not change any of them.
 * `%APPDATA%\Electron` is deliberately excluded: it is the generic Electron
 * profile shared by other Electron apps on this machine (its shader cache is
 * written by unrelated processes), not this app's user data.
 */
const realUserDataRoots = [
  process.env.APPDATA ? join(process.env.APPDATA, "z-video-electron") : undefined,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "z-video-electron") : undefined,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "z-video") : undefined,
].filter(Boolean);

function snapshotTree(rootPath) {
  if (!existsSync(rootPath)) return { present: false, files: 0, digest: "absent", root: rootPath };
  const entries = [];
  const walk = (directory) => {
    let listing;
    try {
      listing = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing.sort((left, right) => left.name.localeCompare(right.name))) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let metadata;
      try {
        metadata = statSync(full);
      } catch {
        continue;
      }
      entries.push(`${relative(rootPath, full)}|${Math.round(metadata.mtimeMs)}|${metadata.size}`);
    }
  };
  walk(rootPath);
  const digest = createHash("sha256").update(entries.join("\n")).digest("hex");
  return { present: true, files: entries.length, digest, root: rootPath };
}

function snapshotUserData() {
  return realUserDataRoots.map((rootPath) => snapshotTree(rootPath));
}

function assertUserDataUnchanged(before) {
  const after = snapshotUserData();
  for (let index = 0; index < before.length; index += 1) {
    const previous = before[index];
    const current = after[index];
    if (previous.root !== current.root) throw new Error(`user-data snapshot root changed: ${previous.root} vs ${current.root}`);
    if (previous.present !== current.present || previous.files !== current.files || previous.digest !== current.digest) {
      throw new Error(`real user data changed during the batch: ${current.root} before=${JSON.stringify(previous)} after=${JSON.stringify(current)}`);
    }
  }
  return after;
}

async function stopOwnedProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolveExit) => setTimeout(resolveExit, 1_000))]);
  if (child.exitCode !== null || !child.pid) return;
  await new Promise((resolveKill) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", resolveKill);
    killer.once("exit", resolveKill);
  });
}

async function logTail(logPath, length = 6_000) {
  const contents = await readFile(logPath, "utf8").catch(() => "");
  return contents.length > length ? contents.slice(-length) : contents;
}

async function runScenario(scenario) {
  const scenarioRoot = join(tmpdir(), `z-video-acceptance-${batchStamp}-${scenario}`);
  const profile = join(scenarioRoot, "profile");
  const userData = join(profile, "userdata");
  const sessionData = join(profile, "session");
  const tempDir = join(profile, "temp");
  const appData = join(profile, "appdata");
  const localAppData = join(profile, "localappdata");
  const logDir = join(profile, "logs");
  const evidenceDir = join(evidenceRoot, scenario);
  const logPath = join(evidenceDir, "electron.log");
  const resultPath = join(evidenceDir, "result.json");
  await mkdir(userData, { recursive: true });
  await mkdir(sessionData, { recursive: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(appData, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  await mkdir(logDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await rm(resultPath, { force: true });

  const logFd = openSync(logPath, "w");
  try {
    const childEnv = {
      ...process.env,
      // The sandboxed Electron binary degrades to Node if this leaks through.
      ELECTRON_RUN_AS_NODE: undefined,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      TEMP: tempDir,
      TMP: tempDir,
      Z_VIDEO_LOG_DIR: logDir,
      Z_VIDEO_ACCEPTANCE_SCENARIO: scenario,
      Z_VIDEO_ACCEPTANCE_PROFILE: scenarioRoot,
      Z_VIDEO_ACCEPTANCE_RESULT: resultPath,
    };
    const child = spawn(electronBinary, ["--disable-gpu", `--user-data-dir=${userData}`, entry], {
      cwd: root,
      env: childEnv,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    const timeout = setTimeout(() => { void stopOwnedProcess(child); }, SCENARIO_TIMEOUT_MS);
    const [code, signal] = await once(child, "exit");
    clearTimeout(timeout);
    if (code !== 0) {
      throw new Error(`scenario ${scenario} failed: code=${code} signal=${signal ?? "none"} log=${logPath}\n${await logTail(logPath)}`);
    }
    let receipt;
    try {
      receipt = JSON.parse(await readFile(resultPath, "utf8"));
    } catch (error) {
      throw new Error(`scenario ${scenario} exited 0 without a valid receipt (${resultPath}): ${error instanceof Error ? error.message : String(error)}\n${await logTail(logPath)}`);
    }
    if (!receipt || receipt.schemaVersion !== 1 || receipt.proof !== PROOF || receipt.scenario !== scenario) {
      throw new Error(`scenario ${scenario} produced an invalid receipt: ${JSON.stringify(receipt)}`);
    }
    if (!Array.isArray(receipt.checks) || receipt.checks.length === 0) {
      throw new Error(`scenario ${scenario} receipt carries no checks: ${JSON.stringify(receipt)}`);
    }
    return { scenario, checks: receipt.checks, logPath, resultPath };
  } finally {
    closeSync(logFd);
    // One throw-away profile per scenario, including its user-data and logs.
    await rm(scenarioRoot, { recursive: true, force: true });
  }
}

const before = snapshotUserData();
const startedAt = Date.now();
const results = [];
try {
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  const after = assertUserDataUnchanged(before);
  const elapsedSec = ((Date.now() - startedAt) / 1_000).toFixed(1);
  const checkCount = results.reduce((total, result) => total + result.checks.length, 0);
  console.log(`PASS: audit-finding acceptance window smoke — ${results.length} scenarios, ${checkCount} checks in ${elapsedSec}s`);
  for (const result of results) {
    console.log(`  ${result.scenario} (${result.checks.length} checks, log=${result.logPath})`);
    for (const check of result.checks) console.log(`    - ${check}`);
  }
  for (const tree of after) {
    console.log(`  real user data untouched: ${tree.root} present=${tree.present} files=${tree.files} digest=${tree.digest}`);
  }
} finally {
  // Every scenario profile (user-data, logs, appdata, temp) is already removed;
  // only the small .scratch evidence dir is kept for the report.
  console.log(`  evidence: ${evidenceRoot}`);
}
