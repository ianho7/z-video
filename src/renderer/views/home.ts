import { coverData, generatedCover } from "../cover.js";
import type { LocalContinueWatchingItem, LocalMediaItem } from "../../shared/local-library-contracts";
import { artworkKind, kindLabel, formatTime } from "./shared.js";

/** The work identity owns the fallback cover, so one work keeps one tone. */
function collectionCoverItem(entry: LocalContinueWatchingItem): LocalMediaItem {
  const { seasonNumber: _seasonNumber, episodeNumber: _episodeNumber, ...item } = entry.item;
  return { ...item, title: entry.collectionTitle, kind: entry.collectionKind };
}

function episodeLabel(entry: LocalContinueWatchingItem): string {
  if (entry.seasonNumber !== undefined && entry.episodeNumber !== undefined) return `第 ${entry.seasonNumber} 季 第 ${entry.episodeNumber} 集`;
  if (entry.episodeNumber !== undefined) return `第 ${entry.episodeNumber} 集`;
  return "";
}

export function renderContinueCards(items: LocalContinueWatchingItem[], continueRow: HTMLElement, enqueueArtwork: (element: HTMLElement, priority: number) => void): void {
  for (const entry of items) {
    const coverItem = collectionCoverItem(entry);
    const label = episodeLabel(entry);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "continue-card";
    button.dataset.mediaId = entry.item.mediaId;
    button.dataset.collectionId = entry.item.collectionId;
    button.setAttribute("aria-label", `继续观看《${entry.collectionTitle}》${label ? `，${label}` : ""}，从 ${formatTime(entry.playback.positionSec)} 开始`);
    const poster = document.createElement("span");
    poster.className = `continue-image cover-shape-${coverData(coverItem).shape}`;
    const kind = artworkKind(entry.item);
    if (kind) {
      poster.dataset.artworkMediaId = entry.item.mediaId;
      poster.dataset.artworkKind = kind;
      poster.append(generatedCover(coverItem));
      enqueueArtwork(poster, 1);
    } else poster.append(generatedCover(coverItem));
    const copy = document.createElement("span");
    copy.className = "continue-copy";
    const title = document.createElement("strong");
    title.textContent = entry.collectionTitle;
    const duration = entry.playback.durationSec && entry.playback.durationSec > 0 ? entry.playback.durationSec : 0;
    const percent = duration ? Math.min(100, Math.round(entry.playback.positionSec / duration * 100)) : 0;
    const detailLine = document.createElement("span");
    detailLine.textContent = [kindLabel(entry.collectionKind), label, `已保存至 ${formatTime(entry.playback.positionSec)}${percent ? ` · ${percent}%` : ""}`].filter(Boolean).join(" · ");
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
