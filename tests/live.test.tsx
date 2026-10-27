// The live picture: the field Svg drawn in the Desktop's script-less frame (`isInteractive`), so hover and motion work in
// CSS; no pointer layer lies over it. The click picture (the image plus the Client layer) stays as `pictureMode: clicks`.
import { expect, test } from 'claude-code/testing'

import { ACCENT, EMPTY_STORE, buildModel, satellitesPerTopic } from '../hooks/cluster'
import { handoffText, placementOf } from '../hooks/actions'
import { captionOf, fieldOf, pointerHint, sessionMeta, svgOf } from '../hooks/draw'
import { DEFAULT_SETTINGS, INITIAL_ME, INITIAL_UI, INITIAL_USAGE, settingValue } from '../hooks/state'
import type { SessionSummary } from '../types'
import { CWD, NOW, boxesOf, paneOn, stubEngine } from './helpers'

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

test('the settings view offers Picture: Live / Clicks under Advanced, and a press switches the picture', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Button', key: 'set:pictureMode:clicks' })).toBeUndefined()
  await ui.press({ key: 'set:advanced' })
  expect(await ui.find({ type: 'Text', text: /^Picture/ })).toBeDefined()
  // The chosen value is the accent chip around its Button.
  const chosen = async () => (await boxesOf(ui, 'so:pictureMode:')).map(b => b.id)
  expect(await chosen()).toEqual(['live'])
  await ui.press({ key: 'set:pictureMode:clicks' })
  expect(await chosen()).toEqual(['clicks'])
  await ui.press({ key: 'settings:done' })
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeDefined()
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBeUndefined()
  await ui.unmount()
})

