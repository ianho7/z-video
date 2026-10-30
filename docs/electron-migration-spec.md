# Electron migration

Status: approved scope and task graph, 2026-10-30. Integration baseline: `1c0ab0b865abe80a47796f1de278374d85754b78`.

## Problem Statement

The user wants to replace Rust/Slint with Electron because development tools and build outputs consume too much disk space. Both development disk use and the installed application matter. A smaller installation is a measurement goal, not an assumed benefit of Electron.

## Solution

Replace the desktop implementation with Electron and TypeScript while preserving the existing product behavior, visual design, NAS protocol and native playback requirements. Windows is the delivery platform; macOS remains a future separately verified target. Keep the existing implementation available until replacement acceptance is established.

## User Stories

1. As a desktop user, I want to run and build the app without Rust, so that I maintain one application language and toolchain.
2. As an Account holder, I want local password and required MFA entry, so that I can connect without disclosing credentials.
3. As an Account holder, I want securely persisted Session state, so that restarting restores access.
4. As an Account holder, I want expired credentials cleared and a login screen, so that I can recover.
5. As a viewer, I want the same NAS classifications and Media library, so that migration does not change my content source.
6. As a viewer, I want responsive paginated posters with bounded caches, so that larger libraries remain usable.
7. As a viewer, I want search, filtering and sorting with an accurate coverage description, so that partial data is not presented as the full library.
8. As a viewer, I want Collection details and Episode selection, so that I can choose what plays.
9. As a viewer, I want browsing context restored after returning, so that I can continue where I left off.
10. As a viewer, I want genuine continue-watching entries, so that history is never fabricated.
11. As a viewer, I want video inside the app window with native decoding, so that the viewing experience remains integrated.
12. As a viewer, I want pause, seek, audio selection, internal/external subtitles and fullscreen, so that existing playback requirements remain available.
13. As a viewer, I want old asynchronous events discarded after changing Episode, so that one Playback session cannot alter another.
14. As a viewer, I want progress saved to the NAS and read back after restart, so that resume is not merely in-memory state.
15. As a desktop user, I want the approved dark design, keyboard interaction and reduced-transparency fallback, so that changing frameworks does not redesign the app.
16. As an Account holder, I want secret-free diagnostics and protected credentials, so that debugging does not expose my NAS.
17. As a Windows user, I want a packaged runnable application, so that source-level success is not mistaken for delivery.
18. As a user concerned about storage, I want separate measured development, package and installed sizes, so that tradeoffs are visible.

## Implementation Decisions

- Electron main owns Session, NAS requests, safe persistence, bounded caching and Playback coordination. A sandboxed renderer owns presentation and user actions; a narrow validated preload bridge connects them. Keep raw credentials and media addresses out of renderer-facing DTOs where they are unnecessary.
- Use TypeScript for main, preload and renderer. Prefer existing prototype assets/layout and platform/library features over adding a UI framework without a concrete need.
- Preserve NAS request methods, form/query/header/cookie placement and known response variants from the current owners and protocol ledger. Preserve distinct token, nas_id and nas_sign fields, system=94, explicit missing-list failures and legacy history fallback.
- Keep one main window and one native playback engine. Electron's required processes supersede the old single-process preference. Native glue is allowed where necessary for libmpv integration; HTML video alone is not equivalent to the accepted media requirements.
- Keep network and media work asynchronous. Bound poster disk/memory use, prevent stale navigation results, and avoid CPU copying every video frame.
- Existing secure credentials need not be automatically imported; users may sign in once in the replacement. Subsequent restart recovery must work securely. Do not remove or modify the old credential entry as part of migration.
- Preserve existing visual specifications, accessibility, query scope and product limitations. Migration does not turn unsupported NAS operations into simulated successes.
- The old implementation remains a comparison/rollback point while tickets land. Final cutover makes Electron the default and removes Rust from the default build/run/package path. Git history retains the old implementation; deleting unrelated caches, toolchains or worktrees is outside this task.

## Testing Decisions

The user approved three seams: the NAS transport/contract boundary, the real Electron window, and real NAS progress read-back/restart. Use TDD at those boundaries for changed behavior; expected results come from the existing spec/protocol evidence rather than the implementation. Existing Rust tests guide equivalent TypeScript owner-boundary cases, but do not prove the replacement.

- NAS contract tests use a local HTTP server to observe request encoding and drive success, business error, authentication error, malformed shape and numeric/string response variants. They cannot prove live NAS compatibility.
- Real-window interaction validates the login/library/detail path, stale request behavior, layout, keyboard focus, browsing restoration and embedded player controls. Local media proves rendering/controls independently of NAS.
- Real NAS acceptance validates independent login, library, returned stream, playback, progress response and restart/read-back for the correct Episode. Progress verification writes viewing history; it does not authorize deletes or metadata writes.
- Resource/package checks belong to final cutover. Record actual platform, engine and build versions and sizes. Build success is not hardware decoding or NAS evidence.
- Each risk has one primary evidence owner. Reuse unchanged evidence; failed environment/proof methods are not product regressions. No ticket is marked fully accepted when required live evidence is missing.

## Out of Scope

Product redesign, remote NAS support, media indexing, executable scraper runtime, recycle-bin writes, NAS deletion/restoration, HDR/Dolby/bitstream promises, automatic updates, public distribution/signing, unrequested global toolchain cleanup and claiming macOS support without testing.

## Further Notes

Approved task graph: 01 -> {02,03} -> 04 -> 05. One integration branch, one worktree/branch per implementation ticket, and merger agents integrate completed work. Coordinator uses its current model; execution agents must be invoked as `gpt-5.6-luna` with reasoning effort `max` (verified by a successful CLI call). No silent substitution.

The configured tracker is GitHub `ianho7/z-video`, label `ready-for-agent`. If GitHub is unavailable, local ticket files are authoritative working copies, with publication pending; do not invent issue numbers or close existing issues. Parent and historical issues remain unchanged.
