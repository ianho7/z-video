# Ticket 13 context restore evidence

These snapshots use the real Rust `AppCoordinator` and generated Slint
`AppWindow` through the Windows native `poster_grid_preview` fixture. The
fixture uses `MockNasClient`; it does not connect to a NAS or transmit any
credentials. The roundtrip invokes the same collection-detail and detail-back
callbacks used by the UI and saves the library, detail, and restored-library
states.

## Command

```powershell
cargo run --offline --target-dir 'D:\project\z-video\target-ticket08' --manifest-path 'D:\project\z-video\.worktrees\ticket-13-context-restore\Cargo.toml' --no-default-features --bin poster_grid_preview -- --detail-roundtrip --width 1440 --height 900 --media-type movie --sort-order score_desc --output 'docs/design/evidence/ticket-13/neutral-library-1440x900.png' --detail-output 'docs/design/evidence/ticket-13/neutral-detail-1440x900.png' --back-output 'docs/design/evidence/ticket-13/neutral-back-1440x900.png'
```

The command ran on Windows with Slint's default native window backend and the
offline shared target directory. The requested logical viewport was 1440 x
900. The Windows display scale was 125%, so the native snapshot is expected to
be 1800 x 1125 physical pixels; PNG metadata remains 96 x 96 DPI, as in the
existing neutral preview evidence.

## Snapshots

- [neutral-library-1440x900.png](neutral-library-1440x900.png) — filtered and
  sorted library fixture before opening detail.
- [neutral-detail-1440x900.png](neutral-detail-1440x900.png) — `c04` detail
  view for “盗梦空间”.
- [neutral-back-1440x900.png](neutral-back-1440x900.png) — library after the
  detail-back callback, with the movie filter and score-desc sort visible.

The automated native fixture roundtrip is the available interaction evidence.
Windows CUA click-card and Escape-key input was attempted but did not complete
because the fixture window was no longer targetable; no manual interaction is
claimed here.
