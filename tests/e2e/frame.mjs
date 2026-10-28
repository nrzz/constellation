#!/usr/bin/env node
// The live picture in the Desktop's own frame. The Desktop (4.29.0's renderer, read from its ion-dist bundle) draws an
// interactive Svg as <iframe sandbox="" srcdoc> sized by the Svg's width and height alone, the srcdoc a CSP, a base
// sheet that stretches the svg over the frame, and the source as its scrub left it: DOMPurify with the svg profile,
// <animate>/<set>/<use> and from/to/calcMode added, script/foreignObject/image/a/iframe forbidden, no data-* or on*
// attributes, hrefs only to #ids, and exactly one svg root (else the Desktop draws the alt text alone). This script
// gets the pictures from the real engine over the Desktop's wire (as shots.mjs does), puts each through that frame in
// Chromium (Edge), and checks with a real pointer what a person sees: the size, the hover trace and caption, the idle
// cycle's soft fade, the running topic, a focused chain and a narrow pane.
//
//   node tests/e2e/frame.mjs [shotsDir]   # about 60 s; needs `claude` (CLAUDE_BIN), and Playwright and DOMPurify 3.4.13
//                                         # on NODE_PATH: npm i -g playwright dompurify@3.4.13; NODE_PATH=$(npm root -g)
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { Desktop, Engine, bigFolder, findAll, seed, sleep, svgOfTree } from './desktop.mjs'

const require = createRequire(import.meta.url)
let chromium, purify
try {
  ;({ chromium } = require('playwright'))
  purify = fs.readFileSync(require.resolve('dompurify/dist/purify.js'), 'utf8')
} catch {
  console.error('Playwright and DOMPurify are needed: npm i -g playwright dompurify@3.4.13, with NODE_PATH set to `npm root -g`.')
  process.exit(1)
}
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'constellation-frame-'))
fs.mkdirSync(OUT, { recursive: true })

