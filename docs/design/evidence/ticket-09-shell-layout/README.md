# Ticket #9 shell layout follow-up evidence

基线是集成 HEAD `9b42d76a7778ee36f55984c8c76b6cedbb0325f2`，工作分支为
`codex/ticket-09-shell-layout`。截图使用真实 `AppCoordinator`、
`AppWindow` 和脱敏 `poster_grid_preview` fixture；不连接 NAS，也不包含私人媒体。

## Root cause and product change

正式 `AppleWorkspace` 的层级是一个 logical client area：

- `AppWindow` preferred size 是 `1040x720`，最小尺寸是 `900x640`；
- `AppleWorkspace` 的 `HorizontalLayout` 先放 `ShellTheme.sidebar_width=220px` 的侧栏，
  再放可伸缩 main column；
- main column 的 toolbar 高度来自 `ShellTheme.toolbar_height=64px`，其余高度给
  library/detail `ScrollView`；
- library/detail 的左右 padding 各为 `32px`，所以内层宽度是
  `window_width - sidebar_width - 64px`。

旧网格直接从根宽度在表达式中重复推导这条关系，响应式约束不够明确；候选现在把它
收敛为 `shell_content_width`，仍然只使用 logical 尺寸，且不依赖布局产出的宽度，避免
Slint binding loop 和物理像素重复缩放。

正式默认 shell 新增 `ShellAtmosphere`：三个低对比、固定比例的静态背景块和一条弱边界，
位于 sidebar/toolbar 玻璃层之下，为 `backdrop-blur` 提供真实采样内容。它不是
`MaterialEvidenceBackdrop`，也不含七色验证条带；网格、卡片、详情和视频仍保持锐利。
`Z_VIDEO_REDUCED_TRANSPARENCY=1` 或 `Z_VIDEO_HIGH_CONTRAST=1` 时，侧栏/工具栏仍回退
为不透明 surface 并关闭 blur。

## Logical bounds

`probe-native-window.ps1` 输出的 `layout_bounds_logical` 与上述 UI token 对齐；它记录
的是 shell 的 logical 约束，窗口 DPI 和 PNG physical size 另由 Win32/fixture 输出记录。

| Logical client | Sidebar | Toolbar | Content | Grid/detail inner | 125% PNG | Grid columns/card width |
| --- | --- | --- | --- | --- | --- | --- |
| 1040x720 | `0,0 220x720` | `220,0 820x64` | `220,64 820x656` | `252,64 756x656` | 1300x900 | 5 / 140px |
| 1440x900 | `0,0 220x900` | `220,0 1220x64` | `220,64 1220x836` | `252,64 1156x836` | 1800x1125 | 7 / 153.14px |
| 2560x1351 | `0,0 220x1351` | `220,0 2340x64` | `220,64 2340x1287` | `252,64 2276x1287` | 3200x1689* | 12 / 176.83px |

`*` 2560x1351×1.25 的高度按 PNG 四舍五入为 1689；实际输出以 fixture 日志为准。
Sidebar/toolbar/content 坐标和 grid/detail 内宽均为 logical，不能直接当 Win32 physical
坐标使用。

## Commands and output

