# Constellation: notes for Claude sessions

A Claude Code mod (hooks in `hooks/`, a Client in `client/map.js`) that maps a
folder's sessions as topics. Work happens on the owner's Windows 10 machine
with Claude Desktop; this folder is usually both the git checkout and the
installed plugin (`C:\Users\Lenovo\.claude\local-plugins\constellation`).

**Start with `docs/HANDOVER.md`**: where things stand, how to run everything
on Windows, the re-test checklist, open items, and a prompt to continue.
`PLAN.md` holds the spec, the API facts and every pass's record. `README.md`
is what users read.

## Rules

- Own the outcome: do the complete work, never skip a check on an assumption,
  never shrink the scope; ask only before something hard to undo. Short
  progress reports; a table of what is left and how long when asked.
- Every fix gets a test that fails without it.
- Gates before any push: `plugin validate --strict .`, `plugin test .`, `tsc`,
  `node tests/e2e/desktop.mjs`; `tests/e2e/installers.ps1` when install.ps1
  changes and `bash tests/e2e/installers.sh` (WSL) when install.sh changes.
  Run them with the Desktop's own Claude Code (handover sections 1.3 and 5):
  the `claude` on PATH there is 2.1.283, too old for mods.
- Commands run in Git Bash, one new shell per command: set a variable and use
  it in the same line, and write paths with forward slashes.
- Verified work goes to `main` of github.com/nrzz/constellation, as
  conventional commits ending with the session's attribution lines: keep the
  `Co-Authored-By:` trailer exactly as Claude Code gives it, though it names a
  model; nowhere else (subject, body, docs, code) name the model a session
  runs on. The mod's own `haiku` calls and their documented cost stay.
- Keep `README.md`, `PLAN.md` and `docs/HANDOVER.md` current; regenerate the
  README pictures when the drawing changes (`tests/e2e/shots.mjs` for the
  Desktop's; `tests/e2e/shots-terminal.mjs`, in WSL, for the terminal's).
- When a stretch of work ends: rewrite `docs/HANDOVER.md` (state, results,
  open items) and its section 10 prompt, and end the reply with that prompt.
- The mod never wastes the user's tokens, never approves tool calls, never
  touches the network.
- On Windows, Bash heredocs collapse `\\` to `\`: write files with the Write
  tool.
