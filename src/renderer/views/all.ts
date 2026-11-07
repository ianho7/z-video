import { generatedCover } from "../cover.js";
import type { LocalMediaItem } from "../../shared/local-library-contracts";
import { artworkKind, kindLabel, formatBytes } from "./shared.js";

export function card(item: LocalMediaItem): HTMLElement {
  const article = document.createElement("article");
  article.className = `media-card${item.available ? "" : " unavailable"}`;
  article.setAttribute("role", "listitem");
  const button = document.createElement("button");
  button.className = "media-card-button";
  button.type = "button";
  button.dataset.mediaId = item.mediaId;
  button.setAttribute("aria-label", `查看 ${item.title}`);
  const poster = document.createElement("span");
  poster.className = "media-poster";
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
