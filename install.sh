#!/usr/bin/env sh
# Installs Constellation into Claude Code with one line:
#
#   curl -fsSL https://raw.githubusercontent.com/nrzz/constellation/main/install.sh | sh
#
# It runs `claude plugin install constellation --marketplace nrzz/constellation`, which adds the
# marketplace (this repository) and installs the plugin for every Claude Code on this machine:
# the terminal, the Desktop app's Code tab and VS Code share one plugin store. Nothing else is
# written. Needs `claude` 2.1.287 or later on PATH; inside any Claude Code you can instead type
#   /plugin install constellation --marketplace nrzz/constellation
set -eu

MARKETPLACE=${CONSTELLATION_MARKETPLACE:-nrzz/constellation}

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code (the 'claude' command) is not on PATH."
  echo "Install it from https://code.claude.com/docs/en/overview, or inside the Desktop app's Code tab type:"
  echo "  /plugin install constellation --marketplace $MARKETPLACE"
  exit 1
fi

version=$(claude --version 2>/dev/null | sed -n 's/^\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1)
need="2.1.287"
if [ -n "$version" ]; then
  newest=$(printf '%s\n%s\n' "$need" "$version" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
  if [ "$newest" != "$version" ]; then
    echo "Claude Code $version is on PATH; mods need $need or later. Update it (claude update), or type inside a newer Claude Code:"
    echo "  /plugin install constellation --marketplace $MARKETPLACE"
    exit 1
  fi
fi

echo "Installing Constellation from $MARKETPLACE with Claude Code ${version:-?}…"
claude plugin install constellation --marketplace "$MARKETPLACE"
echo
echo "Done. Open Claude Code in any project folder: the band above the prompt offers the folder's topics,"
echo "/map opens the map, /map help lists every command and key. To remove it: claude plugin uninstall constellation"
