#!/usr/bin/env node
// End to end on the Desktop's wire: the real Claude Code engine, driven the way Claude Desktop drives it.
//
//   node tests/e2e/desktop.mjs                 # about a minute; no model turn, no sign-in needed
//   E2E_INSTALL=1 node tests/e2e/desktop.mjs   # install the plugin from this checkout first, as tui.sh does
//   E2E_SHOTS=<dir> node tests/e2e/desktop.mjs # also save the pictures the engine sent (the README's images)
//
// Claude Desktop runs the engine as a child over stdio (stream-json) and asks for each plugin drawing with
// control requests: `ui_attach` names the surface, `ui_render` returns a pane's element tree, `ui_client_module`
// serves a Client's module source with the `claude:surface-runtime` driver, and what the module posts goes back as
// `ui_message`. A Desktop Client's pointer events never reach the engine: the Desktop's frame runs the module and
// sends only its posts. This script is that frame: it runs client/map.js under the runtime the engine served,
// hands it pointer events on the cells over the picture, and forwards its posts, so a click here goes through
// every piece of code a click on the Desktop does, save the Desktop's own layout and pixels.
//
// Four folders, each its own fresh config dir: the three fixture transcripts; a generated folder of about 140
// sessions in a dozen themes with one transcript over 4 MiB; an empty folder; and the fixtures again, to see the
// pane open on its own when "On session start" is Pane. Prints PASS/FAIL per check, exits 1 on any failure.
// Needs Node 18+ and `claude` on PATH (or CLAUDE_BIN).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURES = path.join(REPO, 'tests/fixtures')
const CLAUDE = process.env.CLAUDE_BIN || 'claude'
const IS_WIN = process.platform === 'win32'
const SHOTS = process.env.E2E_SHOTS ? path.resolve(process.env.E2E_SHOTS) : ''
const PLUGIN = 'constellation'
const PANE = 'constellation'
const SVG_MAX_BYTES = 128 * 1024 // the engine's bound on an Svg's source
const SVG_MAX_PX = 4096 // and on its size
const CELL_ASPECT = 0.47 // a code font's advance over its line height: how many rows a picture of a given width covers

