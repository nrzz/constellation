#!/usr/bin/env node
// The README's Desktop pictures, drawn by the real engine: the folder of about 140 sessions that
// tests/e2e/desktop.mjs generates, asked for over the Desktop's wire, its Svg rendered in Chromium.
//
//   node tests/e2e/shots.mjs [outDir]     # default docs/images; needs `claude` and Playwright's Chromium
//
// Writes desktop-map.png (the whole folder), desktop-trace.png (a topic traced under the pointer) and
// desktop-focus.png (that topic focused: its sessions as a numbered chain).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Desktop, Engine, bigFolder, clientOf, pointOn, seed, sleep, svgOfTree, temps } from './desktop.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'docs/images'))
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1100)
const BACKGROUND = '#0F131A' // the Desktop's dark pane

let chromium
try {
  // Through require, so a global install on NODE_PATH counts as well as a local one.
  ;({ chromium } = createRequire(import.meta.url)('playwright'))
} catch {
  console.error('Playwright is needed to render the pictures: npm i -g playwright (its Chromium too).')
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })
const pre = seed([], 'storefront')
const { sessions, themeOf } = bigFolder(pre.cwd, Date.now())
const dir = path.join(pre.cfg, 'projects', pre.cwd.replace(/[^a-zA-Z0-9]/g, '-'))
for (const s of sessions) {
  const file = path.join(dir, `${s.id}.jsonl`)
  fs.writeFileSync(file, s.text)
  fs.utimesSync(file, new Date(s.mtime), new Date(s.mtime))
}

const engine = new Engine(pre)
const desk = new Desktop(engine)
const shots = {}
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
  shots['desktop-map'] = svgOfTree(r.tree).props.source

  // The busiest checkout topic: traced under the pointer, then focused.
  await desk.loadModule()
  desk.mountLikeDesktop(140)
  const nodes = desk.props().nodes
  const share = topicId => nodes.filter(n => n.kind === 'session' && n.topicId === topicId && themeOf[n.id] === 'checkout').length
  const topic = nodes.filter(n => n.kind === 'topic' && n.id !== 'unsorted').sort((a, b) => share(b.id) - share(a.id))[0]
  const at = desk.cellOf(pointOn(topic).x, pointOn(topic).y)
  desk.pointer({ type: 'move', ...at })
  await desk.flush()
  shots['desktop-trace'] = svgOfTree(desk.tree).props.source
  desk.pointer({ type: 'down', ...at, button: 'left' })
  desk.pointer({ type: 'up', ...at, button: 'left' })
  await desk.flush()
  if (clientOf(desk.tree)?.props.props.mode !== 'focus') throw new Error('the click did not focus the topic')
  shots['desktop-focus'] = svgOfTree(desk.tree).props.source
} finally {
  await engine.close()
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: WIDTH + 56, height: 800 }, deviceScaleFactor: 2, colorScheme: 'dark' })
for (const [name, svg] of Object.entries(shots)) {
  const sized = svg.replace(/<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/, `<svg $1width="${WIDTH}"`)
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${BACKGROUND}"><div id="shot" style="padding:28px;display:inline-block">${sized}</div></body></html>`)
  await page.locator('#shot').screenshot({ path: path.join(OUT, `${name}.png`) })
  squeezePng(path.join(OUT, `${name}.png`))
  console.log(`wrote ${path.relative(REPO, path.join(OUT, `${name}.png`))}`)
}
await browser.close()
for (const t of temps) fs.rmSync(t, { recursive: true, force: true })

/** Pictures for a README stay light: a 256-colour palette where Pillow is there (sharp on these flat dark pictures), else as rendered. */
function squeezePng(file) {
  spawnSync('python3', ['-c', "import sys\ntry:\n from PIL import Image\nexcept Exception:\n sys.exit(0)\nim = Image.open(sys.argv[1]).convert('RGB')\nim.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(sys.argv[1], optimize=True)", file])
}
