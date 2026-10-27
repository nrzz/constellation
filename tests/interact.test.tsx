// The interaction pass: the help card, the "Jump back in" row, "my topic",
// the search clear, Refresh, the band's cap, the numbered commands, the
// session card's rows, the settings groups, and what was taken out.
import { expect, test } from 'claude-code/testing'

import { backedOut } from '../hooks/actions'
import { pointerHint } from '../hooks/draw'
import { DEFAULT_SETTINGS, INITIAL_UI } from '../hooks/state'
import { CHECKOUT, CWD, IDS, NOW, bandOn, paneOn, run, stubEngine } from './helpers'

const ROW = {
  plugin: 'constellation',
  component: 'CommandOutput',
  requestId: 'msg-1',
  props: { command: 'map', args: 'here', text: 'Constellation map (as of now) · web-app · 1 topics · 3 sessions · 0 active', isErrored: false },
} as const

function chipsOf(buttons: { key?: string; props: { hotkey?: unknown } }[]) {
  return buttons.filter(b => b.key?.startsWith('j:') && !['j:new', 'j:map', 'j:dismiss', 'j:more'].includes(b.key ?? ''))
}

test('Help: the header button (h) shows commands and keys in place of the card, /map help prints the same, Esc closes it before anything else', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  expect((await ui.find({ type: 'Button', key: 'help' }))?.props.hotkey).toBe('h')
  await ui.press({ key: 'help' })
  expect(await ui.find({ type: 'Text', text: /^\/pickup list$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^p · v · x · t$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'j:new' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'help' }))?.props.label).toBe('Close help')
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /^COMMANDS$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'settings:done' })).toBeDefined()
  await ui.press({ key: 'help' })
  expect(await ui.find({ type: 'Button', key: 'settings:done' })).toBeUndefined()
  await ui.press({ key: 'help:done' })
  expect(await ui.find({ type: 'Text', text: /^COMMANDS$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'j:new' })).toBeDefined()
  await ui.unmount()
  const text = (await run($, 'map', 'help')).text ?? ''
  expect(text).toContain('/pickup list')
  expect(text).toContain('focus my topic')
  expect(text).toContain('ctrl+x tab')
  const once = backedOut({ ...INITIAL_UI, showHelp: true, focusTopic: CHECKOUT, selected: IDS.tests })
  expect(once?.showHelp).toBe(false)
  expect(once?.selected).toBe(IDS.tests)
})

