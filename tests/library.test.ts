import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { NasApiClient, NasError, type AuthenticatedSession } from "../src/main/nas-client";

interface PlannedResponse {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface RequestRecord {
  method: string;
  path: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

async function startFixtureServer(plans: PlannedResponse[]) {
  const requests: RequestRecord[] = [];
  let index = 0;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
    const plan = plans[index++];
    response.writeHead(plan?.status ?? 200, { "content-type": "application/json", ...(plan?.headers ?? {}) });
    response.end(JSON.stringify(plan?.body ?? { code: "UNPLANNED" }));
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

function session(baseUrl: string): AuthenticatedSession {
  return {
    baseUrl,
    username: "fixture-user",
    token: "fixture-session",
    nasId: "fixture-nas",
    nasSign: "fixture-sign",
  };
}

function formBody(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

test("collection list uses system=94, falls back to system=7 only for an empty page, and normalizes numeric fields", async (t) => {
  const fixture = await startFixtureServer([
    { body: { code: 200, data: { count: "2", list: [] } } },
    {
      body: {
        code: 200,
        data: {
          collection_count: 2,
          list: [
            {
              collection_id:  "movie-01",
              title: "数字年份",
              cover: "/zvideo/cover/movie-01.jpg",
              release_year: 2026,
              video_type: "movie",
              score: 8.6,
              episode_count: "1",
            },
          ],
        },
      },
    },
  ]);
  t.after(() => fixture.close());

  const page = await new NasApiClient().getCollections(session(fixture.baseUrl), "movie", 1, 50);
  assert.equal(page.count, 2);
  assert.equal(page.list[0]?.releaseYear, "2026");
  assert.equal(page.list[0]?.score, "8.6");
  assert.equal(page.list[0]?.episodeCount, 1);
  assert.equal(formBody(fixture.requests[0].body).get("system"), "94");
  assert.equal(formBody(fixture.requests[1].body).get("system"), "7");
});

test("collection list missing data.list is a malformed protocol response, not an empty library", async (t) => {
  const fixture = await startFixtureServer([{ body: { code: 200, data: { count: 0 } } }]);
  t.after(() => fixture.close());

  await assert.rejects(
    () => new NasApiClient().getCollections(session(fixture.baseUrl), "movie", 1, 50),
    (error: unknown) => error instanceof NasError && error.kind === "malformed" && error.message.includes("data.list"),
  );
});

test("collection detail maps seasons and reads legacy history only when v2 omits it", async (t) => {
  const fixture = await startFixtureServer([
    {
      body: {
        code: 200,
        data: {
          collection_id: "series-01",
          title: "多季剧集",
          cover: "/zvideo/cover/series-01.jpg",
          release_year: "2025",
          video_type: "tv",
          list: [
            {
              season_number: "2",
              season_name: "第二季",
              version_list: [
                { video_id: "episode-201", episode: "1", title: "新的一集", duration: "01:02:03", file_path: "/private/episode-201" },
              ],
            },
          ],
        },
      },
    },
    {
      body: {
        code: 200,
        data: { history: { last_video_id: "episode-201", play_duration: "42", audio_index: 1 } },
      },
    },
  ]);
  t.after(() => fixture.close());

  const detail = await new NasApiClient().getCollectionDetail(session(fixture.baseUrl), "series-01", "movie");
  assert.equal(detail.collectionId, "series-01");
  assert.equal(detail.seasons[0]?.seasonNumber, 2);
  assert.equal(detail.seasons[0]?.episodes[0]?.episodeId, "episode-201");
  assert.equal(detail.seasons[0]?.episodes[0]?.durationSec, 3723);
  assert.equal(detail.history?.lastVideoId, "episode-201");
  assert.equal(detail.history?.playDurationSec, 42);
  assert.match(fixture.requests[0].path, /^\/zvideo\/collection\/v2\/info\?&drnd=/);
  assert.match(fixture.requests[1].path, /^\/zvideo\/collection\/info\?&drnd=/);
  assert.equal(formBody(fixture.requests[1].body).get("get_type"), "all");
  assert.equal(formBody(fixture.requests[1].body).get("collection_id"), "series-01");
});

test("path-only episodes receive an opaque selection handle instead of exposing the media path", async (t) => {
  const fixture = await startFixtureServer([
    {
      body: {
        code: 200,
        data: {
          collection_id: "series-path-only",
          title: "路径保护",
          video_type: "tv",
          list: [{
            season_number: 1,
            version_list: [{ episode: 1, title: "仅路径剧集", file_path: "/private/secret/episode-a.mkv" }],
          }],
          history: { last_video_id: "/private/secret/episode-a.mkv", play_duration: 12 },
        },
      },
    },
  ]);
  t.after(() => fixture.close());

  const detail = await new NasApiClient().getCollectionDetail(session(fixture.baseUrl), "series-path-only", "movie");
  const episode = detail.seasons[0]?.episodes[0];
  assert(episode);
  assert.match(episode.episodeId, /^episode-path-/);
  assert.equal(episode.episodeId.includes("/private/"), false);
  assert.equal(episode.filePath, "/private/secret/episode-a.mkv");
});

test("collection detail preserves success without fabricating history when the legacy read fails", async (t) => {
  const fixture = await startFixtureServer([
    {
      body: {
        code: 200,
        data: { collection_id: "movie-01", title: "无历史", video_type: "movie", list: [] },
      },
    },
    { status: 500, body: { code: "HISTORY_FAILED" } },
  ]);
  t.after(() => fixture.close());

  const detail = await new NasApiClient().getCollectionDetail(session(fixture.baseUrl), "movie-01", "movie");
  assert.equal(detail.history, undefined);
  assert.equal(detail.seasons[0]?.episodes[0]?.episodeId, "movie-01");
});

test("image fetch returns a data URL while diagnostics expose only the stable image route", async (t) => {
  const fixture = await startFixtureServer([
    { status: 200, headers: { "content-type": "image/jpeg" }, body: "not-really-json" },
  ]);
  t.after(() => fixture.close());

  const image = await new NasApiClient().fetchImage(session(fixture.baseUrl), "/private/cover.jpg");
  assert.equal(image.mimeType, "image/jpeg");
  assert.match(image.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(fixture.requests[0].path, "/private/cover.jpg?app=video&plat=pc");
});

test("image fetch rejects a direct external URL before sending NAS credentials", async (t) => {
  const origin = await startFixtureServer([]);
  const external = await startFixtureServer([{ status: 200, body: "external" }]);
  t.after(() => Promise.all([origin.close(), external.close()]));

  await assert.rejects(
    () => new NasApiClient().fetchImage(session(origin.baseUrl), `${external.baseUrl}/direct.jpg`),
    (error: unknown) => error instanceof NasError && error.kind === "malformed",
  );
  assert.equal(origin.requests.length, 0);
  assert.equal(external.requests.length, 0);
});

test("image fetch blocks a cross-origin redirect without forwarding NAS credentials", async (t) => {
  const external = await startFixtureServer([{ status: 200, body: "external" }]);
  const origin = await startFixtureServer([{
    status: 302,
    headers: { location: `${external.baseUrl}/redirected.jpg` },
    body: "redirect",
  }]);
  t.after(() => Promise.all([origin.close(), external.close()]));

  await assert.rejects(
    () => new NasApiClient().fetchImage(session(origin.baseUrl), "/redirect.jpg"),
    (error: unknown) => error instanceof NasError && error.kind === "malformed",
  );
  assert.equal(origin.requests.length, 1);
  assert.equal(origin.requests[0]?.headers.token, "fixture-session");
  assert.equal(String(origin.requests[0]?.headers.cookie).includes("fixture-sign"), true);
  assert.equal(external.requests.length, 0);
});
