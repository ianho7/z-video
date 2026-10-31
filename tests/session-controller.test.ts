import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { NasApiClient, type AuthenticatedSession, NasError, type ClassificationResult, type MfaProof } from "../src/main/nas-client";
import { SessionController, type NasGateway, type PersistedSession, type SessionStore } from "../src/main/session-controller";

const FIXTURE_PUBLIC_KEY =
  "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALKZ8KjQHGuJZx7HK65jCfI+UW7q/ts6HscZzFC0iwFeQjlj5XCKn2/iDsJwjssh0wR7oQNtt0fsAcoEE8VF9C8CAwEAAQ==";

async function startServer(responses: Array<{ status?: number; body: unknown }>) {
  let index = 0;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    for await (const _chunk of request) {
      // Drain request bodies before responding, as a real NAS server would.
    }
    const plan = responses[index++];
    response.writeHead(plan?.status ?? 200, { "content-type": "application/json" });
    response.end(JSON.stringify(plan?.body ?? { code: "UNPLANNED" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

class MemorySessionStore implements SessionStore {
  saved?: PersistedSession;

  async load(): Promise<PersistedSession | null> {
    return this.saved ? { ...this.saved } : null;
  }

  async save(session: PersistedSession): Promise<void> {
    this.saved = { ...session };
  }

  async clear(): Promise<void> {
    this.saved = undefined;
  }
}

class SwitchingGateway implements NasGateway {
  deferAccountA = false;
  pendingAccountA?: { reject: (error: unknown) => void };

  async login(request: { serverUrl: string; username: string; password: string }): Promise<AuthenticatedSession> {
    return {
      baseUrl: request.serverUrl,
      username: request.username,
      token: `token-${request.username}`,
      nasId: `nas-${request.username}`,
    };
  }

  async getClassifications(session: AuthenticatedSession): Promise<ClassificationResult[]> {
    if (session.username === "account-a" && this.deferAccountA) {
      this.deferAccountA = false;
      return new Promise((_resolve, reject) => {
        this.pendingAccountA = { reject };
      });
    }
    return [{ id: "movie", name: "电影", count: 1, isSystem: true, isEnabled: true }];
  }

  async sendMfaCode(): Promise<void> {}

  async verifyMfaCode(): Promise<MfaProof> {
    throw new Error("MFA not used in this test");
  }
}

function keyResponse() {
  return { code: 200, data: { key: FIXTURE_PUBLIC_KEY, sign: "fixture-sign", name: "Fixture NAS" } };
}

function classResponse() {
  return { code: 200, data: [{ id: "movie", name: "电影", is_system: 1, is_enable: 1, count: 12 }] };
}

test("session controller saves only an opaque session and restores classifications in a fresh controller", async (t) => {
  const fixture = await startServer([
    { body: keyResponse() },
    { body: { code: 200, data: { token: "fixture-session", is_local: 1 } } },
    { body: { code: 200, data: { nasid: "fixture-nas" } } },
    { body: classResponse() },
    { body: classResponse() },
  ]);
  t.after(() => fixture.close());

  const store = new MemorySessionStore();
  const first = new SessionController(new NasApiClient(), store);
  const loggedIn = await first.login({
    serverUrl: fixture.baseUrl,
    username: "fixture-user",
    password: "fixture-password",
    remember: true,
  });

  assert.equal(loggedIn.status, "authenticated");
  assert.equal(loggedIn.classifications[0]?.id, "movie");
  assert.equal(loggedIn.identity?.nasId, "fixture-nas");
  assert.equal(JSON.stringify(loggedIn).includes("fixture-session"), false);
  assert(store.saved);
  assert.equal(store.saved.token, "fixture-session");
  assert.equal(store.saved.nasId, "fixture-nas");
  assert.equal(store.saved.nasSign, "fixture-sign");
  assert.equal("password" in store.saved, false);

  const afterRestart = new SessionController(new NasApiClient(), store);
  const restored = await afterRestart.restore();
  assert.equal(restored.status, "authenticated");
  assert.equal(restored.identity?.username, "fixture-user");
  assert.equal(restored.classifications[0]?.count, 12);
});

test("unauthorized restore clears persisted session and returns to login", async (t) => {
  const fixture = await startServer([{ status: 401, body: { code: "N001401" } }]);
  t.after(() => fixture.close());
  const store = new MemorySessionStore();
  await store.save({
    baseUrl: fixture.baseUrl,
    username: "fixture-user",
    token: "expired-session",
    nasId: "fixture-nas",
    nasSign: "fixture-sign",
  });

  const state = await new SessionController(new NasApiClient(), store).restore();
  assert.equal(state.status, "logged-out");
  assert.equal(state.error?.kind, "unauthorized");
  assert.equal(await store.load(), null);
});

test("remembered playback context persists only collection, classification and episode IDs", async (t) => {
  const fixture = await startServer([
    { body: classResponse() },
    { body: classResponse() },
  ]);
  t.after(() => fixture.close());
  const store = new MemorySessionStore();
  await store.save({
    baseUrl: fixture.baseUrl,
    username: "fixture-user",
    token: "fixture-session",
    nasId: "fixture-nas",
    nasSign: "fixture-sign",
  });
  const first = new SessionController(new NasApiClient(), store);
  assert.equal((await first.restore()).status, "authenticated");
  await first.setLastPlayback({ collectionId: "collection-01", classificationId: "movie", episodeId: "episode-01" });
  assert.deepEqual(store.saved?.lastPlayback, { collectionId: "collection-01", classificationId: "movie", episodeId: "episode-01" });
  assert.equal(JSON.stringify(store.saved).includes("position"), false);

  const afterRestart = new SessionController(new NasApiClient(), store);
  assert.equal((await afterRestart.restore()).status, "authenticated");
  assert.deepEqual(afterRestart.getLastPlayback(), { collectionId: "collection-01", classificationId: "movie", episodeId: "episode-01" });
});

test("late classifications from account A cannot invalidate the current account B", async () => {
  const gateway = new SwitchingGateway();
  const controller = new SessionController(gateway, new MemorySessionStore());

  assert.equal((await controller.login({ serverUrl: "http://nas-a", username: "account-a", password: "a", remember: false })).status, "authenticated");
  gateway.deferAccountA = true;
  const accountARead = controller.listClassifications();
  await new Promise((resolve) => setImmediate(resolve));

  const accountBState = await controller.login({ serverUrl: "http://nas-b", username: "account-b", password: "b", remember: false });
  assert.equal(accountBState.status, "authenticated");
  gateway.pendingAccountA?.reject(new NasError("unauthorized", "account A expired", undefined, 401));

  const lateResult = await accountARead;
  assert.equal(lateResult.state.status, "authenticated");
  assert.equal(lateResult.state.identity?.username, "account-b");
  assert.equal(controller.getPublicState().identity?.username, "account-b");
});
