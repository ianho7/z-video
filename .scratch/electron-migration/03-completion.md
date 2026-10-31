# Ticket 03 completion record: embedded native playback

Status: implementation complete on `codex/electron-03`; functional Windows
local-sample evidence is present. Full ticket acceptance remains partial because
the candidate shared-texture overlay route, real NAS streams/progress and
packaged deployment are outside this ticket or still unverified.

## Baseline and scope

- Worktree branch: `codex/electron-03`.
- The latest integration tip `a3b1110` (documentation-only beyond the prior
  ticket tip) was merged as `57a108f` before final verification, preserving the
  library, discovery and safe-storage evidence updates.
- Scope kept to local media selection, one main-process libmpv engine, the
  renderer-safe playback command/event bridge and the player view. No NAS
  stream lookup, credentials, progress writes or Rust builds were added.
- `PlaybackCommand.open` remains a renderer-safe episode intent. Until Ticket
  04 supplies the NAS resolver, an episode `open` command reports an explicit
  source-not-connected error; the local sample uses the main-owned file picker.

## Implementation

- `src/main/player.ts`: generation-scoped Playback coordinator. Old engine
  callbacks are ignored after a new local session or close. Errors are mapped
  to path-free renderer events.
- `src/main/mpv-player.ts`: Koffi FFI over libmpv client API. It sets
  `vo=gpu`, `gpu-api=d3d11`, `hwdec=auto-safe`, `wid`, and polls only native
  properties/events; it does not copy video frames through Node or the DOM.
  Returned property strings are released with `mpv_free`.
- `src/main/native-window.ts`: Win32 child host using `CreateWindowExW`,
  `SetWindowPos`, `GetClientRect` and `GetDpiForWindow`; resize, fullscreen and
  display-metrics changes keep the native surface aligned with a 152-DIP HTML
  control band.
- `src/main/player-host.ts`, `src/main/ipc.ts`, `src/preload/preload.ts` and
  shared contracts add `player:choose-local-file`,
  `player:choose-subtitle-file`, `player:command` and `player:event`. The
  selected media/subtitle paths stay in main and are never sent in a renderer
  event or diagnostic message. External subtitles use libmpv `sub-add` and
  expose only sanitized track metadata to the renderer.
- `src/renderer/index.html`, `renderer.ts` and `styles.css` add keyboard- and
  screen-reader-labelled controls for play/pause, seek, audio tracks, subtitle
  track/off, external subtitle picker, fullscreen and close. The controls are
  immediately below the native child surface in the same BrowserWindow. Track
  selects now follow the selected/off state from production `tracks` events so
  a native subtitle-off event is visible at the renderer boundary.

## Proof boundary

- The earlier direct-coordinator smoke was native API proof only: it called the
  `PlaybackCoordinator` and inspected a test-only native subtitle getter. That
  route did not prove that visible controls, the production preload or player
  IPC drove the engine.
- The repaired `test:player-window` smoke creates the production-sandboxed
  preload and `MainPlaybackHost`, registers real player IPC handlers, and uses a
  deterministic main-owned dialog fixture for the missing media, sample video
  and public SRT fixture. It then performs the visible DOM play/pause, seek,
  subtitle select/off, fullscreen and close actions.
- Before Electron startup, the smoke sets `userData` and `sessionData` to
  separate unique `mkdtemp` directories. The renderer's automatic
  `session.restore` therefore cannot read a user's saved session or contact a
  private NAS from synthetic test startup.
- DOM assertions observe production event effects: pause changes the state label,
  seek reaches the one-second target in the renderer range's raw position value
  at media precision, subtitle selected/off values are refreshed from `tracks`
  events, fullscreen changes the real BrowserWindow state, and close hides the
  player view after the main host shuts down. No test-only production getter
  remains.

## Versions and native evidence

- Electron pinned to `45.1.0` (official stable release page, released
  2026-10-27; Chromium 156.0.8078.49, Node 24.22.1):
  https://releases.electronjs.org/release/v45.1.0
- Koffi pinned to `3.3.5` with the MIT Windows x64 prebuild
  `@koromix/koffi-win32-x64@3.3.5`; official docs/release history:
  https://koffi.dev/ and https://koffi.dev/changelog
- Existing ignored root DLL was used; it was not copied into the worktree:
  `vendor/mpv/libmpv-2.dll`, 121,006,592 bytes. The actual loaded DLL reported
  `mpv_client_api_version=0x20006` (libmpv client API 2.6) through Koffi.
- Local media fixture: `assets/test_video.mp4`. No NAS URL or private media
  path was written to logs or completion evidence.

## Commands and results

Run from `D:\project\z-video\.worktrees\electron-03` in normal Windows GUI
permissions:

| Command | Result | Evidence boundary |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | Main/preload/shared/renderer TypeScript types. |
| `npm test` | exit 0; 30/30 passed | Existing NAS/session/storage/discovery/library owner tests plus 4 coordinator tests. |
| `npm run test:window` | exit 0 | Real Electron 45 BrowserWindow; isolation, preload bridge, player bridge and control DOM. |
| `npm run test:player-window` | exit 0 | Real Windows BrowserWindow + production preload/IPC + `MainPlaybackHost` + root libmpv DLL + local fixture. The smoke exercised missing-file error, load/ready, DOM pause, one-second seek observed through the renderer range's raw position value, track enumeration, main-owned `.srt` `sub-add`, DOM subtitle select/off observed from production `tracks` events, fullscreen on/off and close. |
| `Z_VIDEO_PLAYER_SMOKE_HOLD_MS=20000` screenshot run | CUA capture, 1087×794 | Real Electron window was forced to the reviewable player view for a bounded capture. The semantic control strip is visible below the surface; the Chromium capture did not display the Win32 native child pixels, so this screenshot is not visual decoded-frame proof. |
| `git diff --check` | exit 0 | Changed-file whitespace check. |
| `npm ls --depth=0` | Electron 45.1.0, Koffi 3.3.5, TypeScript 5.7.2 present | Local dependency tree. |

The first sandboxed `npm test` attempt was not used as product evidence: the
managed sandbox blocked localhost fixture fetches and DPAPI-temp-file rename;
the same command passed under normal Windows permissions.

## Remaining gaps

1. The native `wid` route deliberately places semantic controls below the
   native child window. HTML controls cannot paint above that child, so strict
   visual overlay parity is an explicit gap. The feasibility note's
   D3D11/sharedTexture route remains unproven on Windows and was not silently
   claimed.
2. Hardware-decoder selection still requires additional hardware evidence; the
   smoke proves the configured `hwdec=auto-safe` route but not a particular
   adapter's chosen decoder.
3. The real smoke exercised the `GetDpiForWindow` resize path at the host's
   current Windows scale, but no mixed-DPI or multi-monitor fixture was
   available to verify a DPI transition independently. That remains a
   packaging/device-lab follow-up rather than an unreported acceptance claim.
4. Ticket 04 must resolve a NAS `episodeId` to a current stream and own NAS
   progress persistence/read-back. This ticket performs no NAS writes.
5. Ticket 05 must package the libmpv DLL, Koffi native prebuild and applicable
   licenses; this ticket only proves the development/runtime path using the
   existing ignored root DLL. macOS and installed-package acceptance remain
   unverified.
