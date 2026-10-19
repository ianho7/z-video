param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [Parameter(Mandatory = $true)]
    [string]$Output,
    [int]$LogicalWidth = 1440,
    [int]$LogicalHeight = 900,
    [ValidateSet(100, 125, 150)]
    [int]$ScalePercent = 125,
    [int]$HoldMs = 1800,
    [switch]$ReducedTransparency,
    [switch]$MaterialEvidence
)

$ErrorActionPreference = 'Stop'
$probeSource = @"
using System;
using System.Runtime.InteropServices;
public static class Ticket09NativeWindowProbe
{
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);
}
"@
$probeType = Add-Type -PassThru -TypeDefinition $probeSource
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$outputPath = [System.IO.Path]::GetFullPath($Output)
$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$workingDirectory = Split-Path -Parent $executablePath
$logDirectory = Join-Path ([System.IO.Path]::GetTempPath()) 'ticket-09-skia-probe'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logStem = Join-Path $logDirectory ([System.Guid]::NewGuid().ToString('N'))
$stderrPath = "$logStem.stderr.log"
$stdoutPath = "$logStem.stdout.log"

$oldBackend = $env:SLINT_BACKEND
$oldScale = $env:SLINT_SCALE_FACTOR
$oldReduced = $env:Z_VIDEO_REDUCED_TRANSPARENCY
$oldHighContrast = $env:Z_VIDEO_HIGH_CONTRAST
try {
    $env:SLINT_BACKEND = 'winit-skia'
    $env:SLINT_SCALE_FACTOR = ($ScalePercent / 100).ToString([System.Globalization.CultureInfo]::InvariantCulture)
    if ($ReducedTransparency) {
        $env:Z_VIDEO_REDUCED_TRANSPARENCY = '1'
        Remove-Item Env:Z_VIDEO_HIGH_CONTRAST -ErrorAction SilentlyContinue
    } else {
        Remove-Item Env:Z_VIDEO_REDUCED_TRANSPARENCY -ErrorAction SilentlyContinue
        Remove-Item Env:Z_VIDEO_HIGH_CONTRAST -ErrorAction SilentlyContinue
    }

    $arguments = @(
        '--width', "$LogicalWidth",
        '--height', "$LogicalHeight",
        '--output', $outputPath,
        '--hold-ms', "$HoldMs"
    )
    if ($MaterialEvidence) {
        $arguments += '--material-evidence'
    }
    $process = Start-Process -FilePath $executablePath `
        -ArgumentList $arguments `
        -WorkingDirectory $workingDirectory `
        -RedirectStandardError $stderrPath `
        -RedirectStandardOutput $stdoutPath `
        -PassThru

    $windowHandle = [IntPtr]::Zero
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 100
        $process.Refresh()
        if ($process.MainWindowHandle -ne 0) {
            $windowHandle = $process.MainWindowHandle
            break
        }
    }

    if ($windowHandle -eq [IntPtr]::Zero) {
        Write-Output "dpi=unknown source=GetDpiForWindow hwnd=0 logical=${LogicalWidth}x${LogicalHeight} scale_override=${ScalePercent}%"
    } else {
        $dpi = $probeType::GetDpiForWindow($windowHandle)
        $physicalWidth = [Math]::Round($LogicalWidth * $dpi / 96.0)
        $physicalHeight = [Math]::Round($LogicalHeight * $dpi / 96.0)
        Write-Output "dpi=$dpi source=GetDpiForWindow hwnd=$windowHandle logical=${LogicalWidth}x${LogicalHeight} physical=${physicalWidth}x${physicalHeight} scale_override=${ScalePercent}%"
    }

    $sidebarWidth = 220
    $toolbarHeight = 64
    $contentWidth = [Math]::Max(0, $LogicalWidth - $sidebarWidth)
    $contentHeight = [Math]::Max(0, $LogicalHeight - $toolbarHeight)
    $innerX = $sidebarWidth + 32
    $innerWidth = [Math]::Max(0, $contentWidth - 64)
    Write-Output "layout_bounds_logical=sidebar=0,0,${sidebarWidth}x${LogicalHeight};toolbar=${sidebarWidth},0,${contentWidth}x${toolbarHeight};content=${sidebarWidth},${toolbarHeight},${contentWidth}x${contentHeight};grid-detail=${innerX},${toolbarHeight},${innerWidth}x${contentHeight} source=ShellTheme/sidebar-toolbar-padding"
    Write-Output "material_evidence=$MaterialEvidence"

    $process.WaitForExit()
    $process.Refresh()
    $hasExited = $process.HasExited
    $exitCode = $null
    $exitCodeReadFailed = $false
    if ($hasExited) {
        try {
            $exitCode = $process.ExitCode
        } catch {
            $exitCodeReadFailed = $true
        }
    } else {
        $exitCodeReadFailed = $true
    }
    if ($null -eq $exitCode) {
        $exitCodeReadFailed = $true
    }
    $exitDescription = if ($null -eq $exitCode) { 'unavailable' } else { "$exitCode" }
    Write-Output "exit_code=$exitDescription source=Process.ExitCode has_exited=$hasExited output=$outputPath"
    if ($exitCodeReadFailed) {
        Write-Output 'exit_code_read=unavailable'
    }
    if (Test-Path -LiteralPath $stderrPath) {
        Get-Content -LiteralPath $stderrPath
    }
    if (Test-Path -LiteralPath $stdoutPath) {
        Get-Content -LiteralPath $stdoutPath
    }
    if (($null -ne $exitCode) -and ([int]$exitCode -ne 0)) {
        throw "fixture exited with code $exitCode"
    }
}
finally {
    if ($null -eq $oldBackend) { Remove-Item Env:SLINT_BACKEND -ErrorAction SilentlyContinue } else { $env:SLINT_BACKEND = $oldBackend }
    if ($null -eq $oldScale) { Remove-Item Env:SLINT_SCALE_FACTOR -ErrorAction SilentlyContinue } else { $env:SLINT_SCALE_FACTOR = $oldScale }
    if ($null -eq $oldReduced) { Remove-Item Env:Z_VIDEO_REDUCED_TRANSPARENCY -ErrorAction SilentlyContinue } else { $env:Z_VIDEO_REDUCED_TRANSPARENCY = $oldReduced }
    if ($null -eq $oldHighContrast) { Remove-Item Env:Z_VIDEO_HIGH_CONTRAST -ErrorAction SilentlyContinue } else { $env:Z_VIDEO_HIGH_CONTRAST = $oldHighContrast }
}
