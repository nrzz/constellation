// The pane's header and the buttons under the picture, to the join chooser's standard: a topic's own colour
// carries its identity (dot, tint, hairline), the accent marks only you, live and the current selection, no
// solid `primary` slabs, translucent chips that lift on hover, meta dim and mono outside the Buttons, and no
// capitals in labels. The terminal keeps every button and draws no borders (a border costs it two rows).
import { expect, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

import { ACCENT, PALETTE } from '../hooks/cluster'
import { reasonOf } from '../hooks/actions'
import { CARD_BORDER, HAIRLINE, MUTED, PROBLEM } from '../hooks/draw'
import { transcripts } from './fixtures/transcripts'
import { CHECKOUT, CWD, FIXTURE_FILES, IDS, ME, alphaOf, bandOn, boxesOf, kids, paneOn, rgbOf, run, stubEngine, submit } from './helpers'

const HEADER = ['view:map', 'view:list', 'settings', 'help', 'mine']
/** A label in capitals: "CONSTELLATION", "JUMP BACK IN", "RELATED". */
const SHOUT = /^[A-Z][A-Z ]{3,}$/

/** This session joins the checkout topic (so it is live and "you" is a step); the pane opens on the map. */
async function joined($: Engine, surface: 'desktop' | 'terminal' = 'desktop') {
  await $.session.start({ cwd: CWD, surface, isInteractive: true })
  await run($, 'topic', '1')
  const ui = await $.ui.mount(paneOn(surface))
  if (await ui.find({ type: 'Button', key: 'back' })) await ui.press({ key: 'back' })
  return ui
}

type Ui = Awaited<ReturnType<typeof joined>>

function hover(box: FoundElement | undefined): { backgroundColor?: string; borderColor?: string } {
  return (box?.props.hover ?? {}) as { backgroundColor?: string; borderColor?: string }
}

/** No label in capitals; `cards` lets through the topic and session cards' own labels, which are later surfaces of this pass. */
async function noShouting(ui: { findAll: (query: { type: 'Text' }) => Promise<FoundElement[]> }, cards: string[] = []) {
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
  expect(texts.filter(t => SHOUT.test(t) && !cards.includes(t))).toEqual([])
}

test('header: a sentence-case title in medium weight; Map and List a pair of chips, the current one tinted in the accent; no primary slab', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  const title = await ui.find({ type: 'Text', text: /^Constellation$/ })
  expect(title?.props.weight).toBe('medium')
  await noShouting(ui)
  for (const key of HEADER) {
    const b = await ui.find({ type: 'Button', key })
    expect(b).toBeDefined()
    expect(b?.props.variant).toBeUndefined()
    expect(b?.props.plain).toBe(true)
  }
  const boxes = Object.fromEntries((await boxesOf(ui, 'hb:')).map(b => [b.id, b.box]))
  expect(rgbOf(boxes.map?.props.backgroundColor)).toBe(rgbOf(ACCENT))
  expect(alphaOf(boxes.map?.props.backgroundColor)).toBeLessThan(0.3)
  expect(boxes.list?.props.backgroundColor === undefined || rgbOf(boxes.list?.props.backgroundColor) !== rgbOf(ACCENT)).toBe(true)
  for (const id of ['map', 'list', 'settings', 'help']) {
    expect(boxes[id]?.props.borderStyle).toBe('round')
    expect(hover(boxes[id]).backgroundColor ?? hover(boxes[id]).borderColor).toBeDefined()
  }
  // "my topic": the accent diamond sits beside the Button, so the Desktop draws it in its colour.
  const mine = kids(boxes.mine)
  expect(mine.find(k => k.type === 'Text' && k.text === '♦')?.props.color).toBe(ACCENT)
  expect(mine.find(k => k.type === 'Button')?.key).toBe('mine')
  // The settings view swaps the selection to its chip.
  await ui.press({ key: 'settings' })
  const open = Object.fromEntries((await boxesOf(ui, 'hb:')).map(b => [b.id, b.box]))
  expect(rgbOf(open.settings?.props.backgroundColor)).toBe(rgbOf(ACCENT))
  await ui.unmount()
})

