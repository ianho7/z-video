# Native client alpha probe

This probe documents the Windows-only client-alpha change. Windows attempts
the native backdrop by default; `Z_VIDEO_NATIVE_BACKDROP=0` disables it. It
does not enable the seven-colour
`MaterialEvidenceBackdrop`, read credentials, or connect to a NAS.

## Why the renderer changes

The pinned Slint `0ade85b` winit backend creates its window with
`WindowAttributes::transparent(true)`. Its Skia WGPU surface keeps alpha only
when the WGPU surface advertises `PreMultiplied` or `PostMultiplied`; otherwise
`set_transparent(true)` leaves the swapchain in its `Opaque` mode. The formal
Windows build includes both Skia WGPU and OpenGL surfaces. The explicit WGPU
fallback can therefore leave the client fully opaque even when
`DwmExtendFrameIntoClientArea` succeeds.

When the native path is enabled, the application selects `skia-opengl` through
`BackendSelector` and applies an explicit winit `transparent=true` hook before
the Slint window is created. Explicit opt-out, reduced-transparency/high-
contrast policy, or an unavailable native renderer falls back to `skia-wgpu`.

The product scene keeps the existing boundary: the left 220 logical-pixel
Sidebar may expose the top-level DWM backdrop, while the main content underlay
starts at x=220 and remains opaque. No data, authentication, playback, or
image request code is involved.

## Neutral fixture run

Use a short D: target and a neutral fixture. The preview snapshot is a Slint
surface snapshot and cannot prove what is behind the native window; external
sampling still needs the manual check below.

```powershell
$env:CARGO_TARGET_DIR = 'D:\project\z-video\.build-cache\native-backdrop-alpha-target'
$env:TEMP = 'D:\project\z-video\.build-cache\tmp'
$env:TMP = 'D:\project\z-video\.build-cache\tmp'
$env:Z_VIDEO_NATIVE_BACKDROP = '1'
$env:SLINT_BACKEND = 'winit-skia-opengl'
cargo run --offline --bin poster_grid_preview -- `
  --width 1440 --height 900 --hold-ms 5000 `
  --output 'D:\project\z-video\.build-cache\native-backdrop-alpha\neutral-1440x900.png'
```

The fixture's sidebar is 220 logical pixels wide and its content surface is
opaque. Put a neutral desktop or ordinary window behind the left side, move it
while the preview is visible, and confirm that the Sidebar changes while the
right content surface stays stable. Repeat with
`Z_VIDEO_REDUCED_TRANSPARENCY=1`; that run should use the opaque fallback.

## Evidence boundary

The code change proves the selected Slint backend, the explicit transparent
winit window attribute, and the existing DWM API calls. It does not by itself
prove that every Windows driver exposes a translucent WGL config or that the
external desktop is visible on every composition/RDP setup. A runtime
diagnostic or manual observation must record whether the OpenGL surface was
created and whether the left client pixels changed with the window behind it.
