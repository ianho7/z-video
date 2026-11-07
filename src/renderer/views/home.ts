import type { LocalContinueWatchingItem } from "../../shared/local-library-contracts";
import { artworkKind, posterFallback, kindLabel, formatTime } from "./shared.js";

export function renderContinueCards(items: LocalContinueWatchingItem[], continueRow: HTMLElement, enqueueArtwork: (element: HTMLElement, priority: number) => void): void {
  for (const entry of items.slice(0, 12)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "continue-card";
    button.dataset.mediaId = entry.item.mediaId;
    button.setAttribute("aria-label", `继续观看《${entry.item.title}》，从 ${formatTime(entry.playback.positionSec)} 开始`);
    const poster = document.createElement("span");
    poster.className = "continue-image";
    const kind = artworkKind(entry.item);
    if (kind) {
      poster.dataset.artworkMediaId = entry.item.mediaId;
      poster.dataset.artworkKind = kind;
      poster.append(posterFallback(entry.item.title));
      enqueueArtwork(poster, 1);
    } else poster.append(posterFallback(entry.item.title));
    const copy = document.createElement("span");
    copy.className = "continue-copy";
    const title = document.createElement("strong");
    title.textContent = entry.item.title;
    const duration = entry.playback.durationSec && entry.playback.durationSec > 0 ? entry.playback.durationSec : 0;
    const percent = duration ? Math.min(100, Math.round(entry.playback.positionSec / duration * 100)) : 0;
    const detailLine = document.createElement("span");
    detailLine.textContent = `${kindLabel(entry.item.kind)} · 已保存至 ${formatTime(entry.playback.positionSec)}${percent ? ` · ${percent}%` : ""}`;
    const track = document.createElement("span");
    track.className = "progress-track";
    const progress = document.createElement("span");
    progress.style.width = `${percent}%`;
    track.append(progress);
    copy.append(title, detailLine, track);
    button.append(poster, copy);
    continueRow.append(button);
  }
}
