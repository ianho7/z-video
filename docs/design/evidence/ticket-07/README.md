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

The same native preview can exercise the two requested display scale factors
without changing the Windows display setting. `SLINT_SCALE_FACTOR` is read by
Slint's Windows winit backend before the native window is created:

```powershell
$env:SLINT_SCALE_FACTOR = '1'
cargo run --target-dir 'D:\project\z-video\.worktrees\ticket-07-shell\target' -j 1 `
  --bin poster_grid_preview -- --width 1440 --height 900 `
  --output docs/design/evidence/ticket-07/shell-1440x900-100.png
$env:SLINT_SCALE_FACTOR = '1.5'
cargo run --target-dir 'D:\project\z-video\.worktrees\ticket-07-shell\target' -j 1 `
  --bin poster_grid_preview -- --width 1440 --height 900 `
  --output docs/design/evidence/ticket-07/shell-1440x900-150.png
Remove-Item Env:SLINT_SCALE_FACTOR
```

`RUSTFLAGS=-C debuginfo=0` removes the Windows PDB pressure that previously
caused `link.exe` error `LNK1140`; it does not change the UI or renderer.

## Observed output

| Logical window | PNG dimensions | File | Result |
| --- | --- | --- | --- |
| 900x640 | 1125x800 | [shell-900x640.png](shell-900x640.png) | Dark sidebar, toolbar, search field, real category count, refresh action, and four-column grid remain visible at the minimum window size. |
| 1440x900 | 1800x1125 | [shell-1440x900.png](shell-1440x900.png) | Dark shell, seven-column grid, search/filter control, focusable actions, and real fixture counts render without light default controls. |
| 1440x900 at 100% | 1440x900 | [shell-1440x900-100.png](shell-1440x900-100.png) | Native snapshot with `SLINT_SCALE_FACTOR=1.0` (96 effective DPI). |
| 1440x900 at 150% | 2160x1350 | [shell-1440x900-150.png](shell-1440x900-150.png) | Native snapshot with `SLINT_SCALE_FACTOR=1.5` (144 effective DPI). |

The PNGs do not contain a `pHYs` chunk, so they do not carry embedded DPI
metadata. The observed physical-to-logical ratios are `1.25` for the default
host run (`1125/900`, `1800/1440`), `1.0` for the 100% override, and `1.5`
for the 150% override. The default host run is approximately 120 effective
DPI; the explicit Slint overrides correspond to 96 and 144 effective DPI.
These scale checks do not change the Windows display setting.

The images were visually inspected after replacing the unsupported search
glyph with the reusable SVG search token. Existing #5 poster geometry and #10
search callbacks remain on the same `AppCoordinator` path; this ticket adds
the shell styling and control layer around them.
