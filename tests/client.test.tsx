import { expect, mock, test } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import { transcripts } from './fixtures/transcripts'

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

/** The same cell mapping client/map.js uses for a 100x24 region. */
const col = (x: number) => Math.max(0, Math.min(COLUMNS - 1, Math.round((x / 860) * (COLUMNS - 1))))
const row = (y: number) => Math.max(1, Math.min(ROWS - 2, Math.round((y / 520) * (ROWS - 3)) + 1))

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
      e.path === `${ROOT}/${SLUG}`
        ? Object.entries(FILES).map(([id, f]): FsEntry => ({ name: `${id}.jsonl`, kind: 'file', size: (transcripts[f.key] ?? '').length, mtimeMs: Date.parse(f.mtime), isLink: false }))
        : [],
  }))
  on('fs.read', (_, e) => {
    const id = (e.path.split('/').pop() ?? '').replace(/\.jsonl$/, '')
    return { value: transcripts[FILES[id]?.key ?? ''] ?? '' }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { toasts }
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
