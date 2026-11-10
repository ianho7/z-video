import type { LocalMediaItem, LocalPlaybackState, LocalViewingHistory } from "../../shared/local-library-contracts";
import { biscuitPath, wavePath } from "../shapes.js";
import { formatBytes, formatTime } from "./shared.js";

export function episodeRows(episodes: LocalMediaItem[], selectedMediaId: string, playback?: LocalPlaybackState, episodePlayback: LocalPlaybackState[] = []): HTMLButtonElement[] {
  const stateByMediaId = new Map(episodePlayback.map((state) => [state.mediaId, state]));
  return episodes.map((episode) => {
    const button = document.createElement("button");
    const selected = episode.mediaId === selectedMediaId;
    const state = stateByMediaId.get(episode.mediaId) ?? (selected ? playback : undefined);
    const watched = Boolean(state?.watched);
    const positionSec = state?.positionSec ?? 0;
    const hasProgress = !watched && positionSec > 0;
    button.type = "button";
    button.className = `episode-row${selected ? " current" : ""}${watched ? " watched" : ""}`;
    button.dataset.mediaId = episode.mediaId;
    button.setAttribute("aria-selected", String(selected));

    const poster = document.createElement("span");
    poster.className = "episode-thumb";
    poster.setAttribute("aria-hidden", "true");
    const artwork = episode.artwork?.find((entry) => entry.kind === "poster");
    if (artwork) {
      poster.dataset.artworkMediaId = episode.mediaId;
      poster.dataset.artworkKind = artwork.kind;
    }
    const number = document.createElement("span");
    number.className = "episode-number";
    number.textContent = episode.episodeNumber === undefined ? "—" : String(episode.episodeNumber).padStart(2, "0");
    number.setAttribute("aria-label", episode.episodeNumber === undefined ? "剧集" : `第 ${episode.episodeNumber} 集`);
    const copy = document.createElement("span");
    copy.className = "episode-copy";
    const title = document.createElement("span");
    title.className = "episode-title";
    title.textContent = episode.title;
    const meta = document.createElement("span");
    meta.className = "episode-duration";
    const metaParts = [watched ? "已看完" : hasProgress ? `看到 ${formatTime(positionSec)}` : "未看"];
    if (!episode.available) metaParts.push("来源离线");
    meta.textContent = metaParts.join(" · ");
    copy.append(title, meta);
    const mark = document.createElement("span");
    mark.className = "episode-watched-mark";
    mark.setAttribute("aria-hidden", "true");
    const markShape = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    markShape.setAttribute("viewBox", "0 0 32 32");
    const biscuit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    biscuit.setAttribute("d", biscuitPath(14, 2, 8));
    biscuit.setAttribute("class", "episode-watched-biscuit");
    const check = document.createElementNS("http://www.w3.org/2000/svg", "path");
    check.setAttribute("d", "M8 16 L13.5 21.5 L24 10.5");
    check.setAttribute("class", "episode-watched-check");
    markShape.append(biscuit, check);
    mark.append(markShape);
    button.append(poster, number, copy, mark);
    if (hasProgress && state?.durationSec && state.durationSec > 0) {
      const percentage = Math.min(100, positionSec / state.durationSec * 100);
      const progress = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      progress.classList.add("episode-progress");
      progress.setAttribute("aria-label", `播放进度 ${percentage.toFixed(0)}%`);
      progress.setAttribute("role", "img");
      progress.setAttribute("viewBox", "0 0 100 10");
      const path = wavePath(100, 5, 1.6, 6);
      const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
      track.setAttribute("d", path);
      track.setAttribute("class", "episode-progress-track");
      const played = document.createElementNS("http://www.w3.org/2000/svg", "path");
      played.setAttribute("d", path);
      played.setAttribute("pathLength", "100");
      played.setAttribute("stroke-dasharray", `${percentage} 100`);
      played.setAttribute("class", "episode-progress-played");
      progress.append(track, played);
      button.append(progress);
    }
    return button;
  });
}

