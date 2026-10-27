// The join chooser (the band and the pane's chooser): translucent chips tinted in each topic's own colour,
// the name a plain Button with the count outside it, the suggestion a quiet word in its colour, the actions
// in their own group after the topics, and no accent outline on the card.
import { expect, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

import { ACCENT } from '../hooks/cluster'
import { CHECKOUT, CWD, FIXTURE_FILES, bandOn, paneOn, stubEngine, submit } from './helpers'

const ACTIONS = ['j:new', 'j:map', 'j:dismiss', 'j:more']
/** The fixtures plus a second orders session, so the folder holds two topics and the suggestion has a rival. */
const FILES = { ...FIXTURE_FILES, '55555555-aaaa-4bbb-8ccc-000000000005': { key: 'orders-pagination', mtime: '2026-10-19T16:00:00.000Z' } }

/** The rgb triple of a `#rrggbb` or an `rgba(...)`, to compare a tint with the colour it came from. */
function rgbOf(color: unknown): string {
  const s = String(color)
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s)
  if (m) return `${m[1]},${m[2]},${m[3]}`
  const hex = s.replace('#', '')
  const n = Number.parseInt(hex.slice(0, 6), 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

function alphaOf(color: unknown): number {
  const m = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(String(color))
  return m ? Number(m[1]) : 1
}

type Raw = { type: string; props?: Record<string, unknown>; children?: unknown[] }

/** An element's child elements, read as `find` reads elements: children arrive as raw descriptions. */
function kids(el: FoundElement | undefined): FoundElement[] {
  return (el?.children ?? [])
    .filter((c): c is Raw => typeof c === 'object' && c !== null && 'type' in c)
    .map(c => {
      const props = c.props ?? {}
      const strings = (c.children ?? []).filter((x): x is string => typeof x === 'string').join('')
      return { type: c.type, key: typeof props.key === 'string' ? props.key : undefined, props, text: strings || (typeof props.label === 'string' ? props.label : ''), children: c.children ?? [] }
    })
}

/** The topic chips, from the drawing itself: `find` leaves out an element's `hover`, which sits beside its props. */
async function chipsOf(ui: { drawn: () => Promise<unknown> }): Promise<{ id: string; box: FoundElement }[]> {
  const out: { id: string; box: FoundElement }[] = []
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const el = n as Raw & { hover?: unknown }
    const key = el.props?.key
    if (el.type === 'Box' && typeof key === 'string' && key.startsWith('jc:')) {
      out.push({ id: key.slice(3), box: { type: 'Box', key, props: { ...el.props, hover: el.hover }, text: '', children: el.children ?? [] } })
    }
    for (const c of el.children ?? []) walk(c)
  }
  walk(await ui.drawn())
  return out
}

async function suggested($: Engine) {
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await submit($, 'the flaky cart wait in the checkout tests is back')
}

for (const where of ['band', 'pane'] as const) {
  const on = where === 'band' ? bandOn : paneOn

  test(`${where}: each topic is a Box chip tinted in its own colour, a plain Button inside, the count outside it`, async ($, hooks) => {
    stubEngine(hooks, { files: FILES })
    await suggested($)
    const ui = await $.ui.mount(on('desktop'))
    const chips = await chipsOf(ui)
    expect(chips.length).toBeGreaterThan(1)
    for (const { id, box } of chips) {
      const inside = kids(box)
      const dot = inside.find(k => k.type === 'Text' && k.text === '●')
      expect(dot).toBeDefined()
      const rgb = rgbOf(dot?.props.color)
      expect(rgbOf(box.props.backgroundColor)).toBe(rgb)
      expect(rgbOf(box.props.borderColor)).toBe(rgb)
      expect(alphaOf(box.props.backgroundColor)).toBeLessThan(0.25)
      const hover = box.props.hover as { backgroundColor?: string; borderColor?: string } | undefined
      expect(rgbOf(hover?.backgroundColor)).toBe(rgb)
      expect(alphaOf(hover?.backgroundColor)).toBeGreaterThan(alphaOf(box.props.backgroundColor))
      // A border already at full strength (the suggestion's) has nowhere to go.
      expect(alphaOf(hover?.borderColor)).toBeGreaterThanOrEqual(alphaOf(box.props.borderColor))
      if (alphaOf(box.props.borderColor) < 1) expect(alphaOf(hover?.borderColor)).toBeGreaterThan(alphaOf(box.props.borderColor))
      const name = inside.find(k => k.type === 'Button')
      expect(name?.key).toBe(`j:${id}`)
      expect(name?.props.plain).toBe(true)
      expect(name?.props.variant).toBeUndefined()
      expect(name?.text).not.toMatch(/\d+ ·|ago|suggested/i)
      const meta = inside.find(k => k.type === 'Text' && /^\d+( · \S+)?$/.test(k.text))
      expect(meta?.props.mono).toBe(true)
      expect(meta?.props.dimColor).toBe(true)
    }
    await ui.unmount()
  })

  test(`${where}: the suggestion is a stronger chip with a quiet lower-case word in its colour; no primary slab, no capitals`, async ($, hooks) => {
    stubEngine(hooks, { files: FILES })
    await suggested($)
    const ui = await $.ui.mount(on('desktop'))
    expect(await ui.find({ type: 'Text', text: /SUGGESTED/ })).toBeUndefined()
    expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('j:') && b.props.variant === 'primary')).toEqual([])
    const chips = await chipsOf(ui)
    const best = chips.find(c => c.id === CHECKOUT)
    const other = chips.find(c => c.id !== CHECKOUT)
    expect(best).toBeDefined()
    expect(chips[0]?.id).toBe(CHECKOUT)
    const word = kids(best?.box).find(k => k.type === 'Text' && k.text === 'suggested')
    expect(word).toBeDefined()
    expect(rgbOf(word?.props.color)).toBe(rgbOf(best?.box.props.borderColor))
    expect(alphaOf(best?.box.props.backgroundColor)).toBeGreaterThan(alphaOf(other?.box.props.backgroundColor))
    expect(alphaOf(best?.box.props.borderColor)).toBe(1)
    expect(kids(other?.box).some(k => k.text === 'suggested')).toBe(false)
    await ui.unmount()
  })

  test(`${where}: the card is outlined in a hairline, not the accent; a short header; the actions come after every topic`, async ($, hooks) => {
    stubEngine(hooks, { files: FILES })
    await suggested($)
    const ui = await $.ui.mount(on('desktop'))
    const card = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round' && !b.key)
    expect(card).toBeDefined()
    expect(rgbOf(card?.props.borderColor)).not.toBe(rgbOf(ACCENT))
    const title = await ui.find({ type: 'Text', text: /^Continue a topic$/ })
    expect(title?.props.weight).toBe('medium')
    const order = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('j:'))
    const lastTopic = Math.max(...order.map((k, i) => (ACTIONS.includes(k) ? -1 : i)))
    const firstAction = order.findIndex(k => ACTIONS.includes(k))
    expect(firstAction).toBeGreaterThan(lastTopic)
    const actions = (await ui.findAll({ type: 'Box' })).find(b => b.key === 'j-actions')
    expect(kids(actions).length).toBeGreaterThan(0)
    expect(await ui.find({ type: 'Text', text: /SUGGESTED/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('band: "+ New topic" is an outline chip, "Open map" and "Dismiss" plain; every hotkey stays', async ($, hooks) => {
  stubEngine(hooks, { files: FILES })
  await suggested($)
  const ui = await $.ui.mount(bandOn('desktop'))
  const outline = (await ui.findAll({ type: 'Box' })).find(b => b.key === 'j-new')
  expect(outline?.props.borderStyle).toBe('round')
  expect(kids(outline).find(k => k.type === 'Button')?.key).toBe('j:new')
  const byKey = async (key: string) => ui.find({ type: 'Button', key })
  expect((await byKey('j:new'))?.props.plain).toBe(true)
  expect((await byKey('j:new'))?.props.hotkey).toBe('n')
  expect((await byKey('j:map'))?.props.plain).toBe(true)
  expect((await byKey('j:map'))?.props.hotkey).toBe('o')
  expect((await byKey('j:dismiss'))?.props.plain).toBe(true)
  expect((await byKey(`j:${CHECKOUT}`))?.props.hotkey).toBe('1')
  await ui.unmount()
})

test('terminal band: every topic name and digit still shows, and the actions', async ($, hooks) => {
  stubEngine(hooks, { files: FILES })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await submit($, 'the flaky cart wait in the checkout tests is back')
  const ui = await $.ui.mount(bandOn('terminal'))
  const topics = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('j:') && !ACTIONS.includes(b.key ?? ''))
  expect(topics.length).toBeGreaterThan(1)
  topics.forEach((b, i) => {
    expect(b.props.hotkey).toBe(String(i + 1))
    expect(b.text.length).toBeGreaterThan(0)
  })
  for (const key of ['j:new', 'j:map', 'j:dismiss']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  await ui.unmount()
})
