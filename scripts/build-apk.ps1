#Requires -Version 5.1
<#
.SYNOPSIS
  SPEED CLUB - build a SIGNED Android release APK locally (Windows or macOS).

.DESCRIPTION
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -Target lan
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -Target staging -ApiUrl https://staging.example.de
  Options: -Clean (expo prebuild --clean), -NoBump (keep versionCode), -Abis arm64-v8a,x86_64 (override the ABI list,
           for example to include x86_64 for an emulator), -VersionName 0.2.0 (set versionName for a new phase/milestone;
           versionCode still goes +1), -ExpectedCertSha256 <64 hex> (signer pin; default: SPEEDCLUB_UPLOAD_CERT_SHA256 or
           the upload key of OA-8)

  Steps: resolve API URL -> bump mobile/version.json -> expo prebuild (android) -> long-path CMake toolchain
         -> gradlew app:assembleRelease -> apksigner verify (CN=SPEED CLUB, pinned certificate, never the debug one)
         -> aapt dump permissions (SEC-P1-06 allow-list) -> copy APK to releases/android -> SHA-256 -> append docs/RELEASES.md
  Signing credentials come from %USERPROFILE%\.gradle\gradle.properties (created by setup-windows.ps1);
  on macOS from $HOME/.gradle/gradle.properties (created by scripts/setup-signing.sh). Both platforms only test for a SPEEDCLUB_UPLOAD_STORE_FILE= line
  (Select-String -Quiet); nothing of the file is printed or logged.

  Platforms: Windows PowerShell 5.1 and PowerShell 7 on macOS. On macOS `powershell` must resolve to pwsh (owner action
  OA-7: `sh scripts/setup-powershell.sh`, with ~/.local/bin on PATH).
  macOS needs JDK 17 (/usr/libexec/java_home -F -v 17, or Homebrew openjdk@17) and the Android SDK
  (ANDROID_HOME, or ~/Library/Android/sdk) with build-tools, NDK and cmake 3.22.1.
#>
[CmdletBinding()]
param(
  [ValidateSet('lan', 'staging', 'production')][string]$Target = 'lan',
  [string]$ApiUrl = '',
  [string]$WebUrl = '',
  [int]$Port = 8080,
  [string]$PusherKey = '',
  [string]$PusherCluster = 'eu',
  [switch]$Clean,
  [switch]$NoBump,
  [string]$Abis = '',
  [string]$VersionName = '',
  [string]$ExpectedCertSha256 = ''
)

# The upload key the owner created on the Mac (HANDOFF OA-8, docs/DEPLOY.md ANDROID_CERT_SHA256). Public, not a secret.
# A different key means a new app identity for sideloaded testers, so it must be chosen on purpose: -ExpectedCertSha256 or
# SPEEDCLUB_UPLOAD_CERT_SHA256.
$DefaultUploadCertSha256 = '95ef800df2d5d92b0f8ca9c9ded0b71bf96b0b82389284b21e8e24863002f079'

# SEC-P1-06: the only permissions a release APK may request (mobile/app.config.ts RELEASE_BLOCKED_PERMISSIONS removes the rest;
# M2.2 review). ACCESS_WIFI_STATE comes from @react-native-community/netinfo and expo-network and is not blocked. The app's own
# <package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION (androidx.core) is declared and used by the app itself.
$AllowedPermissions = @(
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.VIBRATE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
  'com.google.android.c2dm.permission.RECEIVE'
)

# Parses `aapt dump permissions` / `aapt2 dump permissions` output. Returns the package, the requested and the declared names.
function Get-ApkPermissions([string[]]$Lines) {
  $result = @{ Package = ''; Uses = @(); Declared = @() }
  foreach ($l in $Lines) {
    $s = "$l".Trim()
    if ($s -match "^package:\s*(?:name=')?([A-Za-z0-9_.]+)") { $result.Package = $Matches[1] }
    elseif ($s -match "^uses-permission(?:-sdk-23)?:\s*name='([^']+)'") { $result.Uses += $Matches[1] }
    elseif ($s -match "^permission:\s*(?:name=')?([A-Za-z0-9_.]+)") { $result.Declared += $Matches[1] }
  }
  return $result
}

