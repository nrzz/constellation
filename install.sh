#!/usr/bin/env sh
# Installs Constellation into Claude Code with one line:
#
#   curl -fsSL https://raw.githubusercontent.com/nrzz/constellation/main/install.sh | sh
#
# It runs `claude plugin install constellation --marketplace nrzz/constellation`, which adds the
# marketplace (this repository) and installs the plugin for every Claude Code on this machine:
# the terminal, the Desktop app's Code tab and VS Code share one plugin store. Nothing else is
# written. Mods need Claude Code 2.1.287 or later: the `claude` on PATH when it is new enough,
# else the newer one the Claude Desktop app keeps for its Code tab (CLAUDE_BIN names one outright).
# Inside any Claude Code you can instead type
#   /plugin install constellation --marketplace nrzz/constellation
set -eu

MARKETPLACE=${CONSTELLATION_MARKETPLACE:-nrzz/constellation}
NEED="2.1.287"

# The version a claude prints ("2.1.308 (Claude Code)" → 2.1.308; the first x.y.z on its line, as install.ps1
# reads it), or nothing.
version_of() {
  "$1" --version 2>/dev/null | sed -n 's/^[^0-9]*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1 || true
}
# Whether version $1 is $2 or later.
at_least() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" = "$1" ]
}
# A Windows path as this shell globs it (Git Bash, MSYS, Cygwin), or the path as it is.
unix_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi
}
# Every Claude Code the Claude Desktop app keeps for its Code tab: <its data>/claude-code/<version>/<build>/claude
# (on a Mac, when the build comes as a bundle: <build>/claude.app/Contents/MacOS/claude).
bundled() {
  app_data=""
  [ -n "${APPDATA:-}" ] && app_data="$(unix_path "$APPDATA")/Claude/claude-code"
  # No HOME (a bare `env -i`, a service account): only the folders that need none.
  home=${HOME:-}
  config=${XDG_CONFIG_HOME:-}
  if [ -z "$config" ] && [ -n "$home" ]; then config="$home/.config"; fi
  for root in ${home:+"$home/Library/Application Support/Claude/claude-code"} ${config:+"$config/Claude/claude-code"} ${app_data:+"$app_data"}; do
    for c in "$root"/*/*/claude "$root"/*/*/claude.app/Contents/MacOS/claude "$root"/*/*/claude.exe; do
      if [ -f "$c" ]; then printf '%s\n' "$c"; fi
    done
  done
  if [ -n "${LOCALAPPDATA:-}" ]; then
    local_app=$(unix_path "$LOCALAPPDATA")
    for c in "$local_app"/Claude-Data/*/claude-code/*/*/claude.exe "$local_app"/Packages/Claude_*/LocalCache/Roaming/Claude/claude-code/*/*/claude.exe; do
      if [ -f "$c" ]; then printf '%s\n' "$c"; fi
    done
  fi
  return 0
}

claude=""
version=""
if [ -n "${CLAUDE_BIN:-}" ]; then
  claude=$CLAUDE_BIN
  version=$(version_of "$claude")
else
  on_path=$(command -v claude 2>/dev/null || true)
  path_version=""
  [ -n "$on_path" ] && path_version=$(version_of "$on_path")
  # The one on PATH when it is new enough (or says no version, as before); else the newest the Desktop app keeps.
  if [ -n "$on_path" ] && { [ -z "$path_version" ] || at_least "$path_version" "$NEED"; }; then
    claude=$on_path
    version=$path_version
  else
    best=""
    best_version=""
    # One path per line; read keeps the spaces of "Application Support".
    found=$(bundled)
    if [ -n "$found" ]; then
      while IFS= read -r c; do
        v=$(version_of "$c")
        [ -n "$v" ] || continue
        if [ -z "$best_version" ] || ! at_least "$best_version" "$v"; then
          best=$c
          best_version=$v
        fi
      done <<EOF
$found
EOF
    fi
    if [ -n "$best" ] && at_least "$best_version" "$NEED"; then
      if [ -n "$on_path" ]; then
        echo "Claude Code $path_version is on PATH; mods need $NEED or later. Using the Claude Desktop app's own $best_version:"
      else
        echo "Claude Code (the 'claude' command) is not on PATH. Using the Claude Desktop app's own $best_version:"
      fi
      echo "  $best"
      claude=$best
      version=$best_version
    elif [ -n "$on_path" ]; then
      echo "Claude Code $path_version is on PATH; mods need $NEED or later. Update it (claude update), or type inside a newer Claude Code:"
      echo "  /plugin install constellation --marketplace $MARKETPLACE"
      exit 1
    else
      echo "Claude Code (the 'claude' command) is not on PATH."
      echo "Install it from https://code.claude.com/docs/en/overview, or inside the Desktop app's Code tab type:"
      echo "  /plugin install constellation --marketplace $MARKETPLACE"
      exit 1
    fi
  fi
fi

if [ -n "$version" ] && ! at_least "$version" "$NEED"; then
  echo "Claude Code $version ($claude) is older than $NEED, which mods need. Update it, or type inside a newer Claude Code:"
  echo "  /plugin install constellation --marketplace $MARKETPLACE"
  exit 1
fi

echo "Installing Constellation from $MARKETPLACE with Claude Code ${version:-?}…"
"$claude" plugin install constellation --marketplace "$MARKETPLACE"
echo
echo "Done. Open Claude Code in any project folder: the band above the prompt offers the folder's topics,"
echo "/map opens the map, /map help lists every command and key. To remove it: claude plugin uninstall constellation"
