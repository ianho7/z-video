import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(root, "release", "z-video-win32-x64");
const exeName = process.platform === "win32" ? "z-video.exe" : "z-video";
const exePath = join(packageDir, exeName);
const profileDir = join(tmpdir(), "z-video-try-profile");
// Chromium raises a breakpoint when it cannot start its sandbox from a
// low-integrity workspace; Node sees the same status as -2147483645.
const sandboxCrashCodes = new Set([-2147483645, 2147483651]);

if (!existsSync(exePath)) {
  console.error(`package is missing: ${exePath}\nrun: npm run package`);
  process.exit(1);
}

function childEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function launch(directory) {
  return spawn(join(directory, exeName), [`--user-data-dir=${profileDir}`], {
    cwd: directory,
    env: childEnv(),
    stdio: "ignore",
    detached: true,
  });
}

function waitForExit(child, ms) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolvePromise(null);
    }, ms);
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ error });
    });
  });
}


async function cleanupOldCopies() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of await readdir(tmpdir()).catch(() => [])) {
    if (!/^z-video-try-\d+$/.test(name)) continue;
    const directory = join(tmpdir(), name);
    const info = await stat(directory).catch(() => null);
    if (info && info.mtimeMs < cutoff) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  await mkdir(profileDir, { recursive: true });
  await cleanupOldCopies();
  console.log(`launch: ${exePath}`);
  const first = launch(packageDir);
  const firstExit = await waitForExit(first, 6000);
  if (!firstExit) {
    first.unref();
    console.log(`running in place (pid ${first.pid})`);
    return;
  }
  if (firstExit.error) {
    console.error(`launch failed: ${firstExit.error.message}`);
    process.exitCode = 1;
    return;
  }
  if (firstExit.code === 9) {
    console.error("app started as Node: ELECTRON_RUN_AS_NODE is still set in this shell");
    process.exitCode = 1;
    return;
  }
  if (firstExit.code === 0) {
    console.log("another instance is already running; the launch was handed to it");
    return;
  }
  if (!sandboxCrashCodes.has(firstExit.code)) {
    console.error(`app exited early: code=${firstExit.code} signal=${firstExit.signal}`);
    process.exitCode = 1;
    return;
  }
  console.log(`in-place launch hit the low-integrity sandbox limit (code=${firstExit.code}); retrying from a temp copy`);
  const target = join(tmpdir(), `z-video-try-${Date.now()}`);
  console.log(`copying package to ${target}`);
  await cp(packageDir, target, { recursive: true, force: true });
  const second = launch(target);
  const secondExit = await waitForExit(second, 8000);
  if (!secondExit) {
    second.unref();
    console.log(`running from temp copy (pid ${second.pid})`);
    console.log(`package: ${target}`);
    console.log(`profile: ${profileDir}`);
    return;
  }
  console.error(`temp launch also exited: code=${secondExit.code} signal=${secondExit.signal}`);
  console.error(`inspect the package under ${target}`);
  process.exitCode = 1;
}

await main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