# Returns the permissions outside the allow-list (empty = pass).
function Get-UnexpectedPermissions($Parsed, [string[]]$Allowed) {
  $own = "$($Parsed.Package).DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
  $bad = @()
  foreach ($p in ($Parsed.Uses | Sort-Object -Unique)) { if ($Allowed -notcontains $p -and $p -ne $own) { $bad += "uses $p" } }
  foreach ($p in ($Parsed.Declared | Sort-Object -Unique)) { if ($p -ne $own) { $bad += "declares $p" } }
  return ,$bad
}

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
# $IsWindows exists only in PowerShell 6+; Windows PowerShell 5.1 always runs on Windows.
# Paths below use forward slashes: .NET on Unix would write a backslash as part of the file name.
$OnUnix = ($PSVersionTable.PSVersion.Major -ge 6) -and (-not $IsWindows)
$Npx = 'npx.cmd'
if ($OnUnix) { $Npx = 'npx' }
$Mobile = Join-Path $Root 'mobile'
$Releases = Join-Path $Root 'releases/android'
$Logs = Join-Path $Root 'docs/reports/logs'
New-Item -ItemType Directory -Force -Path $Releases, $Logs | Out-Null
$Stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$LogFile = Join-Path $Logs "build-apk-$Target-$Stamp.log"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Writer = New-Object System.IO.StreamWriter($LogFile, $true, $Utf8NoBom)

function Log([string]$Text) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Text
  Write-Host $line
  $Writer.WriteLine($line)
  $Writer.Flush()
}
function Fail([string]$Text) {
  Log "FAILED: $Text"
  Log "Log file: $LogFile"
  $Writer.Close()
  exit 1
}
function Run-Native([string]$Exe, [string[]]$ArgList) {
  # Sentinel: a native process overwrites it. If it stays (command not found, not executable), the step failed.
  $global:LASTEXITCODE = -1
  try {
    & $Exe @ArgList 2>&1 | ForEach-Object {
      $s = "$_"
      Write-Host $s
      $Writer.WriteLine($s)
    }
  } catch {
    $Writer.WriteLine("EXCEPTION: $_")
    Write-Host "EXCEPTION: $_"
  }
  $Writer.Flush()
  return $LASTEXITCODE
}

Log "SPEED CLUB APK build - target=$Target"

# ------------------------------------------------------------------ 0. preconditions
if (-not (Test-Path (Join-Path $Mobile 'package.json'))) { Fail 'mobile/package.json not found' }
if ($OnUnix) {
  # This file holds the keystore passwords: only the presence of the store line is tested (Select-String -Quiet returns a
  # boolean and prints nothing). The Gradle plugin (mobile/plugins/withReleaseSigning.js) fails the release build on purpose
  # when any other property is missing.
  $gradleProps = Join-Path $HOME '.gradle/gradle.properties'
  if (-not (Test-Path $gradleProps) -or -not (Select-String -Path $gradleProps -Pattern '^SPEEDCLUB_UPLOAD_STORE_FILE=' -Quiet)) {
    Fail "Release signing is not configured: $gradleProps is missing or has no SPEEDCLUB_UPLOAD_STORE_FILE line. Run: sh scripts/setup-signing.sh (docs/HANDOFF.md, owner action OA-8)."
  }
} else {
  $gradleProps = Join-Path $env:USERPROFILE '.gradle\gradle.properties'
  if (-not (Test-Path $gradleProps) -or -not (Select-String -Path $gradleProps -Pattern '^SPEEDCLUB_UPLOAD_STORE_FILE=' -Quiet)) {
    Fail 'Release signing is not configured. Run scripts/setup-windows.ps1 (keystore step) first.'
  }
}
if ($OnUnix) {
  if (-not $env:JAVA_HOME) {
    $global:LASTEXITCODE = -1
    # -F: fail instead of falling back to another installed version.
    $jh = ''
    try { $jh = ((& /usr/libexec/java_home -F -v 17 2>$null) -join '').Trim() } catch { $jh = '' }
    if ($LASTEXITCODE -eq 0 -and $jh -and (Test-Path $jh)) { $env:JAVA_HOME = $jh }
  }
  # Homebrew fallback: the JDK bundle's Contents/Home (Apple Silicon first, then Intel).
  foreach ($brewJdk in @('/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home', '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home')) {
    if (-not $env:JAVA_HOME -and (Test-Path (Join-Path $brewJdk 'bin/java'))) { $env:JAVA_HOME = $brewJdk }
  }
  if (-not $env:ANDROID_HOME -and $env:ANDROID_SDK_ROOT) { $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT }
  if (-not $env:ANDROID_HOME -and (Test-Path (Join-Path $HOME 'Library/Android/sdk'))) { $env:ANDROID_HOME = Join-Path $HOME 'Library/Android/sdk' }
  if (-not $env:JAVA_HOME -or -not (Test-Path $env:JAVA_HOME)) { Fail 'JDK 17 not found. Install it: brew install openjdk@17 (or set JAVA_HOME).' }
  if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) { Fail 'Android SDK not found. Install it (Android Studio) or set ANDROID_HOME; expected ~/Library/Android/sdk.' }
} else {
  if (-not $env:JAVA_HOME) { $env:JAVA_HOME = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User') }
  if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User') }
  if (-not $env:JAVA_HOME -or -not (Test-Path $env:JAVA_HOME)) { Fail 'JAVA_HOME is not set (JDK 17). Re-run setup-windows.ps1.' }
  if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) { Fail 'ANDROID_HOME is not set. Open Android Studio once, then re-run setup-windows.ps1 -SkipPrereqs -SkipWeb -SkipMobile.' }
}
# Environment names are case-sensitive on Unix (PATH); on Windows $env:PATH and $env:Path are the same variable.
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + [System.IO.Path]::PathSeparator + $env:PATH

