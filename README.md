# Constellation

A Claude Code mod that maps the sessions of one project folder as a
constellation of topics. One folder holds many topics; each topic is an ordered
chain of sessions; every new session joins a chain and picks up that chain's
goal and latest handoff note, so same-topic sessions stop piling up in the
Desktop sidebar and nothing is lost between them.

- **A map of your work.** Every session Claude Code has run in the folder,
  read from its transcripts, clustered into topics by what they touched and
  talked about, drawn as a field of labelled pills with their sessions in orbit.
- **Chains, not piles.** Focus a topic and its sessions line up as numbered
  steps in time order, the latest glowing, with this session as the next step.
- **Handoffs that travel.** Each session leaves a short note (written by haiku
  after each turn, or by you with `/park`). Joining a topic puts the topic's
  goal and the latest note beside your next prompt, for Claude's eyes only.
- **Token-lean.** Everything but the notes is local text matching. The
  zero-token path is one setting away, and the settings view counts what the
  model was asked.

Status: built in Claude Code 2.1.310. `claude plugin validate --strict`,
`claude plugin test` (52 tests) and `tsc` pass. The rendered field was checked
against the approved prototype
([preview](https://claude.ai/artifact/AVQhQM9n6QjMsQZKaePe6u),
[prototype](https://claude.ai/artifact/EAVPtFffcFroUfjiKKp7C6#play-b8188f0249b0));
the first look at the live pane in the Desktop app is still to come.

## Install

```bash
claude plugin marketplace add nrzz/constellation
claude plugin install constellation@constellation
```

At the prompt of a terminal session: `/plugin install constellation --marketplace nrzz/constellation`.
In the Desktop app's Code tab: click + next to the prompt box, then Plugins,
Add marketplace with `nrzz/constellation`, then Add plugin.

Requires Claude Code 2.1.287 or later. To run it from a checkout while
developing: `claude --plugin-dir <path to this repo>`.

## How a session joins a topic

1. A new session starts with no topic. A band above the prompt asks
   "New session in `<folder>` · continuing which topic?" and lists the folder's
   topics by recent activity, with digit hotkeys, plus **New topic** and
   **Dismiss**. (The same chooser is the card under the map.)
2. If you type a prompt first, Constellation scores it against each topic's
   titles, goal, notes and file names and marks the best match **suggested**.
   With `autoJoin: auto`, a clear match joins at once and the note rides along
   with that very prompt.
3. Joining makes this session the chain's next numbered step and queues the
   topic's goal and latest handoff note as hidden context for your next prompt
   (text only Claude reads; no extra turn, no tokens spent on a model call).
4. After each of your turns, a handoff note is regenerated for this session
   (`handoffNotes: auto`), or you park one yourself with `/park`. The next
   session on the topic picks it up.

## Commands

| Command | What it does |
| --- | --- |
| `/map` | Opens or closes the Constellation pane |
| `/map settings` | Opens the pane on its settings view |
| `/map close` | Closes the pane |
| `/map export [path]` | Writes the folder's topics, goals and notes as Markdown (default `constellation-map.md`) |
| `/topic` | Says which topic this session is in and lists the folder's topics |
| `/topic <name>` | Joins the topic of that name, creating it when new |
| `/park <note>` | Saves a handoff note for this session |
| `/pickup [n]` | Puts the note of step n of your topic (or its latest session) beside your next prompt |

## The pane

**Header**: breadcrumb (folder › topic › session), search over titles, notes,
files and branches, a time-range picker (7, 14, 30 days or all time; pinned
sessions ignore it), Map/List, Settings.

**Map**: the field. Major topics are labelled pills with a session count
(and "· you" on your topic), minor topics small dots with a mono label,
sessions satellites around their topic (filled = active in the last five
minutes, hollow = idle, dashed = archived, ★ = pinned), dashed lines between
topics that touched the same file. Hovering a topic traces it: its sessions and
links take its colour and everything else dims. Searching dims non-matches and
shows match counts on the pills.

**Focus mode**: pick a topic and it alone stays, its in-range sessions laid out
as a numbered zigzag chain with arrows, the latest glowing, this session as the
dashed accent step. Related topics hang along the bottom as anchors; the
topic's goal reads under the chain. **‹ All topics** or Escape goes back.

**Cards under the field**, by state:

- No topic yet: the join chooser.
- Joined: "This session is step N of `<topic>`", the goal, the note in context,
  your own note so far, and **Focus my topic**, **Draft next prompt** (fills the
  composer from the note; you edit and send), **Change topic**, **Park a note**.
- A topic traced or focused: counts, goal, latest note, related chips, and
  **Focus**, **Pick up latest**, **Join this topic**, **Archive N idle** (asks per
  session), **Rename**, **Set goal**, **Merge into…**, a colour picker.
- A session selected: step number, title, status, meta with how long it ran,
  its handoff note and files, and **Pick up here**, **Draft prompt**, **Message**
  (to a running session), **New session from here** (a `claude://` link the
  Desktop confirms), **Pin**, **Move to topic**, **Archive** (with Undo).

**Digest**: when the pane opens it says what changed since you last looked at
this folder. **Status line**: your topic and step, with a tick once your note
exists.

**Keyboard**: Tab walks the controls and traces the topic under the ring,
Enter focuses it. Digits 1–9 pick chain steps or chooser topics. Letters:
`m` map, `l` list, `s` settings, `b` back, `f` focus, `u` pick up, `d` draft,
`j` join, `r` rename, `g` goal, `e` merge, `t` message, `n` new session,
`p` pin or park, `v` move, `x` archive, `z` undo. Escape backs out one level
(field, selection, focus) before it closes the pane.

## Settings

Set them in `/config`, or live in the pane's settings view (saved to the store).

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `scope` | folder, all | folder | Which transcripts the map reads: this folder's, or every folder's |
| `groupBasis` | auto, manual | auto | auto clusters unassigned sessions into topics; manual leaves them Unsorted |
| `majorRule` | either, count, recent | either | What earns a labelled pill: enough sessions, recent activity, or either |
| `majorMinSessions` | 1–20 | 3 | Sessions a topic needs under the count rule |
| `recentDays` | 1–90 | 7 | A non-archived session this recent makes its topic major under the recent rule |
| `numbering` | oldestFirst, newestFirst | oldestFirst | Order of the numbered steps in focus mode |
| `showRelated` | true, false | true | Related topics as dashed anchors in focus mode |
| `handoffNotes` | auto, manual, ask | auto | auto writes a note after each turn (haiku); manual uses only `/park`; ask offers a field after each turn |
| `autoJoin` | suggest, auto, off | suggest | After your first prompt: mark the best topic, join it when clear, or do nothing |
| `rangeDays` | 1–45 | 30 | Sessions older than this are dimmed and left out of chains; 45 means all time |
| `useModelForTitles` | true, false | false | Name auto topics with one short haiku call instead of their most frequent words |
| `openOnStart` | band, pane, none | band | What a new session shows: the chooser band, the pane, or nothing |

## Model use and cost

Constellation spends model usage only where a setting says so, and the
settings view shows a running count for the session.

| What | When | Cost |
| --- | --- | --- |
| Handoff notes | `handoffNotes: auto`, 2 s after each main-loop turn | One haiku call: the last 20 messages (at most ~8,000 characters) in, 120 tokens out |
| Topic names | `useModelForTitles: true`, for unnamed auto topics (at most five per scan, cached) | One haiku call of 30 output tokens per topic |
| Join suggestions, clustering, search, notes injection | Always | Local token matching, no model call |

The zero-token path: `handoffNotes: manual` (or `ask`) and `useModelForTitles:
false`. The mod never approves tool calls and never touches the network.

## Desktop and terminal

| | Desktop app (and VS Code) | Terminal |
| --- | --- | --- |
| Field | One SVG: pills, satellites, chain, glow, CSS hover tracing, tooltips | A text-mode map (a Client module) with real pointer and arrow-key input |
| Picking | Buttons under the field, Tab/Enter, hotkeys | Click a topic or session, drag a session onto a topic, arrows walk topics or steps, Enter picks, Backspace goes back |
| Everything else | Header, cards, settings, band, commands | The same |

Mobile has the SVG and the buttons but no text fields, so renaming, goals and
messaging are not offered there.

## Known limits

- A node on the map can never switch the Desktop app to an existing session;
  Claude Code has no API for it. A node can message that session while it
  runs, pick up its note into this chat, or start a new session from it.
- On the Desktop the SVG is a sandboxed picture: clicks and drags on it do not
  reach the mod, so picking goes through the buttons under the field and
  moving a session is "Move to topic" then a pick. The terminal's text-mode
  map takes clicks and drags.
- Arrow keys cannot be bound by a mod on the Desktop; the terminal map gets
  them through its Client.
- Transcripts over 4 MiB cannot be read by a mod; such a session shows as a
  stub titled "(large transcript)" until a smaller read of it is cached.
- The map reads `~/.claude/projects/<slug>/*.jsonl` (`CLAUDE_CONFIG_DIR`
  respected) and never writes a transcript. Its own data lives in the plugin
  store (4 MiB in all), which is why summaries are kept small.

## Development

```bash
claude plugin validate --strict .
claude plugin test .
npx -y typescript@5.9.3 tsc -p .          # needs .claude-plugin/types laid by the engine or the plugin-authoring skill
node tests/fixtures/sync.mjs             # after editing a *.jsonl fixture
node tests/preview/render.mjs            # SVGs of the field for demo data, under tests/out
node tests/preview/shots.mjs             # PNGs of them (Playwright)
node tests/preview/page.mjs              # the comparison page, tests/out/preview.html
```

`hooks/scan.ts` reads transcripts, `hooks/cluster.ts` builds topics,
`hooks/layout.ts` places them, `hooks/draw.tsx` draws the SVG and the element
trees, `hooks/actions.ts` does everything a press does, `hooks/register.tsx`
wires the events, `client/map.js` is the terminal's map. `PLAN.md` holds the
design notes and the API facts this was built against.

MIT licensed.
