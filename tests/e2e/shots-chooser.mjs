#!/usr/bin/env node
// The pane's element trees as the Desktop draws them, each in the dark and the light theme, built by the mod's
// own draw functions over a folder like the owner's (three major topics, one minor, one suggested, one running):
//   chooser   the band and the pane's chooser (the default)
//   map       the pane's header, "Jump back in" and the buttons under the map, and a merge pick
//   focus     the header and the buttons under a focused topic's chain, a step selected
//
//   node tests/e2e/shots-chooser.mjs <out.png> [chooser|map|focus]   # needs tsc (npx typescript@5.9.3) and Edge or Chrome
//
// The Desktop draws a Button's children as one flat label in the button's own colours (a `primary` one a
// light slab, a default one a grey chip, a `plain` one as text), a hotkey as a small key cap after the
// label; Boxes as flex boxes with their fills, borders and gaps. Hover is not drawn: a chip's `hover` is
// listed under the picture instead.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WHICH = process.argv[3] ?? 'chooser'
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, `${WHICH}.png`))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cst-chooser-'))

// The hooks as plain ES modules: tsc emits them, the relative imports gain their extension.
const tsc = spawnSync('npx', ['-y', '-p', 'typescript@5.9.3', 'tsc', 'hooks/draw.tsx', '--outDir', tmp, '--rootDir', '.', '--module', 'esnext', '--target', 'es2023', '--moduleResolution', 'bundler', '--jsx', 'react', '--jsxFactory', 'h', '--jsxFragmentFactory', 'Fragment', '--skipLibCheck', '--noCheck'], { cwd: REPO, shell: true, encoding: 'utf8' })
if (tsc.status !== 0) {
  console.error(tsc.stdout, tsc.stderr)
  process.exit(1)
}
for (const dir of ['hooks', 'types']) {
  const full = path.join(tmp, dir)
  if (!fs.existsSync(full)) continue
  for (const f of fs.readdirSync(full)) {
    const file = path.join(full, f)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g, (m, a, p, b) => (p.endsWith('.js') ? m : `${a}${p}.js${b}`)))
  }
}
globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
globalThis.Fragment = 'Fragment'
const draw = await import(pathToFileURL(path.join(tmp, 'hooks', 'draw.js')).href)

const NOW = Date.parse('2026-10-27T18:00:00.000Z')
const MIN = 60_000
const DAY = 86_400_000
const TITLES = ['Live pane hover tracing', 'Join card redesign', 'Idle cycle soft fade', 'Running topic ring', 'Gates on the branch', 'Installer fixes']
const sessionOf = (id, i, ago) => ({ id: `${id}-${i}`, topicId: id, title: `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` ${i}` : ''}`, lastAt: NOW - ago - i * DAY, startedAt: NOW - ago - (10 - i) * DAY, isInRange: true, status: id === 't1' && i === 0 ? 'active' : 'idle', turns: 12, branch: 'main' })
const topicOf = (id, name, color, count, ago, isMajor = true) => ({ id, name, color, isMajor, lastAt: NOW - ago, sessions: Array.from({ length: count }, (_, i) => sessionOf(id, i, ago)) })
const topics = [
  topicOf('t1', 'Constellation Build', '#E9A23B', 10, 3 * MIN),
  topicOf('t2', 'Claudetools Tools', '#58A6FF', 11, 8 * DAY),
  topicOf('t3', 'Api Trading', '#3FB950', 2, 22 * DAY),
]
if (WHICH !== 'chooser') topics.push(topicOf('t4', 'Notes', '#B58CFF', 1, 30 * DAY, false))
if (WHICH === 'focus') topics[0].sessions = topics[0].sessions.slice(0, 5)
const sessions = topics.flatMap(t => t.sessions).sort((a, b) => b.lastAt - a.lastAt)
const model = { topics, sessions, links: [], byId: Object.fromEntries(sessions.map(s => [s.id, s])), topicById: Object.fromEntries(topics.map(t => [t.id, t])) }
const ui = { view: 'map', query: '', focusTopic: null, selected: null, mergeFrom: null, moveMode: false, showSettings: false, showHelp: false }
const settings = { rangeDays: 30, numbering: 'oldestFirst', showRelated: true }
const view = WHICH === 'chooser'
  ? { model, me: { folder: 'Projects', suggested: 't1', topicId: null, isNewTopic: false }, now: NOW, surface: 'desktop', settings: {}, ui: {} }
  : { model, me: { folder: 'Projects', suggested: null, topicId: 't1', isNewTopic: false }, now: NOW, surface: 'desktop', settings, ui }
const act = new Proxy({}, { get: () => () => undefined })
const T = { Box: 'Box', Text: 'Text', Button: 'Button', Input: 'Input', Select: 'Select' }

const SPACE = { xs: 4, sm: 8, md: 12, lg: 16 }
const px = v => (typeof v === 'number' ? v * 8 : (SPACE[v] ?? 0))
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const flat = n => (typeof n === 'string' || typeof n === 'number' ? String(n) : n && n.children ? n.children.map(flat).join('') : '')
const hovers = []