# ------------------------------------------------------------------ 1. URLs
if (-not $ApiUrl) {
  switch ($Target) {
    'lan' {
      $ip = $null
      if ($OnUnix) {
        # Interface of the default route, then its IPv4; en0/en1 as the fallback (Wi-Fi/Ethernet on a Mac).
        $iface = ''
        $routeLines = & route -n get default 2>$null
        foreach ($l in $routeLines) { if ("$l" -match '^\s*interface:\s*(\S+)') { $iface = $Matches[1] } }
        foreach ($candidate in @($iface, 'en0', 'en1')) {
          if (-not $ip -and $candidate) {
            $cand = ((& ipconfig getifaddr $candidate 2>$null) -join '').Trim()
            if ($cand -match '^\d+\.\d+\.\d+\.\d+$') { $ip = $cand }
          }
        }
      } else {
        $cfg = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $null -ne $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
        if ($cfg) { $ip = $cfg.IPv4Address | Select-Object -First 1 -ExpandProperty IPAddress }
      }
      if (-not $ip) { Fail "Could not detect this PC's LAN IPv4. Pass -ApiUrl http://<ip>:$Port" }
      $ApiUrl = "http://${ip}:$Port"
    }
    'staging' {
      $ApiUrl = $env:SPEEDCLUB_STAGING_URL
      if (-not $ApiUrl) { Fail 'Pass -ApiUrl https://staging.<domain> (or set SPEEDCLUB_STAGING_URL)' }
    }
    'production' {
      $ApiUrl = $env:SPEEDCLUB_PRODUCTION_URL
      if (-not $ApiUrl) { Fail 'Pass -ApiUrl https://<domain> (or set SPEEDCLUB_PRODUCTION_URL)' }
    }
  }
}
$ApiUrl = $ApiUrl.TrimEnd('/')
if (-not $WebUrl) { $WebUrl = $ApiUrl }
if ($Target -ne 'lan' -and $ApiUrl -notmatch '^https://') { Fail 'staging/production builds must use HTTPS' }
Log "API = $ApiUrl"

