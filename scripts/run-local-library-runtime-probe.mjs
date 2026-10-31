import { closeSync, existsSync, openSync } from "node:fs";
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
const entry = join(root, "scripts", "local-library-runtime-probe.cjs");
const evidenceDir = join(root, ".scratch", "local-library", `runtime-${Date.now()}-${process.pid}`);
const logPath = join(evidenceDir, "runtime.log");
await mkdir(evidenceDir, { recursive: true });

const logFd = openSync(logPath, "w");
const child = spawn(electronBinary, ["--disable-gpu", entry], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, Z_VIDEO_RUNTIME_PROBE_LOG: logPath },
  stdio: ["ignore", logFd, logFd],
  windowsHide: true,
});
const deadline = Date.now() + 20_000;
let output = "";
while (Date.now() < deadline && child.exitCode === null) {
  output = await readFile(logPath, "utf8").catch(() => "");
  if (output.includes("utilityProcess node:sqlite open/query/reopen")) break;
  await new Promise((resolveResult) => setTimeout(resolveResult, 100));
}
output = await readFile(logPath, "utf8").catch(() => output);
const passed = output.includes("utilityProcess node:sqlite open/query/reopen");
if (passed && child.exitCode === null && child.pid) {
  child.kill();
  await new Promise((resolveResult) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", resolveResult);
    killer.once("exit", resolveResult);
  });
}
closeSync(logFd);
if (!passed) throw new Error(`local runtime probe failed log=${logPath}\n${output}`);
console.log(`PASS: Electron utilityProcess node:sqlite capability gate (log=${logPath})`);
