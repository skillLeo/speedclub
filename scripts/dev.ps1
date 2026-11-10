#Requires -Version 5.1
<#
.SYNOPSIS
  SPEED CLUB - start everything needed for local development.

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1

  Starts the local services (MariaDB, PHP FastCGI, Apache on :8080, see scripts/services.ps1), a queue
  worker in its own window, then the Expo web dev server in this window on http://localhost:8081/app.
  Stop with Ctrl+C here and close the worker window. `scripts/services.ps1 stop` ends the web server.
#>
[CmdletBinding()]
param([switch]$NoExpo)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\services.ps1') start
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Start-Process -FilePath 'php' -WorkingDirectory (Join-Path $Root 'web') -ArgumentList @('artisan', 'queue:work', '--tries=3', '--timeout=50')
Write-Host '[ok]   queue worker started in its own window'

if ($NoExpo) { exit 0 }

Push-Location $Root
try { & npm.cmd --prefix mobile run web }
finally { Pop-Location }
