const { app, utilityProcess } = require("electron");
const { appendFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const profile = mkdtempSync(join(tmpdir(), "z-video-local-runtime-probe-"));
let worker;
let finished = false;
const logPath = process.env.Z_VIDEO_RUNTIME_PROBE_LOG || join(process.cwd(), ".scratch", "local-library-runtime-probe.log");
function log(message) {
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}
log(`main-start electron=${process.versions.electron} node=${process.versions.node}`);
app.setPath("userData", profile);
const workerPath = join(__dirname, "local-library-runtime-worker.cjs");

function finish(code, message) {
  if (finished) return;
  finished = true;
  log(`finish code=${code} message=${message || ""}`);
  if (message) process.stdout.write(`${message}\n`);
  worker?.kill();
  rmSync(profile, { recursive: true, force: true });
  process.exit(code);
}

app.whenReady().then(() => {
  log("app-ready");
  worker = utilityProcess.fork(workerPath, [], { serviceName: "z-video-local-library-runtime-probe" });
  const timeout = setTimeout(() => finish(1, "FAIL: utility sqlite probe timed out"), 10_000);
  worker.once("exit", (code) => {
    clearTimeout(timeout);
    finish(code === 0 ? 0 : 1, `FAIL: utility sqlite worker exited with ${code}`);
  });
  worker.once("error", (type, location) => {
    clearTimeout(timeout);
    finish(1, `FAIL: utility sqlite worker error ${type} ${location}`);
  });
  worker.on("message", ({ data }) => {
    log(`worker-message ${JSON.stringify(data)}`);
    clearTimeout(timeout);
    if (data?.ok) {
      finish(0, `PASS: Electron ${process.versions.electron} utilityProcess node:sqlite open/query/reopen ${JSON.stringify(data.result)}`);
    } else {
      finish(1, `FAIL: ${data?.message ?? "unknown utility sqlite error"}`);
    }
  });
  worker.postMessage({ dbPath: join(profile, "probe.sqlite") });
}).catch((error) => finish(1, `FAIL: Electron startup ${error instanceof Error ? error.message : String(error)}`));