let passed = 0
let failed = 0
const temps = []
function check(ok, label, detail) {
  if (ok) {
    passed++
    console.log(`PASS: ${label}`)
  } else {
    failed++
    console.log(`FAIL: ${label}${detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
  }
  return ok
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------- folders

const FIXTURE_FILES = [
  { id: '11111111-aaaa-4bbb-8ccc-000000000001', file: 'checkout-tests.jsonl', mtime: '2026-10-20T09:05:00Z' },
  { id: '44444444-aaaa-4bbb-8ccc-000000000004', file: 'checkout-rounding.jsonl', mtime: '2026-10-18T15:04:00Z' },
  { id: '22222222-aaaa-4bbb-8ccc-000000000002', file: 'orders-pagination.jsonl', mtime: '2026-10-19T14:03:00Z' },
]
const fixtureFolder = () => FIXTURE_FILES.map(f => ({ id: f.id, text: fs.readFileSync(path.join(FIXTURES, f.file), 'utf8'), mtime: Date.parse(f.mtime) }))

/** A fresh config dir and project folder; the transcripts go where the engine keeps that folder's sessions. */
function seed(sessions, name = 'web-app') {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'cst-cfg-'))
  const cwd = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cst-'))), name)
  fs.mkdirSync(cwd, { recursive: true })
  fs.writeFileSync(path.join(cwd, 'README.md'), '# demo\n')
  const dir = path.join(cfg, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  for (const s of sessions) {
    const file = path.join(dir, `${s.id}.jsonl`)
    fs.writeFileSync(file, s.text)
    fs.utimesSync(file, new Date(s.mtime), new Date(s.mtime))
  }
  temps.push(cfg, path.dirname(cwd))
  return { cfg, cwd }
}

const THEMES = [
  { name: 'checkout', branch: 'fix/checkout', files: ['src/checkout/Cart.tsx', 'src/checkout/total.ts', 'src/checkout/Cart.test.tsx', 'src/checkout/coupon.ts'], asks: ['fix the cart total rounding', 'add coupon codes to the checkout', 'the cart badge count is stale after removing an item', 'checkout total ignores the shipping fee', 'make the cart test stop flaking on the total', 'split the checkout summary into its own component', 'apply the coupon before tax in the cart total', 'show a loading state on the checkout button', 'cart quantity input accepts negative numbers', 'the checkout coupon field loses focus on error', 'round the cart line totals once, at the end'] },
  { name: 'auth', branch: 'feat/cookie-auth', files: ['src/auth/session.ts', 'src/auth/middleware.ts', 'src/auth/refresh.ts', 'src/auth/login.tsx'], asks: ['move the auth tokens to httpOnly cookies', 'the refresh token race logs people out', 'add remember me to the login form', 'auth middleware rejects valid sessions after deploy', 'expire the session cookie on logout everywhere', 'rate limit the login endpoint', 'login form shows the wrong error for a locked account', 'refresh the auth session in the background', 'auth middleware should skip the health check', 'session cookie needs SameSite=Lax'] },
  { name: 'orders', branch: 'feat/cursor-pages', files: ['src/orders/route.ts', 'src/orders/OrdersList.tsx', 'src/orders/pagination.ts'], asks: ['switch the orders API to cursor pagination', 'infinite scroll for the orders list', 'orders list jumps when a new page loads', 'orders route returns duplicates across pages', 'add a status filter to the orders list', 'orders pagination cursor breaks on equal timestamps', 'export the orders list as csv', 'orders route is slow for large accounts', 'empty state for the orders list'] },
  { name: 'search', branch: 'feat/search', files: ['src/search/index.ts', 'src/search/SearchBox.tsx', 'src/search/rank.ts'], asks: ['search box should debounce the queries', 'rank exact title matches first in search', 'search index misses products added today', 'highlight the matched words in search results', 'keyboard navigation in the search box results', 'search ranking ignores stock', 'rebuild the search index nightly', 'search box clears on blur by accident', 'typo tolerance in search'] },
  { name: 'payments', branch: 'feat/stripe', files: ['src/payments/stripe.ts', 'src/payments/webhook.ts', 'src/payments/refund.ts'], asks: ['stripe webhook retries create duplicate payments', 'refunds should be partial as well as full', 'verify the stripe webhook signature', 'payments fail when the card needs 3d secure', 'log the stripe payment intent ids', 'refund webhook arrives before the payment', 'move stripe keys to the secrets store', 'payments page shows cents as dollars', 'idempotency keys for stripe payment calls'] },
  { name: 'ci', branch: 'ci/speed', files: ['.github/workflows/ci.yml', 'vitest.config.ts', 'scripts/shard.sh'], asks: ['cache node_modules in the ci workflow', 'shard the vitest run across four ci jobs', 'ci workflow should fail on lint warnings', 'ci takes twenty minutes, find the slow vitest files', 'run the ci workflow on merge queue', 'vitest coverage threshold in ci', 'ci shard script loses failures', 'pin the ci node version'] },
  { name: 'docs', branch: 'docs/guide', files: ['docs/guide.md', 'docs/api.md', 'docs/deploy.md'], asks: ['write the deploy guide in the docs', 'document the orders api in docs/api', 'docs guide is out of date on env vars', 'add a troubleshooting section to the docs guide', 'docs api examples use the old auth header', 'docs deploy steps for the staging box', 'proofread the docs guide'] },
  { name: 'i18n', branch: 'feat/i18n', files: ['src/i18n/en.json', 'src/i18n/hi.json', 'src/i18n/format.ts'], asks: ['add hindi translations to i18n', 'i18n format dates per locale', 'missing i18n keys show raw ids', 'i18n plural rules for item counts', 'currency format per locale in i18n', 'i18n fallback to english when a key is missing', 'right to left layout check for i18n'] },
  { name: 'notify', branch: 'feat/notify', files: ['src/notify/email.ts', 'src/notify/push.ts', 'src/notify/templates.ts'], asks: ['order shipped email notification', 'push notifications for price drops', 'email templates need the new logo', 'notify users when a refund completes', 'unsubscribe link in every notification email', 'push notification permission prompt timing', 'batch the notification emails hourly'] },
  { name: 'analytics', branch: 'feat/funnel', files: ['src/analytics/events.ts', 'src/analytics/funnel.ts'], asks: ['track checkout funnel events in analytics', 'analytics events fire twice on route change', 'funnel report for the signup flow', 'drop analytics events from bots', 'analytics consent banner gating events', 'funnel dashboard numbers do not match events'] },
  { name: 'profile', branch: 'feat/profile', files: ['src/profile/Profile.tsx', 'src/profile/avatar.ts', 'src/profile/settings.ts'], asks: ['profile avatar upload crops badly', 'profile settings page for notifications', 'profile page loads the avatar twice', 'delete account from profile settings', 'profile form validation for phone numbers', 'avatar upload should resize on the server'] },
  { name: 'perf', branch: 'perf/cache', files: ['src/perf/cache.ts', 'webpack.config.js', 'src/perf/lazy.tsx'], asks: ['cache the product api responses', 'webpack bundle is 4mb, split it', 'lazy load the product images', 'cache invalidation when prices change', 'webpack build is slow in dev', 'measure the largest contentful paint'] },
]
const ONE_OFFS = ['bump the eslint config', 'fix a typo in the footer', 'rename the env example file', 'what does this regex do', 'update the license year', 'explain the docker compose file', 'try out the new date picker', 'clean up console logs', 'look into the 404 page styling', 'add a favicon']

function uuidOf(theme, n) {
  const hex = (theme * 1000 + n).toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${'b'.repeat(4)}-4ccc-8ddd-${hex.padStart(12, '0')}`
}

/** One plausible transcript: the prompt, edits to the theme's files, a closing line, the title the engine gave it. */
function transcript({ id, cwd, branch, ask, files, title, start, done, pad = 0 }) {
  const at = ms => new Date(start + ms).toISOString()
  const base = { isSidechain: false, userType: 'external', entrypoint: 'claude-desktop', cwd, sessionId: id, version: '2.1.311', gitBranch: branch }
  const rows = [{ ...base, parentUuid: null, type: 'user', uuid: `${id}-u0`, timestamp: at(0), message: { role: 'user', content: ask } }]
  files.forEach((file, i) => {
    rows.push({ ...base, parentUuid: `${id}-u${i}`, type: 'assistant', uuid: `${id}-a${i}`, timestamp: at(60_000 * (i + 1)), message: { role: 'assistant', model: 'claude', content: [{ type: 'text', text: `Editing ${path.basename(file)}.` }, { type: 'tool_use', id: `toolu_${i}`, name: 'Edit', input: { file_path: path.join(cwd, file), old_string: 'a', new_string: 'b' } }] } })
    rows.push({ ...base, parentUuid: `${id}-a${i}`, type: 'user', uuid: `${id}-u${i + 1}`, timestamp: at(60_000 * (i + 1) + 1000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, content: pad && i === 0 ? 'x'.repeat(pad) : 'The file has been updated.' }] } })
  })
  rows.push({ ...base, parentUuid: `${id}-u${files.length}`, type: 'assistant', uuid: `${id}-end`, timestamp: at(60_000 * (files.length + 2)), message: { role: 'assistant', model: 'claude', content: [{ type: 'text', text: done }] } })
  rows.push({ type: 'ai-title', aiTitle: title, sessionId: id })
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
}

