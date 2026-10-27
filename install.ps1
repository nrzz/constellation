# Installs Constellation into Claude Code with one line (Windows PowerShell 5.1 or PowerShell 7):
#
#   irm https://raw.githubusercontent.com/nrzz/constellation/main/install.ps1 | iex
#
# It runs `claude plugin install constellation --marketplace nrzz/constellation`, which adds the
# marketplace (this repository) and installs the plugin for every Claude Code on this machine:
# the terminal, the Desktop app's Code tab and VS Code share one plugin store. Nothing else is
# written. Mods need Claude Code 2.1.287 or later: the `claude` on PATH when it is new enough,
# else the newer one the Claude Desktop app keeps for its Code tab ($env:CLAUDE_BIN names one
# outright). Inside any Claude Code you can instead type
#   /plugin install constellation --marketplace nrzz/constellation
#
# All of it runs inside a script block: piped into iex it shares your session, where a bare `exit`
# would close the window and its functions and variables would stay behind.

& {
  function Install-Constellation {
    $marketplace = if ($env:CONSTELLATION_MARKETPLACE) { $env:CONSTELLATION_MARKETPLACE } else { 'nrzz/constellation' }
    $need = [version]'2.1.287'

    # The version a claude prints ("2.1.308 (Claude Code)" -> 2.1.308), or $null.
    function Get-ClaudeVersion([string]$exe) {
      try { $raw = & $exe --version 2>$null | Select-Object -First 1 } catch { return $null }
      if ("$raw" -match '(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
      return $null
    }

    # Every Claude Code the Claude Desktop app keeps for its Code tab, newest first:
    # <its data>\claude-code\<version>\<build>\claude.exe, in the Store app's and the installer app's folders.
    function Get-BundledClaude {
      $patterns = @()
      if ($env:LOCALAPPDATA) {
        $patterns += Join-Path $env:LOCALAPPDATA 'Claude-Data\*\claude-code\*\*\claude.exe'
        $patterns += Join-Path $env:LOCALAPPDATA 'Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\*\*\claude.exe'
      }
      if ($env:APPDATA) { $patterns += Join-Path $env:APPDATA 'Claude\claude-code\*\*\claude.exe' }
      $found = foreach ($p in $patterns) { Get-Item -Path $p -ErrorAction SilentlyContinue }
      $found |
        Where-Object { $_ -and $_.Directory.Parent.Name -match '^\d+\.\d+\.\d+$' } |
        Sort-Object -Property @{ Expression = { [version]$_.Directory.Parent.Name } } -Descending |
        ForEach-Object { $_.FullName }
    }

    $claude = $null
    $version = $null
    if ($env:CLAUDE_BIN) {
      $claude = $env:CLAUDE_BIN
      $version = Get-ClaudeVersion $claude
    } else {
      $onPath = Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1
      $pathVersion = if ($onPath) { Get-ClaudeVersion $onPath.Source } else { $null }
      # The one on PATH when it is new enough (or says no version, as before); else the newest the Desktop app keeps.
      if ($onPath -and (-not $pathVersion -or $pathVersion -ge $need)) {
        $claude = $onPath.Source
        $version = $pathVersion
      } else {
        $best = $null
        $bestVersion = $null
        foreach ($c in @(Get-BundledClaude)) {
          $v = Get-ClaudeVersion $c
          if ($v -and (-not $bestVersion -or $v -gt $bestVersion)) {
            $best = $c
            $bestVersion = $v
          }
        }
        if ($best -and $bestVersion -ge $need) {
          if ($onPath) {
            Write-Host "Claude Code $pathVersion is on PATH; mods need $need or later. Using the Claude Desktop app's own ${bestVersion}:"
          } else {
            Write-Host "Claude Code (the 'claude' command) is not on PATH. Using the Claude Desktop app's own ${bestVersion}:"
          }
          Write-Host "  $best"
          $claude = $best
          $version = $bestVersion
        } elseif ($onPath) {
          Write-Host "Claude Code $pathVersion is on PATH; mods need $need or later. Update it (claude update), or type inside a newer Claude Code:"
          Write-Host "  /plugin install constellation --marketplace $marketplace"
          return 1
        } else {
          Write-Host "Claude Code (the 'claude' command) is not on PATH."
          Write-Host "Install it from https://code.claude.com/docs/en/overview, or inside the Desktop app's Code tab type:"
          Write-Host "  /plugin install constellation --marketplace $marketplace"
          return 1
        }
      }
    }

    if ($version -and $version -lt $need) {
      Write-Host "Claude Code $version ($claude) is older than $need, which mods need. Update it, or type inside a newer Claude Code:"
      Write-Host "  /plugin install constellation --marketplace $marketplace"
      return 1
    }

    Write-Host "Installing Constellation from $marketplace with Claude Code $(if ($version) { $version } else { '?' })..."
    & $claude plugin install constellation --marketplace $marketplace | Out-Host
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    Write-Host ""
    Write-Host "Done. Open Claude Code in any project folder: the band above the prompt offers the folder's topics,"
    Write-Host "/map opens the map, /map help lists every command and key. To remove it: claude plugin uninstall constellation"
    return 0
  }

  $code = Install-Constellation
  # Run as a file (powershell -File install.ps1), the exit code is the result; piped into iex, the window stays open.
  if ($PSCommandPath) { exit $code } elseif ($code -ne 0) { $global:LASTEXITCODE = $code }
}