test('under the map: each topic a Box chip tinted in its colour, the name a plain Button, the count dim mono outside it; a running topic says live in the accent', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  const buttons = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('t:'))
  const chips = await boxesOf(ui, 'tb:')
  expect(chips.map(c => c.id).sort()).toEqual(buttons.map(b => (b.key ?? '').slice(2)).sort())
  expect(chips.length).toBeGreaterThan(1)
  for (const { id, box } of chips) {
    const inside = kids(box)
    const rgb = rgbOf(inside.find(k => k.type === 'Text' && k.text === '●')?.props.color)
    expect(rgbOf(box.props.backgroundColor)).toBe(rgb)
    expect(rgbOf(box.props.borderColor)).toBe(rgb)
    expect(alphaOf(box.props.backgroundColor)).toBeLessThan(0.25)
    expect(rgbOf(hover(box).backgroundColor)).toBe(rgb)
    expect(alphaOf(hover(box).backgroundColor)).toBeGreaterThan(alphaOf(box.props.backgroundColor))
    const name = inside.find(k => k.type === 'Button')
    expect(name?.key).toBe(`t:${id}`)
    expect(name?.props.plain).toBe(true)
    expect(name?.props.variant).toBeUndefined()
    expect(name?.text).not.toMatch(/\d+$/)
    const count = inside.find(k => k.type === 'Text' && /^\d+$/.test(k.text))
    expect(count?.props.mono).toBe(true)
    expect(count?.props.dimColor).toBe(true)
    const live = inside.find(k => k.type === 'Text' && k.text === 'live')
    if (id === CHECKOUT) expect(live?.props.color).toBe(ACCENT)
    else expect(live).toBeUndefined()
  }
  await ui.unmount()
})

test('a merge pick: the chips stay chips, stronger so they read as targets; Cancel merge an outline; no primary slab', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  const calm = Object.fromEntries((await boxesOf(ui, 'tb:')).map(c => [c.id, c.box]))
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: 'tc:merge' })
  const picking = await boxesOf(ui, 'tb:')
  expect(picking.length).toBeGreaterThan(1)
  for (const { id, box } of picking) {
    expect(kids(box).find(k => k.type === 'Button')?.props.plain).toBe(true)
    expect(alphaOf(box.props.borderColor)).toBeGreaterThan(alphaOf(calm[id]?.props.borderColor))
  }
  const cancel = (await boxesOf(ui, 'xb:')).find(b => b.id === 'merge')
  expect(cancel?.box.props.borderStyle).toBe('round')
  expect(kids(cancel?.box).find(k => k.type === 'Button')?.key).toBe('merge:cancel')
  expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.variant === 'primary' && (b.key?.startsWith('t:') || b.key === 'merge:cancel'))).toEqual([])
  await ui.unmount()
})

test('a focused chain: back an outline chip; each step a chip with its number once, a key cap or dim mono outside the Button; the selected step tinted in the topic colour; you marked in the accent', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  const color = kids((await boxesOf(ui, 'tb:')).find(c => c.id === CHECKOUT)?.box).find(k => k.text === '●')?.props.color
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await noShouting(ui)
  const back = (await boxesOf(ui, 'bb:'))[0]
  expect(back?.box.props.borderStyle).toBe('round')
  expect(rgbOf(back?.box.props.borderColor)).not.toBe(rgbOf(ACCENT))
  expect(kids(back?.box).find(k => k.type === 'Button')?.key).toBe('back')
  const steps = await boxesOf(ui, 'sb:')
  expect(steps.length).toBeGreaterThan(2)
  steps.forEach(({ id, box }, i) => {
    const inside = kids(box)
    const button = inside.find(k => k.type === 'Button')
    expect(button?.key).toBe(`s:${id}`)
    expect(button?.props.plain).toBe(true)
    expect(button?.props.variant).toBeUndefined()
    expect(button?.text).not.toMatch(/^\d/)
    // The number shows once: as the hotkey's key cap, else as dim mono text beside the Button.
    const number = inside.find(k => k.type === 'Text' && k.text === String(i + 1))
    if (button?.props.hotkey !== undefined) {
      expect(button.props.hotkey).toBe(String(i + 1))
      expect(number).toBeUndefined()
    } else {
      expect(number?.props.mono).toBe(true)
      expect(number?.props.dimColor).toBe(true)
    }
    expect(box.props.borderStyle).toBe('round')
    expect(hover(box).backgroundColor).toBeDefined()
  })
  const selected = steps.find(s => s.id === IDS.tests)
  const other = steps.find(s => s.id !== IDS.tests && s.id !== 'you')
  expect(rgbOf(selected?.box.props.backgroundColor)).toBe(rgbOf(color))
  expect(alphaOf(selected?.box.props.borderColor)).toBeGreaterThan(alphaOf(other?.box.props.borderColor))
  const you = steps.find(s => s.id === 'you')
  expect(kids(you?.box).find(k => k.type === 'Text' && k.text === 'you')?.props.color).toBe(ACCENT)
  expect(kids(you?.box).find(k => k.type === 'Button')?.text).not.toMatch(/you/)
  await ui.unmount()
})

