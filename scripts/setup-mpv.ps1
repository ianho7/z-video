# scripts/setup-mpv.ps1
# Helper script to download and extract official libmpv-dev prebuilt binary for Windows x86_64

$ErrorActionPreference = "Stop"

$VendorDir = Join-Path $PSScriptRoot "..\vendor\mpv"
$ArchiveName = "mpv-dev-x86_64-20261016-git-a2cd83c56d.7z"
$DownloadUrl = "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261016/$ArchiveName"
$ArchivePath = Join-Path $PSScriptRoot "..\vendor\$ArchiveName"

if (-not (Test-Path $VendorDir)) {
    New-Item -ItemType Directory -Path $VendorDir -Force | Out-Null
}

$DllPath = Join-Path $VendorDir "libmpv-2.dll"
if (Test-Path $DllPath) {
    Write-Host "[OK] libmpv-2.dll already exists at $DllPath"
    exit 0
}

Write-Host "Downloading $DownloadUrl..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $ArchivePath

Write-Host "Extracting to $VendorDir..."
& 7z x $ArchivePath "-o$VendorDir" -y | Out-Null

if (Test-Path $ArchivePath) {
    Remove-Item $ArchivePath -Force
}

if (Test-Path $DllPath) {
    Write-Host "[SUCCESS] libmpv setup complete at $VendorDir"
} else {
    Write-Error "Failed to extract libmpv-2.dll"
}
