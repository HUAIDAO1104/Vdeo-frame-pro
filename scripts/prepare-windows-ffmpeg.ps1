param(
  [string]$FfmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
  [string]$LicenseUrl = "https://www.gnu.org/licenses/gpl-3.0.txt"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BinaryDir = Join-Path $Root "src-tauri\binaries"
$ResourceDir = Join-Path $Root "src-tauri\resources"
$TargetTriple = "x86_64-pc-windows-msvc"
$FfmpegTarget = Join-Path $BinaryDir "ffmpeg-$TargetTriple.exe"
$FfprobeTarget = Join-Path $BinaryDir "ffprobe-$TargetTriple.exe"

New-Item -ItemType Directory -Force -Path $BinaryDir | Out-Null
New-Item -ItemType Directory -Force -Path $ResourceDir | Out-Null

if ((Test-Path $FfmpegTarget) -and (Test-Path $FfprobeTarget)) {
  Write-Host "FFmpeg sidecars are already prepared."
  exit 0
}

$TempRoot = Join-Path $env:TEMP "sales-kit-ffmpeg"
$Archive = Join-Path $TempRoot "ffmpeg.zip"
Remove-Item -Recurse -Force $TempRoot -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

Write-Host "Downloading FFmpeg..."
Invoke-WebRequest -Uri $FfmpegUrl -OutFile $Archive
Expand-Archive -Path $Archive -DestinationPath $TempRoot -Force

$Ffmpeg = Get-ChildItem -Path $TempRoot -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
$Ffprobe = Get-ChildItem -Path $TempRoot -Filter "ffprobe.exe" -Recurse | Select-Object -First 1
if (-not $Ffmpeg -or -not $Ffprobe) {
  throw "The downloaded archive does not contain ffmpeg.exe and ffprobe.exe."
}

Copy-Item $Ffmpeg.FullName $FfmpegTarget -Force
Copy-Item $Ffprobe.FullName $FfprobeTarget -Force

$License = Get-ChildItem -Path $TempRoot -Include "LICENSE*","COPYING*" -File -Recurse | Select-Object -First 1
if ($License) {
  Copy-Item $License.FullName (Join-Path $ResourceDir "ffmpeg-LICENSE.txt") -Force
} else {
  Invoke-WebRequest -Uri $LicenseUrl -OutFile (Join-Path $ResourceDir "ffmpeg-LICENSE.txt")
}

Remove-Item -Recurse -Force $TempRoot
Write-Host "Prepared FFmpeg sidecars in $BinaryDir"
