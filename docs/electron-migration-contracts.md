# Electron migration contracts

Status: ticket 01, contract version 1, 2026-10-30.

These contracts are the hand-off boundary between the login/session ticket and
the independent library and native-player tickets. They describe ownership;
they do not claim that the later features already exist.

## Runtime ownership

| Area | Owner | Contract boundary |
| --- | --- | --- |
| NAS protocol | `src/main/nas-client.ts` | Raw HTTP, RSA credential encryption, response validation, `token`, `nasId` and `nasSign` separation. Renderer never calls NAS. |
| Session lifecycle | `src/main/session-controller.ts` | Login, MFA pending state, classification refresh, 401/403 invalidation, and renderer-safe `PublicSessionState`. |
| Secure persistence | `src/main/secure-session-store.ts` | Electron `safeStorage` DPAPI-encrypted session blob. The replacement does not import old keyring entries and does not persist the password. |
| Diagnostics | `src/main/diagnostics.ts` | Secret-free JSONL request receipts under `%LOCALAPPDATA%\z-video\logs\diagnostics.jsonl`; `Z_VIDEO_LOG_DIR` is a diagnostic-only override. |
| IPC validation | `src/main/ipc.ts` | Main-process runtime validation of untrusted renderer arguments and channel ownership. |
| Preload bridge | `src/preload/preload.ts` | The only renderer capability surface. `contextIsolation`, `sandbox`, and `nodeIntegration: false` are required. |
| Presentation | `src/renderer/renderer.ts` and `src/renderer/index.html` | DOM state, form inputs, focus and visual states. It owns no token, sign, password persistence, NAS URL fetch, or media URI. |

The sandboxed preload keeps a literal copy of the channel names because a
sandboxed preload cannot load local CommonJS modules. The canonical names are
also recorded in `src/shared/ipc-channels.ts`; any channel change must update
both files and `src/main/ipc.ts` in one change.

## Shared renderer-safe types

`src/shared/contracts.ts` is the stable type owner:

- `Classification` is a visible navigation item after main-process filtering.
- `Collection` is a title-level card DTO.
- `Episode` is a renderer-safe selection DTO. It uses `episodeId`, not a
  private NAS `file_path`.
- `LibraryQuery` and `NavigationContext` carry pagination, search, detail
  source context and scroll restoration without session material.
- `PlaybackCommand` is the renderer-to-main intent contract. `open` identifies
  a collection/classification/episode and may carry a resume position; it does
  not carry a server URL or media address.
- `PlaybackEvent` is the main-to-renderer state contract for loading, ready,
  playback state, position, tracks, failure and close.

Ticket 02 owns mapping NAS collection/detail responses into `Collection` and
`Episode`, pagination/cache policy and library navigation state. It may extend
the IPC surface only with a reviewed contract addition; it must not move raw
NAS session credentials into the renderer.

Ticket 03 owns the one native playback engine behind `PlaybackCommand` and
`PlaybackEvent`. Main resolves the selected `episodeId` to a server-provided
stream and keeps the private media address out of renderer DTOs and logs.

Ticket 03 adds the `player:choose-local-file`, `player:choose-subtitle-file`,
`player:command` and `player:event` channels. The preload exposes these as
`window.zVideo.player`; the renderer can request a main-owned media/subtitle
file picker, send validated playback intent, and subscribe to renderer-safe
`PlaybackEvent` values. The selected file paths remain in main and are
consumed by the libmpv adapter only. The
current local-sample route uses a Win32 child host (`wid`) inside the existing
BrowserWindow, with a semantic HTML control strip immediately below the native
surface. Controls are keyboard/accessibility usable, but HTML controls are not
painted over the native child surface; that visual-parity gap is explicit while
the feasibility note's Windows shared-texture compositor route remains only a
candidate pending independent runtime proof. The main-owned subtitle picker
also keeps external subtitle paths out of the renderer.

## Ticket 02 additions

Ticket 02 adds the following renderer-safe library operations through the
preload bridge: `listCollections`, `getDetail`, `listContinueWatching`,
`loadImage`, `getNavigation` and `setNavigation`. Collection and detail DTOs
contain opaque collection/image keys, normalized numeric/string metadata,
episodes and an optional positive resume position; they do not contain token,
`nas_sign`, private `file_path` values or media URIs. Images are fetched by the
main process and returned as bounded, renderer-local data URLs.

Search, type filtering and title/score/release-year sorting are declared as
`loaded-page` scope when applied locally. The UI must show that scope instead
of presenting a single paginated response as a full-library result. Continue-watching entries
come only from cached detail responses with matching positive NAS history; the
library controller does not poll every collection for progress.

## Commands

From the repository root:

```powershell
npm install
npm run typecheck
npm test
npm run test:window
npm start
```

`npm test` runs the compiled NAS, controller and secure-storage owner tests in
one Node process. `npm run test:window` launches a real Electron
`BrowserWindow` against a local IPC fixture; it proves isolation and DOM/IPC
interaction, not live NAS compatibility. `npm start` launches the actual
single-window application and requires a user-entered NAS address and
credentials.
