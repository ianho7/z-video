import { closeSync, existsSync, openSync } from "node:fs";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const entry = join(root, "dist", "tests", "local-library-scale-smoke.js");
const profile = await mkdtemp(join(tmpdir(), "z-video-local-scale-runner-"));
const evidenceDir = join(root, ".scratch", "local-library", "runs", `scale-${Date.now()}-${process.pid}`);
const logPath = join(evidenceDir, "scale.log");
const reportPath = join(evidenceDir, "scale-report.json");
await mkdir(evidenceDir, { recursive: true });

function stopOwnedProcess(child) {
  return new Promise((resolveResult) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveResult();
      return;
    }
    child.kill();
    const finish = () => resolveResult();
    child.once("exit", finish);
    setTimeout(() => {
      if (child.exitCode === null && child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        killer.once("exit", finish);
        killer.once("error", finish);
      } else finish();
    }, 1_000);
  });
}

const logFd = openSync(logPath, "w");
const child = spawn(electronBinary, ["--disable-gpu", entry], {
  cwd: root,
  env: { ...process.env, Z_VIDEO_SCALE_PROFILE: profile },
  stdio: ["ignore", logFd, logFd],
  windowsHide: true,
});
const timeout = setTimeout(() => { void stopOwnedProcess(child); }, 300_000);
const [code, signal] = await once(child, "exit");
clearTimeout(timeout);
closeSync(logFd);
const output = await readFile(logPath, "utf8").catch(() => "");
await rm(profile, { recursive: true, force: true });
if (code !== 0) throw new Error(`local scale smoke failed code=${code} signal=${signal ?? "none"} log=${logPath}\n${output}`);
const match = output.match(/SCALE_RESULT: (\{.*\})/);
if (!match) throw new Error(`local scale smoke produced no SCALE_RESULT log=${logPath}\n${output}`);
const report = JSON.parse(match[1]);
await writeFile(reportPath, `${JSON.stringify({ ...report, log: logPath }, null, 2)}\n`, "utf8");
console.log(`PASS: local library 2,000/20,000 index scale, concurrent list, and offline preservation (report=${reportPath}, log=${logPath})`);
