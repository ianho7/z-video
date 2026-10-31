# Local video surface fix

Date: 2026-10-31
Baseline: `5dfd63e` (`codex/fix-local-video`)
Scope: owned `assets/test_video.mp4` through the production renderer, `MainLocalPlaybackHost`, and native libmpv window. No NAS or private media paths were inspected.

## Reproduction evidence

The pre-fix production resume smoke passed for the wrong proof boundary: libmpv reported `ready`, native position advanced to `7.24s`, and a fresh process restored `7.34s`. That proves the media path, decoder clock, and progress persistence, but not decoded pixels.

The visible Windows screenshot/AX observation of the same isolated fixture showed:

- a native accessibility node titled `test_video.mp4 - mpv`;
- the renderer still showing the library card, with no player view, surface, or controls;
- `visual-probe.json` recording `playerViews: []` while native `ready` and position events continued.

The native probe then called Win32 `GetClientRect`/`GetWindowRect`. Both calls returned success, but the output rectangles remained zero. The existing Koffi declarations used a plain pointer, which is input-only; `NativeVideoWindow.resize()` therefore kept the child at its initial 1x1 size. This is the confirmed cause of the native-surface geometry failure.

## Repair

- Mark `GetClientRect` as a Koffi output parameter and keep the native child above Chromium siblings when resizing.
- Hide the native child whenever libmpv stops, so a closed or failed load cannot leave a stale surface.
- Restore a local `player-view`, native `player-surface`, and controls in the production renderer. Local playback events now drive visibility, ready/error state, pause/play, seek, track selection, fullscreen, and return-to-library behavior.
- Extend the production local playback smoke with a real player-layout assertion: visible player view, non-zero surface rectangle, reserved controls height, enabled toggle, and hidden player view after close.

## Validation

Passed:

- `npm run typecheck`
- `npm run build`
- `node --test dist/tests/local-playback.test.js` (4/4)
- `git diff --check`
- `npm test` (37/57 passed; 20 pre-existing NAS fixture/network and sandbox secure-storage failures, while all four local playback unit tests passed)

The post-fix production GUI smoke and native decoded-pixel screenshot are not claimed in this note: Computer Use was stopped by the physical Escape key before the repaired window could be captured. The pre-fix screenshot and isolated probe established the failure; rerun the bounded GUI smoke after Computer Use is explicitly re-authorized, and require all of the following before claiming pixel acceptance: native child `visible=true`, non-zero parent/client and child geometry covering the player surface, visible controls below it, and a Windows native-window screenshot showing changing fixture pixels rather than only Chromium DOM or position events.
