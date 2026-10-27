# Constellation: handover (2026-10-27, end of the cloud sessions)

From here on the work happens on the owner's Windows 10 machine with Claude
Desktop, not in the cloud. This file is the place to start: where things stand,
how to run everything on Windows, what to check there, and what is left.
`.claude/CLAUDE.md` (loaded by every Claude Code session in this folder; not at
the root, where `plugin validate --strict` refuses a CLAUDE.md) holds the
working rules; `PLAN.md` holds the spec, the API facts and the history of
every pass; the `README.md` is the user-facing description.

## 1. Start here (Windows)

1. **Get the code.** The installed plugin folder is a git checkout of `main`:
   `C:\Users\Lenovo\.claude\local-plugins\constellation`. In PowerShell there:

   ```powershell
   git status                 # untracked HANDOVER.md, REPO-PROMPT.md and analysis-8a99ba1\ are fine; nothing tracked may be modified
   git fetch origin
   git checkout main
   git pull --ff-only         # main now carries the Windows pass (see section 3)
   git log --oneline -1
   ```

   The untracked root `HANDOVER.md` and `REPO-PROMPT.md` in that folder are
   from 8a99ba1 and earlier and are superseded by this file. Keep or delete
   them; they do not block the pull, since this file lives in `docs\`.

2. **Load it.** In each open Desktop session that should run the new code:
   `/reload-plugins`, or open a new session (a session's Claude Code process
   loads plugins when it starts).

3. **Point the tools at the Desktop's own Claude Code.** The `claude` on PATH
   is 2.1.283, too old for mods (2.1.287 or later). The Desktop carries a
   current one:

   ```powershell
   $env:CLAUDE_BIN = (Get-Item "$env:LOCALAPPDATA\Claude-Data\*\claude-code\*\*\claude.exe" |
     Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1).FullName
   $env:CLAUDE_BIN            # was ...\claude-code\2.1.308\c17a819afb40\claude.exe on 2026-10-27
   & $env:CLAUDE_BIN --version
   ```

   (Or put that folder on PATH ahead of the old one, or `claude update` the
   PATH install.)

4. **Run the gates** (section 5), then the **re-test checklist** (section 4),
   and write what you find to an untracked `analysis-<commit>\REPORT.md` with
   screenshots, as was done for 8a99ba1. Mark each item **Verified** (ran it)
   or **Read** (found in code only).

5. **Then the open items** (section 6), most important first.

## 2. Working rules (from the owner, all sessions so far)

- Claude owns the outcome, like a PM: decide by evidence, do the complete
  work, never skip a check on an assumption, never shrink the scope. Ask only
  before something hard to undo.
- Quality over speed. When asked for timing, give a table of what is left and
  how long each piece takes; otherwise short progress reports, not permission
  questions.
- When everything is verified, push to `main` of
  https://github.com/nrzz/constellation (solo repo, conventional commits:
  `feat:`, `fix:`, `test:`, `docs:`). A feature branch is fine for work in
  progress; `main` gets only verified work.
- Commit messages end with the attribution lines the session's own Claude Code
  gives (a `Co-Authored-By:` line). Never put a model name or model identifier
  in a commit, a doc or the code.
- The README carries real pictures (`docs/images`, drawn by the real engine
  with `tests/e2e/shots.mjs` and `shots-terminal.mjs`); regenerate them when
  the drawing changes.
- Token-lean public tool: the mod never wastes the user's tokens, documents
  every model call and its cost, never approves tool calls, never touches the
  network (see `PLAN.md`, Working agreements).
- On Windows, Bash heredocs collapse `\\` to `\`: write scripts with the Write
  tool, not heredocs.

## 3. Where things stand

**`main` = the Windows pass**, on top of 8a99ba1 (the build the Windows 10
report was run on). Commits of the pass, oldest first:

| Commit | What |
| --- | --- |
| e55a611 | The Desktop layer covers the whole picture; pills beat satellites; a narrow pane stays legible |
| 1003c35 | The Desktop harness sizes the layer as the Desktop does; a dot wins its own cell |
| ad53b13 | The installers fall back to the Claude Desktop app's own Claude Code |
| 5af75c2 | The terminal prints only marks a Windows console font has; docs |
| 185d3bd | A chain's meta lines keep to their room and the field; a narrow-pane picture |
| 30ae9a5 | The terminal pictures with the console-safe marks |
| (next) | A unit test for F5 (`scheduleReclaim`), these notes, `.claude/CLAUDE.md` |

### What the Windows report (8a99ba1) found, and what was done

| Item | Found on Windows | Fixed by | Code | Test |
| --- | --- | --- | --- | --- |
| F1 | The pointer layer covered only the picture's top six rows (the Desktop sizes a Client's height to what it draws), so every click landed rows below its aim | The layer draws the picture's own height: `floor(columns × fieldH / fieldW × cellAspect)` rows, cell 7.7 × 19.8 px (aspect 0.389), and maps the pointer by the same measure; a host that sizes by its box and reports more rows is trusted instead. Settings › Advanced › **Layer height** (−3…+3, 0.02 of aspect a step, about 5 %) corrects a font with other cells; the Outline names the cell it assumes and says what to do when its edge misses the picture's bottom | `client/map.js` `layerFor`, `DESKTOP_ASPECT`; `hooks/register.tsx` `layerAspect`; setting `layerHeight` in `hooks/state.ts`, `types/index.d.ts`, `.claude-plugin/plugin.json` | `tests/client.test.tsx` (layer rows, by-box host, cellAspect); `tests/e2e/desktop.mjs` (every node clicked at five widths, a 44-column pane, a wider font before and after +2, the lowest topic of the big map) |
| F2 | Two auto topics got the same name | `uniqueNames`: names compared as word sets; the person's names and the larger topic keep a name, the others take their next most telling word, else a number | `hooks/cluster.ts` `rankedWords`, `nameKey`, `uniqueNames`, `buildModel` | `tests/cluster.test.ts` "topic names" |
| F3 | Related anchors overlapped or ran off the field | One slot each (at least 150 units), as many as fit, labels cut to the slot; the picture and the layer share one geometry | `hooks/layout.ts` `anchorSlots`, `ANCHOR_MIN_SLOT`; `hooks/draw.tsx` `anchorsOf` | `tests/edge.test.tsx` "related anchors fit the field" |
| F4 | The terminal map's hint wrapped into the map's first row | Fitted to the width, `wrap: 'truncate'` | `client/map.js` `fitText` | `tests/client.test.tsx` narrow hint |
| F5 | A pending keyboard reclaim reopened a pane just closed | The reclaim checks `$.ui.panes()` first; a close cancels it | `hooks/actions.ts` `reclaimKeys`, `scheduleReclaim`, `cancelReclaim`; `hooks/register.tsx` the `ui.close` hook | `tests/review.test.tsx` "a keyboard reclaim never reopens a closed pane" (a hand-turned clock; the test kit cannot raise `ui.close`); Escape end to end in `tests/e2e/tui.sh` |
| F6 | The focused pill's hit width left out "· you" | One `focusPillOf` for the picture and the layer | `hooks/draw.tsx` `focusPillOf` | `tests/edge.test.tsx` "your own focused topic" |
| F7 | Satellites took presses on a pill's edges | A point inside a drawn box belongs to it, unless within 8 units of a dot or (whole-cell pointer) in the very cell the dot's centre lies in | `client/map.js` `nodeAtPoint`, `isInsideDrawn` | `tests/client.test.tsx` pill edge / dot cell |
| F8 | `desktop.mjs` flaked on a settings press (a stale invalidation) | The harness draws until the tree changes (3 s cap) | `tests/e2e/desktop.mjs` `redrawAfter` | every cloud run since is clean (the flake was 1 in 4 on Windows: run it four times there) |
| F9 | `desktop.mjs` crashed with EPERM in clean-up on Windows | `claude.exe` starts without a shell, its tree is killed with `taskkill /T /F`, `rmSync` retries and only warns | `tests/e2e/desktop.mjs` `resolveClaude`, `spawnClaude`, `close`, `cleanUp` | needs a Windows run |
| Limit | The terminal hint promised hover; conhost passes clicks but no motion, the Desktop's terminal panel no mouse | The hint promises clicks only: "Click or Tab to a topic · Enter focuses" | `hooks/draw.tsx` `pointerHint` | `tests/interact.test.tsx` hints |
| Limit | conhost drew ⚙ and ◆ as boxes | The terminal draws only WGL4 marks: ♦ ◦ ► ▼ * √, no gear or refresh sign; status line `♦ <topic> · step N · note saved` | `hooks/draw.tsx` `marks`, `statusGlyph`; `client/map.js` legend; `hooks/actions.ts` status | `tests/interact.test.tsx` "every mark the terminal pane prints…" |
| Limit | The installers refused the PATH `claude` 2.1.283 | Fall back to the newest Claude Code the Desktop keeps; `CLAUDE_BIN` names one; `install.ps1` runs in a script block so `irm … \| iex` never closes the window, and is ASCII so PowerShell 5.1 reads it right | `install.sh`, `install.ps1` | `tests/e2e/installers.sh` (54 checks); `tests/e2e/installers.ps1` (needs a Windows run) |
| Look | Text was 4–5 px in a 300 px pane | The field narrows with the pane: `fieldWidthFor(bodyColumns)`, 520…860 units | `hooks/layout.ts` `fieldWidthFor`; `hooks/actions.ts` `viewOf` | `tests/edge.test.tsx` narrow pane |
| Look | (found in the cloud) a narrow chain's meta lines ran into each other; a short chain's end meta ran off the field | Each meta line keeps to its same-row room in mono characters and to the edge, shedding turns, then "latest" | `hooks/layout.ts` `chainMetaChars`; `hooks/draw.tsx` chain labels | `tests/edge.test.tsx` "a focused chain keeps every label and meta line to its room" |

### Gates at this commit (cloud, Claude Code 2.1.311, Linux)

- `claude plugin validate --strict .`: passes.
- `claude plugin test .`: **146 pass**, 0 fail.
- `tsc` (TypeScript 5.9.3): clean.
- `node tests/e2e/desktop.mjs`: **105 passed**, 0 failed (the Desktop's stdio
  wire against the real engine; the map's Client mounted and sized as the
  Desktop does, clicked through).
- `E2E_INSTALL=1 bash tests/e2e/tui.sh`: **67 passed**, 0 failed (the real
  TUI in tmux, installed through `install.sh`, with a real model turn).
- `bash tests/e2e/installers.sh`: **54 passed** (sh, dash, bash).

### Not verified yet (needs Windows or a real Desktop window)

- The Desktop's own layout of the layer over the picture with this build
  (F1 in a real window; the harness models the measured behaviour).
- `install.ps1` and `tests\e2e\installers.ps1`: PowerShell could not be
  fetched into the cloud container.
- `desktop.mjs` on Windows (F8, F9).
- The terminal hint and glyphs in conhost and Windows Terminal.
- The independent review of the pass (section 6.2).

## 4. Windows re-test checklist

Do these in a Desktop session on a real folder (`E:\GIT` has 163 sessions,
17 over 4 MiB) after `/reload-plugins`. For each: what to do, what should
happen, what to report if it does not.

1. **Layer covers the picture (F1).** Open the map (`/map`), Settings ›
   Advanced › Clicks on the picture: **Outline**. Expected: an orange rounded
   edge around the picture whose bottom meets the picture's bottom (within
   one row), and the top line reads
   `layer C×R · field W×H · cell 0.39 · no pointer yet`. Click topics near the
   top, the middle and the **bottom** of the map: each focuses the topic
   clicked (the crumb names it). Hover traces the topic under the pointer.
   If the edge stops above or below the picture's bottom: change **Layer
   height** (+1 if the edge is short, −1 if it overshoots) until it meets,
   and report the value, the outline's text and a screenshot. Set Clicks back
   to **On** after.
2. **Pill edge vs satellite (F7).** Click a pill's top edge right under one
   of its satellites: the topic focuses. Click a satellite's dot: its session's
   card opens.
3. **Your own pill (F6).** Join a topic (band or `/topic`), focus it, click
   the right end of its pill on "· you": back to all topics, as a click on
   its left end does.
4. **Unique names (F2).** On `E:\GIT`: no two topics share a name (8a99ba1
   had two alike); the shorter one now carries an extra word or a number.
5. **Anchors (F3).** Focus a topic with many related topics: the dashed
   anchors along the bottom do not overlap and none is cut at the edge.
6. **Narrow pane.** Drag the pane to about 300 px: the labels stay readable
   (the field draws 520 units across), a focused chain's lines do not run
   into each other, and clicks still land (Outline on to see the edge).
7. **Terminal hint (F4) and marks.** In a terminal session (conhost and
   Windows Terminal), `/map`: the hint reads "Click or Tab to a topic · Enter
   focuses" on one line even in a narrow pane; no boxes (□) anywhere: the
   legend `● active ○ idle ◦ shipped ♦ you`, Advanced's `Show ►` / `Hide ▼`,
   a pinned session's `*`, a toast's `√`, the status line
   `♦ <topic> · step N · note saved`. A click on a topic focuses it in
   conhost (no hover there: expected).
8. **Closed stays closed (F5).** In a terminal session: click the map, then
   close the pane (`/map close`, or Escape until it closes): it does not
   reopen half a second later.
9. **Gates on Windows** (section 5): validate, tests (146), tsc,
   `desktop.mjs` (105, exit 0, no EPERM: F9) four times in a row (F8),
   `installers.ps1` (all PASS).
10. **The one-line installer.** In a fresh PowerShell window with the old
    PATH `claude` still first:
    `irm https://raw.githubusercontent.com/nrzz/constellation/main/install.ps1 | iex`.
    Expected: "Claude Code 2.1.283 is on PATH; mods need 2.1.287 or later.
    Using the Claude Desktop app's own 2.1.3xx:" with its path, then the
    install (it says "already installed" or installs), "Done.", and the
    window stays open. With the Desktop's folder removed from the search
    (or on a machine without it), a refusal also leaves the window open.

