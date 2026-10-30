import type { PublicSessionState } from "../shared/contracts";
import { refreshLibrary, setLibrarySessionState } from "./library.js";

const loginView = document.querySelector<HTMLElement>('[data-view="login"]');
const libraryView = document.querySelector<HTMLElement>('[data-view="library"]');
const loginForm = document.querySelector<HTMLFormElement>("#login-form");
const loginButton = document.querySelector<HTMLButtonElement>("#login-button");
const loginStatus = document.querySelector<HTMLElement>("#login-status");
const mfaPanel = document.querySelector<HTMLElement>("#mfa-panel");
const mfaHint = document.querySelector<HTMLElement>("#mfa-hint");
const mfaCode = document.querySelector<HTMLInputElement>("#mfa-code");
const sendMfaButton = document.querySelector<HTMLButtonElement>("#send-mfa-button");
const verifyMfaButton = document.querySelector<HTMLButtonElement>("#verify-mfa-button");
const sessionUser = document.querySelector<HTMLElement>("#session-user");
const libraryMessage = document.querySelector<HTMLElement>("#library-message");
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-button");
const logoutButton = document.querySelector<HTMLButtonElement>("#logout-button");

function requireElement<T extends Element>(element: T | null, name: string): T {
  if (!element) throw new Error(`renderer element missing: ${name}`);
  return element;
}

function setBusy(busy: boolean): void {
  if (loginButton) loginButton.disabled = busy;
  if (sendMfaButton) sendMfaButton.disabled = busy;
  if (verifyMfaButton) verifyMfaButton.disabled = busy;
  if (refreshButton) refreshButton.disabled = busy;
}

function setLoginMessage(message = "", error = false): void {
  if (!loginStatus) return;
  loginStatus.textContent = message;
  loginStatus.classList.toggle("error", error);
}

function renderState(state: PublicSessionState): void {
  const loggedIn = state.status === "authenticated";
  const mfaRequired = state.status === "mfa-required";
  if (loginView) loginView.hidden = loggedIn;
  if (libraryView) libraryView.hidden = !loggedIn;
  if (mfaPanel) mfaPanel.hidden = !mfaRequired;
  if (mfaRequired && mfaHint) mfaHint.textContent = state.mfa?.message ?? "请输入验证码完成登录。";
  if (loggedIn) {
    setLibrarySessionState(state);
    if (sessionUser) sessionUser.textContent = state.identity?.username ?? "已连接";
    if (libraryMessage) libraryMessage.textContent = state.error?.message ?? "选择一个分类开始浏览。";
    setLoginMessage();
  } else if (state.error) {
    setLibrarySessionState(state);
    setLoginMessage(state.error.message, true);
  } else if (mfaRequired) {
    setLibrarySessionState(state);
    setLoginMessage("账号需要二次验证。", false);
  }
}

window.addEventListener("z-video:session-state", (event) => {
  const state = (event as CustomEvent<PublicSessionState>).detail;
  if (state) renderState(state);
});

async function restore(): Promise<void> {
  try {
    setLoginMessage("正在恢复安全会话…");
    renderState(await window.zVideo.session.restore());
  } catch {
    setLoginMessage("无法连接应用主进程，请重启 z-video。", true);
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const serverUrl = requireElement(document.querySelector<HTMLInputElement>("#server-url"), "server-url").value.trim();
  const username = requireElement(document.querySelector<HTMLInputElement>("#username"), "username").value.trim();
  const password = requireElement(document.querySelector<HTMLInputElement>("#password"), "password").value;
  const remember = requireElement(document.querySelector<HTMLInputElement>("#remember"), "remember").checked;
  if (!serverUrl || !username || !password) {
    setLoginMessage("请填写 NAS 地址、账号和密码。", true);
    return;
  }
  setBusy(true);
  setLoginMessage("正在连接 NAS 并验证身份…");
  try {
    const result = await window.zVideo.session.login({ serverUrl, username, password, remember });
    renderState(result.state);
    if (result.state.status === "mfa-required") mfaCode?.focus();
  } catch {
    setLoginMessage("登录请求失败，请检查 NAS 地址和网络。", true);
  } finally {
    setBusy(false);
  }
});

sendMfaButton?.addEventListener("click", async () => {
  setBusy(true);
  try {
    renderState((await window.zVideo.session.sendMfaCode()).state);
  } catch {
    setLoginMessage("验证码发送失败，请稍后重试。", true);
  } finally {
    setBusy(false);
  }
});

verifyMfaButton?.addEventListener("click", async () => {
  const code = mfaCode?.value.trim() ?? "";
  if (code.length !== 4 && code.length !== 6) {
    setLoginMessage("请输入 4 位或 6 位验证码。", true);
    return;
  }
  setBusy(true);
  try {
    renderState((await window.zVideo.session.verifyMfa(code)).state);
  } catch {
    setLoginMessage("验证码验证失败，请重试。", true);
  } finally {
    setBusy(false);
  }
});

refreshButton?.addEventListener("click", async () => {
  setBusy(true);
  try {
    const result = await window.zVideo.library.listClassifications();
    renderState(result.state);
    if (result.state.status === "authenticated") refreshLibrary();
  } catch {
    if (libraryMessage) libraryMessage.textContent = "分类刷新失败，请重试。";
  } finally {
    setBusy(false);
  }
});

logoutButton?.addEventListener("click", async () => {
  setBusy(true);
  try {
    renderState((await window.zVideo.session.logout()).state);
  } finally {
    setBusy(false);
  }
});

void restore();
