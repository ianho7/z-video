# Local-library usability candidate — 2026-11-07

Status: code and automated checks complete; Computer Use deferred by the user. Runtime/package source: `ac6b7d6`, branch `codex/local-library-integration`. This delivery implements the four observations in `user-view-audit-2026-11-06.md`: visible titles and detail actions, progressive/truthful scan feedback, explicit continuation/restart/current title, and persistent daily preferences. It also repairs root-level video indexing, a concrete blocker exposed by the owned fixture.

## Current acceptance scope

The user explicitly requested no further desktop operation and asked to finish code and checks first. Computer Use remains deferred. Isolated automated Electron checks below do not constitute a human/Computer Use acceptance pass, real-share performance measurement, or screenshot proof.

## Results

| Boundary | Evidence |
| --- | --- |
| Type/owner contracts | Typecheck passed. Integrated npm tests passed 66/66; unaffected owner results were reused. The worker/detail owner smoke passed in the scan lane, and the later one-line root-directory fix passed its direct database-owner regression including existing path/link checks. |
| Renderer/IPC startup | The first integration window check exposed a browser module import missing `.js`. After repairing the actual import and updating the preference-aware fixture, the same window check passed. Root log: `.scratch/electron-migration/runs/05-window-1794020155375-1960/window.log`. |
| Production scan/layout | PASS with a success receipt written after all assertions and before quit, required by the parent runner. A temporary failing assertion returned exit 1 and no receipt; the earlier zero-exit false positives are withdrawn. The final owned fixture contains one real video and 8,000 zero-byte indexed files: 235 committed items were visible while scanning and the final count was exactly 8,001. The minimum viewport's first grid title ends at 577.1px within 578px; default size ends at 654.75px within 658px, with Continue Watching present. Long-detail Play remains visible and the current title is inside the 152px controls outside the video surface. |
| Native player/preferences | Two fresh production processes resumed 12.81s → 12.81s. The existing native proof also checks restored volume 35, mute true, speed 1.25 and rating sort; the player reserves exactly 152px and all ten controls remain visible. Failure-safe restart/history behavior has owner evidence in `ux-preferences-20261106.md`. |
| Standalone package | Final `npm run package` and `npm run verify:package` passed: Koffi/libmpv/XML, production window readiness and local SQLite query from an isolated user-data profile. Regular-copy candidate: 234 files / 503,200,325 bytes (about 480 MiB); no runtime dependency was added. Package log: `.scratch/local-library/runs/05-package-1794022551123-6824/packaged-app.log`. |

Preserved check artifacts: `.scratch/electron-migration/runs/local-library/ux-20261107/`. They contain owned fixtures/results only; private NAS titles, paths and screenshots are excluded from committed evidence.

Executable: `C:\Users\admin\.codex\visualizations\2026\10\30\01a18d67-6765-7dc0-8bd1-47ac85ca8f26\local-library-package\z-video-win32-x64\z-video.exe`.

The program package was replaced only after confirming no instance of that executable was running. User profiles, NAS media/NFO/artwork, old encrypted sessions, global tools and unrelated worktrees were not changed. Current task worktrees and their local test artifacts remain for traceability; they were not counted as removable caches.

## Remaining

Actual Computer Use of the new layout remains deferred at the user's request. New real-NAS timing, episodic continuous playback, hardware decoding, DWM pixel acceptance, macOS and installer/signing behavior were not verified by this follow-up. These limits do not reclassify the successful isolated code/window checks as a manual UX pass.
