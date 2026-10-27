// What the review pass found and fixed: the shared store, the scan cache under a refusing store,
// one numbering for the chain, Undo per entry, the old caches, placed panes, the start-time pane
// across a resume, anchors under the pointer, a focus ring on a chip, and the chat row's hotkeys.
import { expect, test } from 'claude-code/testing'

import { READS_PER_PASS } from '../hooks/scan'
import { CHECKOUT, CWD, IDS, ME, NOW, bandOn, paneOn, run, stubEngine, submit, turn, userRow, assistantRow } from './helpers'
import type { FakeFile } from './helpers'

const ROW = {
  plugin: 'constellation',
  component: 'CommandOutput',
  requestId: 'msg-1',
  props: { command: 'map', args: 'here', text: 'Constellation map (as of now) · web-app · 1 topics · 3 sessions · 0 active', isErrored: false },
} as const

type Note = { text: string; at: number; source: string }

test('the store is shared: a note and a join written by another session since this one loaded the store survive this session’s writes', async ($, on) => {
  const live: Record<string, unknown> = {}
  const stubs = stubEngine(on, { liveStore: live })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  // Another session parks its note and joins a topic after this one bootstrapped.
  live.notes = { 'other-session': { text: 'theirs', at: 5, source: 'manual' } }
  live.assign = { 'other-session': 'topic:docs' }
  live.topics = { 'topic:docs': { name: 'Docs', createdAt: 1 } }
  await run($, 'park', 'mine')
  const notes = live.notes as Record<string, Note>
  expect(notes['other-session']?.text).toBe('theirs')
  expect(notes[ME]?.text).toBe('mine')
  await run($, 'topic', '1')
  const assign = live.assign as Record<string, string>
  expect(assign['other-session']).toBe('topic:docs')
  expect(assign[ME]).toBe(CHECKOUT)
  // The next rescan (three seconds after a turn) reads the other session's work in: its topic shows on the map.
  await turn($)
  await stubs.clock.advance(3000)
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', key: 't:topic:docs' })).toBeDefined()
  await ui.unmount()
})

test('a bounded scan builds on its own last pass even when the store refuses the cache: the next pass reads the rest, not the same forty again', async ($, on) => {
  const files: Record<string, FakeFile> = {}
  for (let i = 0; i < READS_PER_PASS + 15; i += 1) {
    const id = `bulk-${String(i).padStart(4, '0')}`
    const at = new Date(NOW - (i + 1) * 3600_000).toISOString()
    files[id] = { text: userRow(id, `u-${i}`, at, `bulk task number ${i} about widget ${i % 7}`), mtime: at }
  }
  const stubs = stubEngine(on, { files, failStore: true })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect(stubs.reads.length).toBe(READS_PER_PASS)
  await stubs.clock.advance(400)
  expect(stubs.reads.length).toBe(READS_PER_PASS + 15)
  await stubs.clock.advance(2000)
  expect(stubs.reads.length).toBe(READS_PER_PASS + 15)
})

test('under newestFirst the commands number the chain as the pane does, with this session as step 1', { options: { numbering: 'newestFirst' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('terminal'))
  await band.press({ key: `j:${CHECKOUT}` })
  await band.unmount()
  const listed = (await run($, 'pickup', 'list')).text ?? ''
  expect(listed).toContain('1. This session · you')
  expect(listed).toContain('2. Fix flaky cart wait')
  expect(listed).toContain('3. Checkout total rounding')
  expect((await run($, 'pickup', '1')).text).toContain('Step 1 is this session')
  expect((await run($, 'pickup', '2')).text).toContain('Fix flaky cart wait')
  expect((await submit($, 'go')).context?.[0]).toContain('step 2 of')
  const pane = await $.ui.mount(paneOn('desktop'))
  expect((await pane.find({ type: 'Button', key: 's:you' }))?.props.hotkey).toBe('1')
  expect((await pane.find({ type: 'Button', key: `s:${IDS.tests}` }))?.props.hotkey).toBe('2')
  await pane.unmount()
})

test('Undo reverses only what the undone action changed: a note written since stays', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await run($, 'topic', '1')
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: `s:${IDS.tests}` })
  await ui.press({ key: 'sc:archive' })
  expect(await ui.find({ type: 'Text', text: /^ARCHIVED$/ })).toBeDefined()
  // A turn completes and the auto note is written after the archive.
  await turn($)
  await stubs.clock.advance(2000)
  expect(stubs.status[stubs.status.length - 1]).toContain('note ✓')
  await ui.press({ key: 'toast:undo' })
  expect(await ui.find({ type: 'Text', text: /^IDLE$/ })).toBeDefined()
  expect(stubs.status[stubs.status.length - 1]).toContain('note ✓')
  await ui.unmount()
})

test('the previous build’s cache keys are cleared once at start, for every folder', async ($, on) => {
  const live: Record<string, unknown> = { 'cache:D--Projects-web-app': { x: 1 }, 'cache:other-folder': { y: 2 }, settings: { rangeDays: 14 } }
  stubEngine(on, { liveStore: live })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect(Object.keys(live).filter(k => k.startsWith('cache:'))).toEqual([])
  expect(live.settings).toEqual({ rangeDays: 14 })
  expect(Object.keys(live).some(k => k.startsWith('scan2:'))).toBe(true)
})