test('Jump back in: the three most recent sessions, newest first; a chip focuses its topic with the session selected; the row yields to focus, search, settings and help', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  const recent = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('r:')).map(b => b.key)
  expect(recent).toEqual([`r:${IDS.tests}`, `r:${IDS.orders}`, `r:${IDS.rounding}`])
  expect((await ui.find({ type: 'Button', key: `r:${IDS.tests}` }))?.text).toContain('Fix flaky cart wait')
  await ui.press({ key: `r:${IDS.tests}` })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('‹ All topics')
  expect(await ui.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeUndefined()
  // ‹ All topics goes straight back, card and all; the recent row returns.
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeDefined()
  await ui.input({ key: 'q', text: 'cart', kind: 'change' })
  expect(await ui.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'q:clear' })).toBeDefined()
  await ui.press({ key: 'q:clear' })
  expect((await ui.find({ type: 'Input', key: 'q' }))?.props.value).toBe('')
  expect(await ui.find({ type: 'Button', key: 'q:clear' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeDefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeUndefined()
  await ui.press({ key: 'help' })
  expect(await ui.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeUndefined()
  await ui.press({ key: 'help:done' })
  expect(await ui.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeDefined()
  await ui.unmount()
  const terminal = await $.ui.mount(paneOn('terminal'))
  expect(await terminal.find({ type: 'Button', key: `r:${IDS.orders}` })).toBeDefined()
  await terminal.unmount()
  const row = await $.ui.mount({ ...ROW, surface: 'desktop' })
  expect(await row.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeDefined()
  await row.unmount()
})

test('my topic (y) focuses this session’s chain from the settings view and out of a merge, never as the merge target; Refresh rescans with a quiet word', async ($, on) => {
  const stubs = stubEngine(on, { store: { topics: { 'topic:docs': { name: 'Docs', createdAt: 1 } } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('terminal'))
  expect(await ui.find({ type: 'Button', key: 'mine' })).toBeUndefined()
  await ui.press({ key: `j:${CHECKOUT}` })
  expect((await ui.find({ type: 'Button', key: 'mine' }))?.props.hotkey).toBe('y')
  await ui.press({ key: 'back' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'mine' })
  expect(await ui.find({ type: 'Button', key: 'settings:done' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 's:you' })).toBeDefined()
  await ui.press({ key: 'back' })
  await $.ui.focus({ component: 'Pane', requestId: 'constellation', element: 't:topic:docs', origin: { kind: 'person' } })
  await ui.press({ key: 'tc:merge' })
  expect(await ui.find({ type: 'Button', key: 'merge:cancel' })).toBeDefined()
  await ui.press({ key: 'mine' })
  expect(await ui.find({ type: 'Button', key: 'merge:cancel' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 's:you' })).toBeDefined()
  expect(stubs.toasts.some(t => t.startsWith('Merged'))).toBe(false)
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', key: 't:topic:docs' })).toBeDefined()
  const reads = stubs.reads.length
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /^Refreshed: 2 topics · 3 sessions · 0 active\.$/ })).toBeDefined()
  expect(stubs.reads.length).toBe(reads)
  expect(stubs.toasts.some(t => t.startsWith('Refreshed'))).toBe(false)
  await ui.unmount()
})

test('the band offers at most nine topics on the digits and "+N more in the map" opens the pane; the pane chooser lists every topic', async ($, on) => {
  const topics: Record<string, { name: string; createdAt: number }> = {}
  for (let i = 1; i <= 12; i += 1) topics[`topic:extra-${i}`] = { name: `Extra ${i}`, createdAt: NOW - i * 1000 }
  const stubs = stubEngine(on, { store: { topics } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('terminal'))
  const chips = chipsOf(await band.findAll({ type: 'Button' }))
  expect(chips.length).toBe(9)
  expect(chips.map(c => c.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  expect(chips[0]?.key).toBe(`j:${CHECKOUT}`)
  const more = await band.find({ type: 'Button', key: 'j:more' })
  expect(more?.text).toContain('+4 more in the map')
  await band.press({ key: 'j:more' })
  expect(stubs.opened).toBe(1)
  await band.unmount()
  const pane = await $.ui.mount(paneOn('desktop'))
  expect(chipsOf(await pane.findAll({ type: 'Button' })).length).toBe(13)
  expect(await pane.find({ type: 'Button', key: 'j:more' })).toBeUndefined()
  await pane.unmount()
})

test('/topic lists the topics numbered and /topic n joins one; /map <topic> opens focused on it, by number, name or prefix; /map find opens searching; /pickup list prints the chain', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const listed = (await run($, 'topic', '')).text ?? ''
  expect(listed).toContain('Topics in web-app: 1 ')
  expect(listed).toContain('(2).')
  const name = /Topics in web-app: 1 (.+?) \(2\)/.exec(listed)?.[1] ?? ''
  expect(name.length).toBeGreaterThan(0)
  expect((await run($, 'pickup', 'list')).text).toContain('has not joined')
  const joined = (await run($, 'topic', '1')).text ?? ''
  expect(joined).toBe(`This session is in the topic ${name}.`)
  expect(stubs.status[stubs.status.length - 1]).toContain('step 3')
  const steps = (await run($, 'pickup', 'list')).text ?? ''
  expect(steps).toContain(`${name}: 2 steps, and you.`)
  expect(steps).toContain('3. This session · you')
  expect(steps).toContain('1. Checkout total rounding')
  expect(steps).toContain('2. Fix flaky cart wait')
  expect(steps).toContain('· latest')
  expect(steps).toContain('findByText')

  const byNumber = (await run($, 'map', '1')).text ?? ''
  expect(byNumber).toBe(`Constellation opened on ${name} (2 sessions).`)
  expect(stubs.opened).toBe(1)
  const ui = await $.ui.mount(paneOn('desktop'))
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 's:you' })).toBeDefined()
  await ui.unmount()
  expect((await run($, 'map', name.toUpperCase())).text).toContain('Constellation opened on')
  expect((await run($, 'map', name.slice(0, 4))).text).toContain('Constellation opened on')
  const none = (await run($, 'map', 'nonsense')).text ?? ''
  expect(none).toContain('No topic matches “nonsense”')
  expect(none).toContain(`Topics: 1 ${name}.`)
  expect(stubs.opened).toBe(3)

  expect((await run($, 'map', 'find cursor')).text).toBe('Constellation opened, searching “cursor”: 1 session match.')
  const searching = await $.ui.mount(paneOn('desktop'))
  expect((await searching.find({ type: 'Input', key: 'q' }))?.props.value).toBe('cursor')
  expect(await searching.find({ type: 'Button', key: 'q:clear' })).toBeDefined()
  expect(await searching.find({ type: 'Button', key: 'back' })).toBeUndefined()
  expect(String((await searching.find({ type: 'Svg' }))?.props.source)).toContain('1 match')
  await searching.unmount()
  expect((await run($, 'map', 'find')).text).toContain('Usage: /map find')
})

test('/map after /map settings and /map close opens on the map again, not on the settings card', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await run($, 'map', 'settings')
  const first = await $.ui.mount(paneOn('desktop'))
  expect(await first.find({ type: 'Button', key: 'settings:done' })).toBeDefined()
  await first.unmount()
  await run($, 'map', 'close')
  await run($, 'map', '')
  const again = await $.ui.mount(paneOn('desktop'))
  expect(await again.find({ type: 'Button', key: 'settings:done' })).toBeUndefined()
  expect(await again.find({ type: 'Button', key: `r:${IDS.tests}` })).toBeDefined()
  await again.unmount()
})

test('a session card: Message is dim unless the session is active, the resume command reads under the buttons; a topic with nothing to tidy shows no tidy button', async ($, on) => {
  stubEngine(on, { store: { topics: { 'topic:docs': { name: 'Docs', createdAt: 1 } } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: `t:${CHECKOUT}` })
  expect((await ui.find({ type: 'Button', key: 'tc:tidy' }))?.props.label).toBe('Archive 1 idle')
  await ui.press({ key: `s:${IDS.tests}` })
  expect((await ui.find({ type: 'Button', key: 'sc:message' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: new RegExp(`claude --resume ${IDS.tests}`) })).toBeDefined()
  for (const key of ['sc:pickup', 'sc:draft', 'sc:new', 'sc:pin', 'sc:move', 'sc:archive']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 't:topic:docs' })
  expect(await ui.find({ type: 'Button', key: 'tc:focus' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'tc:tidy' })).toBeUndefined()
  await ui.unmount()
})

test('a session active in the last five minutes offers Message at full strength', async ($, on) => {
  stubEngine(on, { now: Date.parse('2026-10-20T09:06:00.000Z') })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: `r:${IDS.tests}` })
  expect(await ui.find({ type: 'Text', text: /^live$/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'sc:message' }))?.props.dimColor).toBe(false)
  await ui.unmount()
})

