#!/usr/bin/env node
// The README's Desktop pictures, drawn by the real engine: the folder of about 140 sessions that
// tests/e2e/desktop.mjs generates, one of them running, asked for over the Desktop's wire, its Svg rendered in
// Chromium as the Desktop shows the live picture (the default): an interactive frame, its CSS motion running.
//
//   node tests/e2e/shots.mjs [outDir]     # default docs/images; needs `claude` and Playwright (its Chromium, else Edge)
//
// Writes desktop-map.png (the whole folder, the running topic ringed), desktop-trace.png (the busiest idle topic
// traced under the pointer, the running topic still in view), desktop-focus.png (that topic focused from its
// button under the map: its sessions as a numbered chain) and desktop-narrow.png (the same chain in a pane 44
// cells wide, its picture about 300 px, where the field narrows to stay legible).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Desktop, Engine, bigFolder, findAll, seed, sleep, svgOfTree, temps } from './desktop.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'docs/images'))
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1100)
const BACKGROUND = '#0F131A' // the Desktop's dark pane

let chromium
try {
  // Through require, so a global install on NODE_PATH counts as well as a local one.
  ;({ chromium } = createRequire(import.meta.url)('playwright'))
} catch {
  console.error('Playwright is needed to render the pictures: npm i -g playwright (its Chromium, or Edge on Windows).')
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })
const pre = seed([], 'storefront')
const now = Date.now()
const { sessions } = bigFolder(pre.cwd, now)
// One session written half a minute ago: running, as statusOf calls a session written in the last five minutes.
sessions[0].mtime = now - 30_000
const dir = path.join(pre.cfg, 'projects', pre.cwd.replace(/[^a-zA-Z0-9]/g, '-'))
for (const s of sessions) {
  const file = path.join(dir, `${s.id}.jsonl`)
  fs.writeFileSync(file, s.text)
  fs.utimesSync(file, new Date(s.mtime), new Date(s.mtime))
}

const engine = new Engine(pre)
const desk = new Desktop(engine)
const shots = {}
let traced
try {
  await engine.request({ subtype: 'initialize' }, 90_000)
  await desk.attach()
  // Wait for the bounded scan to put every session on the map.
  const counted = tree => [...(svgOfTree(tree)?.props.alt ?? '').matchAll(/\((\d+)\)/g)].reduce((a, m) => a + Number(m[1]), 0)
  let r = await desk.pane()
  for (const t0 = Date.now(); counted(r.tree) < sessions.length && Date.now() - t0 < 60_000; ) {
    await sleep(250)
    r = await desk.pane()
  }
  const map = svgOfTree(r.tree)
  if (map?.props.isInteractive !== true) throw new Error('the map did not arrive as the live picture')
  const source = map.props.source
  shots['desktop-map'] = source

  // The busiest idle topic, by the count on its pill; its group is `t-<i>`, its button the i-th `t:` button below.
  const groups = [...source.matchAll(/<g class="t t-(\d+)( run)?[^"]*"[\s\S]*?class="nm"[^>]*>([^<]*)<\/text><text class="mono"[^>]*>(\d+)</g)]
  if (!groups.some(g => g[2])) throw new Error('no running topic on the map')
  const busiest = groups.filter(g => !g[2]).sort((a, b) => Number(b[4]) - Number(a[4]))[0]
  traced = Number(busiest[1])
  const button = findAll(r.tree, n => n.type === 'Button' && /^t:/.test(n.props?.key ?? ''))[traced]
  const stem = s => s.replace(/….*/, '').slice(0, 8)
  if (!button || stem(button.props.label) !== stem(busiest[3])) throw new Error(`topic ${traced} (${busiest[3]}) has no button of its own: ${button?.props.label}`)
  shots['desktop-trace'] = { svg: source, hover: `.t-${traced} .pill` }

  // Its button under the map focuses it: the live picture's own way to pick.
  await desk.pressAndDraw(button.props.key)
  const focus = svgOfTree(desk.tree)?.props.source ?? ''
  if (focus === source || !focus.includes(stem(busiest[3]))) throw new Error('the topic button did not focus the topic')
  shots['desktop-focus'] = focus

  // The same chain in a narrow pane, drawn at its real width.
  desk.bodyColumns = 44
  const narrow = svgOfTree((await desk.pane()).tree)?.props.source ?? ''
  if (!/viewBox="0 0 520 /.test(narrow)) throw new Error('the narrow pane did not narrow the field')
  // The picture's slot, not the pane: a body 44 cells wide leaves the picture `44 × 7.7 − 40` px (hooks/layout.ts).
  shots['desktop-narrow'] = { svg: narrow, width: Math.round(44 * 7.7 - 40) }
} finally {
  await engine.close()
}

let browser
try {
  browser = await chromium.launch()
} catch {
  // No Playwright Chromium downloaded: the Edge every Windows machine has.
  browser = await chromium.launch({ channel: 'msedge' })
}
const page = await browser.newPage({ viewport: { width: WIDTH + 56, height: 800 }, deviceScaleFactor: 2, colorScheme: 'dark' })
for (const [name, shot] of Object.entries(shots)) {
  const { svg, width = WIDTH, hover } = typeof shot === 'string' ? { svg: shot } : shot
  const sized = svg.replace(/<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/, `<svg $1width="${width}"`)
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${BACKGROUND}"><div id="shot" style="padding:28px;display:inline-block">${sized}</div></body></html>`)
  if (hover) {
    // The pointer rests on the pill while the trace's fade settles.
    await page.hover(`#shot ${hover}`, { force: true })
    await page.waitForTimeout(700)
  }
  await page.locator('#shot').screenshot({ path: path.join(OUT, `${name}.png`) })
  squeezePng(path.join(OUT, `${name}.png`))
  console.log(`wrote ${path.relative(REPO, path.join(OUT, `${name}.png`))}`)
}
await browser.close()
for (const t of temps) fs.rmSync(t, { recursive: true, force: true })

/**
 * Pictures for a README stay light where Pillow is there: a 256-colour palette when no pixel moves visibly (a
 * median cut can turn the small amber legend dot green, an octree bands the background glow), else the picture
 * recompressed without loss. Without Pillow, as rendered. Windows has `python`, not `python3`.
 */
function squeezePng(file) {
  const squeeze = "import sys\ntry:\n from PIL import Image, ImageChops\nexcept Exception:\n sys.exit(3)\nim = Image.open(sys.argv[1]).convert('RGB')\nq = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)\nworst = max(hi for lo, hi in ImageChops.difference(im, q.convert('RGB')).getextrema())\n(q if worst <= 24 else im).save(sys.argv[1], optimize=True)"
  for (const python of ['python3', 'python']) if (spawnSync(python, ['-c', squeeze, file]).status === 0) return
  console.log(`  (${path.basename(file)} left as rendered: no Python with Pillow)`)
}
