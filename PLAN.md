# Constellation — build plan and handover

A Claude Code mod (Mods API, no network, no Node globals) that maps the
sessions of one project folder as a constellation of topics. One folder holds
many topics; each topic is an ordered chain of sessions; a new session joins a
chain and picks up that chain's latest handoff note.

Status at this commit: research done, design approved, repo scaffolded.
No feature code written yet. Continue from "Next steps" below.

## Design reference (the visual and interaction spec)

- `design/TopicMap.dc.html` — the approved interactive prototype (mock data,
  prototype framework `x-dc` / `DCLogic`; do NOT port its code, reproduce the
  look and behaviour with Mods elements). The prototype wins on appearance;
  the written spec below wins on data and logic.
- `design/Constellation-interactive-prototype.html` — a self-contained bundle
  of the same prototype that runs in any browser with JavaScript (open the
  file; it unpacks itself). `design/Constellation-topic-map.pdf` — a one-page
  rendered picture of the artboard (Read it with `pages: "1"` where poppler is
  installed). `design/screens/` — screenshots of the rendered prototype
  (Read them as images): `01-map-join-chooser.jpg` (map + join chooser card,
  the default state), `02-focus-chain-topic-card.jpg` (Checkout tests focused:
  numbered zigzag chain, arrows, latest glowing, related anchors, topic card),
  `03-focus-session-card.jpg` (step 1 selected: tooltip, session card with
  Pick up here / Message / New session from here / Pin / Move / Unarchive),
  `04-list-view.jpg` (outline with numbered session rows), `05-settings.jpg`
  (segmented controls under the list). `design/canvas.json` — the canvas index.
- Secondary visual reference, from the user: ONLY the skills-graph section of
  https://www.dasprakashsekar.site/ (scroll to the field headed "Hover or
  focus a project to trace its stack"; the user's screenshot of it is
  `design/screens/06-reference-skill-graph.png`). Nothing else on that site
  is a reference. Take from it: edges drawn in the traced topic's own colour,
  thin lines from the pill to each of its nodes, so a traced topic reads as
  one coloured constellation while untraced edges sit at very low alpha; many
  edges stay calm that way; nodes as small coloured dots with a soft glow
  halo (a larger low-alpha circle under the dot) and a mono label beside
  them; a light pill with dark text for the hub that is traced (our topic
  pills keep the prototype's dark fill and coloured border at rest, and may
  brighten their fill when traced); two alphas for depth (far ~0.15, traced
  ~0.8) and two dot sizes; the hint pill at the top, which the prototype
  already has. Its glowing centre hub node is not for us: the folder is not a
  topic, so the map has no centre. The prototype still wins where the two
  disagree.
- Secondary visual reference, from the user: https://www.dasprakashsekar.site/
- The source artifact is PUBLIC (shared 2026-10-27, no sign-in needed):
  https://claude.ai/artifact/EAVPtFffcFroUfjiKKp7C6#play-b8188f0249b0
  (`#play-…` opens the interactive view). The Artifact tool's `read` on that
  link returns the same `project/TopicMap.dc.html`; re-read it only if the
  user says the design changed. Send the user to that link when you want them
  to compare something against the prototype.