const titleOf = ask => ask.replace(/^(fix|add|make|the|a)\s+/i, '').replace(/^\w/, c => c.toUpperCase()).slice(0, 48)

/** About 140 sessions over 45 days: twelve themes of six to eleven, ten one-offs, and one transcript over 4 MiB. */
function bigFolder(cwd, now) {
  const out = []
  const themeOf = {}
  let k = 0
  THEMES.forEach((t, ti) => {
    t.asks.forEach((ask, n) => {
      const id = uuidOf(ti + 1, n)
      const files = t.files.filter((_, i) => (i + n) % 3 !== 2).slice(0, 3)
      const start = now - ((k * 7919) % (44 * 86_400_000)) - 3_600_000
      k++
      out.push({ id, mtime: start + 600_000, text: transcript({ id, cwd, branch: n % 3 === 0 ? 'main' : t.branch, ask, files, title: titleOf(ask), start, done: `Done: ${ask}. Tests pass.` }) })
      themeOf[id] = t.name
    })
  })
  ONE_OFFS.forEach((ask, n) => {
    const id = uuidOf(90, n)
    const start = now - ((n * 104_729) % (40 * 86_400_000)) - 7_200_000
    out.push({ id, mtime: start + 300_000, text: transcript({ id, cwd, branch: 'main', ask, files: [`misc/note-${n}.txt`], title: titleOf(ask), start, done: 'Done.' }) })
    themeOf[id] = `one-off-${n}`
  })
  // One transcript over the engine's 4 MiB read: the scanner reads it in slices through the shell.
  const bigId = uuidOf(99, 0)
  const start = now - 2 * 86_400_000
  out.push({ id: bigId, mtime: start + 900_000, text: transcript({ id: bigId, cwd, branch: 'feat/stripe', ask: 'stripe webhook retries on the payment refund path', files: THEMES[4].files, title: 'Stripe webhook retry storm', start, done: 'Webhook retries are idempotent now.', pad: 5 * 1024 * 1024 }) })
  themeOf[bigId] = 'payments'
  return { sessions: out, themeOf, bigId }
}

// ---------------------------------------------------------------- the engine over stdio

/** The environment of a plain local session: anything marking this process as a hosted or remote worker gates the UI channel. */
function engineEnv(cfg) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_SESSION|CLAUDE_PID|CLAUDE_CONFIG_DIR|ANTHROPIC_)/.test(k)) continue
    env[k] = v
  }
  env.CLAUDE_CONFIG_DIR = cfg
  env.DISABLE_AUTOUPDATER = '1'
  return env
}

function install(cfg) {
  const r = spawnSync(CLAUDE, ['plugin', 'install', PLUGIN, '--marketplace', REPO], { env: engineEnv(cfg), encoding: 'utf8', shell: IS_WIN })
  if (r.status !== 0 || !/Successfully installed plugin/.test(`${r.stdout}${r.stderr}`)) {
    console.log(`FAIL: the one-line install from the checkout\n${r.stdout}${r.stderr}`)
    process.exit(1)
  }
}

class Engine {
  constructor({ cfg, cwd }) {
    if (process.env.E2E_INSTALL) install(cfg)
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json']
    if (!process.env.E2E_INSTALL) args.push('--plugin-dir', IS_WIN ? `"${REPO}"` : REPO)
    this.child = spawn(CLAUDE, args, { cwd, env: engineEnv(cfg), stdio: ['pipe', 'pipe', 'pipe'], shell: IS_WIN })
    this.pending = new Map()
    this.events = []
    this.n = 0
    this.stderr = ''
    let buf = ''
    this.child.stdout.on('data', d => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        let o
        try {
          o = JSON.parse(line)
        } catch {
          continue
        }
        if (o.type === 'control_response') {
          const cb = this.pending.get(o.response?.request_id)
          if (cb) {
            this.pending.delete(o.response.request_id)
            cb(o.response)
          }
        } else this.events.push(o)
      }
    })
    this.child.stderr.on('data', d => (this.stderr += d))
    this.exited = new Promise(r => this.child.on('exit', r))
  }
  /** One control request; resolves to its answer, or throws with the engine's error. */
  request(req, timeoutMs = 60_000) {
    const id = `r${++this.n}`
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${req.subtype}: no answer in ${timeoutMs} ms${this.stderr ? `; stderr: ${this.stderr.slice(-400)}` : ''}`))
      }, timeoutMs)
      this.pending.set(id, r => {
        clearTimeout(t)
        if (r.subtype === 'success') resolve(r.response ?? {})
        else reject(new Error(`${req.subtype}: ${r.error ?? JSON.stringify(r)}`))
      })
      this.child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: id, request: req })}\n`)
    })
  }
  /** Waits for a system message the engine pushes, from the `from`th on. */
  async waitFor(pred, timeoutMs = 10_000, from = 0) {
    const end = Date.now() + timeoutMs
    for (;;) {
      const hit = this.events.slice(from).find(pred)
      if (hit) return hit
      if (Date.now() > end) return undefined
      await sleep(100)
    }
  }
  async close() {
    try {
      await this.request({ subtype: 'ui_detach', client_id: 'harness' }, 5000)
    } catch {}
    this.child.stdin.end()
    this.child.kill('SIGTERM')
    await Promise.race([this.exited, sleep(4000)])
    if (this.child.exitCode === null) this.child.kill('SIGKILL')
  }
}

