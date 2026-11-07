import type { LocalMediaItem } from "../../shared/local-library-contracts";

export function episodeRows(episodes: LocalMediaItem[], selectedMediaId: string): HTMLButtonElement[] {
  return episodes.map((episode) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "episode-row";
      button.dataset.mediaId = episode.mediaId;
      button.setAttribute("aria-selected", String(episode.mediaId === selectedMediaId));
      const number = document.createElement("span");
      number.className = "episode-number";
      number.textContent = episode.seasonNumber !== undefined && episode.episodeNumber !== undefined ? `S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")}` : "剧集";
      const title = document.createElement("span");
      title.className = "episode-title";
      title.textContent = episode.title;
      const availability = document.createElement("span");
      availability.className = "episode-duration";
      availability.textContent = episode.available ? "可播放" : "离线";
      button.append(number, title, availability);
      return button;
  });
}
