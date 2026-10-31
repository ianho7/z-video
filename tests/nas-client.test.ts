import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";

import {
  NasApiClient,
  NasError,
  normalizeLanUrl,
  type AuthenticatedSession,
  type NasEpisode,
} from "../src/main/nas-client";

const FIXTURE_PUBLIC_KEY =
  "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6HscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";

interface RequestRecord {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface PlannedResponse {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function startFixtureServer(plans: PlannedResponse[]) {
  const requests: RequestRecord[] = [];
  let index = 0;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      headers: request.headers,
      body: await readBody(request),
    });
    const plan = plans[index++];
    if (!plan) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "UNPLANNED" }));
      return;
    }
    response.writeHead(plan.status ?? 200, { "content-type": "application/json", ...(plan.headers ?? {}) });
    response.end(JSON.stringify(plan.body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

function keyResponse() {
  return { code: 200, data: { key: FIXTURE_PUBLIC_KEY, sign: "fixture-sign", name: "Fixture NAS" } };
}

function stateResponse() {
  return { code: 200, data: { nasid: "fixture-nas" } };
}

function formBody(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

test("login encrypts credentials, refines nas_id, and preserves nas_sign separately", async (t) => {
  const fixture = await startFixtureServer([
    { body: keyResponse() },
    { body: { code: 200, data: { token: "fixture-session", is_local: 0 } } },
    { body: stateResponse() },
  ]);
  t.after(() => fixture.close());

  const session = await new NasApiClient().login({
    serverUrl: fixture.baseUrl,
    username: "fixture-user",
    password: "fixture-password",
  });

  assert.equal(session.token, "fixture-session");
  assert.equal(session.nasId, "fixture-nas");
  assert.equal(session.nasSign, "fixture-sign");
  assert.notEqual(session.nasId, session.nasSign);
  assert.equal(session.isLocal, false);

  assert.equal(fixture.requests[0].method, "GET");
  assert.equal(fixture.requests[0].path, "/key/pub?signme=1");
  assert.equal(fixture.requests[1].method, "POST");
  assert.match(fixture.requests[1].path, /^\/auth\/login\?&drnd=/);
  const loginForm = formBody(fixture.requests[1].body);
  assert.notEqual(loginForm.get("username"), "fixture-user");
  assert.notEqual(loginForm.get("password"), "fixture-password");
  assert.equal(loginForm.get("plat"), "pc");
  assert.equal(loginForm.get("device_id"), "z-video-client-01");

  assert.equal(fixture.requests[2].method, "GET");
  const stateUrl = new URL(`http://fixture${fixture.requests[2].path}`);
  assert.equal(stateUrl.pathname, "/zhelper/state");
  assert.equal(stateUrl.searchParams.get("token"), "fixture-session");
});

test("LAN URL normalization keeps the Rust protocol defaults", () => {
  assert.equal(normalizeLanUrl("192.168.1.100"), "http://192.168.1.100:5055");
  assert.equal(normalizeLanUrl("https://192.168.1.100"), "https://192.168.1.100:5050");
  assert.throws(() => normalizeLanUrl("http://user:password@192.168.1.100"), /不能包含账号或密码/);
});

test("successful login without helper-state nas_id is not promoted to a library session", async (t) => {
  const fixture = await startFixtureServer([
    { body: keyResponse() },
    { body: { code: 200, data: { token: "fixture-session" } } },
    { body: { code: 200, data: {} } },
  ]);
  t.after(() => fixture.close());

  await assert.rejects(
    () => new NasApiClient().login({ serverUrl: fixture.baseUrl, username: "fixture-user", password: "fixture-password" }),
    (error: unknown) => error instanceof NasError && error.kind === "malformed" && error.message.includes("nas_id"),
  );
});

test("classification owner sends session context and filters disabled system categories", async (t) => {
  const fixture = await startFixtureServer([
    {
      body: {
        code: 200,
        data: [
          { id: "movie", name: "电影", is_system: 1, is_enable: 1, collection_count: 12 },
          { id: "hidden", name: "隐藏", is_system: 1, is_enable: 0, count: 99 },
          { id: "custom", name: "自建", is_system: 0, is_enable: 0, count: 3 },
        ],
      },
    },
  ]);
  t.after(() => fixture.close());

  const session: AuthenticatedSession = {
    baseUrl: fixture.baseUrl,
    username: "fixture-user",
    token: "fixture-session",
    nasId: "fixture-nas",
    nasSign: "fixture-sign",
    nasName: "Fixture NAS",
  };
  const classifications = await new NasApiClient().getClassifications(session);

  assert.deepEqual(
    classifications.map((item) => [item.id, item.count]),
    [
      ["movie", 12],
      ["custom", 3],
    ],
  );
  const request = fixture.requests[0];
  assert.match(request.path, /^\/zvideo\/classification\/list\?&drnd=/);
  const body = formBody(request.body);
  assert.equal(body.get("token"), "fixture-session");
  assert.equal(body.get("nasid"), "fixture-nas");
  assert.equal(body.get("app"), "video");
  assert.equal(body.get("plat"), "pc");
  assert.equal(body.get("version"), "2.3.0");
  assert.equal(body.get("device_id"), "z-video-client-01");
  assert.match(String(request.headers.cookie), /nas_id=fixture-nas/);
  assert.match(String(request.headers.cookie), /sign=fixture-sign/);
});

test("classification 401 is unauthorized rather than an empty library", async (t) => {
  const fixture = await startFixtureServer([{ status: 401, body: { code: "N001401" } }]);
  t.after(() => fixture.close());

  await assert.rejects(
    () =>
      new NasApiClient().getClassifications({
        baseUrl: fixture.baseUrl,
        username: "fixture-user",
        token: "expired-session",
        nasId: "fixture-nas",
        nasSign: "fixture-sign",
      }),
    (error: unknown) => error instanceof NasError && error.kind === "unauthorized",
  );
});

test("classification business failure and malformed data stay observable", async (t) => {
  const fixture = await startFixtureServer([
    { body: { code: "T000001", message: "分类参数无效", data: null } },
    { body: { code: 200, data: { count: 0 } } },
  ]);
  t.after(() => fixture.close());

  const session: AuthenticatedSession = {
    baseUrl: fixture.baseUrl,
    username: "fixture-user",
    token: "fixture-session",
    nasId: "fixture-nas",
    nasSign: "fixture-sign",
  };
  await assert.rejects(
    () => new NasApiClient().getClassifications(session),
    (error: unknown) => error instanceof NasError && error.kind === "business" && error.code === "T000001",
  );
  await assert.rejects(
    () => new NasApiClient().getClassifications(session),
    (error: unknown) => error instanceof NasError && error.kind === "malformed" && error.message.includes("data array"),
  );
});

test("MFA keeps NAS sign, cloud key id, and opaque proof in their separate protocol roles", async (t) => {
  const nas = await startFixtureServer([
    { body: keyResponse() },
    { body: keyResponse() },
    { body: keyResponse() },
    { body: { code: 200, data: { token: "fixture-session", is_local: true } } },
    { body: stateResponse() },
  ]);
  const cloud = await startFixtureServer([
    { body: { code: 200, data: { key: FIXTURE_PUBLIC_KEY, key_id: "cloud-key-id" } } },
    { body: { code: 200, data: {} } },
    { body: { code: 200, data: { key: FIXTURE_PUBLIC_KEY, key_id: "cloud-key-id" } } },
    { body: { code: 200, data: { sms_proof: "opaque-proof" } } },
  ]);
  t.after(() => Promise.all([nas.close(), cloud.close()]));

  const client = new NasApiClient({ mfaCloudBaseUrl: cloud.baseUrl });
  await client.sendMfaCode(nas.baseUrl, "fixture-user", "sms");
  const proof = await client.verifyMfaCode(nas.baseUrl, "fixture-user", "123456");
  assert.equal(proof.value, "opaque-proof");
  const loggedIn = await client.login({ serverUrl: nas.baseUrl, username: "fixture-user", password: "fixture-password" }, proof);
  assert.equal(loggedIn.token, "fixture-session");

  const sendForm = formBody(cloud.requests[1].body);
  assert.equal(sendForm.get("key_id"), "cloud-key-id");
  assert.equal(sendForm.get("nasid"), "fixture-sign");
  assert.equal(sendForm.get("type"), "sms");
  assert.notEqual(sendForm.get("username"), "fixture-user");
  const verifyForm = formBody(cloud.requests[3].body);
  assert.equal(verifyForm.get("key_id"), "cloud-key-id");
  assert.equal(verifyForm.get("nasid"), "fixture-sign");
  assert.equal(verifyForm.get("sms_code"), "123456");
  const loginForm = formBody(nas.requests[3].body);
  assert.equal(loginForm.get("sms_proof"), "opaque-proof");
});

function playbackEpisode(overrides: Partial<NasEpisode> = {}): NasEpisode {
  return {
    episodeId: "episode-01",
    episodeNumber: 1,
    title: "Fixture episode",
    seasonNumber: 1,
    filePath: "/private/fixture/movie.mkv",
    videoId: "video-01",
    ...overrides,
  };
}

function playbackSession(baseUrl: string): AuthenticatedSession {
  return {
    baseUrl,
    username: "fixture-user",
    token: "fixture-session",
    nasId: "fixture-nas",
    nasSign: "fixture-sign",
  };
}

test("playback stream keeps NAS query, token header and separated cookie identity", async (t) => {
  const fixture = await startFixtureServer([
    {
      body: {
        code: 200,
        data: {
          uri: "/stream/fixture-episode",
          audio_list: [{ index: 0, language: "原声" }],
          subtitle_list: [{ index: 1, language: "中文" }],
          future_server_field: { keep: true },
        },
      },
    },
  ]);
  t.after(() => fixture.close());

  const stream = await new NasApiClient().getPlaybackStream(playbackSession(fixture.baseUrl), playbackEpisode());
  assert.equal(stream.uri, `${fixture.baseUrl}/stream/fixture-episode`);
  assert.deepEqual(stream.audioList, [{ index: 0, language: "原声" }]);
  assert.deepEqual(stream.subtitleList, [{ index: 1, language: "中文" }]);
  assert.deepEqual(stream.extraFields, { future_server_field: { keep: true } });

  const request = fixture.requests[0];
  assert.equal(request.method, "GET");
  const url = new URL(`http://fixture${request.path}`);
  assert.equal(url.pathname, "/transcode/play");
  assert.ok(url.searchParams.get("drnd"));
  assert.equal(url.searchParams.get("plat"), "pc");
  assert.equal(url.searchParams.get("file_path"), "/private/fixture/movie.mkv");
  assert.equal(url.searchParams.get("play_env"), "1");
  assert.equal(url.searchParams.get("video_codec"), "hevc,h264,mpeg4");
  assert.equal(url.searchParams.get("support_format"), "3");
  assert.equal(url.searchParams.get("from"), "");
  assert.equal(url.searchParams.get("version"), "2.3.0");
  assert.equal(url.searchParams.get("device_id"), "z-video-client-01");
  assert.equal(url.searchParams.get("device"), "z-video-desktop");
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(request.headers.token, "fixture-session");
  assert.match(String(request.headers.cookie), /nas_id=fixture-nas/);
  assert.match(String(request.headers.cookie), /sign=fixture-sign/);
  assert.equal(JSON.stringify(stream).includes("fixture-session"), false);
});

test("playback stream uses decrypt route and only falls back from a 404", async (t) => {
  const fixture = await startFixtureServer([
    { body: { code: 404, message: "新播放接口不可用" } },
    { body: { code: 200, data: { uri: "/legacy/fixture-stream" } } },
  ]);
  t.after(() => fixture.close());

  const stream = await new NasApiClient().getPlaybackStream(
    playbackSession(fixture.baseUrl),
    playbackEpisode({ encryptedPath: "/private/fixture/encrypted" }),
  );

  assert.equal(stream.uri, `${fixture.baseUrl}/legacy/fixture-stream`);
  assert.equal(new URL(`http://fixture${fixture.requests[0].path}`).pathname, "/transcode/decrypt/play");
  assert.equal(new URL(`http://fixture${fixture.requests[1].path}`).pathname, "/transcode/decrypt/playaddr");
  assert.equal(new URL(`http://fixture${fixture.requests[0].path}`).searchParams.get("encrypted_path"), "/private/fixture/encrypted");
});

test("playback stream does not disguise unauthorized or malformed responses as legacy success", async (t) => {
  const unauthorized = await startFixtureServer([{ status: 401, body: { code: "N001401" } }]);
  const malformed = await startFixtureServer([{ body: { code: 200, data: {} } }]);
  t.after(() => Promise.all([unauthorized.close(), malformed.close()]));

  await assert.rejects(
    () => new NasApiClient().getPlaybackStream(playbackSession(unauthorized.baseUrl), playbackEpisode()),
    (error: unknown) => error instanceof NasError && error.kind === "unauthorized",
  );
  assert.equal(unauthorized.requests.length, 1);
  await assert.rejects(
    () => new NasApiClient().getPlaybackStream(playbackSession(malformed.baseUrl), playbackEpisode()),
    (error: unknown) => error instanceof NasError && error.kind === "malformed",
  );
  assert.equal(malformed.requests.length, 1);
});

test("progress owner sends the exact form and rejects a business error", async (t) => {
  const fixture = await startFixtureServer([
    { body: { code: 200, data: {} } },
    { body: { code: "T000001", message: "进度参数无效" } },
  ]);
  t.after(() => fixture.close());
  const client = new NasApiClient();
  const session = playbackSession(fixture.baseUrl);
  await client.updatePlaybackProgress(session, {
    collectionId: "collection-01",
    classificationId: "movie",
    videoId: "video-01",
    sec: 42,
    chapter: 2,
    audioIndex: 1,
    subtitleIndex: -1,
    subtitleHash: "hash-01",
    videoDuration: 120,
    subtitleSetting: JSON.stringify({ font: "small" }),
  });

  const request = fixture.requests[0];
  assert.equal(request.method, "POST");
  assert.equal(new URL(`http://fixture${request.path}`).pathname, "/zvideo/video/updateplaytime");
  const form = formBody(request.body);
  assert.deepEqual(Object.fromEntries(form), {
    collection_id: "collection-01",
    classification_id: "movie",
    video_id: "video-01",
    sec: "42",
    chapter: "2",
    audio_index: "1",
    subtitle_index: "-1",
    subtitle_hash: "hash-01",
    video_duration: "120",
    subtitle_setting: '{"font":"small"}',
  });
  assert.equal(request.headers.token, "fixture-session");
  assert.match(String(request.headers.cookie), /nas_id=fixture-nas/);
  assert.match(String(request.headers.cookie), /sign=fixture-sign/);

  await assert.rejects(
    () => client.updatePlaybackProgress(session, {
      collectionId: "collection-01",
      classificationId: "movie",
      videoId: "video-01",
      sec: 43,
      chapter: 2,
      audioIndex: 1,
      subtitleIndex: -1,
    }),
    (error: unknown) => error instanceof NasError && error.kind === "business" && error.code === "T000001",
  );
});
