#!/usr/bin/env node
// The README's terminal pictures, from the real engine in tmux: the band, a step's card in the docked pane, and a
// short clip of the clicks that lead there (the map, a topic traced and focused, a step opened, Escape, back).
//
//   node tests/e2e/shots-terminal.mjs [outDir]   # default docs/images; needs tmux, python3, `claude`, Playwright
//                                                 # and ffmpeg (for the clip)
//
// The folder is a slice of the one tests/e2e/desktop.mjs generates. Each frame is `tmux capture-pane -e` (the
// terminal's own cells and colours) turned into HTML and rendered in Chromium, cropped to the pane or the band so
// no path, model name or account notice is in the picture. A small pointer marks where the mouse event went.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { bigFolder, seed, sleep, temps } from './desktop.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'docs/images'))
const S = 'shots'
const COLS = 200
const ROWS = 56
const BG = '#0F131A'
const FG = '#D5DAE1'

let chromium
try {
  ;({ chromium } = createRequire(import.meta.url)('playwright'))
} catch {
  console.error('Playwright is needed to render the pictures: npm i -g playwright (its Chromium too).')
  process.exit(1)
}

// ------------------------------------------------------------- the folder and the engine

const THEMES = new Set(['checkout', 'auth', 'orders', 'ci', 'docs'])
const pre = seed([], 'storefront')
const { sessions, themeOf } = bigFolder(pre.cwd, Date.now())
const dir = path.join(pre.cfg, 'projects', pre.cwd.replace(/[^a-zA-Z0-9]/g, '-'))
let kept = 0
let oneOffs = 0
for (const s of sessions) {
  const theme = themeOf[s.id]
  if (!THEMES.has(theme) && !(theme.startsWith('one-off') && oneOffs++ < 3)) continue
  const file = path.join(dir, `${s.id}.jsonl`)
  fs.writeFileSync(file, s.text)
  fs.utimesSync(file, new Date(s.mtime), new Date(s.mtime))
  kept++
}
fs.writeFileSync(path.join(pre.cfg, 'settings.json'), JSON.stringify({ tui: 'fullscreen' }))
const home = os.homedir()
if (fs.existsSync(path.join(home, '.claude/.credentials.json'))) fs.copyFileSync(path.join(home, '.claude/.credentials.json'), path.join(pre.cfg, '.credentials.json'))
console.log(`${kept} sessions in ${pre.cwd}`)

const tmux = (...args) => execFileSync('tmux', args, { encoding: 'utf8' })
const send = text => tmux('send-keys', '-t', S, '-l', text)
const key = name => tmux('send-keys', '-t', S, name)
const screen = () => tmux('capture-pane', '-t', S, '-p')
const screenAnsi = () => tmux('capture-pane', '-t', S, '-p', '-e')
const cells = (...args) => spawnSync('python3', ['-X', 'utf8', path.join(REPO, 'tests/e2e/cells.py'), ...args], { input: screen(), encoding: 'utf8' }).stdout.trim()
const locate = (text, lo = 1, hi = ROWS) => {
  const out = cells('locate', text, String(lo), String(hi))
  if (!out) throw new Error(`not on the screen: ${text}`)
  const [row, col] = out.split(' ').map(Number)
  return { row, col }
}
/** The first match of a regex (its first group, if any) at or right of a column. */
const find = (regex, fromCol, lo = 1, hi = ROWS) => {
  const out = cells('find', regex, String(lo), String(hi), String(fromCol))
  if (!out) throw new Error(`not on the screen: /${regex}/`)
  const [row, col] = out.split(' ').map(Number)
  return { row, col }
}
const mouse = (code, col, row, end) => send(`\x1b[<${code};${col};${row}${end}`)
async function click(col, row) {
  mouse(0, col, row, 'M')
  await sleep(150)
  mouse(0, col, row, 'm')
  await sleep(2500)
}
async function hover(col, row) {
  mouse(35, col, row, 'M')
  await sleep(1500)
}
async function typeLine(text, wait = 5000) {
  send(text)
  await sleep(1200)
  key('Enter')
  await sleep(wait)
}
async function settle() {
  for (let i = 0; i < 45; i++) {
    const s = screen()
    if (/Choose the text style|Press Enter to continue/.test(s)) key('Enter')
    else if (/trust this folder/.test(s)) {
      key('Down')
      await sleep(500)
      key('Enter')
    } else if (/Can Anthropic look at your session/.test(s)) key('d')
    else if (/Continue a topic/.test(s)) return
    await sleep(2000)
  }
  throw new Error('the band never came up')
}

