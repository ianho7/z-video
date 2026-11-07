const { DatabaseSync } = require("node:sqlite");
const { appendFileSync } = require("node:fs");
const logPath = process.env.Z_VIDEO_RUNTIME_PROBE_LOG || "local-library-runtime-probe.log";
const log = (message) => appendFileSync(logPath, `${new Date().toISOString()} worker ${message}\n`, "utf8");
log("start");

process.parentPort.on("message", ({ data }) => {
  log(`message ${JSON.stringify(data)}`);
  try {
    const first = new DatabaseSync(data.dbPath);
    first.exec("CREATE TABLE probe (value TEXT NOT NULL); INSERT INTO probe (value) VALUES ('utility-process');");
    const value = first.prepare("SELECT value FROM probe").get().value;
    first.close();
    const reopened = new DatabaseSync(data.dbPath);
    const count = reopened.prepare("SELECT COUNT(*) AS count FROM probe").get().count;
    reopened.close();
    process.parentPort.postMessage({ data: { ok: true, result: { value, count } } });
    log("success");
    process.exit(0);
  } catch (error) {
    process.parentPort.postMessage({ data: { ok: false, message: error instanceof Error ? error.message : String(error) } });
    log(`error ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  }
});
