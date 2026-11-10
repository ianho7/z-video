import assert from "node:assert/strict";
import test from "node:test";

import {
  CLEANUP_PRESETS,
  CLEANUP_RULE_ORDER,
  DEFAULT_CLEANUP_SETTINGS,
  effectiveCleanupState,
  evaluateCleanupRule,
  isCleanupPreset,
  isCleanupRuleId,
  isCleanupState,
  parseCleanupSettings,
  resolveCleanupPreset,
  type CleanupRuleFacts,
} from "../src/shared/cleanup-contracts";

const DAY_MS = 86_400_000;
const GB = 1024 * 1024 * 1024;
const NOW = 400 * DAY_MS;

function facts(seed: Partial<CleanupRuleFacts> = {}): CleanupRuleFacts {
  return {
    sizeBytes: 3 * GB,
    addedAtMs: NOW - 60 * DAY_MS,
    openCount: 0,
    effectiveWatchCount: 0,
    completedCount: 0,
    totalPlayedSec: 0,
    ...seed,
  };
}

test("cleanup defaults follow the standard preset and every preset writes its documented thresholds", () => {
  assert.deepEqual(DEFAULT_CLEANUP_SETTINGS, {
    preset: "standard",
    thresholds: CLEANUP_PRESETS.standard,
    rules: { A: true, B: true, C: true, D: true, E: true },
    snoozeDays: 30,
    keepDays: 180,
  });
  assert.deepEqual(CLEANUP_PRESETS.standard, {
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
    largeBytes: 2 * GB,
    veryLargeBytes: 5 * GB,
    hugeBytes: 10 * GB,
    relativeLargePercent: 20,
  });
  assert.equal(CLEANUP_PRESETS.conservative.protectionDays, 60);
  assert.equal(CLEANUP_PRESETS.conservative.staleDays, 180);
  assert.equal(CLEANUP_PRESETS.conservative.veryStaleDays, 365);
  assert.equal(CLEANUP_PRESETS.conservative.fewOpenCount, 1);
  assert.equal(CLEANUP_PRESETS.conservative.effectiveWatchPercent, 5);
  assert.equal(CLEANUP_PRESETS.conservative.completionPercent, 95);
  assert.equal(CLEANUP_PRESETS.conservative.glanceMaxSec, 30);
  assert.equal(CLEANUP_PRESETS.conservative.lowReturnMaxSec, 300);
  assert.equal(CLEANUP_PRESETS.conservative.lowRevisitOpenCount, 1);
  assert.equal(CLEANUP_PRESETS.conservative.largeBytes, 4 * GB);
  assert.equal(CLEANUP_PRESETS.conservative.veryLargeBytes, 8 * GB);
  assert.equal(CLEANUP_PRESETS.conservative.hugeBytes, 15 * GB);
  assert.equal(CLEANUP_PRESETS.aggressive.protectionDays, 14);
  assert.equal(CLEANUP_PRESETS.aggressive.staleDays, 60);
  assert.equal(CLEANUP_PRESETS.aggressive.veryStaleDays, 120);
  assert.equal(CLEANUP_PRESETS.aggressive.fewOpenCount, 3);
  assert.equal(CLEANUP_PRESETS.aggressive.effectiveWatchSec, 15);
  assert.equal(CLEANUP_PRESETS.aggressive.effectiveWatchPercent, 2);
  assert.equal(CLEANUP_PRESETS.aggressive.completionPercent, 85);
  assert.equal(CLEANUP_PRESETS.aggressive.glanceMaxSec, 120);
  assert.equal(CLEANUP_PRESETS.aggressive.lowReturnMaxSec, 900);
  assert.equal(CLEANUP_PRESETS.aggressive.lowRevisitOpenCount, 5);
  assert.equal(CLEANUP_PRESETS.aggressive.largeBytes, 1 * GB);
  assert.equal(CLEANUP_PRESETS.aggressive.veryLargeBytes, 3 * GB);
  assert.equal(CLEANUP_PRESETS.aggressive.hugeBytes, 5 * GB);
  assert.equal(CLEANUP_PRESETS.aggressive.lowReturnOpenCount, 3, "presets keep the documented low-return open ceiling");
  assert.deepEqual(resolveCleanupPreset("aggressive"), CLEANUP_PRESETS.aggressive);
  assert.deepEqual(CLEANUP_RULE_ORDER, ["C", "D", "A", "B", "E"], "candidate priority is C then D then A then B then E");
  assert.equal(isCleanupPreset("standard"), true);
  assert.equal(isCleanupPreset("extreme"), false);
  assert.equal(isCleanupRuleId("E"), true);
  assert.equal(isCleanupRuleId("F"), false);
  assert.equal(isCleanupState("delete-candidate"), true);
  assert.equal(isCleanupState("deleted"), false);
});

