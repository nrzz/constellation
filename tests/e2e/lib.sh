#!/usr/bin/env bash
# Helpers for driving the real Claude Code TUI, with the plugin loaded, inside tmux.
# The terminal is 170 columns: the transcript takes the left 94, a docked pane the rest.
S=${TMUX_SESSION:-e2e}
type_line() { tmux send-keys -t "$S" -l "$1"; sleep 1.2; tmux send-keys -t "$S" Enter; sleep "${2:-4}"; }
keys() { tmux send-keys -t "$S" "$@"; sleep 1.5; }
left() { tmux capture-pane -t "$S" -p | cut -c1-94 | sed 's/[[:space:]]*$//' | grep -v '^$'; }
right() { tmux capture-pane -t "$S" -p | cut -c95- | sed 's/[[:space:]]*$//' | grep -v '^$'; }
whole() { tmux capture-pane -t "$S" -p | sed 's/[[:space:]]*$//' | grep -v '^$'; }
PASSED=0; FAILED=0
expect_text() { # region-fn pattern label
  if "$1" | grep -q -- "$2"; then echo "PASS: $3"; PASSED=$((PASSED+1)); else echo "FAIL: $3 (no '$2')"; "$1" | tail -24; FAILED=$((FAILED+1)); fi
}
expect_absent() {
  if "$1" | grep -q -- "$2"; then echo "FAIL: $3 (found '$2')"; "$1" | tail -24; FAILED=$((FAILED+1)); else echo "PASS: $3"; PASSED=$((PASSED+1)); fi
}
summary() { echo "== $PASSED passed, $FAILED failed"; }
