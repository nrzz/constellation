#!/usr/bin/env bash
# End to end: the real Claude Code TUI with Constellation loaded from this checkout, driven in tmux.
#
#   bash tests/e2e/tui.sh                    # about six minutes; one short model turn
#   E2E_SKIP_MODEL=1 bash tests/e2e/tui.sh   # the same without the model turn
#   E2E_INSTALL=1 bash tests/e2e/tui.sh      # install the plugin from this checkout first (the one-line
#                                            # install, with the checkout as the marketplace) and run it
#                                            # as installed rather than from --plugin-dir
#
# Three passes, each its own freshly seeded config and project folder so one never leaks into the next.
#  1. The fullscreen renderer (the engine's default after its first start; `/tui fullscreen`) docks the pane
#     beside the transcript and reports the mouse. Real SGR mouse events hover, click and walk the text map;
#     then the commands and the handoff loop (band join, /pickup, /park, the model quoting the note, /clear).
#  2. The drag, on its own clean fixture so its moves cannot disturb pass 1's counts: a drop on nothing moves
#     nothing; a satellite dragged onto Unsorted moves there and stays, through a rescan; Undo, by mouse, puts it back.
#  3. The classic renderer (`/tui default`), which seats the pane above the prompt and reports no mouse: the
#     hint says so, a click does nothing, Tab and Enter pick a topic, and the hotkeys work.
# Isolated from your own data: each pass has its own CLAUDE_CONFIG_DIR (your credentials file is copied in so
# the engine is signed in) seeded with the three fixture transcripts.
# Needs tmux, python3 and `claude` on PATH. Answers the engine's first-run dialogs itself. Prints PASS/FAIL per check
# and exits 1 on any failure; the tmux session is left running on failure for a look (`tmux attach -t e2e`),
# and killed on success.
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=lib.sh
source "$REPO/tests/e2e/lib.sh"
F="$REPO/tests/fixtures"
CFGS=()

# A fresh config dir seeded with the three fixture transcripts (dated so the band's ages are stable) and the
# engine's renderer choice; echoes its path. The demo folder it reads lives beside it.
seed_cfg() { # <fullscreen|default>
  local cfg demo slug
  cfg=$(mktemp -d); demo=$(mktemp -d)/demo-app
  slug=$(printf '%s' "$demo" | sed 's/[^a-zA-Z0-9]/-/g')
  mkdir -p "$demo" "$cfg/projects/$slug"
  cp "$F/checkout-tests.jsonl" "$cfg/projects/$slug/11111111-aaaa-4bbb-8ccc-000000000001.jsonl"
  cp "$F/checkout-rounding.jsonl" "$cfg/projects/$slug/44444444-aaaa-4bbb-8ccc-000000000004.jsonl"
  cp "$F/orders-pagination.jsonl" "$cfg/projects/$slug/22222222-aaaa-4bbb-8ccc-000000000002.jsonl"
  touch -d '2026-10-20 09:05' "$cfg/projects/$slug/11111111-aaaa-4bbb-8ccc-000000000001.jsonl"
  touch -d '2026-10-18 15:04' "$cfg/projects/$slug/44444444-aaaa-4bbb-8ccc-000000000004.jsonl"
  touch -d '2026-10-19 14:03' "$cfg/projects/$slug/22222222-aaaa-4bbb-8ccc-000000000002.jsonl"
  [ -f "$HOME/.claude/.credentials.json" ] && cp "$HOME/.claude/.credentials.json" "$cfg/"
  printf '# demo\n' > "$demo/README.md"
  printf '{"tui":"%s"}\n' "$1" > "$cfg/settings.json"
  if [ -n "${E2E_INSTALL:-}" ]; then
    # The one-line installer itself, with the checkout as its marketplace.
    CLAUDE_CONFIG_DIR=$cfg CONSTELLATION_MARKETPLACE=$REPO sh "$REPO/install.sh" >"$cfg/install.log" 2>&1 \
      || { echo "FAIL: the one-line install from the checkout"; cat "$cfg/install.log"; exit 1; }
  fi
  CFGS+=("$cfg"); echo "$cfg|$demo"
}

