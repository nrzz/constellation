#!/usr/bin/env bash
# Helpers for driving the real Claude Code TUI, with the plugin loaded, inside tmux.
# The terminal is 170 columns: in the fullscreen renderer the transcript takes the left 94 and the docked pane the rest;
# the classic renderer seats the pane above the prompt, full width.
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
expect_eq() { # actual expected label
  if [ "$1" = "$2" ]; then echo "PASS: $3"; PASSED=$((PASSED+1)); else echo "FAIL: $3 ('$1', wanted '$2')"; FAILED=$((FAILED+1)); fi
}
summary() { echo "== $PASSED passed, $FAILED failed"; }

# --- The mouse. The engine turns the terminal's mouse reporting on in its fullscreen renderer only (SGR, any motion);
# --- tmux hands a pane raw input, so an SGR sequence sent as keys reaches the engine as the terminal would send it.
# locate <text> [fromRow] [toRow]: "row col" (1-based cells) of the text's first character on the screen, or nothing.
locate() {
  local pat=$1 lo=${2:-1} hi=${3:-200} n=0 line pre
  while IFS= read -r line; do
    n=$((n+1)); [ "$n" -lt "$lo" ] && continue; [ "$n" -gt "$hi" ] && break
    case $line in *"$pat"*) pre=${line%%"$pat"*}; echo "$n $((${#pre}+1))"; return 0;; esac
  done < <(tmux capture-pane -t "$S" -p)
  return 1
}
# rows_of <text>: the row of the first line holding the text.
rows_of() { local r; r=$(locate "$1") || return 1; echo "${r%% *}"; }
mouse() { tmux send-keys -t "$S" -l $'\e[<'"$1;$2;$3$4"; } # mouse <code> <col> <row> <M|m>
hover() { mouse 35 "$1" "$2" M; sleep 1.5; }
press() { mouse 0 "$1" "$2" M; }
release() { mouse 0 "$1" "$2" m; }
click() { press "$1" "$2"; sleep 0.15; release "$1" "$2"; sleep 2.5; }
drag() { press "$1" "$2"; sleep 0.2; mouse 32 "$(( $1 - 6 ))" "$2" M; sleep 0.2; mouse 32 "$3" "$4" M; sleep 0.2; release "$3" "$4"; sleep 3; }
# dot_near <row> <col>: "row col" of the ○ on the rows just above or below that lies closest to the column (a topic's satellite).
dot_near() {
  local r0=$1 c0=$2 best= bestd=999 r line rest c d
  for r in $((r0-2)) $((r0-1)) $((r0+1)) $((r0+2)); do
    line=$(tmux capture-pane -t "$S" -p | sed -n "${r}p"); rest=$line; c=0
    while [ -n "$rest" ]; do
      case $rest in *○*) ;; *) break;; esac
      local pre=${rest%%○*}; c=$((c + ${#pre} + 1)); rest=${rest#*○}
      d=$((c > c0 ? c - c0 : c0 - c)); if [ "$d" -lt "$bestd" ]; then bestd=$d; best="$r $c"; fi
    done
  done
  [ -n "$best" ] && echo "$best"
}
mouse_flags() { tmux display -p -t "$S" '#{mouse_sgr_flag}#{mouse_all_flag}'; }