test('/map shows a pane the start left unplaced instead of closing it, and the last-look time moves only when the pane was placed', async ($, on) => {
  const stubs = stubEngine(on, { panes: [{ id: 'constellation', title: 'Constellation', isShown: false, isFocused: false, isPlaced: false }] })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  stubs.isPlaced = false
  const first = await run($, 'map', '')
  expect(first.text).toContain('not drawn')
  expect(stubs.opened).toBe(1)
  expect(stubs.closed).toBe(0)
  stubs.isPlaced = true
  await run($, 'map', '')
  expect(stubs.opened).toBe(2)
  const ui = await $.ui.mount(paneOn('desktop'))
  expect(await ui.find({ type: 'Text', text: /First look at web-app/ })).toBeDefined()
  await ui.unmount()
})

test('with openOnStart pane, a resume back to a session this process already opened for opens the pane again; a headless classic resume opens nothing', { options: { openOnStart: 'pane' } }, async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect(stubs.opened).toBe(1)
  stubs.sessionId = 'me-session-0002'
  await $.session.end({ reason: 'clear', sessionId: ME, resume: { id: ME } })
  await stubs.clock.advance(400)
  expect(stubs.opened).toBe(2)
  stubs.sessionId = ME
  await $.session.end({ reason: 'resume', sessionId: 'me-session-0002', resume: { id: 'me-session-0002' } })
  await stubs.clock.advance(400)
  expect(stubs.opened).toBe(3)
  // The same id again, through the classic hook: no second start, no second pane.
  await $.classic.SessionStart({ source: 'resume', cwd: CWD })
  expect(stubs.opened).toBe(3)
})

test('a headless start with openOnStart pane opens nothing, through classic.SessionStart either', { options: { openOnStart: 'pane' } }, async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
  await $.classic.SessionStart({ source: 'resume', cwd: CWD })
  stubs.sessionId = 'me-session-0002'
  await $.classic.SessionStart({ source: 'clear', cwd: CWD })
  expect(stubs.opened).toBe(0)
  expect((await run($, 'topic', '')).text).toContain('This session has no topic yet')
})

test('the pointer layer hit-tests a related anchor as the centred pill it is drawn as, and a focus ring on "+ New topic" dims nothing', async ($, on) => {
  const alpha = '88888888-aaaa-4bbb-8ccc-000000000008'
  const beta = '99999999-aaaa-4bbb-8ccc-000000000009'
  const edit = (id: string, uuid: string, at: string, file: string) => assistantRow(id, uuid, at, [{ type: 'text', text: 'Done.' }, { type: 'tool_use', id: `t-${uuid}`, name: 'Edit', input: { file_path: `D:\\Projects\\web-app\\src\\${file}` } }])
  const files: Record<string, FakeFile> = {
    [alpha]: { text: [userRow(alpha, 'ua', '2026-10-20T07:00:00.000Z', 'alpha work on the shared cache'), edit(alpha, 'aa', '2026-10-20T07:01:00.000Z', 'shared-cache.ts')].join('\n'), mtime: '2026-10-20T07:01:00.000Z' },
    [beta]: { text: [userRow(beta, 'ub', '2026-10-19T07:00:00.000Z', 'beta orders endpoint'), edit(beta, 'ab', '2026-10-19T07:01:00.000Z', 'shared-cache.ts')].join('\n'), mtime: '2026-10-19T07:01:00.000Z' },
  }
  const store = { topics: { 'topic:alpha': { name: 'Alpha', createdAt: 1 }, 'topic:beta': { name: 'Beta orders endpoint work', createdAt: 2 } }, assign: { [alpha]: 'topic:alpha', [beta]: 'topic:beta' } }
  stubEngine(on, { files, store })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.resize({ columns: 100, rows: 24, in: 'map' })
  await $.ui.focus({ component: 'Pane', requestId: 'constellation', element: 'j:new', origin: { kind: 'person' } })
  type Node = { id: string; kind: string; x: number; y: number; w?: number; isDim?: boolean; isAnchor?: boolean }
  const nodesOf = async () => (((await ui.find({ type: 'Client', key: 'map' }))?.props.props as { nodes?: Node[] } | undefined)?.nodes ?? [])
  expect((await nodesOf()).filter(n => n.kind === 'topic').every(n => n.isDim === false)).toBe(true)
  await ui.press({ key: 't:topic:alpha' })
  await ui.resize({ columns: 100, rows: 24, in: 'map' })
  const anchor = (await nodesOf()).find(n => n.id === 'topic:beta')
  expect(anchor?.isAnchor).toBe(true)
  if (!anchor) return
  // The left third of the pill, where a right-hanging label would not reach.
  const x = Math.floor(((anchor.x - (anchor.w ?? 120) / 3) / 860) * 100)
  const y = Math.floor((anchor.y / 520) * 24)
  await ui.pointer({ type: 'down', x, y, button: 'left', in: 'map' })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: 'map' })
  expect(await ui.find({ type: 'Button', key: `s:${beta}` })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `s:${alpha}` })).toBeUndefined()
  await ui.unmount()
})

test('the chat row offers no hotkeys, since no site holds the focus there; the pane keeps them', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await run($, 'topic', '1')
  const row = await $.ui.mount({ ...ROW, surface: 'terminal' })
  const rowKeys = (await row.findAll({ type: 'Button' })).map(b => b.props.hotkey).filter(k => k !== undefined)
  expect(rowKeys).toEqual([])
  // Joining focused the topic: the row shows the chain's steps and the topic card, all without hotkeys.
  expect(await row.find({ type: 'Button', key: 'tc:focus' })).toBeDefined()
  expect(await row.find({ type: 'Button', key: `s:${IDS.tests}` })).toBeDefined()
  await row.unmount()
  const pane = await $.ui.mount(paneOn('terminal'))
  expect((await pane.find({ type: 'Button', key: 'tc:focus' }))?.props.hotkey).toBe('f')
  expect((await pane.find({ type: 'Button', key: `s:${IDS.tests}` }))?.props.hotkey).toBe('2')
  await pane.unmount()
})
