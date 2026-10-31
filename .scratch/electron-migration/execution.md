# Migration execution

Integration branch: `codex/electron-integration`.
Draft PR: https://github.com/ianho7/z-video/pull/21 (user explicitly authorized code push and draft PR creation).
Baseline: `1c0ab0b865abe80a47796f1de278374d85754b78`.
Specification: `docs/electron-migration-spec.md`.
Tickets: `issues/01-login-session.md` through `issues/05-cutover-package.md`.
Graph: 01 -> {02,03} -> 04 -> 05.

## Agent procedure

Use this chat's built-in subagents with model `gpt-5.6-luna`, effort `max`, and a fresh context, one worktree and branch per ticket. Exact model invocation through the built-in tool succeeded. Ticket 01 was already started via Codex CLI with that same model/effort; let it finish without duplicating writes. All subsequent implementation, merger and review agents run visibly in this chat. Never substitute a different model. Coordinator remains in the original chat.

Read the ticket, specification, glossary and applicable repository instructions. ADR 0003 and the user-approved migration supersede the previous Rust/Slint stack and single-process constraints; product scope/protocol/safety constraints remain. Read the TDD and test-audit skills before implementing. Agreed seams are NAS transport, real Electron window and real NAS persistence, already approved by the user.

Confirm integration tip is an ancestor before edits. Merge the latest integration tip before reporting; preserve other work. Commit only the ticket's code, tests, necessary docs and evidence. Record the commit, commands and results, runtime evidence, limitations and changed-file ownership in a ticket-specific completion note. Do not mark unobserved behavior passed or close remote issues. Never dump credentials, full media paths or playback URLs.

Implementers run in background. Tickets 02 and 03 start only after 01 is merged. Shared contracts/lockfile changes must merge through integration; discuss necessary contract changes in a completion note rather than silently creating incompatible interfaces. Merger agents resolve scoped conflicts and reuse valid checks; they do not implement unrelated changes.

## Final compatibility checks

Before ticket 05 claims parity, compare the integrated real window with the existing visual specification. In particular, preserve the original sidebar collapse action (`ui/app_window.slint` sidebar-toggled / `src/app.rs` apple_sidebar_visible) and actual Windows backdrop behavior (`src/platform/windows.rs` / `src/app.rs` native_backdrop_enabled), including high-contrast/reduced-transparency fallback. A CSS tint alone does not prove the old DWM effect. Verify these at the real-window seam; avoid adding source-text assertions. Native player adjacent-controls versus overlaid controls is already an explicit partial-acceptance item; obtain visible evidence and do not silently label it parity.

Actual Windows safeStorage fresh-process recovery can be proved with synthetic credentials and a local HTTP fixture through the production main/preload/window, using two Electron processes and a test-owned temporary userData path. This covers the OS storage boundary missing from ticket 01's injected crypto test without reading user credentials or adding a production test-only flag. It still does not prove live NAS compatibility or real NAS progress persistence.

## Tracker and completion

GitHub repository: `ianho7/z-video`, label `ready-for-agent`. Published specification: #15. Tickets 01-05: #16, #17, #18, #19, #20 respectively. Native sub-issue and blocked-by relationships are configured. Track implementation done, locally verified, and fully accepted separately. Missing real NAS evidence prevents full acceptance and PR-ready claims.

## Final local candidate (2026-10-31)

Integration source: ae53280; repairs: cc2188c and bacdcbd. Standards and Spec follow-up reviews both pass, with separate reports. Final build and package-local native dependency/production-renderer readiness checks passed. Refer to final-local-evidence.md for exact scope, paths and measurements. The final follow-up window smoke covers cross-classification Continue Watching and pending-search/detail navigation; its small logs are preserved under root runs/spec-followup-window-20261031-082146-6948.

The seven task-created implementation worktrees were individually verified clean and fully merged, then removed. Their branches/commits, root portable package, root node_modules and copied run logs remain. Old unrelated worktrees and global Rust/Cargo installations were not changed. Draft PR #21 and migration issues remain pending real NAS/visual/hardware acceptance; control-strip placement is awaiting user direction and is not silently accepted.
