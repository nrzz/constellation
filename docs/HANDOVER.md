# Constellation: handover (2026-10-28, the live pane checked in the Desktop's own frame)

This file is the place to start: where things stand, the two machines, how to
run everything on Windows, what is left to check, and the review's findings
with what became of each. `.claude/CLAUDE.md` (loaded by every Claude Code
session in this folder; not at the root, where `plugin validate --strict`
refuses a CLAUDE.md) holds the working rules; `PLAN.md` holds the spec, the
API facts and every pass's record; `README.md` is what users read.

## 1. Start here

1. **Find the code.** Everything is on `main` in `D:\Projects\constellation`
   on the owner's Windows 11 machine (section 2), pushed; the working
   branches and their worktrees were merged and removed on 28 October. The 28 October session checked the live pane in the
   Desktop's own frame code (section 3), found the live picture drawn 150 px
   tall, fixed it (R28, 894c250) and pushed. The owner does not do hand
   checks: what no tool here can see is listed in section 4.

   ```bash
   git -C /d/Projects/constellation log --oneline -1
   git -C /d/Projects/constellation merge-base --is-ancestor 894c250 HEAD && echo ok
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
| Desktop | 3.6556.2 running, **installer app** (`%LOCALAPPDATA%\AnthropicClaude`); 4.29.0 staged by the updater on 28 Oct (runs after a restart; its renderer is on disk, `resources\ion-dist.asar`) | 3.6556, **Store app** |
| Desktop's Claude Code | `%APPDATA%\Claude\claude-code\2.1.308\c17a819afb40\claude.exe` (2.1.304 beside it) | `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\2.1.308\<build>\claude.exe` |
| `claude` on PATH | none | 2.1.283 (too old) |
| PowerShell | 5.1 only (no pwsh 7) | 5.1 |
| Shells for sessions | Git Bash (with `dash`), conhost, Windows Terminal | Git Bash, conhost |
| WSL | only `docker-desktop`, no Linux distro | not recorded |
| Repo | `D:\Projects\constellation` (`main`, the marketplace the plugin is installed from, user scope) | `C:\Users\Lenovo\.claude\local-plugins\constellation`; real folder `E:\GIT` (163 sessions) |
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

### The 28 October check in the Desktop's own frame (this session)

The owner asked for the section 4 check to be done remotely, not by hand.
Computer use still cannot (re-tested: the grant goes to the launcher stub and
Claude's window is masked from screenshots), and claude.ai in a browser draws
no mod surfaces (they go through the Desktop's bridge; the Remote Control log
shows no client ever polled). But the 4.29.0 Desktop the updater staged
carries its renderer on disk, so the Svg leaf was read (section 7) and
rebuilt around the real engine's pictures in Chromium:

- **R28, fixed (894c250):** the live frame was the pane's width by 150 px,
  the map shrunk inside it (157 px wide for 860×820). The live Svg now carries
  `width`/`height` (`frameSize`, hooks/layout.ts). Tests failed first.
- **Seen in that frame (`tests/e2e/frame.mjs`, 24 checks):** the scrub keeps
  every element (only the root's `role` goes); the frame is the picture's
  size in a 120-column and a 44-column pane; hover lights the pill and its
  satellites, swaps the caption ("Auth Cookie · 10 sessions · last 57m ago")
  and fades the rest; the trace follows the pointer; the idle cycle walks the
  topics and eases the rest 1 → 0.49 → 0.40 (R16's question closed); the
  running topic keeps its ring, its session's ripple animates.
- **The join card after the first message** (the owner's screenshot): not
  the mod's doing. The Desktop starts a session's Claude Code when the first
  message is sent (`LocalSessions.start … trigger=first_turn` in
  `%LOCALAPPDATA%\Claude\logs\main.log`), so no mod can draw before it. The
  README now says so and offers `/topic` as the first message to choose
  before asking anything. The harness never saw this: it attaches before any
  message.

Gates at ba8f5bd (Windows 11, Claude Code 2.1.308): validate --strict ok,
plugin test 260/260, tsc clean, desktop.mjs 267/267 exit 0 four times,
frame.mjs 24/24; installers.ps1 56/56 and installers.sh 78/78 at 2fd9c7d
(the installers did not change).

### Commits on `fix/windows-retest` since 4c378de (oldest first, by theme; merges left out)

| Theme | Commits |
| --- | --- |
| Re-test fixes (S-1, S-2, installers, non-Latin ids) | 9690493, 1f8bd3f, b02e1c0, 62312f3 |
| The live picture (L2, L3, L3a, L3b) and its harness (L4) | 528bbe1, 29a90d8, d1f80dd, 766a0aa, 079c7f7, 722442f, 9d1b5b0, 8e922cb |
| Every surface restyled (L4a, L4b) | f60772b, ba40e61, 4c679ff, 845306c, b321dcd, 927a592 |
| The review's fixes (R1-R27, section 9) | 3e735d8 … 2eb38f4, cde1c9a, 8c9f146, 9e4eb86 |
| README pictures (L5, redrawn for R26/R27), docs (L6) and this file (L7) | 6876673, 58f1703, 5fc1a61, 8f59569, 378f028 |
| The frame check: R28, frame.mjs, docs and this file | 894c250, 6ea1aa5, ba8f5bd, and the commit that rewrote this file |

### What the re-test (REPORT.md) found and what was done

| Item | Found | Done |
| --- | --- | --- |
| Gates at 4c378de | validate, 146 tests, tsc, desktop.mjs 105 × 4 (no EPERM: F8 and F9 hold on Windows), installers.ps1 33 | Verified on Windows 11 |
| S-1 | A Desktop paste (`<pasted_content …>`) was not a prompt: 81 of 476 transcripts; its tags leaked into join words | 9690493: tags stripped, the paste is a turn; scan cache `scan3:`, old keys cleared once |
| S-2 | A scheduled task's run showed "0 turns" (316 of 369 sessions in `D:\Sensus-Design`) | 1f8bd3f: the run's row is a turn, its boilerplate never a first prompt |
| F2 names | No two topics alike on the 369-session folder | Verified offline with the mod's own scan and clustering |
| Checklist 10, the one-line installer | Desktop fallback works with no PATH claude, with an old one, and refuses cleanly with neither | Verified (stand-in 2.1.283) |
| O-1 | After an install the engine prints "N userConfig options not yet set": every option has a default | The README says so (L6 5fc1a61) |
| Install | The engine copies the plugin to the cache; a user-scope install hot-loads into open Desktop sessions; auto notes (haiku) work on Windows | Recorded (section 1.3) |

### Gates at e8c3b3d, before the frame check (Windows 11, Claude Code 2.1.308, Git Bash)

- `plugin validate --strict .`: passes. `plugin test .`: **256 pass**, 0 fail.
- `tsc` (TypeScript 5.9.3): clean.
- `tests/e2e/desktop.mjs`: **265 passed**, 0 failed, exit 0, four runs in a row (the Desktop's
  wire against the real engine: a live scenario on a big folder with a running
  session, `enter` before the first move as the Desktop sends it, the click
  layer compared with the picture, narrow panes clicked by
  whole cells at six widths and a 300-350 px sweep).
- `tests/e2e/installers.ps1`: 56 (PowerShell 5.1 only; more with pwsh 7).
- `bash tests/e2e/installers.sh`: 78 (sh, dash and bash, in Git Bash).
- Not run here: `tests/e2e/tui.sh` and `shots-terminal.mjs` (need WSL with a
  Linux distro and tmux).

L8 (2026-10-28) ran every gate on the final branch with lanes B and C merged in:
all green, nothing to fix.

## 4. What no tool here can see (the owner does not do hand checks)

The 28 October session did L9's checks (`analysis-4c378de\OWNER-CHECK.md`)
remotely, as far as the tools reach. Done in the Desktop's own frame code
(`tests/e2e/frame.mjs`, section 3): 1 hover, 2 motion and the idle cycle,
3 the running topic, 5 tooltips (every `<title>` survives the scrub; the
native tooltip itself is not drawn headless), 6 a focused chain, 7 a narrow
pane. Still unseen, each with why:

1. **The pointer leaving the picture.** In headless Chromium a synthetic
   pointer that leaves the sandboxed frame leaves its `:hover` set (the trace
   stays lit, the idle cycle paused); an unsandboxed frame clears it. Whether
   the Desktop's real mouse clears it is unmeasured. If it does not, every
   interactive Svg has it (the platform's own example too), and the mod cannot
   see the pointer leave: it would be a platform report.
2. **Every surface (item 4)** against `design-after-*.png`: the cards, List,
   settings, band states and toasts are drawn by the Desktop's Box/Text/Button
   renderer (`gf` and its neighbours in the same 4.29.0 chunk as the Svg
   leaf); the harness checks their trees, nothing has drawn them through it.
3. **Picture: Clicks (item 8)**: the image and its layer; the harness checks
   parity, not the Desktop's drawing.
4. **The terminal (items 9, 10)**: conhost with the Desktop's claude.exe.
   Computer use may only click terminals, not type; tmux needs a WSL distro.
5. **4.29.0 itself**: the check read 4.29.0's renderer while 3.6556.2 runs.
   After the Desktop restarts into 4.29.0, `/map` in a new session should show
   the full-size picture (R28).

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
- **frame.mjs** (the live pictures in the Desktop's own frame, about 60 s):
  `npm i -g playwright dompurify@3.4.13` once, then, with `P` found as above,
  `NODE_PATH="$(npm root -g)" CLAUDE_BIN="$(cygpath -w "$P")" node tests/e2e/frame.mjs [shotsDir]`
  (Edge when Playwright's Chromium is not downloaded; the pictures land in
  `shotsDir`, else a temp folder it prints).
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

The build queue (`analysis-4c378de\QUEUE.md`) is finished and its three
scheduled tasks are disabled. On the owner's word after the push (28 Oct,
09:54 IST: "windows 10 enough"), Windows is the only platform to verify on:
the macOS bundle (R11, A4-10), the Linux Desktop store and the WSL terminal
pictures and `tui.sh` are dropped, not open.

1. **The pointer leaving the live picture** (section 4.1): the one behaviour
   that could look wrong to a person and that nothing here can measure. A way
   to measure it with a real mouse: a small Electron app (the Desktop's own
   Electron version) showing the frame, driven by computer use, which may
   control any app but Claude's window.
2. **The rest of section 4**, for whoever has a Desktop window in front of
   them; none blocks a release.
3. **The release checklist** (PLAN.md, last section; the owner's call):
   install from the marketplace on a clean machine, watch the first real
   folder, tag v0.1.0.
4. Optional cleanup (the owner's call): the three disabled scheduled tasks
   can be deleted. (The worktrees and the fix/* branches went on 28 October.)

## 7. Facts to code against (measured or read; details in PLAN.md)

- **The interactive frame** (`SvgProps.isInteractive`): hover, CSS `:hover`
  and `:has()`, SMIL and `<title>` work; no script, no event attributes; the
  source at most 131072 characters (the big folders shed tooltips first, then
  satellites one at a time). No pointer position reaches the mod. A `<` inside
  a `<style>` (such as `@property`'s `syntax:'<number>'`) cuts the sheet in
  Chromium and breaks the SVG as XML (R16).
- **The Desktop's Svg leaf** (read from 4.29.0's `resources\ion-dist.asar`,
  chunk with `case"Svg"`; PLAN.md "the Desktop's frame read and checked"):
  interactive, an `<iframe sandbox="">` whose srcdoc is a CSP, a sheet that
  stretches the svg over the frame, and the scrubbed source; sized by the
  Svg's `width`/`height` alone (unsized: the column's width × 150 px, hence
  R28); the scrub DOMPurify 3.4.13 (no `data-*`, `on*`, off-page hrefs,
  script/foreignObject/image/a/iframe; one svg root or the alt text alone).
  An image Svg is an `<img>` of a data URL, sized by the svg itself.
- **The Desktop starts a session's Claude Code on its first message**
  (`LocalSessions.start` with `trigger=first_turn` in
  `%LOCALAPPDATA%\Claude\logs\main.log`; before it only short "temporary
  query" engines and a folderless spare run). No mod draws before that message.
- **What can look at the Desktop from here**: not computer use (Claude's
  window is masked and never controllable; the grant goes to the launcher
  stub), not claude.ai in a browser (no mod surfaces without the Desktop's
  bridge; the built-in browser is not signed in there). The renderer on disk
  plus Chromium is the way (`tests/e2e/frame.mjs`).
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
- PLAN.md's "Environment facts" describe this Windows 11 machine (L6); the
  Windows 10 machine is in section 2 here and PLAN.md's Windows 10 sections.

## 8. Code map

| File | What it holds |
| --- | --- |
| `hooks/scan.ts` | Reads `~/.claude/projects/<slug>/*.jsonl` (large ones in slices); `promptOf` (pastes, scheduled runs); `distinctSessions` (one summary per id) |
| `hooks/cluster.ts` | Topics: signals, clustering, links, `uniqueNames`, `nameKey`, `statusOf` (running = active in the last 5 minutes), `agoOf` |
| `hooks/layout.ts` | Field geometry: `fieldWidthFor`, `slotWidthFor`, `frameSize` (the live frame's size), placement, satellites, `chainPositions` (bands), `labelSide`, `crowdedLabels`, anchor slots, `DESKTOP_CELL` |
| `hooks/draw.tsx` | The Svg (`svgOf`: live groups, the per-topic hover sheet, motion, the idle cycle, the running look, the shed ladder), `fieldOf` (the layer's props, from what `svgOf` kept), `clipName`, the pane, band, chips, cards, List, settings, toasts, empty states; `marks`, `pointerHint` |
| `hooks/actions.ts` | Every press and post; `viewOf`, `placementOf`, `renameTopic`, `createTopic`, the reclaim (`scheduleReclaim` with its run counter), `closePane` |
| `hooks/register.tsx` | Events, commands, renders; `isLive`, `layerAspect`; the `ui.close` hook calls `closePane` |
| `hooks/state.ts`, `types/index.d.ts`, `.claude-plugin/plugin.json` | 16 settings and the state atoms (incl. `pictureMode`, `pictureClicks`, `layerHeight`) |
| `client/map.js` | The terminal's text map and the Desktop's click layer (`layerFor`, `nodeAtPoint`, `pickAtCell`) |
| `install.sh`, `install.ps1` | One-line installers with the Desktop fallback (incl. the macOS bundle) |
| `tests/*.test.ts(x)` | Unit tests; `live.test.tsx` (the live picture), `surfaces.test.tsx` (the restyled surfaces), `helpers.tsx` the engine stub |
| `tests/e2e/desktop.mjs` | The Desktop's wire against the real engine; parity, narrow panes, live scenario (the frame's size, the scrub's rules) |
| `tests/e2e/frame.mjs` | The real engine's live pictures through the Desktop's own frame in Chromium: size, scrub, hover, idle cycle, running, focus, narrow |
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
| A3-6 | The README says the terminal map marks pinned sessions with `*` (only the List does) | holds | Fixed (L6 5fc1a61) |
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
| A2-10 | Doc slips (comments, specs pointing at 860) | holds | Fixed (R13, R18, L6 5fc1a61) |

Found on the way and fixed: ages that read "now ago" (R19 bb99852), a test
that timed out under load (R21 4dcd1ce), two transcript files with one id drawn
several times (R24 2eb38f4), the soft fade's `@property` breaking the sheet
(R16 67038ee), the legend's amber "active" mark unlike the map's running
satellite (R26 8c9f146: now filled with a light core, in the idle ring's grey),
a narrow chain's step label split mid-word, "Idempote" over "ncy key…" (R27
9e4eb86: a word too long for a line is clipped with "…", the next words take
the second line; the Desktop pictures redrawn once for R26 and R27, 58f1703). Found by the frame check of 28 October: the live picture drawn in a
frame 150 px tall, the map shrunk inside it (R28 894c250: the live Svg carries
the picture's width and height).

## 10. Prompt to continue

Paste this into a new Claude Code session on the Windows 11 machine, opened in
`D:\Projects` (where the context guard reads the folder's handover) or in
`D:\Projects\constellation`.

```text
You are continuing the Constellation mod (github.com/nrzz/constellation) on my
Windows 11 machine with Claude Desktop (installer app). The work is on main in
D:\Projects\constellation (pushed), which the plugin is installed from at
user scope; the engine copies it to
~/.claude/plugins/cache/constellation/constellation/0.1.0.

1. Read .claude/CLAUDE.md, then docs/HANDOVER.md in full. PLAN.md holds the
   spec and every pass's record: read only what the handover points to.
2. Find the Desktop's newest claude.exe (handover section 5, the Git Bash
   one-liner; after a Desktop restart a newer one may be there) and run every
   gate: validate --strict, plugin test, tsc, tests/e2e/desktop.mjs four
   times (exit 0 each), tests/e2e/frame.mjs, installers.ps1 and installers.sh.
3. I do not do hand checks. Work the open items in handover section 6, most
   important first, with the tools you have (computer use controls any app
   but Claude's own window); never claim a check you could not make.
4. Every fix gets a test that fails without it; conventional commits ending
   with the attribution lines Claude Code gives, no model named elsewhere.
   Push main when every gate passes. When the stretch ends, rewrite
   docs/HANDOVER.md and this prompt.
   Past 35 % context: finish the step, write the handover, continue fresh.

Short progress reports; decide by evidence; never skip a check.
```
