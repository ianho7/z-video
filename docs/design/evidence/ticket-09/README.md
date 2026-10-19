# Ticket #9 Skia backdrop-blur evidence

状态：正式实现候选，Windows 原生证据已取得；尚未合并或推送。

## 依赖与平台边界

- 实际使用的 Slint 与 `slint-build` git rev：`0ade85bfd0a88b6de2f87f767420975f98c141d0`，两者保持同一 rev。
- 已核对的 upstream 关系：PR #13821 的 merge commit 是 `e492aa7`；本候选使用的 `0ade85b...` 是其后仍包含该功能的 upstream rev。
- Rust 前提：`rustc/cargo 1.99.1`，Windows MSVC host。Rust 1.18.1 线不能解析 `backdrop-blur`，所以不能用稳定 1.18.1 作为这次候选的编译基线。
- Windows Cargo features：`default-features=false`，显式启用 `compat-1-2`、`accessibility`、`backend-winit`、`renderer-skia` 和 `raw-window-handle-06`；正式窗口由 `SLINT_BACKEND=winit-skia` 选择 Skia。
- 非 Windows 使用同一 git compiler rev，但保留 Slint 默认 renderer features；本机没有运行非 Windows 构建或截图，不能把 Skia 或该 UI 声明为跨平台已验证。

## 实现边界

`backdrop-blur` 只出现在 AppleWorkspace 的侧栏和工具栏。海报网格、卡片、详情页和视频区域没有加入 blur。窗口级 Mica/DWM 特效也不属于本候选。

应用启动时，如果 `Z_VIDEO_REDUCED_TRANSPARENCY=1` 或 `Z_VIDEO_HIGH_CONTRAST=1`，会将 `reduced_transparency` 传入 Slint；侧栏和工具栏使用不透明 surface，并将 `backdrop-blur` 设为 `0px`。这条分支是当前可观察的低透明度/高对比回退，不代表已完成系统级无障碍设置探测。

## 构建与截图命令

构建和运行使用 D 盘专用目录，避免把 Rust 临时文件写入 C 盘：

```powershell
$env:CARGO_TARGET_DIR = 'D:\project\z-video\.build-cache\ticket-09-skia-implementation'
$env:TEMP = 'D:\project\z-video\.tmp\ticket-09-skia'
$env:TMP = 'D:\project\z-video\.tmp\ticket-09-skia'
$env:CARGO_BUILD_JOBS = '2'
```

同一 fixture、同一 logical viewport 的 Skia 和 opaque fallback 命令：

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -ExecutionPolicy Bypass -File '.\docs\design\evidence\ticket-09\probe-native-window.ps1' `
  -Executable 'D:\project\z-video\.build-cache\ticket-09-skia-implementation\debug\poster_grid_preview.exe' `
  -Output '.\docs\design\evidence\ticket-09\skia-library-1440x900-125.png' `
  -LogicalWidth 1440 -LogicalHeight 900 -ScalePercent 125 -HoldMs 1800

& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -ExecutionPolicy Bypass -File '.\docs\design\evidence\ticket-09\probe-native-window.ps1' `
  -Executable 'D:\project\z-video\.build-cache\ticket-09-skia-implementation\debug\poster_grid_preview.exe' `
  -Output '.\docs\design\evidence\ticket-09\opaque-fallback-1440x900-125.png' `
  -LogicalWidth 1440 -LogicalHeight 900 -ScalePercent 125 -HoldMs 1800 -ReducedTransparency
```

`probe-native-window.ps1` 通过 Win32 `GetDpiForWindow` 读取窗口 DPI，并同时保留 fixture 自己的 `Window::take_snapshot()` 尺寸日志。PowerShell 的 GUI `Process.ExitCode` 在本机该 fixture 上没有返回数值；两次进程均报告 `HasExited=True`，stderr 均报告 `poster preview saved`，目标文件存在且尺寸符合预期。这个 exit-code 读取限制属于 harness 未知项。

## 观测结果

| 状态 | renderer 选择 | logical 窗口 | PNG physical | DPI 来源/值 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 默认玻璃层 | `renderer-skia` + `SLINT_BACKEND=winit-skia` | 1440x900 | 1800x1125 | `GetDpiForWindow=120`，`SLINT_SCALE_FACTOR=1.25` | [skia-library-1440x900-125.png](skia-library-1440x900-125.png) |
| 不透明回退 | 同一 `renderer-skia`，`Z_VIDEO_REDUCED_TRANSPARENCY=1` | 1440x900 | 1800x1125 | `GetDpiForWindow=120`，`SLINT_SCALE_FACTOR=1.25` | [opaque-fallback-1440x900-125.png](opaque-fallback-1440x900-125.png) |

两张图都由同一 `poster_grid_preview.exe`、同一脱敏海报 fixture 和同一窗口尺寸生成。默认图的侧栏/工具栏走 blur 分支，网格保持锐利；回退图的侧栏/工具栏显示不透明 surface。效果判定基于当前 Skia renderer、Slint 属性和对照截图；本记录不写性能比例，也不把截图耗时当成性能结论。

## 验证边界、未知项与回滚

已验证：Windows 原生窗口、Slint git compiler、Skia renderer、侧栏/工具栏 blur 属性、低透明度不透明回退、accessibility feature 保留、125% effective DPI 下的 1440x900 logical fixture。

未验证：macOS/Linux 运行、非 Windows renderer、`renderer-skia-software`、真实视频帧下的 blur、系统高对比度/系统透明度设置自动探测、GPU/VRAM/启动或滚动性能比例、真实 NAS 播放流程。以上都不能从本次 fixture 快照推断。

回滚候选 commit 即可撤销这次 renderer/UI 变更。若回退到 Slint 1.18.1，还必须同时移除 `.slint` 中的 `backdrop-blur` 语法和 git-only compiler 配置；只替换 Cargo 版本会导致编译器无法解析当前 UI。
