# User-view observations — 2026-11-06

Scope: current Windows portable player, operated through Computer Use. The existing user profile contained 99 indexed media items. The user supplied a NAS directory for a fresh import; that import and playback used a separate profile at `.scratch/user-view-audit-20261106/profile`. No product code was changed.

## Journey checked

| Step | Actual interaction and result | Health |
| --- | --- | --- |
| 1. Browse existing library | Opened the 99-item library; applied the episode filter; opened a Continue Watching card and returned to the library. Restored the All filter. | Navigation works; filtered-empty copy is misleading. |
| 2. Add a NAS source | The user selected the supplied directory in the native picker after the automation tool rejected its modal target. Observed a live scan at 4 discovered/new videos, then completion at 29 videos. | Import works; discovered items were not visible at the 4-item observation. |
| 3. Find a film | Changed sorting to rating; searched for a deliberately unmatched string; saw a correct no-match message; cleared search and restored all 29 items. | Search recovery works; default-size card layout hides titles below the first viewport. |
| 4. Details and playback | Opened a film, scrolled to its Play button, started playback from the NAS, paused at 00:15 of 1:58:47, changed volume to 35, and exited normally. | Playback becomes ready and pause works. Play requires scrolling; the visible player controls do not identify the current film. |
| 5. Reopen and continue | Relaunched the same isolated profile. The 29-item index and Continue Watching entry remained. Opening that card led to details with a generic Play button; playback subsequently showed 00:22. Volume was 100 and sorting was Recently Updated. Returned to the library and closed only the test window. | Progress is retained; restart loses volume and sort preferences. This was an approximate live resume check, not a frame-accurate timing measurement. |

## Prioritized changes

1. **Make identification and starting playback immediate.** At the observed default window, the initial grid viewport shows large posters but not their titles. Details retain the library header/search/filter area, and the long title/plot pushes Play below the fold. Reduce wasted vertical space, show readable card titles, and keep Play/Continue visible without scrolling.
2. **Make scan and empty-result states truthful.** During the observed scan the status said 4 videos/new 4, while Sources still said 0/no source and the grid said there were no local films. Separately, an empty episode filter in the 99-item library used the same empty-library message. Show discovered content progressively and distinguish scanning, no sources, no matching type, and no matching search.
3. **Make continuing a film explicit.** Continue Watching currently opens details; its action says only Play and does not disclose the saved timestamp. Provide a clear Continue-from-time action and a separate restart action, and display the current title in playback.
4. **Retain daily preferences.** After volume 35 and rating sort, restarting restored volume 100 and Recently Updated. Persist relevant settings. Speed persistence was not checked during this run and must not be reported as a measured failure.

## Limits

The observed NAS sample is movie-oriented; no real episodic collection, previous/next episode or automatic next-episode behavior was verified. The two owned episode fixtures prepared earlier were not imported during this run. No manual delete/remove-source, NAS file write, credential change or source mutation was performed. Native picker target errors and occluded/wrong-window screenshots were tooling failures and were excluded from product findings. Private titles, media paths, plots and screenshots are intentionally omitted from this note.

The original user window remains open with its original 99-item index; the separate test window has been closed. The separate profile and owned sample files remain under `.scratch/user-view-audit-20261106/` for reproducibility.