/** Three major topics (one with a goal, one with a parked note, one with neither), the first two sharing a file. */
function liveView(settings = DEFAULT_SETTINGS, running: readonly string[] = [], extra: { archived?: readonly string[]; you?: string; youTopic?: string } = {}) {
  const sessions: SessionSummary[] = []
  const archived = Object.fromEntries((extra.archived ?? []).map(id => [id, true])) as Record<string, true>
  const store = { ...EMPTY_STORE, archived, topics: {} as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string>, goals: { 'topic:a': 'Ship the <live> pane' } as Record<string, string>, notes: { 'b-0': { text: 'Left off at the caption', at: NOW, source: 'manual' as const } } }
  for (const [t, name, file] of [['a', 'Alpha work', 'src/shared.ts'], ['b', 'Beta work', 'src/shared.ts'], ['c', 'Gamma work', 'src/own.ts']] as const) {
    store.topics[`topic:${t}`] = { name, createdAt: 0 }
    for (let k = 0; k < 3; k += 1) {
      const id = `${t}-${k}`
      const lastAt = running.includes(id) ? NOW - 60_000 : NOW - (k + 1) * 3600_000
      sessions.push({ id, cwd: CWD, slug: 'x', branch: 'main', firstPrompt: id, title: `Session ${id}`, startedAt: lastAt - 3600_000, lastAt, turns: 2, filesTouched: [k === 0 ? file : `src/${t}${k}.ts`], lastAssistantText: 'done', size: 1, mtimeMs: lastAt })
      store.assign[id] = `topic:${t}`
    }
  }
  const you = extra.you ?? 'me'
  const model = buildModel(sessions, store, settings, NOW, you)
  const placement = placementOf(model, null)
  return { model, placed: placement.placed, field: placement.size, ui: INITIAL_UI, me: { ...INITIAL_ME, sessionId: you, topicId: extra.youTopic ?? null }, settings, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
}

test('live: each topic is one group with its pill and satellites, and a hover rule of its own traces it', () => {
  const view = liveView()
  const svg = svgOf(view)
  view.model.topics.forEach((t, i) => {
    const group = svg.split(new RegExp(`<g class="t t-${i}[ "]`))[1]?.split('<g class="t t-')[0] ?? ''
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
  const cap = (id: string) => svg.split(new RegExp(`<g class="cap c-${view.model.topics.findIndex(t => t.id === id)}[ "]`))[1]?.split('</g>')[0] ?? ''
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

test('live focus: each step and anchor is a group that brightens on hover, and its meta takes the hint place', () => {
  const base = liveView()
  const view = { ...base, ui: { ...INITIAL_UI, focusTopic: 'topic:a' } }
  const svg = svgOf(view)
  for (let i = 0; i < 3; i += 1) {
    expect(svg).toContain(`class="n hit st st-${i}"`)
    expect(svg).toContain(`.f:has(.st-${i}:hover) .q-${i}{opacity:1}`)
  }
  // The step's caption: its number, its title and its meta.
  const q0 = svg.split('<g class="cap q-0"')[1]?.split('</g>')[0] ?? ''
  expect(q0).toMatch(/1 · Session a-\d · /)
  expect(svg).toContain('.f:has(.st:hover,.an:hover) .hint{opacity:0}')
  expect(svg).toContain('.st:hover .ring{stroke-width:3px}')
  // Beta shares a file with Alpha: its anchor traces too, its caption is its own.
  expect(svg).toContain('class="hit an an-0"')
  expect(svg).toContain('.f:has(.an-0:hover) .r-0{opacity:1}')
  expect(svg.split('<g class="cap r-0"')[1]?.split('</g>')[0] ?? '').toContain('Left off at the caption')
  expect(svg).not.toMatch(/\son[a-z]+=/i)
  // Clicks: none of it.
  const clicks = svgOf({ ...view, settings: { ...DEFAULT_SETTINGS, pictureMode: 'clicks' } })
  expect(clicks).not.toContain(' st st-')
  expect(clicks).not.toContain('class="cap ')
})

/** A big folder: `topics` topics of `each` sessions, every one with a parked note full of characters to escape. */
function bigView(topics: number, each: number) {
  const sessions: SessionSummary[] = []
  const store = { ...EMPTY_STORE, topics: {} as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string>, notes: {} as Record<string, { text: string; at: number; source: 'manual' }> }
  for (let t = 0; t < topics; t += 1) {
    store.topics[`topic:t${t}`] = { name: `Topic number ${t} with a long name`, createdAt: t }
    for (let k = 0; k < each; k += 1) {
      const id = `s-${t}-${k}`
      const lastAt = NOW - (t * 10 + k) * 3600_000
      sessions.push({ id, cwd: CWD, slug: 'x', branch: `feat/${t}`, firstPrompt: `work ${k}`, title: `Work item ${k} for topic ${t}, with a long title to render`, startedAt: lastAt - 3600_000, lastAt, turns: k, filesTouched: [`src/t${t}/file${k}.ts`], lastAssistantText: 'done', size: 1, mtimeMs: lastAt })
      store.assign[id] = `topic:t${t}`
      store.notes[id] = { text: 'a <parked> note & '.repeat(9), at: lastAt, source: 'manual' }
    }
  }
  const model = buildModel(sessions, store, DEFAULT_SETTINGS, NOW, 'me')
  const placement = placementOf(model, null)
  return { model, placed: placement.placed, field: placement.size, ui: INITIAL_UI, me: { ...INITIAL_ME, sessionId: 'me' }, settings: DEFAULT_SETTINGS, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
}

const satellites = (svg: string) => (svg.match(/class="s n hit[ "]/g) ?? []).length

/** A folder of `topics` topics of `each` sessions, every one written this minute (or `ago` before): each satellite running, the heaviest it draws. */
function runningView(topics: number, each: number, settings = DEFAULT_SETTINGS, ago = 0) {
  const sessions: SessionSummary[] = []
  const store = { ...EMPTY_STORE, topics: {} as Record<string, { name: string; createdAt: number }>, assign: {} as Record<string, string> }
  for (let t = 0; t < topics; t += 1) {
    store.topics[`topic:r${t}`] = { name: `Running topic ${t} with a long name`, createdAt: t }
    for (let k = 0; k < each; k += 1) {
      const id = `r-${t}-${k}`
      const lastAt = NOW - ago - (t * each + k) * 100
      sessions.push({ id, cwd: CWD, slug: 'x', branch: `feat/${t}`, firstPrompt: `run ${k}`, title: `Running item ${k} of topic ${t}`, startedAt: lastAt - 3600_000, lastAt, turns: k, filesTouched: [`src/r${t}/file${k}.ts`], lastAssistantText: 'done', size: 1, mtimeMs: lastAt })
      store.assign[id] = `topic:r${t}`
    }
  }
  const model = buildModel(sessions, store, settings, NOW, 'me')
  const placement = placementOf(model, null)
  return { model, placed: placement.placed, field: placement.size, ui: INITIAL_UI, me: { ...INITIAL_ME, sessionId: 'me' }, settings, usage: INITIAL_USAGE, now: NOW, surface: 'desktop' }
}

/** Satellites drawn per topic, by the topic group they sit in. */
const perTopic = (svg: string, n: number) => Array.from({ length: n }, (_, i) => satellites(svg.split(new RegExp(`<g class="t t-${i}[ "]`))[1]?.split('<g class="t t-')[0] ?? ''))

test('forty topics keep the six satellites apiece their budget offers, live idle or clicks running', () => {
  expect(satellitesPerTopic(40)).toBe(6)
  for (const view of [bigView(40, 10), runningView(40, 10, { ...DEFAULT_SETTINGS, pictureMode: 'clicks' })]) {
    const svg = svgOf(view)
    expect(svg.length).toBeLessThanOrEqual(131072)
    expect(perTopic(svg, 40)).toEqual(Array(40).fill(6))
  }
})

test('forty topics live with every session running keep five satellites apiece, each rippling', () => {
  // Live with all four hundred written this minute (a ring, halo and live caption on every topic, a ripple on every
  // satellite), six apiece land just over the cap: five apiece stay, every one rippling with its bright core.
  const svg = svgOf(runningView(40, 10))
  expect(svg.length).toBeLessThanOrEqual(131072)
  expect(perTopic(svg, 40)).toEqual(Array(40).fill(5))
  expect((svg.match(/<circle class="rp" /g) ?? []).length).toBe(200)
  expect((svg.match(/<circle class="co" /g) ?? []).length).toBe(200)
  // No number spends characters on float noise (a delay of -6.299999999999999s).
  expect(svg.match(/\d\.\d{4,}/g) ?? []).toEqual([])
})

test('sixty idle topics keep the four satellites apiece their budget offers, and the layer the same', () => {
  // The budget offers four each. Idle, sixty topics keep all four apiece under the cap (they kept none before).
  expect(satellitesPerTopic(60)).toBe(4)
  const idleView = runningView(60, 6, DEFAULT_SETTINGS, 3600_000)
  const idle = svgOf(idleView)
  expect(idle.length).toBeLessThanOrEqual(131072)
  expect(perTopic(idle, 60)).toEqual(Array(60).fill(4))
  expect(fieldOf(idleView).nodes.filter(n => n.kind === 'session').length).toBe(240)
})

test('seventy topics keep as many satellites apiece as fit, the same on every topic, and the layer the same', () => {
  // Seventy idle topics are offered three apiece and keep two: the shed stops at the most that fit, not at a fixed step.
  expect(satellitesPerTopic(70)).toBe(3)
  const seventy = runningView(70, 6, DEFAULT_SETTINGS, 3600_000)
  const shed = svgOf(seventy)
  expect(shed.length).toBeLessThanOrEqual(131072)
  expect(perTopic(shed, 70)).toEqual(Array(70).fill(2))
  expect(fieldOf(seventy).nodes.filter(n => n.kind === 'session').length).toBe(140)
})

test('sixty topics every one running keep one satellite apiece, the most that fit', () => {
  // Every one of the sixty running, their rings, halos and live captions take most of the room: one apiece still fits,
  // and asked for two apiece the drawing still sheds to one, so two do not.
  const view = runningView(60, 6)
  const svg = svgOf(view)
  expect(svg.length).toBeLessThanOrEqual(131072)
  expect(perTopic(svg, 60)).toEqual(Array(60).fill(1))
  expect(fieldOf(view).nodes.filter(n => n.kind === 'session').length).toBe(60)
  expect(perTopic(svgOf(view, { withTooltips: false, maxSessions: 2 }), 60)).toEqual(Array(60).fill(1))
})

test('live: when the tooltips alone overflow the cap, they go first and every satellite stays', () => {
  const view = bigView(20, 10)
  const svg = svgOf(view)
  expect(svg.length).toBeLessThanOrEqual(131072)
  // Two hundred tooltips would be there had they fit; none are, yet all two hundred satellites are drawn.
  expect(svg).not.toContain('<title>')
  expect(satellites(svg)).toBe(200)
  expect(svg).toContain('.f:has(.t-19:hover) .c-19{opacity:1}')
})

test('live: four hundred sessions stay under the cap, the map and a focused chain both with their hover rules', () => {
  const view = bigView(40, 10)
  const svg = svgOf(view)
  expect(svg.length).toBeLessThanOrEqual(131072)
  expect(satellites(svg)).toBeGreaterThan(0)
  expect(svg).toContain('.f:has(.t-39:hover) .c-39{opacity:1}')
  const focused = svgOf({ ...view, ui: { ...INITIAL_UI, focusTopic: 'topic:t0' } })
  expect(focused.length).toBeLessThanOrEqual(131072)
  expect(focused).toContain('.f:has(.st-9:hover) .q-9{opacity:1}')
})

test('live motion: stars twinkle out of step, each topic sways its satellites and floats, and reduced motion stops it all', () => {
  const view = liveView()
  const svg = svgOf(view)
  expect(svg).toContain('@media (prefers-reduced-motion:reduce){.f *{animation:none!important}}')
  // The stars come in several layers with their own durations, never all in step.
  const twinkles = new Set((svg.match(/class="tw" style="animation-duration:[\d.]+s/g) ?? []).map(m => m))
  expect(twinkles.size).toBeGreaterThanOrEqual(3)
  // One orbit group per drawn topic, holding its spokes and satellites, turning about its unit's centre, directions alternating.
  view.model.topics.forEach((t, i) => {
    const group = svg.split(new RegExp(`<g class="t t-${i}[ "]`))[1]?.split('<g class="t t-')[0] ?? ''
    const orbit = group.split('<g class="o"')[1] ?? ''
    expect(orbit).toContain('class="ln"')
    expect(orbit).toContain('class="s n hit"')
    expect(group).toMatch(new RegExp(`<g class="o" style="transform-origin:[\\d.]+px [\\d.]+px;animation-duration:[\\d.]+s;animation-direction:${i % 2 === 0 ? 'alternate' : 'alternate-reverse'}"`))
  })
  // A sway takes 90 to 180 s there and back; a float a few units.
  for (const m of svg.matchAll(/class="o" style="[^"]*animation-duration:([\d.]+)s/g)) {
    expect(Number(m[1]) * 2).toBeGreaterThanOrEqual(90)
    expect(Number(m[1]) * 2).toBeLessThanOrEqual(180)
  }
  expect(svg).toMatch(/@keyframes fl\{50%\{transform:translate\(0,-3px\)\}\}/)
})

test('clicks: no motion at all', () => {
  const svg = svgOf(liveView({ ...DEFAULT_SETTINGS, pictureMode: 'clicks' }))
  expect(svg).not.toContain('@keyframes')
  expect(svg).not.toContain('animation')
  expect(svg).not.toContain('class="o"')
})

test('live motion: the latest step’s glow breathes, and only in live', () => {
  const view = liveView(DEFAULT_SETTINGS, ['a-0', 'b-1'])
  const focused = svgOf({ ...view, ui: { ...INITIAL_UI, focusTopic: 'topic:a' } })
  expect(focused).toContain('@keyframes br{')
  expect((focused.match(/<circle class="br"/g) ?? []).length).toBe(1)
  expect(svgOf({ ...view, settings: { ...DEFAULT_SETTINGS, pictureMode: 'clicks' } })).not.toMatch(/class="br"/)
})

test('live idle cycle: with nobody pointing, each major topic is traced in turn, four seconds apart, the caption following', () => {
  const view = liveView()
  const svg = svgOf(view)
  const majors = view.model.topics.map((t, i) => (t.isMajor ? i : -1)).filter(i => i >= 0)
  expect(majors.length).toBe(3)
  // The hint has the first slot, then every drawn major topic once.
  const period = 4 * (majors.length + 1)
  const delays = majors.map(i => {
    const m = svg.match(new RegExp(`<g class="t t-${i} cy"[^>]*--d:([\\d.]+)s`))
    expect(m).not.toBeNull()
    return Number(m?.[1])
  })
  expect([...delays].sort((a, b) => a - b)).toEqual(majors.map((_, k) => 4 * (k + 1)))
  majors.forEach(i => expect(svg).toMatch(new RegExp(`<g class="cap c-${i} cy" style="--d:[\\d.]+s"`)))
  // Every cycle rule waits for an unpointed field, so any hover stops it.
  expect(svg).toContain(`.f:not(:hover) .hint{animation:cv ${period}s linear infinite}`)
  for (const sel of ['.t.cy .pill', '.t.cy .nm', '.t.cy .glow', '.t.cy .ln', '.cap.cy']) expect(svg).toContain(`.f:not(:hover) ${sel}{animation:`)
  expect(svg).toContain('@media (prefers-reduced-motion:reduce){.f *{animation:none!important}}')
  // A focused chain has no cycle, and neither has the click picture.
  expect(svgOf({ ...view, ui: { ...INITIAL_UI, focusTopic: 'topic:a' } })).not.toContain(' cy"')
  expect(svgOf({ ...view, settings: { ...DEFAULT_SETTINGS, pictureMode: 'clicks' } })).not.toContain(' cy"')
})

test('live idle cycle: the four-hundred-session folder keeps its cycle and stays under the cap', () => {
  const view = bigView(40, 10)
  const svg = svgOf(view)
  expect(svg.length).toBeLessThanOrEqual(131072)
  const drawn = view.model.topics.filter(t => t.isMajor).length
  expect((svg.match(/<g class="t t-\d+( run)? cy"/g) ?? []).length).toBe(drawn)
  expect((svg.match(/<g class="cap c-\d+ cy"/g) ?? []).length).toBe(drawn)
})

// Running things (a session written in the last five minutes, or this one; a topic holding one) are what the eye finds first.
const groupOf = (svg: string, i: number) => svg.split(new RegExp(`<g class="t t-${i}[ "]`))[1]?.split('<g class="t t-')[0] ?? ''
const openTag = (svg: string, i: number) => svg.match(new RegExp(`<g class="t t-${i}[ "][^>]*>`))?.[0] ?? ''

test('running: a running topic carries a run class, a ring in its colour and the strongest halo; an idle topic neither', () => {
  const view = liveView(DEFAULT_SETTINGS, ['a-0'])
  const svg = svgOf(view)
  const a = view.model.topics.findIndex(t => t.id === 'topic:a')
  const c = view.model.topics.findIndex(t => t.id === 'topic:c')
  const color = view.model.topicById['topic:a']?.color ?? ''
  expect(openTag(svg, a)).toContain(' run')
  expect(groupOf(svg, a)).toContain(`<rect class="rg" `)
  expect(groupOf(svg, a)).toMatch(new RegExp(`<rect class="rg" [^>]*stroke="${color}"`))
  // Its halo is brighter than the hover glow (.22) and the satellites' (.12), and is always on.
  expect(groupOf(svg, a)).toMatch(/<rect class="rh" [^>]*fill="rgba\([\d, ]+0\.3\d*\)"/)
  // The live dot before its label: the pill's dot ringed.
  expect(groupOf(svg, a)).toContain('class="ld"')
  expect(openTag(svg, c)).not.toContain(' run')
  for (const cls of ['rg', 'rh', 'ld']) expect(groupOf(svg, c)).not.toContain(`class="${cls}"`)
})

test('running: one ripple per running satellite, each out of step; none on idle or archived ones; running cores are bright', () => {
  const view = liveView(DEFAULT_SETTINGS, ['a-0', 'a-1', 'b-1'], { archived: ['c-0'] })
  const svg = svgOf(view)
  const ripples = svg.match(/<circle class="rp" [^>]*>/g) ?? []
  expect(ripples.length).toBe(3)
  // Durations of two to three seconds and delays all differ, so no two widen together.
  // A satellite's ripple carries its clock (`--u` long, `--v` in); the shared rule runs it in the satellite's colour.
  expect(svg).toContain('.s .rp{fill:none;stroke:currentColor;stroke-width:1.2;animation:rp var(--u) ease-out var(--v) infinite}')
  const clocks = ripples.map(r => r.match(/style="--u:([\d.]+)s;--v:-([\d.]+)s"/)?.slice(1).join('/') ?? '')
  clocks.forEach(k => expect(k).not.toBe(''))
  expect(new Set(clocks).size).toBe(3)
  ripples.forEach(r => {
    const d = Number(r.match(/--u:([\d.]+)s/)?.[1])
    expect(d).toBeGreaterThanOrEqual(2)
    expect(d).toBeLessThanOrEqual(3)
  })
  expect((svg.match(/<circle class="co" /g) ?? []).length).toBe(3)
  expect(svg).toContain('.s .co{fill:#fff}')
  // Running satellites filled, idle ones outlined, archived ones dashed: each by its class and the shared rules.
  expect((svg.match(/<g class="s n hit sr"/g) ?? []).length).toBe(3)
  expect((svg.match(/<g class="s n hit sa"/g) ?? []).length).toBe(1)
  expect(svg).toContain('.sat{fill:var(--pill);stroke:currentColor;stroke-width:1.5}.sr .sat{fill:currentColor}.sa .sat{stroke:var(--dim);stroke-dasharray:2 2}')
  expect(svg).toContain('@keyframes rp{')
})

test('running: this session’s satellite is in the accent colour and ripples in it', () => {
  const view = liveView(DEFAULT_SETTINGS, [], { you: 'b-2' })
  const svg = svgOf(view)
  const b = view.model.topics.findIndex(t => t.id === 'topic:b')
  expect(openTag(svg, b)).toContain(' run')
  // Its satellite runs (filled and rippling in `currentColor`) with the accent as its colour; its topic's others keep the topic's.
  const mine = groupOf(svg, b).match(/<g class="s n hit sr"[^>]*>(?:(?!<\/g>)[^])*<\/g>/)?.[0] ?? ''
  expect(mine).toContain(`style="color:${ACCENT}"`)
  expect(mine).toContain('<circle class="rp" ')
  expect(openTag(svg, b)).toContain(`color:${view.model.topicById['topic:b']?.color}`)
})

test('running focus: running chain steps and "you" get the core and the ripple, "you" in the accent colour', () => {
  const view = liveView(DEFAULT_SETTINGS, ['a-0'], { youTopic: 'topic:a' })
  const svg = svgOf({ ...view, ui: { ...INITIAL_UI, focusTopic: 'topic:a' } })
  const steps = svg.split(/<g class="n hit st st-/).slice(1).map(g => g.split('</g>')[0] ?? '')
  // Three sessions and "you": two ripple (a-0 and you), the idle two do not.
  expect(steps.length).toBe(4)
  expect(steps.filter(g => g.includes('class="rp"')).length).toBe(2)
  expect(steps.filter(g => g.includes('class="co"')).length).toBe(2)
  const you = steps.find(g => g.includes('class="rp"') && g.includes(`stroke="${ACCENT}"`))
  expect(you).toBeDefined()
})

test('running: the caption leads with live and how many run; the idle cycle starts at a running topic', () => {
  const view = liveView(DEFAULT_SETTINGS, ['c-0', 'c-1'])
  const svg = svgOf(view)
  const c = view.model.topics.findIndex(t => t.id === 'topic:c')
  const cap = svg.split(new RegExp(`<g class="cap c-${c}[ "]`))[1]?.split('</g>')[0] ?? ''
  expect(cap).toContain('● live · 2 running · Gamma work')
  const a = view.model.topics.findIndex(t => t.id === 'topic:a')
  expect(svg.split(new RegExp(`<g class="cap c-${a}[ "]`))[1]?.split('</g>')[0] ?? '').not.toContain('● live')
  expect(openTag(svg, c)).toContain('--d:4s')
})

test('running in clicks: the ring, halo and cores without motion; reduced motion keeps them and stops the ripple', () => {
  const clicks = svgOf(liveView({ ...DEFAULT_SETTINGS, pictureMode: 'clicks' }, ['a-0']))
  expect(clicks).toContain('class="rg"')
  expect(clicks).toContain('class="rh"')
  expect(clicks).toContain('class="co"')
  expect(clicks).not.toContain('class="rp"')
  expect(clicks).not.toContain('animation')
  const live = svgOf(liveView(DEFAULT_SETTINGS, ['a-0']))
  // A ripple has no resting look: with its animation stopped it is not drawn, while the ring, halo and core stay.
  expect(live).toContain('.rp{opacity:0;')
  expect(live).toContain('@media (prefers-reduced-motion:reduce){.f *{animation:none!important}}')
  expect(live).not.toMatch(/\.(rg|rh|co)\{[^}]*animation/)
})

test('running: the four-hundred-session folder with a running topic still meets the cap', () => {
  const view = bigView(40, 10)
  const svg = svgOf(view)
  expect(svg.length).toBeLessThanOrEqual(131072)
  expect(svg).toMatch(/<g class="t t-\d+ run/)
  expect(svg).toContain('class="rp"')
})

// The idle cycle fades the rest, softly: one variable, `--k`, steps through the slots on the field's own timeline, every
// topic, link and satellite reads its own strength from it (so the fade costs no keyframes per topic), and each faded
// element eases to its new strength with its own opacity transition.
const fadeRule = (svg: string, sel: string) => svg.split(`.f:not(:hover) ${sel}{opacity:`)[1]?.split('}')[0] ?? ''
const easeOf = (svg: string, sel: string) =>
  [...svg.matchAll(/([^{}]*)\{transition:([^}]*)\}/g)].find(m => m[1]?.split(/,(?![^(]*\))/).includes(`.f:not(:hover) ${sel}`))?.[2] ?? ''
/** Evaluates the CSS `calc()` the fade uses (numbers, + - *, min, max), with `var(--x)` read from `vars`. */
const evalFade = (rule: string, vars: Record<string, number>) => {
  const src = rule.replace(/var\(--(\w)(,-?\d+)?\)/g, (_, v: string) => `(${vars[v] ?? -9})`).replace(/calc\(/g, '(').replace(/\s+/g, '')
  let at = 0
  const atom = (): number => {
    if (src[at] === '-') return (at += 1), -atom()
    const fn = src.slice(at).match(/^(min|max)\(/)?.[1]
    if (fn || src[at] === '(') {
      at += fn ? 4 : 1
      const args = [sum()]
      while (src[at] === ',') (at += 1), args.push(sum())
      at += 1
      return fn === 'min' ? Math.min(...args) : fn === 'max' ? Math.max(...args) : (args[0] ?? NaN)
    }
    const num = src.slice(at).match(/^\d*\.?\d+/)?.[0] ?? ''
    at += num.length
    return num ? Number(num) : NaN
  }
  const product = (): number => {
    let v = atom()
    while (src[at] === '*') (at += 1), (v *= atom())
    return v
  }
  const sum = (): number => {
    let v = product()
    while (src[at] === '+' || src[at] === '-') v = src[at++] === '+' ? v + product() : v - product()
    return v
  }
  return sum()
}
const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(1e-6)
const kAt = (svg: string, t: number) => {
  const body = svg.match(/@keyframes ck\{(.*?)\}\}/)?.[1] ?? ''
  const period = Number(svg.match(/\.f:not\(:hover\)\{animation:ck ([\d.]+)s/)?.[1])
  const keys = [...body.matchAll(/([\d.]+)%\{--k:([\d.]+)/g)].map(m => [(Number(m[1]) / 100) * period, Number(m[2])] as const)
  // `step-end`: each value holds until the next keyframe, registered or not.
  return [...keys].reverse().find(([at]) => at <= t)?.[1] ?? NaN
}

test('live idle cycle fade: outside its own slot and the hint slot every topic and link fades to about .4, easing over about .6 s', () => {
  const view = liveView()
  const svg = svgOf(view)
  // No `<` in the stylesheet: `syntax:'<number>'` read as a tag cut the sheet short in an HTML parser (the fade lost) and
  // left the SVG not well-formed in an XML one (the picture lost); a stepping `--k` needs no `@property` at all.
  const sheets = [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '')
  expect(sheets.length).toBeGreaterThan(0)
  for (const sheet of sheets) expect(sheet).not.toContain('<')
  expect(svg).not.toContain('@property')
  const topicRule = fadeRule(svg, '.t>:not(.rg,.rh,.ld,.glow)')
  const linkRule = fadeRule(svg, '.x')
  expect(topicRule).not.toBe('')
  expect(linkRule).not.toBe('')
  const majors = view.model.topics.map((t, i) => (t.isMajor ? i : -1)).filter(i => i >= 0)
  const slotOf = new Map(majors.map(i => [i, Number(openTag(svg, i).match(/--i:(\d+)/)?.[1])]))
  expect([...slotOf.values()].sort()).toEqual(majors.map((_, k) => k + 1))
  const ia = view.model.topics.findIndex(t => t.id === 'topic:a')
  const ib = view.model.topics.findIndex(t => t.id === 'topic:b')
  const link = svg.match(new RegExp(`<line class="x x-(${ia} x-${ib}|${ib} x-${ia})"[^>]*>`))?.[0] ?? ''
  const ends = { a: Number(link.match(/--a:(\d+)/)?.[1]), b: Number(link.match(/--b:(\d+)/)?.[1]) }
  expect([ends.a, ends.b].sort()).toEqual([slotOf.get(ia), slotOf.get(ib)].sort())
  // Mid-slot: the hint slot keeps all at full; a topic's own slot keeps it full and fades the rest to .4, not hover's .15.
  for (let j = 0; j <= majors.length; j += 1) {
    const k = kAt(svg, 4 * j + 2)
    near(k, j)
    for (const i of majors) near(evalFade(topicRule, { k, i: slotOf.get(i) ?? -9 }), j === 0 || slotOf.get(i) === j ? 1 : 0.4)
    near(evalFade(linkRule, { k, ...ends }), 0.8 * (j === 0 || j === ends.a || j === ends.b ? 1 : 0.4))
  }
  // Softly: `--k` steps .6 s before a slot and every faded element eases there over .6 s, arriving as its slot starts.
  expect(svg).toMatch(/\.f:not\(:hover\)\{animation:ck [\d.]+s step-end infinite\}/)
  near(kAt(svg, 4 * 2 - 0.65), 1)
  near(kAt(svg, 4 * 2 - 0.55), 2)
  expect(easeOf(svg, '.t>:not(.rg,.rh,.ld,.glow)')).toBe('opacity .6s ease-in-out')
  expect(easeOf(svg, '.x')).toBe('opacity .6s ease-in-out')
  // A minor topic has no slot: it fades with the rest outside the hint slot.
  near(evalFade(topicRule, { k: 1, i: -9 }), 0.4)
})

// An engine may drop `@property` (the Desktop's scrub cannot be read here): the fade must ease the same without it.
test('live idle cycle fade without @property: the same .4 target, eased by the elements over .6 s', () => {
  const view = liveView()
  const bare = svgOf(view).replace(/@property[^{]*\{[^}]*\}/g, '')
  expect(bare).not.toContain('@property')
  // An unregistered `--k` animates discretely, flipping half way between keyframes; `step-end` makes both flip at the key.
  expect(bare).toMatch(/\.f:not\(:hover\)\{animation:ck [\d.]+s step-end infinite\}/)
  const topicRule = fadeRule(bare, '.t>:not(.rg,.rh,.ld,.glow)')
  const linkRule = fadeRule(bare, '.x')
  for (const sel of ['.t>:not(.rg,.rh,.ld,.glow)', '.x']) expect(easeOf(bare, sel)).toBe('opacity .6s ease-in-out')
  const majors = view.model.topics.filter(t => t.isMajor).length
  for (let j = 0; j <= majors; j += 1) {
    const k = kAt(bare, 4 * j + 2)
    near(k, j)
    for (let i = 1; i <= majors; i += 1) near(evalFade(topicRule, { k, i }), j === 0 || i === j ? 1 : 0.4)
    near(evalFade(linkRule, { k, a: 1, b: 2 }), 0.8 * (j === 0 || j === 1 || j === 2 ? 1 : 0.4))
  }
  // The ease waits for an unpointed field, so a hover keeps its own quicker .25 s fade.
  expect(bare).toContain('.t,.x,.s{transition:opacity .25s}')
})

test('live idle cycle fade: hover wins, a running ring stays, and there is no fade in clicks or under reduced motion', () => {
  const svg = svgOf(liveView(DEFAULT_SETTINGS, ['a-0']))
  // Every fade rule and the timeline wait for an unpointed field; a hover's own .15 fade then applies.
  expect(svg).toContain('.f:has(.t:hover) .t:not(:hover){opacity:.15}')
  expect(svg.match(/[^}]*\{opacity:calc\(\.[48]/g)?.every(r => r.includes('.f:not(:hover) '))).toBe(true)
  // The running topic's ring, halo and live dot are left out of the fade, and so is the hover glow.
  expect(svg).toContain('.f:not(:hover) .t>:not(.rg,.rh,.ld,.glow){opacity:')
  // Only for a reader who has not asked for less motion: the timeline and the fade sit in the no-preference block.
  const motion = svg.split('@media (prefers-reduced-motion:no-preference){')[1] ?? ''
  expect(motion).toContain('@keyframes ck{')
  expect(motion).toContain('.f:not(:hover){animation:ck ')
  expect(motion).toContain('.f:not(:hover) .x{opacity:')
  expect(svg.split('@media (prefers-reduced-motion:no-preference){')[0]).not.toMatch(/ck|\{opacity:calc/)
  const clicks = svgOf(liveView({ ...DEFAULT_SETTINGS, pictureMode: 'clicks' }, ['a-0']))
  expect(clicks).not.toContain('--k')
  expect(clicks).not.toContain('--i:')
  expect(clicks).not.toContain('opacity:calc')
  // A focused chain has no cycle, so no fade either.
  expect(svgOf({ ...liveView(), ui: { ...INITIAL_UI, focusTopic: 'topic:a' } })).not.toContain('--k')
})

test('live idle cycle fade: the four-hundred-session folder keeps a slot on every major topic and stays under the cap', () => {
  const view = bigView(40, 10)
  const svg = svgOf(view)
  expect(svg.length).toBeLessThanOrEqual(131072)
  const drawn = view.model.topics.filter(t => t.isMajor).length
  expect((svg.match(/<g class="t t-\d+( run)? cy"[^>]*--i:\d+/g) ?? []).length).toBe(drawn)
  expect(svg).toContain('@keyframes ck{')
})

test('a session active this minute reads "now", never "now ago": its meta, its topic’s caption, its chain step, its handoff note', () => {
  const view = runningView(1, 3)
  const topic = view.model.topicById['topic:r0']
  const s = topic?.sessions.find(x => x.lastAt === NOW)
  expect(s).toBeDefined()
  if (!topic || !s) return
  expect(sessionMeta(s, NOW).startsWith('now · ')).toBe(true)
  expect(captionOf(topic, NOW)).toBe('3 sessions · active now')
  expect(captionOf(topic, NOW + 3600_000)).toBe('3 sessions · last 1h ago')
  expect(handoffText(s, topic, 1, NOW)).toContain(`(step 1 of ${topic.name}, now, branch feat/0)`)
  const placement = placementOf(view.model, 'topic:r0')
  const focused = { ...view, ui: { ...INITIAL_UI, focusTopic: 'topic:r0' }, placed: placement.placed, field: placement.size }
  for (const svg of [svgOf(view), svgOf(focused)]) expect(svg).not.toContain('now ago')
  expect(svgOf(focused)).toMatch(/>now( · [^<]*)?</)
})