let passed = 0
let failed = 0
function check(ok, what, detail) {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}${ok || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`)
}

// 1. The pictures, as the Desktop asks for them: a folder of about 140 sessions, one running.
const pre = seed([], 'storefront')
const now = Date.now()
const { sessions } = bigFolder(pre.cwd, now)
sessions[0].mtime = now - 30_000
const dir = path.join(pre.cfg, 'projects', pre.cwd.replace(/[^a-zA-Z0-9]/g, '-'))
for (const s of sessions) {
  const file = path.join(dir, `${s.id}.jsonl`)
  fs.writeFileSync(file, s.text)
  fs.utimesSync(file, new Date(s.mtime), new Date(s.mtime))
}
const COLUMNS = 120
const slotOf = columns => columns * 7.7 - 40
const pictures = []
const engine = new Engine(pre)
const desk = new Desktop(engine)
try {
  await engine.request({ subtype: 'initialize' }, 90_000)
  await desk.attach()
  const counted = tree => [...(svgOfTree(tree)?.props.alt ?? '').matchAll(/\((\d+)\)/g)].reduce((a, m) => a + Number(m[1]), 0)
  let r = await desk.pane()
  for (const t0 = Date.now(); counted(r.tree) < sessions.length && Date.now() - t0 < 60_000; ) {
    await sleep(250)
    r = await desk.pane()
  }
  pictures.push({ name: 'map', props: svgOfTree(r.tree).props, columns: COLUMNS })
  const button = findAll(r.tree, n => n.type === 'Button' && /^t:/.test(n.props?.key ?? ''))[0]
  await desk.pressAndDraw(button.props.key)
  pictures.push({ name: 'focus', props: svgOfTree(desk.tree).props, columns: COLUMNS })
  desk.bodyColumns = 44
  pictures.push({ name: 'narrow', props: svgOfTree((await desk.pane()).tree).props, columns: 44 })
} finally {
  await engine.close()
}

// 2. The Desktop's frame.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; form-action 'none'"
const BASE_CSS = ':root{color-scheme:light dark}html,body{margin:0;height:100%;background:transparent;overflow:hidden}body>svg{display:block;width:100%;height:100%}'
let browser
try {
  browser = await chromium.launch()
} catch {
  browser = await chromium.launch({ channel: 'msedge' })
}
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, colorScheme: 'dark' })

/** Mounts a picture as the Desktop does, in a column box at the slot's width; returns what its scrub dropped. */
async function mount({ props, columns }) {
  await page.setContent('<!doctype html><html><body style="margin:0;background:#0F131A"></body></html>')
  await page.addScriptTag({ content: purify })
  return page.evaluate(({ props, slot, CSP, BASE_CSS }) => {
    const keep = (name, value) => name.startsWith('on') ? false : name === 'href' || name === 'xlink:href' ? value.trim().startsWith('#') : name !== 'attributename' || (n => n !== '' && n !== 'href' && !n.startsWith('on'))(value.trim().toLowerCase().split(':').at(-1) ?? '')
    const p = window.DOMPurify(window)
    p.addHook('uponSanitizeAttribute', (_, d) => { keep(d.attrName, d.attrValue) || (d.keepAttr = false) })
    const nodes = Array.from(p.sanitize(props.source, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['animate', 'set', 'use'], ADD_ATTR: ['from', 'to', 'calcMode'], FORBID_TAGS: ['script', 'foreignObject', 'image', 'a', 'iframe'], ALLOW_DATA_ATTR: false, ALLOW_UNKNOWN_PROTOCOLS: false, FORCE_BODY: true, RETURN_DOM_FRAGMENT: true }).childNodes).filter(e => e.nodeType !== Node.TEXT_NODE || e.textContent?.trim())
    const root = nodes.length === 1 && nodes[0] instanceof Element && nodes[0].localName === 'svg' ? nodes[0] : null
    // The wrapper FORCE_BODY parses into is not the source's: what else went is.
    const dropped = p.removed.map(x => (x.element ? `<${x.element.localName}>` : `${x.attribute?.name} on <${x.from?.localName}>`)).filter(x => x !== '<body>' && x !== '<remove>')
    const box = document.createElement('div')
    box.setAttribute('style', `width:${slot}px;display:flex;box-sizing:border-box;flex-direction:column;gap:4px`)
    if (root) {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', '')
      frame.setAttribute('title', props.alt)
      frame.setAttribute('srcdoc', `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${BASE_CSS}</style>${root.outerHTML}`)
      const px = v => (Number.isFinite(v) && v > 0 ? `${v}px` : undefined)
      frame.setAttribute('style', ['display:block', 'max-width:100%', 'border:0', px(props.width) && `width:${px(props.width)}`, px(props.height) && `height:${px(props.height)}`].filter(Boolean).join(';'))
      box.appendChild(frame)
    }
    document.body.replaceChildren(box)
    return { kept: root !== null, dropped }
  }, { props, slot: slotOf(columns), CSP, BASE_CSS })
}

const frameOf = async () => {
  const handle = await page.$('iframe')
  const frame = await handle?.contentFrame()
  for (let i = 0; frame && i < 40 && !(await frame.$('svg')); i += 1) await sleep(50)
  return { frame, box: await handle?.boundingBox() }
}
/** The pointer over an element of the frame, by its drawn box. */
async function hover(frame, box, selector) {
  const r = await frame.evaluate(s => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 } }, selector)
  if (r) await page.mouse.move(box.x + r.x, box.y + r.y)
  return Boolean(r)
}
// A topic's opacity is the hover fade's; its parts' (all but the ring, its halo, its lead and its glow) is the cycle's.
const state = frame => frame.evaluate(() => {
  const topics = [...document.querySelectorAll('g.t')].map(g => {
    const part = g.querySelector(':scope > :not(.rg):not(.rh):not(.ld):not(.glow)')
    return { i: Number(/t-(\d+)/.exec(g.getAttribute('class'))[1]), run: g.classList.contains('run'), opacity: Number(getComputedStyle(g).opacity), part: part ? Number(getComputedStyle(part).opacity) : 1 }
  })
  const captions = [...document.querySelectorAll('[class^="c-"], [class*=" c-"]')].filter(e => Number(getComputedStyle(e).opacity) > 0.5).map(e => e.getAttribute('class'))
  return { topics, captions }
})
const luminance = color => { const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }

for (const picture of pictures) {
  const { name, props, columns } = picture
  const viewBox = (/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(props.source) ?? []).slice(1).map(Number)
  const scrub = await mount(picture)
  check(scrub.kept, `${name}: the Desktop's scrub keeps the svg root (else it draws the alt text alone)`)
  check(scrub.dropped.every(x => x === 'role on <svg>'), `${name}: …and drops nothing but the root's role`, scrub.dropped)
  const { frame, box } = await frameOf()
  if (!frame || !box) {
    check(false, `${name}: the frame loads`)
    continue
  }
  const drawn = await frame.evaluate(() => { const b = document.querySelector('svg').getBoundingClientRect(); const g = document.querySelector('svg > g, svg > rect')?.getBoundingClientRect(); return { svg: [b.width, b.height], inner: g && [g.width, g.height] } })
  const want = Math.min(viewBox[0], slotOf(columns))
  check(Math.abs(box.width - want) <= 1 && Math.abs(box.height - (want * viewBox[1]) / viewBox[0]) <= 1, `${name}: the frame is the picture's size, ${Math.round(want)}×${Math.round((want * viewBox[1]) / viewBox[0])} for the ${viewBox.join('×')} field (unsized it is 150 px tall)`, [box.width, box.height])
  const scale = Math.min(box.width / viewBox[0], box.height / viewBox[1])
  check(Math.abs(scale * viewBox[0] - box.width) <= 1.5 && Math.abs(scale * viewBox[1] - box.height) <= 1.5, `${name}: …and the picture fills it, with no band around it`, { frame: [box.width, box.height], picture: [scale * viewBox[0], scale * viewBox[1]] })
  await page.mouse.move(2, box.y + box.height + 40)
  await sleep(400)
  await page.screenshot({ path: path.join(OUT, `frame-${name}.png`), clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.y + box.height) } })

  if (name === 'map') {
    const before = await state(frame)
    const idle = before.topics.filter(t => !t.run)
    const running = before.topics.filter(t => t.run)
    check(running.length >= 1, 'map: the running topic is drawn as running', running.map(t => t.i))
    const ring = await frame.evaluate(() => { const g = document.querySelector('g.t.run'); return { ring: Boolean(g?.querySelector('.rg')), ripples: [...(g?.querySelectorAll('.rp') ?? [])].filter(e => e.getAnimations().some(a => a.playState === 'running')).length } })
    check(ring.ring && ring.ripples >= 1, 'map: …it wears its ring, and its running session’s ripple animates', ring)
    // 2. Before any pointer: the idle cycle, a traced topic at full and the rest easing to about 0.4. Sampled first,
    // since a synthetic pointer that leaves a sandboxed frame leaves its :hover set in headless Chromium (an unsandboxed
    // frame clears it); whether the Desktop's real pointer clears it is not measured here.
    const samples = []
    for (let t0 = Date.now(); Date.now() - t0 < 13_000; await sleep(100)) samples.push(await state(frame))
    // A slot: one topic's parts at full while the rest are down; the cycle walks, so more than one topic gets one.
    const slots = samples.filter(s => s.topics.some(t => t.part < 0.6)).map(s => s.topics.filter(t => t.part > 0.97).map(t => t.i).join(','))
    const lit = new Set(slots.filter(s => s !== '' && !s.includes(',')))
    const parts = samples.flatMap(s => s.topics.map(t => t.part))
    const floor = Math.min(...parts)
    const between = parts.filter(o => o > 0.45 && o < 0.95)
    check(lit.size >= 2, 'map: with no pointer, the idle cycle traces one topic at a time, topic after topic', [...lit])
    check(floor > 0.35 && floor < 0.45, 'map: …the others ease to about 0.4', floor)
    check(between.length >= 3, 'map: …softly, through values between (a fade, not a snap)', between.length)
    check(samples.every(s => s.topics.every(t => t.opacity > 0.97)), 'map: …and the hover fade stays off while nothing is pointed', Math.min(...samples.flatMap(s => s.topics.map(t => t.opacity))))
    // 3. Hover traces one topic: its pill light, its caption up, the rest faded.
    const [a, b] = idle
    await hover(frame, box, `.t-${a.i} .pill`)
    await sleep(350)
    const traced = await state(frame)
    const pill = await frame.evaluate(i => getComputedStyle(document.querySelector(`.t-${i} .pill`)).fill, a.i)
    await page.screenshot({ path: path.join(OUT, 'frame-trace.png'), clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.y + box.height) } })
    const others = traced.topics.filter(t => t.i !== a.i)
    check(luminance(pill) > 0.6, `map: hovering topic ${a.i} fills its pill light`, pill)
    check(traced.captions.some(c => c.split(/\s+/).includes(`c-${a.i}`)), `map: …its caption takes the hint's place`, traced.captions)
    check(others.length > 0 && others.every(t => t.opacity <= 0.35), 'map: …and every other topic fades low', others.map(t => t.opacity))
    // The trace follows the pointer to a second topic at once.
    await hover(frame, box, `.t-${b.i} .pill`)
    await sleep(350)
    const moved = await state(frame)
    check(moved.captions.some(c => c.split(/\s+/).includes(`c-${b.i}`)) && !moved.captions.some(c => c.split(/\s+/).includes(`c-${a.i}`)), `map: moving to topic ${b.i} moves the trace and the caption`, moved.captions)
  }
  if (name === 'focus' || name === 'narrow') {
    const steps = await frame.evaluate(() => document.querySelectorAll('title').length)
    check(steps > 0, `${name}: the chain's steps carry their tooltips`, steps)
  }
}
await browser.close()
console.log(`== ${passed} passed, ${failed} failed (pictures in ${OUT})`)
process.exit(failed === 0 && passed > 0 ? 0 : 1)
