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
`claude plugin test` (109 tests, including an edge-case suite) and `tsc` pass. The rendered field was checked
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
   "New session in `<folder>` · continuing which topic?" and lists up to nine
   of the folder's topics by recent activity, on the digit hotkeys, plus
   **+N more in the map** when there are more, **New topic**, **Open map**
   (`o`) and **Dismiss**. (The pane's chooser card lists every topic.)
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
| `/map` | Opens or closes the Constellation pane (the live sidebar) |
| `/map here` | Prints the map, its buttons and the chooser as a row in the main chat, as of that moment |
| `/map <topic>` | Opens the pane focused on a topic: its number in the `/topic` list, its name, or the start of its name |
| `/map find <text>` | Opens the pane searching titles, first prompts, notes, files and branches |
| `/map settings` | Opens the pane on its settings view |
| `/map export [path]` | Writes the folder's topics, goals and notes as Markdown (default `constellation-map.md`) |
| `/map close` | Closes the pane |
| `/map help` | Prints every command and key |
| `/topic` | Says which topic this session is in and lists the folder's topics, numbered |
| `/topic <name or n>` | Joins the topic of that name or number; a new name creates the topic |
| `/park <note>` | Saves a handoff note for this session |
| `/pickup [n]` | Puts the note of step n of your topic (or its latest session) beside your next prompt |
| `/pickup list` | Lists the steps of your topic with their notes |

## The pane

**Header**: breadcrumb (folder › topic › session), search over titles, notes,
files and branches (with **× clear search** while it is set), a time-range
picker (7, 14, 30 days or all time; pinned sessions ignore it), Map/List,
Settings, Help, **◆ my topic** once this session has one, and **↻ refresh**.

**Jump back in**: under the header, the three most recent sessions as chips.
One press opens the session's card with its topic focused, so **Pick up
here** is the next press. The row steps aside in focus mode, while searching,
and under the settings or help cards.

**Map**: the field, sized to the pane's width, drawn transparent on the pane's
own surface and following the app's light or dark scheme (`fieldBackground:
night` paints the prototype's solid ground instead). Topics are packed into
rows with room for their satellites, so pills never overlap; a crowded folder
gets a taller field. Session titles are the ones the Desktop sidebar shows.
Major topics are labelled pills with a session count
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
  session; only when there is something to tidy), **Rename**, **Set goal**,
  **Merge into…**, a colour picker.
- A session selected: step number, title, status, meta with how long it ran,
  its handoff note and files, then **Pick up here**, **Draft prompt**, **New
  session from here** (a `claude://` link the Desktop confirms) on one row and
  **Pin**, **Move to topic**, **Archive** (with Undo), **Message** (dim unless
  the session is active) on the next, with the `claude --resume <id>` line
  that reopens the session in a terminal.
- Help (`h`, or `/map help` as text): every command and key.

**Digest**: when the pane opens it says what changed since you last looked at
this folder. **Status line**: your topic and step, with a tick once your note
exists.

**Keyboard**: Tab walks the controls and traces the topic under the ring,
Enter focuses it. Digits 1–9 pick chain steps or chooser topics. Letters:
`m` map, `l` list, `s` settings, `h` help, `y` my topic, `b` back, `f` focus,
`u` pick up, `d` draft, `j` join, `r` rename, `g` goal, `e` merge,
`t` message, `n` new topic or new session, `p` pin or park, `v` move,
`x` archive, `z` undo, `o` open the map from the band. Escape backs out one
level (help, field, selection, focus) before it closes the pane. The keys
fire while the pane or the band has the focus (a click or ctrl+x tab gives
it); a bare digit in an empty prompt also answers the band.

## Settings

Set them in `/config`, or live in the pane's settings view (saved to the
store), where they come in three groups: Map, Session, and Advanced (the
major-topic rules and the Desktop hit layer), folded until asked for.

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
| `openOnStart` | band, pane, none | band | What a new session shows: the chooser band, the pane, or nothing. A Desktop or VS Code session counts as able to show the pane, though the engine starts it headless |
| `fieldBackground` | transparent, night | transparent | transparent sits on the pane's own surface and follows light or dark; night is the prototype's solid ground |
| `pictureClicks` | on, outline, off | on | The Desktop's pointer layer over the picture: on; drawn with its outline and readings, to check it sits on the picture; or off (the buttons under the map remain) |
| `cellWidthPx` | 4–14 | 7.2 | CSS pixels per character cell across on the Desktop; the picture and its pointer layer are both sized from it |
| `cellHeightPx` | 8–36 | 17 | CSS pixels per character cell down on the Desktop |

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
| Field | One SVG sized to the pane: pills, satellites, chain, glow, CSS hover tracing, tooltips; on the Desktop an invisible pointer layer lies over it | A text-mode map (a Client module) with real pointer and arrow-key input |
| Picking | Desktop: a click on a pill, a satellite, a step, an anchor or ‹ All topics on the picture, or the buttons under it; VS Code: the buttons, Tab/Enter, hotkeys | Click a topic or session, drag a session onto a topic, arrows walk topics or steps, Enter picks, Backspace goes back |
| Everything else | Header, cards, settings, band, commands | The same |

