# No-login local foundation

ID: 01-foundation
Depends: none

Scope / acceptance: Utility-process SQLite capability in pinned Electron and package; own local DB/schema/opaque file IDs; folder picker and single-movie import visible without NAS; direct open entry. Define stable IPC/contracts/schema used by tickets02/03. Update spec/architecture/glossary/ADR/AGENTS for approved scope. Fail meaningfully if bundled sqlite unavailable rather than silently adding native deps.

Read ../spec.md and ../execution.md. Use TDD at approved seams and test-audit. Record failing-before/passing-after evidence where meaningful, commands/results/limits, merge latest integration and commit completion note under docs/local-library/completions/. No push/PR/issue closure by implementers.
