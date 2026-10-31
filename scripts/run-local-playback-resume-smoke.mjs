import { closeSync, existsSync, openSync } from "node:fs";
import { copyFile, mkdtemp, mkdir, readFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const dependencyRoot = existsSync(join(root, "node_modules")) ? join(root, "node_modules") : resolve(root, "..", "..", "node_modules");
const electronPackage = join(dependencyRoot, "electron");
const electronBinaryName = (await readFile(join(electronPackage, "path.txt"), "utf8")).trim();
const electronBinary = join(electronPackage, "dist", electronBinaryName);
const entry = join(root, "dist", "tests", "local-playback-resume-smoke.js");
const evidenceRoot = join(root, ".scratch", "electron-migration", "runs", "local-library");
await mkdir(evidenceRoot, { recursive: true });
const profile = await mkdtemp(join(evidenceRoot, "playback-profile-"));
const fixtureDirectory = join(profile, "owned-fixture");
const fixturePath = join(fixtureDirectory, "test_video.mp4");
const firstResultPath = join(profile, "first-result.json");
const secondResultPath = join(profile, "second-result.json");
const sourceAsset = join(root, "assets", "test_video.mp4");
const logDirectory = join(profile, "logs");
const mpvCandidates = [
  process.env.Z_VIDEO_MPV_DLL,
  join(root, "vendor", "mpv", "libmpv-2.dll"),
  join(resolve(root, "..", ".."), "vendor", "mpv", "libmpv-2.dll"),
].filter((value) => value && existsSync(value));
const mpvPath = mpvCandidates[0];
if (!mpvPath) throw new Error("local playback smoke requires a Windows libmpv-2.dll");

await mkdir(fixtureDirectory, { recursive: true });
await mkdir(logDirectory, { recursive: true });
await copyFile(sourceAsset, fixturePath);

const firstLog = await runStage("first", firstResultPath);
const first = JSON.parse(await readFile(firstResultPath, "utf8"));
const secondLog = await runStage("second", secondResultPath);
const second = JSON.parse(await readFile(secondResultPath, "utf8"));
if (first.mediaId !== second.mediaId) throw new Error("fresh process changed the opaque mediaId");
if (!(second.positionSec >= Math.max(6, first.positionSec - 0.75))) {
  throw new Error(`fresh process resume was not near the committed position: first=${first.positionSec} second=${second.positionSec}`);
}
console.log(`PASS: production local playback persisted observed native position and restored it in a fresh Electron process (mediaId=${first.mediaId}, first=${first.positionSec.toFixed(2)}s, second=${second.positionSec.toFixed(2)}s, logs=${firstLog},${secondLog}, profile=${profile})`);

async function runStage(stage, resultPath) {
  const logPath = join(logDirectory, `${stage}.electron.log`);
  const logFd = openSync(logPath, "w");
  const child = spawn(electronBinary, ["--disable-gpu", entry], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      Z_VIDEO_LOCAL_PLAYBACK_STAGE: stage,
      Z_VIDEO_LOCAL_PLAYBACK_PROFILE: profile,
      Z_VIDEO_LOCAL_PLAYBACK_FIXTURE: fixturePath,
      Z_VIDEO_LOCAL_PLAYBACK_RESULT: resultPath,
      Z_VIDEO_LOCAL_PLAYBACK_FIRST_RESULT: firstResultPath,
      Z_VIDEO_LOG_DIR: logDirectory,
      Z_VIDEO_MPV_DLL: mpvPath,
    },
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  const timeout = setTimeout(() => child.kill(), 45_000);
  const [code, signal] = await once(child, "exit");
  clearTimeout(timeout);
  closeSync(logFd);
  const output = await readFile(logPath, "utf8").catch(() => "");
  if (code !== 0) throw new Error(`local playback ${stage} smoke failed code=${code} signal=${signal ?? "none"} log=${logPath}\n${output}`);
  return logPath;
}
