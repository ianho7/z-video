import assert from "node:assert/strict";
import test from "node:test";

import { mpvTracksFromProperties } from "../src/main/mpv-player";

test("MPV track DTOs retain useful labels without forwarding path-like titles", () => {
  const properties = new Map([
    ["track-list/count", "2"],
    ["track-list/0/type", "audio"],
    ["track-list/0/id", "1"],
    ["track-list/0/title", "English"],
    ["track-list/0/selected", "yes"],
    ["track-list/1/type", "sub"],
    ["track-list/1/id", "2"],
    ["track-list/1/title", "C:\\private\\captions.srt"],
    ["track-list/1/lang", "zh"],
    ["track-list/1/selected", "yes"],
  ]);
  const tracks = mpvTracksFromProperties((name) => properties.get(name));

  assert.deepEqual(tracks, {
    audio: [{ id: "1", label: "English", selected: true }],
    subtitles: [{ id: "2", label: "captions.srt", selected: true }],
  });
  assert.doesNotMatch(JSON.stringify(tracks), /C:\\private/u);
});
