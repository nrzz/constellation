import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import { backedOut } from '../hooks/actions'
import { INITIAL_UI } from '../hooks/state'
import { transcripts } from './fixtures/transcripts'
import { boxesOf, kids, pathOf } from './helpers'

const CWD = 'D:\\Projects\\web-app'
const SLUG = 'D--Projects-web-app'
const ROOT = '/home/n/.claude/projects'
const NOW = Date.parse('2026-10-20T10:00:00.000Z')
const ME = 'me-session-0001'
const IDS = {
  tests: '11111111-aaaa-4bbb-8ccc-000000000001',
  rounding: '44444444-aaaa-4bbb-8ccc-000000000004',
  orders: '22222222-aaaa-4bbb-8ccc-000000000002',
  empty: '33333333-aaaa-4bbb-8ccc-000000000003',
}
const FILES: Record<string, { key: string; mtime: string }> = {
  [IDS.tests]: { key: 'checkout-tests', mtime: '2026-10-20T09:05:00.000Z' },
  [IDS.rounding]: { key: 'checkout-rounding', mtime: '2026-10-18T15:04:00.000Z' },
  [IDS.orders]: { key: 'orders-pagination', mtime: '2026-10-19T14:03:00.000Z' },
  [IDS.empty]: { key: 'empty-queue', mtime: '2026-10-21T08:00:00.000Z' },
}
/** The auto topic of the two checkout fixtures: named after its earliest session. */
const CHECKOUT = `auto:${IDS.rounding}`

const PANE = {
  plugin: 'constellation',
  component: 'Pane',
  requestId: 'constellation',
  props: { title: 'Constellation', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const BAND = {
  plugin: 'constellation',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** A prompt typed at the composer, as the engine raises it. */
function submit($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** A slash command typed at the composer. */
function run($: Engine, command: string, args: string) {
  return $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
}

function entries(): FsEntry[] {
  const out: FsEntry[] = Object.entries(FILES).map(([id, f]) => ({
    name: `${id}.jsonl`,
    kind: 'file',
    size: (transcripts[f.key] ?? '').length,
    mtimeMs: Date.parse(f.mtime),
    isLink: false,
  }))
  out.push({ name: 'agent-55555555.jsonl', kind: 'file', size: 10, mtimeMs: 1, isLink: false })
  out.push({ name: IDS.tests, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
  return out
}

type Stubs = {
  clock: ReturnType<typeof mock.clock>
  modelCalls: number
  written: Record<string, string>
  toasts: string[]
  status: (string | undefined)[]
  filled: string[]
  sent: { to: unknown; text: string }[]
}

/** The engine beneath the plugin: the kit's clock, store and env, and a stub for every other call it makes. */
function stubEngine(on: On, options: { store?: Record<string, unknown>; now?: number } = {}): Stubs {
  const stubs: Stubs = { clock: mock.clock(on, { now: options.now ?? NOW }), modelCalls: 0, written: {}, toasts: [], status: [], filled: [], sent: [] }
  mock.store(on, options.store ?? {})
  mock.env(on, { CLAUDE_CONFIG_DIR: '/home/n/.claude' })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: ME }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    stubs.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    stubs.status.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.focus', () => ({}))
  on('tool.list', () => ({ value: [] }))
  on('fs.list', (_, e) => ({ value: pathOf(e.path) === `${ROOT}/${SLUG}` ? entries() : [] }))
  on('fs.read', (_, e) => {
    const id = (pathOf(e.path).split('/').pop() ?? '').replace(/\.jsonl$/, '')
    return { value: transcripts[FILES[id]?.key ?? ''] ?? '' }
  })
  on('fs.write', (_, e) => {
    stubs.written[pathOf(e.path)] = e.text
    return { value: undefined }
  })
  on('prompt.fill', (_, e) => {
    stubs.filled.push(e.text)
    return { isFilled: true }
  })
  on('session.send', (_, e) => {
    stubs.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'fix the flaky wait', toolUses: [] },
      { role: 'assistant', text: 'Replaced it with findByText.', toolUses: [] },
    ],
  }))
  on('model.complete', () => {
    stubs.modelCalls += 1
    return {
      value: {
        isAnswered: true,
        text: 'Replaced the fixed wait with findByText; the CI re-run is still pending.',
        usage: { input_tokens: 120, output_tokens: 18, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return stubs
}

test('session start scans the folder; the pane shows its topics on desktop (with the Svg) and terminal (with the text-mode map)', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key).join(' ')
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    expect(keys).toContain(`t:${CHECKOUT}`)
    expect(keys).toContain('t:unsorted')
    expect(texts).toContain('Continue a topic')
    const svg = await ui.find({ type: 'Svg' })
    if (surface === 'desktop') {
      const source = String(svg?.props.source)
      expect(source.startsWith('<svg')).toBe(true)
      expect(source).toContain('Checkout')
      expect(source).toContain('Unsorted')
      expect(source.length).toBeLessThan(131072)
    } else {
      expect(svg).toBeUndefined()
      expect(await ui.find({ type: 'Client', key: 'map' })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('the band offers the folder\u2019s topics; joining one puts its latest note and files beside the next prompt only', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Continue a topic/ })).toBeDefined()
  const chip = await band.find({ type: 'Button', key: `j:${CHECKOUT}` })
  expect(chip?.props.hotkey).toBe('1')
  await band.press({ key: `j:${CHECKOUT}` })
  await band.unmount()
  expect(stubs.toasts.some(t => t.startsWith('Joined') && t.includes('step 3'))).toBe(true)
  expect(stubs.status[stubs.status.length - 1]).toContain('step 3')

  const first = await submit($, 'carry on with the cart tests')
  const note = first.context?.[0] ?? ''
  expect(note).toContain('[Constellation] Handoff note')
  expect(note).toContain('Fix flaky cart wait')
  expect(note).toContain('Replaced the fixed 500 ms wait')
  expect(note).toContain('src/Cart.test.tsx')
  const second = await submit($, 'and then?')
  expect(second.context ?? []).toEqual([])

  const quiet = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await quiet.find({ type: 'Text', text: /Continue a topic/ })).toBeUndefined()
  expect((await quiet.find({ type: 'Text' }))?.text).toBe('engine')
  await quiet.unmount()
})

test('the first prompt marks the best topic as suggested; with auto-join on, a clear match joins at once', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const r = await submit($, 'the flaky cart wait in the checkout tests is back')
  expect(r.context ?? []).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /^suggested$/ })).toBeDefined()
  expect((await band.find({ type: 'Button', key: `j:${CHECKOUT}` }))?.props.plain).toBe(true)
  await band.unmount()
})

