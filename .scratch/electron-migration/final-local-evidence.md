# Final local migration evidence

Date: 2026-10-31. Source: integration merge `18a8fbe` (repair `cc2188c`).

## Current source and package

- `npm run package`: passed, including the normal main/renderer TypeScript build.
- `npm run verify:package`: passed with an isolated temporary profile, regular-file GUI logs, production renderer readiness diagnostic/CDP target, and package-local Koffi/libmpv probe. Evidence: `runs/05-package-1793434604933-3796/packaged-app.log`.
- The existing `dist/tests/nas-player-window-smoke.js` passed against the repaired main/preload/IPC/native libmpv path and a synthetic local HTTP media server. Close flushed progress to the synthetic gateway. GUI output used a regular file and a 30-second owned-child deadline. Evidence: `runs/final-nas-player-1793434640480/native-player.log` (empty successful log; child exited 0). This is not a real NAS write or persistence read-back.
- Protocol structure check passed with `C:/Users/admin/scoop/apps/python/current/python.exe scripts/check_protocol_contracts.py`. The Windows Store `python` alias was unavailable; no installation or toolchain change was needed.
- The repair implementer already passed 41 focused owner tests and the updated real-window smoke. Those valid checks were reused rather than repeated. See `review-fixes-completion.md`.

The portable folder is `.scratch/electron-migration/05-package/z-video-win32-x64`; launch `z-video.exe` from that folder. Actual complete folder inventory after verification: **111 files, 502,125,408 bytes** (about 478.86 MiB). The manifest's 109-file/502,123,646-byte content subtotal excludes its own JSON and README. Development dependencies: `node_modules`, **508 files, 405,872,832 bytes**; compiled `dist`, **71 files, 643,750 bytes**. Existing matching dependencies were moved from ticket 05 into the root, without a download or duplicate install.

## EPIPE incident

The repeated Electron main-process dialogs came from the safeStorage smoke's console output through a closed inherited pipe, not from the renderer. Repair `c7016e0` uses the actual Electron binary, one stable parent-owned local fixture, isolated profiles, regular-file child logs, and bounded child cleanup. Its two-fresh-process DPAPI save/restore proof passed and the small logs have been preserved in root `runs/05-safe-storage-1793418547179-11752`. A subsequent read-only process check found no remaining safeStorage smoke process. Do not introduce a global production exception handler to hide this error.

## Still pending

Real NAS login/stream/progress/read-back; actual selected hardware decoder; native DWM/decoded video pixels; mixed DPI/multiple monitors; macOS; controls overlay parity (current controls are below the native video); public redistribution license provenance. The package is a personal-use portable test candidate. Keep PR #21 draft and migration issues open until the required acceptance evidence exists. No global Rust/Cargo installation, old unrelated worktree, private session or NAS media was removed or accessed.