test("cleanup settings validation accepts the defaults and rejects unsafe or malformed values", () => {
  assert.deepEqual(parseCleanupSettings(DEFAULT_CLEANUP_SETTINGS), DEFAULT_CLEANUP_SETTINGS);
  const mutate = (thresholds: Record<string, number> = {}, rest: Record<string, unknown> = {}) => ({
    ...DEFAULT_CLEANUP_SETTINGS,
    ...rest,
    thresholds: { ...DEFAULT_CLEANUP_SETTINGS.thresholds, ...thresholds },
  });
  assert.throws(() => parseCleanupSettings(mutate({ protectionDays: 0 })), /保护期/);
  assert.throws(() => parseCleanupSettings(mutate({ protectionDays: 3651 })), /保护期/);
  assert.throws(() => parseCleanupSettings(mutate({ fewOpenCount: 21 })), /打开少/);
  assert.throws(() => parseCleanupSettings(mutate({ lowReturnMaxSec: 5 })), /低回报/);
  assert.throws(() => parseCleanupSettings(mutate({ largeBytes: 0.1 * GB })), /大文件/);
  assert.throws(() => parseCleanupSettings(mutate({ hugeBytes: 101 * GB })), /超大/);
  assert.throws(() => parseCleanupSettings(mutate({ relativeLargePercent: 0 })), /相对大/);
  assert.throws(() => parseCleanupSettings(mutate({ effectiveWatchSec: Number.NaN })), /有效观看时长/);
  assert.throws(() => parseCleanupSettings({ ...DEFAULT_CLEANUP_SETTINGS, preset: "custom-but-typo" }), /预设/);
  assert.throws(() => parseCleanupSettings({ ...DEFAULT_CLEANUP_SETTINGS, snoozeDays: 0 }), /稍后/);
  assert.throws(() => parseCleanupSettings({ ...DEFAULT_CLEANUP_SETTINGS, keepDays: 1.5 }), /保留/);
  assert.throws(() => parseCleanupSettings({ ...DEFAULT_CLEANUP_SETTINGS, rules: { A: true } }), /规则/);
  assert.throws(() => parseCleanupSettings({ ...DEFAULT_CLEANUP_SETTINGS, extra: "C:\\private" }), /字段无效/);
  assert.throws(() => parseCleanupSettings(null), /格式无效/);
  const custom = mutate({ protectionDays: 45, largeBytes: 3 * GB }, { preset: "custom", snoozeDays: 45, keepDays: 365 });
  assert.deepEqual(parseCleanupSettings(custom), custom, "a custom preset keeps its per-threshold values");
});

test("rule A and B honor the protection window and large-file threshold", () => {
  const settings = DEFAULT_CLEANUP_SETTINGS;
  assert.equal(evaluateCleanupRule(facts({ addedAtMs: NOW - 40 * DAY_MS }), settings, { nowMs: NOW }), "A");
  assert.equal(evaluateCleanupRule(facts({ addedAtMs: NOW - 10 * DAY_MS }), settings, { nowMs: NOW }), undefined, "a newly added file stays protected");
  assert.equal(evaluateCleanupRule(facts({ openCount: 2 }), settings, { nowMs: NOW }), undefined, "A only covers never-opened files");

  const glanced = facts({ openCount: 1, totalPlayedSec: 40, lastOpenedAtMs: NOW - 40 * DAY_MS });
  assert.equal(evaluateCleanupRule(glanced, settings, { nowMs: NOW }), "B");
  assert.equal(evaluateCleanupRule(facts({ ...glanced, totalPlayedSec: 90, sizeBytes: 4 * GB }), settings, { nowMs: NOW }), undefined, "90 seconds is more than a glance and the size is not very large");
  assert.equal(evaluateCleanupRule(facts({ ...glanced, effectiveWatchCount: 1 }), settings, { nowMs: NOW }), undefined, "B needs zero effective watches");
  assert.equal(evaluateCleanupRule(facts({ ...glanced, sizeBytes: 1 * GB }), settings, { nowMs: NOW }), undefined, "B needs a large file");
  assert.equal(evaluateCleanupRule(facts({ ...glanced, lastOpenedAtMs: NOW - 10 * DAY_MS }), settings, { nowMs: NOW }), undefined, "B respects the protection window");
});

