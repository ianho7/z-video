import { createServer } from "node:http";
import { closeSync, openSync } from "node:fs";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const electronPackage = join(root, "node_modules", "electron");
const electronBinaryName = (await readFile(join(electronPackage, "path.txt"), "utf8")).trim();
const electronBinary = join(electronPackage, "dist", electronBinaryName);
const entry = join(root, "dist", "tests", "safe-storage-process-smoke.js");
const profile = await mkdtemp(join(tmpdir(), "z-video-safe-storage-"));
const evidenceDir = join(root, ".scratch", "electron-migration", "runs", `05-safe-storage-${Date.now()}-${process.pid}`);
await mkdir(evidenceDir, { recursive: true });

const fixtureKey = "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6HscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";

function writeJson(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const fixtureServer = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://fixture").pathname;
  request.resume();
  if (pathname === "/key/pub") return writeJson(response, { code: 200, data: { key: fixtureKey, sign: "synthetic-sign", name: "Synthetic NAS" } });
  if (pathname === "/auth/login") return writeJson(response, { code: 200, data: { token: "synthetic-session", username: "synthetic-user", is_local: 1 } });
  if (pathname === "/zhelper/state") return writeJson(response, { code: 200, data: { nas_id: "synthetic-nas" } });
  if (pathname === "/zvideo/classification/list") return writeJson(response, { code: 200, data: [{ id: "movie", name: "电影", is_system: 1, is_enable: 1, collection_count: 1 }] });
  return writeJson(response, { code: "NOT_FOUND" }, 404);
});

fixtureServer.listen(0, "127.0.0.1");
await once(fixtureServer, "listening");
const fixtureAddress = fixtureServer.address();
if (!fixtureAddress || typeof fixtureAddress === "string") throw new Error("safeStorage fixture did not bind to a TCP port");
const fixtureBaseUrl = `http://127.0.0.1:${fixtureAddress.port}`;

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

async function logTail(logPath) {
  const contents = await readFile(logPath, "utf8").catch(() => "");
  return contents.length > 4_000 ? contents.slice(-4_000) : contents;
}

function runPhase(phase) {
  const logPath = join(evidenceDir, `${phase}.log`);
  return new Promise((resolveResult, reject) => {
    const logFd = openSync(logPath, "w");
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    Object.assign(childEnv, {
      Z_VIDEO_SAFE_STORAGE_PHASE: phase,
      Z_VIDEO_SAFE_STORAGE_PROFILE: profile,
      Z_VIDEO_SAFE_STORAGE_FIXTURE_URL: fixtureBaseUrl,
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
      reject(new Error(`safeStorage ${phase} process timed out after 30s; log=${logPath}\n${await logTail(logPath)}`));
    }, 30_000);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      closeSync(logFd);
      callback();
    };
    child.once("error", (error) => finish(() => reject(new Error(`safeStorage ${phase} process could not start; log=${logPath}`, { cause: error }))));
    child.once("exit", async (code, signal) => {
      if (code === 0) {
        finish(() => resolveResult({ code, signal, logPath }));
        return;
      }
      const tail = await logTail(logPath);
      finish(() => reject(new Error(`safeStorage ${phase} process failed: code=${code ?? "null"} signal=${signal ?? "none"}; log=${logPath}\n${tail}`)));
    });
  });
}

try {
  const save = await runPhase("save");
  const sessionPath = join(profile, "session.bin");
  const session = await stat(sessionPath);
  if (session.size === 0) throw new Error("safeStorage session.bin is empty");
  const encrypted = await readFile(sessionPath, "utf8");
  if (encrypted.includes("synthetic-session") || encrypted.includes("synthetic-password")) throw new Error("safeStorage file contains synthetic plaintext");

  await runPhase("restore");
  console.log(`PASS: Windows Electron safeStorage recovered synthetic session across two fresh processes (${session.size} bytes)`);
  console.log(`Evidence logs: ${evidenceDir}`);
} finally {
  fixtureServer.close();
  await once(fixtureServer, "close").catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
}
