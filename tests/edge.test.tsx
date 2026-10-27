import { expect, test } from 'claude-code/testing'

import { EMPTY_STORE, buildModel } from '../hooks/cluster'
import { fieldOf, svgOf } from '../hooks/draw'
import { placeTopics } from '../hooks/layout'
import { READS_PER_PASS } from '../hooks/scan'
import { DEFAULT_SETTINGS, INITIAL_ME, INITIAL_UI, INITIAL_USAGE, resolveSettings, settingValue } from '../hooks/state'
import type { SessionSummary } from '../types'
import { CHECKOUT, CWD, FIXTURE_FILES, IDS, ME, NOW, assistantRow, bandOn, paneOn, run, stubEngine, submit, turn, userRow } from './helpers'
import type { FakeFile } from './helpers'

const DAY = 24 * 3600 * 1000

test('an empty folder: the empty state on every surface, a chooser with only New topic, and /topic still works', async ($, on) => {
  stubEngine(on, { files: {} })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const desktop = await $.ui.mount(paneOn('desktop'))
  expect(String((await desktop.find({ type: 'Svg' }))?.props.source)).toContain('No sessions on this map yet')
  expect(await desktop.find({ type: 'Button', key: 'j:new' })).toBeDefined()
  expect((await desktop.findAll({ type: 'Button' })).some(b => b.key?.startsWith('j:') && b.key !== 'j:new')).toBe(false)
  await desktop.unmount()
  const terminal = await $.ui.mount(paneOn('terminal'))
  expect(await terminal.find({ type: 'Client', key: 'map' })).toBeDefined()
  expect(await terminal.find({ in: 'map', type: 'Text', text: /Hover or focus/ })).toBeDefined()
  await terminal.unmount()
  const band = await $.ui.mount(bandOn('terminal'))
  expect(await band.find({ type: 'Button', key: 'j:new' })).toBeDefined()
  await band.unmount()
  const made = await run($, 'topic', 'Fresh start')
  expect(made.text).toContain('Fresh start')
  const after = await $.ui.mount(paneOn('desktop'))
  expect(await after.find({ type: 'Text', text: /This session is step 1 of Fresh start/ })).toBeDefined()
  await after.unmount()
})

