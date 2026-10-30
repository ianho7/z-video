import { networkInterfaces } from "node:os";

import type { AppError, DiscoveryOutcome, DiscoveryReport as PublicDiscoveryReport } from "../shared/contracts";
import { recordNasRequest } from "./diagnostics";

export const NAS_PORT = 5055;

export interface DiscoveryConfig {
  timeoutMs: number;
  maxConcurrency: number;
  maxHosts: number;
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  timeoutMs: 450,
  maxConcurrency: 32,
  maxHosts: 1024,
};

export interface Ipv4Network {
  address: string;
  prefixLength: number;
}

/** Data retained in main only while a probe result is being handled. */
export interface NasDiscoveryDevice {
  ip: string;
  name?: string;
  nasId?: string;
  nasSign?: string;
  available: boolean;
}

export interface NasDiscoveryReport {
  results: NasDiscoveryDevice[];
  candidateCount: number;
  truncated: boolean;
}

export type DiscoveryErrorKind =
  | "configuration"
  | "no-local-network"
  | "timeout"
  | "network"
  | "malformed"
  | "business"
  | "cancelled";

export class DiscoveryError extends Error {
  readonly name = "DiscoveryError";

  constructor(
    readonly kind: DiscoveryErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class DiscoveryCancellation {
  private readonly controller = new AbortController();

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  cancel(): void {
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  isCancelled(): boolean {
    return this.controller.signal.aborted;
  }
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type NetworkProvider = () => Promise<Ipv4Network[]>;

export interface DiscoveryDependencies {
  fetcher?: FetchLike;
  networkProvider?: NetworkProvider;
}

export interface DiscoveryService {
  discover(cancellation?: DiscoveryCancellation): Promise<NasDiscoveryReport>;
}

interface ApiResponse {
  code: unknown;
  data?: unknown;
  msg?: unknown;
  message?: unknown;
  reason?: unknown;
}

/** Builds the one fallback probe that confirms a host is a NAS candidate. */
export function buildProbeUrl(ip: string): string {
  assertIpv4(ip);
  return `http://${ip}:${NAS_PORT}/key/pub?signme=1`;
}

/**
 * Parses the confirmed public-key response. The key is validated and then
 * discarded; only the optional display name and opaque sign remain in main.
 */
export function parseProbeResponse(body: string, ip: string): NasDiscoveryDevice {
  assertIpv4(ip);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DiscoveryError("malformed", "JSON 结构无效");
  }

  const response = asRecord(parsed, "响应格式无效") as unknown as ApiResponse;
  if (!isSuccess(response.code)) {
    throw new DiscoveryError("business", errorMessage(response), codeString(response.code));
  }
  const data = asRecord(response.data, "响应缺少 data");
  const key = stringValue(data.key);
  if (!key) throw new DiscoveryError("malformed", "响应缺少有效 NAS 公钥");

  return {
    ip,
    ...(stringValue(data.name) ? { name: stringValue(data.name) } : {}),
    // /key/pub's sign is a signature context, not the helper-state nas_id.
    ...(stringValue(data.sign) ? { nasSign: stringValue(data.sign) } : {}),
    nasId: undefined,
    available: true,
  };
}

/** Parses English or Chinese ipconfig output without sending any network request. */
export function parseLocalIpv4Networks(output: string): Ipv4Network[] {
  const networks: Ipv4Network[] = [];
  let address: string | undefined;

  for (const line of output.split(/\r?\n/)) {
    const values = ipv4Values(line);
    const lower = line.toLocaleLowerCase();
    if ((lower.includes("ipv4") || lower.includes("ip address") || line.includes("IPv4 地址")) && values.length > 0) {
      address = values[0];
    }
    if (lower.includes("subnet mask") || line.includes("子网掩码")) {
      const mask = values[0];
      if (address && mask && isPrivateIpv4(address)) {
        const prefixLength = maskToPrefix(mask);
        if (prefixLength !== undefined && !networks.some((item) => item.address === address && item.prefixLength === prefixLength)) {
          networks.push({ address, prefixLength });
        }
      }
      address = undefined;
    }
  }
  return networks;
}

/** Expands only private network hosts, respecting the Rust owner's hard cap. */
export function expandCandidates(networks: Ipv4Network[], maxHosts: number): { candidates: string[]; truncated: boolean } {
  const candidates: string[] = [];
  let truncated = false;

  for (const network of networks) {
    if (network.prefixLength > 30 || candidates.length >= maxHosts) {
      truncated = true;
      break;
    }
    const mask = networkMask(network.prefixLength);
    const networkAddress = (ipv4ToNumber(network.address) & mask) >>> 0;
    const hostCount = 2 ** (32 - network.prefixLength) - 2;
    for (let offset = 1; offset <= hostCount; offset += 1) {
      if (candidates.length >= maxHosts) {
        truncated = true;
        break;
      }
      candidates.push(numberToIpv4(networkAddress + offset));
    }
  }

  return { candidates, truncated };
}

export class LocalNasDiscovery implements DiscoveryService {
  private readonly config: DiscoveryConfig;
  private readonly fetcher: FetchLike;
  private readonly networkProvider: NetworkProvider;

  constructor(config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG, dependencies: DiscoveryDependencies = {}) {
    this.config = config;
    this.fetcher = dependencies.fetcher ?? globalThis.fetch.bind(globalThis);
    this.networkProvider = dependencies.networkProvider ?? defaultNetworkProvider;
  }

  async discover(cancellation = new DiscoveryCancellation()): Promise<NasDiscoveryReport> {
    validateConfig(this.config);
    if (cancellation.isCancelled()) throw new DiscoveryError("cancelled", "扫描已取消");

    let networks: Ipv4Network[];
    try {
      networks = await this.networkProvider();
    } catch (error) {
      throw new DiscoveryError("no-local-network", error instanceof Error ? error.message : "无法读取本机网卡信息");
    }
    if (cancellation.isCancelled()) throw new DiscoveryError("cancelled", "扫描已取消");

    const { candidates, truncated } = expandCandidates(networks, this.config.maxHosts);
    if (candidates.length === 0) throw new DiscoveryError("no-local-network", "没有可扫描的本机私有 IPv4 网段");

    let nextIndex = 0;
    const results: NasDiscoveryDevice[] = [];
    const worker = async (): Promise<void> => {
      while (true) {
        if (cancellation.isCancelled()) throw new DiscoveryError("cancelled", "扫描已取消");
        const index = nextIndex;
        nextIndex += 1;
        const ip = candidates[index];
        if (!ip) return;
        const result = await probeHost(this.fetcher, ip, this.config.timeoutMs, cancellation);
        if (result) results.push(result);
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.config.maxConcurrency, candidates.length) }, () => worker()));
    if (cancellation.isCancelled()) throw new DiscoveryError("cancelled", "扫描已取消");

    results.sort((left, right) => ipv4ToNumber(left.ip) - ipv4ToNumber(right.ip));
    return { results, candidateCount: candidates.length, truncated };
  }
}

/** Functional owner boundary retained for focused protocol tests and callers. */
export function discoverLocalNas(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
  cancellation = new DiscoveryCancellation(),
  dependencies: DiscoveryDependencies = {},
): Promise<NasDiscoveryReport> {
  return new LocalNasDiscovery(config, dependencies).discover(cancellation);
}

export class DiscoveryController {
  private nextRequestId = 0;
  private active?: { requestId: number; cancellation: DiscoveryCancellation };

