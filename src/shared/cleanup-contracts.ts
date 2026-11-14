/**
 * Cleanup ("整理") contracts: configurable thresholds, A–E candidate rules and
 * the renderer-safe queue DTO. Candidate facts come from the A1 viewing ledger;
 * the rules here only decide which current, on-disk files deserve a look.
 * No path, root or raw row is ever part of these records.
 */
import type { LocalLibraryState, LocalMediaItem, LocalViewingHistory } from "./local-library-contracts";

export type CleanupPreset = "conservative" | "standard" | "aggressive" | "custom";
export type CleanupRuleId = "A" | "B" | "C" | "D" | "E";
export type CleanupState = "none" | "keep" | "snooze" | "delete-candidate";

export const GIB = 1024 * 1024 * 1024;
export const DAY_MS = 86_400_000;

export interface CleanupThresholds {
  /** Days a newly indexed file is protected from A/B. */
  protectionDays: number;
  /** Standard "not opened for a while" gate for B/C. */
  staleDays: number;
  /** Strong stale gate for E. */
  veryStaleDays: number;
  /** At most this many opens still counts as "opened few times" (C). */
  fewOpenCount: number;
  effectiveWatchSec: number;
  effectiveWatchPercent: number;
  /** B: total played below this counts as "just took a look". */
  glanceMaxSec: number;
  /** D: total played below this counts as "low return". */
  lowReturnMaxSec: number;
  lowReturnOpenCount: number;
  lowRevisitOpenCount: number;
  completionPercent: number;
  largeBytes: number;
  veryLargeBytes: number;
  hugeBytes: number;
  /** "Relative large" percentile, active when the library has at least 20 files. */
  relativeLargePercent: number;
}

export interface CleanupRuleToggles {
  A: boolean;
  B: boolean;
  C: boolean;
  D: boolean;
  E: boolean;
}

export interface CleanupSettings {
  preset: CleanupPreset;
  thresholds: CleanupThresholds;
  rules: CleanupRuleToggles;
  snoozeDays: number;
  keepDays: number;
}

export const CLEANUP_PRESETS: Record<Exclude<CleanupPreset, "custom">, CleanupThresholds> = {
  conservative: {
    protectionDays: 60,
    staleDays: 180,
    veryStaleDays: 365,
    fewOpenCount: 1,
    effectiveWatchSec: 30,
    effectiveWatchPercent: 5,
    glanceMaxSec: 30,
    lowReturnMaxSec: 300,
    lowReturnOpenCount: 3,
    lowRevisitOpenCount: 1,
    completionPercent: 95,
    largeBytes: 4 * GIB,
    veryLargeBytes: 8 * GIB,
    hugeBytes: 15 * GIB,
    relativeLargePercent: 20,
  },
  standard: {
    protectionDays: 30,
    staleDays: 90,
    veryStaleDays: 180,
    fewOpenCount: 2,
    effectiveWatchSec: 30,
    effectiveWatchPercent: 3,
    glanceMaxSec: 60,
    lowReturnMaxSec: 600,
    lowReturnOpenCount: 3,
    lowRevisitOpenCount: 3,
    completionPercent: 90,
    largeBytes: 2 * GIB,
    veryLargeBytes: 5 * GIB,
    hugeBytes: 10 * GIB,
    relativeLargePercent: 20,
  },
  aggressive: {
    protectionDays: 14,
    staleDays: 60,
    veryStaleDays: 120,
    fewOpenCount: 3,
    effectiveWatchSec: 15,
    effectiveWatchPercent: 2,
    glanceMaxSec: 120,
    lowReturnMaxSec: 900,
    lowReturnOpenCount: 3,
    lowRevisitOpenCount: 5,
    completionPercent: 85,
    largeBytes: 1 * GIB,
    veryLargeBytes: 3 * GIB,
    hugeBytes: 5 * GIB,
    relativeLargePercent: 20,
  },
};

export const CLEANUP_RULE_ORDER: readonly CleanupRuleId[] = ["C", "D", "A", "B", "E"];

export const CLEANUP_RULE_LABELS: Record<CleanupRuleId, string> = {
  A: "从未打开",
  B: "只看了一眼",
  C: "打开少 + 大文件",
  D: "大文件低回报",
  E: "看完但低回访",
};

export const CLEANUP_PRESET_LABELS: Record<CleanupPreset, string> = {
  conservative: "保守",
  standard: "标准",
  aggressive: "积极",
  custom: "自定义",
};

export const CLEANUP_STATE_LABELS: Record<CleanupState, string> = {
  none: "待整理",
  keep: "已保留",
  snooze: "稍后",
  "delete-candidate": "待删",
};