LOAD="--plugin-dir $REPO"; [ -n "${E2E_INSTALL:-}" ] && LOAD=""
start_engine() { # <cfg> <demo>
  tmux kill-session -t "$S" 2>/dev/null
  tmux new-session -d -s "$S" -x 170 -y 60 -c "$2" "CLAUDE_CONFIG_DIR=$1 claude $LOAD"
}
clear_input() { tmux send-keys -t "$S" C-u; sleep 0.5; }
# The engine's own dialogs, answered as they come, until the prompt and the band are up.
settle() {
  for _ in $(seq 1 "${1:-40}"); do
    local screen; screen=$(whole)
    if grep -q "Choose the text style" <<<"$screen"; then tmux send-keys -t "$S" Enter; sleep 3; continue; fi
    if grep -q "Press Enter to continue" <<<"$screen"; then tmux send-keys -t "$S" Enter; sleep 3; continue; fi
    if grep -q "trust this folder" <<<"$screen"; then tmux send-keys -t "$S" Down; sleep 0.5; tmux send-keys -t "$S" Enter; sleep 5; continue; fi
    if grep -q "Can Anthropic look at your session" <<<"$screen"; then tmux send-keys -t "$S" d; sleep 3; continue; fi
    if grep -q "esc to interrupt" <<<"$screen"; then sleep 2; continue; fi
    if grep -q "continuing which topic?" <<<"$screen"; then return 0; fi
    sleep 2
  done
  echo "the band never came up; screen:"; whole | tail -30; return 1
}
wait_idle() { for _ in $(seq 1 "${1:-60}"); do if whole | grep -q "esc to interrupt"; then sleep 2; else return 0; fi; done; }
cleanup() { tmux kill-session -t "$S" 2>/dev/null; if [ "$FAILED" -eq 0 ]; then for c in "${CFGS[@]}"; do rm -rf "$c"; done; fi; }

echo "== pass 1: the fullscreen renderer (docked pane, mouse on)"
IFS='|' read -r CFG DEMO <<<"$(seed_cfg fullscreen)"
echo "config: $CFG"; echo "demo:   $DEMO"
[ -n "${E2E_INSTALL:-}" ] && echo "PASS: the one-line install from the checkout"
start_engine "$CFG" "$DEMO"
settle 45 || { summary; cleanup; exit 1; }
expect_text whole "Checkout Cart" "the band offers the folder's topic"

type_line "/map" 6
expect_text whole "CONSTELLATION" "/map opens the pane"
expect_text whole "JUMP BACK IN" "the pane shows the recent sessions"
expect_text right "Click or Tab to a topic" "the docked terminal map draws its hint"
expect_text right "○ Checkout Cart 2" "the terminal map draws the topic"
expect_eq "$(mouse_flags)" "11" "the fullscreen renderer has the terminal reporting the mouse (SGR, any motion)"

# The pointer on the text map, as the terminal would send it. These are all UI only: no store is written, so the
# command checks below still see the clean fixture.
if read -r TR TC <<<"$(locate '○ Checkout Cart' 1 60)"; then
  hover $((TC+5)) "$TR"
  expect_text right "Checkout Cart · 2 sessions · Enter to focus" "hovering a topic traces it (the hint names it)"
  hover 30 30
  expect_text right "Click or Tab to a topic" "the pointer leaving the map clears the trace"
  click $((TC+5)) "$TR"
  expect_text right "‹ All topics" "a click on a topic focuses it: the back pill"
  expect_text right "1 Checkout total" "…and its chain, numbered in time order"
  expect_absent right "‹ ‹" "the back pill draws its label once, not a chevron then a label that starts with one"
  if read -r SR SC <<<"$(locate '1 Checkout total' 1 60)"; then
    click $((SC+5)) "$SR"
    expect_text right "\[1\] Checkout total rounding" "a click on a step's label, past its number, opens that session"
    expect_text right "Pick up here" "…with its card"
    # The map takes no keys, so the pane's hotkeys work straight after a click on it.
    keys h
    expect_text right "Close help" "a hotkey right after a click on the map works (h opens the help)"
    keys h
    expect_absent right "Close help" "…and h again closes it"
    keys Escape
    expect_absent right "Pick up here" "Esc backs one level: the card closes"
    expect_text right "‹ All topics" "…and the chain stays"
    keys h
    expect_text right "Close help" "the pane keeps the keyboard after Esc: h still opens the help"
    keys Escape
    expect_absent right "Close help" "…and Esc closes it"
    expect_text right "‹ All topics" "…leaving the chain"
  else
    echo "FAIL: the step label is not on the screen"; FAILED=$((FAILED+1)); right | tail -30
  fi
  if read -r SR SC <<<"$(locate '2 Fix flaky' 1 60)"; then
    click $((SC+4)) "$SR"
    expect_text right "\[2\] Fix flaky cart wait" "a click on the other step opens it"
  else
    echo "FAIL: the second step is not on the screen"; FAILED=$((FAILED+1)); right | tail -30
  fi
  if read -r BR BC <<<"$(locate '‹ All topics' 1 60)"; then
    click $((BC+3)) "$BR"
    expect_text right "JUMP BACK IN" "a click on the back pill returns to all topics"
  else
    echo "FAIL: the back pill is not on the screen"; FAILED=$((FAILED+1)); right | tail -30
  fi
  read -r TR TC <<<"$(locate '○ Checkout Cart' 1 60)"
  if read -r DR DC <<<"$(dot_near "$TR" "$TC")"; then
    click "$DC" "$DR"
    expect_text right "Pick up here" "a click on a session's dot opens its card in the chain"
    keys Escape; keys Escape
    expect_text right "JUMP BACK IN" "Esc twice: the card, then the chain"
    expect_text right "CONSTELLATION" "…and the pane stays open with nothing more to back out of yet"
  else
    echo "FAIL: no session dot near the topic"; FAILED=$((FAILED+1)); right | tail -30
  fi
  # The pane's own buttons take the mouse too.
  if read -r HR HC <<<"$(locate '[ Help ]' 1 12)"; then
    click $((HC+3)) "$HR"
    expect_text right "Close help" "a mouse click on the header's Help button opens the help"
    read -r HR HC <<<"$(locate 'Close help' 1 12)"; click $((HC+3)) "$HR"
    expect_absent right "Close help" "…and a click on Close help closes it"
  else
    echo "FAIL: the Help button is not on the screen"; FAILED=$((FAILED+1)); right | tail -30
  fi