test("rule C takes priority over D and E, and the documented numbers decide each rule", () => {
  const settings = DEFAULT_CLEANUP_SETTINGS;
  const fewOpens = facts({ openCount: 2, lastOpenedAtMs: NOW - 100 * DAY_MS, sizeBytes: 6 * GB, totalPlayedSec: 300 });
  assert.equal(evaluateCleanupRule(fewOpens, settings, { nowMs: NOW }), "C", "C outranks any other matching rule");
  assert.equal(evaluateCleanupRule(facts({ ...fewOpens, completedCount: 1 }), settings, { nowMs: NOW }), "D", "a completed file never matches C");
  assert.equal(evaluateCleanupRule(facts({ ...fewOpens, lastOpenedAtMs: NOW - 30 * DAY_MS }), settings, { nowMs: NOW }), "D", "a recent open is below the stale threshold");
  assert.equal(evaluateCleanupRule(facts({ openCount: 3, lastOpenedAtMs: NOW - 100 * DAY_MS, sizeBytes: 6 * GB, totalPlayedSec: 300 }), settings, { nowMs: NOW }), "D");

  const lowReturn = facts({ sizeBytes: 6 * GB, totalPlayedSec: 500, openCount: 3, lastOpenedAtMs: NOW - 10 * DAY_MS });
  assert.equal(evaluateCleanupRule(lowReturn, settings, { nowMs: NOW }), "D");
  assert.equal(evaluateCleanupRule(facts({ ...lowReturn, totalPlayedSec: 601 }), settings, { nowMs: NOW }), undefined, "D needs low return time");
  assert.equal(evaluateCleanupRule(facts({ ...lowReturn, openCount: 4 }), settings, { nowMs: NOW }), undefined, "D needs few opens");

  const revisited = facts({ completedCount: 1, openCount: 2, lastOpenedAtMs: NOW - 200 * DAY_MS, sizeBytes: 6 * GB, totalPlayedSec: 2_000 });
  assert.equal(evaluateCleanupRule(revisited, settings, { nowMs: NOW }), "E");
  assert.equal(evaluateCleanupRule(facts({ ...revisited, openCount: 4 }), settings, { nowMs: NOW }), undefined, "E needs low revisits");
  assert.equal(evaluateCleanupRule(facts({ ...revisited, sizeBytes: 4 * GB }), settings, { nowMs: NOW }), undefined, "E needs a very large file");
  assert.equal(evaluateCleanupRule(facts({ ...revisited, lastOpenedAtMs: NOW - 100 * DAY_MS }), settings, { nowMs: NOW }), undefined, "E uses the strong stale threshold");
  assert.equal(evaluateCleanupRule(facts({ ...revisited, completedCount: 0, openCount: 4 }), settings, { nowMs: NOW }), undefined, "E needs a completed watch");
});

test("rules toggle independently and relative-large raises the A/B size cutoff for large libraries", () => {
  const disabledB = { ...DEFAULT_CLEANUP_SETTINGS, rules: { ...DEFAULT_CLEANUP_SETTINGS.rules, B: false } };
  const glanced = facts({ openCount: 1, totalPlayedSec: 40, lastOpenedAtMs: NOW - 40 * DAY_MS });
  assert.equal(evaluateCleanupRule(glanced, DEFAULT_CLEANUP_SETTINGS, { nowMs: NOW }), "B");
  assert.equal(evaluateCleanupRule(glanced, disabledB, { nowMs: NOW }), undefined, "closing B removes glance candidates");
  const disabledAll = { ...DEFAULT_CLEANUP_SETTINGS, rules: { A: false, B: false, C: false, D: false, E: false } };
  assert.equal(evaluateCleanupRule(facts(), disabledAll, { nowMs: NOW }), undefined);

  assert.equal(evaluateCleanupRule(facts({ sizeBytes: 3 * GB, totalPlayedSec: 1_000 }), DEFAULT_CLEANUP_SETTINGS, { nowMs: NOW, relativeLargeBytes: 4 * GB }), undefined, "relative-large can raise the large-file cut");
  assert.equal(evaluateCleanupRule(facts({ sizeBytes: 6 * GB, totalPlayedSec: 1_000 }), DEFAULT_CLEANUP_SETTINGS, { nowMs: NOW, relativeLargeBytes: 4 * GB }), "A");
});

test("keep and snooze expire back into the active queue while delete-candidate stays queued", () => {
  const settings = DEFAULT_CLEANUP_SETTINGS;
  assert.equal(effectiveCleanupState("keep", NOW + DAY_MS, NOW), "keep");
  assert.equal(effectiveCleanupState("keep", NOW - DAY_MS, NOW), "none", "an expired keep returns to the queue");
  assert.equal(effectiveCleanupState("snooze", undefined, NOW), "none");
  assert.equal(effectiveCleanupState("snooze", NOW + 1, NOW), "snooze");
  assert.equal(effectiveCleanupState("delete-candidate", undefined, NOW), "delete-candidate");
  assert.equal(effectiveCleanupState("none", NOW + DAY_MS, NOW), "none");
  assert.equal(settings.keepDays, 180);
  assert.equal(settings.snoozeDays, 30);
});
