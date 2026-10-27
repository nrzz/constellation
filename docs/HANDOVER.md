# Constellation: handover (2026-10-28, the Windows re-test and the live pane)

This file is the place to start: where things stand, the two machines, how to
run everything on Windows, what is left to check, and the review's findings
with what became of each. `.claude/CLAUDE.md` (loaded by every Claude Code
session in this folder; not at the root, where `plugin validate --strict`
refuses a CLAUDE.md) holds the working rules; `PLAN.md` holds the spec, the
API facts and every pass's record; `README.md` is what users read.

## 1. Start here

1. **Find the code.** The work of 27-28 October is on the branch
   `fix/windows-retest` (worktree `D:\Projects\constellation-fixes` on the
   owner's Windows 11 machine; section 2). Until item L9 of the build queue
   fast-forwards it, `main` is still 4c378de, the build the re-test ran on.
   Nothing of this pass is pushed yet (L10 pushes `main`).

   ```bash
   git -C /d/Projects/constellation-fixes log --oneline -1
   git -C /d/Projects/constellation-fixes merge-base --is-ancestor 8c9f146 HEAD && echo ok
   ```

2. **Point the tools at the Desktop's own Claude Code** (section 5). Neither
   machine has a usable `claude` on PATH: the Windows 11 one has none, the
   Windows 10 one has 2.1.283, too old for mods (2.1.287 or later).

3. **Load a change.** The engine installs a *copy* of the plugin
   (`~/.claude/plugins/cache/constellation/constellation/0.1.0`), not the
   checkout. After a change reaches the checkout the plugin was installed
   from: `"$P" plugin update constellation@constellation`, confirm
   `~/.claude/plugins/installed_plugins.json` names the new `gitCommitSha`,
   then open a new session. Whether `/reload-plugins` alone picks up a change
   is not measured; do not rely on it.

4. **Run the gates** (section 5), then the open items (section 6).

## 2. The machines

| | Windows 11 (this work) | Windows 10 (the first report) |
| --- | --- | --- |
| User, hardware | `nares`, 16 GB (little free with three build lanes) | `Lenovo`, 1366×768 at 96 DPI |
| Desktop | 3.6556.2, **installer app** (`%LOCALAPPDATA%\AnthropicClaude`) | 3.6556, **Store app** |
| Desktop's Claude Code | `%APPDATA%\Claude\claude-code\2.1.308\c17a819afb40\claude.exe` (2.1.304 beside it) | `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\2.1.308\<build>\claude.exe` |
| `claude` on PATH | none | 2.1.283 (too old) |
| PowerShell | 5.1 only (no pwsh 7) | 5.1 |
| Shells for sessions | Git Bash (with `dash`), conhost, Windows Terminal | Git Bash, conhost |
| WSL | only `docker-desktop`, no Linux distro | not recorded |
| Repo | `D:\Projects\constellation` (`main`, the marketplace the plugin is installed from, user scope) and the worktrees `-fixes`, `-fixes-b`, `-fixes-c` | `C:\Users\Lenovo\.claude\local-plugins\constellation`; real folder `E:\GIT` (163 sessions) |
| Real folders | `D:\Sensus-Design` 369 sessions (97 over 4 MiB, 316 scheduled runs), `D:\Projects` (many, the build lanes among them) | `E:\GIT` |
| Push | `git push --dry-run origin HEAD:main` works (user.email nareshprabu18@gmail.com) | not recorded |

Both apps share `~/.claude` and its plugins. The Desktop's log on the Store
app: `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Claude\logs\main.log`.

## 3. Where things stand

**The Desktop pane is live.** Seeing the map beside the reference (the skills
graph on dasprakashsekar.site, `design/screens/06-reference-skill-graph.png`)
the owner chose, on 27 October, to make the pane live before the review's
fixes. The field Svg now draws in the engine's script-less interactive frame
(`isInteractive: true`, setting `pictureMode`, default `live`): hover traces a
topic in CSS (its pill light, its spokes and links in its colour, the rest
faded, the hint swapped for its caption), the stars twinkle, satellites sway,
topics float, an idle cycle traces each major topic in turn with a soft fade,
running topics wear a ring and glow and their running sessions a core and a
ripple, satellites and steps carry `<title>` tooltips. A live picture takes no
clicks (the frame gets no pointer position): picking goes through the buttons
under it, the Tab ring and the keys. `pictureMode: clicks` brings back the old
image with the invisible Client layer. Every cell surface was restyled to one
translucent standard (chips tinted in each topic's colour, amber only for you,
live and the selection). The terminal's text map did not change.

The work ran unattended as the scheduled tasks `constellation-build`(`-b`,
`-c`), one item per run from `analysis-4c378de\QUEUE.md` in the main checkout
(gitignored), logged in `RUNS.md` there, in three lanes (branches
`fix/windows-retest`, `fix/lane-b`, `fix/lane-c`, merged into each other at
the start of every run).

### Commits on `fix/windows-retest` since 4c378de (49 before this update, oldest first, by theme)

| Theme | Commits |
| --- | --- |
| Re-test fixes (S-1, S-2, installers, non-Latin ids) | 9690493, 1f8bd3f, b02e1c0, 62312f3 |
| The live picture (L2, L3, L3a, L3b) and its harness (L4) | 528bbe1, 29a90d8, d1f80dd, 766a0aa, 079c7f7, 722442f, 9d1b5b0, 8e922cb |
| Every surface restyled (L4a, L4b) | f60772b, ba40e61, 4c679ff, 845306c, b321dcd, 927a592 |
| The review's fixes (R1-R26, section 9) | 3e735d8 … 2eb38f4, cde1c9a, 8c9f146 |
| README pictures as the live picture (L5) and this file (L7) | 6876673, 8f59569 |

### What the re-test (REPORT.md) found and what was done

| Item | Found | Done |
| --- | --- | --- |
| Gates at 4c378de | validate, 146 tests, tsc, desktop.mjs 105 × 4 (no EPERM: F8 and F9 hold on Windows), installers.ps1 33 | Verified on Windows 11 |
| S-1 | A Desktop paste (`<pasted_content …>`) was not a prompt: 81 of 476 transcripts; its tags leaked into join words | 9690493: tags stripped, the paste is a turn; scan cache `scan3:`, old keys cleared once |
| S-2 | A scheduled task's run showed "0 turns" (316 of 369 sessions in `D:\Sensus-Design`) | 1f8bd3f: the run's row is a turn, its boilerplate never a first prompt |
| F2 names | No two topics alike on the 369-session folder | Verified offline with the mod's own scan and clustering |
| Checklist 10, the one-line installer | Desktop fallback works with no PATH claude, with an old one, and refuses cleanly with neither | Verified (stand-in 2.1.283) |
| O-1 | After an install the engine prints "N userConfig options not yet set": every option has a default | L6 says so in the README |
| Install | The engine copies the plugin to the cache; a user-scope install hot-loads into open Desktop sessions; auto notes (haiku) work on Windows | Recorded (section 1.3) |

### Gates at dc5303d (Windows 11, Claude Code 2.1.308, Git Bash)

- `plugin validate --strict .`: passes. `plugin test .`: **255 pass**, 0 fail.
- `tsc` (TypeScript 5.9.3): clean.
- `tests/e2e/desktop.mjs`: **265 passed**, 0 failed, exit 0 (the Desktop's
  wire against the real engine: a live scenario on a big folder with a running
  session, `enter` before the first move as the Desktop sends it, the click
  layer compared with the picture, narrow panes clicked by
  whole cells at six widths and a 300-350 px sweep).
- `tests/e2e/installers.ps1`: 56 (PowerShell 5.1 only; more with pwsh 7).
- `bash tests/e2e/installers.sh`: 78 (sh, dash and bash, in Git Bash).
- Not run here: `tests/e2e/tui.sh` and `shots-terminal.mjs` (need WSL with a
  Linux distro and tmux).

L8 runs every gate again on the final branch (desktop.mjs four times).

## 4. What is left to see with eyes (L9's OWNER-CHECK.md)

The harness models the Desktop; these need a real Desktop window. L9 writes
them as steps for the monitor session (the owner's word: it drives the mouse
itself) into `analysis-4c378de\OWNER-CHECK.md`, in a NEW Desktop session on
`D:\Projects` after the plugin update.

1. **Hover** a topic: instant trace in its colour, the rest fades, the caption
   swaps to its goal (else its latest note, else count and last activity).
2. **Motion and the idle cycle**: with nothing pointed the trace walks the
   major topics and the others ease to about 0.4 over about 0.6 s (R16 made the
   fade work without `@property`; whether the Desktop's scrub keeps the rest of
   the sheet is seen only here).
3. **Running things stand out**: a running topic's ring and glow, its running
   sessions' cores and ripples, "● live" in its caption, the cycle starting there.
4. **Every surface** against `analysis-4c378de\design-before-*.png` /
   `design-after-*.png`: the join card, header, buttons under the map, cards,
   List, settings, band states, toasts, empty states. Also how the Desktop
   draws a `plain` Button with a hotkey inside a tinted Box (L4a's question).
5. **Tooltips** on satellites and chain steps.
6. **Focus a topic** with its button under the map; hover its steps.
7. **A narrow pane** (about 300 px): labels readable, chains clear.
8. **Settings › Advanced › Picture: Clicks**: the old picture and layer;
   Outline's edge meets the picture's bottom (report the Layer height if not);
   clicks at the top, middle and bottom focus the topic clicked.
9. **Terminal** (conhost, the Desktop's claude.exe, `/map`): the hint on one
   line, no boxes for marks, the status line `♦ <topic> · step N · note saved`.
10. **Closed stays closed (F5).** `/map close` cannot meet a pending reclaim
    (refute-A3's A3-1: a command closes before any reclaim is scheduled). The
    case that reproduced F5 is a quick Escape, Escape on a one-level state:
    open `/map`, press `?` for the help, then Escape twice within about 0.2 s:
    the pane closes and does not come back half a second later. `tests/e2e/tui.sh`
    does the same in tmux (not run on Windows).

## 5. Running everything on Windows

**From a Claude Code session** (Git Bash, a new shell per command; set a
variable and use it in the same line, forward slashes). This finds the newest
Desktop Claude Code on either app, sorted by its version folder:

```bash
P=$(for f in "$(cygpath "$LOCALAPPDATA")"/Claude-Data/*/claude-code/*/*/claude.exe "$(cygpath "$APPDATA")"/Claude/claude-code/*/*/claude.exe; do [ -f "$f" ] && v=${f%/*/claude.exe} && echo "${v##*/} $f"; done | sort -V | tail -1 | cut -d' ' -f2-); "$P" --version && "$P" plugin validate --strict . && "$P" plugin test . && CLAUDE_BIN="$(cygpath -w "$P")" node tests/e2e/desktop.mjs
```

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tests/e2e/installers.ps1
```

```bash
bash tests/e2e/installers.sh
```

**In a PowerShell window** (the owner):

```powershell
$env:CLAUDE_BIN = (@(Get-Item "$env:LOCALAPPDATA\Claude-Data\*\claude-code\*\*\claude.exe", "$env:APPDATA\Claude\claude-code\*\*\claude.exe" -ErrorAction SilentlyContinue) |
  Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1).FullName
& $env:CLAUDE_BIN plugin validate --strict .
& $env:CLAUDE_BIN plugin test .
1..4 | ForEach-Object { node tests\e2e\desktop.mjs | Select-Object -Last 1; "exit $LASTEXITCODE" }
```

- Scenarios alone: `E2E_ONLY=1,5` (an unknown number exits 2, none run exits
  1). Also `CLAUDE_BIN`, `E2E_INSTALL`, `E2E_SHOTS=<dir>`, `E2E_DEBUG`,
  `E2E_KEEP` (keeps and prints the temp folders).
- If the unit suite shows failures that each took about 5 s, the machine was
  loaded (timeouts): run it again before believing them.
- **tsc** needs the engine's types: `.claude-plugin/types/claude-code/index.d.ts`
  (gitignored). If missing, copy
  `$(cygpath "$TEMP")/claude/bundled-skills/<version>/*/plugin-authoring/types/claude-code.d.ts`
  there (the `plugin-authoring` skill writes it), then
  `npx -y -p typescript@5.9.3 tsc -p .` (`npx.cmd` in PowerShell, whose
  default policy refuses `npx.ps1`).
- **`installers.sh` in Git Bash**: Git for Windows ships `dash`, so all three
  shells run (A4-9 corrected the old note); `.gitattributes` keeps `*.sh` LF.
- **README pictures, Desktop**: `tests/e2e/shots.mjs` (Playwright:
  `npm i -g playwright`, `npx playwright install chromium`, `NODE_PATH` set to
  `npm root -g` in the same command). `tests/e2e/shots-chooser.mjs` draws the
  cell surfaces (tsc plus headless Edge) for the design-before/after pictures.
- **`tui.sh`, `shots-terminal.mjs`**: tmux, python3 (ffmpeg for the clip),
  a Linux `claude` signed in: WSL with a distro only.

## 6. Open items, most important first

Queue items (in `analysis-4c378de\QUEUE.md`) still open when this was written:

| Item | Lane | What |
| --- | --- | --- |
| R27 | C | A narrow chain's step label never splits a word ("Idempote" / "ncy key…" in desktop-narrow.png); then redraw the Desktop pictures once |
| L6 | B | README (Live/Clicks, `pictureMode`, running look, the new chooser, Known limits, A3-6's `*`, "in a crowded chain", O-1), PLAN.md's Windows record and Environment facts, CLAUDE.md's 35 % hand-over rule |
| L7 | A | This file (R27's row in section 9 fills in once R27 is ticked) |
| L8 | A | Merge the lanes a last time; every gate, desktop.mjs four times, both installer suites |
| L9 | A | Fast-forward `main`, `plugin update`, OWNER-CHECK.md (section 4), the monitor's check |
| L10 | A | Fix what the check finds, push `main`, BUILD-DONE.md, disable the tasks |

To verify elsewhere (fixed from the code with a test; nobody here can see it):

| What | Where | How |
| --- | --- | --- |
| R11, A4-10: install.sh finds the Desktop's Claude Code in a macOS `.app` bundle | a Mac with the Desktop | `ls -R ~/Library/Application\ Support/Claude/claude-code`, then the one-line installer with no or an old `claude` on PATH |
| The Linux Desktop store `~/.config/Claude/claude-code/<ver>/<build>/claude` | a Linux Desktop | `ls -R` of it |
| R16: the idle fade in the Desktop's scrubbed frame | the Desktop | section 4 item 2 |
| R1: a right or middle press posts no pick; whether the Desktop sends `button` at all is unmeasured (an absent button counts as left) | the Desktop, Clicks mode | right-click a topic: nothing happens; left-click focuses it |
| The terminal's pictures and `tui.sh` (67 checks at 4363174) | WSL with a distro | section 5 |

Then the release checklist (PLAN.md, last section): install from the
marketplace on a clean machine, watch the first real folder, tag v0.1.0.

## 7. Facts to code against (measured or read; details in PLAN.md)

- **The interactive frame** (`SvgProps.isInteractive`): hover, CSS `:hover`
  and `:has()`, SMIL and `<title>` work; no script, no event attributes; the
  source at most 131072 characters (the big folders shed tooltips first, then
  satellites one at a time). No pointer position reaches the mod. A `<` inside
  a `<style>` (such as `@property`'s `syntax:'<number>'`) cuts the sheet in
  Chromium and breaks the SVG as XML (R16).
- **Desktop Client sizing**: width from its box, height from what it draws.
- **Desktop cell**: 7.7 × 19.8 px at 100 % scaling; the picture is
  `columns × 7.7` px wide; a narrow pane's slot is about `columns × 7.7 - 40`.
- **Desktop pointer**: whole cells only (no `fine`); `enter`, `move`,
  `leave`, `down`, `up` reach the frame; a cell goes by its centre, and a dot or
  minor topic that loses its own cell takes the nearest free cell within 3
  (R8). A Client's events never reach the engine; only its posts do.
- **Terminal mouse**: only under the fullscreen renderer; conhost passes
  clicks but no motion; the Desktop's terminal panel passes none. Windows
  console fonts carry only WGL4 (the Client, toasts, status, `/map help` and
  `/topic` are scanned for it).
- **Transcripts** (2.1.308, all 535 here): a row's `sessionId` always equals
  its file's name; two files with one id come only from a copy (R24).
  Desktop pastes arrive as `<pasted_content id=…>`; scheduled runs start with a
  `<scheduled-task …>` row.
- **Topic names**: unique by `nameKey` (word sets); a rename to a taken name
  is refused, `/topic <taken name in other words>` joins its holder, an old
  session resumed keeps the name (words ranked by session start).
- **Engine**: 2.1.308 validates only the Svg's props and length; the scrub
  and the frame live in the Desktop's web renderer, loaded from claude.ai, so
  they cannot be read on disk.
- Another plugin can keep `classic.SessionStart` from this one (the owner's
  org plugin `cc-plugin-sec-default` on the Windows 10 machine, by earlier
  notes); Constellation also restarts on `session.end` and checks the session
  id on every command, press, turn and every three seconds.
- PLAN.md's "Environment facts" describe this Windows 11 machine only in part;
  L6 corrects them. Until then, section 2 here holds.

## 8. Code map

| File | What it holds |
| --- | --- |
| `hooks/scan.ts` | Reads `~/.claude/projects/<slug>/*.jsonl` (large ones in slices); `promptOf` (pastes, scheduled runs); `distinctSessions` (one summary per id) |
| `hooks/cluster.ts` | Topics: signals, clustering, links, `uniqueNames`, `nameKey`, `statusOf` (running = active in the last 5 minutes), `agoOf` |
| `hooks/layout.ts` | Field geometry: `fieldWidthFor`, placement, satellites, `chainPositions` (bands), `labelSide`, `crowdedLabels`, anchor slots, `DESKTOP_CELL` |
| `hooks/draw.tsx` | The Svg (`svgOf`: live groups, the per-topic hover sheet, motion, the idle cycle, the running look, the shed ladder), `fieldOf` (the layer's props, from what `svgOf` kept), `clipName`, the pane, band, chips, cards, List, settings, toasts, empty states; `marks`, `pointerHint` |
| `hooks/actions.ts` | Every press and post; `viewOf`, `placementOf`, `renameTopic`, `createTopic`, the reclaim (`scheduleReclaim` with its run counter), `closePane` |
| `hooks/register.tsx` | Events, commands, renders; `isLive`, `layerAspect`; the `ui.close` hook calls `closePane` |
| `hooks/state.ts`, `types/index.d.ts`, `.claude-plugin/plugin.json` | 16 settings and the state atoms (incl. `pictureMode`, `pictureClicks`, `layerHeight`) |
| `client/map.js` | The terminal's text map and the Desktop's click layer (`layerFor`, `nodeAtPoint`, `pickAtCell`) |
| `install.sh`, `install.ps1` | One-line installers with the Desktop fallback (incl. the macOS bundle) |
| `tests/*.test.ts(x)` | Unit tests; `live.test.tsx` (the live picture), `surfaces.test.tsx` (the restyled surfaces), `helpers.tsx` the engine stub |
| `tests/e2e/desktop.mjs` | The Desktop's wire against the real engine; parity, narrow panes, live scenario |
| `tests/e2e/tui.sh`, `lib.sh`, `cells.py` | The real TUI in tmux (WSL) |
| `tests/e2e/installers.sh`, `installers.ps1` | The installers against stand-in `claude` commands |
| `tests/e2e/shots.mjs`, `shots-chooser.mjs`, `shots-terminal.mjs` | Pictures: the README's, the surfaces', the terminal's |
| `design/` | The approved prototype, the screens and the reference |

## 9. Review results

Five reviewers (one area each) wrote `review-A1.md` … `review-A5.md` (43
findings) on `git diff 8a99ba1..4c378de`; a second reader per area tried to
refute each in `refute-A1.md` … `refute-A5.md` (all in `analysis-4c378de\`).
Item R0 turned every upheld finding into work. Ordered by what a person meets
first. **Fixed** = fixed with a test that failed first; **Not a defect** =
refuted; **To verify** = fixed from the code, needs a machine we lack.

| Finding | What a person saw | Verdict | Status |
| --- | --- | --- | --- |
| A2-4 | The word that tells two topics apart cut off on the map and in chips | holds | Fixed: `clipName` keeps the last word (R14 3cf6ebf, R17 bbb8e07) |
| A2-1 | A crowded chain printed labels over each other | holds | Fixed: ranked collision picker (R12 52b7e4d) |
| A2-5 | "now · y…" under a step | holds | Fixed: falls back to "you" (R12) |
| A2-7 | Step circles met from 23 steps at 520 | holds | Fixed: long chains wrap into bands, gap ≥ 34 (R13 9604570); the band link clears labels (R20 e11cad3, found on the way) |
| A1-1 | Large folders: the picture shed satellites, the layer kept them | holds | Fixed: the layer takes what the picture kept (R2 a3058a7); 40 topics keep 6 satellites live (R15 88e79d5) |
| A2-2 | A rename to a taken name made two topics with one name | holds | Fixed: refused with a toast (R10 1390728); `/topic` with it joins the holder (R23 092a336) |
| A2-3 | Resuming an old session renamed its topic | holds | Fixed: words ranked by session start (R10) |
| A2-8 | `uniqueNames` could end with a clash after three rounds | holds | Fixed: a last pass numbers it (R10) |
| A2-6 | Every non-Latin name had the key "" and clashed | holds | Fixed (62312f3) |
| A1-2 | Narrow panes: a dot's own cell picked its pill or a neighbour | holds | Fixed: the in-cell dot wins (R1 3e735d8) |
| A5-2, A5-4 | Narrow panes and fractional cells were never clicked by whole cell | holds | Fixed: six widths and a 300-350 px sweep; unreachable dots take the nearest free cell (R8 8104ba1) |
| A5-3 | A right or middle click focused a topic | partly | Fixed: left only, an absent button counts as left (R1); `enter` traces as a `move` does, in a unit test and the harness (R25 cde1c9a); the dead `drag` branch and `flush`: not a defect |
| A1-4 | The README's pill-edge rule was wrong | holds | Fixed (R18 8e5ff51) |
| A1-5 | The by-box path is one-sided, `reported` an echo | refuted | Not a defect: no host sizes the layer by its box; the one-sided check keeps the echo harmless |
| A3-2, A3-5 | A reclaim already asking could reopen a closed pane, or undo a move to the prompt | holds / holds in logic | Fixed: a run counter stops a stale ask; the 360 ms ask skips after a focused drawing (R4 424fc3b) |
| A3-1 | The Escape path and F5 had no runnable test | partly | Fixed: `closePane` with injected io, 5 tests; Esc, Esc in tui.sh (R5 9023847) |
| A3-3 | The WGL4 test never read what the Client draws | holds | Fixed (R5 e4ca0d9) |
| A3-4 | The fullscreen hint's plumbing was unpinned | holds | Fixed (R5 66ac1ec) |
| A3-6 | The README says the terminal map marks pinned sessions with `*` (only the List does) | holds | L6 (queued) |
| A3-7 | (a) the close mark and ctrl+x x act as Escape, undocumented; (b) the hint's wording | (a) holds, (b) refuted | (a) Fixed (R18); (b) not a defect |
| A4-1 | A `claude` PowerShell could not start was reported as success | holds | Fixed (b02e1c0) |
| A4-2 | Installer output as mojibake on Windows PowerShell | holds | Fixed (b02e1c0) |
| A4-6, A4-7, A4-8, A4-11 | Brackets in a profile path, no HOME, odd version lines, ASCII and temp folders | holds | Fixed (b02e1c0) |
| A4-3, A4-4, A4-5 | The installer suites' gaps (version order, flattened arguments, iex failure) | holds | Fixed (b02e1c0): installers.ps1 56, installers.sh 72, now 78 |
| A4-10 | The macOS Desktop keeps Claude Code in an `.app` bundle the fallback missed | holds | Fixed, to verify on macOS (R11 12af2d5) |
| A4-9 | This file said `installers.sh` cannot run in Git Bash | holds | Fixed here (section 5) |
| A5-1 | The harness never compared the layer with the picture | holds | Fixed: viewBox, transforms and every node checked (R7 0d0bdec, R22 db977d1) |
| A5-5, A5-6, A5-7, A5-10 | The harness could pass with nothing run, time out silently, accept a too-tall layer | holds | Fixed (R6 f1bd61e) |
| A5-8 | Coverage holes behind the labels (anchors, box hosts, Layer height -2) | holds | Fixed (R9 df99994) |
| A5-9 | The narrow pane's width disagreed across files | holds | Fixed (R9, R18); the narrow README picture redrawn at its slot (L5 6876673) |
| A1-3, A2-9 | Tests passed while hit boxes drifted; surviving mutants | holds | Fixed: parity over 7 widths and K1 (R3 b8f2d17), K2b/K2c (R10), K4 (R5), the goal clip (R14); each mutant killed |
| A2-10 | Doc slips (comments, specs pointing at 860) | holds | Fixed (R13, R18); README:193-195 in L6 |

Found on the way and fixed: ages that read "now ago" (R19 bb99852), a test
that timed out under load (R21 4dcd1ce), two transcript files with one id drawn
several times (R24 2eb38f4), the soft fade's `@property` breaking the sheet
(R16 67038ee), the legend's amber "active" mark unlike the map's running
satellite (R26 8c9f146: now filled with a light core, in the idle ring's grey).
Found by L5's pictures and still open: a narrow chain's step label split
mid-word (R27, lane C).

## 10. Prompt to continue

Paste this into a new Claude Code session opened in the worktree (or, after
L9, the main checkout) on the Windows 11 machine.

```text
You are continuing the Constellation mod (github.com/nrzz/constellation) on my
Windows 11 machine with Claude Desktop (installer app). The work is on branch
fix/windows-retest in D:\Projects\constellation-fixes; the plugin is installed
at user scope from D:\Projects\constellation (main), which the engine copies to
~/.claude/plugins/cache/constellation/constellation/0.1.0.

1. Read .claude/CLAUDE.md, then docs/HANDOVER.md in full. PLAN.md holds the
   spec and every pass's record: read only what the handover points to.
2. Check D:\Projects\constellation\analysis-4c378de\QUEUE.md: if the build
   tasks (constellation-build, -b, -c) are still working it, do not touch the
   worktrees or their locks; tell me where the queue stands instead.
3. Otherwise find the Desktop's newest claude.exe (handover section 5, the
   Git Bash one-liner) and run every gate: validate --strict, plugin test,
   tsc, tests/e2e/desktop.mjs four times (exit 0 each), installers.ps1 and
   installers.sh.
4. Work the open items in handover section 6, most important first. Every fix
   gets a test that fails without it; conventional commits ending with the
   attribution lines Claude Code gives, no model named elsewhere.
5. Push main only when every gate passes and the Desktop check (section 4) is
   clean. When the stretch ends, rewrite docs/HANDOVER.md and this prompt.
   Past 35 % context: finish the step, write the handover, continue fresh.

Short progress reports; decide by evidence; never skip a check.
```