export function renderSeasonTabs(episodes: LocalMediaItem[], selectedSeason: number | undefined): HTMLButtonElement[] {
  const seasons = [...new Set(episodes.map((episode) => episode.seasonNumber).filter((season): season is number => season !== undefined))];
  if (seasons.length < 2) return [];
  return seasons.map((season) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "season-tab";
    button.dataset.seasonNumber = String(season);
    button.setAttribute("aria-pressed", String(season === selectedSeason));
    button.textContent = `第 ${season} 季`;
    return button;
  });
}

export function renderMovieFileInfo(item: LocalMediaItem, sourceLabel: string, playback?: LocalPlaybackState): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "detail-file-info";
  const rows: Array<[string, string]> = [
    ["文件大小", formatBytes(item.sizeBytes)],
    ["修改时间", new Date(item.modifiedAtMs).toLocaleString("zh-CN")],
    ["来源", sourceLabel],
    ["观看进度", playback?.durationSec ? `${formatTime(playback.positionSec)} / ${formatTime(playback.durationSec)}` : playback?.watched ? "已看完" : playback ? `已看 ${formatTime(playback.positionSec)}` : "尚未播放"],
  ];
  for (const [label, value] of rows) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    group.append(term, detail);
    list.append(group);
  }
  return list;
}

export interface ViewingRecordOptions {
  history?: LocalViewingHistory;
  /** playback_state saved before the viewing ledger existed. */
  legacyPlayback?: LocalPlaybackState;
  fileSizeBytes: number;
  nowMs?: number;
}

export interface ViewingRecordView {
  list: HTMLDListElement;
  empty: HTMLParagraphElement;
}

/**
 * Detail "你的记录" block. A real aggregate renders counts and durations; an
 * empty file renders one sentence (plus the legacy saved position when one
 * exists) instead of a wall of zeroes.
 */
export function renderViewingRecord(options: ViewingRecordOptions): ViewingRecordView {
  const list = document.createElement("dl");
  list.className = "detail-viewing";
  const empty = document.createElement("p");
  empty.className = "detail-viewing-empty";
  const history = options.history;
  if (!history) {
    empty.hidden = false;
    empty.textContent = options.legacyPlayback
      ? `上次看到（旧记录） ${formatTime(options.legacyPlayback.positionSec)}。打开次数、有效观看和累计时长从现在开始记录。`
      : "还没有记录。播放后会在这里累计打开、有效观看和看完次数。";
    return { list, empty };
  }
  empty.hidden = true;
  const completionRate = history.effectiveWatchCount > 0
    ? `${Math.round(history.completedCount / history.effectiveWatchCount * 100)}%`
    : "—";
  const rows: Array<[string, string]> = [
    ["打开次数", `${history.openCount} 次`],
    ["有效观看", `${history.effectiveWatchCount} 次`],
    ["累计观看", history.totalPlayedSec > 0 ? formatWatchDuration(history.totalPlayedSec) : "—"],
    ["完整看完", `${history.completedCount} 次`],
    ["上次打开", relativeDayLabel(history.lastOpenedAtMs, options.nowMs)],
    ["上次时长", history.lastSessionPlayedSec > 0
      ? `播放 ${formatWatchDuration(history.lastSessionPlayedSec)}（停留 ${formatWatchDuration(history.lastSessionWallSec)}）`
      : "—"],
    ["完成率", completionRate],
    ["GB/小时", history.totalPlayedSec > 0
      ? `${(options.fileSizeBytes / (1024 * 1024 * 1024) / (history.totalPlayedSec / 3600)).toFixed(1)} GB/小时`
      : "未产生观看"],
  ];
  for (const [label, value] of rows) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    group.append(term, detail);
    list.append(group);
  }
  return { list, empty };
}

export function formatWatchDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (safe < 60) return `${safe} 秒`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

export function relativeDayLabel(timestampMs: number, nowMs = Date.now()): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "—";
  const startOfDay = (value: number): number => {
    const date = new Date(value);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const days = Math.max(0, Math.round((startOfDay(nowMs) - startOfDay(timestampMs)) / 86_400_000));
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return new Date(timestampMs).toLocaleDateString("zh-CN");
}
