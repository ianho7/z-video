# Ticket 05 completion record: Electron cutover and Windows portable package

Status: implementation complete on `codex/electron-05`; local Windows package,
real-window, safeStorage and resource evidence are present. Full acceptance
remains blocked by real NAS, hardware/DWM and distribution-license boundaries.

## Baseline and scope

- Branch: `codex/electron-05`.
- Integration baseline: `5bd9d97` (`codex/electron-integration`); it was an
  ancestor before the final implementation changes.
- The default run/build/package path is Electron 45 + TypeScript. The old
  Slint/Rust implementation remains in Git as rollback/reference material;
  no global Rust/Cargo directory or unrelated worktree was removed.
- No private user session, NAS credential, token, Cookie, media URI or private
  media path was read. All fresh-process proofs use synthetic data and
  temporary userData/sessionData paths.
- This completion record is included in the final implementation commit;
  targeted safeStorage harness repair is `c7016e0`.

## Implementation

- `package.json`, `scripts/package-windows.mjs`,
  `scripts/verify-windows-package.mjs` and `scripts/measure-windows-resources.mjs`
  establish the default Electron commands, manual unpacked Windows x64 layout,
  package manifest/license files, native lookup probe and named resource
  measurements. The package copies the existing Electron runtime, Koffi 3.3.5
  Windows x64 prebuild and root `vendor/mpv/libmpv-2.dll`; it excludes Rust,
  tests, reference, docs, source maps, compiler and dev-only dependencies.
- `src/main/window.ts`, `src/renderer/renderer.ts`, `src/renderer/styles.css`
  restore preferred `1040x720`, minimum `900x640`, sidebar collapse and
  renderer-safe appearance state. Windows native material uses Electron
  `acrylic`, matching the old DWM transient-window material; Windows 11 22H2+
  capability is checked explicitly. High contrast, reduced transparency,
  explicit fallback and unsupported builds use an opaque surface. A real
  Chromium window proof does not claim DWM pixel sampling.
- `src/main/main.ts` waits for the main playback host close before final app
  quit, preserving a started progress flush across window/application close.
- `src/main/ipc.ts` now returns the `{ state }` envelope expected by the
  production preload for login/MFA/logout. `src/main/mpv-player.ts` resolves
  the packaged root `vendor/mpv` path even when the packaged process cwd is
  not the package root.
- `tests/window-smoke.ts`, `tests/appearance-window-smoke.ts` and the three
  bounded runners use real Electron windows, isolated profiles and regular
  child log files. The safeStorage runner keeps one parent-owned local HTTP
  fixture across two fresh Electron processes and never inherits a transient
  stdout/stderr pipe. Commit `c7016e0` contains the targeted safeStorage
  harness repair.

## Local verification

| Command/procedure | Result | Evidence boundary |
| --- | --- | --- |
| `npm run typecheck` | pass | Main/preload/shared/renderer TypeScript types after acrylic capability gate. |
| `npm run build` | pass | Final compiled main/preload/renderer assets; no dependency download. |
| `node scripts/run-window-smoke.mjs` | pass | Real Electron window login/discovery/library/detail plus sidebar collapse/restore; log: `.scratch/electron-migration/runs/05-window-1793419011005-12080/window.log`. |
| `node scripts/run-appearance-window-smoke.mjs` | pass | Real Electron window under synthetic reduced-transparency fallback; `900x640` CSS minimum and opaque state; log: `.scratch/electron-migration/runs/05-appearance-1793418898412-24420/appearance.log`. This is Chromium/DOM and native-window state evidence, not DWM pixels. |
| `node scripts/run-safe-storage-process-smoke.mjs` | pass | Two fresh production main/preload/window processes recovered a synthetic 268-byte safeStorage session via stable localhost fixture; logs: `.scratch/electron-migration/runs/05-safe-storage-1793418547179-11752/{save,restore}.log`. |
| `npm run package` | pass | Manual portable folder: 107 manifest payload files, 502,107,049 payload bytes; Electron 45.1.0, Koffi 3.3.5, libmpv 121,006,592 bytes, SHA-256 `0fc3d4a64453fc65b801a687cede8196899788a81a4cd082a9ea477fc418b10f`. |
| `npm run verify:package` | pass | Isolated cwd/fresh profile; packaged Koffi probe reported `mpvClientApi=131078`; packaged EXE stayed alive; log: `.scratch/electron-migration/runs/05-package-1793418903414-10632/packaged-app.log`. |
| `node scripts/measure-windows-resources.mjs` | pass | Report: `.scratch/electron-migration/runs/05-resources-1793418913399-24128/resource-measurement.json`; node_modules 405,872,832 bytes, npm cache 491,439,771 bytes, complete portable folder 502,108,811 bytes/109 files, idle packaged process working set 138,178,560 bytes after 3 seconds. These are named separate measurements, not a savings claim or performance budget. |
| Reused integration owner evidence | pass, 39/39 | Existing NAS/session/storage/discovery/library owner tests from Tickets 01-04; no protocol fixture change in this ticket. This local evidence does not prove a live NAS. |
| `git diff --check` | pass | Final tracked changes have no whitespace errors. |

The first package attempt exposed that this worktree intentionally had no
copied `vendor/mpv` DLL. The package script now resolves the documented shared
repository-root DLL fallback and does not duplicate it into every worktree;
the final package and native probe passed.

## Remaining limits and acceptance blockers

1. No real NAS login, returned stream, progress response or fresh-process NAS
   history read-back was performed. The safeStorage fixture proves Windows
   DPAPI persistence only; it does not prove NAS compatibility or NAS progress
   persistence. The production shutdown path now awaits `PlaybackHost.close()`
   before `app.quit()`, but an actual X-close with a delayed local progress
   fixture was not separately exercised here. Any progress write remains
   user-authorized NAS data and must be verified separately.
2. The native libmpv/Koffi package load and API probe pass, but hardware decoder
   selection, representative media, audio/subtitle behavior, mixed-DPI and
   multi-monitor behavior remain unverified.
3. The old player layout's adjacent HTML control strip remains a documented
   visual-parity gap for the native child surface. No overlay compositor was
   invented; Chromium capture is not native decoded-pixel proof.
4. The native acrylic setter and capability gate preserve the old DWM intent,
   but no authorized DWM pixel/sample capture was available. macOS remains
   unbuilt/unverified.
5. The package is a personal-use portable verification folder, not a signed
   installer, updater or public-ready distribution. The manifest records the
   mpv archive/hash, but public redistribution license provenance is not
   confirmed.

## Handoff

Keep the package and ignored run evidence until parent review is complete. Do
not close the Ticket/PR or claim full acceptance; parent should run the
independent Standards/Spec reviews and the user-authorized real-NAS/hardware
acceptance separately.