  constructor(private readonly service: DiscoveryService = new LocalNasDiscovery()) {}

  async start(): Promise<DiscoveryOutcome> {
    const requestId = ++this.nextRequestId;
    this.active?.cancellation.cancel();
    const cancellation = new DiscoveryCancellation();
    this.active = { requestId, cancellation };

    try {
      const report = await this.service.discover(cancellation);
      if (!this.isCurrent(requestId)) return { status: "stale", requestId };
      if (cancellation.isCancelled()) return { status: "cancelled", requestId };
      return { status: "success", requestId, report: toPublicReport(report) };
    } catch (error) {
      if (!this.isCurrent(requestId)) return { status: "stale", requestId };
      if (cancellation.isCancelled() || (error instanceof DiscoveryError && error.kind === "cancelled")) {
        return { status: "cancelled", requestId };
      }
      return { status: "error", requestId, error: toAppError(error) };
    } finally {
      if (this.isCurrent(requestId)) this.active = undefined;
    }
  }

  cancel(): { cancelled: boolean } {
    if (!this.active) return { cancelled: false };
    this.active.cancellation.cancel();
    return { cancelled: true };
  }

  private isCurrent(requestId: number): boolean {
    return this.active?.requestId === requestId;
  }
}

async function probeHost(fetcher: FetchLike, ip: string, timeoutMs: number, cancellation: DiscoveryCancellation): Promise<NasDiscoveryDevice | undefined> {
  const startedAt = Date.now();
  const timeoutController = new AbortController();
  let timedOut = false;
  const onCancel = () => timeoutController.abort();
  cancellation.signal.addEventListener("abort", onCancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  try {
    const response = await fetcher(buildProbeUrl(ip), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: timeoutController.signal,
    });
    if (cancellation.isCancelled()) throw new DiscoveryError("cancelled", "扫描已取消");
    const body = await response.text();
    if (response.status !== 200) {
      throw new DiscoveryError(response.status === 401 || response.status === 403 ? "business" : "network", `HTTP ${response.status}`, String(response.status));
    }
    const result = parseProbeResponse(body, ip);
    await recordNasRequest("discovery.probe", "GET", "/key/pub?signme=1", "success", startedAt, {
      httpStatus: response.status,
      parseResult: "success",
      businessResult: "success",
      nasSignPresent: Boolean(result.nasSign),
    });
    return result;
  } catch (error) {
    if (cancellation.isCancelled()) throw new DiscoveryError("cancelled", "扫描已取消");
    const normalized = timedOut || isAbortError(error)
      ? new DiscoveryError("timeout", "发现请求超时")
      : error instanceof DiscoveryError
        ? error
        : new DiscoveryError("network", "连接失败");
    await recordNasRequest("discovery.probe", "GET", "/key/pub?signme=1", "error", startedAt, {
      parseResult: normalized.kind === "malformed" ? "error" : "not_parsed",
      businessResult: normalized.kind === "business" ? "error" : "not_checked",
      errorKind: normalized.kind,
      errorCode: normalized.code,
    });
    return undefined;
  } finally {
    clearTimeout(timeout);
    cancellation.signal.removeEventListener("abort", onCancel);
  }
}

async function defaultNetworkProvider(): Promise<Ipv4Network[]> {
  const interfaces = networkInterfaces();
  const networks: Ipv4Network[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (((entry.family as string | number) !== "IPv4" && (entry.family as string | number) !== 4) || !isPrivateIpv4(entry.address)) continue;
      const prefixLength = maskToPrefix(entry.netmask);
      if (prefixLength === undefined) continue;
      if (!networks.some((item) => item.address === entry.address && item.prefixLength === prefixLength)) {
        networks.push({ address: entry.address, prefixLength });
      }
    }
  }
  if (networks.length === 0) throw new Error("未找到私有 IPv4 地址和子网掩码");
  return networks;
}

