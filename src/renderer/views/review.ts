import type { LocalViewingHistory } from "../../shared/local-library-contracts";

const DAY_MS = 86_400_000;

export interface ReviewSessionFacts {
  openLabel: string;
  playedLabel: string;
  lastLabel: string;
}

function durationLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (safe < 60) return `${safe} 秒`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

function lastOpenedLabel(timestampMs: number | undefined, nowMs: number): string {
  if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs <= 0) return "从未打开";
  const days = Math.max(0, Math.round((nowMs - timestampMs) / DAY_MS));
  return days === 0 ? "今天" : `${days} 天前`;
}

/**
 * A3 review-mode facts. The ledger is the only source: open count, accumulated
 * played seconds and the last-open time are rendered verbatim. "第 N 次打开"
 * means the open currently in progress, so the recorded count is advanced by
 * exactly this one session; historical totals are never recomputed here.
 */
export function reviewSessionFacts(history: LocalViewingHistory | undefined, nowMs: number): ReviewSessionFacts {
  if (!history) {
    return { openLabel: "首次打开", playedLabel: "尚无播放记录", lastLabel: "从未打开" };
  }
  return {
    openLabel: `第 ${history.openCount + 1} 次打开`,
    playedLabel: `累计 ${durationLabel(history.totalPlayedSec)}`,
    lastLabel: `上次 ${lastOpenedLabel(history.lastOpenedAtMs, nowMs)}`,
  };
}

export function reviewFactsText(history: LocalViewingHistory | undefined, nowMs: number): string {
  const facts = reviewSessionFacts(history, nowMs);
  if (!history) return `${facts.openLabel} · ${facts.playedLabel}`;
  return `${facts.openLabel} · ${facts.playedLabel} · ${facts.lastLabel}`;
}