test('Jump back in: a sentence-case label; each session a chip tinted in its topic colour, the age dim mono outside the Button', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  expect(await ui.find({ type: 'Text', text: /^Jump back in$/ })).toBeDefined()
  const topicTints = new Set((await boxesOf(ui, 'tb:')).map(c => rgbOf(c.box.props.backgroundColor)))
  const recent = await boxesOf(ui, 'rb:')
  expect(recent.length).toBeGreaterThan(0)
  for (const { id, box } of recent) {
    expect(topicTints.has(rgbOf(box.props.backgroundColor))).toBe(true)
    const inside = kids(box)
    expect(inside.find(k => k.type === 'Button')?.key).toBe(`r:${id}`)
    const age = inside.find(k => k.type === 'Text' && k.props.mono === true)
    expect(age?.props.dimColor).toBe(true)
    expect(hover(box).backgroundColor).toBeDefined()
  }
  await ui.unmount()
})

/** The card's one primary action a chip tinted in `color`, its secondary ones outlines, the rest plain; no primary slab anywhere in it. */
async function actionsRanked(ui: Ui, color: unknown, primary: string, secondary: string[], tertiary: string[]) {
  const main = (await boxesOf(ui, 'pb:')).find(b => b.id === primary)
  expect(rgbOf(main?.box.props.backgroundColor)).toBe(rgbOf(color))
  expect(alphaOf(main?.box.props.backgroundColor)).toBeLessThan(0.3)
  expect(rgbOf(hover(main?.box).backgroundColor)).toBe(rgbOf(color))
  expect(kids(main?.box).find(k => k.type === 'Button')?.key).toBe(primary)
  const outlines = Object.fromEntries((await boxesOf(ui, 'ob:')).map(b => [b.id, b.box]))
  for (const key of secondary) {
    expect(outlines[key]?.props.borderStyle).toBe('round')
    expect(rgbOf(outlines[key]?.props.borderColor)).not.toBe(rgbOf(color))
    expect(kids(outlines[key]).find(k => k.type === 'Button')?.key).toBe(key)
  }
  for (const key of tertiary) {
    const b = await ui.find({ type: 'Button', key })
    expect(b?.props.plain).toBe(true)
    expect(outlines[key]).toBeUndefined()
  }
  expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.variant === 'primary')).toEqual([])
}

test('the topic card: a hairline and faint fill in the topic colour, the kind and counts as one dim mono line in lower case, related topics as chips, Focus the one tinted action', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  const color = kids((await boxesOf(ui, 'tb:')).find(c => c.id === CHECKOUT)?.box).find(k => k.text === '●')?.props.color
  await ui.press({ key: `t:${CHECKOUT}` })
  await noShouting(ui)
  const box = (await boxesOf(ui, 'cd:')).find(b => b.id === 'topic')?.box
  expect(rgbOf(box?.props.borderColor)).toBe(rgbOf(color))
  expect(alphaOf(box?.props.borderColor)).toBeLessThan(0.6)
  expect(rgbOf(box?.props.backgroundColor)).toBe(rgbOf(color))
  expect(alphaOf(box?.props.backgroundColor)).toBeLessThan(0.08)
  const meta = await ui.find({ type: 'Text', text: /^(major|minor) · \d+ sessions · \d+ idle · \d+ shipped$/ })
  expect(meta?.props.mono).toBe(true)
  expect(meta?.props.dimColor).toBe(true)
  // This session is running in the checkout topic: the card says live, in the accent.
  const head = kids((await boxesOf(ui, 'ch:')).find(b => b.id === 'topic')?.box)
  expect(head.find(k => k.type === 'Text' && k.text === '●')?.props.color).toBe(color)
  expect(head.find(k => k.type === 'Text' && k.text === 'live')?.props.color).toBe(ACCENT)
  const rel = await boxesOf(ui, 'kb:')
  // A sentence-case label before the chips, or one dim sentence when there are none.
  expect(await ui.find({ type: 'Text', text: rel.length > 0 ? /^related$/ : /^No related topics yet/ })).toBeDefined()
  for (const { id, box: r } of rel) {
    const inside = kids(r)
    const rgb = rgbOf(inside.find(k => k.type === 'Text' && k.text === '●')?.props.color)
    expect(rgbOf(r.props.backgroundColor)).toBe(rgb)
    const name = inside.find(k => k.type === 'Button')
    expect(name?.key).toBe(`rel:${id}`)
    expect(name?.props.plain).toBe(true)
    expect(name?.children.filter(c => typeof c === 'object')).toEqual([])
    expect(inside.find(k => k.type === 'Text' && k.props.mono === true)?.props.dimColor).toBe(true)
  }
  await actionsRanked(ui, color, 'tc:focus', ['tc:pickup'], ['tc:rename', 'tc:goal', 'tc:merge'])
  await ui.unmount()
})