export const DEFAULT_CLEANUP_SETTINGS: CleanupSettings = {
  preset: "standard",
  thresholds: { ...CLEANUP_PRESETS.standard },
  rules: { A: true, B: true, C: true, D: true, E: true },
  snoozeDays: 30,
  keepDays: 180,
};

/** Defaults used before any user preference is saved. */
export function defaultCleanupSettings(): CleanupSettings {
  return {
    preset: DEFAULT_CLEANUP_SETTINGS.preset,
    thresholds: { ...DEFAULT_CLEANUP_SETTINGS.thresholds },
    rules: { ...DEFAULT_CLEANUP_SETTINGS.rules },
    snoozeDays: DEFAULT_CLEANUP_SETTINGS.snoozeDays,
    keepDays: DEFAULT_CLEANUP_SETTINGS.keepDays,
  };
}

export function resolveCleanupPreset(preset: Exclude<CleanupPreset, "custom">): CleanupThresholds {
  return { ...CLEANUP_PRESETS[preset] };
}

export function isCleanupPreset(value: unknown): value is CleanupPreset {
  return value === "conservative" || value === "standard" || value === "aggressive" || value === "custom";
}

export function isCleanupRuleId(value: unknown): value is CleanupRuleId {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "E";
}

export function isCleanupState(value: unknown): value is CleanupState {
  return value === "none" || value === "keep" || value === "snooze" || value === "delete-candidate";
}

interface ThresholdRule {
  label: string;
  min: number;
  max: number;
  integer?: boolean;
}

const THRESHOLD_RULES: Record<keyof CleanupThresholds, ThresholdRule> = {
  protectionDays: { label: "新片保护期", min: 1, max: 3650, integer: true },
  staleDays: { label: "久未打开", min: 1, max: 3650, integer: true },
  veryStaleDays: { label: "强久未打开", min: 1, max: 3650, integer: true },
  fewOpenCount: { label: "打开少", min: 0, max: 20, integer: true },
  effectiveWatchSec: { label: "有效观看时长", min: 10, max: 300, integer: true },
  effectiveWatchPercent: { label: "有效观看比例", min: 1, max: 100, integer: true },
  glanceMaxSec: { label: "一眼上限", min: 10, max: 300, integer: true },
  lowReturnMaxSec: { label: "低回报上限", min: 10, max: 3600, integer: true },
  lowReturnOpenCount: { label: "低回报打开上限", min: 0, max: 20, integer: true },
  lowRevisitOpenCount: { label: "低回访打开上限", min: 0, max: 20, integer: true },
  completionPercent: { label: "完整看完", min: 1, max: 100, integer: true },
  largeBytes: { label: "大文件", min: 0.5 * GIB, max: 100 * GIB },
  veryLargeBytes: { label: "很大", min: 0.5 * GIB, max: 100 * GIB },
  hugeBytes: { label: "超大", min: 0.5 * GIB, max: 100 * GIB },
  relativeLargePercent: { label: "相对大", min: 1, max: 100, integer: true },
};

const THRESHOLD_KEYS = Object.keys(THRESHOLD_RULES) as Array<keyof CleanupThresholds>;
const RULE_KEYS: Array<keyof CleanupRuleToggles> = ["A", "B", "C", "D", "E"];

/**
 * Strict parser for the persisted cleanup preferences and the setCleanup IPC.
 * Unknown keys and out-of-range values are rejected instead of silently kept.
 */
export function parseCleanupSettings(value: unknown): CleanupSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("清理规则设置格式无效");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["preset", "thresholds", "rules", "snoozeDays", "keepDays"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("清理规则设置字段无效");
  if (!isCleanupPreset(record.preset)) throw new Error("清理规则预设无效");
  if (!record.thresholds || typeof record.thresholds !== "object" || Array.isArray(record.thresholds)) throw new Error("清理阈值格式无效");
  const thresholdRecord = record.thresholds as Record<string, unknown>;
  if (Object.keys(thresholdRecord).some((key) => !(THRESHOLD_KEYS as string[]).includes(key))) throw new Error("清理阈值字段无效");
  const thresholds = {} as CleanupThresholds;
  for (const key of THRESHOLD_KEYS) {
    const rule = THRESHOLD_RULES[key];
    const numeric = thresholdRecord[key];
    if (typeof numeric !== "number" || !Number.isFinite(numeric)) throw new Error(`${rule.label}必须是数字`);
    if (rule.integer && !Number.isInteger(numeric)) throw new Error(`${rule.label}必须是整数`);
    if (numeric < rule.min || numeric > rule.max) throw new Error(`${rule.label}超出允许范围`);
    thresholds[key] = numeric;
  }
  if (!(thresholds.largeBytes <= thresholds.veryLargeBytes && thresholds.veryLargeBytes <= thresholds.hugeBytes)) {
    throw new Error("大文件阈值必须按大文件 ≤ 很大 ≤ 超大排列");
  }
  if (!record.rules || typeof record.rules !== "object" || Array.isArray(record.rules)) throw new Error("清理规则开关格式无效");
  const ruleRecord = record.rules as Record<string, unknown>;
  if (Object.keys(ruleRecord).length !== RULE_KEYS.length || Object.keys(ruleRecord).some((key) => !(RULE_KEYS as string[]).includes(key))) {
    throw new Error("清理规则开关必须包含 A–E");
  }
  const rules = {} as CleanupRuleToggles;
  for (const key of RULE_KEYS) {
    if (typeof ruleRecord[key] !== "boolean") throw new Error("清理规则开关必须是布尔值");
    rules[key] = ruleRecord[key] as boolean;
  }
  const snoozeDays = parseDayCount(record.snoozeDays, "稍后天数");
  const keepDays = parseDayCount(record.keepDays, "保留天数");
  return { preset: record.preset, thresholds, rules, snoozeDays, keepDays };
}

function parseDayCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${label}必须是整数`);
  if (value < 1 || value > 3650) throw new Error(`${label}超出允许范围`);
  return value;
}

export interface CleanupRuleFacts {
  sizeBytes: number;
  addedAtMs: number;
  openCount: number;
  effectiveWatchCount: number;
  completedCount: number;
  totalPlayedSec: number;
  lastOpenedAtMs?: number;
}

export interface CleanupRuleContext {
  nowMs: number;
  /**
   * When the library has at least 20 available files, the "relative large"
   * percentile raises the A/B large-file cutoff to this size.
   */
  relativeLargeBytes?: number;
}

/**
 * First matching rule in display priority C → D → A → B → E. The rules use the
 * A1 ledger's recorded counters as the single source of truth so a card never
 * shows numbers that disagree with the detail page.
 */
export function evaluateCleanupRule(facts: CleanupRuleFacts, settings: CleanupSettings, context: CleanupRuleContext): CleanupRuleId | undefined {
  const { thresholds, rules } = settings;
  const nowMs = context.nowMs;
  const large = Math.max(thresholds.largeBytes, context.relativeLargeBytes ?? 0);
  const veryLarge = thresholds.veryLargeBytes;
  // A missing last-open time means the file was never opened, so every
  // "not opened for N days" gate fails (the file belongs to rule A instead).
  const openedDaysAgo = facts.lastOpenedAtMs === undefined ? undefined : (nowMs - facts.lastOpenedAtMs) / DAY_MS;
  const addedDaysAgo = (nowMs - facts.addedAtMs) / DAY_MS;
  if (rules.C
    && facts.openCount <= thresholds.fewOpenCount
    && facts.completedCount === 0
    && openedDaysAgo !== undefined && openedDaysAgo >= thresholds.staleDays
    && facts.sizeBytes >= veryLarge) return "C";
  if (rules.D
    && facts.sizeBytes >= veryLarge
    && facts.totalPlayedSec < thresholds.lowReturnMaxSec
    && facts.openCount <= thresholds.lowReturnOpenCount) return "D";
  if (rules.A
    && facts.openCount === 0
    && addedDaysAgo >= thresholds.protectionDays
    && facts.sizeBytes >= large) return "A";
  if (rules.B
    && facts.openCount >= 1
    && facts.effectiveWatchCount === 0
    && facts.totalPlayedSec < thresholds.glanceMaxSec
    && openedDaysAgo !== undefined && openedDaysAgo >= thresholds.protectionDays
    && facts.sizeBytes >= large) return "B";
  if (rules.E
    && facts.completedCount >= 1
    && openedDaysAgo !== undefined && openedDaysAgo >= thresholds.veryStaleDays
    && facts.sizeBytes >= veryLarge
    && facts.openCount <= thresholds.lowRevisitOpenCount) return "E";
  return undefined;
}

/**
 * The state a mark has right now. `keep` is terminal: the user asked the app to
 * stop proposing the file, so no `cleanup_until` value (including a stale one
 * written before this rule) ever returns it to the queue. `snooze` still expires
 * back into the active queue, and `delete-candidate` never expires.
 */
export function effectiveCleanupState(state: CleanupState, cleanupUntilMs: number | undefined, nowMs: number): CleanupState {
  if (state === "delete-candidate") return "delete-candidate";
  if (state === "keep") return "keep";
  if (state === "snooze") {
    return cleanupUntilMs !== undefined && Number.isFinite(cleanupUntilMs) && cleanupUntilMs > nowMs ? "snooze" : "none";
  }
  return "none";
}

/** One active candidate. `rule` is always present for the queue. */
export interface CleanupThresholdField {
  key: keyof CleanupThresholds;
  label: string;
  /** Display unit. Stored values are bytes or seconds where the unit differs. */
  unit: "天" | "次" | "秒" | "分钟" | "%" | "GB";
  /** display = stored * displayScale; stored = display / displayScale. */
  displayScale: number;
  min: number;
  max: number;
  step: number;
  group: "time" | "count" | "watch" | "size";
}

/** Advanced-settings fields with the documented per-threshold ranges. */
export const CLEANUP_THRESHOLD_FIELDS: readonly CleanupThresholdField[] = [
  { key: "protectionDays", label: "新片保护期", unit: "天", displayScale: 1, min: 7, max: 90, step: 1, group: "time" },
  { key: "staleDays", label: "久未打开", unit: "天", displayScale: 1, min: 30, max: 365, step: 1, group: "time" },
  { key: "veryStaleDays", label: "强久未打开", unit: "天", displayScale: 1, min: 90, max: 730, step: 1, group: "time" },
  { key: "fewOpenCount", label: "打开少", unit: "次", displayScale: 1, min: 0, max: 5, step: 1, group: "count" },
  { key: "lowReturnOpenCount", label: "低回报打开上限", unit: "次", displayScale: 1, min: 0, max: 10, step: 1, group: "count" },
  { key: "lowRevisitOpenCount", label: "低回访打开上限", unit: "次", displayScale: 1, min: 0, max: 10, step: 1, group: "count" },
  { key: "effectiveWatchSec", label: "有效观看时长", unit: "秒", displayScale: 1, min: 10, max: 120, step: 5, group: "watch" },
  { key: "effectiveWatchPercent", label: "有效观看比例", unit: "%", displayScale: 1, min: 1, max: 20, step: 1, group: "watch" },
  { key: "glanceMaxSec", label: "一眼上限", unit: "秒", displayScale: 1, min: 10, max: 300, step: 5, group: "watch" },
  { key: "lowReturnMaxSec", label: "低回报上限", unit: "分钟", displayScale: 1 / 60, min: 1, max: 60, step: 1, group: "watch" },
  { key: "completionPercent", label: "完整看完", unit: "%", displayScale: 1, min: 80, max: 100, step: 1, group: "watch" },
  { key: "largeBytes", label: "大文件", unit: "GB", displayScale: 1 / GIB, min: 0.5, max: 20, step: 0.5, group: "size" },
  { key: "veryLargeBytes", label: "很大", unit: "GB", displayScale: 1 / GIB, min: 1, max: 50, step: 0.5, group: "size" },
  { key: "hugeBytes", label: "超大", unit: "GB", displayScale: 1 / GIB, min: 2, max: 100, step: 0.5, group: "size" },
  { key: "relativeLargePercent", label: "相对大（前 %）", unit: "%", displayScale: 1, min: 10, max: 30, step: 1, group: "size" },
];

export interface LocalCleanupCandidate {
  item: LocalMediaItem;
  viewing?: LocalViewingHistory;
  rule: CleanupRuleId;
  cleanupState: CleanupState;
  cleanupUntilMs?: number;
  /** Imported-at time; renderer-safe and used for the protection-day reason. */
  addedAtMs: number;
}

/** One delete-list entry. It stays listed even if settings changed its rule. */
export interface LocalCleanupQueueItem {
  item: LocalMediaItem;
  viewing?: LocalViewingHistory;
  rule?: CleanupRuleId;
  cleanupState: CleanupState;
  cleanupUntilMs?: number;
  addedAtMs: number;
}

export interface LocalCleanupQueueQuery {
  /** "all" (default) or one rule id. */
  rule?: CleanupRuleId | "all";
  /** "none" is the active queue; keep/snooze/delete show marked files. */
  state?: CleanupState;
  page: number;
  pageSize: number;
}

export interface LocalCleanupQueue {
  query: LocalCleanupQueueQuery;
  candidates: LocalCleanupCandidate[];
  totalCount: number;
  totalBytes: number;
  deleteQueue: LocalCleanupQueueItem[];
  deleteCount: number;
  deleteBytes: number;
  /** Set when the library has at least 20 available files. */
  relativeLargeBytes?: number;
  nowMs: number;
}

export interface LocalCleanupQueueResult {
  state: LocalLibraryState;
  queue: LocalCleanupQueue;
}

export interface LocalCleanupStateInput {
  mediaId: `media_${string}`;
  state: CleanupState;
}

export interface LocalCleanupRevealResult {
  revealed: boolean;
}
