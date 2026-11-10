#Requires -Version 5.1
<#
.SYNOPSIS
  SPEED CLUB - fallback local server when XAMPP Apache cannot run Laravel 13 (e.g. Apache PHP < 8.3).
  Serves web/public on http://0.0.0.0:8080 (reachable from phones on the same Wi-Fi) with 8 PHP workers.
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-api.ps1 [-Port 8080]
  Stop with Ctrl+C.
#>
[CmdletBinding()]
param([int]$Port = 8080)
$Root = Split-Path -Parent $PSScriptRoot
$env:PHP_CLI_SERVER_WORKERS = '8'
Write-Host "SPEED CLUB dev server on http://localhost:$Port (LAN: http://<this-pc-ip>:$Port) - Ctrl+C to stop" -ForegroundColor Cyan
Push-Location $Root
try { & php web/artisan serve --host=0.0.0.0 --port=$Port }
finally { Pop-Location }
