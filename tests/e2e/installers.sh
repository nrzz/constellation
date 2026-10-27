#!/usr/bin/env bash
# The one-line installer (install.sh) against stand-in `claude` commands, under sh, dash and bash:
#
#   bash tests/e2e/installers.sh
#
# Each case has its own HOME and PATH. A stand-in prints the version it is given and logs the arguments it was
# run with, so a case can tell which claude installed the plugin, and with what. Covers: a new enough claude on
# PATH; one too old with the Desktop app's newer Claude Code beside it (macOS, Linux, and the Windows layouts as
# Git Bash sees them); none on PATH; several Desktop versions (the newest wins); nothing new enough anywhere;
# CLAUDE_BIN; a version-less claude; and a failing install.
# tests/e2e/installers.ps1 runs the same cases against install.ps1 on Windows.
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
PASS=0
FAIL=0
check() { # <label> <ok:0|1> [detail]
  if [ "$2" = 0 ]; then
    PASS=$((PASS + 1))
    echo "PASS: $1"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $1${3:+ ($3)}"
  fi
}

# A stand-in claude at <path> that says <version> (empty: says no version) and logs its arguments to $LOG.
stub() { # <path> <version>
  mkdir -p "$(dirname "$1")"
  cat >"$1" <<EOF
#!/bin/sh
if [ "\$1" = "--version" ]; then
  [ -n "$2" ] && echo "$2 (Claude Code)"
  exit 0
fi
echo "$1 \$*" >>"\$LOG"
[ -n "\${STUB_FAIL:-}" ] && exit 3
exit 0
EOF
  chmod +x "$1"
}

# Runs install.sh under <shell> in a fresh HOME with only <bin> (and the system's tools) on PATH; extra env as
# NAME=value words after the shell. Sets OUT, CODE and RAN (the log of claude runs).
run() { # <shell> [NAME=value…]
  local shell=$1
  shift
  OUT=$(env -i HOME="$HOME_DIR" PATH="$BIN:/usr/bin:/bin" LOG="$LOG" "$@" "$shell" "$REPO/install.sh" 2>&1)
  CODE=$?
  RAN=$(cat "$LOG" 2>/dev/null)
}

fresh() {
  CASE=$(mktemp -d)
  HOME_DIR="$CASE/home"
  BIN="$CASE/bin"
  LOG="$CASE/log"
  mkdir -p "$HOME_DIR" "$BIN"
}