function toPublicReport(report: NasDiscoveryReport): PublicDiscoveryReport {
  return {
    candidateCount: report.candidateCount,
    truncated: report.truncated,
    results: report.results.map((result) => ({
      ip: result.ip,
      name: result.name?.trim() || "未命名 NAS",
      available: result.available,
    })),
  };
}

function toAppError(error: unknown): AppError {
  if (error instanceof DiscoveryError) {
    const kind: AppError["kind"] = error.kind === "business" ? "business" : error.kind === "malformed" ? "malformed" : error.kind === "configuration" ? "unknown" : "network";
    return { kind, code: error.code, message: userMessage(error) };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : "NAS 自动发现失败" };
}

function userMessage(error: DiscoveryError): string {
  switch (error.kind) {
    case "no-local-network":
      return `未发现可扫描的本机私有局域网：${error.message}。请确认电脑已连接 Wi-Fi/网线，或手动输入 NAS 地址。`;
    case "timeout":
      return "NAS 扫描超时。请确认 NAS 与电脑在同一局域网后重试。";
    case "network":
      return `NAS 扫描失败：${error.message}。请确认 NAS 与电脑在同一局域网。`;
    case "malformed":
      return `发现到设备但响应格式无法识别：${error.message}。`;
    case "business":
      return `设备返回发现错误（${error.code ?? "unknown"}）：${error.message}。`;
    case "configuration":
      return `扫描配置无效：${error.message}。`;
    case "cancelled":
      return "已取消 NAS 扫描。";
  }
}

function validateConfig(config: DiscoveryConfig): void {
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) throw new DiscoveryError("configuration", "超时时间必须大于 0");
  if (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency <= 0) throw new DiscoveryError("configuration", "并发上限必须大于 0");
  if (!Number.isInteger(config.maxHosts) || config.maxHosts <= 0) throw new DiscoveryError("configuration", "扫描主机上限必须大于 0");
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DiscoveryError("malformed", message);
  return value as Record<string, unknown>;
}

function isSuccess(value: unknown): boolean {
  const code = codeString(value);
  return code === "200" || code === "S000200";
}

function codeString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "unknown";
}

function errorMessage(response: ApiResponse): string {
  for (const candidate of [response.message, response.msg, response.reason]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "未知错误";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function ipv4Values(line: string): string[] {
  return line
    .split(/[^0-9.]+/)
    .filter((part) => part.length > 0)
    .filter((part) => isIpv4(part));
}

function assertIpv4(value: string): void {
  if (!isIpv4(value)) throw new DiscoveryError("configuration", `IPv4 地址无效: ${value}`);
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPrivateIpv4(value: string): boolean {
  if (!isIpv4(value)) return false;
  const [first, second] = value.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function maskToPrefix(mask: string): number | undefined {
  if (!isIpv4(mask)) return undefined;
  const number = ipv4ToNumber(mask);
  let prefixLength = 0;
  for (let bit = 31; bit >= 0 && ((number >>> bit) & 1) === 1; bit -= 1) prefixLength += 1;
  const expected = networkMask(prefixLength);
  return expected === number ? prefixLength : undefined;
}

function networkMask(prefixLength: number): number {
  if (prefixLength === 0) return 0;
  return (0xffffffff << (32 - prefixLength)) >>> 0;
}

function ipv4ToNumber(value: string): number {
  return value.split(".").reduce((result, part) => result * 256 + Number(part), 0);
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

