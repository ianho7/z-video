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

  constructor(private readonly nas: NasGateway | NasApiClient, private readonly store: SessionStore) {}

  async restore(): Promise<PublicSessionState> {
    let saved: PersistedSession | null;
    try {
      saved = await this.store.load();
    } catch (error) {
      return this.loggedOutState(toAppError(error, "无法读取安全会话"));
    }
    if (!saved) return this.loggedOutState();

    this.session = { ...saved };
    const state = await this.readClassifications();
    if (state.status === "authenticated") {
      try {
        await this.store.save(toPersistedSession(this.session));
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

  private async activate(session: AuthenticatedSession, remember: boolean): Promise<PublicSessionState> {
    this.session = session;
    try {
      if (remember) await this.store.save(toPersistedSession(session));
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
      return {
        status: "authenticated",
        identity: publicIdentity(this.session),
        classifications,
      };
    } catch (error) {
      const appError = toAppError(error, "无法读取片库分类");
      if (error instanceof NasError && error.kind === "unauthorized") {
        this.session = undefined;
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
        classifications: [],
        error: appError,
      };
    }
  }

  private loggedOutState(error?: AppError): PublicSessionState {
    return { status: "logged-out", classifications: [], ...(error ? { error } : {}) };
  }
}

function toPersistedSession(session: AuthenticatedSession): PersistedSession {
  return {
    baseUrl: session.baseUrl,
    username: session.username,
    token: session.token,
    nasId: session.nasId,
    nasSign: session.nasSign,
    nasName: session.nasName,
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
