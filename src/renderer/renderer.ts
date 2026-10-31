import type { DiscoveryOutcome, DiscoveryResult, PlaybackEvent, PublicSessionState } from "../shared/contracts";
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
const openLocalButton = document.querySelector<HTMLButtonElement>("#open-local-button");
const playerView = document.querySelector<HTMLElement>('[data-view="player"]');
const playerSurfaceMessage = document.querySelector<HTMLElement>("#player-surface-message");
const playerCloseButton = document.querySelector<HTMLButtonElement>("#player-close-button");
const playerToggleButton = document.querySelector<HTMLButtonElement>("#player-toggle-button");
const playerSeek = document.querySelector<HTMLInputElement>("#player-seek");
const playerTime = document.querySelector<HTMLElement>("#player-time");
const playerFullscreenButton = document.querySelector<HTMLButtonElement>("#player-fullscreen-button");
const playerAudioTrack = document.querySelector<HTMLSelectElement>("#player-audio-track");
const playerSubtitleTrack = document.querySelector<HTMLSelectElement>("#player-subtitle-track");
const playerSubtitleFileButton = document.querySelector<HTMLButtonElement>("#player-subtitle-file-button");
const playerStatus = document.querySelector<HTMLElement>("#player-status");

let playerVisible = false;
let playerDurationSec = 0;
let playerState: "playing" | "paused" | "buffering" | "ended" = "paused";
let playerFullscreen = false;
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
  if (openLocalButton) openLocalButton.disabled = busy;
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
  if (libraryView) libraryView.hidden = !loggedIn || playerVisible;
  if (playerView) playerView.hidden = !loggedIn || !playerVisible;
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

function showPlayer(visible: boolean): void {
  playerVisible = visible;
  if (libraryView) libraryView.hidden = visible;
  if (playerView) playerView.hidden = !visible;
  if (visible) playerCloseButton?.focus();
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function setPlayerStatus(message: string, error = false): void {
  if (!playerStatus) return;
  playerStatus.textContent = message;
  playerStatus.classList.toggle("error", error);
}

function setPlayerControlsEnabled(enabled: boolean): void {
  if (playerToggleButton) playerToggleButton.disabled = !enabled;
  if (playerSeek) playerSeek.disabled = !enabled;
  if (playerFullscreenButton) playerFullscreenButton.disabled = !enabled;
  if (playerAudioTrack) playerAudioTrack.disabled = !enabled;
  if (playerSubtitleTrack) playerSubtitleTrack.disabled = !enabled;
  if (playerSubtitleFileButton) playerSubtitleFileButton.disabled = !enabled;
}

function renderTrackOptions(select: HTMLSelectElement | null, tracks: Array<{ id: string; label: string; selected?: boolean }>, emptyLabel: string): void {
  if (!select) return;
  const options = [new Option(emptyLabel, ""), ...tracks.map((track) => {
    const option = new Option(track.label, track.id);
    option.selected = Boolean(track.selected);
    return option;
  })];
  select.replaceChildren(...options);
  const selectedTrack = tracks.find((track) => track.selected);
  select.value = selectedTrack?.id ?? "";
}

function renderPlaybackEvent(event: PlaybackEvent): void {
  if (event.type === "closed") {
    playerFullscreen = false;
    if (playerFullscreenButton) playerFullscreenButton.textContent = "全屏";
    showPlayer(false);
    setPlayerControlsEnabled(false);
    setPlayerStatus("");
    if (playerSurfaceMessage) playerSurfaceMessage.textContent = "正在准备原生播放器…";
    return;
  }
  showPlayer(true);
  switch (event.type) {
    case "loading":
      setPlayerControlsEnabled(false);
      setPlayerStatus("正在加载本地媒体…");
      if (playerSurfaceMessage) playerSurfaceMessage.textContent = "正在加载原生媒体…";
      break;
    case "ready":
      playerDurationSec = event.durationSec ?? 0;
      setPlayerControlsEnabled(true);
      setPlayerStatus("原生播放器已就绪。没有复制视频帧到 CPU。 ");
      if (playerSurfaceMessage) playerSurfaceMessage.textContent = "";
      if (playerSeek) {
        playerSeek.max = String(playerDurationSec);
        playerSeek.value = "0";
      }
      break;
    case "state":
      playerState = event.state;
      if (playerToggleButton) playerToggleButton.textContent = event.state === "playing" ? "暂停" : "播放";
      if (event.state === "ended") setPlayerStatus("播放结束。 ");
      break;
    case "position":
      playerDurationSec = event.durationSec ?? playerDurationSec;
      if (playerSeek && document.activeElement !== playerSeek) playerSeek.value = String(event.positionSec);
      if (playerTime) playerTime.textContent = `${formatTime(event.positionSec)} / ${formatTime(playerDurationSec)}`;
      break;
    case "tracks":
      renderTrackOptions(playerAudioTrack, event.audio, "自动");
      renderTrackOptions(playerSubtitleTrack, event.subtitles, "关闭");
      break;
    case "error":
      setPlayerControlsEnabled(false);
      setPlayerStatus(event.message, true);
      if (playerSurfaceMessage) playerSurfaceMessage.textContent = event.message;
      break;
  }
}

async function sendPlayerCommand(command: Parameters<typeof window.zVideo.player.command>[0]): Promise<void> {
  try {
    await window.zVideo.player.command(command);
  } catch {
    setPlayerStatus("播放控制失败，请重试。", true);
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

openLocalButton?.addEventListener("click", async () => {
  setBusy(true);
  try {
    const result = await window.zVideo.player.chooseLocalFile();
    if (result.opened) showPlayer(true);
  } catch {
    setPlayerStatus("无法打开本地媒体选择器。", true);
  } finally {
    setBusy(false);
  }
});

playerCloseButton?.addEventListener("click", () => void sendPlayerCommand({ type: "close" }));
playerToggleButton?.addEventListener("click", () => {
  void sendPlayerCommand({ type: playerState === "playing" ? "pause" : "play" });
});
playerSeek?.addEventListener("change", () => {
  void sendPlayerCommand({ type: "seek", positionSec: Number(playerSeek.value) });
});
playerFullscreenButton?.addEventListener("click", () => {
  playerFullscreen = !playerFullscreen;
  playerFullscreenButton.textContent = playerFullscreen ? "退出全屏" : "全屏";
  void sendPlayerCommand({ type: "fullscreen", enabled: playerFullscreen });
});
playerAudioTrack?.addEventListener("change", () => {
  if (playerAudioTrack.value) void sendPlayerCommand({ type: "set-audio-track", trackId: playerAudioTrack.value });
});
playerSubtitleTrack?.addEventListener("change", () => {
  void sendPlayerCommand({ type: "set-subtitle-track", trackId: playerSubtitleTrack.value || null });
});
playerSubtitleFileButton?.addEventListener("click", async () => {
  try {
    const result = await window.zVideo.player.chooseSubtitleFile();
    if (result.loaded) setPlayerStatus("外部字幕已加载并选中。 ");
  } catch {
    setPlayerStatus("无法加载外部字幕。", true);
  }
});

window.zVideo.player.onEvent(renderPlaybackEvent);
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
