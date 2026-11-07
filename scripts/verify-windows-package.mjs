import { closeSync, openSync } from "node:fs";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const packageRoot = resolve(process.env.Z_VIDEO_PACKAGE_DIR ?? join(root, "release", "z-video-win32-x64"));
const executable = join(packageRoot, "z-video.exe");
const profile = await mkdtemp(join(tmpdir(), "z-video-package-smoke-"));
const evidenceDir = join(root, ".scratch", "local-library", "runs", `05-package-${Date.now()}-${process.pid}`);
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

async function reserveDebugPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not reserve a local debug port");
  const port = address.port;
  await new Promise((resolveResult, reject) => server.close((error) => error ? reject(error) : resolveResult()));
  return port;
}

async function waitForRenderer(child, port, readinessPath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) return undefined;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = Array.isArray(targets) && targets.find((target) => target?.type === "page" && typeof target.url === "string" && target.url.endsWith("/index.html") && typeof target.webSocketDebuggerUrl === "string");
        if (page) {
          const diagnostics = await readFile(readinessPath, "utf8").catch(() => "");
          if (diagnostics.includes('"operation":"window.renderer-ready"')) return page;
        }
      }
    } catch {
      // The standard Electron debug endpoint is not ready yet.
    }
    await new Promise((resolveResult) => setTimeout(resolveResult, 100));
  }
  return undefined;
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

async function evaluateRenderer(webSocketUrl, expression) {
  return await new Promise((resolveResult, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("renderer CDP evaluation timed out"));
    }, 10_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) reject(new Error(`renderer CDP evaluation failed: ${JSON.stringify(message.error)}`));
      else resolveResult(message.result?.result?.value);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("renderer CDP websocket failed"));
    });
  });
}

await assertFile(executable, "packaged executable");
await assertFile(join(packageRoot, "z-video_wer.dll"), "renamed crash reporter");
await assertFile(join(packageRoot, "vendor", "mpv", "libmpv-2.dll"), "packaged libmpv DLL");
await assertFile(join(packageRoot, "resources", "app", "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"), "packaged Koffi prebuild");
await assertFile(join(packageRoot, "resources", "app", "dist", "src", "main", "main.js"), "packaged main entry");
await assertFile(join(packageRoot, "resources", "app", "dist", "src", "main", "local-library-worker.js"), "packaged local-library utility worker");
await assertFile(join(packageRoot, "resources", "app", "node_modules", "fast-xml-parser", "lib", "fxp.cjs"), "packaged fast-xml-parser runtime");
await assertFile(join(packageRoot, "resources", "app", "node_modules", "fast-xml-builder", "package.json"), "packaged fast-xml-parser dependency closure");

try {
  const probeCode = [
    "const path = require('node:path');",
    "const koffi = require(path.join(process.cwd(), 'resources', 'app', 'node_modules', 'koffi'));",
    "const lib = koffi.load(path.join(process.cwd(), 'vendor', 'mpv', 'libmpv-2.dll'));",
    "const version = lib.func('uint32_t mpv_client_api_version()')();",
    "const { XMLParser } = require(path.join(process.cwd(), 'resources', 'app', 'node_modules', 'fast-xml-parser'));",
    "const parsed = new XMLParser({ processEntities: false }).parse('<movie><title>packaged-owned-fixture</title></movie>');",
    "console.log(JSON.stringify({ koffi: koffi.version, mpvClientApi: version, xmlTitle: parsed.movie.title }));",
  ].join(" ");
  const probe = await runChild(executable, ["-e", probeCode], {
    cwd: packageRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", Z_VIDEO_MPV_DLL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.code !== 0) throw new Error(`native binding/DLL probe failed: ${probe.stderr || probe.stdout}`);
  if (!probe.stdout.includes('packaged-owned-fixture')) throw new Error(`packaged XML parser probe returned no title: ${probe.stdout}`);
  console.log(`PASS: packaged Koffi/libmpv/XML probe ${probe.stdout.trim()}`);

  const appLogFd = openSync(appLogPath, "w");
  const debugPort = await reserveDebugPort();
  const appProcess = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`], {
    cwd: packageRoot,
    env: { ...process.env, Z_VIDEO_NATIVE_BACKDROP: "0", Z_VIDEO_LOG_DIR: join(profile, "logs"), Z_VIDEO_MPV_DLL: "" },
    stdio: ["ignore", appLogFd, appLogFd],
    windowsHide: true,
  });
  let appSpawnError;
  appProcess.once("error", (error) => { appSpawnError = error; });
  try {
    const rendererTarget = appSpawnError ? undefined : await waitForRenderer(appProcess, debugPort, join(profile, "logs", "diagnostics.jsonl"), 10_000);
    if (appSpawnError || !rendererTarget) {
      const result = { code: appProcess.exitCode, signal: appProcess.signalCode };
      throw new Error(`packaged app did not expose a ready production renderer: ${JSON.stringify(result)}${appSpawnError ? ` error=${appSpawnError.message}` : ""} log=${appLogPath}\n${await logTail(appLogPath)}`);
    }
    const query = await evaluateRenderer(rendererTarget.webSocketDebuggerUrl, `(async () => {
      const result = await window.zVideo.localLibrary.list({ page: 1, pageSize: 10 });
      const serialized = JSON.stringify(result);
      return {
        sqliteAvailable: result.state?.sqliteAvailable === true,
        stateStatus: result.state?.status,
        totalCount: result.page?.totalCount,
        itemCount: Array.isArray(result.page?.items) ? result.page.items.length : -1,
        pathFree: !/[A-Za-z]:\\\\|\\\\\\\\/.test(serialized),
      };
    })()`);
    if (!query || query.sqliteAvailable !== true || query.stateStatus !== "ready" || query.totalCount !== 0 || query.itemCount !== 0 || query.pathFree !== true) {
      throw new Error(`packaged renderer DB query failed: ${JSON.stringify(query)}`);
    }
    await writeFile(join(evidenceDir, "packaged-db-query.json"), `${JSON.stringify(query, null, 2)}\n`, "utf8");
    console.log(`PASS: packaged production renderer ready and local SQLite list query returned an empty safe page (pid=${appProcess.pid}, url=${rendererTarget.url}, userData=${profile}, log=${appLogPath})`);
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
