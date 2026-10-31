import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { LibraryController } from "../src/main/library-controller";
import { MainPlaybackHost, type PlaybackNasGateway } from "../src/main/player-host";
import { type AuthenticatedSession, type ClassificationResult, type MfaProof, type NasCollectionDetail, type NasCollectionPage, type NasEpisode, type NasImage, type NasPlaybackProgress, type NasPlaybackStream } from "../src/main/nas-client";
import { registerIpcHandlers } from "../src/main/ipc";
import { SessionController, type NasGateway, type PersistedSession, type SessionStore } from "../src/main/session-controller";

const samplePath = join(process.cwd(), "assets", "test_video.mp4");

class MemoryStore implements SessionStore {
  private saved?: PersistedSession;

  async load(): Promise<PersistedSession | null> { return this.saved ? { ...this.saved } : null; }
  async save(session: PersistedSession): Promise<void> { this.saved = { ...session }; }
  async clear(): Promise<void> { this.saved = undefined; }
}

class FixturePlaybackNas implements NasGateway, PlaybackNasGateway {
  readonly progress: NasPlaybackProgress[] = [];
  constructor(private readonly streamUri: string) {}

  async login(): Promise<AuthenticatedSession> {
    return { baseUrl: "http://fixture-nas:5055", username: "fixture-user", token: "fixture-session", nasId: "fixture-nas", nasSign: "fixture-sign" };
  }
  async getClassifications(_session: AuthenticatedSession): Promise<ClassificationResult[]> { return []; }
  async sendMfaCode(_baseUrl: string, _username: string, _challengeType?: string): Promise<void> {}
  async verifyMfaCode(_baseUrl: string, _username: string, _code: string): Promise<MfaProof> { throw new Error("not used"); }
  async getCollections(_session: AuthenticatedSession, _classificationId: string, _start: number, _limit: number): Promise<NasCollectionPage> { return { count: 0, list: [] }; }
  async fetchImage(_session: AuthenticatedSession, _imagePath: string): Promise<NasImage> { return { dataUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", mimeType: "image/gif", bytes: 1 }; }
  async getCollectionDetail(_session: AuthenticatedSession, _collectionId: string, _classificationId: string): Promise<NasCollectionDetail> {
    const episode: NasEpisode = { episodeId: "episode-01", videoId: "video-01", episodeNumber: 1, title: "Fixture episode", seasonNumber: 1, durationSec: 2, filePath: "/private/fixture/movie.mkv" };
    return {
      collectionId: "collection-01",
      title: "Fixture collection",
      coverPath: "",
      backgroundPath: "",
      releaseYear: "2026",
      videoType: "movie",
      seasons: [{ seasonNumber: 1, title: "正片", episodes: [episode] }],
      history: { lastVideoId: "episode-01", playDurationSec: 1, audioIndex: 0, subtitleIndex: -1 },
    };
  }
  async getPlaybackStream(_session: AuthenticatedSession, episode: NasEpisode): Promise<NasPlaybackStream> {
    assert.equal(episode.filePath, "/private/fixture/movie.mkv");
    return { uri: this.streamUri, audioList: [], subtitleList: [], extraFields: {} };
  }
  async updatePlaybackProgress(_session: AuthenticatedSession, progress: NasPlaybackProgress): Promise<void> {
    this.progress.push({ ...progress });
  }
}

async function startMediaServer(): Promise<{ uri: string; close: () => Promise<void> }> {
  const bytes = await readFile(samplePath);
  const server = createServer((request, response) => {
    if (request.url !== "/fixture.mp4") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "video/mp4", "content-length": bytes.length, connection: "close" });
    response.end(bytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    uri: `http://127.0.0.1:${address.port}/fixture.mp4`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

async function waitFor(label: string, predicate: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function run(): Promise<void> {
  assert.equal(process.platform, "win32", "native player smoke is Windows-only");
  const media = await startMediaServer();
  const userData = await mkdtemp(join(tmpdir(), "z-video-nas-player-user-data-"));
  const sessionData = await mkdtemp(join(tmpdir(), "z-video-nas-player-session-data-"));
  app.setPath("userData", userData);
  app.setPath("sessionData", sessionData);
  await app.whenReady();

  const nas = new FixturePlaybackNas(media.uri);
  const sessions = new SessionController(nas, new MemoryStore());
  assert.equal((await sessions.login({ serverUrl: "http://fixture-nas:5055", username: "fixture-user", password: "fixture-password", remember: true })).status, "authenticated");
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    show: true,
    backgroundColor: "#08090b",
    webPreferences: {
      preload: join(__dirname, "..", "src", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const host = new MainPlaybackHost(window, undefined, { sessions, nas });
  registerIpcHandlers(sessions, new LibraryController(sessions, nas), host);
  await window.loadFile(join(__dirname, "..", "src", "renderer", "index.html"));

  try {
    await window.webContents.executeJavaScript(
      "window.zVideo.player.command({type:'open', collectionId:'collection-01', classificationId:'movie', episodeId:'episode-01', startPositionSec:0})",
      true,
    );
    await waitFor("remote HTTP media ready", async () => Boolean(await window.webContents.executeJavaScript("document.querySelector('#player-toggle-button')?.disabled === false", true)));
    await new Promise((resolve) => setTimeout(resolve, 500));
    await window.webContents.executeJavaScript("window.zVideo.player.command({type:'close'})", true);
    await waitFor("remote media close", async () => Boolean(await window.webContents.executeJavaScript("document.querySelector('[data-view=player]')?.hidden === true", true)));
    assert.ok(nas.progress.length > 0, "closing a NAS playback session should flush progress through the owner");
    assert.equal(nas.progress.at(-1)?.collectionId, "collection-01");
    assert.equal(nas.progress.at(-1)?.classificationId, "movie");
    assert.equal(nas.progress.at(-1)?.videoId, "video-01");
  } finally {
    for (const channel of ["player:choose-local-file", "player:choose-subtitle-file", "player:command", "session:restore", "session:login", "session:send-mfa", "session:verify-mfa", "session:logout", "library:list-classifications", "library:list-collections", "library:get-detail", "library:list-continue-watching", "library:load-image", "library:get-navigation", "library:set-navigation", "discovery:start", "discovery:cancel"]) ipcMain.removeHandler(channel);
    await host.close();
    if (!window.isDestroyed()) window.close();
    await app.quit();
    await media.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
