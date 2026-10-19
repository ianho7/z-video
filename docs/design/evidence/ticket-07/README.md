# Ticket #7 dark shell evidence

## Render path

`src/bin/poster_grid_preview.rs` starts the real `AppCoordinator` and
`AppWindow` with the existing `MockNasClient`, `MockPlayer`, credential store,
classification model, and collection fixtures. The shell therefore uses the
same category counts, search state, and grid callbacks as the application. No
NAS login, private media path, or private cover is used.

The snapshots were generated from the Ticket #7 worktree after merging the
latest integration tip. Slint's native Windows backend was used through
`Window::take_snapshot()`:

```powershell
$env:RUSTFLAGS = '-C debuginfo=0'
$env:CARGO_INCREMENTAL = '0'
cargo run --target-dir 'D:\project\z-video\.worktrees\ticket-07-shell\target' -j 1 `
  --bin poster_grid_preview -- --width 900 --height 640 `
  --output docs/design/evidence/ticket-07/shell-900x640.png
cargo run --target-dir 'D:\project\z-video\.worktrees\ticket-07-shell\target' -j 1 `
  --bin poster_grid_preview -- --width 1440 --height 900 `
  --output docs/design/evidence/ticket-07/shell-1440x900.png
```

`RUSTFLAGS=-C debuginfo=0` removes the Windows PDB pressure that previously
caused `link.exe` error `LNK1140`; it does not change the UI or renderer.

## Observed output

| Logical window | PNG dimensions | File | Result |
| --- | --- | --- | --- |
| 900x640 | 1125x800 | [shell-900x640.png](shell-900x640.png) | Dark sidebar, toolbar, search field, real category count, refresh action, and four-column grid remain visible at the minimum window size. |
| 1440x900 | 1800x1125 | [shell-1440x900.png](shell-1440x900.png) | Dark shell, seven-column grid, search/filter control, focusable actions, and real fixture counts render without light default controls. |

The PNGs do not contain a `pHYs` chunk, so they do not carry embedded DPI
metadata. Their physical-to-logical ratios are `1.25` (`1125/900` and
`1800/1440`), matching the Windows host's observed 125% desktop scale
(approximately 120 effective DPI from a 96 DPI baseline). No explicit
`SLINT_SCALE_FACTOR` override was used. This evidence covers the host's 125%
scale; Windows 100% and 150% display settings were not switched in this run
and remain unverified.

The images were visually inspected after replacing the unsupported search
glyph with the reusable SVG search token. Existing #5 poster geometry and #10
search callbacks remain on the same `AppCoordinator` path; this ticket adds
the shell styling and control layer around them.
