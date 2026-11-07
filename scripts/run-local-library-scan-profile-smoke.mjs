import { closeSync, existsSync, openSync } from "node:fs";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const dependencyRoots = [join(root, "node_modules"), resolve(root, "..", "..", "node_modules")];
const electronPackage = dependencyRoots
  .map((dependencyRoot) => join(dependencyRoot, "electron"))
  .find((candidate) => existsSync(join(candidate, "path.txt")));
if (!electronPackage) throw new Error("Electron package with an installed path.txt is unavailable");
const electronBinaryName = (await readFile(join(electronPackage, "path.txt"), "utf8")).trim();
const electronBinary = join(electronPackage, "dist", electronBinaryName);
const entry = join(root, "dist", "tests", "local-library-scan-profile-smoke.js");
const evidenceDir = join(root, ".scratch", "local-library", "runs", `scan-profile-${Date.now()}-${process.pid}`);
await mkdir(evidenceDir, { recursive: true });

async function runProfile() {
  const logPath = join(evidenceDir, "electron.log");
  const profilePath = join(evidenceDir, "scan-profile.jsonl");
  const logFd = openSync(logPath, "w");
  const child = spawn(electronBinary, ["--disable-gpu", entry], {
    cwd: root,
    env: { ...process.env, Z_VIDEO_SCAN_PROFILE_PATH: profilePath },
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  const timeout = setTimeout(() => child.kill(), 90_000);
  const [code, signal] = await once(child, "exit");
  clearTimeout(timeout);
  closeSync(logFd);
  const output = await readFile(logPath, "utf8").catch(() => "");
  if (code !== 0) throw new Error(`scan profile smoke failed code=${code} signal=${signal ?? "none"} log=${logPath}\n${output}`);
  const profiles = (await readFile(profilePath, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (profiles.length !== 3) throw new Error(`scan profile smoke expected three profile rows, got ${profiles.length}; log=${logPath}`);
  const repeated = profiles[1];
  const capacity = profiles[2];
  if (repeated.calls?.nfoMetadataCacheHits !== 18 || repeated.calls?.readFile !== 1) {
    throw new Error(`scan profile smoke did not prove changed NFO refresh: ${JSON.stringify(repeated.calls)}; log=${logPath}`);
  }
  if (capacity.calls?.nfoCacheSize > 512 || !(capacity.calls?.nfoCacheEvictions > 0)) {
    throw new Error(`scan profile smoke did not prove bounded NFO cache: ${JSON.stringify(capacity.calls)}; log=${logPath}`);
  }
  return { profiles, logPath };
}

const run = await runProfile();
const reportPath = join(evidenceDir, "scan-profile-report.json");
await writeFile(reportPath, `${JSON.stringify({ fixture: { itemCount: 23, movies: 12, episodes: 11, cacheProbeCount: 520 }, run, report: reportPath }, null, 2)}\n`, "utf8");
console.log(`PASS: local library scan stage profile and bounded NFO cache probe (report=${reportPath})`);
