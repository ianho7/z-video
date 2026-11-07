import { closeSync, existsSync, openSync } from "node:fs";
import { once } from "node:events";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const packageRoot = resolve(process.env.Z_VIDEO_PACKAGE_DIR ?? join(root, ".scratch", "local-library", "package", "z-video-win32-x64"));
const packageExecutable = join(packageRoot, "z-video.exe");
const nodeModules = resolve(process.env.Z_VIDEO_NODE_MODULES_DIR ?? [join(root, "node_modules"), resolve(root, "..", "..", "node_modules")].find((candidate) => existsSync(candidate)) ?? join(root, "node_modules"));
const npmCache = process.env.npm_config_cache ?? join(process.env.LOCALAPPDATA ?? join(tmpdir(), "z-video-no-localappdata"), "npm-cache");
const evidenceDir = join(root, ".scratch", "local-library", "runs", `05-resources-${Date.now()}-${process.pid}`);
const appLogPath = join(evidenceDir, "packaged-app.log");
const reportPath = join(evidenceDir, "resource-measurement.json");

async function treeSize(path) {
  let bytes = 0;
  let files = 0;
  let directories = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      directories += 1;
      const nested = await treeSize(child);
      bytes += nested.bytes;
      files += nested.files;
      directories += nested.directories;
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const metadata = await stat(child).catch(() => undefined);
      if (metadata?.isFile()) {
        bytes += metadata.size;
        files += 1;
      }
    }
  }
  return { bytes, files, directories };
}

async function measureTree(path) {
  try {
    const value = await stat(path);
    if (!value.isDirectory()) return { path, exists: false, reason: "not-a-directory" };
    return { path, exists: true, ...(await treeSize(path)) };
  } catch (error) {
    return { path, exists: false, reason: error instanceof Error ? error.code ?? error.message : "unavailable" };
  }
}

function runTasklist(pid) {
  return new Promise((resolveResult, reject) => {
    execFile("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`tasklist failed: ${stderr || error.message}`, { cause: error }));
        return;
      }
      const row = stdout.match(new RegExp(`"[^\"]+","${pid}","[^\"]*","[^\"]*","([0-9,]+) K"`));
      if (!row) {
        reject(new Error(`tasklist did not report process ${pid}`));
        return;
      }
      resolveResult({ workingSetBytes: Number(row[1].replaceAll(",", "")) * 1024, raw: stdout.trim() });
    });
  });
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

async function logTail() {
  const contents = await readFile(appLogPath, "utf8").catch(() => "");
  return contents.length > 4_000 ? contents.slice(-4_000) : contents;
}

await mkdir(evidenceDir, { recursive: true });
const developer = {
  nodeModules: await measureTree(nodeModules),
  npmCache: await measureTree(npmCache),
};
const candidate = await measureTree(packageRoot);
let appProcess;
let appLogFd;
let profile;
let runtime;

try {
  const executableInfo = await stat(packageExecutable);
  if (!executableInfo.isFile()) throw new Error(`packaged executable is unavailable: ${packageExecutable}`);
  profile = await mkdtemp(join(tmpdir(), "z-video-resource-measurement-"));
  appLogFd = openSync(appLogPath, "w");
  const appEnv = { ...process.env };
  delete appEnv.ELECTRON_RUN_AS_NODE;
  Object.assign(appEnv, {
    Z_VIDEO_NATIVE_BACKDROP: "0",
    Z_VIDEO_LOG_DIR: join(profile, "logs"),
  });
  appProcess = spawn(packageExecutable, [`--user-data-dir=${profile}`], {
    cwd: packageRoot,
    env: appEnv,
    stdio: ["ignore", appLogFd, appLogFd],
    windowsHide: true,
  });
  let spawnError;
  appProcess.once("error", (error) => { spawnError = error; });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3_000 && appProcess.exitCode === null && !spawnError) {
    await new Promise((resolveResult) => setTimeout(resolveResult, 100));
  }
  if (spawnError || appProcess.exitCode !== null) {
    throw new Error(`packaged app did not stay alive for memory sample: code=${appProcess.exitCode ?? "null"} signal=${appProcess.signalCode ?? "none"}${spawnError ? ` error=${spawnError.message}` : ""} log=${appLogPath}\n${await logTail()}`);
  }
  runtime = {
    process: "z-video.exe",
    pid: appProcess.pid,
    sample: "idle launch after 3 seconds",
    ...(await runTasklist(appProcess.pid)),
    log: appLogPath,
  };
} finally {
  if (appProcess) await stopOwnedProcess(appProcess);
  if (appLogFd !== undefined) closeSync(appLogFd);
  if (profile) await rm(profile, { recursive: true, force: true });
}

const report = {
  measuredAt: new Date().toISOString(),
  platform: { platform: process.platform, arch: process.arch, node: process.version },
  developer,
  candidate,
  runtime,
  limits: [
    "node_modules and npm cache are developer dependency/cache measurements, not an installed-app size",
    "candidate is the complete unpacked folder measured logically after following package file links",
    "runtime is one idle packaged z-video.exe working-set sample after 3 seconds; it is not a performance budget or playback sample",
  ],
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`DEVELOPER_NODE_MODULES: ${developer.nodeModules.bytes} bytes (${developer.nodeModules.files} files)`);
console.log(`DEVELOPER_NPM_CACHE: ${developer.npmCache.exists ? `${developer.npmCache.bytes} bytes (${developer.npmCache.files} files)` : `unavailable (${developer.npmCache.reason})`}`);
console.log(`CANDIDATE_PACKAGE: ${candidate.bytes} bytes (${candidate.files} files)`);
console.log(`RUNTIME_WORKING_SET: ${runtime.workingSetBytes} bytes (pid=${runtime.pid}, sample=${runtime.sample})`);
console.log(`REPORT: ${reportPath}`);
