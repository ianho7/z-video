import type { LocalMediaItem, LocalPlaybackState } from "../../shared/local-library-contracts";
import { biscuitPath, wavePath } from "../shapes.js";
import { formatBytes, formatTime } from "./shared.js";

export function episodeRows(episodes: LocalMediaItem[], selectedMediaId: string, playback?: LocalPlaybackState): HTMLButtonElement[] {
  return episodes.map((episode) => {
    const button = document.createElement("button");
    const selected = episode.mediaId === selectedMediaId;
    const watched = selected && Boolean(playback?.watched);
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
    meta.textContent = watched ? "已看完" : selected && playback ? `已看 ${formatTime(playback.positionSec)}` : episode.available ? "可播放" : "来源离线";
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
    if (selected && playback && playback.durationSec && playback.durationSec > 0) {
      const percentage = Math.min(100, playback.positionSec / playback.durationSec * 100);
      const progress = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      progress.classList.add("episode-progress");
      progress.setAttribute("aria-label", `播放进度 ${Math.min(100, playback.positionSec / playback.durationSec * 100).toFixed(0)}%`);
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
