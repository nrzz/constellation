# The Windows installer (install.ps1) against stand-in claude.exe files, as installers.sh checks install.sh:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\e2e\installers.ps1
#
# Needs Windows PowerShell 5.1 (powershell.exe), which compiles the stand-in with Add-Type; install.ps1 then runs
# under it and, when installed, under PowerShell 7 (pwsh) too, both as a file and piped into iex as the one-liner
# does. Each case has its own PATH, %LOCALAPPDATA% and %APPDATA%. The stand-in prints the version written beside it
# and logs how it was run (the whole line, and each argument on its own), so a case can tell which claude installed
# the plugin, and with what. Nothing outside %TEMP% is touched.
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
# version.txt beside the stand-in holds what --version prints: a version (printed as "<v> (Claude Code)"), nothing,
# or "raw:<line>" for a line of another shape. STUB_UTF8=1 makes the install print a check mark as UTF-8 bytes, as
# Claude Code does into a pipe.
Add-Type -OutputType ConsoleApplication -OutputAssembly $stubExe -TypeDefinition @'
using System;
using System.IO;
using System.Text;
public static class Stub {
  public static int Main(string[] args) {
    string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
    if (args.Length > 0 && args[0] == "--version") {
      string v = File.ReadAllText(Path.Combine(Path.GetDirectoryName(self), "version.txt")).Trim();
      if (v.StartsWith("raw:")) Console.WriteLine(v.Substring(4));
      else if (v.Length > 0) Console.WriteLine(v + " (Claude Code)");
      return 0;
    }
    string log = Environment.GetEnvironmentVariable("LOG");
    File.AppendAllText(log, self + " " + string.Join(" ", args) + Environment.NewLine);
    foreach (string a in args) File.AppendAllText(log + ".args", "[" + a + "]" + Environment.NewLine);
    if (Environment.GetEnvironmentVariable("STUB_UTF8") == "1") {
      byte[] b = Encoding.UTF8.GetBytes("\u2714 Installed by the stand-in\n");
      Stream o = Console.OpenStandardOutput();
      o.Write(b, 0, b.Length);
      o.Flush();
    }
    return Environment.GetEnvironmentVariable("STUB_FAIL") == "1" ? 3 : 0;
  }
}
'@

# A stand-in claude.exe at <path> that says <version> ('' says no version; 'raw:<line>' prints the line as it is).
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
# on PATH. In iex mode <prefix> runs first in the same session (a primed $LASTEXITCODE, a function named claude),
# and the session's $LASTEXITCODE is printed after as LEC=[n]. Sets $out, $code, $ran (the log of claude runs, one
# per line) and $argv (the arguments of those runs, one per line, each in brackets).
function Run([string]$shell, [string]$mode, [hashtable]$extra = @{}, [string]$prefix = '', [string]$policy = 'Bypass') {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $shell
  $script1 = Join-Path $repo 'install.ps1'
  if ($mode -eq 'file') {
    $psi.Arguments = "-NoProfile -ExecutionPolicy $policy -File `"$script1`""
  } else {
    $psi.Arguments = "-NoProfile -ExecutionPolicy $policy -Command `"$prefix Get-Content -Raw -LiteralPath '$script1' | Invoke-Expression; 'still here'; 'LEC=[' + `$LASTEXITCODE + ']'`""
  }
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($k in 'CLAUDE_BIN', 'STUB_FAIL', 'STUB_UTF8', 'CONSTELLATION_MARKETPLACE') { $psi.EnvironmentVariables.Remove($k) }
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
  $script:argv = if (Test-Path -LiteralPath "$log.args") { @(Get-Content -LiteralPath "$log.args") } else { @() }
}
# Whether the one claude run was <exe> installing the plugin (compared below the case folder, so a short 8.3 name
# of %TEMP% cannot make the paths differ).
function Installed([string]$exe, [string]$marketplace = 'nrzz/constellation') {
  $rel = $exe.Substring($case.Length)
  $ran -notmatch "`n" -and $ran.EndsWith("$rel plugin install constellation --marketplace $marketplace", [StringComparison]::OrdinalIgnoreCase)
}
# Whether the claude runs' arguments are exactly <expected>, one by one.
function ArgsAre([string[]]$expected) {
  ($argv.Count -eq $expected.Count) -and (@(for ($i = 0; $i -lt $expected.Count; $i++) { $argv[$i] -ceq "[$($expected[$i])]" }) -notcontains $false)
}

