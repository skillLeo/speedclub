#Requires -Version 5.1
<#
.SYNOPSIS
  SPEED CLUB - run every quality gate of a phase and write a report.

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -Phase 1
  Options: -Quick (static + unit only), -SkipVisual, -SkipLighthouse
  Report : docs/reports/phase-<N>/verify-<timestamp>.md   Logs: docs/reports/logs/verify-*.log
  Exit   : 0 only if every executed gate passed.
  The npm/composer scripts called here are created in Phase 1 (M1.0) with exactly these names.
  Platforms: Windows PowerShell 5.1 and PowerShell 7 on macOS. On macOS `powershell` must resolve to pwsh (owner action
  OA-7: `sh scripts/setup-powershell.sh`, with ~/.local/bin on PATH).
  Executables and the service start are picked by platform; no gate, threshold or check differs between the two.
#>
[CmdletBinding()]
param(
  [ValidateRange(1, 3)][int]$Phase = 1,
  [int]$Port = 8080,
  [switch]$Quick,
  [switch]$SkipVisual,
  [switch]$SkipLighthouse
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
# $IsWindows exists only in PowerShell 6+; Windows PowerShell 5.1 always runs on Windows.
$OnUnix = ($PSVersionTable.PSVersion.Major -ge 6) -and (-not $IsWindows)
$Npm = 'npm.cmd'
$Composer = 'composer.bat'
if ($OnUnix) { $Npm = 'npm'; $Composer = 'composer' }
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Logs = Join-Path $Root 'docs/reports/logs'
$ReportDir = Join-Path $Root "docs/reports/phase-$Phase"
New-Item -ItemType Directory -Force -Path $Logs, $ReportDir | Out-Null
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Results = New-Object System.Collections.Generic.List[object]

function Invoke-Gate([string]$Name, [string]$Exe, [string[]]$ArgList) {
  $slug = ($Name.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
  $log = Join-Path $Logs "verify-$slug-$Stamp.log"
  Write-Host "`n==> $Name" -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  # Sentinel: a native process overwrites this. If it stays, the gate never really ran and must not pass.
  $global:LASTEXITCODE = -1
  $writer = New-Object System.IO.StreamWriter($log, $false, $Utf8NoBom)
  # Line by line, so a long gate (the visual matrix) shows its progress in the log while it runs.
  $writer.AutoFlush = $true
  Push-Location $Root
  try {
    & $Exe @ArgList 2>&1 | ForEach-Object { $s = "$_"; Write-Host $s; $writer.WriteLine($s) }
    $code = $LASTEXITCODE
    if ($code -eq -1) { $writer.WriteLine("GATE DID NOT RUN: '$Exe' started no process") }
  } catch { $writer.WriteLine("EXCEPTION: $_"); $code = 1 }
  finally { Pop-Location; $writer.Close() }
  $sw.Stop()
  $status = 'PASS'
  if ($code -ne 0) { $status = 'FAIL' }
  $color = 'Green'
  if ($status -eq 'FAIL') { $color = 'Red' }
  Write-Host ("    {0}  ({1:n0}s, exit {2})" -f $status, $sw.Elapsed.TotalSeconds, $code) -ForegroundColor $color
  $Results.Add([pscustomobject]@{ Gate = $Name; Status = $status; Seconds = [math]::Round($sw.Elapsed.TotalSeconds); Exit = $code; Log = ($log.Substring($Root.Length + 1) -replace '\\', '/') })
}

# artisan serve runs `php -S <host>:<port>` as a child (plus worker forks with PHP_CLI_SERVER_WORKERS); stopping only the
# artisan process leaves them serving. Stops the whole tree of $RootId and any `php -S 0.0.0.0:<port>` left behind.
function Stop-ServeTree([int]$RootId) {
  $procs = @()
  if ($OnUnix) {
    foreach ($l in @(& ps -Ao 'pid=,ppid=,command=')) {
      if ("$l" -match '^\s*(\d+)\s+(\d+)\s+(.*)$') { $procs += [pscustomobject]@{ Id = [int]$Matches[1]; Parent = [int]$Matches[2]; Command = $Matches[3] } }
    }
  } else {
    $procs = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ Id = [int]$_.ProcessId; Parent = [int]$_.ParentProcessId; Command = "$($_.CommandLine)" } })
  }
  $kill = New-Object System.Collections.Generic.List[int]
  $kill.Add($RootId)
  $added = $true
  while ($added) {
    $added = $false
    foreach ($p in $procs) { if ($kill.Contains($p.Parent) -and -not $kill.Contains($p.Id)) { $kill.Add($p.Id); $added = $true } }
  }
  $servePattern = "\bphp(\.exe)?\b.*-S\s+0\.0\.0\.0:$Port\b"
  foreach ($p in $procs) { if ($p.Command -match $servePattern -and -not $kill.Contains($p.Id)) { $kill.Add($p.Id) } }
  # Children first, then the root.
  for ($i = $kill.Count - 1; $i -ge 0; $i--) { Stop-Process -Id $kill[$i] -Force -ErrorAction SilentlyContinue }
}