```powershell
$env:CARGO_TARGET_DIR = 'D:\project\z-video\.build-cache\ticket-09-shell-layout'
$env:TEMP = 'D:\project\z-video\.tmp\ticket-09-shell-layout-short'
$env:TMP = $env:TEMP
$env:SLINT_SCALE_FACTOR = '1.25'

$exe = 'D:\project\z-video\.build-cache\ticket-09-shell-layout\debug\poster_grid_preview.exe'
$probe = '.\docs\design\evidence\ticket-09\probe-native-window.ps1'

# Default product underlay; do not pass -MaterialEvidence.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -Executable $exe -Output '.\docs\design\evidence\ticket-09-shell-layout\skia-1040x720.png' -LogicalWidth 1040 -LogicalHeight 720 -ScalePercent 125 -HoldMs 1800
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -Executable $exe -Output '.\docs\design\evidence\ticket-09-shell-layout\skia-1440x900.png' -LogicalWidth 1440 -LogicalHeight 900 -ScalePercent 125 -HoldMs 1800
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -Executable $exe -Output '.\docs\design\evidence\ticket-09-shell-layout\skia-2560x1351.png' -LogicalWidth 2560 -LogicalHeight 1351 -ScalePercent 125 -HoldMs 1800

# Opaque fallback with the same neutral fixture and dimensions.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -Executable $exe -Output '.\docs\design\evidence\ticket-09-shell-layout\opaque-1040x720.png' -LogicalWidth 1040 -LogicalHeight 720 -ScalePercent 125 -HoldMs 1800 -ReducedTransparency
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -Executable $exe -Output '.\docs\design\evidence\ticket-09-shell-layout\opaque-1440x900.png' -LogicalWidth 1440 -LogicalHeight 900 -ScalePercent 125 -HoldMs 1800 -ReducedTransparency
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -Executable $exe -Output '.\docs\design\evidence\ticket-09-shell-layout\opaque-2560x1351.png' -LogicalWidth 2560 -LogicalHeight 1351 -ScalePercent 125 -HoldMs 1800 -ReducedTransparency
```

| Mode | 1040x720 | 1440x900 | 2560x1351 |
| --- | --- | --- | --- |
| Default Skia | [skia-1040x720.png](skia-1040x720.png) | [skia-1440x900.png](skia-1440x900.png) | [skia-2560x1351.png](skia-2560x1351.png) |
| Opaque fallback | [opaque-1040x720.png](opaque-1040x720.png) | [opaque-1440x900.png](opaque-1440x900.png) | [opaque-2560x1351.png](opaque-2560x1351.png) |

The probe's default mode clears both transparency environment variables; fallback only sets
`Z_VIDEO_REDUCED_TRANSPARENCY=1` and restores the caller environment in `finally`. The legacy
`ticket-09` evidence keeps `-MaterialEvidence` explicit so its seven-colour renderer proof is
separate from these product screenshots.

## Observed run

All six runs used `SLINT_BACKEND=winit-skia`, `SLINT_SCALE_FACTOR=1.25`, the same built
`poster_grid_preview.exe`, and `HoldMs=1800`. Each stderr contained `poster preview saved` and
the following probe facts:

| Mode | Logical | PNG physical | DPI | `material_evidence` | Exit observation |
| --- | --- | --- | --- | --- | --- |
| Default | 1040x720 / 1440x900 / 2560x1351 | 1300x900 / 1800x1125 / 3200x1689 | 120 for all | `False` | `HasExited=True`, `exit_code=unavailable` |
| Opaque fallback | 1040x720 / 1440x900 / 2560x1351 | 1300x900 / 1800x1125 / 3200x1689 | 120 for all | `False` | `HasExited=True`, `exit_code=unavailable` |

The probe reports `layout_bounds_logical` for every run. The default images show the low-contrast
product atmosphere beneath the translucent sidebar/toolbar; fallback images keep that atmosphere
behind the shell but make those two surfaces opaque. The grid cards and content remain sharp in
both modes. `Process.ExitCode` remains unavailable in this PowerShell `Start-Process` harness, so
the evidence does not claim a numeric exit code.

Validation from this worktree:

```text
cargo check                       passed (one pre-existing dead_code warning)
cargo build --offline --bin poster_grid_preview
                                    passed (one pre-existing dead_code warning)
cargo test --offline --test media_library_integration_test -- --test-threads=1
                                    1 passed, 0 failed
git diff --check                  passed
```

## Boundary

This evidence checks Windows logical layout, effective DPI, Skia default glass, and the opaque
fallback. It does not establish macOS/Linux renderer behavior, system accessibility setting
detection, real video-frame blur, or any performance/resource percentage.