# The one-liner is read by Windows PowerShell 5.1 in the console's code page: the file must stay ASCII.
$nonAscii = @([IO.File]::ReadAllBytes((Join-Path $repo 'install.ps1')) | Where-Object { $_ -gt 127 }).Count
Check 'install.ps1 is ASCII' ($nonAscii -eq 0) "$nonAscii bytes over 127"

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
    Check "${tag}: ...and says which version, then Done" ($out -match 'with Claude Code 2\.1\.310' -and $out -match '(?m)^Done\.') $out
    if ($mode -eq 'iex') { Check "${tag}: ...and the window stays open, LASTEXITCODE 0" ($out -match 'still here' -and $out -match 'LEC=\[0\]') $out }

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
    if ($mode -eq 'iex') { Check "${tag}: ...and the window stays open, LASTEXITCODE 1" ($out -match 'still here' -and $out -match 'LEC=\[1\]') $out }

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

    # A CLAUDE_BIN that is gone (a Desktop update prunes old version folders): no claude runs, so nothing may say
    # Done, whatever $LASTEXITCODE the session held before.
    Fresh
    Run $shell $mode @{ CLAUDE_BIN = "$case\gone\claude.exe" } 'cmd /c exit 0;'
    Check "${tag}: a CLAUDE_BIN that is gone fails, never Done" ($ran -eq '' -and $out -notmatch '(?m)^Done' -and $out -match 'Could not run') "$code $out"
    if ($mode -eq 'file') { Check "${tag}: ...with a non-zero exit" ($code -ne 0) $code } else { Check "${tag}: ...with LASTEXITCODE 1" ($out -match 'LEC=\[1\]') $out }

    Fresh
    Stub "$bin\claude.exe" ''
    Run $shell $mode
    Check "${tag}: a claude on PATH that prints no version is trusted, as before" ($code -eq 0 -and $ran -ne '') "$code $ran"

    Fresh
    Stub "$bin\claude.exe" 'raw:Claude Code 2.1.283'
    Run $shell $mode
    Check "${tag}: a version line of another shape is still read: 2.1.283 is refused" ($ran -eq '' -and $out -match 'Claude Code 2\.1\.283 is on PATH; mods need') "$code $ran $out"

    Fresh
    Stub "$bin\claude.exe" '2.1.310'
    Run $shell $mode @{ STUB_FAIL = '1' }
    if ($mode -eq 'file') { Check "${tag}: a failing install fails the script" ($code -ne 0) $code } else { Check "${tag}: a failing install leaves LASTEXITCODE 3" ($out -match 'LEC=\[3\]') $out }
    Check "${tag}: ...without claiming it is done" (-not ($out -match '(?m)^Done')) $out

    Fresh
    Stub "$bin\claude.exe" '2.1.310'
    Run $shell $mode @{ CONSTELLATION_MARKETPLACE = 'C:\path\to\checkout' }
    Check "${tag}: CONSTELLATION_MARKETPLACE installs from another marketplace" ($code -eq 0 -and (Installed "$bin\claude.exe" 'C:\path\to\checkout')) "$code $ran"

    # Each argument reaches claude whole: a marketplace path with spaces, and with a trailing backslash (which
    # Windows PowerShell 5.1 would otherwise pass as an escaped quote).
    Fresh
    Stub "$bin\claude.exe" '2.1.310'
    Run $shell $mode @{ CONSTELLATION_MARKETPLACE = 'C:\path with space\checkout' }
    Check "${tag}: a marketplace path with spaces is one argument" (ArgsAre @('plugin', 'install', 'constellation', '--marketplace', 'C:\path with space\checkout')) ($argv -join ' ')
    Fresh
    Stub "$bin\claude.exe" '2.1.310'
    Run $shell $mode @{ CONSTELLATION_MARKETPLACE = 'C:\path with space\checkout\' }
    Check "${tag}: ...and a trailing backslash is dropped, not passed as a quote" (ArgsAre @('plugin', 'install', 'constellation', '--marketplace', 'C:\path with space\checkout')) ($argv -join ' ')

    # Versions compare as numbers, never as text: 2.1.1000 is newer than 2.1.299, 2.10.0 than 2.9.5.
    Fresh
    Stub "$bin\claude.exe" '2.1.1000'
    Run $shell $mode
    Check "${tag}: a claude 2.1.1000 on PATH is new enough" ($code -eq 0 -and (Installed "$bin\claude.exe")) "$code $ran $out"
    Fresh
    Stub "$appData\Claude\claude-code\2.1.299\aaaa\claude.exe" '2.1.299'
    $newest = "$appData\Claude\claude-code\2.1.1000\bbbb\claude.exe"
    Stub $newest '2.1.1000'
    Run $shell $mode
    Check "${tag}: Desktop 2.1.1000 wins over 2.1.299" ($code -eq 0 -and (Installed $newest)) "$code $ran $out"
    Fresh
    $newest = "$appData\Claude\claude-code\2.10.0\aaaa\claude.exe"
    Stub $newest '2.10.0'
    Stub "$appData\Claude\claude-code\2.9.5\bbbb\claude.exe" '2.9.5'
    Run $shell $mode
    Check "${tag}: Desktop 2.10.0 wins over 2.9.5" ($code -eq 0 -and (Installed $newest)) "$code $ran $out"

    # Brackets in a profile path are no wildcard.
    Fresh
    $script:localApp = Join-Path $case 'Jane [Work]\Local'
    New-Item -ItemType Directory -Force -Path $localApp | Out-Null
    $store = "$localApp\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\2.1.308\c17a819afb40\claude.exe"
    Stub $store '2.1.308'
    Run $shell $mode
    Check "${tag}: %LOCALAPPDATA% with [brackets] still finds the Desktop's claude" ($code -eq 0 -and (Installed $store)) "$code $ran $out"

    if ($mode -eq 'iex') {
      # npm puts claude.ps1 beside claude.cmd, and PowerShell prefers the .ps1, which the default policy refuses.
      Fresh
      Stub "$bin\claude-real.exe" '2.1.310'
      Set-Content -LiteralPath "$bin\claude.cmd" -Value '@"%~dp0claude-real.exe" %*' -Encoding Ascii
      Set-Content -LiteralPath "$bin\claude.ps1" -Value "Write-Output 'the .ps1 ran'" -Encoding Ascii
      Run $shell $mode @{} 'cmd /c exit 0;' 'Restricted'
      Check "${tag}: npm's claude.ps1 beside claude.cmd under the Restricted policy: the .cmd installs" ($ran -match 'plugin install constellation --marketplace nrzz/constellation$' -and $out -notmatch 'the \.ps1 ran' -and $out -notmatch 'running scripts is disabled' -and $out -match '(?m)^Done\.') "$ran $out"

      # A function or alias named claude in the person's session is not a claude to run.
      Fresh
      Stub "$bin\claude.exe" '2.1.310'
      Run $shell $mode @{} "cmd /c exit 0; function claude { 'a function named claude' };"
      Check "${tag}: a function named claude in the session is passed over for claude.exe" ((Installed "$bin\claude.exe") -and $out -notmatch 'a function named claude' -and $out -match '(?m)^Done\.') "$ran $out"

      # Claude Code writes UTF-8 into the pipe; the console's code page must not turn its marks into mojibake.
      Fresh
      Stub "$bin\claude.exe" '2.1.310'
      $transcript = Join-Path $case 'transcript.txt'
      Run $shell $mode @{ STUB_UTF8 = '1' } "[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(437); Start-Transcript -LiteralPath '$transcript' | Out-Null;"
      $seen = if (Test-Path -LiteralPath $transcript) { [IO.File]::ReadAllText($transcript) } else { '' }
      Check "${tag}: Claude Code's UTF-8 output reads right in a cp437 console" ($seen.Contains([string][char]0x2714) -and -not $seen.Contains([string][char]0x0393)) "$out"
    }
  }
}

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "== $passed passed, $failed failed"
if ($failed -ne 0) { exit 1 }
