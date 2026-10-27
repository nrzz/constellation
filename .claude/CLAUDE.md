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
  `node tests\e2e\desktop.mjs`; `tests\e2e\installers.ps1` when an installer
  changes. Run them with the Desktop's own Claude Code (`$env:CLAUDE_BIN`, see
  the handover): the `claude` on PATH there is 2.1.283, too old for mods.
- Verified work goes to `main` of github.com/nrzz/constellation, as
  conventional commits ending with the session's attribution lines. No model
  name or model identifier in commits, docs or code.
- Keep `README.md`, `PLAN.md` and `docs/HANDOVER.md` current; regenerate the
  README pictures (`tests/e2e/shots.mjs`) when the drawing changes.
- The mod never wastes the user's tokens, never approves tool calls, never
  touches the network.
- On Windows, Bash heredocs collapse `\\` to `\`: write files with the Write
  tool.