else
  echo "FAIL: the topic is not on the screen"; FAILED=$((FAILED+1)); right | tail -30
fi

# Escape at the empty prompt backs the pane out but leaves the keyboard with the prompt: the next words type, not fire hotkeys.
keys C-x Tab; sleep 1
keys Escape
tmux send-keys -t "$S" -l "hello"; sleep 1.5
expect_absent right "Close help" "Esc at the empty prompt leaves the keyboard there: typing h-e-l-l-o fires no hotkey"
expect_text left "hello" "…and the letters land in the prompt"
clear_input
# Back to the pane, which /map opens focused.
type_line "/map" 5

# The hotkeys from the keyboard alone.
keys h
expect_text whole "Close help" "h opens the help card (the header's button flips)"
keys Escape
expect_text whole "\[ Help \]" "Esc closes the help first"
keys Escape; sleep 2
expect_absent whole "CONSTELLATION" "Esc with nothing left closes the pane"

type_line "/map help" 4
expect_text whole "/pickup list" "/map help prints the commands"
type_line "/map here" 5
expect_text whole "Constellation map (as of now)" "/map here prints the map"
expect_text whole "1. Checkout Cart (2)" "…as a numbered outline in a terminal"

settle 10 >/dev/null || true
clear_input; tmux send-keys -t "$S" "1"; sleep 6
expect_text whole "♦ Checkout Cart · step 3" "a bare digit in the empty prompt joins through the band; the status line follows"

type_line "/pickup list" 5
expect_text whole "1. Checkout total rounding" "/pickup list numbers the chain"
expect_text whole "2. Fix flaky cart wait" "…and its latest step"
type_line "/park Replaced the wait with findByText; the CI re-run is still pending." 5
expect_text whole "Parked: “Replaced the wait with findByText" "/park saves the note"
expect_text whole "note saved" "the status line shows the note"
type_line "/topic" 4
expect_text whole "This session is in Checkout Cart" "/topic knows the topic"
type_line "/map find cursor" 6
expect_text whole "1 session match" "/map find reports the match"
expect_text whole "1 match" "the pane shows the match count on the Unsorted dot"
type_line "/map close" 4
expect_text whole "Constellation closed." "/map close"

if [ -z "${E2E_SKIP_MODEL:-}" ]; then
  clear_input
  type_line "Quote the handoff note you were given about the cart tests, in one line, and nothing else." 12
  wait_idle 90
  expect_text whole "findByText" "the real model received the injected handoff note"
else
  echo "SKIP: the model turn (E2E_SKIP_MODEL is set)"
fi