// ------------------------------------------------------------- ANSI cells to HTML

const BASE16 = ['#1C2128', '#E5534B', '#57AB5A', '#C69026', '#539BF5', '#B083F0', '#39C5CF', '#C5CDD6', '#636E7B', '#FF938A', '#6BC46D', '#DAAA3F', '#6CB6FF', '#DCBDFB', '#56D4DD', '#F0F3F6']
function color256(n) {
  if (n < 16) return BASE16[n]
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const i = n - 16
  const c = v => (v === 0 ? 0 : 55 + v * 40)
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`
}
const isWide = ch => {
  const c = ch.codePointAt(0)
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0x1f300 && c <= 0x1faff)
}
/** One captured line as cells: each a character with its style; a wide character's second cell is empty. */
function lineCells(line) {
  const out = []
  let st = { fg: null, bg: null, bold: false, dim: false, italic: false, under: false, inverse: false }
  const re = /\x1b\[([0-9;:]*)m|([^\x1b])/gu
  for (const m of line.matchAll(re)) {
    if (m[2] !== undefined) {
      out.push({ ch: m[2], st })
      if (isWide(m[2])) out.push({ ch: '', st })
      continue
    }
    const p = (m[1] || '0').split(/[;:]/).map(Number)
    st = { ...st }
    for (let i = 0; i < p.length; i++) {
      const v = p[i]
      if (v === 0) st = { fg: null, bg: null, bold: false, dim: false, italic: false, under: false, inverse: false }
      else if (v === 1) st.bold = true
      else if (v === 2) st.dim = true
      else if (v === 3) st.italic = true
      else if (v === 4) st.under = true
      else if (v === 7) st.inverse = true
      else if (v === 22) st.bold = st.dim = false
      else if (v === 23) st.italic = false
      else if (v === 24) st.under = false
      else if (v === 27) st.inverse = false
      else if (v >= 30 && v <= 37) st.fg = BASE16[v - 30]
      else if (v >= 90 && v <= 97) st.fg = BASE16[v - 90 + 8]
      else if (v === 39) st.fg = null
      else if (v >= 40 && v <= 47) st.bg = BASE16[v - 40]
      else if (v >= 100 && v <= 107) st.bg = BASE16[v - 100 + 8]
      else if (v === 49) st.bg = null
      else if ((v === 38 || v === 48) && p[i + 1] === 5) {
        st[v === 38 ? 'fg' : 'bg'] = color256(p[i + 2])
        i += 2
      } else if ((v === 38 || v === 48) && p[i + 1] === 2) {
        st[v === 38 ? 'fg' : 'bg'] = `rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`
        i += 4
      }
    }
  }
  return out
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** A crop of the screen (1-based, inclusive rows and columns) as HTML, with a pointer drawn at a cell if asked. */
function cropHtml(ansi, { top, bottom, left, right }, pointer) {
  const lines = ansi.split('\n').slice(top - 1, bottom)
  // tmux leaves out a line's trailing blank cells, colour and all: the crop is painted with the region's own background.
  const counts = new Map()
  for (const l of lines) for (const { st } of lineCells(l).slice(left - 1, right)) if (st.bg) counts.set(st.bg, (counts.get(st.bg) ?? 0) + 1)
  const ground = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? BG
  const rows = lines.map(l => {
    const c = lineCells(l).slice(left - 1, right)
    while (c.length < right - left + 1) c.push({ ch: ' ', st: {} })
    let html = ''
    for (const { ch, st } of c) {
      if (ch === '') continue
      let fg = st.fg ?? FG
      let bg = st.bg && st.bg !== ground ? st.bg : null
      if (st.inverse) [fg, bg] = [bg ?? ground, fg]
      const css = [`color:${fg}`, bg ? `background:${bg}` : '', st.bold ? 'font-weight:700' : '', st.dim ? 'opacity:.62' : '', st.italic ? 'font-style:italic' : '', st.under ? 'text-decoration:underline' : ''].filter(Boolean).join(';')
      html += `<span style="${css}">${esc(ch)}</span>`
    }
    return `<div class="r">${html}</div>`
  })
  const mark = pointer
    ? `<svg class="ptr" style="left:calc(${pointer.col - left}ch + 0.35ch);top:calc(${pointer.row - top} * var(--lh) + 0.55em)" width="18" height="24" viewBox="0 0 18 24"><path d="M2 2 L2 19 L6.5 14.8 L9.6 21.6 L12.6 20.3 L9.6 13.6 L15.6 13.4 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--lh:1.32em}
body{margin:0;background:transparent}
#shot{display:inline-block;padding:18px 22px;background:${ground};position:relative;border-radius:10px}
pre{margin:0;font:15px/var(--lh) 'JetBrains Mono','DejaVu Sans Mono',monospace;color:${FG};position:relative}
.r{white-space:pre;height:var(--lh)}
.ptr{position:absolute;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
</style></head><body><div id="shot"><pre>${rows.join('')}${mark}</pre></div></body></html>`
}

/** The docked pane's left border: the column where the most rows hold a vertical rule, in the right half. */
function paneLeft(text) {
  const counts = new Map()
  for (const line of text.split('\n')) {
    const chars = [...line]
    for (let c = Math.floor(COLS / 3); c < chars.length; c++) if (chars[c] === '│') counts.set(c + 1, (counts.get(c + 1) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? Math.floor(COLS / 2)
}
/** The last row of the pane's body worth showing: the bottom of its last box, or of its text. */
function paneBottom(text, left) {
  const lines = text.split('\n')
  let last = 1
  lines.forEach((l, i) => {
    const part = [...l].slice(left).join('').replace(/[│\s]+$/u, '').trim()
    if (part && !/^[─╭╮╰╯]+$/.test(part.replace(/\s/g, ''))) last = i + 1
    else if (/╰/.test(part)) last = i + 1
  })
  return Math.min(lines.length, last + 1)
}

// ------------------------------------------------------------- the run

fs.mkdirSync(OUT, { recursive: true })
const frames = []
const shots = {}
let framesLeft = 0
try {
  spawnSync('tmux', ['kill-session', '-t', S])
  tmux('new-session', '-d', '-s', S, '-x', String(COLS), '-y', String(ROWS), '-c', pre.cwd, `CLAUDE_CONFIG_DIR=${pre.cfg} claude --plugin-dir ${REPO}`)
  await settle()
  await sleep(1500)
  // The band: the chooser above the prompt.
  {
    const text = screen()
    const lines = text.split('\n')
    const top = lines.findIndex(l => /Continue a topic/.test(l)) // the band's first text row
    let start = top
    while (start > 0 && !/╭/.test(lines[start - 1] ?? '')) start--
    let end = top
    while (end < lines.length - 1 && !/╰/.test(lines[end] ?? '')) end++
    const row = lines[start - 1] ?? ''
    const left = [...row].indexOf('╭') + 1
    const right = [...row].lastIndexOf('╮') + 1
    shots.band = cropHtml(screenAnsi(), { top: start, bottom: end + 1, left, right: Math.max(right, left + 40) })
  }
  await typeLine('/map', 6000)
  const left = paneLeft(screen())
  framesLeft = left
  const frame = async (name, pointer, hold) => {
    const text = screen()
    frames.push({ name, ansi: screenAnsi(), bottom: paneBottom(text, left), pointer, hold })
  }
  await frame(null, null, 2.2)
  // A topic: hovered (its trace), clicked (its chain), a step clicked (its card), Escape, the back pill.
  // The busiest major topic on the map: a filled dot, its name, its count.
  const hint = locate('Click or Tab to a topic', 1, ROWS)
  const topic = find('● ([A-Z][A-Za-z0-9 ]+?) 1?[0-9]\\b', left + 1, hint.row + 1, ROWS)
  await hover(topic.col + 3, topic.row)
  await frame(null, { col: topic.col + 3, row: topic.row }, 1.6)
  await click(topic.col + 3, topic.row)
  await frame(null, { col: topic.col + 3, row: topic.row }, 2.0)
  // Step 3 of its chain: the number, then its title.
  const step = find('(?:^|[│ ])(3 [A-Z])', left + 1, 6, ROWS)
  await click(step.col + 3, step.row)
  await frame('terminal-card', { col: step.col + 3, row: step.row }, 2.6)
  key('Escape')
  await sleep(1500)
  await frame(null, null, 1.2)
  const back = locate('‹ All topics', 1, ROWS)
  await click(back.col + 3, back.row)
  await frame(null, { col: back.col + 3, row: back.row }, 1.6)
} finally {
  spawnSync('tmux', ['kill-session', '-t', S])
}

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } })
const render = async (html, file) => {
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('#shot').screenshot({ path: file })
  if (file.startsWith(OUT)) squeezePng(file)
}
const left = frames[0] ? framesLeft : 0
for (const [name, html] of Object.entries(shots)) {
  await render(html, path.join(OUT, `${name}.png`))
  console.log(`wrote ${path.relative(REPO, path.join(OUT, `${name}.png`))}`)
}
// The stills, each cropped to its own pane; the clip's frames all to the tallest, so they share one size.
const tallest = Math.max(...frames.map(f => f.bottom))
for (const f of frames) {
  if (!f.name) continue
  await render(cropHtml(f.ansi, { top: 1, bottom: f.bottom, left, right: COLS }, f.pointer), path.join(OUT, `${f.name}.png`))
  console.log(`wrote ${path.relative(REPO, path.join(OUT, `${f.name}.png`))}`)
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cst-frames-'))
temps.push(tmp)
const list = []
for (let i = 0; i < frames.length; i++) {
  const file = path.join(tmp, `f${i}.png`)
  await render(cropHtml(frames[i].ansi, { top: 1, bottom: tallest, left, right: COLS }, frames[i].pointer), file)
  list.push(`file '${file}'`, `duration ${frames[i].hold}`)
}
list.push(`file '${path.join(tmp, `f${frames.length - 1}.png`)}'`)
await browser.close()
fs.writeFileSync(path.join(tmp, 'list.txt'), list.join('\n'))
const gif = path.join(OUT, 'terminal-clicks.gif')
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-vf', 'scale=900:-2:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', gif], { encoding: 'utf8' })
if (ff.status !== 0) console.error(`ffmpeg: ${ff.stderr}`)
else console.log(`wrote ${path.relative(REPO, gif)}`)
for (const t of temps) fs.rmSync(t, { recursive: true, force: true })

/** Pictures for a README stay light: a 256-colour palette where Pillow is there (sharp on these flat dark pictures), else as rendered. */
function squeezePng(file) {
  spawnSync('python3', ['-c', "import sys\ntry:\n from PIL import Image\nexcept Exception:\n sys.exit(0)\nim = Image.open(sys.argv[1]).convert('RGB')\nim.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(sys.argv[1], optimize=True)", file])
}