test('the session card: its step in the topic colour, status in lower case (live in the accent), a sentence-case note label, Pick up the one tinted action', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  const color = kids((await boxesOf(ui, 'tb:')).find(c => c.id === CHECKOUT)?.box).find(k => k.text === '●')?.props.color
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await noShouting(ui)
  const box = (await boxesOf(ui, 'cd:')).find(b => b.id === 'session')?.box
  expect(rgbOf(box?.props.borderColor)).toBe(rgbOf(color))
  expect(rgbOf(box?.props.backgroundColor)).toBe(rgbOf(color))
  expect(alphaOf(box?.props.backgroundColor)).toBeLessThan(0.08)
  const head = kids((await boxesOf(ui, 'ch:')).find(b => b.id === 'session')?.box)
  expect(head.find(k => k.type === 'Text' && /^\d+$/.test(k.text))?.props.color).toBe(color)
  const status = head.find(k => k.type === 'Text' && /^(live|idle|archived)$/.test(k.text))
  expect(status).toBeDefined()
  if (status?.text === 'live') expect(status.props.color).toBe(ACCENT)
  else expect(status?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^Handoff note$/ })).toBeDefined()
  await actionsRanked(ui, color, 'sc:pickup', ['sc:draft', 'sc:new'], ['sc:pin', 'sc:move', 'sc:archive'])
  await ui.unmount()
})

test('the joined card: Focus my topic a chip in its colour, the others outlines; no primary slab', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  const color = kids((await boxesOf(ui, 'tb:')).find(c => c.id === CHECKOUT)?.box).find(k => k.text === '●')?.props.color
  await noShouting(ui)
  expect(rgbOf((await boxesOf(ui, 'cd:')).find(b => b.id === 'joined')?.box.props.borderColor)).toBe(rgbOf(color))
  await actionsRanked(ui, color, 'c:focus', ['c:change'], ['c:park'])
  await ui.unmount()
})

/** The List view's topic heads by id: each a Box holding its dot, a plain Button and the meta beside it. */
async function listHeads(ui: Ui) {
  return Object.fromEntries((await boxesOf(ui, 'lh:')).map(b => [b.id, b.box]))
}

test('the List view: each row a translucent hairline that lifts on hover, its head the dot, a plain Button with the name alone and the meta dim mono beside it; you and live in the accent', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  await ui.press({ key: 'view:list' })
  await noShouting(ui)
  const rows = Object.fromEntries((await boxesOf(ui, 'lr:')).map(b => [b.id, b.box]))
  const heads = await listHeads(ui)
  expect(Object.keys(heads).length).toBeGreaterThan(1)
  expect(Object.keys(rows).sort()).toEqual(Object.keys(heads).sort())
  for (const [id, head] of Object.entries(heads)) {
    const inside = kids(head)
    const dot = inside.find(k => k.type === 'Text' && k.text === '●')
    expect(dot?.props.color).toBeDefined()
    const name = inside.find(k => k.type === 'Button')
    expect(name?.key).toBe(`t:${id}`)
    expect(name?.props.plain).toBe(true)
    expect(name?.props.variant).toBeUndefined()
    expect(name?.children.filter(c => typeof c === 'object')).toEqual([])
    const meta = inside.find(k => k.type === 'Text' && /^(major|minor|unsorted) · \d+ sessions?/.test(k.text))
    expect(meta?.props.mono).toBe(true)
    expect(meta?.props.dimColor).toBe(true)
    expect(meta?.text).not.toMatch(/you/)
    const row = rows[id]
    expect(rgbOf(row?.props.borderColor)).not.toBe(rgbOf(CARD_BORDER))
    expect(alphaOf(row?.props.borderColor)).toBeLessThan(0.6)
    expect(hover(row).borderColor).toBeDefined()
    const live = inside.find(k => k.type === 'Text' && k.text === 'live')
    const you = inside.find(k => k.type === 'Text' && k.text === 'you')
    if (id === CHECKOUT) {
      expect(live?.props.color).toBe(ACCENT)
      expect(you?.props.color).toBe(ACCENT)
    } else {
      expect(live).toBeUndefined()
      expect(you).toBeUndefined()
    }
  }
  await ui.unmount()
})

