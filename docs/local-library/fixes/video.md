# Local video surface fix

Date: 2026-10-31
Baseline: `5dfd63e`; verification merge: `9df2578` (latest local-library integration)
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
- Keep the native child hidden by default; show it only after libmpv initializes and accepts `loadfile`. Hide is sticky across later parent resize/DPI callbacks, so a failed start or stop cannot re-show a stale surface.
- Force the BrowserWindow out of fullscreen on coordinator close and native shutdown, then let the renderer's `closed` event return to the library.
- Restore a local `player-view`, native `player-surface`, and controls in the production renderer. Local playback events now drive visibility, ready/error state, pause/play, seek, track selection, fullscreen, and return-to-library behavior.
- Extend the production local playback smoke with real player-layout and close assertions: visible player view, non-zero surface rectangle, reserved controls height, enabled toggle, fullscreen requested then cleared on close, and hidden player view after close.

## Post-fix Windows pixel proof

The repaired production renderer was run with only the owned `assets/test_video.mp4`, copied into an isolated profile by `.scratch/run-local-playback-visual-proof.mjs`. The run retained the visible window for Sky observation and wrote the renderer/event result to:

`.scratch/electron-migration/runs/local-video-visual-proof/profile-c41wVn/first-result.json`

That result records `playerVisible: true`, a renderer surface of `1026.4 × 505.6`, `controlsHeight: 152`, an enabled playback toggle, an observed position near `7.24s`, a paused state, a closed event, `fullscreenCommandIssued: true`, and `fixturePathLeaked: false`.

During the same run, the Win32 probe recorded the actual z-video parent and native child in:

`.scratch/electron-migration/runs/local-video-visual-proof/profile-c41wVn/native-child-probe.json`

The z-video parent was visible with a `2048 × 1152` client rectangle. Its direct `Static` child (the libmpv `wid` host) was also `visible: true` with a non-zero `2048 × 1000` window/client rectangle, leaving the 152-pixel control strip below it. This is a Win32 child-window measurement, not a Chromium DOM rectangle.

A second bounded production run exercised the failed-retry path with the same opaque local host, then requested a renderer window resize while the host was stopped but not yet destroyed. Its probe is `.scratch/electron-migration/runs/local-video-visual-proof/profile-AP8kqy/native-child-hidden-probe.json`: the z-video parent remained visible at `1028 × 684`, while the direct `Static` child retained a non-zero `1028 × 532` client rectangle and reported `visible: false`. This is the real resize-after-stop boundary for the sticky-hide repair.

Sky's fresh z-video screenshot showed the decoded, colored tree frame in that native rectangle and the semantic controls below it. Sky then clicked play (AX changed to `暂停` and the clock advanced), clicked pause (AX changed to `播放`), set the seek slider to `22` (AX reported `00:22 / 00:29`), and clicked `返回片库`; the fresh AX tree returned to the local-library card for `owned-fixture` and showed no player view. No private media or NAS path was opened.

## Validation

Passed:

- `npm run typecheck`
- `npm run build`
- `node --test dist/tests/local-playback.test.js` (5/5)
- `npm run test:local-playback-resume` (production renderer + MainLocalPlaybackHost + libmpv, fresh-process resume `7.21s → 7.21s`)
- `git diff --check`
- Earlier `npm test` run: 37/57 passed; 20 known NAS fixture/network or sandbox secure-storage failures, while the local playback unit tests passed. It predates this focused P1/P2 repair and is not relabeled as an all-pass.