settle 10 >/dev/null || true
clear_input
type_line "/clear" 8
settle 20 >/dev/null || true
expect_text whole "continuing which topic?" "after /clear the band offers the chooser again"
type_line "/topic" 5
expect_text whole "This session has no topic yet" "after /clear, /topic knows the new session"

echo "== pass 2: the drag, on a clean fixture of its own"
IFS='|' read -r CFG DEMO <<<"$(seed_cfg fullscreen)"
start_engine "$CFG" "$DEMO"
settle 45 || { summary; cleanup; exit 1; }
type_line "/map" 6
expect_text right "○ Checkout Cart 2" "the clean fixture: the topic has two sessions"
expect_text right "○ Unsorted 1" "…and Unsorted one"
if read -r TR TC <<<"$(locate '○ Checkout Cart' 1 60)" && read -r DR DC <<<"$(dot_near "$TR" "$TC")" && read -r UR UC <<<"$(locate '○ Unsorted' 1 60)"; then
  # A drop on nothing changes nothing.
  drag "$DC" "$DR" $((DC-4)) $((DR+6))
  expect_absent right "Moved" "a satellite dropped on empty space moves nothing"
  expect_text right "○ Checkout Cart 2" "…and the topic keeps both sessions"
  read -r TR TC <<<"$(locate '○ Checkout Cart' 1 60)"; read -r DR DC <<<"$(dot_near "$TR" "$TC")"; read -r UR UC <<<"$(locate '○ Unsorted' 1 60)"
  drag "$DC" "$DR" $((UC+3)) "$UR"
  expect_text right "to Unsorted" "dragging a satellite onto Unsorted moves it"
  expect_text right "○ Unsorted 2" "…and Unsorted keeps it (the clustering never takes it back)"
  expect_text right "○ Checkout Cart 1" "…so the topic it left has one session"
  if read -r FR FC <<<"$(locate '↻ refresh' 1 12)"; then
    click $((FC+3)) "$FR"; sleep 2
    expect_text right "○ Unsorted 2" "after a rescan (↻ refresh, by mouse) the moved session is still in Unsorted"
  else
    echo "FAIL: the refresh button is not on the screen"; FAILED=$((FAILED+1)); right | tail -30
  fi
  if read -r ZR ZC <<<"$(locate '[ Undo ]' 1 60)"; then
    click $((ZC+3)) "$ZR"
    expect_text right "Undone" "a mouse click on Undo undoes the move"
    expect_text right "○ Checkout Cart 2" "…and the topic has both sessions once more"
    expect_text right "○ Unsorted 1" "…and Unsorted is back to one"
  else
    echo "FAIL: no Undo button after the move"; FAILED=$((FAILED+1)); right | tail -30
  fi
else
  echo "FAIL: could not find the topic, a dot and Unsorted for the drag"; FAILED=$((FAILED+1)); right | tail -30
fi

echo "== pass 3: the classic renderer (inline pane above the prompt, no mouse)"
IFS='|' read -r CFG DEMO <<<"$(seed_cfg default)"
start_engine "$CFG" "$DEMO"
settle 45 || { summary; cleanup; exit 1; }
type_line "/map" 6
expect_text whole "CONSTELLATION" "/map opens the pane inline"
expect_eq "$(mouse_flags)" "00" "the classic renderer leaves the terminal's mouse reporting off"
expect_text whole "Tab to a topic · Enter focuses · the mouse works in /tui fullscreen" "the inline map's hint says what works there"
if read -r TR TC <<<"$(locate '○ Checkout Cart' 1 60)"; then
  click $((TC+5)) "$TR"
  expect_absent whole "‹ All topics" "a click does nothing there, as the hint says"
fi
# The keyboard path the hint names: Tab walks the pane's ring until it rests on a topic (the trace names it), Enter focuses.
traced=""
for _ in $(seq 1 30); do
  tmux send-keys -t "$S" Tab; sleep 0.6
  if whole | grep -q "Checkout Cart · 2 sessions · Enter to focus"; then traced=1; break; fi
done
expect_eq "${traced:-0}" "1" "Tab reaches a topic and the trace names it"
keys Enter; sleep 1
expect_text whole "‹ All topics" "Enter on it focuses the topic"
keys Escape; sleep 1
expect_absent whole "‹ All topics" "Esc backs out of the topic"
keys h
expect_text whole "Close help" "the hotkeys work inline: h opens the help"
keys Escape; keys Escape; sleep 2
expect_absent whole "CONSTELLATION" "Esc, Esc closes the pane"

summary
cleanup
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
