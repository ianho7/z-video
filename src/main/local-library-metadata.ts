import { XMLParser } from "fast-xml-parser";

export type NfoKind = "movie" | "tvshow" | "episode";

export interface ParsedNfo {
  kind?: NfoKind;
  title?: string;
  showTitle?: string;
  year?: number;
  plot?: string;
  genres: string[];
  rating?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  artwork: Array<{ kind: "poster" | "fanart"; path: string }>;
}

export interface EpisodeNumbers {
  seasonNumber?: number;
  episodeNumber?: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
});

export function parseNfo(xml: string): ParsedNfo {
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) throw new Error("NFO 不允许包含 DOCTYPE 或 ENTITY");
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rootName = Object.keys(parsed).find((key) => key !== "?xml");
  if (!rootName || !["movie", "tvshow", "episodedetails"].includes(rootName.toLowerCase())) {
    throw new Error("NFO 根节点不是 movie、tvshow 或 episodedetails");
  }
  const root = asRecord(parsed[rootName]) ?? {};
  const kind: NfoKind = rootName.toLowerCase() === "movie"
    ? "movie"
    : rootName.toLowerCase() === "tvshow" ? "tvshow" : "episode";
  const genres = uniqueStrings([
    ...textValue(root.genre),
    ...textValue(root.genres),
  ]);
  const artwork = [
    ...artworkValues(root.thumb, "poster"),
    ...artworkValues(root.poster, "poster"),
    ...artworkValues(asRecord(root.fanart)?.thumb, "fanart"),
  ];
  const rating = numberValue(root.rating) ?? numberValue(asRecord(root.ratings)?.rating);
  return {
    kind,
    title: firstString(root.title),
    showTitle: firstString(root.showtitle),
    year: integerValue(root.year) ?? yearFrom(firstString(root.premiered)),
    plot: firstString(root.plot) ?? firstString(root.outline) ?? firstString(root.description),
    genres,
    ...(rating !== undefined ? { rating } : {}),
    ...(integerValue(root.season) !== undefined ? { seasonNumber: integerValue(root.season) } : {}),
    ...(integerValue(root.episode) !== undefined ? { episodeNumber: integerValue(root.episode) } : {}),
    artwork,
  };
}

export function parseEpisodeNumbers(value: string): EpisodeNumbers {
  const seasonEpisode = /(?:^|[^a-z])s(\d{1,2})\s*e(\d{1,3})(?:[^a-z]|$)/i.exec(value);
  if (seasonEpisode) return { seasonNumber: Number(seasonEpisode[1]), episodeNumber: Number(seasonEpisode[2]) };
  const xEpisode = /(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?:[^0-9]|$)/i.exec(value);
  if (xEpisode) return { seasonNumber: Number(xEpisode[1]), episodeNumber: Number(xEpisode[2]) };
  return {};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function values(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string[] {
  return values(value).flatMap((candidate) => {
    if (typeof candidate === "string" || typeof candidate === "number") {
      const text = String(candidate).trim();
      return text ? [text] : [];
    }
    const record = asRecord(candidate);
    if (!record) return [];
    return textValue(record["#text"] ?? record["__text"] ?? record.text ?? record.value);
  });
}

function firstString(value: unknown): string | undefined {
  return textValue(value)[0];
}

function numberValue(value: unknown): number | undefined {
  const text = firstString(value);
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integerValue(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function yearFrom(value: string | undefined): number | undefined {
  const match = value?.match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : undefined;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function artworkValues(value: unknown, defaultKind: "poster" | "fanart"): Array<{ kind: "poster" | "fanart"; path: string }> {
  return values(value).flatMap((candidate) => {
    const record = asRecord(candidate);
    const path = firstString(record ? record["#text"] ?? record["__text"] ?? record.text ?? record.value : candidate);
    if (!path) return [];
    const aspect = record?.["@_aspect"];
    const kind = typeof aspect === "string" && aspect.toLowerCase().includes("fanart") ? "fanart" : defaultKind;
    return [{ kind, path }];
  });
}