test('settings come in Map, Session and Advanced groups, without row numbers; the advanced rows stay folded until asked and fold back', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('terminal'))
  await ui.press({ key: 'settings' })
  for (const title of ['Map', 'Session', 'Advanced']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^01$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'set:scope:folder' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'set:fieldBackground:night' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'set:majorRule:count' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'set:pictureClicks:outline' })).toBeUndefined()
  // The terminal's fold marks come from the WGL4 set every console font has.
  expect((await ui.find({ type: 'Button', key: 'set:advanced' }))?.props.label).toBe('Show ►')
  await ui.press({ key: 'set:advanced' })
  expect(await ui.find({ type: 'Button', key: 'set:majorRule:count' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'set:pictureClicks:outline' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'set:pictureClicks:off' })).toBeDefined()
  await ui.press({ key: 'set:majorRule:count' })
  expect((await ui.find({ type: 'Button', key: 'set:majorRule:count' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'set:advanced' })
  expect(await ui.find({ type: 'Button', key: 'set:majorRule:count' })).toBeUndefined()
  await ui.unmount()
})

test('the terminal map’s hint: click and Tab on a docked pane; Tab, Enter and /tui fullscreen on an inline one, where the terminal reports no mouse', { options: { pictureMode: 'clicks' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const docked = await $.ui.mount(paneOn('terminal'))
  const hintOf = async (ui: { find: (q: { type?: string; key?: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) =>
    String(((await ui.find({ type: 'Client', key: 'map' }))?.props.props as { hint?: string } | undefined)?.hint ?? '')
  expect(await hintOf(docked)).toBe('Click or Tab to a topic · Enter focuses')
  await docked.unmount()
  const base = paneOn('terminal')
  const inline = await $.ui.mount({ ...base, props: { ...base.props, placement: 'inline' } })
  expect(await hintOf(inline)).toBe('Tab to a topic · Enter focuses · the mouse works in /tui fullscreen')
  await inline.unmount()
  // A Desktop pane seated inline keeps the pointer hint: its picture takes the clicks.
  const desk = paneOn('desktop')
  const deskInline = await $.ui.mount({ ...desk, props: { ...desk.props, placement: 'inline' } })
  expect(await hintOf(deskInline)).toBe('Hover or focus a topic to trace it · Enter or click to focus')
  await deskInline.unmount()
})

test('the resting hint on each surface says how picking works there, in the picture and the Client alike', async () => {
  // The click picture's hints (live has its own, tests/live.test.tsx).
  const settings = { ...DEFAULT_SETTINGS, pictureMode: 'clicks' as const }
  expect(pointerHint({ surface: 'terminal', placement: 'dock', settings })).toBe('Click or Tab to a topic · Enter focuses')
  expect(pointerHint({ surface: 'terminal', placement: 'inline', settings })).toBe('Tab to a topic · Enter focuses · the mouse works in /tui fullscreen')
  expect(pointerHint({ surface: 'desktop', placement: 'dock', settings })).toBe('Hover or focus a topic to trace it · Enter or click to focus')
  expect(pointerHint({ surface: 'desktop', placement: 'dock', settings: { ...settings, pictureClicks: 'outline' } })).toBe('Hover or focus a topic to trace it · Enter or click to focus')
  // No pointer layer: the picture takes no click, the buttons under it do.
  expect(pointerHint({ surface: 'desktop', placement: 'dock', settings: { ...settings, pictureClicks: 'off' } })).toBe('Tab onto a topic to trace it · Enter or its button under the map focuses')
  expect(pointerHint({ surface: 'vscode', placement: 'dock', settings })).toBe('Tab onto a topic to trace it · Enter or its button under the map focuses')
  expect(pointerHint({ surface: 'mobile', placement: 'dock', settings })).toBe('Tap a topic under the map to focus it')
  // The fullscreen renderer reports the mouse even where it seats the pane inline (under 110 columns); the classic one never.
  expect(pointerHint({ surface: 'terminal', placement: 'inline', isFullscreen: true, settings })).toBe('Click or Tab to a topic · Enter focuses')
  expect(pointerHint({ surface: 'terminal', placement: 'inline', isFullscreen: false, settings })).toBe('Tab to a topic · Enter focuses · the mouse works in /tui fullscreen')
  // A /map here snapshot in the transcript is a picture, with nothing live under it.
  expect(pointerHint({ surface: 'desktop', placement: 'dock', isRow: true, settings })).toBe('A snapshot · /map opens the live map')
})

test('help lies over an open card: closing it, by h or Esc, gives the card back', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneOn('terminal'))
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.rounding}` })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  await ui.press({ key: 'help' })
  expect(await ui.find({ type: 'Button', key: 'help:done' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeUndefined()
  await ui.press({ key: 'help' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  // Esc closes the help first, and the card is still there under it.
  await ui.press({ key: 'help' })
  expect(backedOut({ ...INITIAL_UI, showHelp: true, focusTopic: CHECKOUT, selected: IDS.rounding })).toEqual({ ...INITIAL_UI, showHelp: false, focusTopic: CHECKOUT, selected: IDS.rounding })
  await ui.press({ key: 'help:done' })
  expect(await ui.find({ type: 'Button', key: 'sc:pickup' })).toBeDefined()
  await ui.unmount()
})

test('a refresh leaves an Undo on offer, and says its piece in the engine’s toast', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneOn('terminal'))
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.rounding}` })
  await ui.press({ key: 'sc:archive' })
  expect(await ui.find({ type: 'Button', key: 'toast:undo' })).toBeDefined()
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Button', key: 'toast:undo' })).toBeDefined()
  expect(stubs.toasts.some(t => t.startsWith('Refreshed:'))).toBe(true)
  // With no Undo on offer, the refresh's line is the pane's own.
  await ui.press({ key: 'toast:dismiss' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /^Refreshed:/ })).toBeDefined()
  await ui.unmount()
})

