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