Visual tokens: background #0B0E13, panels #10141A, borders #1C222B (cards
#20262F, inputs #252C37), text #E8ECF2, muted #8B95A5 (dim #6F7988, labels
#C9D1DC), accent #F2A33A, topic palette #F2A33A #9B8CFF #5FD3A6 #7FB8FF
#ED93B1, minor topics #B4B2A9. Field 860×520 with a 60px grid (#151A22), star
dots (#3A4252 small, #55607A big), topic links dashed `2 5`, pills radius 999
with 1.5px coloured border and 0 0 0 5px rgba(colour,.22) glow when traced,
numbered steps 32px circles (28px in cards), satellites 7px (major) / 5px
(minor) / 10px traced / 12px selected; active = filled, idle = hollow
(#161B23 fill), archived = dashed grey ring (#6F7988), pinned = ★ accent.
Legend bottom-left: active, idle, shipped, pinned. Hint pill top-centre.

## Spec (the contract from the brief)

### Repo layout
`.claude-plugin/plugin.json` (name "constellation", userConfig for every
setting), `.claude-plugin/marketplace.json` at the repo root (installs with
`claude plugin marketplace add <owner>/<repo>` then
`claude plugin install constellation@<marketplace>`), `hooks/hooks.json`,
`hooks/register.tsx` (entry), `hooks/scan.ts` (transcripts), `hooks/cluster.ts`
(topics + join suggestions), `hooks/layout.ts` (positions), `hooks/draw.tsx`
(element trees), `client/map.js` (Phase 2 Client module), `types/index.d.ts`
($.state declarations), `tests/*.test.ts`, `README.md`, `LICENSE` (MIT).
Conventional commits, one commit per phase. No build step. Requires Claude
Code 2.1.287+ (built and checked against 2.1.308).

### Data (hooks/scan.ts)
Transcripts: `~/.claude/projects/<slug>/<sessionId>.jsonl`, slug =
`cwd.replace(/[^a-zA-Z0-9]/g, '-')` (e.g. `D:\Projects` → `D--Projects`);
`CLAUDE_CONFIG_DIR` overrides `~/.claude`; HOME from `$.env.get("HOME")` or
`USERPROFILE`. Skip `agent-*.jsonl` and sub-directories (one `<sessionId>/`
folder per session holds subagent transcripts). One JSON object per line:
`type` (`user`, `assistant`, `queue-operation`, `summary`, `system`,
`file-history-snapshot`, …), `uuid`, `parentUuid`, `timestamp`, `sessionId`,
`cwd`, `gitBranch` (can be `HEAD`), `version`, `message.content` (string for a
typed prompt, else an array of blocks `{type:'text'|'tool_use'|'tool_result'|
'thinking'}`); `isMeta: true` marks hidden user rows; slash commands arrive as
strings starting with `<command-`/`<local-command`.
Per session derive: id, cwd, branch, firstPrompt (first `user` entry whose
content is a string, skipping isMeta and `<…>` tagged rows), title (a
`summary` line if present, else firstPrompt trimmed to 60 chars), startedAt,
lastAt, turns (user string prompts), filesTouched (`file_path` of
Edit/Write/MultiEdit tool_use blocks; dedupe, cap 40, store cwd-relative),
lastAssistantText (cap 300 chars). Scope setting: this folder's slug (default)
or every slug. Cache in `$.store` under `cache:<slug>` keyed by sessionId with
`size` and `mtimeMs` from `$.fs.stat`, so rescans read only changed files.
`$.fs.read` is capped at 4 MiB: for a larger transcript keep the cached
summary and set `large: true` (a large transcript with no cache becomes a stub
titled "(large transcript)" with startedAt/lastAt = mtime). Never write to
transcripts. Measured in `D--Projects`: 15 transcripts, 9 over 4 MiB, 108 MiB
total — large files are the norm, so the stub path matters. `$.store` holds
4 MiB of JSON in all: keep summaries small.

### Topics (hooks/cluster.ts)
A folder is only the scope of the map, never a topic. A topic is a named chain
of sessions inside a folder, ordered by time. Branch is a weak hint, never a
bucket. Assignment, in priority order: (1) explicit `assign[sessionId]` from a
join, `/topic <name>`, or a move in the UI; (2) auto-cluster the rest: merge
sessions whose title/firstPrompt share two or more significant tokens, whose
filesTouched overlap, or that share a non-main branch (union-find; an edge that
would merge two different explicit topics is skipped; an unassigned session
that links to an explicit topic's sessions joins that topic); (3) anything left
sits in an "Unsorted" group until assigned. Auto topic id = `auto:` + the
earliest session id in the cluster; name from the most frequent significant
tokens (Title Case, two words), or one `$.model.complete` call on `haiku`
(maxTokens 30) when `useModelForTitles` is true (cache the name in the store).
Links between topics = shared filesTouched; the shared file is the link label.
Major topic rule: `either` (default: sessionCount >= majorMinSessions (3) OR a
non-archived session active within recentDays (7)), `count`, `recent`.
Store schema: `topics {id:{name,color,createdAt}}`, `assign {sessionId:topicId}`,
`notes {sessionId:{text,at,source:'manual'|'auto'}}`, `archived`, `pins`,
`settings`, `cache:<slug>`. Interacting with an auto topic (join, move,
rename) materialises it into `topics` with its id/name/colour.
Join suggestion scoring: tokens of the prompt vs each topic's titles (×2),
notes (×1) and file basenames (×2); "clear" when best ≥ 3 and ≥ 2× second.
Status: active = transcript modified in the last 5 min, archived = store flag,
else idle. Stopword list drops a/the/fix/add/update/make/use/… and tokens < 3
chars; pure numbers dropped.

### Joining a topic = the handover (hooks/register.tsx)
A new session has no topic. On `session.start`: scan, cluster, then draw a
band (`AbovePrompt`): "New session in <folder> · continuing which topic?" with
the folder's topics as Buttons ranked by last activity (digit hotkeys), plus
"New topic" and "Dismiss". On the first `prompt.submit`, if nothing was chosen,
score the prompt against every topic; mark the best "suggested" in the band;
`autoJoin` = `suggest` (default) waits for the click, `auto` joins when the
score is clear (and injects into that same prompt), `off` never suggests.
Joining: `assign[thisSession] = topicId`, this session becomes the chain's next
numbered step, and the topic's latest note is injected as `context` on the
next `prompt.submit` (`next({...e, context:[...(e.context ?? []), note]})`,
text only Claude reads, no extra turn); if the first prompt already went,
inject on the following one. `/topic <name>` joins or creates a topic at any
time; `/pickup [n]` injects the note of step n of the joined topic; "Pick up
here" on any session node injects that session's note and, if this session has
no topic yet, joins that topic. Notes: `handoffNotes` = `auto` (default)
regenerates a ≤60-word note after each main-loop `turn.complete` (debounced
2 s with `$.clock.after`, `$.model.complete` haiku over the last ~20 messages
from `$.session.messages()`), `manual` uses only `/park <note>`, `ask` shows a
band button after each turn that opens an Input. `session.end` has a 1.5 s
budget: never call a model there.

### Pane (hooks/draw.tsx)
`/map` opens or closes the pane (`$.ui.open({ id:'constellation',
title:'Constellation', focus:true, closeOnEscape:true, columns: 96 })`).
Header: breadcrumb (folder › topic › session), search Input, time range Select
(7/14/30/45=all; pinned sessions ignore it), Map/List toggle, settings toggle.
Map view: dark field, faint 60px grid, scattered faint stars; every topic in
scope placed by `hooks/layout.ts` (seeded positions from a hash of the topic
id plus simple repulsion so pills don't overlap, stable across reopen). Major
topics = labelled pills with a colour dot and session count (plus "· you" on
the joined topic); minor topics = small dots with a dim mono label; sessions =
satellite points around their topic at radius (major 58 / minor 40) +
((i*37)%3)*14, angle seed + i*2.399; faint lines topic→in-range sessions;
dashed faint lines between linked topics. Hovering or focusing a topic traces
it: its sessions and links brighten, everything else dims to ~30%. Search dims
non-matches and shows match counts on topics.
Focus mode: clicking a topic hides every other topic and lays its in-range
sessions out as a numbered chain (pill at 430,92; steps x = n===1 ? 430 :
120 + i*620/(n-1), y = 262 ± 26 zigzag, arrows between consecutive steps),
ordered by `numbering` (`oldestFirst` default | `newestFirst`), the latest
session glowing and tagged "latest", and, when this session has joined the
topic, a dashed accent step "This session · you" at the end (or start,
newest-first). Related topics appear as small dashed anchor pills along the
bottom (y 470, spaced 230) when `showRelated` is true; clicking one focuses
it. "All topics" and Escape return to the map (hook `ui.close` for the pane:
when in focus mode or a session is selected, back out and keep the pane open;
otherwise let Esc close it).
List view: the same data as an outline (topic rows with major/minor tag,
count, last activity; expandable numbered session rows including the "you"
row). This is also the terminal rendering (terminal has no Svg).
Card area beneath the map: no topic yet → join chooser (topic buttons by
recency, suggested one marked, "+ New topic", one line explaining the join);
joined → "This session is step N of <topic>", the note now in context, buttons
Focus my topic / Change topic / Park a note; topic hovered or focused → name,
major/minor, counts, latest note, related chips, buttons Focus/Back, Pick up
latest, Archive N idle (asks per session via `$.ui.ask`, Undo toast); session
selected → step number, title, status badge, meta, handoff note, files,
buttons Pick up here, Message (inline Input, `$.session.send`), New session
from here, Pin/Unpin, Move to topic, Archive/Unarchive.
Settings view (gear and `/map settings`): segmented controls for every
userConfig key, saved to `$.store.settings` and applied live: scope,
groupBasis (auto|manual), majorRule, majorMinSessions, recentDays, numbering,
showRelated, handoffNotes, autoJoin, rangeDays, useModelForTitles,
openOnStart (band|pane|none).
Keyboard: Tab between topics, Enter focuses, digit hotkeys 1–9 select chain
steps or join-chooser topics, Escape backs out. (Arrow keys cannot be bound by
a mod in Phase 1; Phase 2's Client `onKey` gets them.)

### Interaction phases
Phase 1 (elements only): the field is one `Svg` (desktop; `source` ≤ 131072
chars, `alt` required, root `<svg width="860" height="520" viewBox="0 0 860
520">`) regenerated from state; interactions through Buttons (topic pills,
numbered steps, chooser) laid out beneath the Svg; hover tracing driven by
`ui.focus` (Tab onto a topic button) and `ui.press`; terminal gets the list
view. Ship fully working before Phase 2, show the pane, compare with the
prototype and fix differences.
Phase 2 (Client): `client/map.js` as a Client element module. FACT from the
types: a Client module draws only `ClientElements` = terminal table minus
Client/Raster/Image (Box, Text, Button, Input, Select, Link, Code, Markdown),
no Svg, so Desktop cannot draw vectors in a Client. Plan: keep the Phase 1 Svg
and layer a Client for hit-testing (pointer move → `surface.post({type:
'hover', id})`, click → `pick`, drag → `drop` with `targetId`), the hooks
answer `ui.message` by updating state (hooks may answer `{ props }` to hand
the instance its next props). Spike first whether a `Box position="absolute"`
Client can sit over the Svg on Desktop; if not, draw the Client as a text-mode
map beside the Svg or ship Phase 1 alone and say so in the README.

### Other actions
Message: `$.session.send({ to:{ sessionId }, text })`; toast "not running"
when `isDelivered` is false. New session from here: open
`claude://code/new?folder=<cwd>&q=<prompt built from the note>` with
`$.process.run` (macOS `open <url>`; Windows `rundll32 url.dll,
FileProtocolHandler <url>` — avoids `cmd /c start` re-parsing `&`; Linux
`xdg-open <url>`); Desktop confirms the folder. Archive: a store flag that
hides the session; if `$.tool.list()` shows a Desktop session-archive tool
(`mcp__ccd_session_mgmt__archive_session`), offer via `$.ui.ask` to call it
too. Pin, Move (move mode: pick a topic button; drag in Phase 2), Tidy, every
destructive action with an Undo toast (in-pane toast row + `$.ui.toast`).
A node can never switch to an existing Desktop session; say so in the README.

### Quality
`claude plugin validate --strict` must pass; `claude plugin test` covers scan
parsing (fixtures), clustering with several topics in one folder, join
suggestion scoring, major rule, focus ordering, handoff injection, and the
drawing on both `desktop` and `terminal` via `$.ui.mount`. The mod never
approves tool calls or makes network requests, and spends model usage only for
notes, titles and join suggestions when those settings are on. README:
install, commands (/map, /map settings, /topic, /park, /pickup), settings
table, Desktop vs terminal behaviour, known limits.

## Working agreements with the user

- Own the outcome: decide by evidence, do not ask for things a careful
  colleague would settle; stop to ask only when a decision would be hard to
  undo (a destructive action, a change of scope). The user wants progress
  reports, not permission requests.
- Work phase by phase; one conventional commit per phase (`feat: phase 1 …`,
  `feat: phase 2 …`, `docs: …`), pushed to `main` of
  https://github.com/nrzz/constellation.
- Token-lean public tool: the mod must never waste the user's tokens. Lean
  defaults, every model call documented in the README with its cost (notes:
  one haiku call of ≤120 output tokens per main-loop turn when `handoffNotes`
  is `auto`; titles: one 30-token haiku call per auto topic only when
  `useModelForTitles` is on; join suggestions are local token matching, zero
  model use), and a zero-token path (`handoffNotes: manual`,
  `useModelForTitles: false`).
- The mod never approves tool calls and never touches the network.
- Show the work: after Phase 1 the user wants to see the pane (in the cloud:
  the Svg preview artifact, see below; locally: the real pane).
- House style of the user's other tools (github.com/nrzz): README with an
  install block, a commands list, a settings table, Desktop vs terminal
  behaviour, known limits; MIT.

## Continuing in a cloud session (read this first there)

The next session runs in Claude Code on the web, from this repository's `main`.
Nothing local is available there: no Desktop app, no pane to look at, none of
the user's transcripts, none of the local paths listed under "Environment
facts". Work like this:

1. `claude --version` must be 2.1.287 or later (the API was checked against
   2.1.308; if the cloud build is older or newer, re-check the types).
2. Run the `plugin-authoring` skill (`/plugin-authoring`) at the start: it
   writes that build's `claude-code.d.ts` into its own skill folder and prints
   the path. Copy it to `.claude-plugin/types/claude-code/index.d.ts`
   (gitignored) so `tsconfig.json` in this repo type-checks the mod with
   `npx -y typescript@5.9.3 tsc -p .`. Grep the types for a name; do not read
   the whole 22k-line file.
3. `claude plugin validate --strict .` and `claude plugin test .` work in the
   cloud; they need no session. Tests are the gate for every phase there.
4. The scanner is developed against `tests/fixtures/*.jsonl` (synthetic
   transcripts in the real line shapes; see the Data section). Add fixtures
   rather than relying on real transcripts.
5. The "show me the pane after Phase 1" step cannot happen in the cloud. Do
   this instead: a test writes the generated map and focus-mode Svg for the
   fixture data to `tests/out/*.svg` (gitignored), and the session publishes a
   small HTML preview page as an Artifact so the user can compare it with
   `design/TopicMap.dc.html` by eye. The real pane check happens in the next
   local Desktop session: clone/pull, then `claude --plugin-dir <repo>` in a
   terminal, or copy the repo into `~/.claude/dev-mods/<session-id>/constellation`.
6. Conventional commits, one per phase, pushed to `main` (solo repo). If the
   cloud environment forces a branch, open a PR per phase.
7. The mod itself must never use the network or Node globals; only the dev
   tooling (npx typescript) may.

## Environment facts (local Desktop session, verified 2026-10-27)

- Claude Code CLI for validate/test (not on PATH):
  `C:\Users\nares\AppData\Roaming\Claude\claude-code\2.1.308\c17a819afb40\claude.exe`
  → `claude plugin validate --strict D:\Projects\constellation`,
  `claude plugin test D:\Projects\constellation`.
- Generated types (the authority for the API):
  `C:\Users\nares\AppData\Local\Temp\claude\bundled-skills\2.1.308\<hash>\plugin-authoring\types\claude-code.d.ts`
  (written when the `plugin-authoring` skill loads; grep it rather than read it
  whole: 22,635 lines). The engine also lays `.claude-plugin/types/` beside a
  mod it loads (gitignored).
- Hot reload in a Desktop session: the engine watches
  `C:\Users\nares\.claude\dev-mods\<session-id>\<mod>\`; copy the repo there
  (robocopy /MIR, excluding .git and .claude-plugin/types) to load it; the
  person is asked once "Turn on the mods Claude writes in this session?".
  Alternatively `claude --plugin-dir D:\Projects\constellation` in a terminal.
- TypeScript 5.9.3 is installed in the session scratchpad
  (`…\scratchpad\tsc\node_modules\.bin\tsc.cmd`); the repo has no build step.
  A tsconfig that fits a hooks module: target es2023, lib es2023, types [],
  module esnext, moduleResolution bundler, strict, noEmit, skipLibCheck,
  jsx react, jsxFactory h, jsxFragmentFactory Fragment; include
  `.claude-plugin/types`, `hooks`, `types`, `tests`.
- `git` identity is set globally; `gh` is installed.

## Key API facts to code against

- `register(on, options)`; hooks are `($, e, next)`; `on` once per event per
  matcher; `$`-taking helpers must be top-level functions (validate refuses `$`
  passed to a function declared inside `register`).
- Elements from `$.ui.resolve(e)`; desktop table: Box, Text, Button, Input,
  Select, Svg, Link, Code, Markdown, Client; terminal: no Svg (has Client,
  Raster, Image); vscode: no Client; mobile: no Input/Select/Client.
- Button: `key` (defaults to label), `label`, `hotkey` (one digit or lowercase
  letter), `plain`, `dimColor`, `variant 'primary'`, `role 'dismiss'`,
  `autoFocus: true` only, `onPress(e)`; children may be strings and Text only.
  Input: `key` required, `label`, `placeholder`, `value`, `submitLabel`,
  `rows`, `onSubmit(value)`, `onInput(value)`. Select: `key`, `options
  [{value,label}]`, `value`, `onSelect(value)`. Box: flex props, gap/padding
  (cells or 'xs'..'xl'), borderStyle ('round' etc.), borderColor,
  backgroundColor, position absolute + offsets, `key` + `hover` (style only).
  Text: color, dimColor, size ('caption'|'footnote'|'body'|'heading'|'title'),
  weight, mono, wrap. Svg: `source`, `alt`, `width`/`height` px,
  `isInteractive` (sandboxed frame, hover CSS only, no events).
- Pane render: `on('ui.render', { component:'Pane', requestId:'constellation' })`;
  `e.props.bodyColumns`, `e.props.placement 'dock'|'inline'`, `e.props.scroll.
  bodyRows`, `e.viewport?.isFullscreen`. Band: `{ component:'AbovePrompt' }`,
  return `next(e)` to draw nothing; a digit hotkey in the band also fires from
  an empty prompt. `$.ui.invalidate('ui.render')` redraws (throttled).
- `$.state`: `atom({plugin:'constellation', key:'…'} as const, initial)`,
  `read($, atom)` in render (subscribes), `update($, atom, fn)` from handlers;
  every key declared in `types/index.d.ts` under `PluginState['constellation']`
  and the manifest's `"types": "./types/index.d.ts"`; keys must be string
  literals; a render hook cannot write state. `/clear` resets $.state
  (`classic.SessionStart` with source clear|resume|fork reloads it).
- `$.store.get/set/delete/keys` (shared by every session, 4 MiB total).
- `$.session.id()`, `cwd()`, `messages()` → `{role, text, toolUses}`[],
  `send({to:{sessionId}, text})` → `{isDelivered, reason?}`, `usage()`.
- `$.model.complete({ model:'haiku', prompt, system?, maxTokens, timeoutMs,
  effort:'low' })` → `{isAnswered, text, usage}` | `{isAnswered:false, reason}`.
- `$.fs.read(path)` (4 MiB cap, rejects over), `stat(path)` → `{kind, size,
  mtimeMs}`, `list(dir)` → `{name, kind, size, mtimeMs}`[], `exists`.
- `$.process.run(argv, {timeoutMs})` → `{exitCode, stdout, stderr}`; rejects
  if it cannot start. `$.clock.now()/after(ms, fn)/every(ms, fn)` (timer
  `.cancel()`); `$.ui.toast(text)`, `$.ui.ask(question, options)` (rejects when
  dismissed), `$.ui.open/close/panes`, `$.ui.focus`, `$.tool.list()`,
  `$.command.register({name, description, argumentHint, immediate})` in
  `session.start` (wrap in try/catch: a taken name throws).
- Events: `session.start {cwd, surface, isInteractive}`, `session.end
  {reason, sessionId}` (1.5 s for all hooks), `prompt.submit {text, context?,
  origin, command?, isMeta?}` → `next({...e, context})` or `{drop}`,
  `turn.complete {answer, durationMs, isAborted, turnId, agentId?}`,
  `command.run {command, args}` → `{text}` or `{}`, `ui.press {plugin,
  element, component, requestId, surface}`, `ui.focus {component, requestId,
  element?, origin}`, `ui.message {element, module, data}` → `{props?}`,
  `ui.fault`, `ui.close {id, origin.kind}` (answer without next keeps it open).
- Tests (`claude-code/testing`): `test(name, {options?}, async ($, on) => …)`,
  stubs via `on('store.get', …)` → `{value}`, `mock.store(on, {...})`,
  `mock.clock(on)`, `on('ui.open', () => ({ value: { isPlaced: true } }))`,
  `on('session.start', e => ({ cwd }))`, `on('prompt.submit', ($, e) => ({ text:
  e.text, context: e.context }))`, `$.ui.mount({ plugin:'constellation',
  surface:'desktop'|'terminal', component:'Pane', requestId:'constellation',
  props:{ title, isFocused, bodyColumns, placement, scroll:{offset, bodyRows},
  view:{} } })` → `ui.find({type, key, text})`, `ui.press({key})`,
  `ui.input({key, text})`, `ui.select({key, value})`, `ui.unmount()`.
  Register every stub before the first call on `$`.

## Next steps (in order)

1. `hooks/scan.ts` + `tests/scan.test.ts` with fixture lines (user string
   prompt, isMeta row, command row, assistant with Edit tool_use, summary line,
   queue-operation line, a >4 MiB stat → large stub).
2. `hooks/cluster.ts` + tests: several topics in one folder, explicit assign
   wins, non-main branch hint, Unsorted, major rule (either/count/recent), join
   scoring with a clear winner and a tie, focus ordering both ways.
3. `hooks/layout.ts` (seeded + repulsion, focus chain positions).
4. `hooks/draw.tsx`: `svgOf(model, ui)` string builder; header, buttons row,
   cards, settings, list, band, toast trees; terminal list.
5. `hooks/register.tsx`: state atoms, store load/save, scan on start and on
   `/map`, commands, band, pane, prompt.submit injection, turn.complete notes,
   ui.focus tracing, ui.close back-out, actions.
6. `types/index.d.ts` contract for every atom; `claude plugin validate
   --strict`; `claude plugin test`; `tsc -p`.
7. Load in the Desktop session (copy to dev-mods), open `/map`, screenshot,
   compare with `design/TopicMap.dc.html`, fix; commit `feat: phase 1 …`.
8. Phase 2 spike (Client over Svg); `client/map.js`; commit `feat: phase 2 …`.
9. README (install via marketplace, commands, settings table, Desktop vs
   terminal, known limits incl. "a node never switches to an existing Desktop
   session", Phase 2 limits); final `claude plugin validate --strict`.
