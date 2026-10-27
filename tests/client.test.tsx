import { expect, mock, test } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

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

/** The same cell mapping client/map.js uses for the text map in a 100x24 region. */
const col = (x: number) => Math.max(0, Math.min(COLUMNS - 1, Math.round((x / 860) * (COLUMNS - 1))))
const row = (y: number) => Math.max(1, Math.min(ROWS - 2, Math.round((y / 520) * (ROWS - 3)) + 1))
/** The pointer layer's mapping: the whole region is the picture. */
const hcol = (x: number, fieldW = 860) => Math.max(0, Math.min(COLUMNS - 1, Math.floor((x / fieldW) * COLUMNS)))
const hrow = (y: number, fieldH = 520) => Math.max(0, Math.min(ROWS - 1, Math.floor((y / fieldH) * ROWS)))

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
  expect(await ui.find({ in: 'map', type: 'Text', text: /Hover or focus a topic/ })).toBeDefined()
  expect(await ui.find({ in: 'map', type: 'Text', text: /◆ you/ })).toBeDefined()
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
  await ui.pointer({ type: 'move', x: col(topic.x) + 2, y: row(topic.y), in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeDefined()
  await ui.pointer({ type: 'move', x: 0, y: ROWS - 1, in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeUndefined()

  const session = (await nodesOf(ui)).find(n => n.id === IDS.tests)
  expect(session).toBeDefined()
  if (!session) return
  await ui.pointer({ type: 'down', x: col(session.x), y: row(session.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', x: col(session.x), y: row(session.y), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  expect((await nodesOf(ui)).some(n => n.kind === 'step')).toBe(true)
  await ui.unmount()
})

test('arrow keys walk the topics and Enter focuses; in a chain they walk the steps', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  const topics = (await nodesOf(ui)).filter(n => n.kind === 'topic')
  await ui.key({ key: 'right', in: 'map' })
  const second = topics[1 % topics.length]
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeDefined()
  await ui.key({ key: 'return', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  if (second?.id === CHECKOUT) {
    await ui.key({ key: 'right', in: 'map' })
    expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  }
  await ui.key({ key: 'backspace', in: 'map' })
  await ui.key({ key: 'backspace', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()
  await ui.unmount()
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
  await ui.pointer({ type: 'down', x: col(session.x), y: row(session.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'move', x: col(docs.x) + 1, y: row(docs.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', x: col(docs.x) + 1, y: row(docs.y), button: 'left', in: 'map' })
  expect(toasts[toasts.length - 1]).toContain('Moved')
  expect((await nodesOf(ui)).find(n => n.id === IDS.orders)?.topicId).toBe('topic:docs')
  expect(await ui.find({ type: 'Button', key: 'toast:undo' })).toBeDefined()
  await ui.unmount()
})

test('the Desktop pointer layer is on by default: a picture sized from the pane, a Client of the same size over it that draws nothing, traces on hover and picks on a click; a step and the back pill pick too', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  // 120 columns at 7.2 px: the picture is the whole 860×520, 119×31 cells.
  expect(svg?.props.width).toBe(860)
  expect(svg?.props.height).toBe(520)
  const client = await ui.find({ type: 'Client', key: 'map' })
  expect(client).toBeDefined()
  expect(client?.props.width).toBe(119)
  expect(client?.props.height).toBe(31)
  expect(await ui.find({ in: 'map', type: 'Text' })).toBeUndefined()
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  const field = await fieldOfMount(ui)
  expect(field.hits).toBe(true)
  expect(field.outline).toBe(false)
  expect(field.fieldW).toBe(860)
  const fieldH = field.fieldH ?? 520
  const topic = (field.nodes ?? []).find(n => n.id === CHECKOUT)
  expect(topic).toBeDefined()
  if (!topic) return
  await ui.pointer({ type: 'move', x: hcol(topic.x), y: hrow(topic.y, fieldH), in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('Enter to focus')
  // Off the pill: the trace clears.
  await ui.pointer({ type: 'move', x: 0, y: hrow(topic.y, fieldH), in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeUndefined()
  await ui.pointer({ type: 'down', x: hcol(topic.x), y: hrow(topic.y, fieldH), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', x: hcol(topic.x), y: hrow(topic.y, fieldH), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  // In focus: a click on a step opens its card; a click on the back pill backs out.
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  const focused = await fieldOfMount(ui)
  const step = (focused.nodes ?? []).find(n => n.kind === 'step' && n.id === IDS.tests)
  const back = (focused.nodes ?? []).find(n => n.kind === 'back')
  expect(step).toBeDefined()
  expect(back).toBeDefined()
  if (!step || !back) return
  await ui.pointer({ type: 'down', x: hcol(step.x), y: hrow(step.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', x: hcol(step.x), y: hrow(step.y), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  await ui.pointer({ type: 'down', x: hcol(back.x), y: hrow(back.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', x: hcol(back.x), y: hrow(back.y), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeUndefined()
  await ui.pointer({ type: 'down', x: hcol(back.x), y: hrow(back.y), button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', x: hcol(back.x), y: hrow(back.y), button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()
  await ui.unmount()
})

test('the outline mode draws the layer’s edge and readings over the picture; off keeps only the picture and the buttons', { options: { pictureClicks: 'outline' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: COLUMNS, rows: ROWS, in: 'map' })
  expect((await fieldOfMount(ui)).outline).toBe(true)
  expect(await ui.find({ in: 'map', type: 'Text', text: /^layer 100×24 cells · field 860×520 · no pointer event yet$/ })).toBeDefined()
  await ui.pointer({ type: 'move', x: 7, y: 3, in: 'map' })
  expect(await ui.find({ in: 'map', type: 'Text', text: /move at 7,3/ })).toBeDefined()
  expect(await ui.find({ in: 'map', type: 'Text', text: /^\+$/ })).toBeDefined()
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'set:advanced' })
  await ui.press({ key: 'set:pictureClicks:off' })
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.find({ type: 'Svg' }))?.props.width).toBe(860)
  expect(await ui.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  await ui.unmount()
})

test('a narrow pane gets a smaller picture, and the cell size settings resize picture and layer together', { options: { cellWidthPx: 8, cellHeightPx: 20 } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 60 } })
  const svg = await ui.find({ type: 'Svg' })
  // 60 columns at 8 px: 480 wide, the height in proportion; 60×15 cells at 8 by 20 px.
  expect(svg?.props.width).toBe(480)
  expect(svg?.props.height).toBe(290)
  const client = await ui.find({ type: 'Client', key: 'map' })
  expect(client?.props.width).toBe(60)
  expect(client?.props.height).toBe(15)
  await ui.unmount()
  const vscode = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await vscode.find({ type: 'Client' })).toBeUndefined()
  expect((await vscode.find({ type: 'Svg' }))?.props.width).toBe(860)
  expect(await vscode.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  await vscode.unmount()
})
