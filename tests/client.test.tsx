import { expect, mock, test } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import MapModule, { layerFor, layoutText, nodeAtCell, nodeAtPoint, placeText, scaleFor, textOf } from '../client/map.js'
import { transcripts } from './fixtures/transcripts'
import { pathOf } from './helpers'

const CWD = 'D:\\Projects\\web-app'
const SLUG = 'D--Projects-web-app'
const ROOT = '/home/n/.claude/projects'
const NOW = Date.parse('2026-10-20T10:00:00.000Z')
const IDS = { tests: '11111111-aaaa-4bbb-8ccc-000000000001', rounding: '44444444-aaaa-4bbb-8ccc-000000000004', orders: '22222222-aaaa-4bbb-8ccc-000000000002' }
const FILES: Record<string, { key: string; mtime: string }> = {
  [IDS.tests]: { key: 'checkout-tests', mtime: '2026-10-20T09:05:00.000Z' },
  [IDS.rounding]: { key: 'checkout-rounding', mtime: '2026-10-18T15:04:00.000Z' },
  [IDS.orders]: { key: 'orders-pagination', mtime: '2026-10-19T14:03:00.000Z' },
}
const CHECKOUT = `auto:${IDS.rounding}`
const COLUMNS = 100
const ROWS = 24

const PANE = {
  plugin: 'constellation',
  component: 'Pane',
  requestId: 'constellation',
  surface: 'terminal',
  props: { title: 'Constellation', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type Node = { id: string; kind: string; x: number; y: number; label: string; topicId?: string }

/** A node's cell on the text map, by the module's own mapping over the props it was last handed (rows fit the nodes). */
async function at(ui: { find: (q: { type?: string; key?: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, n: Node, dx = 0): Promise<{ x: number; y: number }> {
  const field = await fieldOfMount(ui)
  const s = scaleFor(COLUMNS, ROWS, field)
  return { x: s.col(n.x) + dx, y: s.row(n.y) }
}
/** The pointer layer's mapping: the whole region is the picture. */
/** A cell of Claude Desktop's panes, measured on Windows: 7.7 × 19.8 px. */
const CELL = { w: 7.7, h: 19.8 }
/** The cell the Desktop hands the layer for a point of the picture: the picture spans the layer's columns, at the Desktop's cell size. */
function dcell(field: { fieldW?: number }, x: number, y: number, columns = COLUMNS): { x: number; y: number } {
  const pxPerUnit = (columns * CELL.w) / (field.fieldW ?? 860)
  return { x: Math.floor((x * pxPerUnit) / CELL.w), y: Math.floor((y * pxPerUnit) / CELL.h) }
}
type Mounted = { find: (q: { in?: string; type?: string; key?: string }) => Promise<{ props: Record<string, unknown> } | undefined>; resize: (r: { columns: number; rows: number; in: string }) => Promise<void> }
/** Sizes the layer as the Desktop does: its box's width, and the height of what it draws (it starts at one row). */
async function fitLikeDesktop(ui: Mounted, columns = COLUMNS): Promise<number> {
  let rows = 1
  await ui.resize({ columns, rows, in: 'map' })
  for (let i = 0; i < 4; i += 1) {
    const drawn = (await ui.find({ in: 'map', type: 'Box' }))?.props.height
    if (typeof drawn !== 'number' || drawn === rows) break
    rows = drawn
    await ui.resize({ columns, rows, in: 'map' })
  }
  return rows
}

function stubEngine(on: On): { toasts: string[] } {
  const toasts: string[] = []
  mock.clock(on, { now: NOW })
  mock.store(on, { topics: { 'topic:docs': { name: 'Docs', createdAt: 1 } } })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/home/n/.claude' })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'me-1' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.focus', () => ({}))
  on('tool.list', () => ({ value: [] }))
  on('fs.list', (_, e) => ({
    value:
      pathOf(e.path) === `${ROOT}/${SLUG}`
        ? Object.entries(FILES).map(([id, f]): FsEntry => ({ name: `${id}.jsonl`, kind: 'file', size: (transcripts[f.key] ?? '').length, mtimeMs: Date.parse(f.mtime), isLink: false }))
        : [],
  }))
  on('fs.read', (_, e) => {
    const id = (pathOf(e.path).split('/').pop() ?? '').replace(/\.jsonl$/, '')
    return { value: transcripts[FILES[id]?.key ?? ''] ?? '' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { toasts }
}

type Field = { nodes?: Node[]; fieldW?: number; fieldH?: number; hits?: boolean; outline?: boolean }

async function fieldOfMount(ui: { find: (q: { type?: string; key?: string }) => Promise<{ props: Record<string, unknown> } | undefined> }): Promise<Field> {
  const client = await ui.find({ type: 'Client', key: 'map' })
  return (client?.props.props as Field | undefined) ?? {}
}

async function nodesOf(ui: { find: (q: { type?: string; key?: string }) => Promise<{ props: Record<string, unknown> } | undefined> }): Promise<Node[]> {
  const client = await ui.find({ type: 'Client', key: 'map' })
  const props = client?.props.props as { nodes?: Node[] } | undefined
  return props?.nodes ?? []
}

test('the terminal pane draws the text-mode map with every topic and session', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  const nodes = await nodesOf(ui)
  expect(nodes.filter(n => n.kind === 'topic').map(n => n.id).sort()).toEqual([CHECKOUT, 'topic:docs', 'unsorted'].sort())
  expect(nodes.filter(n => n.kind === 'session').length).toBe(3)
  expect(await ui.find({ in: 'map', type: 'Text', text: /Checkout/ })).toBeDefined()
  expect(await ui.find({ in: 'map', type: 'Text', text: /Click or Tab to a topic/ })).toBeDefined()
  expect(await ui.find({ in: 'map', type: 'Text', text: /♦ you/ })).toBeDefined()
  await ui.unmount()
})

test('pointer hover traces a topic; a click on a session focuses its chain with that step selected', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  const topic = (await nodesOf(ui)).find(n => n.id === CHECKOUT)
  expect(topic).toBeDefined()
  if (!topic) return
  await ui.pointer({ type: 'move', ...(await at(ui, topic, 2)), in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeDefined()
  await ui.pointer({ type: 'move', x: 0, y: ROWS - 1, in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeUndefined()

  const session = (await nodesOf(ui)).find(n => n.id === IDS.tests)
  expect(session).toBeDefined()
  if (!session) return
  await ui.pointer({ type: 'down', ...(await at(ui, session)), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', ...(await at(ui, session)), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  expect((await nodesOf(ui)).some(n => n.kind === 'step')).toBe(true)
  await ui.unmount()
})

test('the map takes the pointer and never the keys: with no key listener a click cannot hold the keyboard, so every pane hotkey keeps working', async () => {
  const calls: string[] = []
  const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const surface = {
    elements: { Box: el('Box'), Text: el('Text') },
    state: undefined,
    columns: 100,
    rows: 24,
    setState: () => void calls.push('setState'),
    every: () => () => undefined,
    post: () => undefined,
    onPointer: () => (calls.push('onPointer'), () => undefined),
    onKey: () => (calls.push('onKey'), () => undefined),
  }
  for (const props of [
    { mode: 'map', hint: '', nodes: [], links: [], legend: '', fieldW: 860, fieldH: 520 },
    { mode: 'focus', hint: '', nodes: [], links: [], legend: '', fieldW: 860, fieldH: 520, hits: true },
  ]) {
    calls.length = 0
    MapModule(props, surface)
    expect(calls).toContain('onPointer')
    expect(calls).not.toContain('onKey')
  }
})

test('dragging a session onto another topic moves it, with Undo', async ($, on) => {
  const { toasts } = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  const nodes = await nodesOf(ui)
  const session = nodes.find(n => n.id === IDS.orders)
  const docs = nodes.find(n => n.id === 'topic:docs')
  expect(session).toBeDefined()
  expect(docs).toBeDefined()
  if (!session || !docs) return
  await ui.pointer({ type: 'down', ...(await at(ui, session)), button: 'left', in: 'map' })
  await ui.pointer({ type: 'move', ...(await at(ui, docs, 1)), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', ...(await at(ui, docs, 1)), button: 'left', in: 'map' })
  expect(toasts[toasts.length - 1]).toContain('Moved')
  expect((await nodesOf(ui)).find(n => n.id === IDS.orders)?.topicId).toBe('topic:docs')
  expect(await ui.find({ type: 'Button', key: 'toast:undo' })).toBeDefined()
  await ui.unmount()
})

test('a session dropped on Unsorted stays there (it is never clustered again), and Undo puts it back', async ($, on) => {
  const { toasts } = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  const nodes = await nodesOf(ui)
  const session = nodes.find(n => n.id === IDS.rounding)
  const unsorted = nodes.find(n => n.id === 'unsorted')
  expect(session?.topicId).toBe(CHECKOUT)
  expect(unsorted).toBeDefined()
  if (!session || !unsorted) return
  await ui.pointer({ type: 'down', ...(await at(ui, session)), button: 'left', in: 'map' })
  await ui.pointer({ type: 'move', ...(await at(ui, unsorted, 1)), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', ...(await at(ui, unsorted, 1)), button: 'left', in: 'map' })
  expect(toasts[toasts.length - 1]).toContain('to Unsorted')
  expect((await nodesOf(ui)).find(n => n.id === IDS.rounding)?.topicId).toBe('unsorted')
  // The topic it left is still there, with the other session, and no longer an auto topic that could take it back.
  expect((await nodesOf(ui)).find(n => n.id === IDS.tests)?.topicId).toBe(CHECKOUT)
  await ui.press({ key: 'toast:undo' })
  expect((await nodesOf(ui)).find(n => n.id === IDS.rounding)?.topicId).toBe(CHECKOUT)
  await ui.unmount()
})

test('in a chain a click on a step’s label, past its number, opens that session', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  const topic = (await nodesOf(ui)).find(n => n.id === CHECKOUT)
  expect(topic).toBeDefined()
  if (!topic) return
  await ui.pointer({ type: 'down', ...(await at(ui, topic, 2)), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', ...(await at(ui, topic, 2)), button: 'left', in: 'map' })
  const steps = (await nodesOf(ui)).filter(n => n.kind === 'step')
  expect(steps.length).toBe(2)
  const step = steps[0]
  if (!step) return
  // The label hangs right of the number: "1 Checkout total rounding". Four cells in is on the label, not the number.
  await ui.pointer({ type: 'down', ...(await at(ui, step, 4)), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', ...(await at(ui, step, 4)), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Checkout total rounding/ })).toBeDefined()
  // The card's own hotkey is there for the next key: the click on the map took none.
  expect((await ui.find({ type: 'Button', key: 'sc:pickup' }))?.props.hotkey).toBe('u')
  // The back pill draws its label once, not a chevron and then a label that starts with one.
  expect(await ui.find({ in: 'map', type: 'Text', text: /^‹ All topics$/ })).toBeDefined()
  expect(await ui.find({ in: 'map', type: 'Text', text: /^‹ ‹/ })).toBeUndefined()
  await ui.unmount()
})

test('the text map’s text, where it sits, and what a cell hits', async () => {
  const s = { columns: 40, rows: 12, col: (x: number) => Math.round((x / 860) * 39), row: (y: number) => Math.round((y / 520) * 9) + 1 }
  const back = { id: 'back', kind: 'back', x: 62, y: 27, label: '‹ All topics' }
  const step = { id: 's1', kind: 'step', x: 800, y: 260, label: 2, label2: 'Fix flaky cart wait' }
  const topic = { id: 't', kind: 'topic', x: 100, y: 400, label: 'Checkout Cart' }
  const dot = { id: 's2', kind: 'session', x: 400, y: 100, label: '' }
  expect(textOf(back)).toBe('‹ All topics')
  expect(textOf(step)).toBe('2 Fix flaky cart wait')
  expect(textOf(topic)).toBe('○ Checkout Cart')
  expect(textOf(dot)).toBe('○')
  // The glyph stays at its own cell; a label that would run past the right edge is cut there with an ellipsis.
  const placed = placeText(step, s)
  expect(placed.left).toBe(s.col(step.x))
  expect(placed.left + placed.text.length).toBeLessThanOrEqual(40)
  expect(placed.text.startsWith('2 ')).toBe(true)
  expect(placed.text.endsWith('…')).toBe(true)
  const room = placeText({ ...step, x: 100 }, s)
  expect(room.text).toBe('2 Fix flaky cart wait')
  // The hit test counts the drawn cells: the end of the cut label hits the step; the dot hits only near itself.
  expect(nodeAtCell([back, step, topic, dot], s, 39, placed.top, 'focus')?.id).toBe('s1')
  expect(nodeAtCell([back, step, topic, dot], s, s.col(topic.x) + 10, s.row(topic.y), 'map')?.id).toBe('t')
  expect(nodeAtCell([back, step, topic, dot], s, s.col(dot.x) + 6, s.row(dot.y), 'map')).toBeNull()
  expect(nodeAtCell([back, step, topic, dot], s, 3, s.row(back.y), 'focus')?.id).toBe('back')
  // Two steps on one row in a narrow region: the first one's long label runs under the third one's number, which is drawn
  // over it. A click on that number picks the third, as the eye sees it.
  const narrow = { columns: 72, rows: 26, col: (x: number) => Math.round((x / 860) * 71), row: (y: number) => Math.round((y / 520) * 23) + 1 }
  const first = { id: 's1', kind: 'step', x: 90, y: 250, label: 1, label2: 'Checkout total rounding of the cart' }
  const third = { id: 's3', kind: 'step', x: (23 / 71) * 860, y: 250, label: 3, label2: 'Fix flaky cart wait' }
  expect(placeText(first, narrow).left + placeText(first, narrow).text.length).toBeGreaterThan(narrow.col(third.x))
  expect(nodeAtCell([first, third], narrow, narrow.col(third.x), narrow.row(250), 'focus')?.id).toBe('s3')
  expect(nodeAtCell([first, third], narrow, narrow.col(first.x) + 3, narrow.row(250), 'focus')?.id).toBe('s1')
})

test('the text map cuts a label short of the next step on its row, lets a topic’s name draw over its satellites, and fits its rows to the nodes', async () => {
  const s = scaleFor(72, 26, { fieldW: 860, fieldH: 520, nodes: [] })
  const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ id: `s${i}`, kind: 'step', x: 90 + i * 85, y: i % 2 === 0 ? 250 : 342, label: i + 1, label2: 'A long step title that runs on' }))
  const laid = layoutText(steps, s, 'focus')
  const upper = steps.filter((_, i) => i % 2 === 0).map(n => laid.get(n))
  for (let i = 1; i < upper.length; i += 1) {
    const a = upper[i - 1]
    const b = upper[i]
    if (!a || !b) continue
    expect(a.left + a.text.length).toBeLessThan(b.left)
    expect(a.text.startsWith(String(steps[(i - 1) * 2]?.label))).toBe(true)
  }
  // A satellite under a topic's name does not cut it.
  const topic = { id: 't', kind: 'topic', x: 300, y: 200, label: 'Orders List 9', isMajor: true }
  const dot = { id: 'd', kind: 'session', x: 330, y: 200, label: '' }
  expect(layoutText([dot, topic], s, 'map').get(topic)?.text).toBe('● Orders List 9')
  // Rows fit the nodes: a tall field whose nodes sit between 300 and 700 uses the region's rows, not a band of them.
  const tall = scaleFor(100, 24, { fieldW: 860, fieldH: 1200, nodes: [{ y: 300 }, { y: 700 }] })
  expect(tall.row(300)).toBeLessThanOrEqual(3)
  expect(tall.row(700)).toBeGreaterThanOrEqual(20)
  // …but never zooms in past 20 field units a row: two topics close together keep their satellites near them.
  const few = scaleFor(100, 24, { fieldW: 860, fieldH: 520, nodes: [{ y: 240 }, { y: 260 }, { y: 210 }, { y: 290 }] })
  expect(Math.abs(few.row(290) - few.row(240))).toBeLessThanOrEqual(3)
})

test('the Desktop layer: it draws the picture’s own height from its width, maps the pointer by the cell’s shape, trusts a host that sizes it by its box, and lets a pill’s edge beat a satellite’s slack', async () => {
  const aspect = CELL.w / CELL.h
  // A tall map in a 39-column layer (the Windows report: 300 px wide, 860 × 1040 field): about 18 rows, not 6.
  const tall = layerFor(39, 6, { fieldW: 860, fieldH: 1040, hits: true })
  expect(tall.rows).toBe(Math.floor((39 * 1040 * aspect) / 860))
  expect(tall.rows).toBe(18)
  // Its pointer maps through the cell's shape, not the rows the host first reported: the cell a point is drawn in
  // maps back to within a cell of that point, at the top of the picture and at its bottom alike.
  for (const y of [40, 300, 700, 1000]) {
    const cell = dcell({ fieldW: 860 }, 430, y, 39)
    expect(Math.abs(tall.fieldY(cell) - y)).toBeLessThan((860 / (39 * CELL.w)) * CELL.h)
  }
  // The focused field (860 × 520) in the same layer: 9 rows.
  expect(layerFor(39, 18, { fieldW: 860, fieldH: 520, hits: true }).rows).toBe(9)
  // A host that sizes the layer by its box reports more rows than were drawn: its count is the measure then.
  const byBox = layerFor(39, 24, { fieldW: 860, fieldH: 1040, hits: true })
  expect(byBox.byBox).toBe(true)
  expect(byBox.fieldY({ x: 0, y: 12 })).toBe((12.5 / 24) * 1040)
  // Layer height +2 (a font with wider cells): the layer draws taller, and maps by the same shape.
  const wider = layerFor(39, 0, { fieldW: 860, fieldH: 1040, hits: true, cellAspect: aspect + 0.04 })
  expect(wider.rows).toBe(Math.floor((39 * 1040 * (aspect + 0.04)) / 860))
  expect(wider.rows).toBeGreaterThan(tall.rows)
  // A press on a pill's top edge, right under one of its satellites (29 units off its centre), is the pill's; a press
  // on the satellite's dot is the satellite's.
  const pill = { id: 't', kind: 'topic', x: 300, y: 300, w: 160, isMajor: true, label: 'Orders List 9' }
  const sat = { id: 's', kind: 'session', x: 300, y: 271, label: '', topicId: 't' }
  expect(nodeAtPoint([sat, pill], { x: 300, y: 284 })?.id).toBe('t')
  expect(nodeAtPoint([sat, pill], { x: 302, y: 273 })?.id).toBe('s')
  // Off the pill, the satellite's slack still helps a coarse cell reach it.
  expect(nodeAtPoint([sat, pill], { x: 300, y: 258 })?.id).toBe('s')
})

test('the Desktop pointer layer is on by default: a picture sized from the pane, a Client of the same size over it that draws nothing, traces on hover and picks on a click; a step and the back pill pick too', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  // An image, not a sandboxed frame: it takes the slot's width at its own aspect, with no pixel size to guess.
  expect(svg?.props.width).toBeUndefined()
  expect(svg?.props.height).toBeUndefined()
  expect(svg?.props.isInteractive).toBeUndefined()
  // The field box is the layer's frame of reference, and the layer is inset to its four edges.
  expect((await ui.find({ type: 'Box', key: 'field' }))?.props.position).toBe('relative')
  const layer = await ui.find({ type: 'Box', key: 'layer' })
  expect(layer?.props.position).toBe('absolute')
  expect([layer?.props.top, layer?.props.left, layer?.props.right, layer?.props.bottom]).toEqual([0, 0, 0, 0])
  const client = await ui.find({ type: 'Client', key: 'map' })
  expect(client).toBeDefined()
  expect(client?.props.width).toBe('100%')
  expect(client?.props.height).toBe('100%')
  expect(await ui.find({ in: 'map', type: 'Text' })).toBeUndefined()
  const field = await fieldOfMount(ui)
  // Sized as the Desktop sizes it, the layer settles at the picture's own height: 100 columns of 7.7 px over an
  // 860 × 520 field is a 770 × 466 px picture, 23 rows of 19.8 px.
  expect(await fitLikeDesktop(ui)).toBe(Math.floor((COLUMNS * (field.fieldH ?? 520) * (CELL.w / CELL.h)) / (field.fieldW ?? 860)))
  expect(field.hits).toBe(true)
  expect(field.outline).toBe(false)
  expect(field.fieldW).toBe(860)
  const topic = (field.nodes ?? []).find(n => n.id === CHECKOUT)
  expect(topic).toBeDefined()
  if (!topic) return
  await ui.pointer({ type: 'move', ...dcell(field, topic.x, topic.y), in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('Enter to focus')
  // Off the pill: the trace clears.
  await ui.pointer({ type: 'move', x: 0, y: dcell(field, topic.x, topic.y).y, in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeUndefined()
  await ui.pointer({ type: 'down', ...dcell(field, topic.x, topic.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', ...dcell(field, topic.x, topic.y), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  // In focus: a click on a step opens its card; a click on the back pill goes straight back to every topic.
  const focused = await fieldOfMount(ui)
  // The focused field is shorter: the layer redraws at its height, and the Desktop follows.
  expect(await fitLikeDesktop(ui)).toBe(Math.floor((COLUMNS * (focused.fieldH ?? 520) * (CELL.w / CELL.h)) / (focused.fieldW ?? 860)))
  const step = (focused.nodes ?? []).find(n => n.kind === 'step' && n.id === IDS.tests)
  const back = (focused.nodes ?? []).find(n => n.kind === 'back')
  expect(step).toBeDefined()
  expect(back).toBeDefined()
  if (!step || !back) return
  await ui.pointer({ type: 'down', ...dcell(focused, step.x, step.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', ...dcell(focused, step.x, step.y), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  await ui.pointer({ type: 'down', ...dcell(focused, back.x, back.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', ...dcell(focused, back.x, back.y), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()
  await ui.unmount()
})

test('the outline mode draws the layer’s edge and readings over the picture; off keeps only the picture and the buttons', { options: { pictureClicks: 'outline' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await fitLikeDesktop(ui)).toBe(23)
  expect((await fieldOfMount(ui)).outline).toBe(true)
  expect(await ui.find({ in: 'map', type: 'Text', text: /^layer 100×23 · field 860×520 · cell 0\.39 · no pointer yet$/ })).toBeDefined()
  expect(await ui.find({ in: 'map', type: 'Text', text: /should meet the picture’s bottom; if not, Settings › Advanced › Layer height/ })).toBeDefined()
  await ui.pointer({ type: 'move', x: 7, y: 3, in: 'map' })
  expect(await ui.find({ in: 'map', type: 'Text', text: /move at 7,3/ })).toBeDefined()
  expect(await ui.find({ in: 'map', type: 'Text', text: /^\+$/ })).toBeDefined()
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'set:advanced' })
  await ui.press({ key: 'set:pictureClicks:off' })
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Box', key: 'layer' })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  await ui.unmount()
})

test('VS Code and mobile draw the picture alone, as an image, with the buttons under it; a wide pane changes nothing', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'layer' })).toBeUndefined()
    const svg = await ui.find({ type: 'Svg' })
    expect(svg).toBeDefined()
    expect(svg?.props.width).toBeUndefined()
    expect(svg?.props.isInteractive).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
    await ui.unmount()
  }
  const wide = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 300 } })
  expect((await wide.find({ type: 'Client', key: 'map' }))?.props.width).toBe('100%')
  expect((await wide.find({ type: 'Svg' }))?.props.width).toBeUndefined()
  await wide.unmount()
})
