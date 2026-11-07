import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("This probe requires the Windows libmpv DLL.");

const require = createRequire(import.meta.url);
const koffi = require("koffi");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mpvPath = [process.env.Z_VIDEO_MPV_DLL, join(root, "vendor", "mpv", "libmpv-2.dll"), resolve(root, "..", "..", "vendor", "mpv", "libmpv-2.dll")]
  .find((candidate) => candidate && existsSync(candidate));
if (!mpvPath) throw new Error("No Windows libmpv-2.dll was found.");

const lib = koffi.load(mpvPath);
const create = lib.func("void * mpv_create()");
const setOption = lib.func("int mpv_set_option_string(void *, str, str)");
const initialize = lib.func("int mpv_initialize(void *)");
const setProperty = lib.func("int mpv_set_property_string(void *, str, str)");
const getProperty = lib.func("void * mpv_get_property_string(void *, str)");
const free = lib.func("void mpv_free(void *)");
const command = lib.func("int mpv_command(void *, char * const *)");
const waitEvent = lib.func("void * mpv_wait_event(void *, double)");
const terminate = lib.func("void mpv_terminate_destroy(void *)");
const eventStruct = koffi.struct("MpvControlsProbeEvent", {
  event_id: "int",
  error: "int",
  reply_userdata: "uint64_t",
  data: "void *",
});

function read(handle, name) {
  const pointer = getProperty(handle, name);
  if (!pointer) throw new Error(`libmpv property unavailable: ${name}`);
  try {
    return koffi.decode.string(pointer);
  } finally {
    free(pointer);
  }
}

function assertMpvSuccess(result, operation) {
  if (result < 0) throw new Error(`libmpv ${operation} failed: ${result}`);
}

const handle = create();
if (!handle) throw new Error("mpv_create failed.");
try {
  for (const [name, value] of [["config", "no"], ["terminal", "no"], ["idle", "yes"], ["keep-open", "yes"], ["vo", "null"], ["ao", "null"]]) {
    assertMpvSuccess(setOption(handle, name, value), `option ${name}`);
  }
  assertMpvSuccess(initialize(handle), "initialize");

  for (const [name, values] of [["volume", ["0", "100"]], ["mute", ["yes", "no"]], ["speed", ["0.25", "3"]]]) {
    for (const value of values) {
      assertMpvSuccess(setProperty(handle, name, value), `property ${name}=${value}`);
      const actual = read(handle, name);
      assert.equal(name === "mute" ? actual : Number(actual), name === "mute" ? value : Number(value));
    }
  }

  assertMpvSuccess(setProperty(handle, "speed", "1"), "property speed=1");
  assertMpvSuccess(command(handle, ["loadfile", join(root, "assets", "test_video.mp4"), "replace", null]), "loadfile");
  let loaded = false;
  for (let index = 0; index < 100 && !loaded; index += 1) {
    const pointer = waitEvent(handle, 0.1);
    if (pointer) loaded = koffi.decode(pointer, eventStruct).event_id === 8;
  }
  assert.equal(loaded, true, "sample video did not reach file-loaded");

  const duration = Number(read(handle, "duration"));
  assertMpvSuccess(setProperty(handle, "time-pos", String(Math.max(0, duration - 0.15))), "seek near EOF");
  assertMpvSuccess(setProperty(handle, "pause", "no"), "unpause near EOF");
  for (let attempt = 0; attempt < 100 && (read(handle, "eof-reached") !== "yes" || read(handle, "pause") !== "yes"); attempt += 1) waitEvent(handle, 0.1);
  assert.equal(read(handle, "eof-reached"), "yes", "sample video did not reach EOF");
  assert.equal(read(handle, "pause"), "yes", "keep-open should pause at EOF");

  const before = Number(read(handle, "track-list/count"));
  assertMpvSuccess(command(handle, ["sub-add", join(root, "tests", "fixtures", "test_subtitle.srt"), "select", null]), "sub-add");
  let selected = false;
  for (let attempt = 0; attempt < 50 && !selected; attempt += 1) {
    const count = Math.floor(Number(read(handle, "track-list/count")));
    for (let track = 0; track < count; track += 1) {
      if (read(handle, `track-list/${track}/type`) === "sub" && read(handle, `track-list/${track}/selected`) === "yes") selected = true;
    }
    if (!selected) waitEvent(handle, 0.1);
  }
  assert.equal(selected, true, "external subtitle was not selected");

  assertMpvSuccess(setProperty(handle, "time-pos", "0"), "seek back from EOF");
  for (let attempt = 0; attempt < 100 && read(handle, "eof-reached") !== "no"; attempt += 1) waitEvent(handle, 0.1);
  assert.equal(read(handle, "eof-reached"), "no", "seeking back should clear EOF state");
  assertMpvSuccess(setProperty(handle, "pause", "no"), "replay after EOF");
  let resumed = false;
  for (let attempt = 0; attempt < 20 && !resumed; attempt += 1) {
    waitEvent(handle, 0.1);
    resumed = Number(read(handle, "time-pos")) > 0.15;
  }
  assert.equal(resumed, true, "play after EOF did not resume from the beginning");
  console.log(`PASS libmpv settings ranges; keep-open EOF -> seek 0 -> replay; external subtitle selected at EOF (tracks ${before} -> ${read(handle, "track-list/count")})`);
} finally {
  terminate(handle);
}