test('the List view, a row open: a hairline and faint fill in its colour; each step a row with its number once, a plain Button and the age dim mono outside it; the selected step a strong chip; no primary slab', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  await ui.press({ key: 'view:list' })
  const color = kids((await listHeads(ui))[CHECKOUT]).find(k => k.text === '●')?.props.color
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await noShouting(ui)
  const row = (await boxesOf(ui, 'lr:')).find(b => b.id === CHECKOUT)?.box
  expect(rgbOf(row?.props.borderColor)).toBe(rgbOf(color))
  expect(rgbOf(row?.props.backgroundColor)).toBe(rgbOf(color))
  expect(alphaOf(row?.props.backgroundColor)).toBeLessThan(0.08)
  const steps = await boxesOf(ui, 'ls:')
  expect(steps.length).toBeGreaterThan(2)
  steps.forEach(({ id, box }, i) => {
    const inside = kids(box)
    const button = inside.find(k => k.type === 'Button')
    expect(button?.key).toBe(`s:${id}`)
    expect(button?.props.plain).toBe(true)
    expect(button?.props.variant).toBeUndefined()
    expect(button?.children.filter(c => typeof c === 'object')).toEqual([])
    expect(button?.text).not.toMatch(/^\d/)
    const number = inside.find(k => k.type === 'Text' && k.text === String(i + 1))
    if (button?.props.hotkey !== undefined) expect(number).toBeUndefined()
    else expect(number?.props.mono).toBe(true)
    expect(hover(box).backgroundColor).toBeDefined()
  })
  const selected = steps.find(s => s.id === IDS.tests)
  const other = steps.find(s => s.id !== IDS.tests && s.id !== 'you')
  expect(rgbOf(selected?.box.props.backgroundColor)).toBe(rgbOf(color))
  expect(alphaOf(selected?.box.props.borderColor)).toBeGreaterThan(alphaOf(other?.box.props.borderColor))
  const age = kids(other?.box).find(k => k.type === 'Text' && k.props.mono === true && /ago$|^\d+[smhd]$|^now$/.test(k.text))
  expect(age?.props.dimColor).toBe(true)
  const you = steps.find(s => s.id === 'you')
  expect(kids(you?.box).find(k => k.type === 'Text' && k.text === 'you')?.props.color).toBe(ACCENT)
  expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.variant === 'primary')).toEqual([])
  await ui.unmount()
})

test('the settings view: a sentence-case title in medium weight, sentence-case groups, a hairline card; each choice a chip, the chosen one tinted in the accent, the rest outlines; Done an outline; no primary slab', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'set:advanced' })
  await noShouting(ui)
  expect((await ui.find({ type: 'Text', text: /^Settings$/ }))?.props.weight).toBe('medium')
  for (const title of ['Map', 'Session', 'Advanced']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) })).toBeDefined()
  const card = (await boxesOf(ui, 'cd:')).find(b => b.id === 'settings')?.box
  expect(card?.props.borderColor).toBe(HAIRLINE)
  const done = (await boxesOf(ui, 'ob:')).find(b => b.id === 'settings:done')
  expect(kids(done?.box).find(k => k.type === 'Button')?.key).toBe('settings:done')
  const chosen = await boxesOf(ui, 'so:')
  const others = await boxesOf(ui, 'oo:')
  const buttons = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('set:') && b.key !== 'set:advanced')
  expect(chosen.length + others.length).toBe(buttons.length)
  expect(new Set(chosen.map(c => c.id.split(':')[0])).size).toBe(chosen.length)
  for (const { box } of chosen) {
    expect(rgbOf(box.props.backgroundColor)).toBe(rgbOf(ACCENT))
    expect(alphaOf(box.props.backgroundColor)).toBeLessThan(0.3)
    expect(kids(box).find(k => k.type === 'Button')?.props.plain).toBe(true)
  }
  for (const { box } of others) {
    expect(box.props.borderStyle).toBe('round')
    expect(rgbOf(box.props.borderColor)).not.toBe(rgbOf(ACCENT))
    expect(hover(box).borderColor).toBeDefined()
  }
  await ui.press({ key: 'set:numbering:newestFirst' })
  expect((await boxesOf(ui, 'so:')).some(b => b.id === 'numbering:newestFirst')).toBe(true)
  expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.variant === 'primary')).toEqual([])
  await ui.unmount()
})