// ---------------------------------------------------------------- the Desktop's side

const VIEWPORT = { columns: 120, rows: 40, isFullscreen: false }
const paneProps = (placement = 'dock') => ({ title: 'Constellation', isFocused: true, bodyColumns: VIEWPORT.columns, placement, scroll: { offset: 0, bodyRows: VIEWPORT.rows }, view: {} })
const bandProps = () => ({ hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: VIEWPORT.columns, scroll: { offset: 0, bodyRows: 10 }, view: {} })

function walk(tree, fn, parent) {
  if (!tree || typeof tree !== 'object') return
  fn(tree, parent)
  for (const c of tree.children ?? []) walk(c, fn, tree)
}
function findAll(tree, pred) {
  const out = []
  walk(tree, (n, p) => pred(n, p) && out.push(n))
  return out
}
const find = (tree, pred) => findAll(tree, pred)[0]
const textOf = tree => {
  const parts = []
  walk(tree, n => {
    for (const c of n.children ?? []) if (typeof c === 'string') parts.push(c)
    if (n.props && typeof n.props.label === 'string') parts.push(n.props.label)
  })
  return parts.join(' ')
}
const buttonOf = (tree, key) => find(tree, n => n.type === 'Button' && n.props?.key === key)
const clientOf = tree => find(tree, n => n.type === 'Client' && n.props?.key === 'map')

/** What Claude Desktop is to the engine: an attached surface that asks for drawings and runs their Client modules. */
class Desktop {
  constructor(engine, surface = 'desktop') {
    this.engine = engine
    this.surface = surface
    this.posts = []
    this.faults = []
    this.redraws = 0
  }
  attach() {
    return this.engine.request({ subtype: 'ui_attach', surface: this.surface, client_id: 'harness', viewport: VIEWPORT })
  }
  async pane(placement) {
    const r = await this.engine.request({ subtype: 'ui_render', surface: this.surface, client_id: 'harness', component: 'Pane', instance_id: PANE, props: paneProps(placement), viewport: VIEWPORT })
    this.tree = r.tree
    this.hash = r.client_modules?.[PLUGIN]
    return r
  }
  async band() {
    return this.engine.request({ subtype: 'ui_render', surface: this.surface, client_id: 'harness', component: 'AbovePrompt', instance_id: 'band', props: bandProps(), viewport: VIEWPORT })
  }
  /** Presses a Button the hooks drew, by its key, in the last drawing (`tree`). */
  async press(key, tree = this.tree) {
    const b = buttonOf(tree, key)
    if (!b) throw new Error(`no Button ${key}`)
    return this.engine.request({ subtype: 'ui_press', plugin: b.press.plugin, handle: b.press.handle, key, surface: this.surface })
  }
  /** Loads the Client module as the Desktop frame does: the served runtime installed with a host, then the entry imported. */
  async loadModule() {
    const m = await this.engine.request({ subtype: 'ui_client_module', plugin: PLUGIN })
    this.module = m
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cst-frame-'))
    temps.push(dir)
    const fileOf = key => `${key.replace(/[^a-zA-Z0-9.]/g, '_')}.mjs`
    for (const f of m.files) {
      let src = f.source
      // The frame's import map, as plain relative files.
      for (const g of m.files) src = src.split(`"${g.key}"`).join(`"./${fileOf(g.key)}"`).split(`'${g.key}'`).join(`'./${fileOf(g.key)}'`)
      fs.writeFileSync(path.join(dir, fileOf(f.key)), src)
    }
    const rt = await import(pathToFileURL(path.join(dir, fileOf(m.runtime))).href)
    globalThis.h = rt.h
    globalThis.Fragment = rt.Fragment
    const host = {
      schedule: () => void this.redraws++,
      startTimer: () => ({}),
      stopTimer: () => undefined,
      post: (_id, text) => void this.posts.push(JSON.parse(text)),
      fault: (_id, reason) => void this.faults.push(String(reason)),
    }
    this.driver = rt.install(host, m.limits)
    const entry = m.modules.find(x => x.module === 'client/map.js')
    this.entry = await import(pathToFileURL(path.join(dir, fileOf(entry.entry))).href)
    this.component = entry.component
    return m
  }
  /** Mounts the map Client of the last drawing in a region of `columns` × `rows` cells. */
  mount(columns, rows) {
    if (this.mounted) this.driver.unmount('map')
    const props = clientOf(this.tree).props.props
    this.driver.mount('map', this.entry[this.component], props)
    this.driver.resize('map', columns, rows)
    this.mounted = true
    this.columns = columns
    this.rows = rows
    return this.draw()
  }
  draw() {
    this.driver.stage('map', 'render')
    const text = globalThis.__surface__.run()
    return typeof text === 'string' ? JSON.parse(text) : text
  }
  props() {
    return clientOf(this.tree)?.props.props
  }
  /** The cell over a point of the picture, in its field units (`fine` too, as a pointer with sub-cell positions gives). */
  cellOf(x, y, fine = false) {
    const p = this.props()
    const fx = (x / p.fieldW) * this.columns
    const fy = (y / p.fieldH) * this.rows
    return fine ? { x: Math.floor(fx), y: Math.floor(fy), fine: { x: fx, y: fy } } : { x: Math.floor(fx), y: Math.floor(fy) }
  }
  pointer(ev) {
    this.driver.stage('map', 'pointer', ev)
    globalThis.__surface__.run()
  }
  /** Sends the module's posts as the Desktop does, then draws the pane again and hands the Client its next props. */
  async flush() {
    const sent = this.posts.splice(0)
    for (const data of sent) {
      const r = await this.engine.request({ subtype: 'ui_message', plugin: PLUGIN, component: 'Pane', instance_id: PANE, client: 'map', module: 'client/map.js', data })
      if (!r.handled) throw new Error(`ui_message not handled: ${JSON.stringify(data)}`)
    }
    await this.pane()
    if (this.mounted && clientOf(this.tree)) {
      this.driver.setProps('map', this.props())
      this.draw()
    }
    return sent
  }
  async click(x, y, fine) {
    const c = this.cellOf(x, y, fine)
    this.pointer({ type: 'move', ...c })
    this.pointer({ type: 'down', ...c, button: 'left' })
    this.pointer({ type: 'up', ...c, button: 'left' })
    return this.flush()
  }
  async drag(from, to) {
    const a = this.cellOf(from.x, from.y)
    const b = this.cellOf(to.x, to.y)
    this.pointer({ type: 'down', ...a, button: 'left' })
    this.pointer({ type: 'move', ...b, button: 'left' })
    this.pointer({ type: 'up', ...b, button: 'left' })
    return this.flush()
  }
}

