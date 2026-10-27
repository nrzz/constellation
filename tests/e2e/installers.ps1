# The Windows installer (install.ps1) against stand-in claude.exe files, as installers.sh checks install.sh:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\e2e\installers.ps1
#
# Needs Windows PowerShell 5.1 (powershell.exe), which compiles the stand-in with Add-Type; install.ps1 then runs
# under it and, when installed, under PowerShell 7 (pwsh) too, both as a file and piped into iex as the one-liner
# does. Each case has its own PATH, %LOCALAPPDATA% and %APPDATA%. The stand-in prints the version written beside it
# and logs how it was run, so a case can tell which claude installed the plugin. Nothing outside %TEMP% is touched.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Run this under Windows PowerShell 5.1 (powershell.exe): it compiles its stand-in claude.exe with Add-Type.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:passed = 0
$script:failed = 0
function Check([string]$label, [bool]$ok, $detail) {
  if ($ok) { $script:passed++; Write-Host "PASS: $label" } else { $script:failed++; Write-Host "FAIL: $label ($detail)" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('cst-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$stubExe = Join-Path $work 'stub.exe'
Add-Type -OutputType ConsoleApplication -OutputAssembly $stubExe -TypeDefinition @'
using System;
using System.IO;
public static class Stub {
  public static int Main(string[] args) {
    string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
    if (args.Length > 0 && args[0] == "--version") {
      string v = File.ReadAllText(Path.Combine(Path.GetDirectoryName(self), "version.txt")).Trim();
      if (v.Length > 0) Console.WriteLine(v + " (Claude Code)");
      return 0;
    }
    File.AppendAllText(Environment.GetEnvironmentVariable("LOG"), self + " " + string.Join(" ", args) + Environment.NewLine);
    return Environment.GetEnvironmentVariable("STUB_FAIL") == "1" ? 3 : 0;
  }
}
'@

# A stand-in claude.exe at <path> that says <version> ('' says no version).
function Stub([string]$path, [string]$version) {
  $dir = Split-Path -Parent $path
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item -LiteralPath $stubExe -Destination $path
  Set-Content -LiteralPath (Join-Path $dir 'version.txt') -Value $version -NoNewline
}
function Fresh {
  $script:case = Join-Path $work ([guid]::NewGuid().ToString('N'))
  $script:bin = Join-Path $case 'bin'
  $script:localApp = Join-Path $case 'Local'
  $script:appData = Join-Path $case 'Roaming'
  $script:log = Join-Path $case 'log.txt'
  New-Item -ItemType Directory -Force -Path $bin, $localApp, $appData | Out-Null
}
# Runs install.ps1 under <shell> as a file ('file') or piped into iex ('iex'), with only the case's bin and Windows
# on PATH. Sets $out, $code and $ran (the log of claude runs, one per line).
function Run([string]$shell, [string]$mode, [hashtable]$extra = @{}) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $shell
  $script1 = Join-Path $repo 'install.ps1'
  if ($mode -eq 'file') {
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script1`""
  } else {
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"Get-Content -Raw -LiteralPath '$script1' | Invoke-Expression; 'still here'`""
  }
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($k in 'CLAUDE_BIN', 'STUB_FAIL', 'CONSTELLATION_MARKETPLACE') { $psi.EnvironmentVariables.Remove($k) }
  $psi.EnvironmentVariables['PATH'] = "$bin;$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
  $psi.EnvironmentVariables['LOCALAPPDATA'] = $localApp
  $psi.EnvironmentVariables['APPDATA'] = $appData
  $psi.EnvironmentVariables['LOG'] = $log
  foreach ($k in $extra.Keys) { $psi.EnvironmentVariables[$k] = $extra[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  $stderr = $p.StandardError.ReadToEndAsync()
  $script:out = $p.StandardOutput.ReadToEnd() + $stderr.Result
  $p.WaitForExit()
  $script:code = $p.ExitCode
  $script:ran = if (Test-Path -LiteralPath $log) { (Get-Content -Raw -LiteralPath $log).Trim() } else { '' }
}
# Whether the one claude run was <exe> installing the plugin (compared below the case folder, so a short 8.3 name
# of %TEMP% cannot make the paths differ).
function Installed([string]$exe, [string]$marketplace = 'nrzz/constellation') {
  $rel = $exe.Substring($case.Length)
  $ran -notmatch "`n" -and $ran.EndsWith("$rel plugin install constellation --marketplace $marketplace", [StringComparison]::OrdinalIgnoreCase)
}

$shells = @((Get-Process -Id $PID).Path)
$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
if ($pwsh) { $shells += $pwsh.Source } else { Write-Host '(no pwsh here: PowerShell 7 skipped)' }

foreach ($shell in $shells) {
  $name = if ($shell -match 'pwsh') { 'pwsh' } else { 'powershell' }
  foreach ($mode in 'file', 'iex') {
    $tag = "$name $mode"
    Write-Host "== $tag"

    Fresh
    Stub "$bin\claude.exe" '2.1.310'
    Run $shell $mode
    Check "${tag}: a new enough claude on PATH installs the plugin" ($code -eq 0 -and (Installed "$bin\claude.exe")) "$code $ran $out"
    Check "${tag}: ...and says which version" ($out -match 'with Claude Code 2\.1\.310') $out
    if ($mode -eq 'iex') { Check "${tag}: ...and the window stays open" ($out -match 'still here') $out }

    Fresh
    Stub "$bin\claude.exe" '2.1.283'
    $store = "$localApp\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\2.1.308\c17a819afb40\claude.exe"
    Stub $store '2.1.308'
    Run $shell $mode
    Check "${tag}: an old claude on PATH (2.1.283) falls back to the Store app's 2.1.308" ($code -eq 0 -and (Installed $store)) "$code $ran $out"
    Check "${tag}: ...and says why" ($out -match "Claude Code 2\.1\.283 is on PATH; mods need 2\.1\.287 or later\. Using the Claude Desktop app's own 2\.1\.308") $out

    Fresh
    Stub "$appData\Claude\claude-code\2.1.304\aaaa\claude.exe" '2.1.304'
    $newest = "$appData\Claude\claude-code\2.1.311\bbbb\claude.exe"
    Stub $newest '2.1.311'
    Stub "$localApp\Claude-Data\claude_x\claude-code\2.1.308\cccc\claude.exe" '2.1.308'
    Run $shell $mode
    Check "${tag}: no claude on PATH, three Desktop versions: the newest installs (the installer app's 2.1.311)" ($code -eq 0 -and (Installed $newest)) "$code $ran $out"
    Check "${tag}: ...and says claude is not on PATH" ($out -match "is not on PATH\. Using the Claude Desktop app's own 2\.1\.311") $out

    Fresh
    $roam = "$localApp\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\2.1.310\eeee\claude.exe"
    Stub $roam '2.1.310'
    Run $shell $mode
    Check "${tag}: the Store app's redirected roaming folder" ($code -eq 0 -and (Installed $roam)) "$code $ran $out"

    Fresh
    Stub "$bin\claude.exe" '2.1.283'
    Stub "$appData\Claude\claude-code\2.1.250\ffff\claude.exe" '2.1.250'
    Run $shell $mode
    Check "${tag}: nothing new enough anywhere: no install" (($mode -eq 'iex' -or $code -eq 1) -and $ran -eq '') "$code $ran"
    Check "${tag}: ...saying to update, or to type the command in a newer Claude Code" ($out -match 'Claude Code 2\.1\.283 is on PATH; mods need 2\.1\.287 or later\. Update it' -and $out -match '/plugin install constellation --marketplace nrzz/constellation') $out
    if ($mode -eq 'iex') { Check "${tag}: ...and the window stays open" ($out -match 'still here') $out }

    Fresh
    Run $shell $mode
    Check "${tag}: no claude at all: points to the install docs and the Desktop's Code tab" (($mode -eq 'iex' -or $code -eq 1) -and $out -match 'is not on PATH' -and $out -match 'Code tab') "$code $out"

    Fresh
    Stub "$bin\claude.exe" '2.1.283'
    $named = "$case\elsewhere\claude.exe"
    Stub $named '2.1.311'
    Run $shell $mode @{ CLAUDE_BIN = $named }
    Check "${tag}: CLAUDE_BIN names the claude outright" ($code -eq 0 -and (Installed $named)) "$code $ran $out"

    Fresh
    $named = "$case\elsewhere\claude.exe"
    Stub $named '2.1.200'
    Run $shell $mode @{ CLAUDE_BIN = $named }
    Check "${tag}: ...and is refused when too old" ($ran -eq '' -and $out -match 'older than 2\.1\.287') "$code $ran $out"

    Fresh
    Stub "$bin\claude.exe" ''
    Run $shell $mode
    Check "${tag}: a claude on PATH that prints no version is trusted, as before" ($code -eq 0 -and $ran -ne '') "$code $ran"

    Fresh
    Stub "$bin\claude.exe" '2.1.310'
    Run $shell $mode @{ STUB_FAIL = '1' }
    if ($mode -eq 'file') { Check "${tag}: a failing install fails the script" ($code -ne 0) $code }
    Check "${tag}: ...without claiming it is done" (-not ($out -match '(?m)^Done')) $out

    Fresh
    Stub "$bin\claude.exe" '2.1.310'
    Run $shell $mode @{ CONSTELLATION_MARKETPLACE = 'C:\path\to\checkout' }
    Check "${tag}: CONSTELLATION_MARKETPLACE installs from another marketplace" ($code -eq 0 -and (Installed "$bin\claude.exe" 'C:\path\to\checkout')) "$code $ran"
  }
}

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "== $passed passed, $failed failed"
if ($failed -ne 0) { exit 1 }