# ------------------------------------------------------------------ 2. version
$verFile = Join-Path $Mobile 'version.json'
if (-not (Test-Path $verFile)) { [System.IO.File]::WriteAllText($verFile, "{`n  `"versionName`": `"0.1.0`",`n  `"versionCode`": 1`n}`n", $Utf8NoBom) }
$ver = Get-Content $verFile -Raw | ConvertFrom-Json
if ($VersionName) {
  if ($VersionName -notmatch '^\d+\.\d+\.\d+$') { Fail "-VersionName must look like 0.2.0 (got '$VersionName')" }
  $ver.versionName = $VersionName
}
if (-not $NoBump -or $VersionName) {
  if (-not $NoBump) { $ver.versionCode = [int]$ver.versionCode + 1 }
  $json = "{`n  `"versionName`": `"$($ver.versionName)`",`n  `"versionCode`": $($ver.versionCode)`n}`n"
  [System.IO.File]::WriteAllText($verFile, $json, $Utf8NoBom)
}
Log "version $($ver.versionName) (build $($ver.versionCode))"

# ------------------------------------------------------------------ 3. env for prebuild + JS bundle
$env:EXPO_PUBLIC_APP_ENV = $Target
$env:EXPO_PUBLIC_API_URL = $ApiUrl
$env:EXPO_PUBLIC_WEB_URL = $WebUrl
if ($PusherKey) { $env:EXPO_PUBLIC_PUSHER_KEY = $PusherKey; $env:EXPO_PUBLIC_PUSHER_CLUSTER = $PusherCluster }
$env:EXPO_NO_GIT_STATUS = '1'
$env:EXPO_NO_TELEMETRY = '1'

# ------------------------------------------------------------------ 4. prebuild
$prebuildArgs = @('expo', 'prebuild', '--platform', 'android', '--no-install')
if ($Clean) { $prebuildArgs += '--clean' }
Push-Location $Mobile
$code = Run-Native $Npx $prebuildArgs
Pop-Location
if ($code -ne 0) { Fail "expo prebuild failed (exit $code)" }

# ------------------------------------------------------------------ 5. long-path toolchain + gradle (ADR-108)
# React Native libraries nest absolute paths inside CMake object directories, well beyond 260 characters.
# subst no longer helps: autolinking resolves real paths while the RN Gradle plugin keeps the drive letter
# ("this and base files have different roots"). So we build in place with a long-path aware ninja, in a
# private copy of the SDK's CMake that local.properties points to. The shared SDK stays untouched.
$cmakeVersion = '3.22.1'
if ($OnUnix) {
  # macOS has no MAX_PATH, so the Windows-only parts are skipped: the LongPathsEnabled registry check and the private
  # CMake copy with the ninja-win binary. The SDK's own cmake 3.22.1 already ships a ninja for macOS.
  $cmakeDir = Join-Path $env:ANDROID_HOME "cmake/$cmakeVersion"
  if (-not (Test-Path (Join-Path $cmakeDir 'bin/ninja'))) { Fail "CMake $cmakeVersion (with ninja) is missing in $cmakeDir. Install it: sdkmanager `"cmake;$cmakeVersion`"" }
} else {
$longPaths = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -ErrorAction SilentlyContinue).LongPathsEnabled
if ($longPaths -ne 1) {
  Fail "Windows long paths are disabled. Run once in an elevated PowerShell: New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force"
}
$ninjaVersion = '1.13.2'
$ninjaSha256 = '07FC8261B42B20E71D1720B39068C2E14FFCEE6396B76FB7A795FB460B78DC65'
$cmakeSource = Join-Path $env:ANDROID_HOME "cmake\$cmakeVersion"
$cmakeDir = Join-Path $env:LOCALAPPDATA "speedclub\android-tools\cmake-$cmakeVersion-ninja-$ninjaVersion"
if (-not (Test-Path (Join-Path $cmakeDir 'bin\ninja.exe'))) {
  if (-not (Test-Path $cmakeSource)) { Fail "CMake $cmakeVersion is missing. Install it: sdkmanager `"cmake;$cmakeVersion`"" }
  Log "provisioning $cmakeDir (CMake $cmakeVersion + ninja $ninjaVersion)"
  New-Item -ItemType Directory -Force -Path $cmakeDir | Out-Null
  Copy-Item -Path (Join-Path $cmakeSource '*') -Destination $cmakeDir -Recurse -Force
  $zip = Join-Path $env:TEMP "ninja-$ninjaVersion-win.zip"
  # curl.exe ships with Windows; Invoke-WebRequest timed out on this download under PowerShell 5.1.
  $ninjaUrl = "https://github.com/ninja-build/ninja/releases/download/v$ninjaVersion/ninja-win.zip"
  & curl.exe -sSL --max-time 180 --retry 3 -o $zip $ninjaUrl
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $zip)) {
    Remove-Item $cmakeDir -Recurse -Force -ErrorAction SilentlyContinue
    Fail "ninja download failed (curl exit $LASTEXITCODE)"
  }
  if ((Get-FileHash -Algorithm SHA256 -Path $zip).Hash -ne $ninjaSha256) {
    Remove-Item $cmakeDir -Recurse -Force -ErrorAction SilentlyContinue
    Fail 'ninja download does not match the pinned SHA-256'
  }
  Expand-Archive -Path $zip -DestinationPath (Join-Path $cmakeDir 'bin') -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}
}
$localProperties = @(
  ('sdk.dir=' + ($env:ANDROID_HOME -replace '\\', '/')),
  ('cmake.dir=' + ($cmakeDir -replace '\\', '/'))
)
[System.IO.File]::WriteAllLines((Join-Path $Mobile 'android/local.properties'), [string[]]$localProperties, $Utf8NoBom)
Log "cmake.dir -> $cmakeDir"

