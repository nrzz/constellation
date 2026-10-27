// The pane's header and the buttons under the picture, to the join chooser's standard: a topic's own colour
// carries its identity (dot, tint, hairline), the accent marks only you, live and the current selection, no
// solid `primary` slabs, translucent chips that lift on hover, meta dim and mono outside the Buttons, and no
// capitals in labels. The terminal keeps every button and draws no borders (a border costs it two rows).
import { expect, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

import { ACCENT } from '../hooks/cluster'
import { CHECKOUT, CWD, IDS, alphaOf, boxesOf, kids, paneOn, rgbOf, run, stubEngine } from './helpers'

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
async function noShouting(ui: Ui, cards: string[] = []) {
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
  await noShouting(ui, ['RELATED', 'IDLE', 'ACTIVE', 'HANDOFF NOTE', 'LARGE TRANSCRIPT'])
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
  await ui.unmount()
})
