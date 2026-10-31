# Electron migration review-fixes completion

Branch: `codex/electron-review-fixes`
Baseline before repair: `928f147` (`deae61a` integration code freeze plus review reports)
Dependency source for local evidence: read-only `D:\project\z-video\.worktrees\electron-05\node_modules`; this worktree intentionally has no dependency junction or copied modules.

## Finding mapping

1. **Private Episode path / renderer identity** — `src/main/nas-client.ts` now derives a deterministic opaque `episode-path-*` handle for path-only records; `src/main/episode-identity.ts`, `src/main/library-controller.ts`, and `src/main/player-host.ts` use the same main-owned mapping. Renderer DTOs and Continue Watching carry only the handle; playback rejects records without a usable NAS `video_id`. Evidence: `tests/library.test.ts` path-only DTO test; focused owner suite item 13/41.
2. **Image credentials and redirects** — `fetchImage` accepts only the current NAS origin, uses manual same-origin redirect handling, and rejects a cross-origin `Location` before sending credentials to it. Evidence: direct-external and redirected-external tests in `tests/library.test.ts` (items 16–17/41); synthetic two-localhost servers only.
3. **HTTP 200 business failures and UI diagnostics** — `readResponse` records business failure/error code instead of parse success; IPC handlers emit payload-free `ui.operation` receipts; window readiness is recorded in main. Evidence: `tests/diagnostics.test.ts` items 1–3/41; `src/main/window.ts` readiness event.
4. **Bounded pagination/counts** — server counts are accepted only when finite, safe, non-negative, and within the bounded cap; renderer pagination renders a small window with ellipses. Evidence: huge-count owner regression item 9/41 and final Electron window smoke pagination assertion.
5. **Session/account playback isolation** — login/logout close playback; session transitions and library requests use generation/session-key guards; resolver/progress/unauthorized callbacks reject stale work and cannot invalidate a newer account. Evidence: stale stream owner test item 34/41 and session A/B late-response test item 41/41. No real credentials or NAS writes used.
6. **Continue Watching/search/stale detail** — Continue Watching preserves Episode ID through card/detail selection; search input is 250 ms debounced with immediate Enter/clear; main list/detail generations are separate from continue-history generation and stale results cannot update navigation/cache. Evidence: `tests/window-smoke.ts` final smoke passed; owner tests items 5–9/41; renderer smoke covered continue Episode, bounded pagination, debounce and clear.
7. **Password bytes** — login input parsing trims only server/username and preserves the password string exactly. Evidence: `tests/ipc-validation.test.ts`, item 4/41.
8. **Episode-specific resume** — main resolves current detail/history and passes only matching history to playback; renderer resume seconds are ignored; native load failure before `ready`/`position` cannot remember or flush initial zero progress. Evidence: player owner items 35–37/41, including the public-coordinator regression for synchronous native load error.
9. **Package startup proof** — `scripts/verify-windows-package.mjs` reserves an isolated debug port, requires a production renderer CDP target and the `window.renderer-ready` diagnostic under the same bounded deadline, and uses owned file logs/profile cleanup. Package rebuild/verification remains for the root coordinator after merge; this worktree did not claim package acceptance.
10. **Legacy Rust instructions** — `AGENTS.md` now qualifies single-process/keyring/Cargo/`target\\debug` rules as legacy Slint/Rust-only; Electron defaults point to `dist`, npm checks, safeStorage/DPAPI, and isolated package profiles. No Rust rebuild/download was run.

## Evidence run

- Mapped main + renderer TypeScript compilation passed with the read-only Electron-05 dependency tree.
- Focused owner suite passed **41/41** using local synthetic HTTP, memory gateways, fake native engine, and temporary diagnostics directories:
  `node --test dist/tests/nas-client.test.js dist/tests/session-controller.test.js dist/tests/diagnostics.test.js dist/tests/ipc-validation.test.js dist/tests/player.test.js dist/tests/library.test.js dist/tests/library-controller.test.js`
- `node --check scripts/verify-windows-package.mjs` and `git diff --check` passed.
- Final post-fix Electron window smoke passed once with an owned regular-file log, isolated temporary profile, and 30-second bounded lifetime. Evidence directory: `D:\project\z-video\.worktrees\electron-review-fixes\.scratch\electron-migration\runs\review-fixes-window-20261031-043215-24712`.
- One pre-fix smoke attempt stopped at a fixture assertion (`query: ""` versus omitted query); it was corrected without retrying the failed code state. Its log directory is `D:\project\z-video\.worktrees\electron-review-fixes\.scratch\electron-migration\runs\review-fixes-window-20261031-043157-6208`.

## Remaining acceptance boundaries

Not proven here: real NAS login/detail/stream/history/progress, hardware decode, DWM/native overlay pixels, mixed-DPI behavior, macOS behavior, public license provenance, rebuilt production package contents, or restart read-back with a real safeStorage profile. The root coordinator must merge the latest integration branch, then run only the affected root-level package/verification checks with owned file logs and isolated profiles.

## Spec follow-up residuals

- **Continue Watching classification context** — `src/renderer/library.ts` now retains the card's `classificationId` for the active detail and uses it for playback instead of the current library tab. The window fixture uses a `tv` Continue Watching item while the visible library tab is `movie`, then asserts both detail lookup and player command classification.
- **Search debounce versus immediate detail** — `openDetail` cancels the pending 250 ms timer before changing navigation. The window fixture types a query, opens the card immediately, waits 350 ms, and asserts that detail remains visible instead of being replaced by a late list refresh.
- Follow-up evidence: main and renderer TypeScript compilation passed using `D:\project\z-video\node_modules`; the single bounded window smoke passed with owned regular-file logs and an isolated profile at `D:\project\z-video\.worktrees\electron-review-fixes\.scratch\electron-migration\runs\spec-followup-window-20261031-082146-6948`.