/** A point on a node as the picture draws it: a pill's centre, a minor topic's label, a dot, the back pill. */
function pointOn(n) {
  if (n.kind === 'topic' && !(n.isMajor || n.isAnchor)) return { x: n.x + Math.min(40, (n.w || 60) / 2), y: n.y }
  return { x: n.x, y: n.y }
}
const rowsFor = (columns, p) => Math.max(8, Math.round(columns * (p.fieldH / p.fieldW) * CELL_ASPECT))
const svgOfTree = tree => find(tree, n => n.type === 'Svg')
function saveShot(name, svg) {
  if (!SHOTS || !svg) return
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, name), svg.props.source)
}

// ---------------------------------------------------------------- 1. the fixture folder

async function fixtureFolderChecks() {
  console.log('== 1: the fixture folder on the Desktop')
  const { cfg, cwd } = seed(fixtureFolder())
  const engine = new Engine({ cfg, cwd })
  const desk = new Desktop(engine)
  try {
    await engine.request({ subtype: 'initialize' }, 90_000)
    const att = await desk.attach()
    check(att.surfaces?.includes('desktop'), 'the engine takes the harness as a Desktop surface', att)

    // The band: the chooser, and a join by its button.
    const band = await desk.band()
    check(band.hooked === true && /continuing which topic\?/.test(textOf(band.tree)), 'the band draws the chooser on the Desktop', textOf(band.tree).slice(0, 120))
    const chip = find(band.tree, n => n.type === 'Button' && /^j:/.test(n.props?.key ?? '') && /Checkout Cart/.test(textOf(n)))
    check(Boolean(chip), '…with a join button for the folder’s topic')

    // The pane: the picture as an image, the pointer layer over it, the buttons under it.
    const r = await desk.pane()
    const svg = svgOfTree(r.tree)
    check(Boolean(svg), 'the pane draws the picture (an Svg)')
    check(svg && svg.props.width === undefined && svg.props.height === undefined && svg.props.isInteractive === undefined, '…as an image: no pixel size, not interactive (it takes the pane’s width at its own aspect)', svg?.props && { width: svg.props.width, height: svg.props.height, isInteractive: svg.props.isInteractive })
    check(svg && Buffer.byteLength(svg.props.source) < SVG_MAX_BYTES, `…within the engine’s ${SVG_MAX_BYTES / 1024} KiB`, svg && Buffer.byteLength(svg.props.source))
    saveShot('desktop-map.svg', svg)
    const field = find(r.tree, n => n.type === 'Box' && n.props?.key === 'field')
    const layer = find(r.tree, n => n.type === 'Box' && n.props?.key === 'layer')
    check(field?.props.position === 'relative' && layer?.props.position === 'absolute' && [layer.props.top, layer.props.left, layer.props.right, layer.props.bottom].every(v => v === 0), 'the pointer layer is inset over the picture’s own box (relative parent, absolute child at 0)', { field: field?.props, layer: layer?.props })
    const client = clientOf(r.tree)
    check(client?.props.module === 'client/map.js' && client.props.width === '100%' && client.props.height === '100%', 'the layer holds the map Client at the box’s full size', client?.props && { module: client.props.module, width: client.props.width, height: client.props.height })
    check(client?.props.props.hits === true && client.props.props.outline === false, '…in picture mode, drawing nothing', client?.props.props && { hits: client.props.props.hits, outline: client.props.props.outline })
    const checkout = client?.props.props.nodes.find(n => n.kind === 'topic' && n.label === 'Checkout Cart')
    check(Boolean(checkout) && Boolean(buttonOf(r.tree, `t:${checkout.id}`)), 'the buttons under the picture hold the same topics')

    // The module, as the Desktop loads it.
    const m = await desk.loadModule()
    check(m.runtime === 'claude:surface-runtime' && m.modules.some(x => x.module === 'client/map.js'), 'the engine serves client/map.js with the surface runtime', { runtime: m.runtime, modules: m.modules })
    check(m.hash === desk.hash, '…and its hash matches the one the drawing names', { served: m.hash, drawn: desk.hash })
    const p = desk.props()
    const cols = 120
    const rows = rowsFor(cols, p)
    const drawn = desk.mount(cols, rows)
    check(drawn?.type === 'Box' && !(drawn.children ?? []).length, `the layer draws nothing over the picture (${cols}×${rows} cells)`, drawn)
    check(desk.driver.hasListener('map', 'pointer') === true, 'the layer listens to the pointer')
    check(desk.driver.hasListener('map', 'key') === false, '…and not to the keys, so a click never holds the keyboard')

    // Hover traces, leaving clears.
    const before = svgOfTree(desk.tree).props.source
    let c = desk.cellOf(pointOn(checkout).x, pointOn(checkout).y)
    desk.pointer({ type: 'move', ...c })
    let sent = await desk.flush()
    check(sent.some(d => d.type === 'hover' && d.id === checkout.id), 'hovering a topic on the picture posts it', sent)
    check(desk.props().hint === 'Checkout Cart · 2 sessions · Enter to focus', '…the hint names it', desk.props().hint)
    check(svgOfTree(desk.tree).props.source !== before, '…and the picture redraws traced')
    desk.pointer({ type: 'leave', ...c })
    await desk.flush()
    check(desk.props().hint === 'Hover or focus a topic to trace it · Enter or click to focus', 'the pointer leaving the picture clears the trace', desk.props().hint)

    // A click on a topic focuses it.
    sent = await desk.click(pointOn(checkout).x, pointOn(checkout).y)
    check(sent.some(d => d.type === 'pick' && d.id === checkout.id && d.kind === 'topic'), 'a click on a topic on the picture picks it', sent)
    check(desk.props().mode === 'focus', '…and the engine answers with the focused chain', desk.props().mode)
    check(/Checkout Cart/.test(textOf(find(desk.tree, n => n.type === 'Text' && /›/.test(textOf(n))) ?? {})), '…its name in the crumb')
    saveShot('desktop-focus.svg', svgOfTree(desk.tree))
    const steps = desk.props().nodes.filter(n => n.kind === 'step')
    check(steps.length === 2, 'the chain has its two steps', steps.length)

    // A step, with sub-cell positions.
    const first = steps.find(s => String(s.label) === '1')
    sent = await desk.click(first.x, first.y, true)
    check(sent.some(d => d.type === 'pick' && d.kind === 'step'), 'a click on a step picks it (sub-cell positions)', sent)
    check(Boolean(buttonOf(desk.tree, 'sc:pickup')) && /Checkout total rounding/.test(textOf(desk.tree)), '…and its card opens', textOf(desk.tree).slice(0, 160))
    check(buttonOf(desk.tree, 'sc:pickup')?.props.hotkey === 'u', '…with its u hotkey ready (the layer took no keys)')

    // The back pill.
    const back = desk.props().nodes.find(n => n.kind === 'back')
    sent = await desk.click(back.x, back.y)
    check(sent.some(d => d.type === 'pick' && d.kind === 'back'), 'a click on ‹ All topics picks it', sent)
    check(desk.props().mode === 'map', '…and the picture is back on all topics', desk.props().mode)

    // A session's dot.
    const dot = desk.props().nodes.find(n => n.kind === 'session' && n.topicId === checkout.id)
    sent = await desk.click(dot.x, dot.y)
    check(sent.some(d => d.type === 'pick' && d.id === dot.id && d.kind === 'session'), 'a click on a session’s dot picks it', sent)
    check(desk.props().mode === 'focus' && Boolean(buttonOf(desk.tree, 'sc:pickup')), '…opening its card in the chain')
    await desk.press('back')
    await desk.pane()
    if (desk.props().mode === 'focus') {
      await desk.press('back')
      await desk.pane()
    }
    desk.driver.setProps('map', desk.props())
    desk.draw()
    check(desk.props().mode === 'map', 'the Back button (an engine button, pressed over the wire) backs out', desk.props().mode)

    // A drop on empty space moves nothing; a drag onto Unsorted moves, stays, and Undo puts it back.
    const unsorted = desk.props().nodes.find(n => n.kind === 'topic' && n.id === 'unsorted')
    const sat = desk.props().nodes.find(n => n.kind === 'session' && n.topicId === checkout.id)
    sent = await desk.drag(sat, { x: 430, y: 470 })
    check(!sent.some(d => d.type === 'drop'), 'a satellite dropped on empty space posts no move', sent)
    sent = await desk.drag(desk.props().nodes.find(n => n.id === sat.id), pointOn(unsorted))
    check(sent.some(d => d.type === 'drop' && d.id === sat.id && d.targetId === 'unsorted'), 'dragging a satellite onto Unsorted posts the move', sent)
    check(desk.props().nodes.find(n => n.id === sat.id)?.topicId === 'unsorted', '…and the session is in Unsorted')
    await desk.press('refresh')
    await desk.pane()
    check(desk.props().nodes.find(n => n.id === sat.id)?.topicId === 'unsorted', '…still, after a rescan')
    check(Boolean(buttonOf(desk.tree, 'toast:undo')), '…with Undo offered')
    await desk.press('toast:undo')
    await desk.pane()
    check(desk.props().nodes.find(n => n.id === sat.id)?.topicId === checkout.id, 'Undo puts it back in its topic')
    desk.driver.setProps('map', desk.props())
    desk.draw()

    // Any layer size: the same point picks the same topic.
    for (const [w, h] of [[60, rowsFor(60, desk.props())], [200, rowsFor(200, desk.props())], [97, 23]]) {
      desk.mount(w, h)
      const node = desk.props().nodes.find(n => n.id === checkout.id)
      const cc = desk.cellOf(pointOn(node).x, pointOn(node).y)
      desk.pointer({ type: 'down', ...cc, button: 'left' })
      desk.pointer({ type: 'up', ...cc, button: 'left' })
      const got = desk.posts.splice(0)
      check(got.some(d => d.type === 'pick' && d.id === checkout.id), `a layer of ${w}×${h} cells maps the click to the same topic`, got)
    }
    desk.mount(cols, rows)

    // The settings, pressed as buttons: outline, off, and back on.
    await desk.press('settings')
    await desk.pane()
    await desk.press('set:advanced')
    await desk.pane()
    await desk.press('set:pictureClicks:outline')
    await desk.pane()
    check(desk.props()?.outline === true, 'Clicks on the picture: Outline reaches the layer')
    desk.mount(cols, rows)
    let t = desk.draw()
    check(new RegExp(`layer ${cols}×${rows} cells · field ${desk.props().fieldW}×${desk.props().fieldH}`).test(JSON.stringify(t)), '…which draws its edge and its size in cells', JSON.stringify(t).slice(0, 200))
    desk.pointer({ type: 'move', x: 7, y: 3 })
    t = desk.draw()
    check(/move at 7,3/.test(JSON.stringify(t)), '…and the last pointer event')
    await desk.press('set:pictureClicks:off')
    await desk.pane()
    check(!clientOf(desk.tree) && Boolean(svgOfTree(desk.tree)), 'Off: the picture alone, no layer')
    check(Boolean(buttonOf(desk.tree, `t:${checkout.id}`)), '…the topic buttons under it still pick')
    check(/Tab onto a topic to trace it · Enter or its button under the map focuses/.test(svgOfTree(desk.tree).props.source), '…and the picture’s hint says so')
    await desk.press('set:pictureClicks:on')
    await desk.pane()
    check(clientOf(desk.tree)?.props.props.hits === true, 'On again: the layer is back')
    await desk.press(`t:${checkout.id}`)
    await desk.pane()
    check(desk.props().mode === 'focus', 'a topic button under the picture focuses the topic too')

    // A pane the Desktop seats inline keeps the pointer hint.
    await desk.press('back')
    const inline = await desk.pane('inline')
    check(clientOf(inline.tree)?.props.props.hint === 'Hover or focus a topic to trace it · Enter or click to focus', 'a Desktop pane seated inline keeps the pointer hint', clientOf(inline.tree)?.props.props.hint)

    // The handoff loop's first step from the Desktop: join by the band's button; the status line follows.
    const band2 = await desk.band()
    const join = find(band2.tree, n => n.type === 'Button' && /^j:/.test(n.props?.key ?? '') && /Checkout Cart/.test(textOf(n)))
    const from = engine.events.length
    await desk.press(join.props.key, band2.tree)
    const status = await engine.waitFor(e => e.type === 'system' && e.subtype === 'ui_status' && /Checkout Cart · step 3/.test(e.text ?? ''), 10_000, from)
    check(Boolean(status), 'joining from the band on the Desktop sets the status line to the next step', status?.text)

    // Set "On session start" to Pane for check 4.
    await desk.pane()
    if (!buttonOf(desk.tree, 'set:openOnStart:pane')) {
      await desk.press('settings')
      await desk.pane()
    }
    await desk.press('set:openOnStart:pane')
    await desk.pane()
    check(buttonOf(desk.tree, 'set:openOnStart:pane')?.props.variant === 'primary', 'On session start: Pane is saved')

    check(desk.faults.length === 0, 'the module never faulted in the frame', desk.faults)
  } catch (error) {
    check(false, 'the fixture folder run', String(error?.stack ?? error))
  } finally {
    await engine.close()
  }
  return { cfg, cwd }
}

