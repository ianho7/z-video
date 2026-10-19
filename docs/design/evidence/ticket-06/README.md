# Ticket #6 image loading evidence

## Fixture

`poster_grid_preview` uses a local neutral Slint fixture with nine known rows:

- seven decoded covers with different source aspect ratios;
- one missing-cover row;
- one failed-cover row;
- one loading-cover row.

All rows use the same `PosterCard` cover frame. The preview does not contact a NAS and does not represent an unloaded portion of a library.

## Windows native render

Commands were run from the ticket worktree on Windows with the default Slint native window backend. The system display scale was 125% (DPI 120); no renderer or scale override was used. The temporary Rust directory was placed on D: because the Windows user temp volume was space constrained. `CARGO_TARGET_DIR` reused the existing local Cargo target only to avoid rebuilding duplicate dependencies.

```powershell
$env:CARGO_TARGET_DIR = 'D:\project\z-video\target'
$env:TEMP = 'D:\project\z-video\.worktrees\ticket-06-images\.tmp-rust'
$env:TMP = $env:TEMP
cargo run --bin poster_grid_preview -- --width 1440 --height 900 --output docs/design/evidence/ticket-06/neutral-1440x900.png
cargo run --bin poster_grid_preview -- --width 900 --height 640 --output docs/design/evidence/ticket-06/neutral-900x640.png
cargo run --bin poster_grid_preview -- --width 2560 --height 1380 --output docs/design/evidence/ticket-06/neutral-2560x1380.png
```

| Requested logical viewport | Snapshot PNG | Observed physical size |
| --- | --- | --- |
| 1440 x 900 | `neutral-1440x900.png` | 1800 x 1125 |
| 900 x 640 | `neutral-900x640.png` | 1125 x 800 |
| 2560 x 1380 | `neutral-2560x1380.png` | 3200 x 1725 |

The screenshots show the ready, missing, failed, and loading states at the same 2:3 cover geometry across all three viewports. The 1440 x 900 image is the primary acceptance screenshot.

## Checks

```powershell
$env:TEMP = 'D:\project\z-video\.worktrees\ticket-06-images\.tmp-rust'
$env:TMP = $env:TEMP
cargo check
cargo test --lib poster_loading_tests -- --test-threads=1
git diff --check
```

`cargo check` passed with the repository's existing `build_collection_list_form` dead-code warning. The focused range tests passed 2/2.
