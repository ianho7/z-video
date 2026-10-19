# Ticket #5 poster grid evidence

## Fixture and render path

`src/bin/poster_grid_preview.rs` starts the real `AppCoordinator` and `AppWindow`
with `MockNasClient`, `MockPlayer`, and an in-memory credential store. It fills
the same `collections` model used by the library view with redacted fixtures:
horizontal, vertical, ultra-wide, square, long-title, and missing-cover items.
The PNGs below are `Window::take_snapshot()` output from that native Slint
window. No NAS login, private media path, or private cover is used.

The preview was run from the ticket worktree on Windows with Slint's default
desktop backend and these logical window sizes (no explicit scale-factor
override):

```powershell
cargo run --bin poster_grid_preview -- --width 900 --height 640 `
  --output docs/design/evidence/ticket-05/fixed-900x640.png
cargo run --bin poster_grid_preview -- --width 1440 --height 900 `
  --output docs/design/evidence/ticket-05/fixed-1440x900.png
cargo run --bin poster_grid_preview -- --width 2560 --height 1380 `
  --output docs/design/evidence/ticket-05/fixed-2560x1380.png
```

The commands set Slint logical sizes of `900x640`, `1440x900`, and `2560x1380`.
On this Windows host the default desktop scale factor is `1.25`, so
`Window::take_snapshot()` produced physical PNG sizes of `1125x800`,
`1800x1125`, and `3200x1725` respectively. The PNG metadata reports 96 DPI;
there was no explicit scale-factor override. The host registry did not expose a
`LogPixels` value and the local CIM display query was unavailable, so the
evidence records both the requested Slint logical size and the observed
physical snapshot size instead of claiming a different system DPI.

## Before and after

The baseline was captured from the same preview entry before the grid change:

```powershell
cargo run --bin poster_grid_preview -- --width 1440 --height 900 `
  --output docs/design/evidence/ticket-05/baseline-1440x900.png
```

| Render | Result |
| --- | --- |
| [baseline 1440x900](baseline-1440x900.png) | Fixed seven columns, but the long title's preferred width expands its card and the adjacent cards become narrower. The cover frame has a fixed height, so card widths and image ratios vary. |
| [fixed 900x640](fixed-900x640.png) | Four equal columns in the available content width; the grid remains inside the viewport and the long title is elided. |
| [fixed 1440x900](fixed-1440x900.png) | Seven equal columns, matching the reference target. Horizontal, vertical, and ultra-wide sources are all cover-cropped into identical 2:3 frames. |
| [fixed 2560x1380](fixed-2560x1380.png) | Twelve equal columns at the large-window cap; all eight fixtures fit on one row without horizontal overflow. |

The content width is derived from the actual window width by subtracting the
220px sidebar and 64px content padding when the sidebar is visible. A 140px
minimum target width, 14px gap, and 12-column cap produce 4 / 7 / 12 columns
at the three reference sizes. Card width is assigned by the grid, while each
card's cover frame sets `height = width * 1.5`; `Image { image_fit: cover; }`
keeps source aspect ratios from changing layout geometry.

## Interaction path

`PosterCard` preserves `collection_clicked(string)` and connects both its
full-card `TouchArea` and the `accessible-action-default` callback to the same
collection id. `PosterCardFocusTouchArea` follows Slint's focus/click bridge:
the card is a tab-focusable target, Space/Return invoke the same activation,
and a 2px blue outline is rendered while focused. The existing Rust
`AppCoordinator` callback remains the owner of opening the Collection detail,
so no NAS/player or toolbar path changed.

No separate source-grep or AST test was added. Layout and keyboard behavior are
owned by the native Slint render/input boundary; the focused proof here is the
real Windows render plus compilation of the generated component path.
