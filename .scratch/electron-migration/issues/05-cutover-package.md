# 05: Electron cutover and Windows package

**What to build:** Deliver the replacement as the default runnable/buildable Windows application, preserve the original product behavior and report measured resource costs.

**Blocked by:** 04: NAS playback, progress and restart resume.

**Status:** blocked

- [ ] Default development/build/package commands use Electron/TypeScript without Rust; a Windows package includes the required production runtime/player assets and launches.
- [ ] Compare the approved visual/behavior requirements with the replacement and fix migration regressions; remove replaced active paths only after acceptance, preserving rollback in Git.
- [ ] Record development dependency/cache, distributable, installed disk and representative runtime memory separately. Do not claim reductions without comparable measurements.
- [ ] Update entry documentation, architecture, developer rules and dependency/license information; distinguish Windows verification from future macOS work.
- [ ] Integration receives independent Standards and Spec reviews, scoped repairs, and appropriate checks. Required real-NAS/decoder/visual evidence must be present before full closure; missing environment evidence is reported as blocked acceptance, not passed.

Context: migration spec and all merged implementation evidence. Do not delete global Rust/Cargo directories or unrelated existing worktrees. Clean only task-created implementation worktrees after preserving all commits and evidence.
