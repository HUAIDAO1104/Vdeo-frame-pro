$ErrorActionPreference = "Stop"

function Ensure-WingetPackage {
  param(
    [string]$Id,
    [string]$Name,
    [string[]]$ExtraArgs = @()
  )
  Write-Host "Checking $Name..."
  $installed = winget list --id $Id --exact --accept-source-agreements 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "$Name is already installed."
    return
  }
  winget install --id $Id --exact --accept-package-agreements --accept-source-agreements @ExtraArgs
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "winget is required. Install or update Microsoft App Installer first."
}

Ensure-WingetPackage -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
Ensure-WingetPackage -Id "Rustlang.Rustup" -Name "Rust"
Ensure-WingetPackage -Id "Microsoft.EdgeWebView2Runtime" -Name "WebView2 Runtime"

Write-Host "Installing Visual Studio C++ build tools..."
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact `
  --accept-package-agreements --accept-source-agreements `
  --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Write-Host ""
Write-Host "Windows desktop prerequisites are ready."
Write-Host "Close and reopen PowerShell, then run: powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1"
