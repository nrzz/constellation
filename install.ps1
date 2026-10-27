# Installs Constellation into Claude Code with one line (Windows PowerShell 5.1 or PowerShell 7):
#
#   irm https://raw.githubusercontent.com/nrzz/constellation/main/install.ps1 | iex
#
# It runs `claude plugin install constellation --marketplace nrzz/constellation`, which adds the
# marketplace (this repository) and installs the plugin for every Claude Code on this machine:
# the terminal, the Desktop app's Code tab and VS Code share one plugin store. Nothing else is
# written. Needs `claude` 2.1.287 or later on PATH; inside any Claude Code you can instead type
#   /plugin install constellation --marketplace nrzz/constellation
$ErrorActionPreference = 'Stop'
$marketplace = if ($env:CONSTELLATION_MARKETPLACE) { $env:CONSTELLATION_MARKETPLACE } else { 'nrzz/constellation' }

$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
  Write-Host "Claude Code (the 'claude' command) is not on PATH."
  Write-Host "Install it from https://code.claude.com/docs/en/overview, or inside the Desktop app's Code tab type:"
  Write-Host "  /plugin install constellation --marketplace $marketplace"
  exit 1
}

$raw = (& claude --version 2>$null | Select-Object -First 1)
$version = $null
if ($raw -match '(\d+)\.(\d+)\.(\d+)') { $version = [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
if ($version -and $version -lt [version]'2.1.287') {
  Write-Host "Claude Code $version is on PATH; mods need 2.1.287 or later. Update it (claude update), or type inside a newer Claude Code:"
  Write-Host "  /plugin install constellation --marketplace $marketplace"
  exit 1
}

Write-Host "Installing Constellation from $marketplace with Claude Code $version…"
& claude plugin install constellation --marketplace $marketplace
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
Write-Host "Done. Open Claude Code in any project folder: the band above the prompt offers the folder's topics,"
Write-Host "/map opens the map, /map help lists every command and key. To remove it: claude plugin uninstall constellation"
