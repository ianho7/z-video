import { closeSync, openSync } from "node:fs";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const electronPackage = join(root, "node_modules", "electron");
const electronBinaryName = (await readFile(join(electronPackage, "path.txt"), "utf8")).trim();
const electronBinary = join(electronPackage, "dist", electronBinaryName);
const profile = await mkdtemp(join(tmpdir(), "z-video-appearance-window-"));
const entry = join(root, "dist", "tests", "appearance-window-smoke.js");
const evidenceDir = join(root, ".scratch", "electron-migration", "runs", `05-appearance-${Date.now()}-${process.pid}`);
const logPath = join(evidenceDir, "appearance.log");
await mkdir(evidenceDir, { recursive: true });

async function stopOwnedProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolveResult) => setTimeout(resolveResult, 1_000))]);
  if (child.exitCode !== null || !child.pid) return;
  await new Promise((resolveResult) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", resolveResult);
    killer.once("exit", resolveResult);
  });
}

async function logTail() {
  const contents = await readFile(logPath, "utf8").catch(() => "");
  return contents.length > 4_000 ? contents.slice(-4_000) : contents;
}

try {
  const result = await new Promise((resolveResult, reject) => {
    const logFd = openSync(logPath, "w");
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    Object.assign(childEnv, {
      Z_VIDEO_NATIVE_BACKDROP: "1",
      Z_VIDEO_REDUCED_TRANSPARENCY: "1",
      Z_VIDEO_LOG_DIR: join(profile, "logs"),
    });
    const child = spawn(electronBinary, [entry], {
      cwd: root,
      env: childEnv,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    let settled = false;
    const timeout = setTimeout(async () => {
      await stopOwnedProcess(child);
      if (settled) return;
      settled = true;
      closeSync(logFd);
      reject(new Error(`appearance window smoke timed out after 30s; log=${logPath}\n${await logTail()}`));
    }, 30_000);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      closeSync(logFd);
      callback();
    };
    child.once("error", (error) => finish(() => reject(new Error(`appearance window smoke could not start; log=${logPath}`, { cause: error }))));
    child.once("exit", async (code, signal) => {
      if (code === 0) {
        finish(() => resolveResult({ code, signal }));
        return;
      }
      const tail = await logTail();
      finish(() => reject(new Error(`appearance window smoke failed: code=${code ?? "null"} signal=${signal ?? "none"}; log=${logPath}\n${tail}`)));
    });
  });
  if (result.code !== 0) throw new Error(`appearance window smoke failed: code=${result.code ?? "null"} signal=${result.signal ?? "none"}`);
  console.log(`PASS: real Electron window uses opaque reduced-transparency fallback and 900x640 minimum CSS geometry (log=${logPath})`);
} finally {
  await rm(profile, { recursive: true, force: true });
}
