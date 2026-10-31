# Ticket 04 completion record: NAS playback, progress and restart resume

Status: implementation complete on `codex/electron-04`; local owner contracts
and Windows real-window/local-HTTP playback evidence pass. Real NAS playback,
viewing-progress persistence and fresh-process history read-back remain pending
user-authorized LAN acceptance.

## Baseline and scope

- Branch: `codex/electron-04`.
- Integration baseline: `20c01a8` (`codex/electron-integration` was at the same
  tip before implementation).
- No Rust build, dependency download, NAS login, private credential use or NAS
  write was performed.
- Main now resolves a renderer Episode ID through fresh main-owned detail data,
  selects `file_path`/`encrypted_path`, obtains the current stream URI and hands
  the URI only to the native libmpv boundary. Local file playback keeps its
  existence check; HTTP(S) NAS sources are accepted by the native engine.
- Progress reports are main-owned, generation-scoped and flushed on replacement,
  native close and user close. They preserve chapter, audio/subtitle indexes,
  subtitle hash/settings and duration; HTTP and business success are both
  required. A 401/403 invalidates the session and pushes the login state.
- Encrypted session state may store only `collectionId`, `classificationId` and
  `episodeId` as `lastPlayback`. Position and URI are not local resume evidence;
  fresh continue-watching loads the remembered detail/history from NAS.

## Protocol and source evidence

- Execution handoff: `C:/Users/admin/.codex/visualizations/2026/10/30/01a18d67-6765-7dc0-8bd1-47ac85ca8f26/nas-playback-handoff.md`.
- Rust owner references: `src/nas/client.rs` playback stream/progress methods,
  `src/nas/models.rs` Episode/history fields and `src/playback.rs` progress
  payload shape.
- Static/runtime boundary: `reference/player-api.md`,
  `reference/protocol-ledger.md`, `reference/runtime-desktop-app-2026-10-16.md`.
- Updated shape fixture: `tests/fixtures/protocol/playback-response-shape.json`.
  It contains field types and TypeScript owner pointers only; no URI, token,
  Cookie or private media path value.

## Local verification

| Command/procedure | Result | Evidence boundary |
| --- | --- | --- |
| TypeScript main/tests and renderer `tsc --noEmit` with existing Electron 45/Koffi 3.3.5 runtimes from `electron-01`/`electron-03` | pass | Type safety; no dependency install. |
| `node scripts/run-tests.mjs` under normal Windows permissions with `NODE_PATH` pointing at existing runtimes | pass, **39/39** | NAS HTTP owner contracts, secure IDs-only storage, coordinator generation/progress, library history rebuild. Local fixture, not live NAS. |
| `C:\Users\admin\scoop\apps\python\current\python.exe scripts/check_protocol_contracts.py` | pass | Ledger and 5 shape-only fixtures are structurally safe. |
| Real Electron `dist/tests/nas-player-window-smoke.js` with a unique temporary `userData`/`sessionData` profile before `app.whenReady`, local HTTP MP4 server, production preload/IPC/`MainPlaybackHost`/libmpv | pass | Native window consumed a main-owned HTTP URI and close flushed synthetic progress identity. It does not prove NAS stream issuance or NAS persistence. Electron emitted existing cache `EPERM` warnings only. |
| Existing real-window `dist/tests/window-smoke.js` | pass | Login/library/detail renderer route remains intact. |
| Existing real-native `dist/tests/player-window-smoke.js` | pass | Local file controls, seek, tracks, fullscreen and close remain intact. |
| `git diff --check` | pass | No whitespace errors. |

The first sandboxed unit run was not used as product evidence because localhost
fixture fetches and DPAPI-temp-file rename were blocked (`fetch failed`/`EPERM`).
The same tests passed under normal Windows permissions. No actual NAS address,
credential, token, Cookie, URI or private media path was written to logs or this
record.

## Remaining limits

1. A user must enter credentials on a real Windows/LAN NAS and verify the
   selected Episode's returned stream, native playback, progress response,
   process close, new-process detail/history read-back and same-Episode resume.
   That flow writes viewing progress only; no delete, restore or metadata write
   was authorized or performed here.
2. The local HTTP smoke proves the native URI seam but is not real NAS evidence;
   stream-header requirements, firmware variants, hardware decoder choice and
   full audio/subtitle server-track behavior remain unverified.
3. macOS, packaged installation/resource sizing and signed distribution remain
   outside this ticket.
