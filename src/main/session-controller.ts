import type { ClassificationResult, MfaProof, NasApiClient } from "./nas-client";
import { NasError } from "./nas-client";
import type { AppError, LoginInput, PublicSessionState } from "../shared/contracts";
import type { AuthenticatedSession } from "./nas-client";

export interface PersistedSession {
  baseUrl: string;
  username: string;
  token: string;
  nasId?: string;
  nasSign?: string;
  nasName?: string;
  lastPlayback?: LastPlaybackContext;
}

export interface LastPlaybackContext {
  collectionId: string;
  classificationId: string;
  episodeId: string;
}

export interface SessionStore {
  load(): Promise<PersistedSession | null>;
  save(session: PersistedSession): Promise<void>;
  clear(): Promise<void>;
}

export interface NasGateway {
  login(request: { serverUrl: string; username: string; password: string }, proof?: MfaProof): Promise<AuthenticatedSession & { isLocal?: boolean }>;
  getClassifications(session: AuthenticatedSession): Promise<ClassificationResult[]>;
  sendMfaCode(baseUrl: string, username: string, challengeType?: string): Promise<void>;
  verifyMfaCode(baseUrl: string, username: string, code: string): Promise<MfaProof>;
}

export class SessionController {
  private session?: AuthenticatedSession;
  private pendingLogin?: LoginInput;
  private classifications: ClassificationResult[] = [];
  private lastPlayback?: LastPlaybackContext;
  private rememberSession = false;

  constructor(private readonly nas: NasGateway | NasApiClient, private readonly store: SessionStore) {}

  async restore(): Promise<PublicSessionState> {
    let saved: PersistedSession | null;
    try {
      saved = await this.store.load();
    } catch (error) {
      return this.loggedOutState(toAppError(error, "无法读取安全会话"));
    }
    if (!saved) {
      this.classifications = [];
      this.lastPlayback = undefined;
      this.rememberSession = false;
      return this.loggedOutState();
    }

    this.session = { ...saved };
    this.lastPlayback = saved.lastPlayback ? { ...saved.lastPlayback } : undefined;
    this.rememberSession = true;
    const state = await this.readClassifications();
    if (state.status === "authenticated") {
      try {
        await this.store.save(toPersistedSession(this.session, this.lastPlayback));
      } catch (error) {
        return { ...state, error: toAppError(error, "登录已恢复，但无法更新安全会话") };
      }
    }
    return state;
  }

  async login(input: LoginInput): Promise<PublicSessionState> {
    this.pendingLogin = { ...input };
    try {
      const session = await this.nas.login({
        serverUrl: input.serverUrl,
        username: input.username,
        password: input.password,
      });
      const state = await this.activate(session, input.remember);
      this.pendingLogin = undefined;
      return state;
    } catch (error) {
      if (error instanceof NasError && error.kind === "mfa-required") {
        return {
          status: "mfa-required",
          classifications: [],
          mfa: { code: error.code ?? "MFA_REQUIRED", message: error.message },
        };
      }
      this.pendingLogin = undefined;
      return this.loggedOutState(toAppError(error, "登录失败"));
    }
  }

  async sendMfaCode(challengeType?: string): Promise<PublicSessionState> {
    const pending = this.pendingLogin;
    if (!pending) return this.loggedOutState({ kind: "auth", message: "请先提交账号和密码" });
    try {
      await this.nas.sendMfaCode(pending.serverUrl, pending.username, challengeType);
      return {
        status: "mfa-required",
        classifications: [],
        mfa: { code: "MFA_CODE_SENT", message: "验证码已发送，请输入验证码完成登录" },
      };
    } catch (error) {
      return {
        status: "mfa-required",
        classifications: [],
        mfa: { code: "MFA_SEND_FAILED", message: toAppError(error, "验证码发送失败").message },
      };
    }
  }

  async verifyMfa(code: string): Promise<PublicSessionState> {
    const pending = this.pendingLogin;
    if (!pending) return this.loggedOutState({ kind: "auth", message: "登录会话已失效，请重新输入账号和密码" });
    try {
      const proof = await this.nas.verifyMfaCode(pending.serverUrl, pending.username, code);
      const session = await this.nas.login(
        { serverUrl: pending.serverUrl, username: pending.username, password: pending.password },
        proof,
      );
      const state = await this.activate(session, pending.remember);
      this.pendingLogin = undefined;
      return state;
    } catch (error) {
      return {
        status: "mfa-required",
        classifications: [],
        mfa: { code: "MFA_VERIFY_FAILED", message: toAppError(error, "验证码验证失败").message },
      };
    }
  }

