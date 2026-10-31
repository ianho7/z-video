import assert from "node:assert/strict";
import test from "node:test";

import { LibraryController } from "../src/main/library-controller";
import { NasError, type AuthenticatedSession, type ClassificationResult, type MfaProof, type NasCollectionDetail, type NasCollectionPage, type NasImage } from "../src/main/nas-client";
import { SessionController, type NasGateway, type SessionStore } from "../src/main/session-controller";

const session: AuthenticatedSession = {
  baseUrl: "http://fixture-nas:5055",
  username: "fixture-user",
  token: "fixture-session",
  nasId: "fixture-nas",
  nasSign: "fixture-sign",
};

class MemoryStore implements SessionStore {
  saved = false;
  cleared = false;
  async load() { return null; }
  async save() { this.saved = true; }
  async clear() { this.cleared = true; }
}

class FixtureGateway implements NasGateway {
  listCalls: Array<{ classificationId: string; start: number; limit: number }> = [];
  detailCalls: string[] = [];
  imageCalls: string[] = [];
  unauthorized = false;

  async login(_request: { serverUrl: string; username: string; password: string }, _proof?: MfaProof) { return session; }
  async getClassifications(_session: AuthenticatedSession): Promise<ClassificationResult[]> { return [{ id: "movie", name: "电影", count: 3, isSystem: true, isEnabled: true }]; }
  async sendMfaCode(_baseUrl: string, _username: string, _challengeType?: string) {}
  async verifyMfaCode(_baseUrl: string, _username: string, _code: string): Promise<MfaProof> { throw new Error("not used"); }
  async getCollections(_session: AuthenticatedSession, classificationId: string, start: number, limit: number): Promise<NasCollectionPage> {
    this.listCalls.push({ classificationId, start, limit });
    if (this.unauthorized) throw new NasError("unauthorized", "会话已过期", undefined, 401);
    const list = [
      { collectionId: "c01", title: "奥本海默", coverPath: "/private/c01.jpg", backgroundPath: "", releaseYear: "2023", videoType: "movie", score: "8.6" },
      { collectionId: "c02", title: "潮汐线之外", coverPath: "/private/c02.jpg", backgroundPath: "", releaseYear: "2024", videoType: "movie", score: "8.2" },
      { collectionId: "c03", title: "回到光里", coverPath: "", backgroundPath: "", releaseYear: "", videoType: "tv", episodeCount: 3 },
      { collectionId: "c04", title: "半影", coverPath: "/private/c04.jpg", backgroundPath: "", releaseYear: "2024", videoType: "movie", score: "8.6" },
    ];
    return { count: list.length, list: list.slice(start - 1, start - 1 + limit) };
  }
  async getCollectionDetail(_session: AuthenticatedSession, collectionId: string, _classificationId: string): Promise<NasCollectionDetail> {
    this.detailCalls.push(collectionId);
    return {
      collectionId,
      title: "回到光里",
      coverPath: "/private/c03.jpg",
      backgroundPath: "/private/c03-bg.jpg",
      releaseYear: "2022",
      videoType: "tv",
      seasons: [{ seasonNumber: 1, title: "第一季", episodes: [{ episodeId: "episode-02", episodeNumber: 2, title: "借阅卡", durationSec: 600, seasonNumber: 1, filePath: "/private/episode-02" }] }],
      history: { lastVideoId: "episode-02", playDurationSec: 90 },
    };
  }
  async fetchImage(_session: AuthenticatedSession, imagePath: string): Promise<NasImage> {
    this.imageCalls.push(imagePath);
    return { dataUrl: "data:image/jpeg;base64,ZmFrZQ==", mimeType: "image/jpeg", bytes: 4 };
  }
}

async function authenticatedController(gateway: FixtureGateway, store = new MemoryStore()) {
  const sessions = new SessionController(gateway, store);
  const state = await sessions.login({ serverUrl: session.baseUrl, username: session.username, password: "fixture-password", remember: false });
  assert.equal(state.status, "authenticated");
  return { sessions, library: new LibraryController(sessions, gateway), store };
}

test("library controller caches server pages, declares loaded-page search scope, and filters without claiming full-library coverage", async () => {
  const gateway = new FixtureGateway();
  const { library } = await authenticatedController(gateway);
  const first = await library.listCollections({ classificationId: "movie", page: 1, pageSize: 50, filter: "all", sort: "recent" });
  const cached = await library.listCollections({ classificationId: "movie", page: 1, pageSize: 50, filter: "all", sort: "recent" });
  const searched = await library.listCollections({ classificationId: "movie", page: 1, pageSize: 50, query: "奥本", filter: "all", sort: "recent" });

  assert.equal(first.page?.collections.length, 4);
  assert.equal(cached.page?.collections.length, 4);
  assert.equal(searched.page?.collections.length, 1);
  assert.equal(searched.page?.coverage, "loaded-page");
  assert.match(searched.page?.scopeDescription ?? "", /当前已加载范围/);
  assert.equal(gateway.listCalls.length, 1);

  const sortCases = [
    ["score_desc", ["半影", "奥本海默", "潮汐线之外", "回到光里"]],
    ["release_year_desc", ["半影", "潮汐线之外", "奥本海默", "回到光里"]],
  ] as const;
  for (const [sort, expectedTitles] of sortCases) {
    const sorted = await library.listCollections({ classificationId: "movie", page: 1, pageSize: 50, filter: "all", sort });
    assert.deepEqual(sorted.page?.collections.map((collection) => collection.title), expectedTitles);
    assert.equal(sorted.page?.coverage, "loaded-page");
  }
});

test("library controller maps detail history to a real resume item and keeps private paths out of renderer DTOs", async () => {
  const gateway = new FixtureGateway();
  const { library } = await authenticatedController(gateway);
  const result = await library.getDetail({ collectionId: "c03", classificationId: "movie" });
  assert.equal(result.detail?.resume?.episodeId, "episode-02");
  assert.equal(result.detail?.resume?.positionSec, 90);
  assert.equal(JSON.stringify(result.detail).includes("/private/"), false);

  const continueResult = await library.listContinueWatching();
  assert.equal(continueResult.items.length, 1);
  assert.equal(continueResult.items[0]?.progressPercent, 15);
  assert.equal(continueResult.items[0]?.episodeId, "episode-02");

  const imageA = await library.loadImage({ collectionId: "c03", kind: "cover" });
  const imageB = await library.loadImage({ collectionId: "c03", kind: "cover" });
  assert.match(imageA.dataUrl ?? "", /^data:image\/jpeg/);
  assert.equal(imageB.dataUrl, imageA.dataUrl);
  assert.equal(gateway.imageCalls.length, 1);
});

test("continue watching rebuilds the remembered Episode from NAS detail after a fresh controller", async () => {
  const gateway = new FixtureGateway();
  const { library, sessions } = await authenticatedController(gateway);
  await sessions.setLastPlayback({ collectionId: "c03", classificationId: "movie", episodeId: "episode-02" });

  const result = await library.listContinueWatching();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.episodeId, "episode-02");
  assert.deepEqual(gateway.detailCalls, ["c03"]);
});

test("an unauthorized library request clears the session instead of returning an empty page", async () => {
  const gateway = new FixtureGateway();
  const store = new MemoryStore();
  const { library, sessions } = await authenticatedController(gateway, store);
  gateway.unauthorized = true;
  const result = await library.listCollections({ classificationId: "movie", page: 1, pageSize: 50 });
  assert.equal(result.state.status, "logged-out");
  assert.equal(store.cleared, true);
  assert.equal(sessions.getAuthenticatedSession(), undefined);
});
