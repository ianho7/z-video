# Local library usability follow-up

Approved by the user's implementation instruction on 2026-11-06. Evidence: `user-view-audit-2026-11-06.md`. Baseline: `a7bc4e0`, current integration `codex/local-library-integration`. Implementers use visible `gpt-5.6-luna` / `max` child agents and isolated worktrees; root coordinates.

## Scope and dependencies

| Lane | Responsibility | Integration dependency |
| --- | --- | --- |
| Scan/data | Identify the cause of stale scan-time state/list; make committed discoveries queryable and state timely without unbounded refreshes. Add safe optional detail playback state if needed by the UI. Preserve cancellation/partial-scan/history and path boundaries. | UI consumes the existing scan stream and any additive safe detail field. |
| Settings/playback | Persist bounded volume/mute/speed and library sort under app userData. Restore before use. Add a main-validated restart option to opaque-ID playback open, preserving history if loading fails. Own shared IPC/preload additions; coordinate them before UI integration. | UI uses the agreed preferences and resume/restart contract. |
| UI | Reduce wasted first-screen space, keep card titles and detail Play/Continue visible, truthful scanning/filter/search empty states, progressive bounded refresh, explicit resume timestamp/restart, current title, and persisted sort binding. | Can implement layout immediately; final integration waits for both backend contracts. |

All lanes lead to one integrated candidate, one bounded independent review and one user-view acceptance pass. Only the UI lane operates the desktop during implementation; root and other agents do not interleave input. No new runtime dependency, provider framework, metadata writer, automatic-next-episode feature or broad scanner optimization is in scope.

## Acceptance and proof ownership

- **Window/UI boundary:** At preferred and minimum Windows window sizes, first-row card titles and detail Play/Continue are visible without scrolling through long plots. A running scan shows committed discovered items and a truthful state; query/filter changes and cancellation do not resurrect stale results. Empty source, running scan, empty type and empty search have distinct messages. Extend the existing real local-library window proof for these risks rather than source-text assertions or duplicated mocks. Owned fixtures must not introduce production-only timing flags.
- **Main settings/playback boundary:** Fresh processes restore committed native volume/mute/speed and chosen sort; renderer cannot store paths or arbitrary fields. One focused owner proof covers validation, serialization and invalid/missing preference fallback; the distinct native/window proof covers applying restored settings and UI binding. Start-over is main-resolved by opaque mediaId, starts at zero and does not overwrite history when loading fails. Preserve generation/EOF/fullscreen/track and normal resume behavior.
- **Actual user view:** Operate the integrated production window with an isolated profile and owned media. The previously authorized NAS sample may be used read-only for a targeted scan/navigation check; do not reproduce private titles/paths/screenshots in committed artifacts. Confirm clear continuation/restart, current title, play controls and reopening. If the native picker cannot be targeted, record that tool boundary and request only the needed handoff rather than misreporting it as a product failure.
- **Integration/delivery:** Run required typecheck, npm owner suite, window, local-library and local-library-app checks once on relevant current code, reusing unaffected successful evidence. Package and verify the independently copied Windows candidate after GUI acceptance. Tests that fail due to sandbox/native-window permissions are environment failures until rerun under the supported boundary. No macOS/hardware or private-share performance claim follows from fixtures.

Completion requires scoped commits, locatable validation notes, no known in-scope blocking finding, a clean integration diff apart from known audit fixtures, and updated standalone candidate/PR. Existing unrelated worktrees, old encrypted sessions and media files remain untouched. Preserve task evidence before any task-worktree cleanup.
