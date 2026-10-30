import type { DiscoveryOutcome, DiscoveryResult, PublicSessionState } from "../shared/contracts";
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
const serverUrlInput = document.querySelector<HTMLInputElement>("#server-url");
const discoverButton = document.querySelector<HTMLButtonElement>("#discover-button");
const cancelDiscoveryButton = document.querySelector<HTMLButtonElement>("#cancel-discovery-button");
const discoveryStatus = document.querySelector<HTMLElement>("#discovery-status");
const discoveryResults = document.querySelector<HTMLElement>("#discovery-results");

let appBusy = false;
let discoveryLoading = false;
let discoveryGeneration = 0;

function requireElement<T extends Element>(element: T | null, name: string): T {
  if (!element) throw new Error(`renderer element missing: ${name}`);
  return element;
}

function setBusy(busy: boolean): void {
  appBusy = busy;
  if (loginButton) loginButton.disabled = busy;
  if (sendMfaButton) sendMfaButton.disabled = busy;
  if (verifyMfaButton) verifyMfaButton.disabled = busy;
  if (refreshButton) refreshButton.disabled = busy;
  updateDiscoveryButtons();
}

function updateDiscoveryButtons(): void {
  if (discoverButton) discoverButton.disabled = appBusy || discoveryLoading;
  if (cancelDiscoveryButton) cancelDiscoveryButton.disabled = !discoveryLoading;
}

function setDiscoveryLoading(loading: boolean): void {
  discoveryLoading = loading;
  if (cancelDiscoveryButton) cancelDiscoveryButton.hidden = !loading;
  if (discoverButton) discoverButton.hidden = loading;
  updateDiscoveryButtons();
}

function setDiscoveryMessage(message = "", error = false): void {
  if (!discoveryStatus) return;
  discoveryStatus.textContent = message;
  discoveryStatus.classList.toggle("error", error);
}

function renderDiscoveryResults(results: DiscoveryResult[]): void {
  if (!discoveryResults) return;
  discoveryResults.replaceChildren(...results.map((result) => {
    const row = document.createElement("div");
    row.className = "discovery-result";
    row.setAttribute("role", "listitem");

    const copy = document.createElement("span");
    copy.className = "discovery-result-copy";
    const name = document.createElement("strong");
    name.className = "discovery-result-name";
    name.textContent = result.name || "未命名 NAS";
    const address = document.createElement("span");
    address.className = "discovery-result-address";
    address.textContent = result.available ? `${result.ip}:5055 · 可用` : `${result.ip}:5055 · 不可用`;
    copy.append(name, address);

    const select = document.createElement("button");
    select.className = "secondary-button";
    select.type = "button";
    select.dataset.discoveryIp = result.ip;
    select.textContent = "使用此地址";
    select.disabled = !result.available || appBusy;
    row.append(copy, select);
    return row;
  }));
}

function renderDiscoveryOutcome(outcome: DiscoveryOutcome, generation: number): void {
  if (generation !== discoveryGeneration || outcome.status === "stale") return;
  setDiscoveryLoading(false);
  if (outcome.status === "cancelled") {
    setDiscoveryMessage("已取消 NAS 扫描。", false);
    setLoginMessage("已取消 NAS 扫描。", false);
    return;
  }
  if (outcome.status === "error") {
    setDiscoveryMessage(outcome.error.message, true);
    setLoginMessage("NAS 自动发现不可用，可手动输入局域网地址。", false);
    return;
  }
  renderDiscoveryResults(outcome.report.results);
  if (outcome.report.results.length === 0) {
    const suffix = outcome.report.truncated ? "（网段过大，已达到扫描上限）" : "";
    setDiscoveryMessage(`未发现可用 NAS${suffix}。可手动输入地址继续登录。`, true);
    setLoginMessage(`已扫描 ${outcome.report.candidateCount} 个本机局域网地址，未发现 NAS。`, false);
  } else {
    setDiscoveryMessage(`发现 ${outcome.report.results.length} 台 NAS，请选择后登录。`);
    setLoginMessage(`发现 ${outcome.report.results.length} 台 NAS，请选择后登录。`, false);
  }
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

discoverButton?.addEventListener("click", async () => {
  const generation = ++discoveryGeneration;
  setDiscoveryLoading(true);
  renderDiscoveryResults([]);
  setDiscoveryMessage("正在扫描本机私有局域网，请稍候…");
  setLoginMessage("正在扫描本机私有局域网，仅验证 NAS 的 5055 端口响应…");
  try {
    const outcome = await window.zVideo.discovery.start();
    renderDiscoveryOutcome(outcome, generation);
  } catch {
    if (generation !== discoveryGeneration) return;
    setDiscoveryLoading(false);
    setDiscoveryMessage("NAS 扫描失败，请确认电脑已连接局域网后重试。", true);
    setLoginMessage("NAS 自动发现不可用，可手动输入局域网地址。", false);
  }
});

cancelDiscoveryButton?.addEventListener("click", async () => {
  if (!discoveryLoading) return;
  discoveryGeneration += 1;
  setDiscoveryLoading(false);
  setDiscoveryMessage("正在取消 NAS 扫描…");
  try {
    await window.zVideo.discovery.cancel();
  } catch {
    setDiscoveryMessage("取消扫描失败，请稍后重试。", true);
  }
  if (!discoveryLoading) {
    setDiscoveryMessage("已取消 NAS 扫描。", false);
    setLoginMessage("已取消 NAS 扫描。", false);
  }
});

discoveryResults?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-discovery-ip]");
  const ip = button?.dataset.discoveryIp;
  if (!button || !ip || button.disabled || !serverUrlInput) return;
  serverUrlInput.value = `http://${ip}:5055`;
  setDiscoveryMessage(`已选择 ${ip}:5055。`);
  setLoginMessage("已填入发现的 NAS 地址，请输入账号密码后登录。", false);
  serverUrlInput.focus();
});

void restore();
