# Ticket 11 neutral render evidence

The render uses the real Rust `AppCoordinator` and generated Slint `AppWindow`
through `poster_grid_preview`. The fixture contains nine de-identified poster
items with ready, missing, failed, and loading image states. The preview applies
the local `movie` filter and `score_desc` sort so the selected controls and the
result count are visible together. It does not call a NAS or a remote search
endpoint.

## Command

```powershell
cargo run --target-dir 'D:\project\z-video\target' --bin poster_grid_preview -- --width 1440 --height 900 --media-type movie --sort-order score_desc --output 'docs/design/evidence/ticket-11/neutral-1440x900.png'
```

The command was run from
`D:\project\z-video\.worktrees\ticket-11-filter-sort` on Windows with Slint's
default native window backend.

## Viewport and DPI

| Requested logical viewport | Snapshot PNG | Observed physical size | Effective snapshot scale | PNG metadata DPI |
| --- | --- | --- | --- | --- |
| 1440 x 900 | [neutral-1440x900.png](neutral-1440x900.png) | 1800 x 1125 | 125% (1800/1440) | 96 x 96 |

The 125% value is derived from the logical-to-physical snapshot dimensions;
the PNG metadata remains 96 DPI. The screenshot contains only fixture text,
fixture artwork, and a redacted NAS label.

## Visual checks

- The movie filter and score descending sort buttons show selected state.
- The scope line reports `9` loaded items and `5` matched items.
- The grid keeps equal card geometry while showing ready, missing, failed, and
  loading poster states.
- No favorite control or unknown favorite state is rendered.
