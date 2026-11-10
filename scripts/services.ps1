#Requires -Version 5.1
<#
.SYNOPSIS
  SPEED CLUB - start, stop or inspect the local services (ADR-102).

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/services.ps1 [start|stop|status]

  start  : XAMPP MariaDB on :3306 (only if nothing listens there), a PHP FastCGI pool on 127.0.0.1:9085
           and a dedicated Apache instance on :8080 serving web/public. Every step is idempotent.
  stop   : stops the FastCGI pool and the dedicated Apache instance. MariaDB keeps running because
           other local projects share it.
  status : prints what is listening.

  XAMPP's global Apache config is never edited and XAMPP's own Apache may run at the same time.
#>
[CmdletBinding()]
param(
  [ValidateSet('start', 'stop', 'status')][string]$Action = 'start',
  [string]$XamppDir = 'C:\xampp',
  [string]$PhpCgi = '',
  [int]$FcgiChildren = 12
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Conf = Join-Path $Root 'scripts\dev\httpd-speedclub.conf'
$Httpd = Join-Path $XamppDir 'apache\bin\httpd.exe'
$Mysqld = Join-Path $XamppDir 'mysql\bin\mysqld.exe'
$MyIni = Join-Path $XamppDir 'mysql\bin\my.ini'
$LogDir = Join-Path $Root 'web\storage\logs'
$PidFile = Join-Path $LogDir 'apache-8080.pid'
$FcgiPidFile = Join-Path $LogDir 'php-cgi-9085.pid'

if (-not $PhpCgi) {
  $php = Get-Command php -ErrorAction SilentlyContinue
  if ($php) { $PhpCgi = Join-Path (Split-Path -Parent $php.Source) 'php-cgi.exe' }
}

function Test-Port([int]$Port) {
  # A connect attempt, not the TCP table: the table can hide listeners from a sandboxed shell, and a false "down" here
  # would start a second server on the same data directory.
  $client = New-Object System.Net.Sockets.TcpClient
  try { return ($client.ConnectAsync('127.0.0.1', $Port).Wait(1000) -and $client.Connected) }
  catch { return $false }
  finally { $client.Dispose() }
}

function Wait-Port([int]$Port, [int]$Seconds = 20) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { return $true }
    Start-Sleep -Milliseconds 300
  }
  return (Test-Port $Port)
}

function Start-MariaDb {
  if (Test-Port 3306) { Write-Host '[ok]   MariaDB already listening on :3306'; return }
  if (-not (Test-Path $Mysqld)) { Write-Host "[FAIL] $Mysqld not found" -ForegroundColor Red; exit 1 }
  # mysqld needs real standard handles (ADR-142). Started hidden without them, its log output landed in the table files that
  # reused those descriptors and corrupted the mysql.* grant tables. Start-Process with redirection would hand it the caller's
  # pipe instead, so the call never returns. Win32_Process.Create starts cmd outside this console: nul in, two log files out.
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $out = Join-Path $LogDir 'mysqld-3306.out.log'
  $err = Join-Path $LogDir 'mysqld-3306.err.log'
  $flags = '--standalone --innodb-buffer-pool-size=256M --max-allowed-packet=64M --innodb-flush-log-at-trx-commit=2'
  $line = "cmd.exe /d /c `"`"$Mysqld`" --defaults-file=`"$MyIni`" $flags < nul > `"$out`" 2> `"$err`"`""
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line; CurrentDirectory = (Split-Path -Parent (Split-Path -Parent $Mysqld)) }
  if ($result.ReturnValue -ne 0) { Write-Host "[FAIL] MariaDB could not be started (Win32_Process.Create returned $($result.ReturnValue))" -ForegroundColor Red; exit 1 }
  if (Wait-Port 3306 60) { Write-Host '[ok]   MariaDB started on :3306' } else { Write-Host "[FAIL] MariaDB did not start - see $err and the XAMPP mysql_error.log" -ForegroundColor Red; exit 1 }
}

function Start-Fcgi {
  if (Test-Port 9085) { Write-Host '[ok]   PHP FastCGI already listening on 127.0.0.1:9085'; return }
  if (-not $PhpCgi -or -not (Test-Path $PhpCgi)) { Write-Host "[FAIL] php-cgi.exe not found next to php on PATH" -ForegroundColor Red; exit 1 }
  $env:PHP_FCGI_CHILDREN = "$FcgiChildren"
  $env:PHP_FCGI_MAX_REQUESTS = '0'
  $proc = Start-Process -FilePath $PhpCgi -WindowStyle Hidden -PassThru -ArgumentList @(
    '-b', '127.0.0.1:9085',
    '-d', 'upload_max_filesize=20M', '-d', 'post_max_size=25M', '-d', 'memory_limit=512M', '-d', 'max_execution_time=120',
    '-d', 'opcache.enable=1', '-d', 'opcache.validate_timestamps=1', '-d', 'opcache.revalidate_freq=0',
    '-d', 'cgi.fix_pathinfo=1', '-d', 'expose_php=0', '-d', 'display_errors=0'
  )
  [System.IO.File]::WriteAllText($FcgiPidFile, "$($proc.Id)")
  if (Wait-Port 9085) { Write-Host "[ok]   PHP FastCGI on 127.0.0.1:9085 ($FcgiChildren children)" } else { Write-Host '[FAIL] php-cgi did not start' -ForegroundColor Red; exit 1 }
}

function Start-Apache {
  if (Test-Port 8080) { Write-Host '[ok]   :8080 already listening'; return }
  if (-not (Test-Path $Httpd)) { Write-Host "[FAIL] $Httpd not found" -ForegroundColor Red; exit 1 }
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Start-Process -FilePath $Httpd -WindowStyle Hidden -ArgumentList @('-f', ($Conf -replace '\\', '/'))
  if (Wait-Port 8080) { Write-Host '[ok]   Apache on http://localhost:8080' } else { Write-Host "[FAIL] Apache did not start - see $LogDir\apache-error.log" -ForegroundColor Red; exit 1 }
}

function Stop-ByPidFile([string]$File, [string]$Label) {
  if (-not (Test-Path $File)) { Write-Host "[--]   $Label not running (no pid file)"; return }
  $id = 0
  [void][int]::TryParse(([System.IO.File]::ReadAllText($File).Trim()), [ref]$id)
  if ($id -gt 0) {
    # /T also ends the worker children of this instance. Nothing else on the machine is touched.
    & taskkill /PID $id /T /F 2>&1 | Out-Null
    Write-Host "[ok]   stopped $Label (pid $id)"
  }
  Remove-Item $File -Force -ErrorAction SilentlyContinue
}

switch ($Action) {
  'start' { Start-MariaDb; Start-Fcgi; Start-Apache }
  'stop' { Stop-ByPidFile $PidFile 'Apache :8080'; Stop-ByPidFile $FcgiPidFile 'PHP FastCGI :9085' }
  'status' {
    foreach ($p in 3306, 9085, 8080) {
      $state = if (Test-Port $p) { 'listening' } else { 'down' }
      Write-Host (":{0,-5} {1}" -f $p, $state)
    }
    try {
      $r = Invoke-WebRequest -Uri 'http://localhost:8080/up' -UseBasicParsing -TimeoutSec 5
      Write-Host "/up   HTTP $($r.StatusCode)"
    } catch { Write-Host "/up   not reachable: $($_.Exception.Message)" }
  }
}
exit 0