// ---------------------------------------------------------------- 2. a big folder

async function bigFolderChecks() {
  console.log('== 2: a folder of about 140 sessions, one over 4 MiB')
  const pre = seed([], 'storefront')
  const { sessions, themeOf, bigId } = bigFolder(pre.cwd, Date.now())
  const dir = path.join(pre.cfg, 'projects', pre.cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  for (const s of sessions) {
    const file = path.join(dir, `${s.id}.jsonl`)
    fs.writeFileSync(file, s.text)
    fs.utimesSync(file, new Date(s.mtime), new Date(s.mtime))
  }
  const engine = new Engine(pre)
  const desk = new Desktop(engine)
  try {
    await engine.request({ subtype: 'initialize' }, 90_000)
    await desk.attach()
    const t0 = Date.now()
    const r = await desk.pane()
    const ms = Date.now() - t0
    // The pane's first drawing waits for the first scan; a later one is the cached model.
    const t1 = Date.now()
    await desk.pane()
    const ms2 = Date.now() - t1
    console.log(`     first drawing ${ms} ms (with the scan), then ${ms2} ms`)
    check(ms2 < 3000, 'a drawing of the big folder, after the first scan, comes back in under 3 s', `${ms2} ms`)
    const svg = svgOfTree(r.tree)
    const bytes = Buffer.byteLength(svg?.props.source ?? '')
    const w = Number(/width="(\d+(?:\.\d+)?)"/.exec(svg?.props.source ?? '')?.[1])
    const h = Number(/height="(\d+(?:\.\d+)?)"/.exec(svg?.props.source ?? '')?.[1])
    check(bytes > 0 && bytes < SVG_MAX_BYTES, `the picture stays within the engine’s ${SVG_MAX_BYTES / 1024} KiB`, `${bytes} bytes`)
    check(w > 0 && h > 0 && w <= SVG_MAX_PX && h <= SVG_MAX_PX, `…and ${SVG_MAX_PX} px`, `${w}×${h}`)
    saveShot('desktop-big.svg', svg)
    const props = desk.props()
    const propsChars = JSON.stringify(props).length
    check(propsChars < 100_000, 'the layer’s props stay small', `${propsChars} chars`)
    const topics = props.nodes.filter(n => n.kind === 'topic' && n.id !== 'unsorted')
    const dots = props.nodes.filter(n => n.kind === 'session')
    check(topics.length >= 8, 'the folder splits into many topics, not one blob', `${topics.length} topics`)
    const largest = Math.max(...topics.map(t => dots.filter(d => d.topicId === t.id).length))
    check(largest <= Math.ceil(sessions.length * 0.25), 'no topic takes more than a quarter of the folder', `largest ${largest} of ${sessions.length}`)
    const impure = []
    for (const t of topics) {
      const members = dots.filter(d => d.topicId === t.id)
      if (members.length < 3) continue
      const counts = {}
      for (const d of members) counts[themeOf[d.id]] = (counts[themeOf[d.id]] ?? 0) + 1
      const share = Math.max(...Object.values(counts)) / members.length
      if (share < 0.75) impure.push(`${t.label}: ${JSON.stringify(counts)}`)
    }
    check(impure.length === 0, 'every topic of three or more is at least three quarters one theme', impure)
    const themed = dots.filter(d => !String(themeOf[d.id]).startsWith('one-off'))
    const placed = themed.filter(d => d.topicId !== 'unsorted').length / Math.max(1, themed.length)
    check(placed >= 0.7, 'most themed sessions find a topic', `${Math.round(placed * 100)}%`)
    const big = props.nodes.find(n => n.id === bigId)
    check(Boolean(big), 'the transcript over 4 MiB is on the map (read in slices through the shell)')
    check(/Stripe webhook retry storm/.test(`${big?.title ?? ''} ${big?.label ?? ''}`), '…under the title the engine gave it', big && { title: big.title, label: big.label })
    await desk.loadModule()
    desk.mount(140, rowsFor(140, props))
    const topic = topics[0]
    const sent = await desk.click(pointOn(topic).x, pointOn(topic).y)
    check(sent.some(d => d.type === 'pick' && d.id === topic.id), 'a click on a topic in the big map picks it', sent)
    check(desk.props().mode === 'focus', '…and focuses it')
    saveShot('desktop-big-focus.svg', svgOfTree(desk.tree))
    check(desk.faults.length === 0, 'the module never faulted', desk.faults)
  } catch (error) {
    check(false, 'the big folder run', String(error?.stack ?? error))
  } finally {
    await engine.close()
  }
}

// ---------------------------------------------------------------- 3. an empty folder

async function emptyFolderChecks() {
  console.log('== 3: a folder with no sessions')
  const { cfg, cwd } = seed([], 'new-app')
  const engine = new Engine({ cfg, cwd })
  const desk = new Desktop(engine)
  try {
    await engine.request({ subtype: 'initialize' }, 90_000)
    await desk.attach()
    const r = await desk.pane()
    check(Boolean(svgOfTree(r.tree)) && /no topics yet/i.test(svgOfTree(r.tree).props.alt), 'the pane draws an empty picture, said so in its alt text', svgOfTree(r.tree)?.props.alt)
    await desk.loadModule()
    desk.mount(120, rowsFor(120, desk.props()))
    const sent = await desk.click(430, 260)
    check(!sent.some(d => d.type === 'pick'), 'a click on the empty picture picks nothing', sent)
    check(desk.faults.length === 0, 'the module never faulted', desk.faults)
  } catch (error) {
    check(false, 'the empty folder run', String(error?.stack ?? error))
  } finally {
    await engine.close()
  }
}

// ---------------------------------------------------------------- 4. opening at start

async function openOnStartChecks(prev) {
  console.log('== 4: On session start: Pane, in a new Desktop session')
  for (const surface of ['desktop', 'vscode']) {
    const engine = new Engine(prev)
    const desk = new Desktop(engine, surface)
    try {
      await engine.request({ subtype: 'initialize' }, 90_000)
      const from = engine.events.length
      await desk.attach()
      const shown = await engine.waitFor(e => e.type === 'system' && e.subtype === 'ui_panes' && (e.panes ?? []).some(p => p.id === PANE || p === PANE), 15_000, from)
      check(Boolean(shown), `a new ${surface === 'desktop' ? 'Desktop' : 'VS Code'} session opens the map when its window attaches`, engine.events.filter(e => e.subtype === 'ui_panes').map(e => e.panes))
      if (surface === 'vscode') {
        const r = await desk.pane()
        check(!clientOf(r.tree) && Boolean(svgOfTree(r.tree)), 'VS Code draws the picture alone, with no pointer layer')
        check(findAll(r.tree, n => n.type === 'Button' && /^t:/.test(n.props?.key ?? '')).length > 0, '…and the topic buttons under it')
        check(/Tab onto a topic to trace it/.test(svgOfTree(r.tree).props.source), '…and a hint that says the buttons pick')
      }
    } catch (error) {
      check(false, `the ${surface} start run`, String(error?.stack ?? error))
    } finally {
      await engine.close()
    }
  }
  // Mobile, on the same folder: picture and buttons, and the tap hint.
  const engine = new Engine(prev)
  const desk = new Desktop(engine, 'mobile')
  try {
    await engine.request({ subtype: 'initialize' }, 90_000)
    await desk.attach()
    const r = await desk.pane()
    check(!clientOf(r.tree) && Boolean(svgOfTree(r.tree)) && /Tap a topic under the map to focus it/.test(svgOfTree(r.tree).props.source), 'mobile draws the picture with the tap hint, and no layer')
  } catch (error) {
    check(false, 'the mobile run', String(error?.stack ?? error))
  } finally {
    await engine.close()
  }
}

// ----------------------------------------------------------------

const prev = await fixtureFolderChecks()
await bigFolderChecks()
await emptyFolderChecks()
await openOnStartChecks(prev)
console.log(`== ${passed} passed, ${failed} failed`)
if (!failed && !process.env.E2E_KEEP) for (const t of temps) fs.rmSync(t, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