  async logout(): Promise<PublicSessionState> {
    this.session = undefined;
    this.pendingLogin = undefined;
    this.classifications = [];
    this.lastPlayback = undefined;
    this.rememberSession = false;
    try {
      await this.store.clear();
      return this.loggedOutState();
    } catch (error) {
      return this.loggedOutState(toAppError(error, "无法清除安全会话"));
    }
  }

  async listClassifications(): Promise<{ classifications: ClassificationResult[]; state: PublicSessionState }> {
    const state = await this.readClassifications();
    return { classifications: state.status === "authenticated" ? state.classifications : [], state };
  }

  /** Main-process-only session accessor. It is never exposed through preload. */
  getAuthenticatedSession(): AuthenticatedSession | undefined {
    return this.session ? { ...this.session } : undefined;
  }

  /** Main-process-only playback context; it contains IDs, never position or URI. */
  getLastPlayback(): LastPlaybackContext | undefined {
    return this.lastPlayback ? { ...this.lastPlayback } : undefined;
  }

  async setLastPlayback(context: LastPlaybackContext): Promise<void> {
    const collectionId = context.collectionId.trim();
    const classificationId = context.classificationId.trim();
    const episodeId = context.episodeId.trim();
    if (!collectionId || !classificationId || !episodeId) throw new Error("播放上下文缺少 ID");
    this.lastPlayback = { collectionId, classificationId, episodeId };
    if (this.session && this.rememberSession) await this.store.save(toPersistedSession(this.session, this.lastPlayback));
  }

  getPublicState(error?: AppError): PublicSessionState {
    if (!this.session) return this.loggedOutState(error);
    return {
      status: "authenticated",
      identity: publicIdentity(this.session),
      classifications: this.classifications.map((item) => ({ ...item })),
      ...(error ? { error } : {}),
    };
  }

  async invalidate(error: AppError): Promise<PublicSessionState> {
    this.session = undefined;
    this.pendingLogin = undefined;
    this.classifications = [];
    this.lastPlayback = undefined;
    this.rememberSession = false;
    try {
      await this.store.clear();
    } catch {
      // Returning to login is still safer than retrying an invalid session.
    }
    return this.loggedOutState(error);
  }

  private async activate(session: AuthenticatedSession, remember: boolean): Promise<PublicSessionState> {
    this.session = session;
    this.classifications = [];
    this.lastPlayback = undefined;
    this.rememberSession = remember;
    try {
      if (remember) await this.store.save(toPersistedSession(session, undefined));
      else await this.store.clear();
    } catch (error) {
      const state = await this.readClassifications();
      return { ...state, error: toAppError(error, "登录成功，但无法保存安全会话") };
    }
    return this.readClassifications();
  }

  private async readClassifications(): Promise<PublicSessionState> {
    if (!this.session) return this.loggedOutState();
    try {
      const classifications = await this.nas.getClassifications(this.session);
      this.classifications = classifications.map((item) => ({ ...item }));
      return {
        status: "authenticated",
        identity: publicIdentity(this.session),
        classifications,
      };
    } catch (error) {
      const appError = toAppError(error, "无法读取片库分类");
      if (error instanceof NasError && error.kind === "unauthorized") {
        this.session = undefined;
        this.lastPlayback = undefined;
        this.rememberSession = false;
        this.classifications = [];
        try {
          await this.store.clear();
        } catch {
          // The login state still wins; the next startup will report storage failure.
        }
        return this.loggedOutState(appError);
      }
      return {
        status: "authenticated",
        identity: publicIdentity(this.session),
        classifications: this.classifications.map((item) => ({ ...item })),
        error: appError,
      };
    }
  }

  private loggedOutState(error?: AppError): PublicSessionState {
    return { status: "logged-out", classifications: [], ...(error ? { error } : {}) };
  }
}

function toPersistedSession(session: AuthenticatedSession, lastPlayback?: LastPlaybackContext): PersistedSession {
  return {
    baseUrl: session.baseUrl,
    username: session.username,
    token: session.token,
    nasId: session.nasId,
    nasSign: session.nasSign,
    nasName: session.nasName,
    ...(lastPlayback ? { lastPlayback: { ...lastPlayback } } : {}),
  };
}

function publicIdentity(session: AuthenticatedSession) {
  return {
    serverUrl: session.baseUrl,
    username: session.username,
    nasName: session.nasName,
    nasId: session.nasId ?? "",
  };
}

function toAppError(error: unknown, fallback: string): AppError {
  if (error instanceof NasError) {
    const kind: AppError["kind"] = error.kind === "mfa-required" || error.kind === "auth" || error.kind === "crypto" ? "auth" : error.kind === "http" ? "network" : error.kind;
    return { kind, code: error.code, message: error.message || fallback };
  }
  if (error instanceof Error) return { kind: "unknown", message: error.message || fallback };
  return { kind: "unknown", message: fallback };
}
