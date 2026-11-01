# Local player UI audit

Date: 2026-11-01
Scope: basic controls and keyboard handling in the default account-free local player.

## Verification

- `npm run typecheck` passed.
- `npm run test:local-playback-resume` passed. It builds the current source and verifies native playback readiness, an observed seek position, pause state, synthetic F/Escape behavior, return to the library, and resume from a fresh Electron process. The smoke now also re-enters fullscreen before closing playback and checks that close exits fullscreen; that final assertion was added after the passing run and awaits the next integrated run.
- A source Electron window was launched with isolated profile `.scratch/player-ui-source-acceptance/profile` and logs in `.scratch/player-ui-source-acceptance/logs/`. No NAS account or source was used. The window was `1027 × 714` during the GUI pass.

## Observed in the source window

- Imported the owned `assets/test_video.mp4` through the file picker and saw native video frames. A scratch copy at `.scratch/player-ui-source-acceptance/test_video_fresh.mp4` was used to get a new media ID after the original fixture had reached EOF.
- Changed speed to `2×`; the control displayed `2×`. Changed volume to approximately `35`; the slider reflected the setting. Clicked mute and saw the button change to “取消静音”.
- Paused the fresh media around `00:16 / 00:29`, selected `tests/fixtures/test_subtitle.srt`, and saw the subtitle track `test_subtitle.srt` plus “已加载外部字幕。” The first subtitle attempt had been made at EOF and failed; the paused, active-media attempt succeeded.
- Clicked the native video area and pressed F. The window entered fullscreen and the button changed to “退出全屏”. Clicking that button returned to the windowed view.
- Clicked the native video area and pressed Space. Playback remained paused. The accessibility snapshot reported the RootWebArea as focused, and the diagnostics file received no new `local-playback.command` entry after that key press. Pressing Space while the Play button was focused did toggle play/pause. This leaves Space handling from native-surface focus unverified at the renderer boundary; the DOM `document.activeElement` was not directly inspected.
- Clicked “返回片库” and returned to the library.
- The control band remained about `152px` tall in the observed `1027 × 714` window. A live resize to exactly `900 × 640` was not completed; the main window declares `minWidth: 900` and `minHeight: 640`, but that minimum-size layout remains unverified in a real window.

## Limits

- This is Windows local-fixture evidence only. It does not cover NAS playback, macOS, or hardware-decoding capability.
- The GUI pass occurred before the backend EOF keep-open fix (`7d766fa`). EOF seek/replay and subtitle behavior at EOF need a focused retest after that commit is integrated.
- Existing audio track selection was observed as `audio 1`; changing tracks was not exercised.
