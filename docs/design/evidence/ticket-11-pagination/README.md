# Ticket 11 pagination and shell geometry evidence

This change keeps the existing `50`-item NAS page contract visible in the UI
and adds a fixed-height pager below the current page's poster grid. The page
model is replaced before each request, and the poster request gate is reset so
late image results from the previous page cannot populate the new page.

## Design basis

- The high-fidelity Apple reference uses a `70px` minimum toolbar, `11px`
  vertical and `30px` horizontal toolbar padding, a `310px` search field, and
  `24px 32px 48px` library content padding. The existing `64px` logical shell
  token is preserved for the current window geometry; the inner toolbar and
  library spacing tokens are applied in `ui/app_window.slint`.
- The low-fidelity wireframe places a compact pager in a `40px` footer below
  the grid. The implementation uses the equivalent first/previous/next/last
  controls and keeps disabled controls visible for discoverability.
- The scope line reports both the current page's loaded/matched count and the
  API-reported total, so local search and filter results are not presented as
  a whole-library result.

## Targeted evidence

The Slint compiler accepted the updated `AppWindow` and `AppleWorkspace`
bindings while compiling the focused test target. The focused pagination test
then verified:

- `count=105` produces three pages of `50`, `50`, and `5` items;
- page 2 requests the item range beginning at `start=51`, and page 3 at
  `start=101` through the mock client's real `start/limit` behavior;
- search and filter actions from page 3 reload page 1 before applying the
  condition; and
- empty, single-page, last-page math plus poster-range reset are covered by
  `app::poster_loading_tests`.

Commands run from the isolated candidate worktree:

```powershell
cargo test --offline --test pagination_test -- --nocapture
cargo test --offline --lib poster_loading_tests -- --nocapture
git diff --check
```

Both focused test commands passed before the final context-tracking-only
adjustment. A later `cargo check --offline` was stopped during dependency
recompilation after the C: drive cache exhausted disk space; the earlier
focused test compile had already exercised the changed Slint definitions.
