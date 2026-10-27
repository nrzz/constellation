import { expect, test } from 'claude-code/testing'

import { EMPTY_STORE, buildModel } from '../hooks/cluster'
import { clipName, fieldOf, sizeOf, svgOf } from '../hooks/draw'
import { placementOf } from '../hooks/actions'
import { DESKTOP_CELL, chainPositions, fieldWidthFor, pillWidth } from '../hooks/layout'
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
  expect(await terminal.find({ in: 'map', type: 'Text', text: /Click or Tab to a topic/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^large transcript$/ })).toBeDefined()
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
  expect(await band.find({ type: 'Text', text: /Continue a topic/ })).toBeDefined()
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
  expect(await later.find({ type: 'Text', text: /^suggested$/ })).toBeDefined()
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
  expect(await pane.find({ type: 'Text', text: /^suggested$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^archived$/ })).toBeDefined()
  await ui.press({ key: 'toast:undo' })
  await ui.press({ key: 'back' })
  await ui.press({ key: `t:${CHECKOUT}` })
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
  expect(await band.find({ type: 'Text', text: /Continue a topic/ })).toBeDefined()
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
    await ui.press({ key: 'set:advanced' })
    await check('settings, advanced')
    await ui.press({ key: 'set:advanced' })
    await ui.press({ key: 'settings' })
    await ui.press({ key: 'help' })
    await check('help')
    await ui.press({ key: 'help:done' })
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
  expect(await again.find({ type: 'Text', text: /Continue a topic/ })).toBeDefined()
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
  const placement = placementOf(model, null)
  expect(placement.size.h).toBeGreaterThan(520)
  const view = { model, placed: placement.placed, field: placement.size, ui: INITIAL_UI, me: { ...INITIAL_ME, sessionId: 'me' }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
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

/** A desktop view of `topics` topics with `each` recent sessions apiece. */
function crowdedView(topics: number, each: number) {
  const sessions: SessionSummary[] = []
  const store = { ...EMPTY_STORE, topics: {} as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string> }
  for (let t = 0; t < topics; t += 1) {
    const topicId = `topic:c${t}`
    store.topics[topicId] = { name: `Crowded topic ${t} with a long name`, createdAt: t }
    for (let k = 0; k < each; k += 1) {
      const id = `c-${t}-${k}`
      const lastAt = NOW - (t * each + k) * 60_000
      sessions.push({ id, cwd: CWD, slug: 'x', branch: `feat/${t}`, firstPrompt: `item ${k} of ${t}`, title: `Item ${k} of crowded topic ${t}, a long title`, startedAt: lastAt - 3600_000, lastAt, turns: k, filesTouched: [`src/c${t}/f${k}.ts`], lastAssistantText: 'done', size: 1, mtimeMs: lastAt })
      store.assign[id] = topicId
    }
  }
  const model = buildModel(sessions, store, DEFAULT_SETTINGS, NOW, 'me')
  const placement = placementOf(model, null)
  return { model, placed: placement.placed, field: placement.size, ui: INITIAL_UI, me: { ...INITIAL_ME, sessionId: 'me' }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' as const }
}

test('the click layer holds only the satellites the picture drew, and nothing over the too-many-topics placeholder', async () => {
  const shed = crowdedView(70, 6)
  const svg = svgOf(shed)
  const drawn = svg.split('class="sat"').length - 1
  // Seventy topics shed to two satellites apiece of the three the budget offers: the layer must shed the same.
  expect(drawn).toBe(70 * 2)
  expect(fieldOf(shed).nodes.filter(n => n.kind === 'session').length).toBe(drawn)
  // Sixty and forty topics keep what the budget offers (four and six apiece), and the layer the same.
  const sixty = crowdedView(60, 6)
  expect(svgOf(sixty).split('class="sat"').length - 1).toBe(60 * 4)
  expect(fieldOf(sixty).nodes.filter(n => n.kind === 'session').length).toBe(60 * 4)
  const part = crowdedView(40, 10)
  const partDrawn = svgOf(part).split('class="sat"').length - 1
  expect(partDrawn).toBe(40 * 6)
  expect(fieldOf(part).nodes.filter(n => n.kind === 'session').length).toBe(partDrawn)
  const placeholder = crowdedView(200, 3)
  expect(svgOf(placeholder)).toContain('Too many topics to draw at once')
  expect(fieldOf(placeholder).nodes).toEqual([])
  expect(fieldOf(placeholder).links).toEqual([])
})

const ROW = {
  plugin: 'constellation',
  component: 'CommandOutput',
  requestId: 'msg-1',
  props: { command: 'map', args: 'here', text: 'Constellation map (as of now) · web-app · 1 topics · 3 sessions · 0 active', isErrored: false },
} as const

test('/map here prints the field as a row in the main chat: Svg and buttons on desktop, the outline on the terminal, plain text for other args', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const printed = await run($, 'map', 'here')
  expect(printed.text).toContain('Constellation map (as of now) · web-app · 1 topics · 3 sessions · 0 active')
  expect(printed.text).toContain('1. Checkout Cart (2) · latest: Fix flaky cart wait · 55m ago')
  expect(printed.text).toContain('Unsorted (1) · latest: Cursor pagination API')
  expect(printed.text).toContain('/map <n> opens it on a topic')
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
  // A surface that passes no arguments: the row is still known by its text; another text is left to the engine.
  const noArgs = await $.ui.mount({ ...ROW, surface: 'terminal', props: { ...ROW.props, args: '' } })
  expect(await noArgs.find({ type: 'Button', key: `t:${CHECKOUT}` })).toBeDefined()
  await noArgs.unmount()
  const plain = await $.ui.mount({ ...ROW, surface: 'desktop', props: { ...ROW.props, args: '', text: 'Constellation closed.' } })
  expect((await plain.find({ type: 'Text' }))?.text).toBe('engine')
  await plain.unmount()
})

test('the /map here row narrows to the transcript width the engine reports and keeps 860 otherwise (K4)', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const widths: Record<string, string> = {}
  for (const [label, viewport] of [['none', undefined], ['40', { columns: 40, rows: 30 }], ['120', { columns: 120, rows: 30 }]] as const) {
    const row = await $.ui.mount({ ...ROW, surface: 'desktop', ...(viewport ? { viewport } : {}) })
    widths[label] = /viewBox="0 0 (\d+) /.exec(String((await row.find({ type: 'Svg' }))?.props.source))?.[1] ?? '?'
    await row.unmount()
  }
  expect(widths).toEqual({ none: '860', '40': '520', '120': '860' })
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

/** A folder whose focused topic shares a file with each of `n` other topics, all named at length. */
function linkedFolder(n: number) {
  const sessions: SessionSummary[] = []
  const store = { ...EMPTY_STORE, topics: {} as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string> }
  const add = (id: string, topicId: string, files: string[], hours: number) => {
    const lastAt = NOW - hours * 3600_000
    sessions.push({ id, cwd: CWD, slug: 'x', branch: 'main', firstPrompt: id, title: `Session ${id}`, startedAt: lastAt - 3600_000, lastAt, turns: 3, filesTouched: files, lastAssistantText: '', size: 1, mtimeMs: lastAt })
    store.assign[id] = topicId
  }
  store.topics['topic:hub'] = { name: 'Hub topic', createdAt: 0 }
  add('hub-1', 'topic:hub', Array.from({ length: n }, (_, i) => `src/shared/a-rather-long-module-name-${i}.ts`), 1)
  add('hub-2', 'topic:hub', [], 2)
  for (let i = 0; i < n; i += 1) {
    store.topics[`topic:r${i}`] = { name: `Related topic number ${i} with a long name`, createdAt: i + 1 }
    add(`r${i}-1`, `topic:r${i}`, [`src/shared/a-rather-long-module-name-${i}.ts`], 3 + i)
  }
  const model = buildModel(sessions, store, DEFAULT_SETTINGS, NOW, 'me')
  return model
}

test('related anchors fit the field: as many as its width holds, none overlapping, none off the edge, the picture and the layer alike', async () => {
  for (const [n, columns, shown] of [[2, undefined, 2], [4, undefined, 4], [8, undefined, 5], [8, 44, 3]] as const) {
    const model = linkedFolder(n)
    const placement = placementOf(model, null, fieldWidthFor(columns))
    const view = { model, placed: placement.placed, field: placement.size, ui: { ...INITIAL_UI, focusTopic: 'topic:hub' }, me: { ...INITIAL_ME, sessionId: 'me' }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
    const anchors = fieldOf(view).nodes.filter(a => a.isAnchor)
    expect(`${n} related at ${columns ?? 'full'} width: ${anchors.length} shown`).toBe(`${n} related at ${columns ?? 'full'} width: ${shown} shown`)
    const w = placement.size.w
    const boxes = anchors.map(a => ({ left: a.x - (a.w ?? 0) / 2, right: a.x + (a.w ?? 0) / 2 })).sort((a, b) => a.left - b.left)
    for (const b of boxes) {
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.right).toBeLessThanOrEqual(w)
    }
    for (let i = 1; i < boxes.length; i += 1) expect((boxes[i]?.left ?? 0) - (boxes[i - 1]?.right ?? 0)).toBeGreaterThanOrEqual(8)
    // The picture draws the same pills, at the same places.
    const svg = svgOf(view)
    for (const a of anchors) expect(svg).toContain(`x="${(a.x - (a.w ?? 0) / 2).toFixed(1)}"`)
  }
})

test('a narrow pane lays the field out narrower so its text stays legible; a wide one, the terminal and the transcript row keep 860', async () => {
  expect(fieldWidthFor(undefined)).toBe(860)
  expect(fieldWidthFor(44)).toBe(520)
  expect(fieldWidthFor(60)).toBe(620)
  expect(fieldWidthFor(83)).toBe(860)
  expect(fieldWidthFor(200)).toBe(860)
  // The Windows report's pane: about 300 px of picture for a 520-unit field draws 13-unit names at 7.5 px, not 4.5.
  const pictureW = 44 * DESKTOP_CELL.w - 40
  expect((13 * pictureW) / fieldWidthFor(44)).toBeGreaterThan(7)
  expect((13 * pictureW) / 860).toBeLessThan(5)
  const model = linkedFolder(6)
  const narrow = placementOf(model, null, fieldWidthFor(44))
  expect(narrow.size.w).toBe(520)
  for (const p of Object.values(narrow.placed)) {
    expect(p.x + p.ox - p.w / 2).toBeGreaterThanOrEqual(0)
    expect(p.x + p.ox + p.w / 2).toBeLessThanOrEqual(520)
  }
  const view = { model, placed: narrow.placed, field: narrow.size, ui: INITIAL_UI, me: { ...INITIAL_ME, sessionId: 'me' }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
  expect(svgOf(view)).toContain('viewBox="0 0 520 ')
  // Focused, the chain, the hint and the back pill share the narrow field: the hint is cut to leave the back pill its room.
  const focused = { ...view, ui: { ...INITIAL_UI, focusTopic: 'topic:hub' } }
  const svg = svgOf(focused)
  expect(svg).toContain('viewBox="0 0 520 520"')
  const hint = /<text x="260" y="33"[^>]*>([^<]*)<\/text>/.exec(svg)?.[1] ?? ''
  expect(hint.length).toBeGreaterThan(0)
  expect(24 + hint.length * 6.3).toBeLessThanOrEqual(520 - 2 * 118)
})

/** One topic whose chain has `n` steps, each titled at length, an hour or so apart. */
function chainFolder(n: number, resumed?: number) {
  const sessions: SessionSummary[] = []
  const store = { ...EMPTY_STORE, topics: { 'topic:chain': { name: 'Cart Total', createdAt: 0 } } as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string> }
  for (let i = 0; i < n; i += 1) {
    const startedAt = NOW - (n - i) * 3_700_000 - 3600_000
    // A resumed step keeps its place in the chain but was active last.
    const lastAt = i === resumed ? NOW : startedAt + 3600_000
    const id = `c${i}`
    sessions.push({ id, cwd: CWD, slug: 'x', branch: 'main', firstPrompt: id, title: `Round the cart line totals once, at the end ${i}`, startedAt, lastAt, turns: 3 + i, filesTouched: ['src/cart.ts'], lastAssistantText: '', size: 1, mtimeMs: lastAt })
    store.assign[id] = 'topic:chain'
  }
  return buildModel(sessions, store, DEFAULT_SETTINGS, NOW, 'me')
}

/** A focused view of `chainFolder(n)` at `columns`, with a step selected and this session joined if asked. */
function chainView(columns: number, n: number, opts: { selected?: string; you?: boolean; model?: ReturnType<typeof chainFolder> } = {}) {
  const model = opts.model ?? chainFolder(n)
  const placement = placementOf(model, null, fieldWidthFor(columns))
  return { model, placed: placement.placed, field: placement.size, ui: { ...INITIAL_UI, focusTopic: 'topic:chain', ...(opts.selected ? { selected: opts.selected } : {}) }, me: { ...INITIAL_ME, sessionId: 'me', ...(opts.you ? { topicId: 'topic:chain' } : {}) }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' as const }
}

/**
 * The chain's drawn label and meta lines, and every one that meets its neighbour on the row it is drawn on or
 * leaves the field. Meta lines are mono at 10.5 (6.3 units a character); labels at 11.5 (6.4, the layout's own
 * measure). A label's second line sits 14 below its first, so it shares a row with a one-line label's first.
 */
function chainClashes(svg: string, w: number, tag: string) {
  const texts: { y: string; x: number; w: number; text: string }[] = []
  for (const m of svg.matchAll(/<text class="mono" x="([\d.]+)" y="([\d.]+)" font-size="10.5"[^>]*>([^<]*)<\/text>/g)) texts.push({ y: `meta ${m[2]}`, x: Number(m[1]), w: (m[3] ?? '').length * 6.3, text: m[3] ?? '' })
  for (const m of svg.matchAll(/<text x="[\d.]+" y="([\d.]+)" font-size="11.5"[^>]*>(.*?)<\/text>/g)) {
    const lines = [...(m[2] ?? '').matchAll(/<tspan x="([\d.]+)" dy="(\d+)">([^<]*)<\/tspan>/g)]
    lines.forEach((l, k) => texts.push({ y: `label ${Number(m[1]) + 14 * k}`, x: Number(l[1]), w: (l[3] ?? '').length * 6.4, text: l[3] ?? '' }))
  }
  const clashes: string[] = []
  const rows = new Map<string, typeof texts>()
  for (const t of texts) rows.set(t.y, [...(rows.get(t.y) ?? []), t])
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x)
    for (let i = 1; i < row.length; i += 1) {
      const a = row[i - 1]
      const b = row[i]
      if (a && b && b.x - a.x < (a.w + b.w) / 2 + 4) clashes.push(`${tag}: "${a.text}" meets "${b.text}"`)
    }
  }
  // Every line stays on the field.
  for (const t of texts) if (t.x - t.w / 2 < 0 || t.x + t.w / 2 > w) clashes.push(`${tag}: "${t.text}" leaves the field`)
  return { texts, clashes }
}

test('a focused chain keeps every label and meta line to its room: none meets its neighbour on its row, in a 520, 620 or 860 field, from 3 steps to 24', async () => {
  const clashes: string[] = []
  for (const columns of [44, 60, 120]) {
    for (const n of [3, 5, 8, 11, 16, 24]) {
      const view = chainView(columns, n)
      const found = chainClashes(svgOf(view), view.field.w, `${view.field.w} wide, ${n} steps`)
      const texts = found.texts
      clashes.push(...found.clashes)
      // In a wide field an 11-step chain keeps each step's age and turns.
      if (columns === 120 && n === 11) expect(texts.filter(t => t.y.startsWith('meta')).every(t => / ago( · \d+ turns)?$/.test(t.text) && (t.text.includes('turns') || t.text.startsWith('latest')))).toBe(true)
      // In a narrow one each keeps its age whole, at least.
      if (columns === 44 && n === 11) expect(texts.filter(t => t.y.startsWith('meta')).every(t => /\d+[mhdw] ago/.test(t.text))).toBe(true)
    }
  }
  expect(clashes).toEqual([])
})

test('a crowded chain never overprints its labels: a selected step, "you" and a resumed older latest each keep clear of the others', async () => {
  const clashes: string[] = []
  for (const columns of [44, 60, 120]) {
    for (const n of [12, 16, 24]) {
      // The review's cases: the third step selected; "you" joined with the step three before the end selected.
      for (const [label, opts] of [['c2 selected', { selected: 'c2' }], [`you, c${n - 3} selected`, { selected: `c${n - 3}`, you: true }]] as const) {
        const view = chainView(columns, n, opts)
        clashes.push(...chainClashes(svgOf(view), view.field.w, `${view.field.w} wide, ${n} steps, ${label}`).clashes)
      }
      // Every step selected in turn, with and without "you".
      for (const you of [false, true]) {
        for (let k = 0; k < n; k += 1) {
          const view = chainView(columns, n, { selected: `c${k}`, you })
          clashes.push(...chainClashes(svgOf(view), view.field.w, `${view.field.w} wide, ${n} steps${you ? ' + you' : ''}, c${k} selected`).clashes)
        }
      }
      // The latest is not the last started: an older session resumed (the third step), so it is labelled without a click.
      const view = chainView(columns, n, { model: chainFolder(n, 2) })
      const resumed = chainClashes(svgOf(view), view.field.w, `${view.field.w} wide, ${n} steps, c2 resumed`)
      const at = chainPositions(n, sizeOf(view))[2]?.x.toFixed(1)
      expect(resumed.texts.some(t => t.y.startsWith('meta') && t.x.toFixed(1) === at)).toBe(true)
      clashes.push(...resumed.clashes)
    }
  }
  expect(clashes).toEqual([])
  // The selected step keeps its label: it wins its row over the first step, whose label it would meet.
  const view = chainView(44, 16, { selected: 'c2' })
  const x = chainPositions(16, sizeOf(view))[2]?.x.toFixed(1)
  expect(chainClashes(svgOf(view), view.field.w, '').texts.some(t => t.y.startsWith('label') && t.x.toFixed(1) === x)).toBe(true)
})

test('a long chain wraps into bands: the drawn step circles never meet, the picture grows to hold them, and the layer takes every step where it is drawn', async () => {
  const problems: string[] = []
  for (const columns of [44, 60, 120]) {
    for (const n of [12, 22, 30, 45, 60]) {
      const view = chainView(columns, n, { selected: `c${n - 3}`, you: true })
      const svg = svgOf(view)
      const tag = `${view.field.w} wide, ${n} steps`
      const rings = [...svg.matchAll(/<circle class="ring" cx="([\d.]+)" cy="([\d.]+)" r="16"/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
      if (rings.length !== n + 1) problems.push(`${tag}: ${rings.length} rings drawn`)
      for (let i = 0; i < rings.length; i += 1) {
        for (let k = i + 1; k < rings.length; k += 1) {
          const a = rings[i]
          const b = rings[k]
          if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < 34) problems.push(`${tag}: rings ${i + 1} and ${k + 1} meet`)
        }
      }
      // Every ring inside the picture, which is as tall as the field the layer is.
      const size = sizeOf(view)
      const box = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)" role="img"/)
      if (Number(box?.[1]) !== size.w || Number(box?.[2]) !== size.h) problems.push(`${tag}: viewBox ${box?.[1]} ${box?.[2]} against ${size.w} ${size.h}`)
      for (const r of rings) if (r.y + 21 > size.h - 60) problems.push(`${tag}: a ring at ${r.y} reaches the bottom`)
      const layer = fieldOf(view).nodes.filter(nd => nd.kind === 'step' || nd.kind === 'you')
      for (const nd of layer) if (!rings.some(r => Math.abs(r.x - nd.x) < 0.51 && Math.abs(r.y - nd.y) < 0.51)) problems.push(`${tag}: layer step ${nd.label} at ${nd.x},${nd.y} drawn nowhere`)
      // Its labels still keep clear of one another, band by band.
      problems.push(...chainClashes(svg, size.w, tag).clashes)
    }
  }
  expect(problems).toEqual([])
  // A chain that fits two rows keeps the base field.
  expect(sizeOf(chainView(44, 20)).h).toBe(520)
  expect(sizeOf(chainView(44, 21)).h).toBeGreaterThan(520)
})

test('the "you" meta is never cut to "now · y…": it reads "now · you", or "you" where that does not fit', async () => {
  const view = chainView(120, 21, { you: true })
  const metas = chainClashes(svgOf(view), view.field.w, '').texts.filter(t => t.y.startsWith('meta')).map(t => t.text)
  expect(metas.some(t => t === 'now · you' || t === 'you')).toBe(true)
  // Over every width a pane gives and every chain length to 40 with "you" in it, no meta line is cut.
  const cut: string[] = []
  for (let columns = 40; columns <= 120; columns += 2) {
    for (let n = 2; n <= 40; n += 1) {
      const v = chainView(columns, n, { you: true })
      for (const t of chainClashes(svgOf(v), v.field.w, '').texts) if (t.y.startsWith('meta') && t.text.endsWith('…')) cut.push(`${v.field.w} wide, ${n} steps: "${t.text}"`)
    }
  }
  expect([...new Set(cut)]).toEqual([])
})

test('the panes: a Desktop pane 44 columns wide draws a 520-unit picture, a wide one 860, a terminal pane the full field for its text map', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const base = paneOn('desktop')
  const narrow = await $.ui.mount({ ...base, props: { ...base.props, bodyColumns: 44 } })
  expect(String((await narrow.find({ type: 'Svg' }))?.props.source)).toContain('viewBox="0 0 520 ')
  await narrow.unmount()
  const wide = await $.ui.mount({ ...base, props: { ...base.props, bodyColumns: 120 } })
  expect(String((await wide.find({ type: 'Svg' }))?.props.source)).toContain('viewBox="0 0 860 ')
  await wide.unmount()
  const t = paneOn('terminal')
  const terminal = await $.ui.mount({ ...t, props: { ...t.props, bodyColumns: 44 } })
  expect(((await terminal.find({ type: 'Client', key: 'map' }))?.props.props as { fieldW?: number }).fieldW).toBe(860)
  await terminal.unmount()
})

test('your own focused topic: the pointer layer’s pill is as wide as the drawn one, “· you” and all', async () => {
  const model = linkedFolder(2)
  const placement = placementOf(model, 'topic:hub')
  const view = { model, placed: placement.placed, field: placement.size, ui: { ...INITIAL_UI, focusTopic: 'topic:hub' }, me: { ...INITIAL_ME, sessionId: 'me', topicId: 'topic:hub' }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
  const pill = fieldOf(view).nodes.find(n => n.id === 'topic:hub')
  expect(pill?.label).toContain('· you')
  expect(pill?.w).toBe(Math.round(pillWidth('Hub topic', '2 of 2 · you')))
  expect(svgOf(view)).toContain(`width="${pillWidth('Hub topic', '2 of 2 · you').toFixed(1)}"`)
})

/** A folder of named topics, each with `sessions` sessions last active `hours` ago, the first one focusable with a goal. */
function namedFolder(topics: { name: string; sessions: number; hours: number; files?: string[] }[], goal?: string) {
  const sessions: SessionSummary[] = []
  const store = { ...EMPTY_STORE, topics: {} as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string>, goals: (goal ? { 'topic:n0': goal } : {}) as Record<string, string> }
  topics.forEach((t, i) => {
    store.topics[`topic:n${i}`] = { name: t.name, createdAt: i }
    for (let k = 0; k < t.sessions; k += 1) {
      const id = `n${i}-${k}`
      const lastAt = NOW - t.hours * 3600_000 - k * 60_000
      sessions.push({ id, cwd: CWD, slug: 'x', branch: 'main', firstPrompt: id, title: `Session ${id}`, startedAt: lastAt - 3600_000, lastAt, turns: 3, filesTouched: t.files ?? [], lastAssistantText: '', size: 1, mtimeMs: lastAt })
      store.assign[id] = `topic:n${i}`
    }
  })
  return buildModel(sessions, store, DEFAULT_SETTINGS, NOW, 'me')
}

function namedView(model: ReturnType<typeof namedFolder>, columns: number | undefined, focusTopic?: string) {
  const placement = placementOf(model, null, fieldWidthFor(columns))
  return { model, placed: placement.placed, field: placement.size, ui: { ...INITIAL_UI, ...(focusTopic ? { focusTopic } : {}) }, me: { ...INITIAL_ME, sessionId: 'me' }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' as const }
}

test('two minor topics told apart by their last word keep it on the map and on the layer', async () => {
  const model = namedFolder([
    { name: 'Hub topic', sessions: 4, hours: 1 },
    { name: 'Authentication Middleware', sessions: 2, hours: 24 * 10 },
    { name: 'Authentication Middleware Rate', sessions: 2, hours: 24 * 11 },
  ])
  const minors = model.topics.filter(t => t.name.startsWith('Authentication'))
  expect(minors.map(t => t.isMajor)).toEqual([false, false])
  for (const columns of [44, 120]) {
    const view = namedView(model, columns)
    const labels = [...svgOf(view).matchAll(/class="mono lbl"[^>]*>([^<]*)</g)].map(m => (m[1] ?? '').trim()).filter(l => l.startsWith('Authenti'))
    expect(labels.length).toBe(2)
    expect(new Set(labels).size).toBe(2)
    expect(labels.some(l => l.endsWith(' Rate'))).toBe(true)
    const layer = fieldOf(view).nodes.filter(n => n.kind === 'topic' && n.title?.startsWith('Authentication')).map(n => n.label)
    expect(layer.length).toBe(2)
    expect(new Set(layer).size).toBe(2)
  }
})

test('two anchors told apart by their last word read differently, however many share the row', async () => {
  for (const [columns, others] of [[undefined, 3], [44, 1]] as const) {
    const model = namedFolder([
      { name: 'Checkout', sessions: 2, hours: 1, files: ['src/pay-0.ts', 'src/pay-1.ts', 'src/pay-2.ts', 'src/pay-3.ts', 'src/pay-4.ts'] },
      { name: 'Cashfree Handover', sessions: 1, hours: 2, files: ['src/pay-0.ts'] },
      { name: 'Cashfree Handover Refund', sessions: 1, hours: 3, files: ['src/pay-1.ts'] },
      ...Array.from({ length: others }, (_, i) => ({ name: `Other linked topic ${i}`, sessions: 1, hours: 4 + i, files: [`src/pay-${2 + i}.ts`] })),
    ])
    const view = namedView(model, columns, 'topic:n0')
    const shown = (columns === undefined ? 5 : 3)
    const anchors = fieldOf(view).nodes.filter(n => n.isAnchor)
    expect(anchors.length).toBe(shown)
    const cash = anchors.filter(a => a.title?.startsWith('Cashfree'))
    expect(cash.length).toBe(2)
    // The layer's names (the terminal prints them), the text before the file.
    expect(new Set(cash.map(a => /^(.*?)(?: · |$)/.exec(a.label ?? '')?.[1])).size).toBe(2)
    // The picture's names, the text before the file's tspan, in the two most recent anchors.
    const names = [...svgOf(view).matchAll(/<g class="hit an an-[01]"[^>]*>.*?<text [^>]*>([^<]*)</g)].map(m => (m[1] ?? '').trim())
    expect(names.length).toBe(2)
    expect(new Set(names).size).toBe(2)
    expect(names.some(n => n.endsWith('Refund') || n.endsWith('fund'))).toBe(true)
    // The file a name no longer leaves room for is in the anchor's hover caption.
    if (columns === undefined) expect(svgOf(view)).toContain('Cashfree Handover Refund · via pay-1.ts · ')
  }
})

test('a 300-character goal is cut to the narrow field', async () => {
  const goal = 'Make the checkout suite deterministic on CI and keep the whole thing green while we move the payment code. '.repeat(3).slice(0, 300)
  for (const columns of [44, 120]) {
    const view = namedView(namedFolder([{ name: 'Checkout', sessions: 5, hours: 1 }], goal), columns, 'topic:n0')
    const text = /<tspan class="mono" style="fill:var\(--mu\)">GOAL<\/tspan>  ([^<]*)<\/text>/.exec(svgOf(view))?.[1] ?? ''
    expect(text.endsWith('…')).toBe(true)
    expect(text.length * 6.2).toBeLessThanOrEqual(view.field.w - 40)
  }
})

test('a clipped name keeps its last word, or its last characters when the word has no room, never past its room', async () => {
  expect(clipName('Authentication Middleware Rate', 24)).toBe('Authentication Mid… Rate')
  expect(clipName('Authentication Middleware', 24)).toBe('Authenticati… Middleware')
  expect(clipName('Cashfree Handover Refund', 14)).toBe('Cashfr… Refund')
  expect(clipName('Cashfree Handover Refund', 9)).toBe('Cash…fund')
  expect(clipName('Cashfree Handover', 9)).toBe('Cash…over')
  expect(clipName('Supercalifragilistic', 9)).toBe('Supercal…')
  expect(clipName('Cart Total', 24)).toBe('Cart Total')
  for (const name of ['Authentication Middleware Rate', 'Cashfree Handover Refund', 'a b', 'Word', 'x y z w v u']) {
    for (let max = 4; max <= 30; max += 1) expect(clipName(name, max).length).toBeLessThanOrEqual(max)
  }
})
