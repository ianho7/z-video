import type { Classification, PlaybackEvent, PublicSessionState } from "../shared/contracts";

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
const classificationList = document.querySelector<HTMLElement>("#classification-list");
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
const playerStatus = document.querySelector<HTMLElement>("#player-status");

let playerVisible = false;
let playerDurationSec = 0;
let playerState: "playing" | "paused" | "buffering" | "ended" = "paused";
let playerFullscreen = false;

function requireElement<T extends Element>(element: T | null, name: string): T {
  if (!element) throw new Error(`renderer element missing: ${name}`);
  return element;
}

function setBusy(busy: boolean): void {
  if (loginButton) loginButton.disabled = busy;
  if (sendMfaButton) sendMfaButton.disabled = busy;
  if (verifyMfaButton) verifyMfaButton.disabled = busy;
  if (refreshButton) refreshButton.disabled = busy;
  if (openLocalButton) openLocalButton.disabled = busy;
}

function setLoginMessage(message = "", error = false): void {
  if (!loginStatus) return;
  loginStatus.textContent = message;
  loginStatus.classList.toggle("error", error);
}

function renderClassifications(classifications: Classification[]): void {
  requireElement(classificationList, "classification-list").replaceChildren(
    ...classifications.map((classification) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.classificationId = classification.id;
      const name = document.createElement("span");
      name.textContent = classification.name;
      const count = document.createElement("span");
      count.textContent = String(classification.count);
      button.append(name, count);
      return button;
    }),
  );
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
    renderClassifications(state.classifications);
    if (sessionUser) sessionUser.textContent = state.identity?.username ?? "已连接";
    if (libraryMessage) libraryMessage.textContent = state.error?.message ?? "选择一个分类开始浏览。";
    setLoginMessage();
  } else if (state.error) {
    setLoginMessage(state.error.message, true);
  } else if (mfaRequired) {
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
}

function renderTrackOptions(select: HTMLSelectElement | null, tracks: Array<{ id: string; label: string }>, emptyLabel: string): void {
  if (!select) return;
  const previous = select.value;
  select.replaceChildren(new Option(emptyLabel, ""));
  for (const track of tracks) select.append(new Option(track.label, track.id));
  if (Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
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

window.zVideo.player.onEvent(renderPlaybackEvent);

void restore();
