# Ticket #8 detail-page evidence

## Native fixture

`src/bin/poster_grid_preview.rs` starts the real `AppCoordinator` and
`AppWindow` with `MockNasClient`, `MockPlayer`, an in-memory credential store,
and redacted local fixture data. The detail view is selected through the same
exported `AppWindow` state used by the application; no NAS request, private
media path, token, or private cover is used.

The preview supports these detail states:

- `complete`: cover, title, year/type/score, primary play action, two seasons,
  and selectable episodes;
- `missing-cover`: the metadata and episodes remain available while the cover
  area shows the explicit unavailable state;
- `error`: the detail failure panel shows a redacted recovery message and the
  return-to-library action.

## Windows native render

The snapshots below were generated from this ticket worktree with Slint's
native Windows backend and `Window::take_snapshot()`. The requested logical
window size was `1440x900`; the host display scale was 125%, so the PNGs are
`1800x1125` physical pixels.

```powershell
cargo run --offline --target-dir 'D:\project\z-video\target' -j 1 `
  --bin poster_grid_preview -- --width 1440 --height 900 `
  --view detail --detail-state complete `
  --output docs/design/evidence/ticket-08/detail-complete-1440x900.png

cargo run --offline --target-dir 'D:\project\z-video\target' -j 1 `
  --bin poster_grid_preview -- --width 1440 --height 900 `
  --view detail --detail-state missing-cover `
  --output docs/design/evidence/ticket-08/detail-missing-cover-1440x900.png

cargo run --offline --target-dir 'D:\project\z-video\target' -j 1 `
  --bin poster_grid_preview -- --width 1440 --height 900 `
  --view detail --detail-state error `
  --output docs/design/evidence/ticket-08/detail-error-1440x900.png
```

| State | PNG | Observed native result |
| --- | --- | --- |
| Complete | [detail-complete-1440x900.png](detail-complete-1440x900.png) | Independent detail page keeps the sidebar and toolbar, then shows cover, title/meta, play action, two season cards, selected episode focus, and the scrollable summary section below the episode cards. |
| Missing cover | [detail-missing-cover-1440x900.png](detail-missing-cover-1440x900.png) | Cover space remains stable and says `暂无封面`; metadata, play action, and episode rows remain usable. |
| Error | [detail-error-1440x900.png](detail-error-1440x900.png) | Red error panel distinguishes detail failure, displays the redacted fixture recovery text, and keeps `返回片库` available. |

## Checks

```powershell
cargo check --offline --target-dir 'D:\project\z-video\target' -j 1
cargo test --offline --target-dir 'D:\project\z-video\target' `
  --test collection_detail_test -- --test-threads=1
git diff --check
```

`cargo check` passed with the repository's existing unused
`build_collection_list_form` warning. The focused detail navigation test passed
1/1 and covers loading, collection preservation, Episode selection, Return,
and Escape navigation.
