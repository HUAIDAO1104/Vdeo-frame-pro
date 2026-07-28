$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js is not available. Run scripts\setup-windows.ps1 first."
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "Rust is not available. Run scripts\setup-windows.ps1 and reopen PowerShell."
}

npm ci
powershell -ExecutionPolicy Bypass -File scripts\prepare-windows-ffmpeg.ps1
npm run test
npm run desktop:build

Write-Host ""
Write-Host "Windows installer:"
Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" | ForEach-Object {
  Write-Host $_.FullName
}