Mobile has the SVG and the buttons but no text fields, so renaming, goals and
messaging are not offered there.

## How topics form

Unassigned sessions are clustered from what they share: the words of their
titles and first prompts, the files they edited, a non-main branch. A word or
a file that more than 60 % of the folder shares counts for nothing (the
project's name, "bug", a README); files under `.claude/`, `CLAUDE.md`,
`AGENTS.md`, lockfiles and env files never count; a transcript too large to
read stays Unsorted. A session joins the cluster it relates to best, and
only when it relates to enough of that cluster's members (one while the
cluster holds up to three, a third of them beyond), so one shared word never
chains a folder into a single blob. Joining, moving, renaming or `/topic`
makes a topic explicit, and explicit sessions never move.

## Matching the pointer layer to the picture (Desktop)

The Desktop draws the field as a picture no click can reach, so Constellation
lays an invisible Client over it to take the clicks. Both are sized from two
numbers in the Advanced settings, `cellWidthPx` and `cellHeightPx`, because
the Desktop never reports its cell size. To check them once on a machine:

1. In the pane's settings, under Advanced, set **Clicks on the picture** to
   **Outline**. An orange frame shows where the layer is, with a line that
   reads `layer <cols>×<rows> cells · field 860×520 · <last pointer event>`.
2. Move the pointer over the picture. If the line stays at "no pointer event
   yet", the Desktop sends this Client no pointer events; set the option to
   **Off** and use the buttons under the map, which do everything a click would.
3. If the frame falls short of the picture's right edge, raise the cell
   width; if it runs past, lower it. The same at the bottom edge with the cell
   height. The `+` marks where the layer last saw the pointer and should sit
   under it.
4. Set the option back to **On**. The settings are saved.

## Known limits

- A plugin cannot take over the main chat: the live map is the pane beside
  the transcript (or above the prompt in a narrow window). `/map here` prints
  the map as a row in the chat, which scrolls with the conversation and shows
  the map as of that moment.
- A node on the map can never switch the Desktop app to an existing session;
  Claude Code has no API for it. A node can message that session while it
  runs, pick up its note into this chat, or start a new session from it.
- On the Desktop the SVG is a sandboxed picture: no click on it reaches a
  mod. The pointer layer over it (above) takes the clicks, at a size matched
  to the picture by the cell-size settings; where the Desktop sends a Client
  no pointer events, the buttons under the field remain the way to pick, and
  moving a session is "Move to topic" then a pick. The terminal's text-mode
  map takes clicks and drags itself.
- The engine starts a Desktop or VS Code session headless (`isInteractive`
  false). Constellation treats those surfaces, and a `CLAUDE_CODE_ENTRYPOINT`
  of `claude-desktop` or `claude-vscode`, as able to show the pane, and opens
  it when a Desktop window attaches later.
- Another plugin can keep `classic.SessionStart` from reaching this one.
  Constellation also hears `session.end` on `/clear` and a resume, and checks
  the session id on every command, press and turn and every three seconds,
  so it starts over for the new session either way.
- Arrow keys cannot be bound by a mod on the Desktop; the terminal map gets
  them through its Client.
- Transcripts over 4 MiB cannot be read by a mod; such a session shows as a
  stub titled "(large transcript)" until a smaller read of it is cached.
- The map reads `~/.claude/projects/<slug>/*.jsonl` (`CLAUDE_CONFIG_DIR`
  respected) and never writes a transcript. A scan reads at most 40 changed
  transcripts per pass, newest first, and follows up within a second until
  the folder is covered, so a first look at a big folder fills in over a few
  seconds. Its own data lives in the plugin store (4 MiB in all), which is why
  summaries are kept small.
- With more than about forty topics the field sheds detail to stay under the
  SVG and Client size caps: tooltips first, then satellites. Narrow the time
  range or search to see everything again.

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

Tests: `tests/scan.test.ts` (parsing, cache, large files), `tests/cluster.test.ts`
(topics, links, scoring, order), `tests/layout.test.ts`, `tests/register.test.tsx`
(the whole mod through the engine on desktop and terminal), `tests/client.test.tsx`
(the terminal map and the Desktop pointer layer, its outline and sizing),
`tests/desktop.test.tsx` (headless Desktop starts, a later attach, `/clear`
and a resume without `classic.SessionStart`, Windows-resolved paths in the
stubs), `tests/interact.test.tsx` (the
help card, Jump back in, my topic, the search clear, Refresh, the band's cap,
the numbered commands, the session card's rows, the settings groups) and
`tests/edge.test.tsx` (empty
folders, hostile and huge transcripts, bounded scans, every `openOnStart`, a
refusing store, model failures, dismissed dialogs, key and hotkey uniqueness
in every state, mobile and VS Code, `/clear`, resume, range and search, the
size caps). `tests/helpers.tsx` is the engine stub they share.

`hooks/scan.ts` reads transcripts, `hooks/cluster.ts` builds topics,
`hooks/layout.ts` places them, `hooks/draw.tsx` draws the SVG and the element
trees, `hooks/actions.ts` does everything a press does, `hooks/register.tsx`
wires the events, `client/map.js` is the terminal's map. `PLAN.md` holds the
design notes and the API facts this was built against.

MIT licensed.
