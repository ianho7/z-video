import type { LocalMediaItem } from "../shared/local-library-contracts";
import { applyTone, toneNames } from "./tone.js";

export function coverData(item: LocalMediaItem, episodeCount?: number) {
  let hash = 2166136261;
  for (const char of item.mediaId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const seed = hash >>> 0;
  const title = item.title.replace(/^[\s\p{P}\p{S}\d]+/u, "");
  const extension = item.title.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toUpperCase();
  return { tone: toneNames[seed % toneNames.length], shape: (seed >>> 8) % 4, initial: Array.from(title)[0] ?? "影", subtitle: item.kind === "episode" && item.episodeNumber !== undefined ? `E${String(item.episodeNumber).padStart(2, "0")}` : item.year !== undefined ? String(item.year) : episodeCount ? `${episodeCount} 集` : extension ?? "" };
}

export function generatedCover(item: LocalMediaItem, episodeCount?: number): HTMLElement {
  const data = coverData(item, episodeCount);
  const element = document.createElement("span");
  element.className = `poster-fallback cover-shape-${data.shape}`;
  applyTone(element, data.tone);
  const initial = document.createElement("strong");
  initial.textContent = data.initial;
  const subtitle = document.createElement("span");
  subtitle.textContent = data.subtitle;
  element.append(initial, subtitle);
  return element;
}