## 5. Running everything on Windows

From the repo folder, in PowerShell, with `$env:CLAUDE_BIN` set (section 1.3):

```powershell
& $env:CLAUDE_BIN plugin validate --strict .
& $env:CLAUDE_BIN plugin test .                       # 146 tests; the stubs are Windows-safe since 8a99ba1
node tests\e2e\desktop.mjs                            # the Desktop's wire, about a minute; E2E_ONLY=1,3 runs scenarios 1 and 3
powershell -NoProfile -ExecutionPolicy Bypass -File tests\e2e\installers.ps1   # Windows PowerShell 5.1; also runs pwsh 7 when installed
node tests\e2e\shots.mjs                              # README's Desktop pictures (needs: npm i -g playwright; npx playwright install chromium)
```

- **tsc** needs the engine's types beside the mod:
  `.claude-plugin\types\claude-code\index.d.ts` (gitignored). The engine lays
  `.claude-plugin\types\` when it loads a mod from a folder; otherwise run
  the `plugin-authoring` skill in a session (it writes `claude-code.d.ts`
  under `%TEMP%\claude\bundled-skills\<version>\<hash>\plugin-authoring\types\`)
  and copy it there. Then `npx -y -p typescript@5.9.3 tsc -p .`.
- **`tests/e2e/tui.sh`** and **`shots-terminal.mjs`** need tmux and python3
  (and ffmpeg for the clip): not on Windows. Run them in WSL with a Linux
  `claude` (2.1.287 or later), or skip them on Windows and say so.
- `tests/e2e/installers.sh` runs in Git Bash or WSL (`bash tests/e2e/installers.sh`).
- `desktop.mjs` honours `CLAUDE_BIN`, `E2E_ONLY`, `E2E_INSTALL`,
  `E2E_SHOTS=<dir>`, `E2E_DEBUG`, `E2E_KEEP` (keep the temp folders).

## 6. Open items, most important first

### 6.1 The Windows re-test (section 4)

It decides whether F1 is fixed in a real window. If the outline's edge needs
a Layer height other than 0 at 100 % scaling, the measured cell
(7.7 × 19.8 px) is off for that machine: report the scaling, the font and
the value, and consider deriving the aspect from the Desktop if it ever
reports its cell size.

### 6.2 The independent review of the pass

Five reviewers (one area each) with a skeptic per finding were started in the
cloud on 30ae9a5; if their results are not appended below, run the review on
Windows: in a Claude Code session in this folder, ask for an independent
review of `git diff 8a99ba1..HEAD` by area, each finding verified by a second
reader who tries to refute it, then fix what holds. The areas:

1. **Pointer geometry** (F1, F6, F7): `client/map.js` (`layerFor`,
   `scaleFor`, `nodeAtPoint`, `isInsideDrawn`, the hits render and
   `onPointer`), `hooks/register.tsx` (`layerAspect`, the Client's props),
   `hooks/draw.tsx` (`sizeOf`, `focusPillOf`, `anchorsOf`, `fieldOf` vs
   `svgOf`). Does the layer cover the picture at any width, in map and focus
   mode, outline on and off; does a whole-cell click map right at the
   bottom, the edges, a pill's edge under a satellite, a minor label, the
   anchors, the back pill; a box-sized host; stale geometry in the pointer
   handler after props change?
2. **Field size and names** (F2, F3, narrow panes): `hooks/layout.ts`
   (`fieldWidthFor`, `placeTopics` width, `anchorSlots`, `focusSize`,
   `chainLabelChars`, `chainMetaChars`), `hooks/actions.ts` (`placementOf`,
   `viewOf`), `hooks/cluster.ts` (`uniqueNames` and friends). Anything still
   assuming 860 wide; placements at 520; name stability across scans.
3. **Keyboard and lifecycle** (F5): `reclaimKeys`, `cancelReclaim`, the
   `ui.close` hook, `pointerHint`. Can a reclaim still reopen a closed pane
   (X, `/map close`, Escape twice, session end); can cancel drop a needed
   reclaim?
4. **Installers**: `install.sh` (dash, bash 3.2 as sh, busybox, Git Bash),
   `install.ps1` (PowerShell 5.1 and 7, `-File` and `irm | iex`),
   `tests/e2e/installers.*`.
5. **Harness** (F8, F9): `tests/e2e/desktop.mjs` (spawn and quoting on
   Windows, taskkill, clean-up, `redrawAfter`, `mountLikeDesktop`, `refit`,
   `cellOf`, `checkCovers`, `checkEveryNode`): is the Desktop model faithful,
   can a check pass where a real Desktop would fail?

### 6.3 The release checklist

In `PLAN.md`, last section: install from the marketplace on a clean machine,
one look at the layer in a real window (6.1), watch the first real folder
(topic names, join suggestions), tag v0.1.0.

## 7. Facts to code against (measured or read; details in PLAN.md)

- **Desktop Client sizing**: width from its box, height from what it draws
  (`width="100%" height="100%"` does not make it as tall as its box).
- **Desktop cell**: 7.7 × 19.8 px at 100 % scaling (Windows 10, Claude Desktop
  3.6556, engine 2.1.308). The picture is `columns × 7.7` px wide.
- **Desktop pointer**: whole cells only (no `fine`); `enter`, `move`,
  `leave`, `down`, `up` all arrive at the frame. A Client's events never
  reach the engine; only its posts do (`ui_message`).
- **Terminal mouse**: only under the fullscreen renderer (`/tui fullscreen`,
  the default after the first start); conhost passes clicks but no motion;
  the Desktop's terminal panel passes none. Windows console fonts carry
  only WGL4.
- **Claude Code on the machine**: PATH 2.1.283 (too old); the Desktop's own at
  `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\<version>\<build>\claude.exe`
  (Store app) or `%APPDATA%\Claude\claude-code\<version>\<build>\claude.exe`
  (installer app). Both share `~/.claude` and its plugins.
- **Paths on the owner's machine** (2026-10-27): installed plugin folder
  `C:\Users\Lenovo\.claude\local-plugins\constellation` (local marketplace
  `constellation`, plugin `constellation@constellation`, user scope); plugin
  store `~/.claude/plugins/store/constellation_constellation-*.json`; the
  Desktop's log
  `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Claude\logs\main.log`.
- The org plugin `cc-plugin-sec-default` keeps `classic.SessionStart` from
  user plugins; Constellation also restarts on `session.end` and checks the
  session id on every command, press and turn and every three seconds.
- The full API facts, the engine facts read from the 2.1.311 binary, the
  Desktop facts and every pass's record are in `PLAN.md`.

## 8. Code map

| File | What it holds |
| --- | --- |
| `hooks/scan.ts` | Reads `~/.claude/projects/<slug>/*.jsonl` (large ones in slices through `sh` or PowerShell) |
| `hooks/cluster.ts` | Topics: signals, clustering, links, auto names and `uniqueNames` |
| `hooks/layout.ts` | Field geometry: `fieldWidthFor`, topic placement, satellites, chain rows, `chainLabelChars`, `chainMetaChars`, anchor slots, `DESKTOP_CELL` |
| `hooks/draw.tsx` | The Svg (`svgOf`), the layer's props (`fieldOf`), the pane, band, cards, settings; `marks` (glyphs per surface), `pointerHint` |
| `hooks/actions.ts` | Everything a press or a post does; `viewOf`, `placementOf`, `reclaimKeys`, the status line |
| `hooks/register.tsx` | Wires events, commands and renders; `layerAspect`; the `ui.close` hook |
| `hooks/state.ts`, `types/index.d.ts`, `.claude-plugin/plugin.json` | Settings and state atoms (incl. `layerHeight`) |
| `client/map.js` | The Client: the terminal's text map and the Desktop's pointer layer (`layerFor`, `nodeAtPoint`) |
| `install.sh`, `install.ps1` | One-line installers with the Desktop fallback |
| `tests/*.test.ts(x)` | Unit tests (`claude plugin test .`); `tests/helpers.tsx` is the shared engine stub |
| `tests/e2e/desktop.mjs` | The Desktop's wire against the real engine, with a Desktop model of the layer |
| `tests/e2e/tui.sh`, `lib.sh`, `cells.py` | The real TUI in tmux with real mouse events |
| `tests/e2e/installers.sh`, `installers.ps1` | The installers against stand-in `claude` commands |
| `tests/e2e/shots.mjs`, `shots-terminal.mjs` | The README's pictures |
| `design/` | The approved prototype and screens |

## 9. Review results

The cloud review of the pass (5 areas) did not finish before the move to
Windows: run it there (6.2). Its first attempt was cut off by an account
limit before any reviewer read a line; the second was still running when
these notes were written. If a later commit appends its results here, act on
them first.

## 10. Prompt to continue on Windows

Paste this into a new Claude Code session (the Desktop's Code tab, or
`claude` from the Desktop's own folder) opened in
`C:\Users\Lenovo\.claude\local-plugins\constellation`:

```text
You are continuing the Constellation mod (github.com/nrzz/constellation) on my
Windows 10 machine with Claude Desktop. This folder,
C:\Users\Lenovo\.claude\local-plugins\constellation, is both the git checkout
and the installed plugin.

1. Read .claude/CLAUDE.md, then docs/HANDOVER.md in full. PLAN.md holds the spec, the
   API facts and every pass's record: read the sections the handover points to
   when you need them.
2. Bring the folder to the latest main (handover 1.1; my untracked files there
   may stay), set CLAUDE_BIN to the Desktop's newest claude.exe (1.3), and run
   the gates on Windows (section 5): validate --strict, plugin test (146 pass),
   tsc, node tests\e2e\desktop.mjs four times (105 passed and exit 0 each
   time, no EPERM), and tests\e2e\installers.ps1 (all PASS).
3. Take me through the re-test checklist (section 4): tell me exactly what to
   click and look at in the Desktop window for the steps that need my eyes,
   and do the rest yourself. Record every result as Verified or Read in
   analysis-<commit>\REPORT.md with my screenshots.
4. Run the independent review in section 6.2 unless section 9 already has its
   results: one reviewer per area, each finding checked by a second reader
   who tries to refute it.
5. Fix everything the re-test and the review find, each with a test that
   fails without the fix. Keep README.md, PLAN.md and docs/HANDOVER.md
   current, and regenerate the README pictures if the drawing changes.
6. When every gate passes and the re-test is clean, commit (conventional
   commits, no model names) and push to main. Then give me a short summary
   and what is left.

Follow the working rules in docs/HANDOVER.md section 2: complete work, no
skipped checks, no shrinking the scope, short progress reports.
```
