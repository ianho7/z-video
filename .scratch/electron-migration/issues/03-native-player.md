# 03: Embedded native playback and controls

**What to build:** Open a known local media sample inside the Electron application and operate native playback, proving the same engine can coexist with its visible controls before NAS integration.

**Blocked by:** 01: Electron login and Session recovery.

**Status:** blocked

- [ ] One native playback engine renders inside the app window; prioritize existing libmpv. A separate external player window is not acceptance.
- [ ] Pause/resume, seek, available audio tracks, internal/external subtitle selection/off and fullscreen work with appropriate local samples.
- [ ] Resize/DPI/fullscreen preserve video geometry, visible interactive controls and playback state, without CPU per-frame copying.
- [ ] Failed load is observable, shutdown releases engine/window resources, and old playback events cannot corrupt a new Playback session.
- [ ] Exercise the shared production player command/event boundary and a real Windows window; record actual engine/decoder evidence. Missing media/track/hardware evidence remains explicitly unverified.

Context: migration spec, shared contracts from 01, current native surface/mpv owners and media requirements. Own player/native adapter and player view; keep NAS and library implementation out. Necessary native binding dependencies are allowed, versioned and source/license documented. Use the existing ignored vendor binary where suitable; avoid copying it into each worktree.