test('terminal: every topic and header button still shows, no chip draws a border, and the current view still stands out', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($, 'terminal')
  for (const key of ['view:map', 'view:list', 'settings', 'help', 'mine']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  const topics = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('t:'))
  expect(topics.length).toBeGreaterThan(1)
  for (const b of topics) expect(b.text.length).toBeGreaterThan(0)
  for (const prefix of ['hb:', 'tb:', 'rb:']) {
    const boxes = await boxesOf(ui, prefix)
    expect(boxes.length).toBeGreaterThan(0)
    for (const { box } of boxes) expect(box.props.borderStyle).toBeUndefined()
  }
  expect((await ui.find({ type: 'Button', key: 'view:map' }))?.props.variant).toBe('primary')
  // The cards keep every action; there the one main action stays reversed, as the current view does.
  for (const key of ['c:focus', 'c:change', 'c:park']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'c:focus' }))?.props.variant).toBe('primary')
  await ui.press({ key: `t:${CHECKOUT}` })
  for (const key of ['tc:focus', 'tc:pickup', 'tc:rename', 'tc:goal', 'tc:merge']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'tc:focus' }))?.props.variant).toBe('primary')
  for (const prefix of ['pb:', 'ob:']) for (const { box } of await boxesOf(ui, prefix)) expect(box.props.borderStyle).toBeUndefined()
  await ui.press({ key: `s:${IDS.tests}` })
  for (const key of ['sc:pickup', 'sc:draft', 'sc:new', 'sc:pin', 'sc:move', 'sc:archive']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'sc:pickup' }))?.props.variant).toBe('primary')
  // Settings: every choice still a button, the chosen one reversed, no chip border.
  await ui.press({ key: 'settings' })
  expect((await ui.find({ type: 'Button', key: 'set:numbering:oldestFirst' }))?.props.variant).toBe('primary')
  expect((await ui.find({ type: 'Button', key: 'set:numbering:newestFirst' }))?.props.variant).toBeUndefined()
  const choices = [...(await boxesOf(ui, 'so:')), ...(await boxesOf(ui, 'oo:'))]
  expect(choices.length).toBeGreaterThan(5)
  for (const { box } of choices) expect(box.props.borderStyle).toBeUndefined()
  await ui.unmount()
})

test('the band asking for a note: a card in the topic colour with a medium sentence-case title, the field, Skip an outline and a dim footnote; no primary slab', { options: { handoffNotes: 'ask' } }, async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  const color = kids((await boxesOf(ui, 'tb:')).find(c => c.id === CHECKOUT)?.box).find(k => k.text === '●')?.props.color
  await ui.unmount()
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  const band = await $.ui.mount(bandOn('desktop'))
  const card = (await boxesOf(band, 'cd:')).find(b => b.id === 'park')?.box
  expect(rgbOf(card?.props.borderColor)).toBe(rgbOf(color))
  expect(alphaOf(card?.props.borderColor)).toBeLessThan(0.5)
  expect(alphaOf(card?.props.backgroundColor)).toBeLessThan(0.1)
  expect((await band.find({ type: 'Text', text: /^Park a handoff note$/ }))?.props.weight).toBe('medium')
  expect(await band.find({ type: 'Input', key: 'park' })).toBeDefined()
  const skip = (await boxesOf(band, 'ob:')).find(b => b.id === 'park:skip')?.box
  expect(skip?.props.borderStyle).toBe('round')
  expect(kids(skip).find(k => k.type === 'Button')?.props.plain).toBe(true)
  expect((await band.findAll({ type: 'Text' })).some(t => t.props.dimColor === true && t.props.size === 'footnote')).toBe(true)
  await noShouting(band)
  expect((await band.findAll({ type: 'Button' })).filter(b => b.props.variant === 'primary')).toEqual([])
  await band.unmount()
})

test('the band naming a new topic: a hairline card with a medium sentence-case title, the field, Cancel an outline and a dim footnote', async ($, hooks) => {
  stubEngine(hooks)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount(bandOn('desktop'))
  await band.press({ key: 'j:new' })
  const card = (await boxesOf(band, 'cd:')).find(b => b.id === 'name')?.box
  expect(card?.props.borderColor).toBe(HAIRLINE)
  expect((await band.find({ type: 'Text', text: /^Name a new topic$/ }))?.props.weight).toBe('medium')
  expect(await band.find({ type: 'Input', key: 'topicname' })).toBeDefined()
  const cancel = (await boxesOf(band, 'ob:')).find(b => b.id === 'topicname:cancel')?.box
  expect(cancel?.props.borderStyle).toBe('round')
  expect(kids(cancel).find(k => k.type === 'Button')?.props.plain).toBe(true)
  expect((await band.findAll({ type: 'Text' })).some(t => t.props.dimColor === true && t.props.size === 'footnote')).toBe(true)
  await noShouting(band)
  await band.unmount()
})