test('a transcript with CRLF endings, a hostile title and array-content user rows parses and is escaped in the Svg', async ($, on) => {
  const id = '66666666-aaaa-4bbb-8ccc-000000000006'
  const text = [
    userRow(id, 'u1', '2026-10-20T08:00:00.000Z', 'fix the <script>alert("x")</script> & "quotes" in the checkout cart tests'),
    assistantRow(id, 'a1', '2026-10-20T08:01:00.000Z', [{ type: 'text', text: 'Done <b>bold</b> & co.' }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'D:\\Projects\\web-app\\src\\Cart.test.tsx' } }]),
    userRow(id, 'u2', '2026-10-20T08:01:01.000Z', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    line({ type: 'summary', summary: 'Cart <tests> & "co"', leafUuid: 'a1' }),
  ].join('\r\n')
  stubEngine(on, { files: { ...FIXTURE_FILES, [id]: { text, mtime: '2026-10-20T08:01:00.000Z' } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).not.toContain('<script')
  expect(svg).not.toContain('<b>')
  expect(svg).toContain('&lt;tests&gt; &amp; &quot;co&quot;')
  await ui.press({ key: `t:${CHECKOUT}` })
  expect(await ui.find({ type: 'Button', key: `s:${id}` })).toBeDefined()
  await ui.press({ key: `s:${id}` })
  expect(await ui.find({ type: 'Text', text: /Done <b>bold<\/b> & co\./ })).toBeDefined()
  await ui.unmount()
})

function line(row: Record<string, unknown>): string {
  return JSON.stringify(row)
}

test('a transcript over 4 MiB is never read: it shows as a large stub with a badge', async ($, on) => {
  const id = '77777777-aaaa-4bbb-8ccc-000000000007'
  const stubs = stubEngine(on, { files: { ...FIXTURE_FILES, [id]: { text: '', size: 5 * 1024 * 1024, mtime: '2026-10-20T07:00:00.000Z' } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect(stubs.reads).not.toContain(id)
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: 't:unsorted' })
  await ui.press({ key: `s:${id}` })
  expect(await ui.find({ type: 'Text', text: /\(large transcript\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /LARGE TRANSCRIPT/ })).toBeDefined()
  await ui.unmount()
})

test('a big folder is read in bounded passes: the first scan reads 40 files, the rest follow on the clock', async ($, on) => {
  const files: Record<string, FakeFile> = {}
  for (let i = 0; i < READS_PER_PASS + 15; i += 1) {
    const id = `bulk-${String(i).padStart(4, '0')}`
    const at = new Date(NOW - (i + 1) * 3600_000).toISOString()
    files[id] = { text: userRow(id, `u-${i}`, at, `bulk task number ${i} about widget ${i % 7}`), mtime: at }
  }
  const stubs = stubEngine(on, { files })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect(stubs.reads.length).toBe(READS_PER_PASS)
  expect(stubs.reads[0]).toBe('bulk-0000')
  await stubs.clock.advance(400)
  expect(stubs.reads.length).toBe(READS_PER_PASS + 15)
  const ui = await $.ui.mount(paneOn('desktop'))
  expect(await ui.find({ type: 'Text', text: /55 sessions/ })).toBeDefined()
  await ui.unmount()
})

test('openOnStart: band shows the chooser, pane opens the pane, none shows nothing even after a suggestion, and a headless session opens nothing', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect(stubs.opened).toBe(0)
  const band = await $.ui.mount(bandOn('terminal'))
  expect(await band.find({ type: 'Text', text: /continuing which topic/ })).toBeDefined()
  await band.unmount()
})

test('openOnStart pane: the pane opens at start and the band stays quiet', { options: { openOnStart: 'pane' } }, async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect(stubs.opened).toBe(1)
  const band = await $.ui.mount(bandOn('terminal'))
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
  await submit($, 'the flaky cart wait in the checkout tests again')
  const later = await $.ui.mount(bandOn('terminal'))
  expect(await later.find({ type: 'Text', text: /SUGGESTED/ })).toBeDefined()
  await later.unmount()
})

test('openOnStart none: no band at start, none after a suggestion, nothing opened; the pane chooser still marks the suggestion', { options: { openOnStart: 'none' } }, async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect(stubs.opened).toBe(0)
  await submit($, 'the flaky cart wait in the checkout tests again')
  const band = await $.ui.mount(bandOn('terminal'))
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
  const pane = await $.ui.mount(paneOn('desktop'))
  expect(await pane.find({ type: 'Text', text: /SUGGESTED/ })).toBeDefined()
  await pane.unmount()
})

test('openOnStart pane in a headless session opens nothing', { options: { openOnStart: 'pane' } }, async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
  expect(stubs.opened).toBe(0)
})

test('/pickup with every step out of range says so; widening the range brings the chain back', async ($, on) => {
  stubEngine(on, { now: NOW + 60 * DAY })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await run($, 'topic', 'Checkout cart')
  const none = await run($, 'pickup', '1')
  expect(none.text).toContain('has 0 steps in range')
  const ui = await $.ui.mount(paneOn('desktop'))
  // Joining focuses the topic: the chain holds only this session.
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('0 of 2')
  expect(await ui.find({ type: 'Button', key: `s:${IDS.tests}` })).toBeUndefined()
  await ui.select({ key: 'range', value: '45' })
  expect((await ui.find({ type: 'Button', key: `s:${IDS.tests}` }))?.props.hotkey).toBe('2')
  expect((await ui.find({ type: 'Button', key: 's:you' }))?.props.hotkey).toBe('3')
  await ui.unmount()
  const latest = await run($, 'pickup', '')
  expect(latest.text).toContain('Fix flaky cart wait')
})

test('/topic clips a long name, joins an existing topic by name in any case, and /park needs words', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const long = 'x'.repeat(100)
  const made = await run($, 'topic', long)
  expect(made.text).toContain('This session is in the topic')
  const ui = await $.ui.mount(paneOn('desktop'))
  const title = (await ui.findAll({ type: 'Text' })).map(t => t.text).find(t => t.startsWith('This session is step 1 of'))
  expect(title?.length).toBeLessThan(100)
  expect(title?.endsWith('…')).toBe(true)
  await ui.unmount()
  const joined = await run($, 'topic', 'checkout CART')
  expect(joined.text).toContain('This session is in the topic')
  const listed = await run($, 'topic', '')
  expect(listed.text).toContain('This session is in Checkout Cart.')
  const empty = await run($, 'park', '   ')
  expect(empty.text).toContain('Usage: /park')
})

