// Dev tooling only (Node): renders the map, a traced map and a focused chain
// for demo data shaped like the prototype's, as SVG files under tests/out/,
// plus a model.json, so the look can be compared with design/TopicMap.dc.html
// without a Desktop session. The mod's own modules are compiled with tsc into
// a temporary folder and imported from there; nothing of the engine is needed
// because draw/cluster/layout/scan only import types from 'claude-code'.
//
//   TSC=/path/to/node_modules/.bin/tsc node tests/preview/render.mjs
//   (without TSC it runs `npx -y typescript@5.9.3 tsc`)
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const outDir = join(repo, 'tests', 'out')
mkdirSync(outDir, { recursive: true })

const build = mkdtempSync(join(tmpdir(), 'constellation-preview-'))
const tsc = process.env.TSC ?? 'npx -y typescript@5.9.3 tsc'
const files = ['hooks/draw.tsx', 'hooks/cluster.ts', 'hooks/layout.ts', 'hooks/scan.ts', 'hooks/state.ts']
try {
  execSync(
    `${tsc} --target es2022 --module esnext --moduleResolution bundler --jsx react --jsxFactory h --jsxFragmentFactory Fragment --skipLibCheck --noResolve false --outDir ${JSON.stringify(build)} ${files.join(' ')}`,
    { cwd: repo, stdio: 'pipe' },
  )
} catch (error) {
  // Type errors about 'claude-code' are expected without the engine's types laid; tsc still emits.
  // tsc reports the missing 'claude-code' types and still emits; only a build with no output is fatal.
  if (!readdirSync(build).some(f => f.endsWith('.js'))) {
    console.error(String(error.stdout ?? error))
    process.exit(1)
  }
}
// tsc flattens the common `hooks/` root; Node's ESM loader wants explicit extensions on relative imports.
for (const name of readdirSync(build)) {
  if (!name.endsWith('.js')) continue
  const path = join(build, name)
  const src = readFileSync(path, 'utf8').replace(/from '(\.\.?\/[^']+)'/g, (m, p) => (p.endsWith('.js') ? m : `from '${p}.js'`))
  writeFileSync(path, src)
}

const draw = await import(pathToFileURL(join(build, 'draw.js')).href)
const cluster = await import(pathToFileURL(join(build, 'cluster.js')).href)
const layout = await import(pathToFileURL(join(build, 'layout.js')).href)
const state = await import(pathToFileURL(join(build, 'state.js')).href)

const NOW = Date.parse('2026-10-26T12:00:00.000Z')
const DAY = 24 * 3600 * 1000
const CWD = 'D:\\Projects\\web-app'

/** The prototype's data, as sessions a scan would produce plus the store a user would have built. */
const topics = [
  { id: 'topic:checkout-tests', name: 'Checkout tests', color: '#F2A33A', goal: 'Make the checkout suite fast and deterministic on CI', sessions: [
    { id: 's1', title: 'Fix flaky cart wait', age: 0.08, status: 'active', turns: 14, branch: 'main', note: 'Replaced the fixed 500 ms wait with findByText. Suite is green; still need to re-run on CI.', files: ['src/Cart.test.tsx', 'src/test-utils.ts'] },
    { id: 's2', title: 'Checkout total rounding', age: 1, status: 'idle', turns: 22, branch: 'fix/rounding', note: 'Totals now use integer paise. Two snapshot tests still fail on the discount line.', files: ['src/total.ts', 'src/Checkout.tsx'] },
    { id: 's3', title: 'Mock payment API', age: 3, status: 'idle', turns: 31, branch: 'test/mock-payments', note: 'MSW handlers cover success and timeout. Refund path is untested.', files: ['msw/handlers.ts', 'src/payments.ts'] },
    { id: 's4', title: 'Speed up test suite', age: 6, status: 'idle', turns: 9, branch: 'main', note: 'Parallel workers cut the run from 4m to 1m 40s. Nothing left to do.', files: ['vitest.config.ts'] },
    { id: 's5', title: 'Coupon edge cases', age: 12, status: 'archived', turns: 17, branch: 'fix/coupons', note: 'Archived after merge. Expired-coupon test added.', files: ['src/coupon.test.ts'] },
  ] },
  { id: 'topic:auth-refactor', name: 'Auth refactor', color: '#9B8CFF', sessions: [
    { id: 'a1', title: 'Tokens to httpOnly cookies', age: 2, status: 'idle', turns: 28, branch: 'feat/cookie-auth', note: 'Login and logout moved to cookies. Refresh flow still reads localStorage.', files: ['src/auth.ts', 'src/middleware.ts', 'src/Checkout.tsx'] },
    { id: 'a2', title: 'Refresh token race', age: 4, status: 'idle', turns: 12, branch: 'feat/cookie-auth', note: 'Two tabs refreshing at once invalidate each other. Mutex idea not tried yet.', files: ['src/refresh.ts'] },
    { id: 'a3', title: 'Session timeout UX', age: 9, status: 'archived', turns: 8, branch: 'main', note: 'Modal warns 60s before expiry. Shipped.', files: ['src/TimeoutModal.tsx'] },
  ] },
  { id: 'topic:orders-pagination', name: 'Orders pagination', color: '#5FD3A6', sessions: [
    { id: 'p1', title: 'Cursor pagination API', age: 1, status: 'idle', turns: 19, branch: 'feat/cursor-pages', note: 'Cursor endpoint done. Client still calls the old offset route.', files: ['src/orders.route.ts', '.github/ci.yml'] },
    { id: 'p2', title: 'Infinite scroll list', age: 5, status: 'idle', turns: 24, branch: 'feat/cursor-pages', note: 'IntersectionObserver loads the next page. Jumps on fast scroll.', files: ['src/OrdersList.tsx'] },
    { id: 'p3', title: 'Page size setting', age: 8, status: 'archived', turns: 6, branch: 'main', note: 'Setting saved per user. Shipped.', files: ['src/settings.ts'] },
    { id: 'p4', title: 'Empty state', age: 15, status: 'archived', turns: 5, branch: 'main', note: 'Empty and error states added. Shipped.', files: ['src/EmptyOrders.tsx'] },
  ] },
  { id: 'topic:ci-pipeline', name: 'CI pipeline', color: '#7FB8FF', sessions: [
    { id: 'c1', title: 'Cache node_modules', age: 7, status: 'idle', turns: 10, branch: 'ci/cache', note: 'Cache hits on main; misses on PR branches. Key needs the lockfile hash.', files: ['.github/ci.yml', 'vitest.config.ts'] },
    { id: 'c2', title: 'Parallel test shards', age: 11, status: 'archived', turns: 13, branch: 'main', note: 'Four shards. Shipped.', files: ['.github/ci.yml'] },
    { id: 'c3', title: 'Flaky lint step', age: 40, status: 'archived', turns: 4, branch: 'main', note: 'Pinned eslint version. Shipped.', files: ['package.json'] },
  ] },
  { id: 'topic:design-tokens', name: 'Design tokens', color: '#ED93B1', sessions: [
    { id: 'd1', title: 'Tailwind theme tokens', age: 3, status: 'idle', turns: 15, branch: 'chore/tokens', note: 'Colors and spacing moved to CSS variables. Typography next.', files: ['tailwind.config.ts', 'tokens.css', 'src/OrdersList.tsx'] },
    { id: 'd2', title: 'Dark mode contrast', age: 20, status: 'archived', turns: 11, branch: 'main', note: 'All text passes 4.5:1. Shipped.', files: ['tokens.css'] },
  ] },
  { id: 'topic:docs-site', name: 'Docs site', sessions: [{ id: 'o1', title: 'Docs search', age: 18, status: 'archived', turns: 7, branch: 'main', note: 'Shipped.', files: ['docs/search.ts'] }] },
  { id: 'topic:analytics-events', name: 'Analytics events', sessions: [{ id: 'n1', title: 'Checkout funnel events', age: 25, status: 'archived', turns: 9, branch: 'main', note: 'Shipped.', files: ['src/analytics.ts', 'src/Checkout.tsx'] }] },
  { id: 'topic:error-boundaries', name: 'Error boundaries', sessions: [{ id: 'e1', title: 'Route error boundary', age: 33, status: 'archived', turns: 6, branch: 'main', note: 'Shipped.', files: ['src/error.tsx'] }] },
]