test('a toast: a translucent hairline card in no topic colour, the done mark dim, Undo an outline chip and Dismiss plain dim; a refusal wears the problem mark and colour', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: `s:${IDS.tests}` })
  await ui.press({ key: 'sc:archive' })
  const done = (await boxesOf(ui, 'cd:')).find(b => b.id === 'toast')?.box
  expect(done?.props.borderColor).toBe(HAIRLINE)
  expect(PALETTE.map(rgbOf)).not.toContain(rgbOf(done?.props.backgroundColor))
  expect(alphaOf(done?.props.backgroundColor)).toBeLessThan(0.1)
  expect(kids(done).find(k => k.text === '✓')?.props.color).toBe(MUTED)
  const undo = (await boxesOf(ui, 'ob:')).find(b => b.id === 'toast:undo')?.box
  expect(undo?.props.borderStyle).toBe('round')
  expect(kids(undo).find(k => k.type === 'Button')?.props.plain).toBe(true)
  const dismiss = await ui.find({ type: 'Button', key: 'toast:dismiss' })
  expect(dismiss?.props.plain).toBe(true)
  expect(dismiss?.props.dimColor).toBe(true)
  await ui.press({ key: 'back' })
  await ui.press({ key: `t:${CHECKOUT}` })
  await ui.press({ key: 'tc:merge' })
  await ui.press({ key: `t:${CHECKOUT}` })
  const refused = (await boxesOf(ui, 'cd:')).find(b => b.id === 'toast')?.box
  expect(rgbOf(refused?.props.borderColor)).toBe(rgbOf(PROBLEM))
  expect(kids(refused).find(k => k.text === '!')?.props.color).toBe(PROBLEM)
  expect([...PALETTE, ACCENT].map(rgbOf)).not.toContain(rgbOf(PROBLEM))
  await ui.unmount()
})

test('a toast that failed shows the reason alone, not the error class', async ($, hooks) => {
  expect(reasonOf(new Error('no composer'))).toBe('no composer')
  expect(reasonOf('plain words')).toBe('plain words')
})

/** The empty-state card: a hairline, a medium sentence-case title and one dim line under it. */
async function emptyCard(ui: Parameters<typeof boxesOf>[0]) {
  const card = (await boxesOf(ui, 'cd:')).find(b => b.id === 'empty')?.box
  expect(card?.props.borderColor).toBe(HAIRLINE)
  expect(card?.props.borderStyle).toBe('round')
  const [title, line] = kids(card)
  expect(title?.props.weight).toBe('medium')
  expect(line?.props.dimColor).toBe(true)
  return { title: title?.text ?? '', line: line?.text ?? '' }
}

test('an empty folder: the List view says so in a hairline card, a medium title and one dim line; the field draws a faint unformed constellation over its title', async ($, hooks) => {
  stubEngine(hooks, { files: {} })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toMatch(/<g class="empty"[^>]*>(<path[^>]*\/>)?(<circle[^>]*\/>){3,}/)
  expect(source).toContain('No sessions on this map yet')
  // Nothing to hover and nothing to tell apart: no pointer hint and no legend.
  expect(source).not.toContain('Hover a topic')
  expect(source).not.toContain('>shipped<')
  await ui.press({ key: 'view:list' })
  const { title, line } = await emptyCard(ui)
  expect(title).toBe('No sessions on this map yet')
  expect(line).toContain('/topic')
  await noShouting(ui)
  await ui.unmount()
})

test('a search that matches nothing: the List view names the search in the card and says what it looks through', async ($, hooks) => {
  stubEngine(hooks)
  const ui = await joined($)
  await ui.press({ key: 'view:list' })
  await ui.input({ key: 'q', text: 'zzqx', kind: 'change' })
  const { title, line } = await emptyCard(ui)
  expect(title).toBe('Nothing matches “zzqx”')
  expect(line).toMatch(/titles.*notes/)
  expect(await ui.find({ type: 'Button', key: 'q:clear' })).toBeDefined()
  await ui.unmount()
})