# No stale APK may survive into step 6: a build that never ran or produced nothing must fail there, not ship the previous file.
$apkSrc = Join-Path $Mobile 'android/app/build/outputs/apk/release/app-release.apk'
if (Test-Path $apkSrc) {
  Remove-Item $apkSrc -Force -ErrorAction SilentlyContinue
  if (Test-Path $apkSrc) { Fail "Could not delete the previous APK at $apkSrc" }
}
$gradleArgs = @('app:assembleRelease', '--console=plain')
if ($Abis) { $gradleArgs += "-PreactNativeArchitectures=$Abis" }
$gradlew = '.\gradlew.bat'
if ($OnUnix) {
  # Through bash: a wrapper copied between machines may have lost its executable bit.
  $gradlew = 'bash'
  $gradleArgs = @('./gradlew') + $gradleArgs
}
Push-Location (Join-Path $Mobile 'android')
$gradleCode = Run-Native $gradlew $gradleArgs
Pop-Location
if ($gradleCode -ne 0) { Fail "Gradle assembleRelease failed (exit $gradleCode). Try -Clean." }


# ------------------------------------------------------------------ 6. collect + verify
if (-not (Test-Path $apkSrc)) { Fail "APK not found at $apkSrc" }
$bt = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory -ErrorAction SilentlyContinue |
  Sort-Object { try { [version]($_.Name -replace '[^0-9.]', '') } catch { [version]'0.0' } } -Descending | Select-Object -First 1
if (-not $bt) { Fail 'Android build-tools not found (apksigner)' }
$apksignerName = 'apksigner.bat'
if ($OnUnix) { $apksignerName = 'apksigner' }
$apksigner = Join-Path $bt.FullName $apksignerName
if (-not (Test-Path $apksigner)) { Fail "apksigner not found at $apksigner" }
$signerExe = $apksigner
$signerArgs = @('verify', '--print-certs', $apkSrc)
if ($OnUnix) {
  # Through bash: build-tools copied between machines may have lost the executable bit.
  $signerExe = 'bash'
  $signerArgs = @($apksigner) + $signerArgs
}
# Sentinel: if apksigner never starts, the exit code stays -1 and the check fails instead of passing with no output.
$global:LASTEXITCODE = -1
$certLines = @()
try {
  $certLines = @(& $signerExe @signerArgs 2>&1 | ForEach-Object { "$_" })
} catch {
  $certLines = @("EXCEPTION: $_")
}
$signerCode = $LASTEXITCODE
$certOut = $certLines -join "`n"
$Writer.WriteLine($certOut)
$Writer.Flush()
if ($signerCode -ne 0) { Fail "apksigner verify failed (exit $signerCode)" }
if ($certOut -match 'CN=Android Debug') { Fail 'APK is signed with the DEBUG certificate - is plugins/withReleaseSigning registered in app.config.ts?' }
$subject = ([regex]::Match($certOut, 'certificate DN:\s*(.+)')).Groups[1].Value.Trim()
$certSha = ([regex]::Match($certOut, 'certificate SHA-256 digest:\s*([0-9a-fA-F]+)')).Groups[1].Value
if (-not $subject -or -not $certSha) { Fail 'apksigner printed no signer certificate' }
if ($subject -notmatch '(^|,\s*)CN=SPEED CLUB(,|$)') { Fail "APK signer is '$subject', expected CN=SPEED CLUB (wrong keystore in gradle.properties?)" }
$pin = $ExpectedCertSha256
if (-not $pin) { $pin = $env:SPEEDCLUB_UPLOAD_CERT_SHA256 }
if (-not $pin) { $pin = $DefaultUploadCertSha256 }
$pin = ($pin -replace '[:\s]', '').ToLowerInvariant()
if ($certSha.ToLowerInvariant() -ne $pin) {
  Fail "APK signer certificate SHA-256 is $certSha, expected $pin. A new upload key is a new app identity for testers: pass -ExpectedCertSha256 only if that is intended."
}
Log "signer OK: $subject (certificate SHA-256 $certSha)"

