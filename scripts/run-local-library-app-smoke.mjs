import { closeSync, existsSync, openSync } from "node:fs";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const dependencyRoot = existsSync(join(root, "node_modules")) ? join(root, "node_modules") : resolve(root, "..", "..", "node_modules");
const electronPackage = join(dependencyRoot, "electron");
const electronBinaryName = (await readFile(join(electronPackage, "path.txt"), "utf8")).trim();
const electronBinary = join(electronPackage, "dist", electronBinaryName);
const entry = join(root, "dist", "tests", "local-library-app-smoke.js");
const evidenceDir = join(root, ".scratch", "local-library", `app-${Date.now()}-${process.pid}`);
const logPath = join(evidenceDir, "electron.log");
await mkdir(evidenceDir, { recursive: true });

const logFd = openSync(logPath, "w");
const child = spawn(electronBinary, ["--disable-gpu", entry], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: ["ignore", logFd, logFd],
  windowsHide: true,
});
async function stopOwnedProcess() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  if (child.exitCode !== null || !child.pid) return;
  await new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", resolve);
    killer.once("exit", resolve);
  });
}
const timeout = setTimeout(() => { void stopOwnedProcess(); }, 60_000);
const [code, signal] = await once(child, "exit");
clearTimeout(timeout);
closeSync(logFd);
const output = await readFile(logPath, "utf8").catch(() => "");
if (code !== 0) throw new Error(`local app smoke failed code=${code} signal=${signal ?? "none"} log=${logPath}\n${output}`);
console.log(`PASS: production main local-library app smoke (log=${logPath})`);
