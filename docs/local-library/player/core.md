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

Initial implementation commit: `b93ab32bcef0c8cc2986d460c01b15c230221c4f` (`codex/player-core`). The EOF follow-up was verified from the same worktree root with:

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `node --test dist/tests/local-playback.test.js dist/tests/player.test.js dist/tests/mpv-player.test.js` | PASS, 18/18 |
| `node scripts/probe-mpv-controls.mjs` | PASS against Windows libmpv |
| `git diff --check` | PASS |

The focused tests cover control range validation and settings event routing, non-fatal control errors, subtitle cancellation and generation changes, path-safe native track DTOs, and the coordinator's watched-state handling when native playback reports `ended`. The test output was captured on command stdout; no separate log file was written. Node emitted a `MODULE_TYPELESS_PACKAGE_JSON` warning while loading the existing shared local-library contract, but all tests passed.

The native probe command was `node scripts/probe-mpv-controls.mjs`, run headlessly from the worktree root. It loaded Koffi and `D:\project\z-video\vendor\mpv\libmpv-2.dll`, created libmpv with `config=no`, `terminal=no`, `idle=yes`, `keep-open=yes`, `vo=null`, and `ao=null`; set and read volume `0`/`100`, mute `yes`/`no`, and speed `0.25`/`3`; loaded `assets/test_video.mp4`; drove it to EOF; selected `tests/fixtures/test_subtitle.srt` through `sub-add` while at EOF; then sought to zero and confirmed playback advanced after unpausing. Actual stdout:

```text
PASS libmpv settings ranges; keep-open EOF -> seek 0 -> replay; external subtitle selected at EOF (tracks 2 -> 3)
```

No separate probe log was persisted; output was captured on command stdout. `MpvNativePlayer` now keeps the native file open at EOF, reports the observed `eof-reached` property as `ended` so watched progress still commits, and seeks to zero before unpausing when play is requested at EOF. A normal seek only sets `time-pos`, preserving the current pause state. Explicit stop and close still terminate the native player.

The probe also observed that libmpv's `external-filename` contains the fixture path while the fallback `title` is only `test_subtitle.srt`; the application does not read or forward `external-filename`.