# SEC-P1-06: what the release APK asks Android for, from the packaged manifest. aapt first, aapt2 as the fallback.
$aaptLines = @()
$aaptTool = ''
foreach ($tool in @('aapt', 'aapt2')) {
  if ($aaptLines.Count -gt 0) { break }
  $exe = Join-Path $bt.FullName $tool
  if (-not $OnUnix) { $exe = "$exe.exe" }
  if (-not (Test-Path $exe)) { continue }
  $global:LASTEXITCODE = -1
  $out = @()
  try { $out = @(& $exe dump permissions $apkSrc 2>&1 | ForEach-Object { "$_" }) } catch { $out = @() }
  if ($LASTEXITCODE -eq 0 -and ($out -match '^package:').Count -gt 0) { $aaptLines = $out; $aaptTool = $tool }
}
if ($aaptLines.Count -eq 0) { Fail "aapt/aapt2 dump permissions gave no result (build-tools $($bt.Name))" }
$Writer.WriteLine("$aaptTool dump permissions:")
$Writer.WriteLine(($aaptLines -join "`n"))
$Writer.Flush()
$perms = Get-ApkPermissions $aaptLines
$unexpected = Get-UnexpectedPermissions $perms $AllowedPermissions
if ($perms.Package -ne 'de.speedclub.app') { Fail "aapt reports package '$($perms.Package)', expected de.speedclub.app" }
if ($unexpected.Count -gt 0) {
  Fail "SEC-P1-06: the APK requests permissions outside the release allow-list: $($unexpected -join '; '). Block them in mobile/app.config.ts (RELEASE_BLOCKED_PERMISSIONS) or, after a review, add them to `$AllowedPermissions in this script."
}
$permList = ($perms.Uses | Sort-Object -Unique) -join ', '
Log "permissions OK ($aaptTool): $permList"

# Only a verified APK reaches releases/ under a release name: every Fail above leaves nothing there.
$name = "speedclub-$($ver.versionName)-b$($ver.versionCode)-$Target-$Stamp.apk"
$dest = Join-Path $Releases $name
Copy-Item $apkSrc $dest -Force
$hash = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash
[System.IO.File]::WriteAllText("$dest.sha256", "$hash  $name`n", $Utf8NoBom)
$sizeMb = [math]::Round((Get-Item $dest).Length / 1MB, 1)

# ------------------------------------------------------------------ 7. release notes
$notes = Join-Path $Root 'docs/RELEASES.md'
if (-not (Test-Path $notes)) { [System.IO.File]::WriteAllText($notes, "# SPEED CLUB - Releases`n", $Utf8NoBom) }
$entry = @"

## $($ver.versionName) (Build $($ver.versionCode)) - $Target - $(Get-Date -Format 'yyyy-MM-dd HH:mm')
- APK: releases/android/$name ($sizeMb MB)
- SHA-256: $hash
- Signed by: $subject (certificate SHA-256 $certSha)
- API: $ApiUrl
- Permissions ($aaptTool dump permissions, SEC-P1-06 allow-list passed): $permList
- Changes: _(release engineer: summarise commits since the previous release)_
- Known issues (Low): _(release engineer)_
- Test status: _(release engineer: copy from the latest verify report - only what actually ran)_
"@
[System.IO.File]::AppendAllText($notes, $entry, $Utf8NoBom)

Log '----------------------------------------------------------------'
Log "APK      : $dest"
Log "SIZE     : $sizeMb MB"
Log "SHA-256  : $hash"
Log "SIGNER   : $subject"
Log "CERT SHA : $certSha"
Log "PERMS    : $permList"
Log 'OK - signed release APK ready. Install: adb install -r "<apk>"  or send the file/link to testers.'
$Writer.Close()
exit 0
