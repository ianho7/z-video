import { closeSync, openSync } from "node:fs";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const packageRoot = resolve(process.env.Z_VIDEO_PACKAGE_DIR ?? join(root, ".scratch", "electron-migration", "05-package", "z-video-win32-x64"));
const executable = join(packageRoot, "z-video.exe");
const profile = await mkdtemp(join(tmpdir(), "z-video-package-smoke-"));
const evidenceDir = join(root, ".scratch", "electron-migration", "runs", `05-package-${Date.now()}-${process.pid}`);
const appLogPath = join(evidenceDir, "packaged-app.log");
await mkdir(evidenceDir, { recursive: true });

async function assertFile(path, label) {
  try {
    const value = await stat(path);
    if (!value.isFile()) throw new Error("not a file");
  } catch (error) {
    throw new Error(`${label} missing: ${path} (${error instanceof Error ? error.message : "unknown error"})`);
  }
}

function runChild(command, args, options) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ child, code, signal, stdout, stderr }));
  });
}

async function waitForRunning(child, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) return false;
    await new Promise((resolveResult) => setTimeout(resolveResult, 100));
  }
  return child.exitCode === null;
}

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

async function logTail(path) {
  const contents = await readFile(path, "utf8").catch(() => "");
  return contents.length > 4_000 ? contents.slice(-4_000) : contents;
}

await assertFile(executable, "packaged executable");
await assertFile(join(packageRoot, "z-video_wer.dll"), "renamed crash reporter");
await assertFile(join(packageRoot, "vendor", "mpv", "libmpv-2.dll"), "packaged libmpv DLL");
await assertFile(join(packageRoot, "resources", "app", "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"), "packaged Koffi prebuild");
await assertFile(join(packageRoot, "resources", "app", "dist", "src", "main", "main.js"), "packaged main entry");

try {
  const probeCode = [
    "const path = require('node:path');",
    "const koffi = require(path.join(process.cwd(), 'resources', 'app', 'node_modules', 'koffi'));",
    "const lib = koffi.load(path.join(process.cwd(), 'vendor', 'mpv', 'libmpv-2.dll'));",
    "const version = lib.func('uint32_t mpv_client_api_version()')();",
    "console.log(JSON.stringify({ koffi: koffi.version, mpvClientApi: version }));",
  ].join(" ");
  const probe = await runChild(executable, ["-e", probeCode], {
    cwd: packageRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", Z_VIDEO_MPV_DLL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.code !== 0) throw new Error(`native binding/DLL probe failed: ${probe.stderr || probe.stdout}`);
  console.log(`PASS: packaged Koffi/libmpv probe ${probe.stdout.trim()}`);

  const appLogFd = openSync(appLogPath, "w");
  const appProcess = spawn(executable, [`--user-data-dir=${profile}`], {
    cwd: packageRoot,
    env: { ...process.env, Z_VIDEO_NATIVE_BACKDROP: "0", Z_VIDEO_LOG_DIR: join(profile, "logs"), Z_VIDEO_MPV_DLL: "" },
    stdio: ["ignore", appLogFd, appLogFd],
    windowsHide: true,
  });
  let appSpawnError;
  appProcess.once("error", (error) => { appSpawnError = error; });
  try {
    if (appSpawnError || !await waitForRunning(appProcess, 3000)) {
      const result = { code: appProcess.exitCode, signal: appProcess.signalCode };
      throw new Error(`packaged app exited before launch proof: ${JSON.stringify(result)}${appSpawnError ? ` error=${appSpawnError.message}` : ""} log=${appLogPath}\n${await logTail(appLogPath)}`);
    }
    console.log(`PASS: packaged app stayed alive for isolated launch proof (pid=${appProcess.pid}, userData=${profile}, log=${appLogPath})`);
  } finally {
    await stopOwnedProcess(appProcess);
    closeSync(appLogFd);
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}

const manifest = JSON.parse(await readFile(join(packageRoot, "package-manifest.json"), "utf8"));
console.log(`PACKAGE: ${packageRoot}`);
console.log(`MANIFEST: Electron ${manifest.runtime.electron}; Koffi ${manifest.native.koffi}; libmpv ${manifest.native.libmpv.sha256}`);
