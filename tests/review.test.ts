import assert from "node:assert/strict";
import { test } from "node:test";

import type { LocalViewingHistory } from "../src/shared/local-library-contracts";
import { cleanupStateLabel } from "../src/renderer/views/cleanup";
import { reviewDecisionNotice, reviewFactsText, reviewSessionFacts } from "../src/renderer/views/review";

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;

function history(patch: Partial<LocalViewingHistory> = {}): LocalViewingHistory {
  return {
    mediaId: "media_123e4567-e89b-42d3-a456-426614174000",
    openCount: 3,
    effectiveWatchCount: 2,
    completedCount: 0,
    inspectionOpenCount: 1,
    totalPlayedSec: 18 * 60,
    firstSeenAtMs: NOW - 200 * DAY_MS,
    lastOpenedAtMs: NOW - 3 * DAY_MS,
    lastPlayedAtMs: NOW - 3 * DAY_MS,
    lastSessionPlayedSec: 120,
    lastSessionWallSec: 180,
    lastPositionSec: 0,
    updatedAtMs: NOW - 3 * DAY_MS,
    ...patch,
  };
}

test("review facts name this check as the next open and reuse A1 totals", () => {
  assert.equal(reviewFactsText(history(), NOW), "第 4 次打开 · 累计 18 分钟 · 上次 3 天前");
});

test("review facts do not invent history for a never-opened file", () => {
  assert.equal(reviewFactsText(undefined, NOW), "首次打开 · 尚无播放记录");
});

test("review facts report hours without rounding minutes away", () => {
  assert.equal(reviewFactsText(history({ openCount: 1, totalPlayedSec: 72 * 60, lastOpenedAtMs: NOW }), NOW), "第 2 次打开 · 累计 1 小时 12 分 · 上次 今天");
});

test("review session facts separate the session label used by the decision dialog", () => {
  assert.deepEqual(reviewSessionFacts(history(), NOW), {
    openLabel: "第 4 次打开",
    playedLabel: "累计 18 分钟",
    lastLabel: "上次 3 天前",
  });
});

test("keep is terminal in the close-time notice, so it never names an expiry", () => {
  // Ticket 14: previously this read "180 天内不会再出现在候选里".
  const notice = reviewDecisionNotice("测试影片", "keep", 180);
  assert.match(notice, /已保留《测试影片》/);
  assert.match(notice, /不会再回到整理候选/);
  assert.doesNotMatch(notice, /\d+\s*天内/);
  assert.doesNotMatch(notice, /保留至/);
  assert.match(notice, /文件没有被移动或删除/);
});

test("snooze is the only close-time mark that keeps a day count", () => {
  assert.equal(
    reviewDecisionNotice("测试影片", "snooze", 30),
    "已标记稍后《测试影片》；30 天内不再出现。文件没有被移动或删除。",
  );
});

test("delete-candidate still refuses to delete anything by itself", () => {
  const notice = reviewDecisionNotice("测试影片", "delete-candidate", 180);
  assert.match(notice, /加入待删清单/);
  assert.match(notice, /不会删除文件/);
});

test("keep renders as a settled state instead of a waiting period", () => {
  assert.equal(cleanupStateLabel("keep"), "已保留");
  assert.equal(cleanupStateLabel("snooze"), "稍后");
  assert.equal(cleanupStateLabel("delete-candidate"), "待删");
  assert.equal(cleanupStateLabel("none"), "待整理");
});
