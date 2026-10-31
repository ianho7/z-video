import assert from "node:assert/strict";
import { join } from "node:path";

import { app } from "electron";

import { LibraryController } from "../src/main/library-controller";
import { NasApiClient } from "../src/main/nas-client";
import { registerIpcHandlers } from "../src/main/ipc";
import { createElectronSecureSessionStore } from "../src/main/secure-session-store";
import { SessionController } from "../src/main/session-controller";
import { createMainWindow } from "../src/main/window";

const phase = process.env.Z_VIDEO_SAFE_STORAGE_PHASE;
const profile = process.env.Z_VIDEO_SAFE_STORAGE_PROFILE;
const fixtureBaseUrl = process.env.Z_VIDEO_SAFE_STORAGE_FIXTURE_URL;
if (phase !== "save" && phase !== "restore") throw new Error("Z_VIDEO_SAFE_STORAGE_PHASE must be save or restore");
if (!profile) throw new Error("Z_VIDEO_SAFE_STORAGE_PROFILE is required");
if (!fixtureBaseUrl) throw new Error("Z_VIDEO_SAFE_STORAGE_FIXTURE_URL is required");

app.setPath("userData", profile);
app.setPath("sessionData", join(profile, "session"));

async function waitForAuthenticated(window: ReturnType<typeof createMainWindow>): Promise<{ loggedIn: boolean; username: string; loginStatus: string; libraryMessage: string }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = (await window.webContents.executeJavaScript(
      `({ loggedIn: document.querySelector('[data-view="library"]')?.hidden === false, username: document.querySelector('#session-user')?.textContent || '', loginStatus: document.querySelector('#login-status')?.textContent || '', libraryMessage: document.querySelector('#library-message')?.textContent || '' })`,
      true,
    )) as { loggedIn: boolean; username: string; loginStatus: string; libraryMessage: string };
    if (state.loggedIn) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return (await window.webContents.executeJavaScript(
    `({ loggedIn: document.querySelector('[data-view="library"]')?.hidden === false, username: document.querySelector('#session-user')?.textContent || '', loginStatus: document.querySelector('#login-status')?.textContent || '', libraryMessage: document.querySelector('#library-message')?.textContent || '' })`,
    true,
  )) as { loggedIn: boolean; username: string; loginStatus: string; libraryMessage: string };
}

async function run(): Promise<void> {
  await app.whenReady();
  const nas = new NasApiClient();
  const sessions = new SessionController(nas, createElectronSecureSessionStore());
  const library = new LibraryController(sessions, nas);
  registerIpcHandlers(sessions, library);
  const window = createMainWindow();
  await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));

  if (phase === "save") {
    await window.webContents.executeJavaScript(
      `(() => { document.querySelector('#server-url').value = ${JSON.stringify(fixtureBaseUrl)}; document.querySelector('#username').value = 'synthetic-user'; document.querySelector('#password').value = 'synthetic-password'; document.querySelector('#login-form').requestSubmit(); return true; })()`,
      true,
    );
  }
  const state = await waitForAuthenticated(window);
  assert.equal(state.loggedIn, true, `${phase} phase did not reach authenticated library: ${state.loginStatus || state.libraryMessage || "no status"}`);
  assert.match(state.username, /synthetic-user/);
  console.log(`SAFE_STORAGE_PHASE=${phase} PASS username=${state.username}`);
  window.close();
}

run()
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