function html(n) {
  if (n === null || n === undefined || n === false || n === '') return ''
  if (typeof n === 'string' || typeof n === 'number') return escape(n)
  const p = n.props
  const kids = n.children.map(html).join('')
  if (n.type === 'Box') {
    if (p.hover) hovers.push(`${flat(n).trim().slice(0, 40)}: ${Object.entries(p.hover).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    const css = [
      'display:flex',
      `flex-direction:${p.flexDirection ?? 'row'}`,
      p.flexWrap ? `flex-wrap:${p.flexWrap}` : '',
      p.gap !== undefined ? `gap:${px(p.gap)}px` : '',
      p.alignItems ? `align-items:${p.alignItems}` : '',
      p.justifyContent ? `justify-content:${p.justifyContent}` : '',
      p.paddingX !== undefined ? `padding-left:${px(p.paddingX)}px;padding-right:${px(p.paddingX)}px` : '',
      p.paddingY !== undefined ? `padding-top:${px(p.paddingY)}px;padding-bottom:${px(p.paddingY)}px` : '',
      p.borderStyle ? `border:1px ${p.borderStyle === 'dashed' ? 'dashed' : 'solid'} ${p.borderColor ?? 'var(--line)'};border-radius:${p.borderStyle === 'round' ? 8 : 2}px` : '',
      p.borderStyle && p.paddingY === undefined ? 'padding-top:6px;padding-bottom:6px' : '',
      p.backgroundColor ? `background:${p.backgroundColor}` : '',
    ]
    return `<div style="${css.filter(Boolean).join(';')}">${kids}</div>`
  }
  if (n.type === 'Text') {
    const css = [p.color ? `color:${p.color}` : '', p.dimColor ? 'opacity:.55' : '', p.mono ? 'font-family:Consolas,monospace' : '', p.weight === 'medium' ? 'font-weight:600' : p.weight === 'semibold' ? 'font-weight:700' : '', p.size === 'footnote' ? 'font-size:12.5px' : '']
    return `<span style="${css.filter(Boolean).join(';')}">${kids}</span>`
  }
  if (n.type === 'Input') return `<span class="input">${escape(p.value || p.placeholder || '')}</span>`
  if (n.type === 'Select') return `<span class="input">${escape(p.options?.find(o => o.value === p.value)?.label ?? p.value ?? '')} ▾</span>`
  if (n.type === 'Button') {
    const label = escape(p.label ?? flat(n).trim())
    const key = p.hotkey ? `<span class="key">${escape(p.hotkey)}</span>` : ''
    const cls = p.plain ? 'btn plain' : p.variant === 'primary' ? 'btn primary' : 'btn'
    return `<span class="${cls}"${p.dimColor ? ' style="opacity:.6"' : ''}>${label}${key}</span>`
  }
  return kids
}

const column = (...kids) => h('Box', { flexDirection: 'column', gap: 'xs' }, ...kids)
const field = label => h('Box', { paddingY: 'lg' }, h('Text', { dimColor: true }, label))
const focused = { ...view, model: { ...model, links: [{ a: 't1', b: 't2', via: 'draw.tsx' }] }, ui: { ...ui, focusTopic: 't1', selected: 't1-2' } }
const SCENES = {
  chooser: [['band', () => draw.drawChooser(T, view, act, 'band')], ['pane chooser', () => draw.drawChooser(T, view, act, 'pane')]],
  map: [
    ['map', () => column(draw.drawHeader(T, view, act), draw.drawRecent(T, view, act), field('[ the field ]'), draw.drawControls(T, view, act))],
    ['merge pick', () => draw.drawControls(T, { ...view, ui: { ...ui, mergeFrom: 't2' } }, act)],
  ],
  focus: [['focus', () => column(draw.drawHeader(T, focused, act), field('[ the chain ]'), draw.drawControls(T, focused, act))]],
}
const panels = []
for (const [label, build] of SCENES[WHICH]) {
  for (const theme of ['dark', 'light']) panels.push(`<div class="panel ${theme}"><div class="tag">${label} · ${theme}</div>${html(build())}</div>`)
}
const page = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#888;font:14px 'Segoe UI',system-ui,sans-serif}
.panel{padding:14px 18px 16px;margin:0}
.dark{--line:#3a3a3a;background:#262626;color:#e6e6e6}
.light{--line:#d8d8d8;background:#f7f7f5;color:#1f1f1f}
.tag{font:11px Consolas,monospace;opacity:.45;margin-bottom:6px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;white-space:nowrap}
.dark .btn{background:#3a3a3a;color:#ececec}.light .btn{background:#e7e7e4;color:#1f1f1f}
.dark .btn.primary{background:#f2f2f2;color:#1a1a1a}.light .btn.primary{background:#1f1f1f;color:#fafafa}
.btn.plain{background:none!important;padding:0 2px;color:inherit}
.input{display:inline-flex;padding:4px 10px;border:1px solid var(--line);border-radius:6px;opacity:.8}
.key{font:11px Consolas,monospace;border:1px solid currentColor;border-radius:3px;padding:0 4px;opacity:.55}
.hov{font:11px Consolas,monospace;background:#222;color:#bbb;padding:8px 18px;white-space:pre-wrap}
</style><body><div id="shot" style="width:1000px">${panels.join('')}<div class="hov">${hovers.length ? `hover: ${escape([...new Set(hovers)].join('\n       '))}` : 'hover: none'}</div></div></body>`
const htmlFile = path.join(tmp, 'chooser.html')
fs.writeFileSync(htmlFile, page)

const browsers = [path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'), 'chromium', 'google-chrome']
const bin = browsers.find(b => !b.includes(path.sep) || fs.existsSync(b))
const shot = spawnSync(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${path.join(tmp, 'profile')}`, '--force-device-scale-factor=2', '--window-size=1000,900', `--screenshot=${OUT}`, pathToFileURL(htmlFile).href], { encoding: 'utf8' })
if (!fs.existsSync(OUT)) {
  console.error('no picture:', shot.stderr)
  process.exit(1)
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`wrote ${OUT}`)