test('the band: Dismiss hides it for the session, New topic takes a name inline, and a joined session hides it', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('terminal'))
  await band.press({ key: 'j:dismiss' })
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
  await submit($, 'something unrelated to anything')
  const quiet = await $.ui.mount(bandOn('terminal'))
  expect((await quiet.find({ type: 'Text' }))?.text).toBe('engine')
  await quiet.unmount()
})

test('the band: New topic opens a name field, the name creates and joins the topic', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('terminal'))
  await band.press({ key: 'j:new' })
  expect(await band.find({ type: 'Input', key: 'topicname' })).toBeDefined()
  await band.press({ key: 'topicname:cancel' })
  expect(await band.find({ type: 'Button', key: 'j:new' })).toBeDefined()
  await band.press({ key: 'j:new' })
  await band.input({ key: 'topicname', text: 'Release notes' })
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
  const r = await submit($, 'write them')
  expect(r.context ?? []).toEqual([])
  const pane = await $.ui.mount(paneOn('terminal'))
  expect(await pane.find({ type: 'Text', text: /step 1 of Release notes/ })).toBeDefined()
  await pane.unmount()
})

test('no note is written for an aborted turn, an error turn, a subagent turn, an API error or an empty reply; spend is still counted', async ($, on) => {
  const stubs = stubEngine(on, { model: 'error' })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'e1', reason: 'error' })
  await stubs.clock.advance(3000)
  expect(stubs.modelCalls).toBe(0)
  await turn($)
  await stubs.clock.advance(3000)
  expect(stubs.modelCalls).toBe(1)
  await run($, 'topic', 'Checkout cart')
  const ui = await $.ui.mount(paneOn('terminal'))
  expect(await ui.find({ type: 'Text', text: /Your handoff note/ })).toBeUndefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /1 haiku call · 120 in · 18 out/ })).toBeDefined()
  await ui.unmount()
})

test('an empty model reply leaves no note either', async ($, on) => {
  const stubs = stubEngine(on, { model: 'empty' })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await turn($)
  await stubs.clock.advance(3000)
  expect(stubs.modelCalls).toBe(1)
  await run($, 'topic', 'Checkout cart')
  const ui = await $.ui.mount(paneOn('terminal'))
  expect(await ui.find({ type: 'Text', text: /Your handoff note/ })).toBeUndefined()
  await ui.unmount()
})

test('two quick turns make one note call: the debounce holds', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await turn($, 'first')
  await stubs.clock.advance(1000)
  await turn($, 'second')
  await stubs.clock.advance(1500)
  expect(stubs.modelCalls).toBe(0)
  await stubs.clock.advance(600)
  expect(stubs.modelCalls).toBe(1)
})

test('a dismissed Desktop archive question still archives on the map; a dismissed tidy question archives nothing', async ($, on) => {
  const stubs = stubEngine(on, { tools: ['mcp__ccd_session_mgmt__archive_session'], dismissAsks: true })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await ui.press({ key: 'sc:archive' })
  expect(await ui.find({ type: 'Text', text: /^ARCHIVED$/ })).toBeDefined()
  await ui.press({ key: 'toast:undo' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'tc:tidy' })
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('Nothing archived')
  expect(await ui.find({ type: 'Text', text: /2 sessions · 2 idle · 0 shipped/ })).toBeDefined()
  await ui.unmount()
})

test('moving a session onto its own topic changes nothing; merging a topic into itself is refused', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await ui.press({ key: 'sc:move' })
  await ui.press({ key: `t:${CHECKOUT}` })
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('is already in')
  expect(await ui.find({ type: 'Button', key: 'toast:undo' })).toBeUndefined()
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: 'tc:merge' })
  await ui.press({ key: `t:${CHECKOUT}` })
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('cannot merge into itself')
  expect(await ui.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  await ui.unmount()
})

test('a store that refuses writes: joining still works for the session, and the failure is swallowed', async ($, on) => {
  const stubs = stubEngine(on, { failStore: true })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('terminal'))
  await band.press({ key: `j:${CHECKOUT}` })
  await band.unmount()
  expect(stubs.toasts.some(t => t.startsWith('Joined'))).toBe(true)
  const r = await submit($, 'go')
  expect(r.context?.[0]).toContain('Handoff note')
})

