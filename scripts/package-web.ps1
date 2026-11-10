#Requires -Version 5.1
<#
.SYNOPSIS
  SPEED CLUB - build the deploy package releases/web/speedclub-web-<version>-<yyyyMMdd-HHmm>[-DIRTY].zip (+ .sha256).

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-web.ps1 [-Keep] [-AllowDirty]
  A thin wrapper: the work is done by scripts/dev/package-web.mjs (zero dependencies, runs the same on Windows and macOS).
  On macOS `powershell` must resolve to pwsh (owner action OA-7); without PowerShell run `node scripts/dev/package-web.mjs` directly.
  Steps and exclusions are documented in the header of the .mjs file and in docs/DEPLOY.md. The member web app is always
  exported fresh with EXPO_PUBLIC_APP_ENV=production into the stage folder; -AllowDirty packages a mobile/ with uncommitted
  changes (throwaway packages only; the zip name then ends in -DIRTY).
#>
[CmdletBinding()]
param(
  [switch]$Keep,
  [switch]$AllowDirty
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$nodeArgs = @((Join-Path $Root 'scripts/dev/package-web.mjs'))
if ($Keep) { $nodeArgs += '--keep' }
if ($AllowDirty) { $nodeArgs += '--allow-dirty' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'FAILED: node was not found on PATH (Node 22.2 or newer is required).' -ForegroundColor Red
  exit 1
}
# Sentinel: node overwrites it. If it stays, no process ran and the package must not count as built.
$global:LASTEXITCODE = -1
& node @nodeArgs
$code = $LASTEXITCODE
if ($code -eq -1) { Write-Host 'FAILED: node started no process.' -ForegroundColor Red; exit 1 }
exit $code
