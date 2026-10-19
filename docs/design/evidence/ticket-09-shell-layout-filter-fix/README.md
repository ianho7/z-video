# Ticket #9 filter and poster-grid layout evidence

基线是候选 commit `3f2420e`，工作分支为 `codex/ticket-09-shell-layout`。
本轮只修复 `ui/app_window.slint` 的片库筛选/排序行和网格布局约束；搜索、详情、返回、续播和筛选回调未改。
fixture 使用脱敏的 9 张海报，不连接 NAS，也不保存用户媒体路径。

## Root cause and fix

片库 ScrollView 的内容 `VerticalLayout` 使用默认 `alignment: stretch`。在窗口变大时，筛选/排序行和未限定最大高度的网格都可能吸收 viewport 剩余高度：按钮被拉成数百 logical px，网格随后落到窗口底部。

修复包括：

- 筛选/排序行固定为 `ShellTheme.control_height = 32px`，并设置 `vertical-stretch: 0`；8 个按钮也固定为同一 logical 高度。
- 片库 ScrollView 内容改为 `alignment: start`，让网格按自己的行高从标题下方连续排列。
- 网格保留动态列数、`spacing = 14px` 和 `PosterCard` 的 `card_width * 1.5 + 48px` 高度；没有改业务回调。

## Logical geometry

以下 bounds 来自同一 probe 的 logical shell 约束；筛选/排序行的高度来自实际 Slint token binding，PNG 尺寸来自 Win32/fixture 输出。

| Logical client | Shell content | Filter/sort row | Columns | Card width / height | PNG at 125% |
| --- | --- | --- | --- | --- | --- |
| 1040x720 | `220,64 820x656` | `x=252, h=32` | 5 | `140 x 258` | 1300x900 |
| 1440x900 | `220,64 1220x836` | `x=252, h=32` | 7 | `153.14 x 277.71` | 1800x1125 |
| 2560x1351 | `220,64 2340x1287` | `x=252, h=32` | 12 | `176.83 x 313.25` | 3200x1689 |

The grid uses 2 rows at 1040x720 and 1440x900, and 1 row at 2560x1351 for the 9-item fixture. The poster frame remains 2:3; the extra 48px is the existing title/year metadata area.

## Commands and observations

The build used the D: caches requested for this worktree:

```powershell
$env:CARGO_TARGET_DIR = 'D:\project\z-video\.build-cache\ticket-09-shell-layout'
$env:TEMP = 'D:\project\z-video\.tmp\ticket-09-shell-layout-short'
$env:TMP = $env:TEMP
$env:SLINT_BACKEND = 'winit-skia'
$env:SLINT_SCALE_FACTOR = '1.25'

cargo check --offline
cargo build --offline --bin poster_grid_preview
cargo test --offline --test media_library_integration_test -- --test-threads=1
git diff --check
```

Each screenshot used the existing probe, with the default run omitting `-MaterialEvidence` and the opaque run adding `-ReducedTransparency`:

```powershell
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\docs\design\evidence\ticket-09\probe-native-window.ps1' `
  -Executable 'D:\project\z-video\.build-cache\ticket-09-shell-layout\debug\poster_grid_preview.exe' `
  -Output '.\docs\design\evidence\ticket-09-shell-layout-filter-fix\skia-2560x1351.png' `
  -LogicalWidth 2560 -LogicalHeight 1351 -ScalePercent 125 -HoldMs 900
```

The same command was run for all three sizes and for the fallback variant. All six runs reported `DPI=120`, `material_evidence=False`, `HasExited=True`, `exit_code=unavailable`, and `poster preview saved`:

| Mode | 1040x720 | 1440x900 | 2560x1351 |
| --- | --- | --- | --- |
| Default Skia | [skia-1040x720.png](skia-1040x720.png) | [skia-1440x900.png](skia-1440x900.png) | [skia-2560x1351.png](skia-2560x1351.png) |
| Opaque fallback | [opaque-1040x720.png](opaque-1040x720.png) | [opaque-1440x900.png](opaque-1440x900.png) | [opaque-2560x1351.png](opaque-2560x1351.png) |

Visual inspection shows the filter/sort controls remain a short, centered row in all sizes. The 2560x1351 screenshot places the poster row directly below the classification title instead of at the bottom of the viewport. Default Skia retains the product atmosphere under the glass layers; opaque fallback keeps the same geometry with opaque sidebar/toolbar surfaces.

## Validation boundary

- `cargo check --offline`: passed; one pre-existing `build_collection_list_form` dead-code warning.
- `cargo build --offline --bin poster_grid_preview`: passed.
- `cargo test --offline --test media_library_integration_test -- --test-threads=1`: passed, `1 passed; 0 failed`.
- `git diff --check`: passed.
- `Process.ExitCode` is unavailable in this PowerShell `Start-Process` harness, so no numeric exit code is claimed.
- This evidence does not establish macOS/Linux layout, real system accessibility detection, performance ratios, or video-frame blur.
