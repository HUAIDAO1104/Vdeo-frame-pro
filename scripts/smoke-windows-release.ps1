$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem 'release-dist\*.exe' | Select-Object -First 1
if (-not $installer) { throw 'Release installer missing' }
$installDir = Join-Path $env:RUNNER_TEMP 'frame-studio-install-test'
$process = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$binary = Join-Path $installDir 'sales-kit-studio.exe'
if (-not (Test-Path $binary)) { throw 'Installed application missing' }
foreach ($tool in @('ffmpeg.exe','ffprobe.exe')) {
  $path = Join-Path $installDir $tool
  if (-not (Test-Path $path)) { throw "Bundled tool missing: $tool" }
  & $path -version | Select-Object -First 1
  if ($LASTEXITCODE -ne 0) { throw "Bundled tool cannot run: $tool" }
}
$app = Start-Process -FilePath $binary -PassThru
try {
  Start-Sleep -Seconds 10
  $app.Refresh()
  if ($app.HasExited) { throw "Application exited on startup: $($app.ExitCode)" }
  Write-Host 'Windows silent installation, bundled FFmpeg and application startup passed.'
} finally {
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
}