test('an assignment to a topic with no record still draws, named from its sessions', async ($, on) => {
  stubEngine(on, { store: { assign: { [IDS.orders]: 'topic:ghost' } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  const ghost = await ui.find({ type: 'Button', key: 't:topic:ghost' })
  expect(ghost).toBeDefined()
  expect(ghost?.text).toContain('Cursor')
  await ui.unmount()
})

test('picking up an Unsorted session queues its note without joining anything', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: 't:unsorted' })
  await ui.press({ key: `s:${IDS.orders}` })
  await ui.press({ key: 'sc:pickup' })
  expect(stubs.status[stubs.status.length - 1]).toBeUndefined()
  await ui.unmount()
  const r = await submit($, 'continue the pagination')
  expect(r.context?.[0]).toContain('Cursor pagination API')
  const band = await $.ui.mount(bandOn('terminal'))
  expect(await band.find({ type: 'Text', text: /continuing which topic/ })).toBeDefined()
  await band.unmount()
})

test('every state of the pane draws unique Button keys and unique hotkeys, on desktop and terminal', async ($, on) => {
  stubEngine(on, { store: { topics: { 'topic:docs': { name: 'Docs', createdAt: 1 } } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(paneOn(surface))
    const check = async (state: string) => {
      const buttons = await ui.findAll({ type: 'Button' })
      const keys = buttons.map(b => b.key)
      const hotkeys = buttons.map(b => b.props.hotkey).filter((h): h is string => typeof h === 'string')
      expect(`${surface} ${state} keys: ${keys.filter((k, i) => keys.indexOf(k) !== i).join(',')}`).toBe(`${surface} ${state} keys: `)
      expect(`${surface} ${state} hotkeys: ${hotkeys.filter((k, i) => hotkeys.indexOf(k) !== i).join(',')}`).toBe(`${surface} ${state} hotkeys: `)
    }
    // The second surface starts where the first left off: back to the map, out of focus, still joined.
    await ui.press({ key: 'view:map' })
    while (await ui.find({ type: 'Button', key: 'back' })) await ui.press({ key: 'back' })
    await check('map')
    await ui.press({ key: 'settings' })
    await check('settings')
    await ui.press({ key: 'settings' })
    await ui.press({ key: `t:${CHECKOUT}` })
    await check('focus with topic card')
    await ui.press({ key: 'view:list' })
    await check('list with the topic open')
    await ui.press({ key: 'view:map' })
    await ui.press({ key: `s:${IDS.tests}` })
    await check('session card')
    await ui.press({ key: 'sc:pickup' })
    await check('session card, joined')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    await check('map, joined card')
    await ui.press({ key: 'view:list' })
    await ui.press({ key: `t:${CHECKOUT}` })
    await check('list, joined, topic open')
    await ui.unmount()
  }
})

test('mobile and vscode draw the pane: the Svg and the buttons, no fields on mobile', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const mobile = await $.ui.mount(paneOn('mobile'))
  expect(await mobile.find({ type: 'Svg' })).toBeDefined()
  expect(await mobile.find({ type: 'Input' })).toBeUndefined()
  await mobile.press({ key: `t:${CHECKOUT}` })
  expect(await mobile.find({ type: 'Button', key: 'tc:rename' })).toBeUndefined()
  await mobile.press({ key: `s:${IDS.tests}` })
  expect(await mobile.find({ type: 'Button', key: 'sc:message' })).toBeUndefined()
  expect(await mobile.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  await mobile.unmount()
  const vscode = await $.ui.mount(paneOn('vscode'))
  expect(await vscode.find({ type: 'Svg' })).toBeDefined()
  expect(await vscode.find({ type: 'Input', key: 'q' })).toBeDefined()
  await vscode.unmount()
  const band = await $.ui.mount(bandOn('mobile'))
  expect(await band.find({ type: 'Button', key: `j:${CHECKOUT}` })).toBeDefined()
  await band.unmount()
})

test('/clear starts over: a new session id, no topic, the chooser back, the status line cleared', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('terminal'))
  await band.press({ key: `j:${CHECKOUT}` })
  await band.unmount()
  expect(stubs.status[stubs.status.length - 1]).toContain('step 3')
  stubs.sessionId = 'me-session-0002'
  await $.classic.SessionStart({ source: 'clear', cwd: CWD })
  expect(stubs.status[stubs.status.length - 1]).toBeUndefined()
  const again = await $.ui.mount(bandOn('terminal'))
  expect(await again.find({ type: 'Text', text: /continuing which topic/ })).toBeDefined()
  await again.unmount()
  const r = await submit($, 'hello')
  expect(r.context ?? []).toEqual([])
})

