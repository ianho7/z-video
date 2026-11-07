# Player usability delivery

Date: 2026-11-01. Integration: `codex/local-library-integration`.

## Changes

- Volume, mute, playback speed and a main-owned external-subtitle picker are available in the default account-free player. Settings display comes from native properties; failed controls restore confirmed values without disabling playback.
- Player shortcuts support Space, arrows, M, F and Escape, preserving native form-control interaction. Playback updates no longer repeatedly steal focus.
- EOF retains the loaded media, reports completion for local progress, and supports seek, subtitle loading and replay from the start.

## Evidence

- `npm test`: 62/62 passed at integration `ee406db`. The subsequent renderer-only key normalization is covered by the focused native playback smoke; the unchanged owner tests were not rerun.
- `node scripts/run-window-smoke.mjs`: passed; log `.scratch/electron-migration/runs/05-window-1793504650579-15532/window.log`.
- Real native settings, subtitle and EOF property evidence: `core.md`. Actual Windows user-view checks and the final focused resume result: `ui-audit.md`.
- `npm run package` at source `50af934`: 503,180,918 bytes, 231 files, ordinary-copy mode. No new runtime dependency.
- `npm run verify:package`: packaged Koffi/libmpv/XML, production renderer and local SQLite passed. Log `.scratch/local-library/runs/05-package-1793505446920-12776/packaged-app.log`.

Executable: `C:\Users\admin\.codex\visualizations\2026\10\30\01a18d67-6765-7dc0-8bd1-47ac85ca8f26\local-library-package\z-video-win32-x64\z-video.exe`.

The default library remains account-free and media access read-only. These checks use owned local fixtures, not personal NAS media. No macOS, hardware-decoding or signed-installer acceptance is claimed. Settings persist only for the current player/window lifetime. The minimum-size automated window reports outer 902×640, content 888×577 and a 152px control band; an exact 900×640 manual screenshot was not obtained.
