# Independent local app: ZSpace mechanism and performance boundary

Date: 2026-10-31. Research only; no implementation, NAS access, configuration change, media scan or playback.

## Corrected product interpretation

The new objective is an account-free local media library, independent of ZSpace services. The previous statement that retaining NAS classifications/history requires its API applies only to reusing its server-owned data. Recreating poster browsing, filters, episodes and resume locally does not require that API. This changes the product data source, not merely the login screen. Existing architecture documents describe the previous NAS-client scope and are not silently rewritten here.

## What the official product does

ZSpace officially advertises support for existing NFO and poster files, metadata matching, collections, edition grouping and manual correction: https://www.zspace.cn/z4/software.html . It does not establish that every currently displayed poster, manual match or watched position is exported beside the media. The user's actual directory contents have not been inspected.

Historical runtime evidence for official desktop version 2.45.2026082601 recorded Electron 33.3.1, embedded film UI, authenticated NAS metadata calls, stream preparation, local /splay/ proxy and UZPlayer/VLC playback with progress reports. See reference/runtime-desktop-app-2026-10-16.md and reference/dependencies-player-analysis.md. This is a specific older observed version, not a complete reconstruction of the current server or proof that every play transcodes.

Conceptual observed chain: media/metadata on NAS -> NAS film library/API -> desktop web UI -> stream preparation/local proxy -> native player -> progress report. NAS database technology and full indexing implementation remain unknown. The SQLite found in the desktop client was upload/download task storage, not evidence of the NAS film database.

## Stutter is not diagnosed

The user reports sluggishness. Existing evidence does not attribute it to Electron, Vue, VLC, NAS transcoding or the network. Distinguish poster-scroll stutter (UI tasks, image decode/cache/render), slow search/detail (API latency/indexing), slow start (stream preparation/player setup), and video stutter (network throughput, decode/render, subtitles). Each requires different runtime measurements. The official FAQ explains source/transcode compatibility but does not identify this user's cause: https://www.zspace.cn/faq/ . No performance traces or new measurements were collected.

## Proposed independent path

Folders on local disk or OS-readable shares -> cancellable background incremental scanner -> local metadata/index -> virtualized poster/detail UI -> main-owned libmpv direct file playback. Local database stores watched state, resume positions, chosen tracks and app-only metadata overrides. Keep original media/NFO/artwork read-only by default. Do not require cloud accounts, ZSpace SDK/token, NAS API, online scraping or NAS transcoding for the basic path.

Reuse Electron/preload/UI components, main-owned libmpv, playback controls and bounded image-cache ideas. Replace NAS-owned library/identity/history with file identities and local persistence. A disconnected share must show offline status, not trigger deletion of previously indexed items. Reconcile incremental changes; do not recursively traverse shares or probe every video on every startup. Keep scanning and thumbnail work out of the UI thread and bound concurrency/cache size. These are proposed design constraints, not measured performance claims.

## Important limits

NFO/artwork can provide portable metadata but are not guaranteed complete or uniform. Existing server-only corrections/history may not be recoverable from those files. Independent resume works on this machine; cross-device history requires a separate sync design. SMB can still require operating-system authentication even though this app has no account. Using local files does not ensure every codec plays smoothly; direct playback shifts decode responsibility to the PC. No smaller package size is implied by replacing the library backend.
