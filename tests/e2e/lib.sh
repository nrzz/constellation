#!/usr/bin/env bash
# Helpers for driving the real Claude Code TUI, with the plugin loaded, inside tmux.
# Needs tmux and python3. The terminal is 170 columns: in the fullscreen renderer the transcript takes the left 94 and the docked pane the rest;
# the classic renderer seats the pane above the prompt, full width.
S=${TMUX_SESSION:-e2e}
type_line() { tmux send-keys -t "$S" -l "$1"; sleep 1.2; tmux send-keys -t "$S" Enter; sleep "${2:-4}"; }
keys() { tmux send-keys -t "$S" "$@"; sleep 1.5; }
E2E_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# Cells, not characters or bytes: see cells.py.
cells() { tmux capture-pane -t "$S" -p | python3 -X utf8 "$E2E_DIR/cells.py" "$@"; }
left() { cells cut 1 94 | grep -v '^$'; }
right() { cells cut 95 | grep -v '^$'; }
whole() { tmux capture-pane -t "$S" -p | sed 's/[[:space:]]*$//' | grep -v '^$'; }
PASSED=0; FAILED=0
expect_text() { # region-fn pattern label
  if "$1" | grep -q -- "$2"; then echo "PASS: $3"; PASSED=$((PASSED+1)); else echo "FAIL: $3 (no '$2')"; "$1" | tail -24; FAILED=$((FAILED+1)); fi
}
expect_absent() {
  if "$1" | grep -q -- "$2"; then echo "FAIL: $3 (found '$2')"; "$1" | tail -24; FAILED=$((FAILED+1)); else echo "PASS: $3"; PASSED=$((PASSED+1)); fi
}
expect_eq() { # actual expected label
  if [ "$1" = "$2" ]; then echo "PASS: $3"; PASSED=$((PASSED+1)); else echo "FAIL: $3 ('$1', wanted '$2')"; FAILED=$((FAILED+1)); fi
}
summary() { echo "== $PASSED passed, $FAILED failed"; }

# --- The mouse. The engine turns the terminal's mouse reporting on in its fullscreen renderer only (SGR, any motion);
# --- tmux hands a pane raw input, so an SGR sequence sent as keys reaches the engine as the terminal would send it.
# locate <text> [fromRow] [toRow]: "row col" (1-based cells) of the text's first cell on the screen, or nothing.
locate() { cells locate "$1" "${2:-1}" "${3:-200}"; }
rows_of() { local r; r=$(locate "$1") || return 1; echo "${r%% *}"; }
mouse() { tmux send-keys -t "$S" -l $'\e[<'"$1;$2;$3$4"; } # mouse <code> <col> <row> <M|m>
hover() { mouse 35 "$1" "$2" M; sleep 1.5; }
press() { mouse 0 "$1" "$2" M; }
release() { mouse 0 "$1" "$2" m; }
click() { press "$1" "$2"; sleep 0.15; release "$1" "$2"; sleep 2.5; }
drag() { press "$1" "$2"; sleep 0.2; mouse 32 "$(( $1 - 6 ))" "$2" M; sleep 0.2; mouse 32 "$3" "$4" M; sleep 0.2; release "$3" "$4"; sleep 3; }
# dot_near <row> <col>: "row col" of the ○ on the rows within two of that row that lies nearest the column (a topic's satellite).
dot_near() { cells dot "$1" "$2" ○; }
mouse_flags() { tmux display -p -t "$S" '#{mouse_sgr_flag}#{mouse_all_flag}'; }
