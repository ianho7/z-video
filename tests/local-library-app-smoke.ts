import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow } from "electron";

async function run(): Promise<void> {
  const profile = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "z-video-local-app-smoke-"));
  const logDir = join(profile, "logs");
  process.env.Z_VIDEO_LOG_DIR = logDir;
  app.setPath("userData", profile);
  app.setPath("sessionData", join(profile, "session"));
  require("../src/main/main.js");

  const startedAt = Date.now();
  let window: BrowserWindow | undefined;
  while (Date.now() - startedAt < 10_000) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && !window.isDestroyed() && window.webContents.getURL().endsWith("/index.html")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(window && !window.isDestroyed(), "production main did not create a BrowserWindow");
  await new Promise((resolve) => setTimeout(resolve, 180));
  const initial = await window.webContents.executeJavaScript(`({
    localApi: typeof window.zVideo.localLibrary === "object",
    loginView: Boolean(document.querySelector('[data-view="login"]')),
    empty: document.querySelector('#library-empty')?.hidden === false,
    sourceText: document.querySelector('#source-list')?.textContent || ''
  })`, true) as { localApi: boolean; loginView: boolean; empty: boolean; sourceText: string };
  assert.equal(initial.localApi, true);
  assert.equal(initial.loginView, false);
  assert.equal(initial.empty, true);
  assert.match(initial.sourceText, /尚未添加来源/);

  await new Promise<void>((resolve) => {
    app.once("will-quit", () => resolve());
    app.quit();
  });
  const diagnostics = await readFile(join(logDir, "diagnostics.jsonl"), "utf8").catch(() => "");
  assert.match(diagnostics, /"operation":"window\.renderer-ready"/);
  assert.match(diagnostics, /"operation":"local-library\.list"/);
  assert.doesNotMatch(diagnostics, /session\.restore|session\.login|discovery\.start/);
  await rm(profile, { recursive: true, force: true });
  process.stdout.write("PASS: production main fresh profile starts local library without session/NAS restore\n");
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