test('a resumed session that had joined keeps its topic', async ($, on) => {
  stubEngine(on, { store: { assign: { [ME]: CHECKOUT } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('terminal'))
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
  const pane = await $.ui.mount(paneOn('desktop'))
  expect(await pane.find({ type: 'Text', text: /This session is step 3 of/ })).toBeDefined()
  await pane.unmount()
})

test('new session from here builds a claude:// link for the platform; an undelivered message and a refused draft say so', async ($, on) => {
  const stubs = stubEngine(on, { env: { OS: 'Windows_NT' }, delivered: false, filled: false })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await ui.press({ key: 'sc:new' })
  const argv = stubs.ran[0] ?? []
  expect(argv[0]).toBe('rundll32')
  expect(argv[2]?.startsWith(`claude://code/new?folder=${encodeURIComponent(CWD)}&q=`)).toBe(true)
  expect(decodeURIComponent(argv[2]?.split('&q=')[1] ?? '')).toContain('Fix flaky cart wait')
  await ui.press({ key: 'sc:message' })
  await ui.input({ key: 'msg', text: 'ping' })
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('Not delivered: not running')
  await ui.press({ key: 'sc:draft' })
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('no composer')
  await ui.unmount()
})

test('on Linux the link opens with xdg-open', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.rounding}` })
  await ui.press({ key: 'sc:new' })
  expect(stubs.ran[0]?.[0]).toBe('xdg-open')
  expect(stubs.toasts[stubs.toasts.length - 1]).toContain('Opening a new session')
  await ui.unmount()
})

test('search narrows the map and the list; the list view drops the Svg; the digest can be dismissed', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.input({ key: 'q', text: 'cursor', kind: 'change' })
  let svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('1 match')
  expect(svg).toContain('0 match')
  await ui.press({ key: 'view:list' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 't:unsorted' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeUndefined()
  await ui.input({ key: 'q', text: '', kind: 'change' })
  expect(await ui.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  await ui.press({ key: 'view:map' })
  svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).not.toContain('match')
  await ui.unmount()
})

test('/map toggles: open when closed, closed when open, settings view on request', async ($, on) => {
  const stubs = stubEngine(on, { panes: [{ id: 'constellation', title: 'Constellation', isShown: true, isFocused: false, isPlaced: true }] })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const closed = await run($, 'map', '')
  expect(closed.text).toBe('Constellation closed.')
  expect(stubs.closed).toBe(1)
  const settings = await run($, 'map', 'settings')
  expect(settings.text).toContain('Constellation opened.')
  expect(stubs.opened).toBe(1)
  const ui = await $.ui.mount(paneOn('desktop'))
  expect(await ui.find({ type: 'Button', key: 'settings:done' })).toBeDefined()
  await ui.unmount()
  const closeAgain = await run($, 'map', 'close')
  expect(closeAgain.text).toBe('Constellation closed.')
  expect(stubs.closed).toBe(2)
})

test('settings values are coerced and bounded; a value outside the options is ignored', async () => {
  expect(settingValue('rangeDays', '14')).toBe(14)
  expect(settingValue('rangeDays', 99)).toBe(45)
  expect(settingValue('rangeDays', 'soon')).toBeUndefined()
  expect(settingValue('showRelated', 'false')).toBe(false)
  expect(settingValue('autoJoin', 'always')).toBeUndefined()
  const s = resolveSettings({ rangeDays: '7', autoJoin: 'off', openOnStart: 'elsewhere' }, { majorMinSessions: 2, handoffNotes: 'manual' })
  expect(s.rangeDays).toBe(7)
  expect(s.autoJoin).toBe('off')
  expect(s.openOnStart).toBe('band')
  expect(s.majorMinSessions).toBe(2)
  expect(s.handoffNotes).toBe('manual')
})

test('four hundred sessions in forty topics stay under the Svg cap and the Client props bound', async () => {
  const sessions: SessionSummary[] = []
  const store = { ...EMPTY_STORE, topics: {} as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string> }
  for (let t = 0; t < 40; t += 1) {
    const topicId = `topic:t${t}`
    store.topics[topicId] = { name: `Topic number ${t} with a long name`, createdAt: t }
    for (let k = 0; k < 10; k += 1) {
      const id = `s-${t}-${k}`
      const lastAt = NOW - (t * 10 + k) * 3600_000
      sessions.push({ id, cwd: CWD, slug: 'x', branch: `feat/${t}`, firstPrompt: `work item ${k} for topic ${t}`, title: `Work item ${k} for topic ${t}, with a long title to render`, startedAt: lastAt - 3600_000, lastAt, turns: k, filesTouched: [`src/t${t}/file${k}.ts`], lastAssistantText: 'done '.repeat(40), size: 1, mtimeMs: lastAt })
      store.assign[id] = topicId
    }
  }
  const model = buildModel(sessions, store, DEFAULT_SETTINGS, NOW, 'me')
  expect(model.topics.length).toBe(40)
  const placed: Record<string, ReturnType<typeof placeTopics>[number]> = {}
  for (const p of placeTopics(model.topics.map(t => ({ id: t.id, name: t.name, isMajor: t.isMajor })))) placed[p.id] = p
  const view = { model, placed, ui: INITIAL_UI, me: { ...INITIAL_ME, sessionId: 'me' }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
  const svg = svgOf(view)
  expect(svg.length).toBeLessThanOrEqual(131072)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect(svg).toContain('Topic number 0')
  const field = fieldOf(view)
  expect(JSON.stringify(field).length).toBeLessThan(100000)
  const focused = svgOf({ ...view, ui: { ...INITIAL_UI, focusTopic: 'topic:t0' } })
  expect(focused.length).toBeLessThanOrEqual(131072)
  expect(focused).toContain('>10</text>')
})

const ROW = {
  plugin: 'constellation',
  component: 'CommandOutput',
  requestId: 'msg-1',
  props: { command: 'map', args: 'here', text: 'Constellation map (as of now). /map opens the live pane.', isErrored: false },
} as const

test('/map here prints the field as a row in the main chat: Svg and buttons on desktop, the outline on the terminal, plain text for other args', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const printed = await run($, 'map', 'here')
  expect(printed.text).toContain('Constellation map')
  expect(stubs.opened).toBe(0)
  const row = await $.ui.mount({ ...ROW, surface: 'desktop' })
  expect(await row.find({ type: 'Svg' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /opens the live pane/ })).toBeDefined()
  expect(await row.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  expect(await row.find({ type: 'Button', key: `j:${CHECKOUT}` })).toBeDefined()
  await row.press({ key: `t:${CHECKOUT}` })
  expect(await row.find({ type: 'Button', key: 'back' })).toBeDefined()
  await row.unmount()
  const terminal = await $.ui.mount({ ...ROW, surface: 'terminal' })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Client' })).toBeUndefined()
  expect(await terminal.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  await terminal.unmount()
  const plain = await $.ui.mount({ ...ROW, surface: 'desktop', props: { ...ROW.props, args: '' } })
  expect((await plain.find({ type: 'Text' }))?.text).toBe('engine')
  await plain.unmount()
})

test('the start band has an Open map button that opens the pane', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('terminal'))
  expect((await band.find({ type: 'Button', key: 'j:map' }))?.props.hotkey).toBe('o')
  await band.press({ key: 'j:map' })
  expect(stubs.opened).toBe(1)
  await band.unmount()
})

test('the field is transparent and theme-aware by default; the night setting paints the solid ground', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  let svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).not.toContain('fill="#0B0E13"')
  expect(svg).toContain('prefers-color-scheme:light')
  expect(svg).toContain('url(#glow)')
  expect(svg).toContain('style="fill:var(--tx)"')
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'set:fieldBackground:night' })
  await ui.press({ key: 'settings' })
  svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('fill="#0B0E13"')
  expect(svg).not.toContain('prefers-color-scheme')
  await ui.unmount()
})