test('auto-join joins a clear match and injects on that same prompt', { options: { autoJoin: 'auto' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const r = await submit($, 'fix the flaky cart wait in the checkout tests')
  expect(r.context?.[0]).toContain('Handoff note')
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Joining focuses the topic, as the prototype does: this session is the chain's last step.
  expect((await pane.find({ type: 'Button', key: 's:you' }))?.props.hotkey).toBe('3')
  expect(String((await pane.find({ type: 'Svg' }))?.props.source)).toContain('· you')
  await pane.press({ key: 'back' })
  expect(await pane.find({ type: 'Text', text: /This session is step 3 of/ })).toBeDefined()
  await pane.unmount()
})

test('/topic creates and joins a topic, /park saves its note, and the joined card shows both', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const made = await run($, 'topic', 'Design tokens')
  expect(made.text).toContain('Design tokens')
  const parked = await run($, 'park', 'Colors moved to CSS variables; typography next.')
  expect(parked.text).toContain('Parked')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /This session is step 1 of Design tokens/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Your handoff note \(parked\): Colors moved/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 't:topic:design-tokens' })).toBeDefined()
  await pane.unmount()
  const listed = await run($, 'topic', '')
  expect(listed.text).toContain('This session is in Design tokens')
  expect(listed.text).toContain('Design tokens (0)')
})

test('/pickup n takes the note of step n of the joined topic; without n, the latest', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const none = await run($, 'pickup', '1')
  expect(none.text).toContain('has not joined a topic')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: `j:${CHECKOUT}` })
  await band.unmount()
  await submit($, 'start')
  const step1 = await run($, 'pickup', '1')
  expect(step1.text).toContain('Checkout total rounding')
  expect((await submit($, 'go')).context?.[0]).toContain('integer paise')
  const latest = await run($, 'pickup', '')
  expect(latest.text).toContain('Fix flaky cart wait')
  expect((await submit($, 'go on')).context?.[0]).toContain('findByText')
  const missing = await run($, 'pickup', '9')
  expect(missing.text).toContain('nothing at 9')
})

