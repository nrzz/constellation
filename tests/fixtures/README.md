# Transcript fixtures

Synthetic transcripts in the exact line shapes Claude Code 2.1.308 writes to
`~/.claude/projects/<slug>/<sessionId>.jsonl` (observed on 2026-10-27; no real
content). Each line is one JSON object. Shapes a scanner must handle:

- `queue-operation` rows (enqueue/dequeue) before the first user row; they
  carry `content` but are not prompts.
- `user` rows whose `message.content` is a string: a typed prompt. The one
  with `isMeta: true` and `<command-name>` content is a slash command, not a
  prompt. Fields: `uuid`, `parentUuid`, `timestamp`, `sessionId`, `cwd`,
  `gitBranch` (may be `HEAD`), `version`.
- `user` rows whose content is an array of `tool_result` blocks.
- `assistant` rows with `thinking`, `text` and `tool_use` blocks; `Edit`,
  `Write` and `MultiEdit` tool_use inputs carry `file_path`.
- A `summary` row (`summary`, `leafUuid`) that names the session; it may sit
  at the end or the start of the file, or be absent.

The fixtures: `checkout-tests.jsonl` and `checkout-rounding.jsonl` (two
sessions that cluster into one auto topic through shared words and a shared
file), `orders-pagination.jsonl` (a loner that lands in Unsorted; a summary at
the top, a bad line, MultiEdit, a local-command row, a detached HEAD at the
end), `empty-queue.jsonl` (queue rows only: no session yet).

A plugin test has no file system, so `transcripts.ts` mirrors every `.jsonl`
here as strings for the tests' `fs.*` stubs. Regenerate it after editing a
fixture: `node tests/fixtures/sync.mjs`.

`checkout-tests.jsonl` expects: title "Fix flaky cart wait" (from the summary),
firstPrompt "fix the flaky cart wait in the checkout tests", 2 turns, branch
main, filesTouched `src/Cart.test.tsx` and `src/test-utils.ts` (relative to
the cwd `D:\Projects\web-app`), startedAt 2026-10-20T09:00:00.200Z, lastAt
2026-10-20T09:05:00.000Z, lastAssistantText starting "Replaced the fixed".
