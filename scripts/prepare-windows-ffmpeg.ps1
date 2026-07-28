param(
  [string]$FfmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
  [string]$FallbackFfmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
  [string]$LicenseUrl = "https://www.gnu.org/licenses/gpl-3.0.txt"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BinaryDir = Join-Path $Root "src-tauri\binaries"
$ResourceDir = Join-Path $Root "src-tauri\resources"
$TargetTriple = "x86_64-pc-windows-msvc"
$FfmpegTarget = Join-Path $BinaryDir "ffmpeg-$TargetTriple.exe"
$FfprobeTarget = Join-Path $BinaryDir "ffprobe-$TargetTriple.exe"
$LicenseTarget = Join-Path $ResourceDir "ffmpeg-LICENSE.txt"

New-Item -ItemType Directory -Force -Path $BinaryDir | Out-Null
New-Item -ItemType Directory -Force -Path $ResourceDir | Out-Null

if ((Test-Path $FfmpegTarget) -and (Test-Path $FfprobeTarget) -and (Test-Path $LicenseTarget)) {
  Write-Host "FFmpeg sidecars are already prepared."
  exit 0
}

function Download-File {
  param(
    [string]$Url,
    [string]$Output
  )
  & curl.exe -L --fail --retry 4 --retry-all-errors --retry-delay 5 --connect-timeout 30 `
    --output $Output $Url
  if ($LASTEXITCODE -ne 0) {
    throw "Download failed: $Url"
  }
}

$TempRoot = Join-Path $env:TEMP "sales-kit-ffmpeg"
$Archive = Join-Path $TempRoot "ffmpeg.zip"
Remove-Item -Recurse -Force $TempRoot -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

$SystemFfmpeg = Get-Command ffmpeg.exe -CommandType Application -ErrorAction SilentlyContinue
$SystemFfprobe = Get-Command ffprobe.exe -CommandType Application -ErrorAction SilentlyContinue
if ($SystemFfmpeg -and $SystemFfprobe) {
  Write-Host "Using FFmpeg already installed on the Windows runner."
  Copy-Item $SystemFfmpeg.Source $FfmpegTarget -Force
  Copy-Item $SystemFfprobe.Source $FfprobeTarget -Force
} else {
  Write-Host "Downloading FFmpeg..."
  try {
    Download-File -Url $FfmpegUrl -Output $Archive
  } catch {
    Write-Warning "Primary FFmpeg source failed. Trying GitHub fallback."
    Download-File -Url $FallbackFfmpegUrl -Output $Archive
  }
  Expand-Archive -Path $Archive -DestinationPath $TempRoot -Force

  $Ffmpeg = Get-ChildItem -Path $TempRoot -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
  $Ffprobe = Get-ChildItem -Path $TempRoot -Filter "ffprobe.exe" -Recurse | Select-Object -First 1
  if (-not $Ffmpeg -or -not $Ffprobe) {
    throw "The downloaded archive does not contain ffmpeg.exe and ffprobe.exe."
  }

  Copy-Item $Ffmpeg.FullName $FfmpegTarget -Force
  Copy-Item $Ffprobe.FullName $FfprobeTarget -Force
}

$License = Get-ChildItem -Path $TempRoot -Include "LICENSE*","COPYING*" -File -Recurse | Select-Object -First 1
if ($License) {
  Copy-Item $License.FullName $LicenseTarget -Force
} else {
  Download-File -Url $LicenseUrl -Output $LicenseTarget
}

Remove-Item -Recurse -Force $TempRoot
Write-Host "Prepared FFmpeg sidecars in $BinaryDir"
