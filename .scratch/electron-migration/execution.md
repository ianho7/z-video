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

## Tracker and completion

GitHub repository: `ianho7/z-video`, label `ready-for-agent`. Published specification: #15. Tickets 01-05: #16, #17, #18, #19, #20 respectively. Native sub-issue and blocked-by relationships are configured. Track implementation done, locally verified, and fully accepted separately. Missing real NAS evidence prevents full acceptance and PR-ready claims.