test('a topic with no sessions yet: its card says so in a dim line that tells what will fill it, and how related topics come', async ($, hooks) => {
  stubEngine(hooks, { files: {} })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await run($, 'topic', 'Fresh start')
  const ui = await $.ui.mount(paneOn('desktop'))
  const chip = (await ui.findAll({ type: 'Button' })).find(b => b.text === 'Fresh start' && b.key?.startsWith('t:'))
  expect(chip).toBeDefined()
  await ui.press({ key: chip!.key! })
  const empty = await ui.find({ type: 'Text', text: /^No sessions yet/ })
  expect(empty?.props.dimColor).toBe(true)
  expect(empty?.text).toMatch(/join/)
  // No related topics: one dim sentence saying how they come, not a bare "related none".
  expect(await ui.find({ type: 'Text', text: /^none$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^No related topics yet/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

// Two topics whose names differ only in the last word (as uniqueNames makes them) and a hub they both touch.
const RETRY = 'Cashfree Payment Gateway Webhook Signature Retry'
const REFUND = 'Cashfree Payment Gateway Webhook Signature Refund'
/** The rounding transcript as another session: same files, its own id. */
function copyOf(id: string): string {
  return (transcripts['checkout-rounding'] ?? '').split(IDS.rounding).join(id)
}
const TWINS = {
  files: {
    ...FIXTURE_FILES,
    '66666666-aaaa-4bbb-8ccc-000000000006': { text: copyOf('66666666-aaaa-4bbb-8ccc-000000000006'), mtime: '2026-10-19T12:00:00.000Z' },
    '77777777-aaaa-4bbb-8ccc-000000000007': { text: copyOf('77777777-aaaa-4bbb-8ccc-000000000007'), mtime: '2026-10-19T13:00:00.000Z' },
  },
  store: {
    topics: { 'topic:hub': { name: 'Checkout', createdAt: 1 }, 'topic:retry': { name: RETRY, createdAt: 2 }, 'topic:refund': { name: REFUND, createdAt: 3 } },
    assign: { [IDS.tests]: 'topic:hub', [IDS.rounding]: 'topic:hub', '66666666-aaaa-4bbb-8ccc-000000000006': 'topic:retry', '77777777-aaaa-4bbb-8ccc-000000000007': 'topic:refund' },
  },
}

/** The labels the two twin topics' Buttons with this key prefix carry, retry first. */
async function twinLabels(ui: { findAll: (query: { type: 'Button' }) => Promise<FoundElement[]> }, prefix: string) {
  const buttons = await ui.findAll({ type: 'Button' })
  return ['topic:retry', 'topic:refund'].map(id => buttons.find(b => b.key === `${prefix}${id}`)?.props.label as string | undefined)
}

function apart([retry, refund]: (string | undefined)[]) {
  expect(retry).toBeDefined()
  expect(refund).toBeDefined()
  expect(retry).not.toBe(refund)
  expect(retry?.endsWith('Retry')).toBe(true)
  expect(refund?.endsWith('Refund')).toBe(true)
}

test('two topics told apart by their last word keep it on every chip: the join chooser, the buttons under the map, the List, the related chips and the merge hint', async ($, hooks) => {
  stubEngine(hooks, TWINS)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await submit($, 'the cashfree webhook signature check fails again')
  const band = await $.ui.mount(bandOn('desktop'))
  apart(await twinLabels(band, 'j:'))
  await band.unmount()
  const ui = await $.ui.mount(paneOn('desktop'))
  if (await ui.find({ type: 'Button', key: 'back' })) await ui.press({ key: 'back' })
  apart(await twinLabels(ui, 't:'))
  await ui.press({ key: 'view:list' })
  apart(await twinLabels(ui, 't:'))
  await ui.press({ key: 'view:map' })
  await ui.press({ key: 't:topic:hub' })
  apart(await twinLabels(ui, 'rel:'))
  apart(await twinLabels(ui, 'a:'))
  // Merging one twin: the hint names it by its last word too.
  await ui.press({ key: 'back' })
  await ui.press({ key: 't:topic:retry' })
  await ui.press({ key: 'tc:merge' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/Merging [^<]+ Retry: pick/)
  await ui.unmount()
})

test('the band asking for a note names a long topic by its last word too', { options: { handoffNotes: 'ask' } }, async ($, hooks) => {
  stubEngine(hooks, { ...TWINS, store: { ...TWINS.store, assign: { ...TWINS.store.assign, [ME]: 'topic:retry' } } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  const band = await $.ui.mount(bandOn('desktop'))
  const head = kids((await boxesOf(band, 'cd:')).find(b => b.id === 'park')?.box)
  expect((await band.findAll({ type: 'Text' })).some(t => t.props.mono === true && t.text.endsWith(' Retry'))).toBe(true)
  expect(head.length).toBeGreaterThan(0)
  await band.unmount()
})
