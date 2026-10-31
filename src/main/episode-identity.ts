import { createHash } from "node:crypto";

import type { NasEpisode } from "./nas-client";

/** Renderer-safe identity for an Episode whose server identity is path-only. */
export function rendererEpisodeId(episode: NasEpisode, collectionId: string): string {
  const candidate = episode.episodeId.trim();
  if (candidate && !looksLikePrivateMediaReference(candidate)) return candidate;
  const source = episode.filePath?.trim() || candidate || `${collectionId}-${episode.seasonNumber}-${episode.episodeNumber}`;
  const digest = createHash("sha256")
    .update(`${collectionId}\u0000${episode.seasonNumber}\u0000${episode.episodeNumber}\u0000${source}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `episode-path-${digest}`;
}

function looksLikePrivateMediaReference(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) || value.includes("/") || value.includes("\\");
}