/** WGL4, the characters every Windows console font carries (Consolas, Lucida Console, Cascadia): what a terminal may print. */
const WGL4 = new Set<string>([
  ...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)),
  ...Array.from({ length: 0x180 - 0xa0 }, (_, i) => String.fromCharCode(0xa0 + i)),
  ...'–—―‗‘’‚‛“”„†‡•…‰′″‹›‼‾⁄ⁿ₣₤₧€℅ℓ№™Ω℮←↑→↓↔↕↨∂∆∏∑−∕∙√∞∟∩∫≈≠≡≤≥⌂⌐⌠⌡─│┌┐└┘├┤┬┴┼═║╔╗╚╝▀▄█▌▐░▒▓■□▪▫▬▲►▼◄◊○●◘◙◦☺☻☼♀♂♠♣♥♦♪♫',
])

test('every mark the terminal pane prints is one a Windows console font has: the header, the map’s props, the list, settings, help, a session card, a pin and its toast, the band', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneOn('terminal'))
  const strays = new Map<string, string>()
  const scan = async (state: string) => {
    const texts: string[] = []
    for (const t of await ui.findAll({ type: 'Text' })) texts.push(String(t.text ?? ''))
    for (const b of await ui.findAll({ type: 'Button' })) texts.push(String(b.props.label ?? ''), String(b.text ?? ''))
    const map = (await ui.find({ type: 'Client', key: 'map' }))?.props.props as { hint?: string; legend?: string; nodes?: { label?: string; label2?: string }[] } | undefined
    if (map) texts.push(String(map.hint ?? ''), String(map.legend ?? ''), ...(map.nodes ?? []).flatMap(n => [String(n.label ?? ''), String(n.label2 ?? '')]))
    for (const text of texts) for (const ch of text) if (!WGL4.has(ch) && !strays.has(ch)) strays.set(ch, `${state}: ${text}`)
  }
  await scan('the map')
  await ui.press({ key: 'help' })
  await scan('help')
  await ui.press({ key: 'help:done' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'set:advanced' })
  await scan('settings, advanced open')
  await ui.press({ key: 'settings' })
  await ui.press({ key: `r:${IDS.tests}` })
  await scan('a session card')
  await ui.press({ key: 'sc:pin' })
  await scan('pinned, with its toast')
  const done = await ui.find({ type: 'Text', text: /^√$/ })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'view:list' })
  await ui.press({ key: `t:${CHECKOUT}` })
  await scan('the list, a topic open, a pinned session in it')
  await ui.unmount()
  const band = await $.ui.mount(bandOn('terminal'))
  for (const t of await band.findAll({ type: 'Text' })) for (const ch of String(t.text ?? '')) if (!WGL4.has(ch)) strays.set(ch, `the band: ${t.text}`)
  await band.unmount()
  expect([...strays.entries()].map(([ch, where]) => `${ch} (U+${ch.codePointAt(0)?.toString(16).toUpperCase()}) in ${where}`)).toEqual([])
  // The toast's mark is the console's own √.
  expect(done).toBeDefined()
})
