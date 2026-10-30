# Replace Rust/Slint with Electron and TypeScript

Status: accepted, 2026-10-30. Supersedes ADR 0001's application stack choice.

The user approved Electron and TypeScript migration with existing functionality and design retained, acknowledging that Electron may increase installation and runtime costs. The initial motivation is Rust development disk use; development caches and installed application size are measured separately.

Use one desktop window, Electron main/preload/renderer isolation and one native playback engine. Electron's framework processes are allowed. Necessary native player glue is allowed; a permanent Rust service behind Electron is not the target. All remaining first-release constraints in ADR 0002 continue to apply.

The migration specification and per-ticket acceptance are in `docs/electron-migration-spec.md` and `.scratch/electron-migration/issues/`. Existing visual and protocol evidence remains reference material, not proof that the replacement passes. Keep the old implementation until cutover acceptance and retain rollback through Git history.
