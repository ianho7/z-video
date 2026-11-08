import { coverData, generatedCover } from "../cover.js";
import type { LocalCollectionSummary, LocalMediaItem } from "../../shared/local-library-contracts";
import { artworkKind, kindLabel, formatBytes, formatTime } from "./shared.js";

function summaryItem(collection: LocalCollectionSummary): LocalMediaItem {
  return {
    mediaId: collection.representativeMediaId,
    sourceId: "",
    collectionId: collection.collectionId,
    title: collection.title,
    kind: collection.kind,
    sizeBytes: 0,
    modifiedAtMs: collection.updatedAtMs,
    available: collection.available,
    ...(collection.year === undefined ? {} : { year: collection.year }),
    premieredDate: collection.premieredDate,
  };
}

function episodeLabel(resume: NonNullable<LocalCollectionSummary["resume"]>): string {
  if (resume.seasonNumber !== undefined && resume.episodeNumber !== undefined) return `第 ${resume.seasonNumber} 季 第 ${resume.episodeNumber} 集`;
  if (resume.episodeNumber !== undefined) return `第 ${resume.episodeNumber} 集`;
  return resume.episodeTitle;
}

/**
 * One card per work. The button carries the representative media ID so the
 * existing detail flow opens the work without a second lookup, and the card
 * never shows a file size or a private path.
 */
export function collectionCard(collection: LocalCollectionSummary, includeReleaseDate = false): HTMLElement {
  const article = document.createElement("article");
  article.className = `media-card${collection.available ? "" : " unavailable"}`;
  article.dataset.collectionId = collection.collectionId;
  article.setAttribute("role", "listitem");
  const button = document.createElement("button");
  button.className = "media-card-button";
  button.type = "button";
  button.dataset.mediaId = collection.representativeMediaId;
  button.dataset.collectionId = collection.collectionId;
  button.setAttribute("aria-label", `打开《${collection.title}》详情`);
  const posterItem = summaryItem(collection);
  const poster = document.createElement("span");
  poster.className = `media-poster cover-shape-${coverData(posterItem, collection.episodeCount).shape}`;
  const artwork = collection.artwork?.find((entry) => entry.kind === "poster");
  if (artwork) {
    poster.dataset.artworkMediaId = collection.coverMediaId;
    poster.dataset.artworkKind = artwork.kind;
  }
  poster.append(generatedCover(posterItem, collection.episodeCount));
  if (!collection.available) {
    const offline = document.createElement("span");
    offline.className = "offline-badge";
    offline.textContent = "来源离线";
    poster.append(offline);
  }
  const title = document.createElement("span");
  title.className = "media-card-title";
  title.textContent = collection.title;
  const meta = document.createElement("span");
  meta.className = "media-card-meta";
  const parts = [kindLabel(collection.kind)];
  if (collection.year !== undefined) parts.push(String(collection.year));
  if (collection.kind === "show") parts.push(`${collection.episodeCount} 集`);
  if (includeReleaseDate) parts.push(collection.premieredDate ?? "发布日期未知");
  meta.textContent = parts.join(" · ");
  const progress = document.createElement("span");
  progress.className = "media-card-progress";
  if (collection.kind === "show") {
    const watched = `已看 ${collection.watchedEpisodeCount} 集`;
    if (collection.resume) progress.textContent = `${watched} · 继续${episodeLabel(collection.resume)}`;
    else if (collection.episodeCount > 0 && collection.watchedEpisodeCount >= collection.episodeCount) progress.textContent = `${watched} · 已看完`;
    else progress.textContent = `${watched} · 还没看`;
  } else if (collection.resume) {
    progress.textContent = `看到 ${formatTime(collection.resume.positionSec)}`;
  } else {
    progress.textContent = collection.watchedEpisodeCount > 0 ? "已看完" : "还没看";
  }
  button.append(poster, title, meta, progress);
  article.append(button);
  return article;
}

export function card(item: LocalMediaItem, includeReleaseDate = false): HTMLElement {
  const article = document.createElement("article");
  article.className = `media-card${item.available ? "" : " unavailable"}`;
  article.setAttribute("role", "listitem");
  const button = document.createElement("button");
  button.className = "media-card-button";
  button.type = "button";
  button.dataset.mediaId = item.mediaId;
  button.setAttribute("aria-label", `查看 ${item.title}`);
  const poster = document.createElement("span");
  poster.className = `media-poster cover-shape-${coverData(item).shape}`;
  const kind = artworkKind(item);
  if (kind) {
    poster.dataset.artworkMediaId = item.mediaId;
    poster.dataset.artworkKind = kind;
    poster.append(generatedCover(item));
  } else {
    poster.append(generatedCover(item));
  }
  const title = document.createElement("span");
  title.className = "media-card-title";
  title.textContent = item.title;
  const meta = document.createElement("span");
  meta.className = "media-card-meta";
  const parts = [kindLabel(item.kind)];
  if (item.year !== undefined) parts.push(String(item.year));
  if (includeReleaseDate) parts.push(item.premieredDate ?? "发布日期未知");
  if (item.rating !== undefined) parts.push(`★ ${item.rating.toFixed(1)}`);
  meta.textContent = `${parts.join(" · ")} · ${formatBytes(item.sizeBytes)}`;
  button.append(poster);
  if (!item.available) {
    const offline = document.createElement("span");
    offline.className = "offline-badge";
    offline.textContent = "来源离线";
    poster.append(offline);
  }
  button.append(title, meta);
  article.append(button);
  return article;
}
