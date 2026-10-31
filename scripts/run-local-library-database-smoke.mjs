import { closeSync, existsSync, openSync } from "node:fs";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const dependencyRoot = existsSync(join(root, "node_modules")) ? join(root, "node_modules") : resolve(root, "..", "..", "node_modules");
const electronPackage = join(dependencyRoot, "electron");
const electronBinaryName = (await readFile(join(electronPackage, "path.txt"), "utf8")).trim();
const electronBinary = join(electronPackage, "dist", electronBinaryName);
const entry = join(root, "dist", "tests", "local-library-database-smoke.js");
const profile = await mkdtemp(join(tmpdir(), "z-video-local-db-smoke-runner-"));
const evidenceDir = join(root, ".scratch", "local-library", `db-${Date.now()}-${process.pid}`);
const logPath = join(evidenceDir, "electron.log");
await mkdir(evidenceDir, { recursive: true });

const logFd = openSync(logPath, "w");
const child = spawn(electronBinary, ["--disable-gpu", entry], {
  cwd: root,
  env: { ...process.env, Z_VIDEO_LOCAL_DB_SMOKE_PROFILE: profile },
  stdio: ["ignore", logFd, logFd],
  windowsHide: true,
});
const timeout = setTimeout(() => {
  child.kill();
}, 20_000);
const [code, signal] = await once(child, "exit");
clearTimeout(timeout);
closeSync(logFd);
const output = await readFile(`${logPath}`, "utf8").catch(() => "");
await rm(profile, { recursive: true, force: true });
if (code !== 0) throw new Error(`local DB smoke failed code=${code} signal=${signal ?? "none"} log=${logPath}\n${output}`);
console.log(`PASS: local DB owner smoke (log=${logPath})`);
