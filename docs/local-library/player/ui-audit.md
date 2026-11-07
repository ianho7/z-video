# Local player UI audit

Date: 2026-11-01

Scope: basic controls, keyboard handling, resume, and the minimum-window player layout in the default account-free local player.

## Verification

- Commit `50af934` adds key-first, code-fallback shortcut matching for Space, arrows, and Escape. `npm run typecheck` and `npm run build` passed for that change.
- After the resume proof was tightened, `npm run test:local-playback-resume` passed. The first sandboxed Electron launch exited `2147483651` (`0x80000003`) before producing stage output; rerunning the same command with Windows GUI permissions passed. The smoke builds the current source and reported `first=12.51s`, `second=12.55s` (0.04s difference). Logs and isolated profile are under `.scratch/electron-migration/runs/local-library/playback-profile-gCSK5U/`.
- The resume smoke now waits for `ready`, immediately pauses the fresh process, and captures its first native position within five seconds. The runner requires that position to be within 2.5 seconds of the committed first-process position, so natural playback from zero cannot satisfy the resume proof.
- The same smoke requests `BrowserWindow.setSize(900, 640)`. Windows reported outer size `902 × 640` and content size `888 × 577`; this is the measured non-client-frame difference. Its layout probe reported a visible player surface (`872.8 × 425.6`), 152px controls band, all ten required controls inside the controls band and viewport with no scroll overflow, and enabled playback controls.

## Observed in the production window

- The source Electron window used an isolated profile and the owned local fixture. Video frames rendered in the native surface; no NAS account or source was used.
- At EOF (`00:29 / 00:29`), clicking Play restarted playback. About 1.3 seconds later the counter showed `00:04 / 00:29` and the button showed Pause.
- After clicking the native video surface, Space paused at about `00:24 / 00:29`; the UI showed “已暂停” while accessibility focus remained on `RootWebArea`. Clicking the surface and pressing Space again resumed playback; 1.5 seconds later the counter showed `00:25 / 00:29` and the button showed Pause.
- A screenshot of the production window at `1027 × 714` showed the full controls band. The manual window-resize attempt did not reach the minimum size; minimum-size visibility is supported by the automated `setSize(900, 640)` layout measurement above, not a manually captured screenshot at that size.
- The owned production window was closed after the check. The live sky screenshots were inspected during the run and were not saved as repository artifacts. Its stdout/stderr are in `.scratch/player-keyboard-acceptance/production-logs/`.
- The earlier local GUI pass also observed speed `2×`, volume about `35`, mute state, and successful SRT loading while the media was active and paused. The EOF-time subtitle attempt failed before the EOF keep-open fix; subtitle loading at EOF was not retested here.

## Limits

- This is Windows local-fixture evidence only. It does not cover NAS playback, macOS, or hardware-decoding capability.
- Audio track changes were not exercised; the observed track was `audio 1`.