test('focus mode: steps with hotkeys, a session card, Pick up here joins and queues, Esc backs out a level at a time', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `t:${CHECKOUT}` })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  const step1 = await ui.find({ type: 'Button', key: `s:${IDS.rounding}` })
  const step2 = await ui.find({ type: 'Button', key: `s:${IDS.tests}` })
  expect(step1?.props.hotkey).toBe('1')
  expect(step2?.props.hotkey).toBe('2')
  expect(await ui.find({ type: 'Button', key: 's:you' })).toBeUndefined()
  let svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('‹ All topics')
  expect(svg).toContain('>2</text>')

  await ui.press({ key: `s:${IDS.tests}` })
  expect(await ui.find({ type: 'Text', text: /^Handoff note$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Replaced the fixed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ran 5m/ })).toBeDefined()
  await ui.press({ key: 'sc:pickup' })
  expect(stubs.toasts.some(t => t.includes('goes into your next prompt'))).toBe(true)
  expect(await ui.find({ type: 'Button', key: 's:you' })).toBeDefined()
  svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('This session · you')
  const r = await submit($, 'continue')
  expect(r.context?.[0]).toContain('Fix flaky cart wait')

  await ui.press({ key: 'sc:draft' })
  expect(stubs.filled[0]).toContain('Continue')
  expect(stubs.filled[0]).toContain('Fix flaky cart wait')

  // ‹ All topics goes straight back to every topic, the card with it; Esc (below) backs out one level at a time.
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  await ui.unmount()

  const selected = { ...INITIAL_UI, focusTopic: CHECKOUT, selected: IDS.tests }
  const once = backedOut(selected)
  expect(once?.selected).toBeNull()
  expect(once?.focusTopic).toBe(CHECKOUT)
  const twice = once ? backedOut(once) : null
  expect(twice?.focusTopic).toBeNull()
  expect(twice ? backedOut(twice) : undefined).toBeNull()
})

test('Tab onto a topic traces it: its card shows under the field', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.ui.focus({ component: 'Pane', requestId: 'constellation', element: `t:${CHECKOUT}`, origin: { kind: 'person' } })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No goal yet/ })).toBeDefined()
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('Enter to focus')
  await ui.unmount()
})

test('auto handoff notes: one haiku call two seconds after a main-loop turn, counted in settings; manual notes make none', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(stubs.modelCalls).toBe(0)
  await stubs.clock.advance(2000)
  expect(stubs.modelCalls).toBe(1)
  await $.turn.complete({ answer: 'subagent', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'agent-1' })
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 't3', reason: 'aborted' })
  await stubs.clock.advance(5000)
  expect(stubs.modelCalls).toBe(1)
  await run($, 'topic', 'Checkout tests')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /written after your last turn\): Replaced the fixed wait/ })).toBeDefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /1 haiku call · 120 in · 18 out/ })).toBeDefined()
  await ui.unmount()
})

test('manual notes never call the model; ask mode offers a band field after the turn', { options: { handoffNotes: 'ask' } }, async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await stubs.clock.advance(5000)
  expect(stubs.modelCalls).toBe(0)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Park a handoff note/ })).toBeDefined()
  await band.input({ key: 'park', text: 'Wait replaced; CI pending.' })
  expect(await band.find({ type: 'Text', text: /Park a handoff note/ })).toBeUndefined()
  await band.unmount()
  expect(stubs.status[stubs.status.length - 1]).toBeUndefined()
  await run($, 'topic', 'Checkout tests')
  expect(stubs.status[stubs.status.length - 1]).toContain('note saved')
})

test('a topic card renames, sets a goal that travels with the handoff, and the settings buttons save', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: 'tc:rename' })
  await ui.input({ key: 'rename', text: 'Checkout tests' })
  expect(await ui.find({ type: 'Text', text: /^Checkout tests$/ })).toBeDefined()
  expect(stubs.toasts.some(t => t.startsWith('Renamed'))).toBe(true)
  await ui.press({ key: 'tc:goal' })
  await ui.input({ key: 'goal', text: 'Make the checkout suite deterministic on CI' })
  expect(await ui.find({ type: 'Text', text: /Goal: Make the checkout suite/ })).toBeDefined()
  await ui.press({ key: 'tc:join' })
  const r = await submit($, 'next')
  expect(r.context?.[0]).toContain('Topic goal: Make the checkout suite deterministic on CI')
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'set:numbering:newestFirst' })
  expect((await boxesOf(ui, 'so:numbering:')).map(b => b.id)).toEqual(['newestFirst'])
  await ui.press({ key: 'settings' })
  expect((await ui.find({ type: 'Button', key: 's:you' }))?.props.hotkey).toBe('1')
  await ui.unmount()
})

