# Local native playback core

The sandboxed renderer sends `LocalPlaybackControlCommand` through the preload bridge. `LocalPlaybackCoordinator` accepts bounded controls only for the active media generation. `MpvNativePlayer` applies volume, mute, and speed directly to libmpv, reads the resulting `volume`, `mute`, and `speed` properties, then reports a complete settings snapshot on `local-playback:event` with the active opaque `mediaId`.

Volume is 0–100, mute is boolean, and speed is 0.25–3. The latest values remain in memory for the `MainLocalPlaybackHost` lifetime and are reapplied when another media item starts. They are not part of `playback_state` and do not survive closing the application window.

Track titles/languages arrive from media metadata and may contain path-like text. The MPV track serializer keeps only the final path component before emitting labels and never reads `external-filename`.

External subtitles use `localPlayback.chooseSubtitleFile()`. Main owns the OS picker and accepts SRT, ASS, SSA, VTT, and SUB. The coordinator captures the active generation before awaiting the dialog and calls `addSubtitleFile` only if that same media is still active after selection. Cancellation or a media switch returns `{ loaded: false }`; renderer IPC/events never contain the selected path. Picker, subtitle, or control failures report a non-fatal `control-error` event and leave the active media and playback controls available.

Ownership:

- `src/shared/local-playback-contracts.ts`: command, event, and preload API contracts plus control range validation.
- `src/main/local-playback-ipc.ts` and `src/preload/preload.ts`: narrow command/picker IPC.
- `src/main/player.ts`: active media generation, native settings event routing, and subtitle selection guard.
- `src/main/mpv-player.ts`: libmpv property writes/reads and per-window in-memory preferences.
- `src/main/player-host.ts`: main-owned subtitle dialog and local player lifecycle.

`docs/local-library/contracts.md` is the public contract. This file describes the implementation boundary; it does not claim hardware decode, macOS, packaged playback, or real-share acceptance.

## Verification record

Implementation commit: `b93ab32bcef0c8cc2986d460c01b15c230221c4f` (`codex/player-core`). Commands were run from the worktree root:

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `node --test dist/tests/local-playback.test.js dist/tests/player.test.js dist/tests/mpv-player.test.js` | PASS, 17/17 |
| `git diff --check` | PASS |

The tests cover control range validation and settings event routing, non-fatal control errors, subtitle cancellation and generation changes, and path-safe native track DTOs. The test output was captured on command stdout; no separate log file was written. Node emitted a `MODULE_TYPELESS_PACKAGE_JSON` warning while loading the existing shared local-library contract, but all tests passed.

The successful native probe was run headlessly from the worktree with a PowerShell here-string piped to `node -`, Koffi, and `D:\project\z-video\vendor\mpv\libmpv-2.dll`. It created libmpv with `config=no`, `terminal=no`, `idle=yes`, `vo=null`, and `ao=null`; set and read volume `0`/`100`, mute `yes`/`no`, and speed `0.25`/`3`; loaded `assets/test_video.mp4`; and selected `tests/fixtures/test_subtitle.srt` through `sub-add`. Actual stdout:

```text
PASS libmpv properties volume=0..100 mute=yes/no speed=0.25..3; subtitle tracks 2 -> 3 (selected)
```

The equivalent replayable probe is `scripts/probe-mpv-controls.mjs`; run it from the worktree with `node scripts/probe-mpv-controls.mjs`. It was saved after the successful inline run and has not been rerun. The native probe also observed that libmpv's `external-filename` contains the fixture path while the fallback `title` is only `test_subtitle.srt`; the application does not read or forward `external-filename`. No native probe log was persisted; its output was stdout only.