const sessions = []
const store = { ...cluster.EMPTY_STORE, topics: {}, assign: {}, notes: {}, archived: {}, pins: { s2: true }, titles: {}, goals: {}, seen: {} }
topics.forEach((t, i) => {
  store.topics[t.id] = { name: t.name, createdAt: NOW - (60 - i) * DAY, ...(t.color ? { color: t.color } : {}) }
  if (t.goal) store.goals[t.id] = t.goal
  for (const s of t.sessions) {
    const lastAt = NOW - s.age * DAY
    sessions.push({ id: s.id, cwd: CWD, slug: 'D--Projects-web-app', branch: s.branch, firstPrompt: s.title.toLowerCase(), title: s.title, startedAt: lastAt - 2 * 3600 * 1000, lastAt, turns: s.turns, filesTouched: s.files, lastAssistantText: s.note, size: 1000, mtimeMs: s.status === 'active' ? NOW - 60_000 : lastAt })
    store.assign[s.id] = t.id
    store.notes[s.id] = { text: s.note, at: lastAt, source: 'auto' }
    if (s.status === 'archived') store.archived[s.id] = true
  }
})

const settings = { ...state.DEFAULT_SETTINGS }
const model = cluster.buildModel(sessions, store, settings, NOW, 'me')
const placed = {}
for (const p of layout.placeTopics(model.topics.map(t => ({ id: t.id, name: t.name, isMajor: t.isMajor })))) placed[p.id] = p
const me = { ...state.INITIAL_ME, sessionId: 'me', cwd: CWD, folder: 'web-app', topicId: null }
const base = { model, placed, ui: { ...state.INITIAL_UI }, me, settings, usage: state.INITIAL_USAGE, now: NOW, surface: 'desktop' }

const views = {
  map: base,
  traced: { ...base, ui: { ...base.ui, hover: 'topic:checkout-tests' } },
  focus: { ...base, me: { ...me, topicId: 'topic:checkout-tests' }, ui: { ...base.ui, focusTopic: 'topic:checkout-tests' } },
  selected: { ...base, me: { ...me, topicId: 'topic:checkout-tests' }, ui: { ...base.ui, focusTopic: 'topic:checkout-tests', selected: 's5' } },
  search: { ...base, ui: { ...base.ui, query: 'cursor' } },
}
const sizes = {}
for (const [name, view] of Object.entries(views)) {
  const svg = draw.svgOf(view)
  sizes[name] = svg.length
  writeFileSync(join(outDir, `${name}.svg`), svg)
}
writeFileSync(join(outDir, 'model.json'), JSON.stringify({ topics: model.topics.map(t => ({ id: t.id, name: t.name, color: t.color, isMajor: t.isMajor, sessions: t.sessions.length, placed: placed[t.id] })), links: model.links, sizes }, null, 2))
console.log(`wrote ${Object.keys(views).map(n => `${n}.svg (${sizes[n]} chars)`).join(', ')} and model.json to ${outDir}`)