test('renaming a topic to a name another topic has is refused with a toast: the list names it once', async ($, on) => {
  const stubs = stubEngine(on, { store: { topics: { 'topic:docs': { name: 'Docs', createdAt: 1 }, 'topic:api': { name: 'API', createdAt: 2 } } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 't:topic:docs' })
  await ui.press({ key: 'tc:rename' })
  // Another topic's name in other words order and case reads as the same name.
  await ui.input({ key: 'rename', text: 'api' })
  expect(stubs.toasts.some(t => t.startsWith('Renamed'))).toBe(false)
  expect(stubs.toasts[stubs.toasts.length - 1]).toBe('API is already the name of another topic.')
  const listed = (await run($, 'topic', '')).text ?? ''
  expect(listed.match(/ API \(/g)?.length).toBe(1)
  expect(listed).toContain(' Docs (0)')
  // Its own name in another case is still a rename (the card stays open after a refusal).
  await ui.press({ key: 'tc:rename' })
  await ui.input({ key: 'rename', text: 'DOCS' })
  expect(stubs.toasts[stubs.toasts.length - 1]).toBe('Renamed Docs to DOCS.')
  await ui.unmount()
})

test('/topic with a taken name in other words and case joins that topic: no second topic reads as the same name', async ($, on) => {
  const stubs = stubEngine(on, { store: { topics: { 'topic:cashfree-refund': { name: 'Cashfree Refund', createdAt: 1 } } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const joined = (await run($, 'topic', 'refund  CASHFREE')).text ?? ''
  expect(joined).toContain('This session is in the topic')
  expect(stubs.toasts.some(t => t.startsWith('Started the topic'))).toBe(false)
  const listed = (await run($, 'topic', '')).text ?? ''
  expect(listed).toContain('This session is in Cashfree Refund.')
  expect(listed).not.toMatch(/refund {1,2}cashfree/i)
  expect(listed.match(/ Cashfree Refund \(/g)?.length).toBe(1)
})

test('archive and move leave an Undo; merge folds one topic into another', async ($, on) => {
  const stubs = stubEngine(on, { store: { topics: { 'topic:docs': { name: 'Docs', createdAt: 1 } } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await ui.press({ key: 'sc:archive' })
  expect(await ui.find({ type: 'Text', text: /^archived$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'toast:undo' })).toBeDefined()
  await ui.press({ key: 'toast:undo' })
  expect(await ui.find({ type: 'Text', text: /^idle$/ })).toBeDefined()
  expect(stubs.toasts[stubs.toasts.length - 1]).toBe('Undone.')

  await ui.press({ key: 'sc:move' })
  expect(await ui.find({ type: 'Button', key: 'move:cancel' })).toBeDefined()
  await ui.press({ key: 't:topic:docs' })
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('Moved')
  // The count sits beside the name in the topic's chip, outside its Button.
  expect(kids((await boxesOf(ui, 'tb:')).find(c => c.id === 'topic:docs')?.box).some(k => k.type === 'Text' && k.text === '1')).toBe(true)

  await ui.press({ key: 't:topic:docs' })
  await ui.press({ key: 'tc:merge' })
  expect(await ui.find({ type: 'Button', key: 'merge:cancel' })).toBeDefined()
  await ui.press({ key: `t:${CHECKOUT}` })
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('Merged Docs into')
  expect(await ui.find({ type: 'Button', key: 't:topic:docs' })).toBeUndefined()
  expect(kids((await boxesOf(ui, 'tb:')).find(c => c.id === CHECKOUT)?.box).some(k => k.type === 'Text' && k.text === '2')).toBe(true)
  await ui.unmount()
})

test('/map opens the pane with a first-look digest and /map export writes a Markdown handover', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const opened = await run($, 'map', '')
  expect(opened.text).toContain('Constellation opened.')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /First look at web-app: 3 sessions across 1 topic/ })).toBeDefined()
  await ui.press({ key: 'digest:ok' })
  expect(await ui.find({ type: 'Text', text: /First look/ })).toBeUndefined()
  await ui.unmount()
  const exported = await run($, 'map', 'export notes/handover.md')
  expect(exported.text).toContain('Wrote notes/handover.md')
  const md = Object.entries(stubs.written).find(([path]) => path.endsWith('notes/handover.md'))?.[1] ?? ''
  expect(md).toContain('# Constellation map of web-app')
  expect(md).toContain('Fix flaky cart wait')
  expect(md).toContain('## Unsorted')
})

test('Message sends to the session and reports delivery', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await ui.press({ key: 'sc:message' })
  await ui.input({ key: 'msg', text: 'Is CI green yet?' })
  expect(stubs.sent).toEqual([{ to: IDS.tests, text: 'Is CI green yet?' }])
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('Message sent')
  await ui.unmount()
})
