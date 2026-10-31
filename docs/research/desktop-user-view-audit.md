# Desktop user-view audit (2026-10-31)

Scope: actual existing Windows portable z-video package, launched through Computer Use (@oai/sky), observed initial window and scrolled login page. No credentials entered, login submitted, LAN scan started, NAS setting changed, or playback/progress write performed. Three actual window observations showed the same restoring-session message. This is not a post-login library/playback acceptance test.

## Observed

1. Default 1040x720 window clips the login card: NAS discovery is below the fold. Scrolling reveals it. The first-use connection path is unnecessarily hard to find.
2. The message `正在恢复安全会话…` remained visible across all observations. No timeout, retry or skip action is shown. The observation proves a persistent displayed status, not whether its cause is a pending operation, missing IPC result or stale text; diagnosis is a separate proposed task.
3. No visible guest / browse shared folder / continue offline / open local file entry exists on the login screen. A person with a guest SMB share cannot reach a file-first flow here.
4. English default Electron File/Edit/View/Window menu remains visible above the otherwise Chinese interface.

## Source-backed gaps, not runtime findings

- `src/renderer/index.html:97` places Open Local Video within the hidden authenticated library view; `renderer.ts:159-161` hides it while logged out. The native local-file capability exists but is unavailable from onboarding.
- Player HTML has play/pause, seek, fullscreen, tracks and external subtitles; no volume/mute/rate controls are exposed in that control markup (`index.html`, player section). These are proposed user conveniences, not automatically approved migration requirements.
- No guest filesystem library/indexing or share-to-metadata mapping has been demonstrated. SMB file access alone cannot prove reuse of NAS film classification/history metadata.

## Suggested order for a later decision

First investigate/fix restoring-session UX and add an explicit unauthenticated local/shared-file entry if guest access is chosen. Then verify an actual user-authenticated library/detail/playback journey before ranking further missing features. Keep volume/mute/shortcuts and menu localization as separate candidates. Do not claim post-login UI defects from source inspection alone.

For a deeper hands-on audit the user must complete login themselves, after which read-only navigation can be observed. Actual NAS playback may report progress and should be scoped explicitly before testing it.
