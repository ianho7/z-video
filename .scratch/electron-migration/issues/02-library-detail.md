# 02: Browse the Media library and select an Episode

**What to build:** From an authenticated window, browse posters and classifications, search/filter/sort the accurately declared data range, inspect Collection details, choose Episodes, use real continue-watching data, and return to the previous browsing context.

**Blocked by:** 01: Electron login and Session recovery.

**Status:** blocked

- [ ] Paginated posters and Collection details preserve current NAS protocol, including system=94, numeric/string fields, explicit missing-list errors and legacy history fallback.
- [ ] Search/filter/sort scope is truthful; loading/empty/error states differ and old requests cannot overwrite newer navigation.
- [ ] Return restores query/filter/sort/scroll/focus; continue-watching uses actual available history rather than fabricated progress or full-library detail polling.
- [ ] Existing approved dark layout, responsive grid/detail, keyboard controls and transparency/accessibility fallbacks are preserved. Image caching is bounded.
- [ ] Selection invokes the shared playback action contract; real-window interaction and NAS owner-boundary tests cover this slice without requiring ticket 03 to be finished.

Context: migration spec, existing browsing/visual specs, current library/detail/cache owners and prototypes. Own library/detail renderer and NAS library requests; coordinate shared files via the integration branch, keep player implementation out of this ticket.
