import type {
  CleanupRuleId,
  CleanupSettings,
  CleanupThresholds,
  LocalCleanupCandidate,
  LocalCleanupQueueItem,
} from "../../shared/cleanup-contracts";
import { CLEANUP_RULE_LABELS, CLEANUP_STATE_LABELS } from "../../shared/cleanup-contracts.js";
import { formatBytes, kindLabel } from "./shared.js";

const DAY_MS = 86_400_000;

export function cleanupRuleLabel(rule: CleanupRuleId | undefined): string {
  return rule ? CLEANUP_RULE_LABELS[rule] : "已标记";
}

export function cleanupStateLabel(state: LocalCleanupCandidate["cleanupState"]): string {
  return CLEANUP_STATE_LABELS[state];
}

function shortDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (safe < 60) return `${safe} 秒`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

function secondsLabel(seconds: number): string {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${Math.round(seconds)} 秒`;
}

function daysSinceLabel(timestampMs: number | undefined, nowMs: number): string {
  if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs <= 0) return "从未";
  const days = Math.max(0, Math.round((nowMs - timestampMs) / DAY_MS));
  return days === 0 ? "今天" : `${days} 天前`;
}

function daysSince(timestampMs: number | undefined, nowMs: number): number | undefined {
  if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs <= 0) return undefined;
  return Math.max(0, Math.round((nowMs - timestampMs) / DAY_MS));
}

/**
 * "Why this candidate" text. It always shows the current threshold and the
 * file's own numbers, so the recommendation stays inspectable instead of a
 * black-box score.
 */
export function cleanupCandidateReason(candidate: LocalCleanupCandidate, thresholds: CleanupThresholds, nowMs: number, relativeLargeBytes?: number): string {
  const item = candidate.item;
  const history = candidate.viewing;
  const openCount = history?.openCount ?? 0;
  const effectiveWatchCount = history?.effectiveWatchCount ?? 0;
  const completedCount = history?.completedCount ?? 0;
  const totalPlayedSec = history?.totalPlayedSec ?? 0;
  const large = Math.max(thresholds.largeBytes, relativeLargeBytes ?? 0);
  const relativeNote = relativeLargeBytes !== undefined && relativeLargeBytes > thresholds.largeBytes
    ? `（片库前 ${thresholds.relativeLargePercent}% 为 ${formatBytes(relativeLargeBytes)}）`
    : "";
  const size = formatBytes(item.sizeBytes);
  const lastOpened = daysSinceLabel(history?.lastOpenedAtMs, nowMs);
  switch (candidate.rule) {
    case "A":
      return `从未打开 · 加入片库 ${daysSinceLabel(candidate.addedAtMs, nowMs)}（保护期 ${thresholds.protectionDays} 天） · ${size} ≥ ${formatBytes(large)}${relativeNote}`;
    case "B":
      return `只看了一眼 · 打开 ${openCount} 次，有效观看 ${effectiveWatchCount} 次 · 累计 ${shortDuration(totalPlayedSec)} < 一眼上限 ${secondsLabel(thresholds.glanceMaxSec)} · 上次打开 ${lastOpened} ≥ 保护期 ${thresholds.protectionDays} 天 · ${size} ≥ ${formatBytes(large)}${relativeNote}`;
    case "C":
      return `打开少 + 大文件 · 打开 ${openCount} 次 ≤ ${thresholds.fewOpenCount} 次 · 未看完 · 上次打开 ${lastOpened} ≥ ${thresholds.staleDays} 天 · ${size} ≥ ${formatBytes(thresholds.veryLargeBytes)}`;
    case "D":
      return `大文件低回报 · ${size} ≥ ${formatBytes(thresholds.veryLargeBytes)} · 累计 ${shortDuration(totalPlayedSec)} < 低回报上限 ${secondsLabel(thresholds.lowReturnMaxSec)} · 打开 ${openCount} 次 ≤ ${thresholds.lowReturnOpenCount} 次`;
    case "E":
      return `看完但低回访 · 看完 ${completedCount} 次 · 上次打开 ${lastOpened} ≥ ${thresholds.veryStaleDays} 天 · ${size} ≥ ${formatBytes(thresholds.veryLargeBytes)} · 打开 ${openCount} 次 ≤ ${thresholds.lowRevisitOpenCount} 次`;
    default:
      return `打开 ${openCount} 次 · ${size}`;
  }
}

export interface CleanupCardOptions {
  candidate: LocalCleanupCandidate;
  settings: CleanupSettings;
  nowMs: number;
  relativeLargeBytes?: number;
  artworkReady: boolean;
}

/** One candidate card: poster, title/size, rule + reason and the three marks. */
export function renderCleanupCandidate(options: CleanupCardOptions): HTMLElement {
  const { candidate, nowMs } = options;
  const item = candidate.item;
  const card = document.createElement("article");
  card.className = "cleanup-card";
  card.dataset.cleanupMediaId = item.mediaId;
  card.dataset.cleanupRule = candidate.rule;
  card.dataset.cleanupState = candidate.cleanupState;
  card.setAttribute("role", "listitem");

  const poster = document.createElement("span");
  poster.className = "cleanup-card-poster";
  poster.setAttribute("aria-hidden", "true");
  poster.textContent = item.title.slice(0, 2) || "影片";
  const artwork = item.artwork?.find((entry) => entry.kind === "poster");
  if (artwork && options.artworkReady) {
    poster.dataset.artworkMediaId = item.mediaId;
    poster.dataset.artworkKind = artwork.kind;
  }

  const copy = document.createElement("div");
  copy.className = "cleanup-card-copy";
  const title = document.createElement("span");
  title.className = "cleanup-card-title";
  title.textContent = item.title;
  const meta = document.createElement("span");
  meta.className = "cleanup-card-size";
  const parts = [kindLabel(item.kind), formatBytes(item.sizeBytes)];
  if (item.seasonNumber !== undefined && item.episodeNumber !== undefined) parts.splice(1, 0, `S${String(item.seasonNumber).padStart(2, "0")}E${String(item.episodeNumber).padStart(2, "0")}`);
  meta.textContent = parts.join(" · ");
  const rule = document.createElement("span");
  rule.className = "cleanup-card-rule";
  rule.textContent = `规则 ${candidate.rule} · ${CLEANUP_RULE_LABELS[candidate.rule]}`;
  if (candidate.cleanupState !== "none") {
    const stateChip = document.createElement("span");
    stateChip.className = `cleanup-state-chip cleanup-state-${candidate.cleanupState}`;
    stateChip.textContent = CLEANUP_STATE_LABELS[candidate.cleanupState];
    rule.append(" ", stateChip);
  }
  const reason = document.createElement("p");
  reason.className = "cleanup-card-reason";
  reason.textContent = cleanupCandidateReason(candidate, options.settings.thresholds, nowMs, options.relativeLargeBytes);
  copy.append(title, meta, rule, reason);

  const actions = document.createElement("div");
  actions.className = "cleanup-card-actions";
  const addAction = (action: "review" | "keep" | "snooze" | "delete" | "none", label: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action === "delete" ? "secondary-button cleanup-delete-button" : action === "review" ? "secondary-button cleanup-review-button" : "secondary-button";
    button.dataset.cleanupAction = action;
    button.textContent = label;
    button.setAttribute("aria-label", `${label}《${item.title}》`);
    actions.append(button);
  };
  card.tabIndex = -1;
  addAction("review", "打开检查");
  if (candidate.cleanupState === "none") {
    addAction("keep", "保留");
    addAction("snooze", "稍后");
    addAction("delete", "待删");
  } else {
    addAction("none", candidate.cleanupState === "delete-candidate" ? "移回候选" : "撤销标记");
  }

  card.append(poster, copy, actions);
  return card;
}

export function renderCleanupDeleteItem(entry: LocalCleanupQueueItem): HTMLElement {
  const item = document.createElement("li");
  item.className = "cleanup-delete-item";
  item.dataset.cleanupMediaId = entry.item.mediaId;
  const copy = document.createElement("div");
  copy.className = "cleanup-delete-copy";
  const title = document.createElement("strong");
  title.textContent = entry.item.title;
  const meta = document.createElement("span");
  meta.textContent = `${formatBytes(entry.item.sizeBytes)}${entry.rule ? ` · ${CLEANUP_RULE_LABELS[entry.rule]}` : ""}`;
  copy.append(title, meta);
  const actions = document.createElement("div");
  actions.className = "cleanup-delete-actions";
  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.className = "secondary-button";
  reveal.dataset.cleanupReveal = entry.item.mediaId;
  reveal.textContent = "在资源管理器中显示";
  const unmark = document.createElement("button");
  unmark.type = "button";
  unmark.className = "secondary-button";
  unmark.dataset.cleanupUnmark = entry.item.mediaId;
  unmark.textContent = "移回候选";
  actions.append(reveal, unmark);
  item.append(copy, actions);
  return item;
}

/** Compact one-line threshold summary for the settings dialog. */
export function cleanupSettingsSummary(settings: CleanupSettings): string {
  const t = settings.thresholds;
  const enabled = (["A", "B", "C", "D", "E"] as const).filter((rule) => settings.rules[rule]).join("");
  return `保护 ${t.protectionDays} 天 · 久未打开 ${t.staleDays} 天 · 大文件 ≥ ${formatBytes(t.largeBytes)} · 很大 ≥ ${formatBytes(t.veryLargeBytes)} · 规则 ${enabled || "全部关闭"}`;
}

export { CLEANUP_RULE_LABELS };