MAC='Library/Application Support/Claude/claude-code'
for shell in sh dash bash; do
  command -v "$shell" >/dev/null 2>&1 || { echo "(no $shell here; skipped)"; continue; }
  echo "== $shell"

  fresh
  stub "$BIN/claude" 2.1.310
  run "$shell"
  check "$shell: a new enough claude on PATH installs the plugin" "$([ $CODE = 0 ] && [ "$RAN" = "$BIN/claude plugin install constellation --marketplace nrzz/constellation" ] && echo 0 || echo 1)" "$CODE: $RAN"
  check "$shell: …and says which version" "$(echo "$OUT" | grep -q 'with Claude Code 2.1.310' && echo 0 || echo 1)" "$OUT"

  fresh
  stub "$BIN/claude" 2.1.283
  stub "$HOME_DIR/$MAC/2.1.308/c17a819afb40/claude" 2.1.308
  run "$shell"
  check "$shell: an old claude on PATH (2.1.283) falls back to the Desktop app's 2.1.308 (macOS)" "$([ $CODE = 0 ] && [ "$RAN" = "$HOME_DIR/$MAC/2.1.308/c17a819afb40/claude plugin install constellation --marketplace nrzz/constellation" ] && echo 0 || echo 1)" "$CODE: $RAN"
  check "$shell: …and says why" "$(echo "$OUT" | grep -q "Claude Code 2.1.283 is on PATH; mods need 2.1.287 or later. Using the Claude Desktop app's own 2.1.308" && echo 0 || echo 1)" "$OUT"

  fresh
  stub "$HOME_DIR/.config/Claude/claude-code/2.1.304/aaaa/claude" 2.1.304
  stub "$HOME_DIR/.config/Claude/claude-code/2.1.311/bbbb/claude" 2.1.311
  stub "$HOME_DIR/.config/Claude/claude-code/2.1.308/cccc/claude" 2.1.308
  run "$shell"
  check "$shell: no claude on PATH, three Desktop versions: the newest installs (Linux layout)" "$([ $CODE = 0 ] && echo "$RAN" | grep -q '^.*/2.1.311/bbbb/claude plugin install' && echo 0 || echo 1)" "$CODE: $RAN"
  check "$shell: …and says claude is not on PATH" "$(echo "$OUT" | grep -q "is not on PATH. Using the Claude Desktop app's own 2.1.311" && echo 0 || echo 1)" "$OUT"

  fresh
  stub "$BIN/claude" 2.1.283
  stub "$CASE/win/Local/Claude-Data/claude_pzs8sxrjxfjjc/claude-code/2.1.308/c17a819afb40/claude.exe" 2.1.308
  run "$shell" LOCALAPPDATA="$CASE/win/Local"
  check "$shell: Windows, the Store app: %LOCALAPPDATA%\\Claude-Data\\…\\claude-code\\2.1.308\\…\\claude.exe" "$([ $CODE = 0 ] && echo "$RAN" | grep -q 'Claude-Data/claude_pzs8sxrjxfjjc/claude-code/2.1.308/c17a819afb40/claude.exe plugin install' && echo 0 || echo 1)" "$CODE: $RAN"

  fresh
  stub "$CASE/win/Roaming/Claude/claude-code/2.1.309/dddd/claude.exe" 2.1.309
  run "$shell" APPDATA="$CASE/win/Roaming"
  check "$shell: Windows, the installer app: %APPDATA%\\Claude\\claude-code\\2.1.309\\…\\claude.exe" "$([ $CODE = 0 ] && echo "$RAN" | grep -q 'Roaming/Claude/claude-code/2.1.309/dddd/claude.exe plugin install' && echo 0 || echo 1)" "$CODE: $RAN"

  fresh
  stub "$CASE/win/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude-code/2.1.310/eeee/claude.exe" 2.1.310
  run "$shell" LOCALAPPDATA="$CASE/win/Local"
  check "$shell: Windows, the Store app's redirected roaming folder" "$([ $CODE = 0 ] && echo "$RAN" | grep -q 'LocalCache/Roaming/Claude/claude-code/2.1.310/eeee/claude.exe plugin install' && echo 0 || echo 1)" "$CODE: $RAN"

  fresh
  stub "$BIN/claude" 2.1.283
  stub "$HOME_DIR/$MAC/2.1.250/ffff/claude" 2.1.250
  run "$shell"
  check "$shell: nothing new enough anywhere: no install, exit 1" "$([ $CODE = 1 ] && [ -z "$RAN" ] && echo 0 || echo 1)" "$CODE: $RAN"
  check "$shell: …saying to update, or to type the command in a newer Claude Code" "$(echo "$OUT" | grep -q 'Claude Code 2.1.283 is on PATH; mods need 2.1.287 or later. Update it' && echo "$OUT" | grep -q '/plugin install constellation --marketplace nrzz/constellation' && echo 0 || echo 1)" "$OUT"

  fresh
  run "$shell"
  check "$shell: no claude at all: exit 1, pointing to the install docs and the Desktop's Code tab" "$([ $CODE = 1 ] && echo "$OUT" | grep -q "is not on PATH" && echo "$OUT" | grep -q "Code tab" && echo 0 || echo 1)" "$CODE: $OUT"

  fresh
  stub "$BIN/claude" 2.1.283
  stub "$CASE/elsewhere/claude" 2.1.311
  run "$shell" CLAUDE_BIN="$CASE/elsewhere/claude"
  check "$shell: CLAUDE_BIN names the claude outright" "$([ $CODE = 0 ] && [ "$RAN" = "$CASE/elsewhere/claude plugin install constellation --marketplace nrzz/constellation" ] && echo 0 || echo 1)" "$CODE: $RAN"

  fresh
  stub "$CASE/elsewhere/claude" 2.1.200
  run "$shell" CLAUDE_BIN="$CASE/elsewhere/claude"
  check "$shell: …and is refused when too old" "$([ $CODE = 1 ] && [ -z "$RAN" ] && echo "$OUT" | grep -q 'older than 2.1.287' && echo 0 || echo 1)" "$CODE: $RAN $OUT"

  fresh
  stub "$BIN/claude" ""
  run "$shell"
  check "$shell: a claude on PATH that prints no version is trusted, as before" "$([ $CODE = 0 ] && [ -n "$RAN" ] && echo 0 || echo 1)" "$CODE: $RAN"

  fresh
  stub "$BIN/claude" 2.1.310
  run "$shell" STUB_FAIL=1
  check "$shell: a failing install fails the script" "$([ $CODE != 0 ] && echo 0 || echo 1)" "$CODE"
  check "$shell: …without claiming it is done" "$(echo "$OUT" | grep -q '^Done' && echo 1 || echo 0)" "$OUT"

  fresh
  stub "$BIN/claude" 2.1.310
  run "$shell" CONSTELLATION_MARKETPLACE=/path/to/checkout
  check "$shell: CONSTELLATION_MARKETPLACE installs from another marketplace" "$([ $CODE = 0 ] && [ "$RAN" = "$BIN/claude plugin install constellation --marketplace /path/to/checkout" ] && echo 0 || echo 1)" "$CODE: $RAN"
done

echo "== $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
