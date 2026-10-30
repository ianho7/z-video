# Electron native player feasibility

Status: read-only preparation for ticket 03, 2026-10-30. No media was launched, no NAS or credentials were accessed, and no implementation was changed by this note.

## Recommendation

The best candidate for the strict requirement—one Electron window, accessible HTML controls over the video, and no CPU readback per video frame—is:

```text
libmpv D3D11 render API
  -> native addon creates a shared D3D11 BGRA/RGBA texture and NT handle
  -> Electron main sharedTexture.importSharedTexture()
  -> sharedTexture.sendSharedTexture()
  -> sandboxed preload receiver -> renderer VideoFrame/WebGPU canvas
  -> semantic HTML controls remain above the canvas
```

This is technically viable from the public API surface, but it is not the smallest *unproven* change. The native addon must own D3D11 device/render-target creation, libmpv render callbacks, NT-handle export, GPU synchronization, texture pooling, resize/DPI, and release callbacks. Treat it as a bounded Windows spike before committing ticket 03 to this route.

The smallest functional fallback is the existing `libmpv wid`/Win32 child-window route with an immediately adjacent HTML control strip. That should be recorded as a visual-parity gap: it can prove playback and commands, but it does not silently satisfy the requirement that controls overlay the video.

## Existing repository evidence

- The migration requires one native engine, asynchronous media work, and no CPU copy of every frame: `docs/electron-migration-spec.md:36-43`.
- Ticket 03 requires libmpv inside the app, pause/seek/audio/subtitle/fullscreen, resize/DPI, observable load failure, resource cleanup, stale-event isolation, and a real Windows window: `.scratch/electron-migration/issues/03-native-player.md:3-15`.
- ADR 0003 permits necessary native player glue but rules out a permanent Rust service behind Electron: `docs/adr/0003-electron-typescript.md:3-9`.
- The current Rust backend already configures `vo=gpu`, `gpu-api=d3d11`, `hwdec=auto-safe`, and optional `wid`: `src/player/mpv_backend.rs:54-93`. Its current wrapper exposes classic client commands/properties and `wid`, not the libmpv render API: `src/player/mpv_backend.rs:263-345`; `src/player/mpv_sys.rs:39-194`.
- The current Win32 surface is a `WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN` child of the top-level window, resized with `SetWindowPos(... SWP_NOZORDER ...)`: `src/platform/windows.rs:218-306`. Electron can reproduce this through a native addon, but this does not establish renderer z-order or HTML hit testing.
- Rust currently computes video geometry from Slint logical units multiplied by the scale factor and attaches the child to the parent HWND: `src/app.rs:4477-4525`.
- Slint declares a full OSD panel, slider, and buttons over `video_container`: `ui/app_window.slint:3070-3250`. This is only a declaration in the renderer tree; because the video is a separate native child HWND, it is not evidence that the overlay actually painted above the video or received input.
- The 01 draft contract already contains `open`, play/pause/seek, audio track, subtitle/off, fullscreen, and episode-correlated events: `.worktrees/electron-01/src/shared/contracts.ts:96-119`.
- The visible 01 draft still declares Electron `^36.0.0`: `.worktrees/electron-01/package.json:13-16`. The sharedTexture documentation is based on Electron 37, and the current official stable line is newer; choose and record a minimum version before depending on this API.

## SharedTexture route: evidence and limits

Electron's current experimental `sharedTexture` API imports an external texture description in the main process and converts it to a `VideoFrame`; main can transfer it to a renderer receiver. The import structure accepts `bgra`, `rgba`, and `rgbaf16`, and Windows uses an `ntHandle`:

- [Electron `sharedTexture` API](https://www.electronjs.org/docs/latest/api/shared-texture)
- [SharedTextureImportTextureInfo](https://www.electronjs.org/docs/latest/api/structures/shared-texture-import-texture-info)
- [SharedTextureHandle](https://www.electronjs.org/docs/latest/api/structures/shared-texture-handle)
- [Electron sharedTexture design notes](https://github.com/electron/electron/blob/main/shell/common/api/shared_texture/README.md)

The official Electron test demonstrates the managed path: import, send to another process, obtain a `VideoFrame`, render it with WebGPU, then release it after GPU use. It also demonstrates the required release/lifetime ordering: [api-shared-texture.spec.ts](https://github.com/electron/electron/blob/main/spec/api-shared-texture.spec.ts#L1079-L1218), [managed preload](https://raw.githubusercontent.com/electron/electron/main/spec/fixtures/api/shared-texture/managed/preload.js), [managed renderer](https://raw.githubusercontent.com/electron/electron/main/spec/fixtures/api/shared-texture/common.js#L35-L154).

The corresponding mpv D3D11 API can render into a caller-owned `ID3D11Texture2D`; supported formats include BGRA/RGBA/R10/R16F and no sRGB formats. The caller presents or shares the texture: [mpv `render_d3d11.h`](https://github.com/mpv-player/mpv/blob/master/include/mpv/render_d3d11.h#L463-L606).

The gap is integration evidence, not API shape:

1. The addon must create an NT-handle-capable D3D11 render target, render libmpv into it, and hand the handle to Electron main without closing or reusing it early.
2. libmpv rendering and Electron's GPU process are asynchronous. The design notes require explicit ownership and release coordination; use a small texture pool and `allReferencesReleased`/`release()` or the subtle sync-token path. Do not overwrite a texture while the renderer may still sample it.
3. The Electron upstream sharedTexture spec currently gates its runnable test to macOS arm64 (`process.platform !== 'darwin' || process.arch !== 'arm64'` in the linked test). The API documents Windows handles, but that is not Windows acceptance evidence for this project.
4. WebGPU is the clearest no-CPU-readback renderer (`device.importExternalTexture({ source: frame })`). A 2D canvas fallback may be useful, but its actual Windows GPU path must be measured rather than assumed.
5. `sharedTexture` is experimental. A version upgrade, GPU/driver failure, API removal, or handle-lifetime bug needs an observable fallback/error state.

This route avoids a native child HWND entirely: the video is a DOM canvas, so semantic HTML controls can be above it and remain keyboard/ARIA accessible. It still requires native glue for libmpv/D3D11 and is materially more machinery than `wid` embedding.

## WID fallback and visual-parity gap

The WID route remains useful as a first functional baseline:

- Native addon obtains the Electron window HWND, creates one child host, sets `wid` before libmpv initialization, and exposes the existing command/event boundary.
- It is likely the shortest path to local sample playback, seek, tracks, fullscreen, and cleanup.
- It does **not** prove HTML controls over the video. The child HWND may paint above Chromium content or consume pointer/focus events. If controls are placed immediately below/beside the native rectangle, mark the result as “functional baseline; visual parity gap,” not complete overlay acceptance.

Do not use a separate player window; ticket 03 explicitly rejects it. Do not use `NativeImage.toBitmap()` or CPU OSR frames for the player because those paths violate the per-frame CPU-copy requirement.

## Suggested spike acceptance

1. On Windows, use a static D3D11 shared texture to prove `sharedTexture.importSharedTexture` -> `sendSharedTexture` -> renderer WebGPU canvas, including release ordering.
2. Replace the static texture with a local libmpv sample rendered through `mpv_render_context` and verify frame cadence, resize/DPI, and shutdown.
3. Add the semantic control overlay and verify mouse, keyboard focus, seek, track selection, fullscreen, and stale-session rejection.
4. Record actual Electron/libmpv/decoder/GPU evidence. If the shared-texture spike fails, keep the WID route plus adjacent HTML control strip as the explicitly labelled fallback.

No current repository or upstream evidence proves the full Windows libmpv shared-texture path yet; the first two spike steps are required before claiming ticket 03 acceptance.
