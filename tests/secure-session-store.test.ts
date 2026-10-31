import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ElectronSecureSessionStore, type SafeStorageLike } from "../src/main/secure-session-store";

class FixtureSafeStorage implements SafeStorageLike {
  constructor(private readonly available = true) {}

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(value: string): Buffer {
    return Buffer.from(Buffer.from(value, "utf8").toString("base64"), "utf8");
  }

  decryptString(value: Buffer): string {
    return Buffer.from(value.toString("utf8"), "base64").toString("utf8");
  }
}

test("secure session store round-trips encrypted session without writing token plaintext", async () => {
  const directory = await mkdtemp(join(tmpdir(), "z-video-session-"));
  const path = join(directory, "session.bin");
  try {
    const store = new ElectronSecureSessionStore(new FixtureSafeStorage(), path);
    const session = {
      baseUrl: "http://127.0.0.1:5055",
      username: "fixture-user",
      token: "fixture-session",
      nasId: "fixture-nas",
      nasSign: "fixture-sign",
      lastPlayback: { collectionId: "collection-01", classificationId: "movie", episodeId: "episode-01" },
    };
    await store.save(session);
    const onDisk = await readFile(path, "utf8");
    assert.equal(onDisk.includes("fixture-session"), false);
    assert.equal(onDisk.includes("episode-01"), false);
    assert.equal(onDisk.includes("position"), false);
    assert.deepEqual(await store.load(), session);
    await store.clear();
    assert.equal(await store.load(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("secure session store reports unavailable platform encryption", async () => {
  const store = new ElectronSecureSessionStore(new FixtureSafeStorage(false), join(tmpdir(), "z-video-never-written.bin"));
  await assert.rejects(() => store.save({ baseUrl: "http://127.0.0.1:5055", username: "user", token: "token" }), /safeStorage/);
});