function Test-Up {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port/up" -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

# ------------------------------------------------------------------ static + unit gates
Invoke-Gate 'Design tokens (contrast + generated files)' 'node' @('design/scripts/build-tokens.mjs', '--check')
Invoke-Gate 'Custom icons (source rules + generated files)' 'node' @('design/scripts/build-icons.mjs', '--check')
Invoke-Gate 'Mobile verify (tsc, eslint, jest, i18n)' $Npm @('--prefix', 'mobile', 'run', 'verify')
Invoke-Gate 'Laravel verify (pint, phpstan, pest, audit)' $Composer @('--working-dir=web', 'verify')
# Timings (Pest group perf, excluded from composer verify in web/phpunit.xml): alone, after the parallel suite, on the gate's engine.
# Absolute: `composer exec` with a relative --working-dir fails with exit 1 ("Could not switch back to working directory web").
if (-not $Quick) { Invoke-Gate 'Laravel performance probes (pest --group=perf, alone)' $Composer @("--working-dir=$(Join-Path $Root 'web')", 'exec', '--', 'pest', '--group=perf') }
Invoke-Gate 'Web assets verify (vue-tsc, eslint, vite build)' $Npm @('--prefix', 'web', 'run', 'verify')
Invoke-Gate 'Dependency audit web (npm, production deps, high+)' $Npm @('--prefix', 'web', 'audit', '--omit=dev', '--audit-level=high')
Invoke-Gate 'Dependency audit mobile (npm, production deps, high+)' $Npm @('--prefix', 'mobile', 'audit', '--omit=dev', '--audit-level=high')

$serverProc = $null
if (-not $Quick) {
  Invoke-Gate 'Expo web export to web/public/app' $Npm @('--prefix', 'mobile', 'run', 'export:web')

  if (-not (Test-Up)) {
    Write-Host "`n    localhost:$Port not reachable - starting the local services" -ForegroundColor Yellow
    if ($OnUnix) {
      & bash (Join-Path $Root 'scripts/services.sh') start
    } else {
      & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts/services.ps1') start
    }
  }
  if (-not (Test-Up)) {
    Write-Host "`n    localhost:$Port still not reachable - starting fallback server (php artisan serve)" -ForegroundColor Yellow
    $env:PHP_CLI_SERVER_WORKERS = '8'
    $serveArgs = @('web/artisan', 'serve', '--host=0.0.0.0', "--port=$Port")
    # Output goes to logs (stdout and stderr need two files); -NoNewWindow exists on both platforms.
    $serveLog = Join-Path $Logs "verify-artisan-serve-$Stamp.log"
    $serveErrLog = Join-Path $Logs "verify-artisan-serve-$Stamp.err.log"
    Write-Host "    php artisan serve output: $serveLog"
    $serverProc = Start-Process -FilePath 'php' -ArgumentList $serveArgs -WorkingDirectory $Root -NoNewWindow -PassThru -RedirectStandardOutput $serveLog -RedirectStandardError $serveErrLog
    $tries = 0
    while (-not (Test-Up) -and $tries -lt 30) { Start-Sleep -Seconds 1; $tries++ }
  }
  if (Test-Up) {
    Invoke-Gate 'E2E (flows, a11y, DOM audit, parity)' $Npm @('--prefix', 'web', 'run', 'e2e')
    if (-not $SkipVisual) { Invoke-Gate "Visual matrix (phase $Phase tier)" $Npm @('--prefix', 'web', 'run', 'visual', '--', '--tier=phase', "--phase=$Phase") }
    if (-not $SkipLighthouse) {
      # lhci measures the checkout as production runs it (web/tests/e2e/lighthouse/lighthouserc.cjs): tls-front.mjs starts a PHP
      # instance with APP_ENV=production, APP_DEBUG=false and `artisan optimize` caches of its own in web/.lighthouseci/app, never
      # in bootstrap/cache, and lhci ends it with its process tree. Teardown: a front or instance left behind, then the caches.
      Invoke-Gate 'Lighthouse CI (public pages)' $Npm @('--prefix', 'web', 'run', 'lhci')
      $lhciAppPort = if ($env:SPEEDCLUB_LHCI_APP_PORT) { $env:SPEEDCLUB_LHCI_APP_PORT } else { '8091' }
      $lhciLeftover = "-S 127\.0\.0\.1:$lhciAppPort |lighthouse[\\/]tls-front\.mjs"
      if (-not $OnUnix) {
        Get-CimInstance Win32_Process | Where-Object {
          ($_.Name -eq 'php.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -match $lhciLeftover
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      } else {
        # PowerShell 7 on macOS/Linux: the command lines come from ps.
        & ps -Ao 'pid=,command=' | ForEach-Object {
          if ($_ -match '^\s*(\d+)\s+(.*)$') {
            $leftoverPid = [int]$Matches[1]
            $leftoverCommand = $Matches[2]
            if ($leftoverCommand -match '\b(php|node)\b' -and $leftoverCommand -match $lhciLeftover) {
              Stop-Process -Id $leftoverPid -Force -ErrorAction SilentlyContinue
            }
          }
        }
      }
      Remove-Item -Recurse -Force (Join-Path (Join-Path $Root 'web') '.lighthouseci/app') -ErrorAction SilentlyContinue
    }
  } else {
    $serverHint = 'start XAMPP Apache (vhost :' + $Port + ') or scripts/services.ps1 start'
    if ($OnUnix) { $serverHint = 'run bash scripts/services.sh start (Homebrew httpd on :' + $Port + ')' }
    $Results.Add([pscustomobject]@{ Gate = 'Server http://localhost:' + $Port + '/up'; Status = 'FAIL'; Seconds = 0; Exit = 1; Log = $serverHint })
  }
}
if ($serverProc) { Stop-ServeTree $serverProc.Id }

# ------------------------------------------------------------------ report
$failed = @($Results | Where-Object { $_.Status -ne 'PASS' })
# safe.directory: the checkout may belong to another user (root-owned on the Mac), and git then refuses with "dubious ownership".
$commit = (git -c "safe.directory=$Root" -C $Root rev-parse --short HEAD 2>$null) -join ''
$lines = @("# Verify report - Phase $Phase - $(Get-Date -Format 'yyyy-MM-dd HH:mm')", '', "Commit: $commit  |  Mode: $(if ($Quick) { 'quick' } else { 'full' })", '', '| Gate | Result | Time (s) | Exit | Log |', '|---|---|---|---|---|')
foreach ($r in $Results) { $lines += "| $($r.Gate) | $($r.Status) | $($r.Seconds) | $($r.Exit) | $($r.Log) |" }
$lines += ''
if ($failed.Count -eq 0) { $lines += '**All executed gates passed.** (Design-QA and security sign-off are separate reports.)' } else { $lines += "**$($failed.Count) gate(s) failed.**" }
$report = Join-Path $ReportDir "verify-$Stamp.md"
[System.IO.File]::WriteAllLines($report, [string[]]$lines, $Utf8NoBom)
Write-Host "`nReport: $report"
if ($failed.Count -gt 0) { exit 1 } else { exit 0 }
