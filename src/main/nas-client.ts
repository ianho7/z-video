import { constants, createPublicKey, publicEncrypt } from "node:crypto";

import { recordNasRequest } from "./diagnostics";

const MFA_CLOUD_BASE_URL = "https://api.zenithspace.net";
const DEVICE = {
  app: "video",
  platform: "pc",
  version: "2.3.0",
  device: "z-video-desktop",
  deviceId: "z-video-client-01",
  locale: "zh_cn",
} as const;

export type NasErrorKind =
  | "network"
  | "http"
  | "unauthorized"
  | "business"
  | "malformed"
  | "crypto"
  | "mfa-required"
  | "auth";

export class NasError extends Error {
  readonly name = "NasError";

  constructor(
    readonly kind: NasErrorKind,
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface AuthenticatedSession {
  baseUrl: string;
  username: string;
  token: string;
  nasId?: string;
  nasSign?: string;
  nasName?: string;
}

export interface LoginRequest {
  serverUrl: string;
  username: string;
  password: string;
}

export interface ClassificationResult {
  id: string;
  name: string;
  count: number;
  isSystem: boolean;
  isEnabled: boolean;
}

export class MfaProof {
  private constructor(readonly value: string) {}

  static fromServer(value: string): MfaProof {
    const trimmed = value.trim();
    if (!trimmed) throw new NasError("malformed", "短信验证成功但响应缺少 sms_proof");
    return new MfaProof(trimmed);
  }
}

interface ApiResponse {
  code: unknown;
  data?: unknown;
  msg?: unknown;
  message?: unknown;
  reason?: unknown;
}

interface PublicKeyData {
  key: string;
  sign?: string;
  name?: string;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function normalizeLanUrl(input: string): string {
  const clean = input.trim().replace(/\/+$/, "");
  if (!clean) throw new NasError("auth", "NAS 访问地址不能为空");
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(clean) ? clean : `http://${clean}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new NasError("auth", `非法 NAS 地址: ${input}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new NasError("auth", `NAS 地址协议不受支持: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) throw new NasError("auth", "NAS 地址不能包含账号或密码");
  if (!parsed.hostname) throw new NasError("auth", `未识别到 NAS 主机: ${input}`);
  if (!parsed.port) parsed.port = parsed.protocol === "https:" ? "5050" : "5055";
  return parsed.origin;
}

function generateDrnd(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

function codeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "unknown";
}

function isSuccess(body: ApiResponse): boolean {
  const code = codeString(body.code);
  return code === "200" || code === "S000200";
}

function errorMessage(body: ApiResponse): string {
  for (const candidate of [body.message, body.msg, body.reason]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "未知错误";
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NasError("malformed", message);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function boolish(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0") return false;
  if (value === 1 || value === "1") return true;
  return undefined;
}

function encodeCookieValue(value: string): string {
  let encoded = "";
  for (const byte of Buffer.from(value, "utf8")) {
    if ((byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || [0x2d, 0x2e, 0x5f, 0x7e].includes(byte)) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return encoded;
}

function buildCookie(session: AuthenticatedSession): string {
  const values = [
    ["app", DEVICE.app],
    ["token", session.token],
    ["plat", DEVICE.platform],
  ];
  if (session.nasId) values.push(["nas_id", session.nasId]);
  if (session.nasSign) values.push(["sign", session.nasSign]);
  values.push(["version", DEVICE.version], ["device_id", DEVICE.deviceId], ["device", DEVICE.device], ["_l", DEVICE.locale]);
  return values.map(([key, value]) => `${key}=${encodeCookieValue(value)}`).join("; ");
}

function contextForm(session: AuthenticatedSession): URLSearchParams {
  const form = new URLSearchParams({
    token: session.token,
    app: DEVICE.app,
    plat: DEVICE.platform,
    version: DEVICE.version,
    device_id: DEVICE.deviceId,
    device: DEVICE.device,
    _l: DEVICE.locale,
  });
  if (session.nasId) form.set("nasid", session.nasId);
  return form;
}

function formUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}?&drnd=${generateDrnd()}`;
}

function encryptCredential(publicKeyText: string, value: string): string {
  try {
    const keyText = publicKeyText.trim();
    const key = keyText.includes("BEGIN")
      ? createPublicKey(keyText)
      : createPublicKey({ key: Buffer.from(keyText.replace(/\s+/g, ""), "base64"), format: "der", type: "spki" });
    return publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(value, "utf8")).toString("base64");
  } catch (error) {
    throw new NasError("crypto", `公钥加密失败: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

export interface NasApiClientOptions {
  fetcher?: FetchLike;
  mfaCloudBaseUrl?: string;
}

export class NasApiClient {
  private readonly fetcher: FetchLike;
  private readonly mfaCloudBaseUrl: string;

  constructor(options: NasApiClientOptions = {}) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.mfaCloudBaseUrl = (options.mfaCloudBaseUrl ?? MFA_CLOUD_BASE_URL).replace(/\/+$/, "");
  }

  async login(request: LoginRequest, proof?: MfaProof): Promise<AuthenticatedSession & { isLocal?: boolean }> {
    const baseUrl = normalizeLanUrl(request.serverUrl);
    const publicKey = await this.fetchPublicKey(baseUrl);
    const form = new URLSearchParams({
      username: encryptCredential(publicKey.key, request.username),
      password: encryptCredential(publicKey.key, request.password),
      plat: DEVICE.platform,
      version: DEVICE.version,
      device: DEVICE.device,
      device_id: DEVICE.deviceId,
    });
    if (proof) form.set("sms_proof", proof.value);
    const startedAt = Date.now();
    try {
      const body = await this.postForm(formUrl(baseUrl, "/auth/login"), form, "auth.login");
      const code = codeString(body.code);
      if (!isSuccess(body)) {
        const kind: NasErrorKind = code === "N001204" || code === "N001414" ? "mfa-required" : "auth";
        throw new NasError(kind, errorMessage(body), code);
      }
      const data = asObject(body.data, "登录成功但缺少用户会话数据");
      const token = stringValue(data.token);
      if (!token) throw new NasError("malformed", "登录成功但缺少 token");
      const session: AuthenticatedSession = {
        baseUrl,
        username: stringValue(data.username) ?? request.username.trim(),
        token,
        nasId: stringValue(data.nas_id) ?? stringValue(data.nasid) ?? stringValue(data.nasId),
        nasSign: publicKey.sign,
        nasName: stringValue(data.nas_name) ?? publicKey.name,
      };
      const helperNasId = await this.fetchHelperState(session);
      if (!helperNasId) throw new NasError("malformed", "登录成功但 /zhelper/state 缺少 nas_id");
      session.nasId = helperNasId;
      await recordNasRequest("auth.login", "POST", "/auth/login", "success", startedAt, {
        parseResult: "success",
        businessResult: "success",
        tokenPresent: true,
        nasIdPresent: Boolean(session.nasId),
        nasSignPresent: Boolean(session.nasSign),
      });
      return Object.assign(session, { isLocal: boolish(data.is_local) });
    } catch (error) {
      await recordNasRequest("auth.login", "POST", "/auth/login", "error", startedAt, errorDetails(error));
      throw error;
    }
  }

  async fetchPublicKey(baseUrlInput: string): Promise<PublicKeyData> {
    const baseUrl = normalizeLanUrl(baseUrlInput);
    const body = await this.getJson(`${baseUrl}/key/pub?signme=1`, "auth.nas_public_key");
    if (!isSuccess(body)) throw new NasError("auth", errorMessage(body), codeString(body.code));
    const data = asObject(body.data, "响应成功但缺少 public key 数据");
    const key = stringValue(data.key);
    if (!key) throw new NasError("malformed", "响应成功但缺少 public key 数据");
    return { key, sign: stringValue(data.sign), name: stringValue(data.name) };
  }

  async getClassifications(session: AuthenticatedSession): Promise<ClassificationResult[]> {
    if (!session.token.trim()) throw new NasError("unauthorized", "当前会话未认证", undefined, 401);
    if (!session.nasId) {
      const helperNasId = await this.fetchHelperState(session);
      if (!helperNasId) throw new NasError("malformed", "分类请求前 /zhelper/state 缺少 nas_id");
      session.nasId = helperNasId;
    }
    const startedAt = Date.now();
    try {
      const body = await this.postSessionForm(formUrl(session.baseUrl, "/zvideo/classification/list"), contextForm(session), session, "library.classifications");
      if (!isSuccess(body)) throw new NasError("business", errorMessage(body), codeString(body.code));
      if (!Array.isArray(body.data)) throw new NasError("malformed", "分类列表响应缺少 data array");
      const classifications = body.data.map((value) => {
        const item = asObject(value, "分类列表条目格式无效");
        const id = stringValue(item.id);
        const name = stringValue(item.name);
        if (!id || !name) throw new NasError("malformed", "分类列表条目缺少 id 或 name");
        const isSystem = numberValue(item.is_system) === 1 || item.is_system === true;
        const isEnabled = numberValue(item.is_enable) === 1 || item.is_enable === true;
        const count = numberValue(item.count) ?? numberValue(item.collection_count) ?? 0;
        return { id, name, count, isSystem, isEnabled };
      }).filter((item) => !item.isSystem || item.isEnabled);
      await recordNasRequest("library.classifications", "POST", "/zvideo/classification/list", "success", startedAt, {
        parseResult: "success",
        businessResult: "success",
        categoryCount: classifications.length,
        tokenPresent: true,
        nasIdPresent: Boolean(session.nasId),
        nasSignPresent: Boolean(session.nasSign),
      });
      return classifications;
    } catch (error) {
      await recordNasRequest("library.classifications", "POST", "/zvideo/classification/list", "error", startedAt, errorDetails(error));
      throw error;
    }
  }

  async sendMfaCode(baseUrlInput: string, username: string, challengeType?: string): Promise<void> {
    const nasSign = (await this.fetchPublicKey(baseUrlInput)).sign;
    if (!nasSign) throw new NasError("malformed", "NAS /key/pub 响应缺少用于短信验证的 sign");
    const cloudKey = await this.fetchCloudPublicKey();
    const form = new URLSearchParams({ username: encryptCredential(cloudKey.key, username), key_id: cloudKey.keyId, nasid: nasSign });
    if (challengeType?.trim()) form.set("type", challengeType.trim());
    const body = await this.postCloudForm("/sms/usend", form);
    if (!isSuccess(body)) throw new NasError("auth", errorMessage(body), codeString(body.code));
  }

  async verifyMfaCode(baseUrlInput: string, username: string, codeInput: string): Promise<MfaProof> {
    const code = codeInput.trim();
    if (code.length !== 4 && code.length !== 6) throw new NasError("auth", "验证码格式无效，请输入 4 位或 6 位验证码", "MFA_INVALID_CODE");
    const nasSign = (await this.fetchPublicKey(baseUrlInput)).sign;
    if (!nasSign) throw new NasError("malformed", "NAS /key/pub 响应缺少用于短信验证的 sign");
    const cloudKey = await this.fetchCloudPublicKey();
    const form = new URLSearchParams({ username: encryptCredential(cloudKey.key, username), key_id: cloudKey.keyId, nasid: nasSign, sms_code: code });
    const body = await this.postCloudForm("/sms/ucheck", form);
    if (!isSuccess(body)) throw new NasError("auth", errorMessage(body), codeString(body.code));
    const data = asObject(body.data, "短信验证成功但响应缺少 data");
    return MfaProof.fromServer(stringValue(data.sms_proof) ?? "");
  }

  private async fetchHelperState(session: AuthenticatedSession): Promise<string | undefined> {
    const url = new URL(formUrl(session.baseUrl, "/zhelper/state"));
    url.searchParams.set("token", session.token);
    url.searchParams.set("plat", DEVICE.platform);
    url.searchParams.set("version", DEVICE.version);
    url.searchParams.set("device_id", DEVICE.deviceId);
    url.searchParams.set("device", DEVICE.device);
    const body = await this.getJson(url.toString(), "auth.nas_helper_state", session);
    if (!isSuccess(body)) throw new NasError("auth", errorMessage(body), codeString(body.code));
    const data = asObject(body.data, "/zhelper/state 响应缺少 data");
    return stringValue(data.nas_id) ?? stringValue(data.nasid) ?? stringValue(data.nasId);
  }

  private async fetchCloudPublicKey(): Promise<{ key: string; keyId: string }> {
    const body = await this.getJson(`${this.mfaCloudBaseUrl}/key/pub?signme=1`, "auth.mfa.cloud_public_key");
    if (!isSuccess(body)) throw new NasError("auth", errorMessage(body), codeString(body.code));
    const data = asObject(body.data, "云端 /key/pub 响应缺少公钥数据");
    const key = stringValue(data.key);
    const keyId = stringValue(data.key_id) ?? stringValue(data.keyId);
    if (!key || !keyId) throw new NasError("malformed", "云端 /key/pub 响应缺少 key 或 key_id");
    return { key, keyId };
  }

  private async postCloudForm(path: string, form: URLSearchParams): Promise<ApiResponse> {
    form.set("plat", DEVICE.platform);
    form.set("version", DEVICE.version);
    form.set("device", DEVICE.device);
    form.set("device_id", DEVICE.deviceId);
    return this.postForm(`${this.mfaCloudBaseUrl}${path}?&drnd=${generateDrnd()}`, form, "auth.mfa.cloud_form");
  }

  private async getJson(url: string, operation: string, session?: AuthenticatedSession): Promise<ApiResponse> {
    const headers: Record<string, string> = {};
    if (session) {
      headers.token = session.token;
      headers.Cookie = buildCookie(session);
    }
    const startedAt = Date.now();
    try {
      const response = await this.fetcher(url, { method: "GET", headers });
      return await this.readResponse(response, operation, "GET", url, startedAt);
    } catch (error) {
      await recordNasRequest(operation, "GET", safeRoute(url), "error", startedAt, errorDetails(error));
      throw error;
    }
  }

  private async postSessionForm(url: string, form: URLSearchParams, session: AuthenticatedSession, operation: string): Promise<ApiResponse> {
    return this.postForm(url, form, operation, { token: session.token, Cookie: buildCookie(session) });
  }

  private async postForm(url: string, form: URLSearchParams, operation: string, extraHeaders: Record<string, string> = {}): Promise<ApiResponse> {
    const startedAt = Date.now();
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...extraHeaders },
        body: form.toString(),
      });
      return this.readResponse(response, operation, "POST", url, startedAt);
    } catch (error) {
      const normalized = error instanceof NasError
        ? error
        : new NasError("network", `${operation} 请求失败: ${error instanceof Error ? error.message : "unknown"}`);
      void recordNasRequest(operation, "POST", safeRoute(url), "error", startedAt, errorDetails(normalized));
      throw normalized;
    }
  }

  private async readResponse(response: Response, operation: string, method: string, url: string, startedAt: number): Promise<ApiResponse> {
    const text = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw new NasError("unauthorized", `${operation} 未认证`, undefined, response.status);
    if (response.status !== 200) throw new NasError("http", `${operation} HTTP ${response.status}`, undefined, response.status);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new NasError("malformed", `${operation} 响应不是有效 JSON`, undefined, response.status);
    }
    const parsed = asObject(body, `${operation} 响应格式无效`) as unknown as ApiResponse;
    void recordNasRequest(operation, method, safeRoute(url), "success", startedAt, { httpStatus: response.status, parseResult: "success" });
    return parsed;
  }
}

function safeRoute(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

function errorDetails(error: unknown): { errorKind?: string; errorCode?: string; httpStatus?: number; parseResult?: string; businessResult?: string } {
  if (error instanceof NasError) {
    return {
      errorKind: error.kind,
      errorCode: error.code,
      httpStatus: error.status,
      parseResult: error.kind === "malformed" ? "error" : "unknown",
      businessResult: error.kind === "business" || error.kind === "auth" || error.kind === "mfa-required" ? "error" : "unknown",
    };
  }
  return { errorKind: "unknown" };
}
