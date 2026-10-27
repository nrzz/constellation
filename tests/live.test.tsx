// The live picture: the field Svg drawn in the Desktop's script-less frame (`isInteractive`), so hover and motion work in
// CSS; no pointer layer lies over it. The click picture (the image plus the Client layer) stays as `pictureMode: clicks`.
import { expect, test } from 'claude-code/testing'

import { EMPTY_STORE, buildModel } from '../hooks/cluster'
import { placementOf } from '../hooks/actions'
import { pointerHint, svgOf } from '../hooks/draw'
import { DEFAULT_SETTINGS, INITIAL_ME, INITIAL_UI, INITIAL_USAGE, settingValue } from '../hooks/state'
import type { SessionSummary } from '../types'
import { CWD, NOW, paneOn, stubEngine } from './helpers'

test('live is the default: the Desktop picture is interactive and no Client layer lies over it', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  expect(DEFAULT_SETTINGS.pictureMode).toBe('live')
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBe(true)
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeUndefined()
  await ui.unmount()
})

test('live on VS Code: the picture is interactive too', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(paneOn('vscode'))
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBe(true)
  await ui.unmount()
})

test('clicks: the picture is an image with the Client layer over it, as before', { options: { pictureMode: 'clicks' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeDefined()
  await ui.unmount()
})

test('the terminal keeps its text map in either mode', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneOn('terminal'))
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('the live hint says hover traces and the button under the map focuses', () => {
  const settings = { ...DEFAULT_SETTINGS }
  expect(pointerHint({ surface: 'desktop', placement: 'dock', settings })).toBe('Hover a topic to trace it · its button below focuses it')
  expect(pointerHint({ surface: 'vscode', placement: 'dock', settings })).toBe('Hover a topic to trace it · its button below focuses it')
  expect(pointerHint({ surface: 'desktop', placement: 'dock', settings: { ...settings, pictureMode: 'clicks' } })).toBe('Hover or focus a topic to trace it · Enter or click to focus')
  expect(pointerHint({ surface: 'terminal', placement: 'dock', settings })).toBe('Click or Tab to a topic · Enter focuses')
})

test('pictureMode reads live or clicks and nothing else', () => {
  expect(settingValue('pictureMode', 'clicks')).toBe('clicks')
  expect(settingValue('pictureMode', 'live')).toBe('live')
  expect(settingValue('pictureMode', 'canvas')).toBeUndefined()
})

test('the settings view offers Picture: Live / Clicks under ADVANCED, and a press switches the picture', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Button', key: 'set:pictureMode:clicks' })).toBeUndefined()
  await ui.press({ key: 'set:advanced' })
  expect(await ui.find({ type: 'Text', text: /^Picture/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'set:pictureMode:live' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'set:pictureMode:clicks' })
  expect((await ui.find({ type: 'Button', key: 'set:pictureMode:clicks' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'settings:done' })
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeDefined()
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBeUndefined()
  await ui.unmount()
})

/** Three major topics (one with a goal, one with a parked note, one with neither), the first two sharing a file. */
function liveView(settings = DEFAULT_SETTINGS) {
  const sessions: SessionSummary[] = []
  const store = { ...EMPTY_STORE, topics: {} as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string>, goals: { 'topic:a': 'Ship the <live> pane' } as Record<string, string>, notes: { 'b-0': { text: 'Left off at the caption', at: NOW, source: 'manual' as const } } }
  for (const [t, name, file] of [['a', 'Alpha work', 'src/shared.ts'], ['b', 'Beta work', 'src/shared.ts'], ['c', 'Gamma work', 'src/own.ts']] as const) {
    store.topics[`topic:${t}`] = { name, createdAt: 0 }
    for (let k = 0; k < 3; k += 1) {
      const id = `${t}-${k}`
      const lastAt = NOW - (k + 1) * 3600_000
      sessions.push({ id, cwd: CWD, slug: 'x', branch: 'main', firstPrompt: id, title: `Session ${id}`, startedAt: lastAt - 3600_000, lastAt, turns: 2, filesTouched: [k === 0 ? file : `src/${t}${k}.ts`], lastAssistantText: 'done', size: 1, mtimeMs: lastAt })
      store.assign[id] = `topic:${t}`
    }
  }
  const model = buildModel(sessions, store, settings, NOW, 'me')
  const placement = placementOf(model, null)
  return { model, placed: placement.placed, field: placement.size, ui: INITIAL_UI, me: { ...INITIAL_ME, sessionId: 'me' }, settings, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
}

test('live: each topic is one group with its pill and satellites, and a hover rule of its own traces it', () => {
  const view = liveView()
  const svg = svgOf(view)
  view.model.topics.forEach((t, i) => {
    const group = svg.split(`<g class="t t-${i}"`)[1]?.split('<g class="t t-')[0] ?? ''
    expect(group).toContain('class="pill')
    expect(group).toContain('class="s ')
    expect(svg).toContain(`.t-${i}:hover .ln{stroke:${t.color}`)
    expect(svg).toContain(`.f:has(.t-${i}:hover) .c-${i}{opacity:1}`)
  })
  // Hovering brightens the pill, fades the rest and swaps the hint for the caption.
  expect(svg).toContain('.t:hover .pill{fill:var(--tx)!important}')
  expect(svg).toContain('.f:has(.t:hover) .t:not(:hover){opacity:.15}')
  expect(svg).toContain('.f:has(.t:hover) .hint{opacity:0}')
  // The two topics sharing a file: the link lights in the hovered topic's colour.
  expect(view.model.links.length).toBeGreaterThan(0)
  const a = view.model.topics.findIndex(t => t.id === 'topic:a')
  expect(svg).toContain(`.f:has(.t-${a}:hover) .x-${a}{stroke:${view.model.topicById['topic:a']?.color}`)
  expect(svg).not.toMatch(/\son[a-z]+=/i)
  expect(svg).not.toContain('<script')
})

test('live: the caption is the goal, else the latest note, else the count and last activity; each text from the topic, escaped', () => {
  const view = liveView()
  const svg = svgOf(view)
  const cap = (id: string) => svg.split(`<g class="cap c-${view.model.topics.findIndex(t => t.id === id)}"`)[1]?.split('</g>')[0] ?? ''
  expect(cap('topic:a')).toContain('Ship the &lt;live&gt; pane')
  expect(cap('topic:b')).toContain('Left off at the caption')
  expect(cap('topic:c')).toContain('3 sessions · last 1h ago')
  // Class names come from the index, never the topic's text.
  expect(svg).not.toMatch(/class="[^"]*(Alpha|alpha)/)
})

test('clicks: no hover tracing rules and no captions in the picture', () => {
  const svg = svgOf(liveView({ ...DEFAULT_SETTINGS, pictureMode: 'clicks' }))
  expect(svg).not.toContain('.f:has(')
  expect(svg).not.toContain('class="cap ')
})
