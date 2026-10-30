import assert from "node:assert/strict";
import test from "node:test";

import {
  DiscoveryCancellation,
  DiscoveryController,
  DiscoveryError,
  LocalNasDiscovery,
  buildProbeUrl,
  expandCandidates,
  parseLocalIpv4Networks,
  parseProbeResponse,
  type DiscoveryDependencies,
  type DiscoveryService,
  type NasDiscoveryReport,
} from "../src/main/discovery";

const NAS_RESPONSE = JSON.stringify({
  code: 200,
  data: { key: "fixture-public-key", sign: "opaque-sign", name: "客厅 NAS" },
});

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

test("discovery probe uses the confirmed key endpoint and keeps sign separate from nas_id", () => {
  assert.equal(buildProbeUrl("192.168.5.2"), "http://192.168.5.2:5055/key/pub?signme=1");

  const result = parseProbeResponse(NAS_RESPONSE, "192.168.5.2");
  assert.equal(result.ip, "192.168.5.2");
  assert.equal(result.name, "客厅 NAS");
  assert.equal(result.nasId, undefined);
  assert.equal(result.nasSign, "opaque-sign");
  assert.equal(result.available, true);
});

test("discovery parser rejects malformed and business responses", () => {
  assert.throws(
    () => parseProbeResponse('{"code":200,"data":{"key":""}}', "192.168.5.2"),
    (error: unknown) => error instanceof DiscoveryError && error.kind === "malformed",
  );
  assert.throws(
    () => parseProbeResponse('{"code":403,"msg":"forbidden","data":null}', "192.168.5.2"),
    (error: unknown) => error instanceof DiscoveryError && error.kind === "business" && error.code === "403",
  );
});

test("local network parsing and candidate expansion stay private and bounded", () => {
  const networks = parseLocalIpv4Networks(`
    IPv4 Address. . . . . . . . . . . : 198.18.0.1
    Subnet Mask . . . . . . . . . . . : 255.255.255.252
    IPv4 Address. . . . . . . . . . . : 192.168.5.9
    Subnet Mask . . . . . . . . . . . : 255.255.255.0
  `);
  assert.deepEqual(networks, [{ address: "192.168.5.9", prefixLength: 24 }]);

  const expanded = expandCandidates(networks, 3);
  assert.deepEqual(expanded, {
    candidates: ["192.168.5.1", "192.168.5.2", "192.168.5.3"],
    truncated: true,
  });
});

test("local discovery probes through the owner boundary without contacting real NAS addresses", async () => {
  const requests: string[] = [];
  const dependencies: DiscoveryDependencies = {
    networkProvider: async () => [{ address: "192.168.5.9", prefixLength: 30 }],
    fetcher: async (input) => {
      requests.push(String(input));
      return jsonResponse(NAS_RESPONSE);
    },
  };
  const report = await new LocalNasDiscovery({ timeoutMs: 100, maxConcurrency: 2, maxHosts: 8 }, dependencies).discover();

  assert.deepEqual(report.results.map(({ ip, name, available }) => ({ ip, name, available })), [
    { ip: "192.168.5.9", name: "客厅 NAS", available: true },
    { ip: "192.168.5.10", name: "客厅 NAS", available: true },
  ]);
  assert.deepEqual(requests.sort((left, right) => left.localeCompare(right, undefined, { numeric: true })), [
    "http://192.168.5.9:5055/key/pub?signme=1",
    "http://192.168.5.10:5055/key/pub?signme=1",
  ]);
});

test("cancelling discovery aborts the in-flight probes", async () => {
  const cancellation = new DiscoveryCancellation();
  const dependencies: DiscoveryDependencies = {
    networkProvider: async () => [{ address: "192.168.5.9", prefixLength: 30 }],
    fetcher: (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  };
  const pending = new LocalNasDiscovery({ timeoutMs: 1_000, maxConcurrency: 2, maxHosts: 8 }, dependencies).discover(cancellation);
  await new Promise((resolve) => setTimeout(resolve, 10));
  cancellation.cancel();

  await assert.rejects(pending, (error: unknown) => error instanceof DiscoveryError && error.kind === "cancelled");
});

class DelayedDiscoveryService implements DiscoveryService {
  private callCount = 0;

  discover(): Promise<NasDiscoveryReport> {
    this.callCount += 1;
    const call = this.callCount;
    return new Promise((resolve) => {
      setTimeout(() => resolve({
        results: [{ ip: `192.168.5.${call}`, name: `NAS ${call}`, nasId: undefined, nasSign: `sign-${call}`, available: true }],
        candidateCount: 1,
        truncated: false,
      }), call === 1 ? 30 : 5);
    });
  }
}

test("discovery controller rejects a stale result after a newer user action", async () => {
  const controller = new DiscoveryController(new DelayedDiscoveryService());
  const first = controller.start();
  await new Promise((resolve) => setTimeout(resolve, 1));
  const second = controller.start();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, "stale");
  assert.equal(secondResult.status, "success");
  if (secondResult.status === "success") {
    assert.deepEqual(secondResult.report.results, [{ ip: "192.168.5.2", name: "NAS 2", available: true }]);
  }
});
