#!/usr/bin/env bash
# End to end: the real Claude Code TUI with Constellation loaded from this checkout, driven in tmux.
#
#   bash tests/e2e/tui.sh                  # about three minutes; one short model turn
#   E2E_SKIP_MODEL=1 bash tests/e2e/tui.sh   # the same without the model turn
#
# The pane docks beside the transcript in a fullscreen terminal and sits above the prompt otherwise;
# the checks read the whole screen, so either layout passes.
# Isolated from your own data: its own CLAUDE_CONFIG_DIR (your credentials file is copied in so
# the engine is signed in), its own project folder seeded with the three fixture transcripts.
# Needs tmux and `claude` on PATH. Answers the engine's first-run dialogs itself. Prints PASS/FAIL
# per check and exits 1 on any failure; the tmux session is left running on failure for a look
# (`tmux attach -t e2e`), and killed on success.
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=lib.sh
source "$REPO/tests/e2e/lib.sh"
CFG=${E2E_CONFIG_DIR:-$(mktemp -d)}
DEMO_ROOT=$(mktemp -d)
DEMO="$DEMO_ROOT/demo-app"
SLUG=$(printf '%s' "$DEMO" | sed 's/[^a-zA-Z0-9]/-/g')
mkdir -p "$DEMO" "$CFG/projects/$SLUG"
F="$REPO/tests/fixtures"
cp "$F/checkout-tests.jsonl" "$CFG/projects/$SLUG/11111111-aaaa-4bbb-8ccc-000000000001.jsonl"
cp "$F/checkout-rounding.jsonl" "$CFG/projects/$SLUG/44444444-aaaa-4bbb-8ccc-000000000004.jsonl"
cp "$F/orders-pagination.jsonl" "$CFG/projects/$SLUG/22222222-aaaa-4bbb-8ccc-000000000002.jsonl"
touch -d '2026-10-20 09:05' "$CFG/projects/$SLUG/11111111-aaaa-4bbb-8ccc-000000000001.jsonl"
touch -d '2026-10-18 15:04' "$CFG/projects/$SLUG/44444444-aaaa-4bbb-8ccc-000000000004.jsonl"
touch -d '2026-10-19 14:03' "$CFG/projects/$SLUG/22222222-aaaa-4bbb-8ccc-000000000002.jsonl"
[ -f "$HOME/.claude/.credentials.json" ] && cp "$HOME/.claude/.credentials.json" "$CFG/"
printf '# demo\n' > "$DEMO/README.md"
echo "config: $CFG"
echo "demo:   $DEMO"

tmux kill-session -t "$S" 2>/dev/null
tmux new-session -d -s "$S" -x 170 -y 60 -c "$DEMO" "CLAUDE_CONFIG_DIR=$CFG claude --plugin-dir $REPO"

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

settle 45 || { summary; exit 1; }
expect_text whole "Checkout Cart" "the band offers the folder's topic"

type_line "/map" 6
expect_text whole "CONSTELLATION" "/map opens the pane"
expect_text whole "JUMP BACK IN" "the pane shows the recent sessions"
expect_text whole "Hover or focus a topic to trace it" "the terminal map draws its hint"
expect_text whole "Checkout Cart" "the terminal map draws the topic"
# /map leaves the pane focused: its letters are hotkeys. A pane above the prompt shows a window of its tree,
# so the checks read the header, which is always in view.
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
expect_text whole "◆ Checkout Cart · step 3" "a bare digit in the empty prompt joins through the band; the status line follows"

type_line "/pickup list" 5
expect_text whole "1. Checkout total rounding" "/pickup list numbers the chain"
expect_text whole "2. Fix flaky cart wait" "…and its latest step"
type_line "/park Replaced the wait with findByText; the CI re-run is still pending." 5
expect_text whole "Parked: “Replaced the wait with findByText" "/park saves the note"
expect_text whole "note ✓" "the status line shows the note"
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

summary
if [ "$FAILED" -eq 0 ]; then tmux kill-session -t "$S"; rm -rf "$DEMO_ROOT"; [ -z "${E2E_CONFIG_DIR:-}" ] && rm -rf "$CFG"; exit 0; fi
exit 1
