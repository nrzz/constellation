// Constellation: the Svg field and the element trees around it.
//
// `svgOf` renders the map (every topic as a pill or dot with its satellites)
// or a focused topic (a numbered zigzag chain with related anchors) as one
// SVG string, from the model and the pane's view state, in the look of
// design/TopicMap.dc.html. The trees here are built from the surface's
// element table and the actions the entry point hands in; nothing here
// touches `$`.
import type { Elements, RenderElement } from 'claude-code'

import { ACCENT, ALL_TIME_DAYS, MINOR_COLOR, PALETTE, UNSORTED_ID, ageOf, chainSteps, latestOf, orderChain, satellitesPerTopic } from './cluster'
import type { ChainStep, Link, Model, SessionView, Topic } from './cluster'
import { BASE, FOCUS_PILL, anchorSlots, chainLabelChars, chainMetaChars, chainPositions, crowdedLabels, focusSize, isUpperStep, pillWidth, satellitePosition, starPath, unitCentre, unitEdge } from './layout'
import type { FieldSize, PlacedTopic, Point } from './layout'
import { durationOf } from './state'
import type { MapSettings, MeState, NoteRecord, UiState, UsageState } from '../types'

export const BG = '#0B0E13'
export const PANEL = '#10141A'
export const BORDER = '#1C222B'
export const CARD_BORDER = '#20262F'
export const TEXT = '#E8ECF2'
export const MUTED = '#8B95A5'
/** A translucent hairline that reads on the Desktop's dark and light themes alike. */
export const HAIRLINE = 'rgba(139, 149, 165, 0.3)'
/** Something that did not happen (a refused or failed action): a coral no topic, the accent or live wears. */
export const PROBLEM = '#F26D5B'
export const DIM = '#6F7988'
export const LABEL = '#C9D1DC'
export const SANS = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"
export const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"
export const SVG_CAP = 131072

/** A coordinate to a tenth, without a trailing `.0`: marks repeated hundreds of times spend no characters on it. */
const tenth = (v: number) => String(Number(v.toFixed(1)))

export type View = {
  model: Model
  placed: Record<string, PlacedTopic>
  /** The map's field size: the base 860×520, or taller when the topics need the room. Focus mode always draws the base. */
  field: FieldSize
  ui: UiState
  me: MeState
  settings: MapSettings
  usage: UsageState
  now: number
  surface: string
  /** This session's own handoff note, when one is parked. */
  myNote?: NoteRecord
  /** Drawn as a row in the transcript (`/map here`): no site holds the focus there, so no hotkeys are offered. */
  isRow?: boolean
  /**
   * Where the terminal seated the pane: docked beside the transcript (the
   * fullscreen renderer, where the terminal reports the mouse) or inline above
   * the prompt (the classic renderer, where it does not).
   */
  placement?: 'dock' | 'inline'
  /** The terminal's fullscreen renderer is on: the one that reports the mouse. Absent where the engine has not measured. */
  isFullscreen?: boolean
}

/** A Button's hotkey where it can fire: in the pane or the band, never in a transcript row. */
export function hk(view: View, key: string | undefined): string | undefined {
  return view.isRow ? undefined : key
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = Number.parseInt(full.slice(0, 6), 16)
  if (Number.isNaN(n)) return hex
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * A topic name cut to `max` characters that keeps its end, where a disambiguated
 * name differs ("Authentication Mi… Rate"): the last word whole when the head keeps
 * three characters, else the last characters after the mark ("Cash…fund").
 */
export function clipName(name: string, max: number): string {
  if (name.length <= max) return name
  const cut = name.lastIndexOf(' ')
  const last = cut > 0 ? name.slice(cut + 1) : ''
  if (last && last.length + 5 <= max) return `${clip(name.slice(0, cut), max - last.length - 1)} ${last}`
  if (last && max >= 7) {
    const tail = Math.floor((max - 1) / 2)
    return `${name.slice(0, max - 1 - tail).trimEnd()}…${name.slice(-tail).trimStart()}`
  }
  return clip(name, max)
}

/** Up to two lines of about `width` characters, broken at spaces. */
function wrap2(text: string, width: number): string[] {
  if (text.length <= width) return [text]
  const words = text.split(' ')
  let first = ''
  let i = 0
  while (i < words.length && `${first} ${words[i]}`.trim().length <= width) {
    first = `${first} ${words[i]}`.trim()
    i += 1
  }
  if (first === '') {
    first = text.slice(0, width)
    return [first, clip(text.slice(width), width)]
  }
  return [first, clip(words.slice(i).join(' '), width)]
}

export function matches(query: string, s: SessionView): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${s.title} ${s.firstPrompt} ${s.note?.text ?? ''} ${s.lastAssistantText} ${s.filesTouched.join(' ')} ${s.branch}`.toLowerCase().includes(q)
}

export function topicMatches(query: string, t: Topic): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return t.name.toLowerCase().includes(q) || (t.goal ?? '').toLowerCase().includes(q) || t.sessions.some(s => matches(query, s))
}

export function relatedOf(links: readonly Link[], topicId: string): { id: string; via: string }[] {
  const out: { id: string; via: string }[] = []
  for (const l of links) {
    if (l.a === topicId) out.push({ id: l.b, via: l.via })
    else if (l.b === topicId) out.push({ id: l.a, via: l.via })
  }
  return out
}

/** "1 turn", "3 turns"; a large transcript was read in slices, so its count is a floor: "40+ turns". */
export function turnsOf(s: Pick<SessionView, 'turns' | 'large'>): string {
  if (s.large) return `${s.turns}+ turns`
  return `${s.turns} turn${s.turns === 1 ? '' : 's'}`
}

export function sessionMeta(s: SessionView, now: number, extra = ''): string {
  const parts = [`${ageOf(s.lastAt, now)} ago`]
  if (s.branch) parts.push(s.branch)
  parts.push(turnsOf(s))
  if (extra) parts.push(extra)
  return parts.join(' · ')
}

/** The note text a card and a tooltip show: the parked note, else the last assistant text, else nothing. */
export function noteText(s: SessionView): string {
  return s.note?.text ?? s.lastAssistantText
}

/** The focused topic's chain: in-range sessions in order, plus a "you" step when this session joined it (the numbering every command shares). */
export type Step = ChainStep

export function chainOf(view: View, topic: Topic): Step[] {
  return chainSteps(topic, view.settings.numbering, view.me.topicId)
}

export function stepNumber(view: View, topic: Topic, sessionId: string): number {
  return chainOf(view, topic).findIndex(s => s.id === sessionId) + 1
}

export function hintOf(view: View): string {
  const { ui, model } = view
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  if (focus) {
    if (ui.selected) return 'u picks up its note · 1–9 select a step · Esc back'
    const n = chainOf(view, focus).length
    if (view.me.topicId === focus.id) return `${focus.name} · you are step ${stepNumber(view, focus, 'you')} · pick an earlier step for its note`
    return `${focus.name} · ${n} session${n === 1 ? '' : 's'} in order · pick one for its note`
  }
  if (ui.mergeFrom) {
    const t = model.topicById[ui.mergeFrom]
    return `Merging ${clip(t?.name ?? '', 30)}: pick the topic to merge it into`
  }
  if (ui.moveMode && ui.selected) {
    const s = model.byId[ui.selected]
    return `Moving “${clip(s?.title ?? '', 40)}”: pick a topic`
  }
  const traced = ui.hover ? model.topicById[ui.hover] : undefined
  if (traced) return `${traced.name} · ${traced.sessions.length} session${traced.sessions.length === 1 ? '' : 's'} · Enter to focus`
  return pointerHint(view)
}

/**
 * The resting hint says how picking works on this surface. The picture takes
 * clicks on the terminal's docked map and on the Desktop with its pointer
 * layer on. The classic terminal renderer seats the pane inline and reports
 * no mouse. VS Code, and the Desktop with the layer off, draw a picture that
 * takes no click: the topic buttons under it pick. Mobile has no keyboard.
 */
export function pointerHint(view: Pick<View, 'surface' | 'placement' | 'settings' | 'isFullscreen' | 'isRow'>): string {
  // A /map here snapshot in the transcript: a picture, no live map under it.
  if (view.isRow) return 'A snapshot · /map opens the live map'
  if (view.surface === 'terminal') {
    // The fullscreen renderer reports the mouse, docked or (under 110 columns) inline; the classic one never does.
    const hasMouse = view.isFullscreen ?? view.placement !== 'inline'
    // Terminals differ in what they pass on: clicks and motion, clicks only (Windows' console host), or neither. The hint promises
    // only clicks, and always names the keys.
    return hasMouse ? 'Click or Tab to a topic · Enter focuses' : 'Tab to a topic · Enter focuses · the mouse works in /tui fullscreen'
  }
  if (view.surface === 'mobile') return 'Tap a topic under the map to focus it'
  // The live picture: hover traces in the frame's CSS; a click there carries no position, so its buttons pick.
  if (isLive(view)) return 'Hover a topic to trace it · its button below focuses it'
  if (view.surface === 'desktop' && view.settings.pictureClicks !== 'off') return 'Hover or focus a topic to trace it · Enter or click to focus'
  return 'Tab onto a topic to trace it · Enter or its button under the map focuses'
}

/** The live picture: the Desktop's and VS Code's field drawn in the interactive frame, unless the person chose Clicks. */
export function isLive(view: Pick<View, 'surface' | 'settings'>): boolean {
  return (view.surface === 'desktop' || view.surface === 'vscode') && view.settings.pictureMode !== 'clicks'
}

/** A topic's one-line caption in the live picture: its goal, else its latest parked note, else its count and last activity. */
export function captionOf(t: Topic, now: number): string {
  const noted = [...t.sessions].sort((a, b) => b.lastAt - a.lastAt).find(s => s.note?.text)
  const n = t.sessions.length
  return t.goal ?? noted?.note?.text ?? `${n} session${n === 1 ? '' : 's'} · last ${ageOf(t.lastAt, now)} ago`
}

type SvgOptions = { withTooltips?: boolean; maxSessions?: number }

/**
 * The field's colours as CSS variables inside the Svg. `transparent` (the
 * default) uses translucent tints that sit on any host surface and follows the
 * viewer's light or dark scheme; `night` is the prototype's solid ground.
 */
export function themeCss(background: MapSettings['fieldBackground']): string {
  if (background === 'night') {
    return `:root{--tx:${TEXT};--lb:${LABEL};--mu:${MUTED};--dim:${DIM};--inv:#12161D;--grid:#151A22;--star:#3A4252;--star2:#55607A;--pill:#161B23;--pill2:#1C2230;--line:${BORDER};--x:#2A3240;--ln:#2E3644;--glass:rgba(16,20,26,.9)}`
  }
  return (
    `:root{--tx:#E8ECF2;--lb:#C9D1DC;--mu:#8B95A5;--dim:#6F7988;--inv:#12161D;--grid:rgba(255,255,255,.055);--star:rgba(255,255,255,.22);--star2:rgba(255,255,255,.38);--pill:rgba(255,255,255,.06);--pill2:rgba(255,255,255,.12);--line:rgba(255,255,255,.09);--x:rgba(255,255,255,.14);--ln:rgba(255,255,255,.16);--glass:rgba(255,255,255,.07)}` +
    `@media (prefers-color-scheme:light){:root{--tx:#141A24;--lb:#2B3442;--mu:#5C6676;--dim:#8891A0;--inv:#FFFFFF;--grid:rgba(0,0,0,.06);--star:rgba(0,0,0,.16);--star2:rgba(0,0,0,.28);--pill:rgba(0,0,0,.045);--pill2:rgba(0,0,0,.09);--line:rgba(0,0,0,.11);--x:rgba(0,0,0,.16);--ln:rgba(0,0,0,.2);--glass:rgba(255,255,255,.75)}}`
  )
}

/**
 * Marks the pane prints as text. A terminal's font may lack some: Windows'
 * console host drew ⚙ and ◆ as empty boxes, and ↻, ▸, ▾, ★ and ✓ are outside
 * the WGL4 set every console font carries. The terminal gets stand-ins from
 * that set; the other surfaces draw the marks with the app's own fonts.
 */
export function marks(view: Pick<View, 'surface'>): { gear: string; refresh: string; open: string; shut: string; pin: string; done: string } {
  return view.surface === 'terminal'
    ? { gear: '', refresh: '', open: '▼', shut: '►', pin: '*', done: '√' }
    : { gear: '⚙ ', refresh: '↻ ', open: '▾', shut: '▸', pin: '★', done: '✓' }
}

/** The field a drawing draws: the map's, or a focused topic's (as wide as the map's, the base height, taller for a chain that wraps). */
export function sizeOf(view: View): FieldSize {
  const focus = view.ui.focusTopic ? view.model.topicById[view.ui.focusTopic] : undefined
  return focus ? focusSize(view.field, chainOf(view, focus).length) : view.field
}

/** The focused topic's pill: its count ("3 of 4", "· you" on your own topic) and its width, the same in the picture and the pointer layer. */
export function focusPillOf(view: View, focus: Topic): { count: string; w: number } {
  const steps = chainOf(view, focus)
  const count = `${steps.filter(s => !s.isYou).length} of ${focus.sessions.length}${view.me.topicId === focus.id ? ' · you' : ''}`
  return { count, w: pillWidth(focus.name, count) }
}

/** One related anchor under a focused chain, as the picture draws it and the pointer layer hit-tests it. */
export type Anchor = { topic: Topic; via: string; x: number; y: number; w: number; name: string; file: string }

/**
 * The related anchors under a focused chain: the most recently active related
 * topics, as many as the field's width holds, each label cut to its room so no
 * two meet and none leaves the field.
 */
export function anchorsOf(view: View, focus: Topic, size: FieldSize): Anchor[] {
  if (!view.settings.showRelated) return []
  const related = relatedOf(view.model.links, focus.id)
    .map(r => ({ ...r, topic: view.model.topicById[r.id] }))
    .filter((r): r is { id: string; via: string; topic: Topic } => r.topic !== undefined)
    .sort((a, b) => b.topic.lastAt - a.topic.lastAt || a.topic.name.localeCompare(b.topic.name))
  const { positions, slot } = anchorSlots(related.length, size)
  // A 40-unit pill (dot, padding) and 6.4 units a character, inside the slot less 12 of air.
  const chars = Math.max(6, Math.floor((slot - 52) / 6.4))
  return positions.flatMap((pos, i) => {
    const r = related[i]
    if (!r) return []
    // The name first (two related topics may differ only in their last word), the shared file in what is left.
    const name = clipName(r.topic.name, Math.min(20, chars))
    const room = chars - name.length - 2
    const file = room >= 4 ? clip(r.via, Math.min(18, room)) : ''
    // Whole units, so the picture and the pointer layer draw and hit-test the very same box.
    const w = Math.round(40 + (name.length + (file ? file.length + 2 : 0)) * 6.4)
    return [{ topic: r.topic, via: r.via, x: Math.round(pos.x), y: pos.y, w, name, file }]
  })
}

/** The hint pill's text, cut to the room the field leaves it (beside the back pill, in focus mode). */
export function hintFitted(view: View, size: FieldSize): string {
  const hint = hintOf(view)
  const isFocus = size !== view.field
  // Centred, so the back pill (14 to 110, with 8 of air) takes the same room on both sides.
  const room = isFocus ? size.w - 2 * 118 : size.w - 28
  const chars = Math.max(8, Math.floor((room - 24) / 6.3))
  return clip(hint, chars)
}

/** How many of a topic's sessions run: its active ones, and this session once it joined (before its transcript lands in the topic). */
export function runningOf(view: Pick<View, 'me'>, t: Topic): number {
  return t.sessions.filter(s => s.status === 'active').length + (view.me.topicId === t.id && !t.sessions.some(s => s.id === view.me.sessionId) ? 1 : 0)
}

/** A drawing of the field, and how many satellites per topic it kept: null where it gave way to the placeholder. */
type Drawn = { svg: string; kept: number | null }
const drawings = new WeakMap<View, Drawn>()

/** The whole field as an SVG document, under the 131072-character cap. A view is drawn once, for the picture and its layer. */
export function svgOf(view: View, options?: SvgOptions): string {
  return options ? drawSvg(view, options).svg : drawingOf(view).svg
}

function drawingOf(view: View): Drawn {
  const known = drawings.get(view)
  if (known) return known
  const made = drawSvg(view, {})
  drawings.set(view, made)
  return made
}

function drawSvg(view: View, options: SvgOptions): Drawn {
  const withTooltips = options.withTooltips ?? true
  // The same budget the pointer layer takes, so what is drawn is what is clickable.
  const budget = options.maxSessions ?? satellitesPerTopic(view.model.topics.length)
  const full = renderSvg(view, withTooltips, budget)
  if (full.length <= SVG_CAP) return { svg: full, kept: budget }
  // Shed detail in steps until the document fits whole: tooltips first, then satellites per topic, as many kept as fit.
  const plain = withTooltips ? renderSvg(view, false, budget) : full
  if (plain.length <= SVG_CAP) return { svg: plain, kept: budget }
  const bare = renderSvg(view, false, 0)
  if (bare.length > SVG_CAP) {
    const size = sizeOf(view)
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}"><style>${themeCss(view.settings.fieldBackground)}</style><rect width="${size.w}" height="${size.h}" rx="16" fill="none" style="stroke:var(--line)"/><text x="${size.w / 2}" y="${size.h / 2}" font-size="13" style="fill:var(--mu)" text-anchor="middle">Too many topics to draw at once: narrow the time range or search.</text></svg>`, kept: null }
  }
  // A topic's satellites cost alike, and one with fewer than the budget stops growing: the straight line from none to the
  // budget never overestimates what fits, so stepping down from its answer finds the most that do.
  for (let kept = Math.min(budget - 1, Math.floor((budget * (SVG_CAP - bare.length)) / (plain.length - bare.length))); kept > 0; kept -= 1) {
    const svg = renderSvg(view, false, kept)
    if (svg.length <= SVG_CAP) return { svg, kept }
  }
  return { svg: bare, kept: 0 }
}

/** The field at one level of detail, whatever its length. */
function renderSvg(view: View, withTooltips: boolean, maxSessions: number): string {
  const { model, ui, placed, now } = view
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  const size = sizeOf(view)
  const query = ui.query.trim()
  const parts: string[] = []
  const css: string[] = [
    themeCss(view.settings.fieldBackground),
    // A satellite's look lives here, not on each mark: its colour is the topic's (or this session's accent) through
    // `color`, running fills it (`sr`), archived dashes it (`sa`); a spoke traced takes the colour (`lt`), else fades (`lf`).
    `.sat{fill:var(--pill);stroke:currentColor;stroke-width:1.5}.sr .sat{fill:currentColor}.sa .sat{stroke:var(--dim);stroke-dasharray:2 2}`,
    `.sh{fill:currentColor;fill-opacity:.12}.s .co{fill:#fff}.ln{fill:none;stroke:var(--ln);stroke-width:1;opacity:.8}.lt{stroke:currentColor;stroke-width:1.2;opacity:.75}.lf{opacity:.35}`,
    `.t,.x,.s{transition:opacity .25s}`,
    `.hit{cursor:pointer}`,
    `.glow{opacity:0;transition:opacity .25s}`,
    `.t:hover .glow{opacity:1}`,
    `.t:hover .lbl{fill:var(--tx)}`,
    `.t:hover .ln{opacity:.75}`,
    `svg:has(.t:hover) .t:not(:hover){opacity:.3}`,
    `svg:has(.t:hover) .x{opacity:.35}`,
    `text{font-family:${SANS}}`,
    `.mono{font-family:${MONO}}`,
  ]
  // The live picture traces in CSS alone; its rules beat the drawing's inline styles, so the press-free frame needs no state.
  const live = isLive(view) && !view.isRow
  if (live) {
    css.push(
      `.cap{opacity:0;pointer-events:none;transition:opacity .2s}.hint{transition:opacity .2s}`,
      `.f:has(.t:hover) .hint{opacity:0}`,
      `.f:has(.t:hover) .t:not(:hover){opacity:.15}`,
      `.f:has(.t:hover) .x{opacity:.15}`,
      `.t:hover .pill{fill:var(--tx)!important}`,
      `.t:hover .nm{fill:var(--inv)!important}`,
      `.t:hover .lbl{fill:var(--tx)!important}`,
      // Motion: calm, out of step, and stopped for a reader who asks for less.
      `@keyframes tw{50%{opacity:.25}}@keyframes rk{from{transform:rotate(-6deg)}to{transform:rotate(6deg)}}@keyframes fl{50%{transform:translate(0,-3px)}}`,
      `.tw{animation:tw 5s ease-in-out infinite}.o{transform-box:view-box;animation:rk 60s ease-in-out infinite alternate}.t{animation:fl 8s ease-in-out infinite}`,
      // A running session ripples: a ring that widens and fades, with no resting look, so stopped motion hides it. The latest
      // step's glow breathes.
      `@keyframes rp{0%{transform:scale(1);opacity:.85}100%{transform:scale(2.6);opacity:0}}@keyframes br{50%{opacity:.4}}`,
      `.rp{opacity:0;transform-box:fill-box;transform-origin:center}.br{animation:br 4s ease-in-out infinite}`,
      `.s .rp{fill:none;stroke:currentColor;stroke-width:1.2;animation:rp var(--u) ease-out var(--v) infinite}`,
      `@media (prefers-reduced-motion:reduce){.f *{animation:none!important}}`,
    )
  }
  const caps: string[] = []
  // A caption in the hint pill's place, shown while its owner is hovered; in focus mode it keeps clear of the back pill.
  const capOf = (cls: string, text: string, color: string, style = '') => {
    const room = focus ? size.w - 2 * 118 : size.w - 28
    const cap = clip(text, Math.max(8, Math.floor((room - 24) / 6.3)))
    const cw = 24 + cap.length * 6.3
    caps.push(
      `<g class="cap ${cls}"${style ? ` style="${style}"` : ''}><rect x="${(size.w / 2 - cw / 2).toFixed(1)}" y="14" width="${cw.toFixed(1)}" height="30" rx="15" style="fill:var(--glass)" stroke="${color}"/>` +
        `<text x="${size.w / 2}" y="33" font-size="12" style="fill:var(--tx)" text-anchor="middle">${esc(cap)}</text></g>`,
    )
  }
  const indexOf = new Map<string, number>()
  model.topics.forEach((t, i) => indexOf.set(t.id, i))
  // Running: a session written in the last few minutes, or this one; a topic holding one. Live draws a ripple about each.
  const runningIn = (t: Topic) => runningOf(view, t)
  // A ripple's clock: two to three seconds, started part way through, so no two widen together.
  const clockOf = (seed: number) => {
    const d = 2 + (seed % 11) / 10
    return { d: d.toFixed(1), off: ((seed * 0.37) % d).toFixed(2) }
  }
  const ripple = (x: number, y: number, r: number, stroke: string, seed: number) => {
    if (!live) return ''
    const { d, off } = clockOf(seed)
    return `<circle class="rp" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.2" style="animation:rp ${d}s ease-out -${off}s infinite"/>`
  }

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}" role="img">`,
    `<defs><pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" style="stroke:var(--grid)" stroke-width="1"/></pattern>`,
    `<radialGradient id="glow" cx="24%" cy="20%" r="62%"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0.11"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>`,
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9z" fill="${focus ? focus.color : ACCENT}"/></marker>`,
    `<clipPath id="field"><rect width="${size.w}" height="${size.h}" rx="16"/></clipPath>`,
  )
  const styleAt = parts.length
  parts.push('')
  parts.push(`</defs>`)
  parts.push(`<g class="f" clip-path="url(#field)">`)
  // Transparent by default: the field sits on the pane's own surface; `night` paints the prototype's solid ground.
  if (view.settings.fieldBackground === 'night') parts.push(`<rect width="${size.w}" height="${size.h}" fill="${BG}"/>`)
  parts.push(`<rect width="${size.w}" height="${size.h}" fill="url(#glow)"/>`)
  parts.push(`<rect width="${size.w}" height="${size.h}" fill="url(#grid)"/>`)
  const stars = (d: string, colour: string, width: number, k: number) => {
    if (!live) return [`<path d="${d}" style="stroke:var(${colour})" stroke-width="${width}" stroke-linecap="round" fill="none" opacity="0.8"/>`]
    // Live: the stars in three layers, each twinkling on its own clock.
    const dots = d.split('M').filter(Boolean)
    return [0, 1, 2].map(
      j =>
        `<path class="tw" style="animation-duration:${(3.7 + j * 1.7 + k * 0.9).toFixed(1)}s;animation-delay:-${(j * 1.3 + k).toFixed(1)}s;stroke:var(${colour})" d="${dots
          .filter((_, n) => n % 3 === j)
          .map(m => `M${m}`)
          .join('')}" stroke-width="${width}" stroke-linecap="round" fill="none" opacity="0.8"/>`,
    )
  }
  parts.push(...stars(starPath(Math.round((70 * size.w * size.h) / (BASE.w * BASE.h)), 137.5, 11, size), '--star', 1.6, 0))
  parts.push(...stars(starPath(Math.round((18 * size.w * size.h) / (BASE.w * BASE.h)), 211.7, 53, size), '--star2', 2.4, 1))

  if (!focus) {
    const traced = ui.hover && model.topicById[ui.hover] ? ui.hover : null
    const related = new Set<string>(traced ? relatedOf(model.links, traced).map(r => r.id) : [])
    const dropSource = ui.mergeFrom ?? (ui.moveMode && ui.selected ? model.byId[ui.selected]?.topicId : undefined)
    // The idle cycle: with nobody pointing, the hint has the first four seconds, then each major topic is traced in turn,
    // its caption following, and the rest fades softly; a hover anywhere on the field stops it.
    const cycle = new Map<string, number>()
    // A running topic is traced first.
    if (live)
      model.topics
        .filter(t => t.isMajor && placed[t.id])
        .sort((a, b) => Number(runningIn(b) > 0) - Number(runningIn(a) > 0))
        .forEach((t, k) => cycle.set(t.id, 4 * (k + 1)))
    if (cycle.size > 0) {
      const n = cycle.size
      const period = 4 * (n + 1)
      const s = 100 / (n + 1)
      const at = (v: number) => `${Number(v.toFixed(2))}%`
      const frames = (name: string, prop: string, off: string, on: string) => `@keyframes ${name}{0%{${prop}:${off}}${at(s / 8)},${at(s - s / 8)}{${prop}:${on}}${at(s)},100%{${prop}:${off}}}`
      const run = (name: string) => `{animation:${name} ${period}s linear var(--d) infinite}`
      // The fade: `--k` steps through the slots (0 the hint, then each topic, n + 1 the hint again) on the field's one
      // timeline, 0.6 s before each; whatever holds slot `--k`, or the hint's, is at full, the rest at .4, and each faded
      // element eases there with its own 0.6 s opacity transition. `--k` is not registered: `@property`'s `syntax:'<number>'`
      // reads as a tag inside the SVG (an HTML parser cut the sheet short there, an XML one refused the picture), and
      // `step-end` makes an unregistered `--k` flip at each key rather than half way between two.
      const ck = [`0%{--k:0}`]
      for (let j = 1; j <= n + 1; j += 1) ck.push(`${at((100 * (4 * j - 0.6)) / period)}{--k:${j}}`)
      const lit = (v: string) => `max(0,min(1 + var(--${v},-9) - var(--k),1 + var(--k) - var(--${v},-9)))`
      const strength = (...vs: string[]) => `.4 + .6*min(1,max(0,1 - var(--k)) + max(0,var(--k) - ${n})${vs.map(v => ` + ${lit(v)}`).join('')})`
      css.push(
        frames('cv', 'opacity', '0', '1'),
        frames('cp', 'fill', 'var(--pill)', 'var(--tx)'),
        frames('cn', 'fill', 'var(--tx)', 'var(--inv)'),
        frames('cl', 'stroke', 'var(--ln)', 'var(--c)'),
        `.f:not(:hover) .hint{animation:cv ${period}s linear infinite}`,
        `.f:not(:hover) .t.cy .pill${run('cp')}.f:not(:hover) .t.cy .nm${run('cn')}.f:not(:hover) .t.cy .glow${run('cv')}.f:not(:hover) .t.cy .ln${run('cl')}.f:not(:hover) .cap.cy${run('cv')}`,
        // A running topic's ring, halo and live dot stay through the fade, as does the hover glow's own rule.
        `@media (prefers-reduced-motion:no-preference){@keyframes ck{${ck.join('')}}.f:not(:hover){animation:ck ${period}s step-end infinite}` +
          `.f:not(:hover) .t>:not(.rg,.rh,.ld,.glow),.f:not(:hover) .x{transition:opacity .6s ease-in-out}` +
          `.f:not(:hover) .t>:not(.rg,.rh,.ld,.glow){opacity:calc(${strength('i')})}.f:not(:hover) .x{opacity:calc(.8*(${strength('a', 'b')}))}}`,
      )
    }
    for (const l of model.links) {
      const a = placed[l.a]
      const b = placed[l.b]
      if (!a || !b) continue
      const isBright = traced !== null && (l.a === traced || l.b === traced)
      // In the cycle a link reads both its ends' slots, so it stays lit with either.
      const ends = cycle.size > 0 ? `--a:${(cycle.get(l.a) ?? -36) / 4};--b:${(cycle.get(l.b) ?? -36) / 4}` : ''
      const strokeAttr = isBright ? `stroke="${model.topicById[traced ?? '']?.color ?? ACCENT}"${ends ? ` style="${ends}"` : ''}` : `style="stroke:var(--x)${ends ? `;${ends}` : ''}"`
      const ia = indexOf.get(l.a) ?? 0
      const ib = indexOf.get(l.b) ?? 0
      parts.push(
        `<line class="x x-${ia} x-${ib}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${strokeAttr} stroke-width="${isBright ? 1.2 : 1}" stroke-dasharray="2 5" opacity="${isBright ? 0.8 : traced ? 0.35 : 0.8}"/>`,
      )
    }
    for (const t of model.topics) {
      const p = placed[t.id]
      if (!p) continue
      const i = indexOf.get(t.id) ?? 0
      const isTraced = traced === t.id
      const isRelated = related.has(t.id)
      let opacity = 1
      if (traced) opacity = isTraced ? 1 : isRelated ? 0.8 : 0.3
      if (!topicMatches(query, t)) opacity = Math.min(opacity, 0.25)
      if (t.sessions.length > 0 && !t.sessions.some(s => s.isInRange)) opacity = Math.min(opacity, 0.4)
      const isDrop = dropSource !== undefined && dropSource !== t.id
      const countLabel = query ? `${t.sessions.filter(s => matches(query, s)).length} match` : `${t.sessions.length}${view.me.topicId === t.id ? ' · you' : ''}`
      const linked = relatedOf(model.links, t.id)
      const d = cycle.get(t.id)
      const running = runningIn(t)
      if (live) {
        // Its spokes and its links to other topics in its colour; the rest fades (above), the caption takes the hint's place.
        css.push(`.t-${i}:hover .ln{stroke:${t.color}!important;opacity:.8!important}`, `.t-${i}:hover .sat{r:10px}`, `.f:has(.t-${i}:hover) .c-${i}{opacity:1}`)
        if (linked.length > 0) css.push(`.f:has(.t-${i}:hover) .x-${i}{stroke:${t.color}!important;opacity:.8!important}`)
        capOf(`c-${i}${d ? ' cy' : ''}`, `${running > 0 ? `● live · ${running} running · ` : ''}${clipName(t.name, 28)} · ${captionOf(t, now)}`, t.color, d ? `--d:${d}s` : '')
      } else {
        css.push(`.t-${i}:hover .ln{stroke:${t.color}}`, `.t-${i}:hover .sat{r:10px}`)
        for (const r of linked) {
          const j = indexOf.get(r.id)
          if (j !== undefined) css.push(`svg:has(.t-${i}:hover) .t-${j}{opacity:.8}`, `svg:has(.t-${i}:hover) .x-${i}{stroke:${t.color};opacity:.8}`)
        }
      }
      const cy = d ? ` cy` : ''
      const cyStyle = d ? `;--d:${d}s;--c:${t.color};--i:${d / 4}` : ''
      const motion = live ? `animation-duration:${tenth(7 + (i % 5) * 0.8)}s;animation-delay:-${tenth((i * 1.9) % 7)}s${cyStyle};` : ''
      const g: string[] = [`<g class="t t-${i}${running > 0 ? ' run' : ''}${cy}" opacity="${opacity.toFixed(2)}" style="${motion}color:${t.color}">`]
      const sessions = t.sessions.slice(0, maxSessions)
      if (live && sessions.length > 0) {
        // Its spokes and satellites sway about its centre as one group, a few degrees each way: a full turn would carry
        // a satellite from the wide end of its ellipse into a neighbour.
        const c = unitCentre(p)
        g.push(`<g class="o" style="transform-origin:${c.x.toFixed(1)}px ${c.y.toFixed(1)}px;animation-duration:${45 + ((i * 17) % 46)}s;animation-direction:${i % 2 === 0 ? 'alternate' : 'alternate-reverse'}">`)
      }
      sessions.forEach((s, k) => {
        const sp = satellitePosition(p, k, size)
        if (s.isInRange) {
          // From the unit's edge, never across its own label.
          const from = unitEdge(p, sp)
          g.push(`<path class="ln${isTraced ? ' lt' : traced ? ' lf' : ''}" d="M${tenth(from.x)} ${tenth(from.y)}l${tenth(sp.x - from.x)} ${tenth(sp.y - from.y)}"/>`)
        }
      })
      sessions.forEach((s, k) => {
        const sp = satellitePosition(p, k, size)
        const isSel = ui.selected === s.id
        const isMatch = matches(query, s)
        let r = isTraced ? 5 : t.isMajor ? 3.5 : 2.5
        if (isSel) r = 6
        if (query && isMatch) r = Math.max(r, 4.5)
        let op = s.isInRange ? 1 : 0.18
        if (traced && !isTraced) op = Math.min(op, 0.25)
        if (!isMatch) op = Math.min(op, 0.15)
        // This session in the accent colour, as everywhere else; the rest take the topic's colour from its group.
        const tone = s.id === view.me.sessionId ? ACCENT : t.color
        const isRun = s.status === 'active'
        // One group at the satellite's place holds its marks, so none repeats the position: forty topics keep their six.
        const cls = `s n hit${isRun ? ' sr' : ''}${s.status === 'archived' ? ' sa' : ''}`
        const glow = isSel || (query && isMatch) ? `<circle r="${r + 4}" fill="${rgba(t.color, 0.3)}"/>` : ''
        const halo = `<circle class="sh" r="${r + 5}"/>`
        // A running satellite: a bright core, and a ripple on a clock of its own so no two widen together.
        const core = isRun ? `<circle class="co" r="${Math.max(1, r * 0.45).toFixed(1)}"/>` : ''
        const clock = clockOf(i * 7 + k * 3)
        const rip = isRun && live ? `<circle class="rp" r="${r + 1.5}" style="--u:${Number(clock.d)}s;--v:-${Number(clock.off)}s"/>` : ''
        const tip = withTooltips ? `<title>${esc(s.title)}\n${esc(sessionMeta(s, now))}${noteText(s) ? `\n${esc(clip(noteText(s), 160))}` : ''}</title>` : ''
        const pin = s.isPinned ? `<text x="5" y="-5" font-size="9" fill="${ACCENT}">★</text>` : ''
        g.push(
          `<g class="${cls}" transform="translate(${tenth(sp.x)} ${tenth(sp.y)})"${op < 1 ? ` opacity="${op.toFixed(2)}"` : ''}${tone !== t.color ? ` style="color:${tone}"` : ''}>` +
            `${tip}${halo}${glow}${rip}<circle class="sat" r="${r}"/>${core}${pin}</g>`,
        )
      })
      if (live && sessions.length > 0) g.push('</g>')
      if (t.isMajor) {
        const w = pillWidth(t.name, countLabel)
        const x = p.x - w / 2
        const y = p.y - 19
        const dashed = isDrop ? ' stroke-dasharray="4 3"' : ''
        // A running topic: an always-on halo stronger than any other, a ring in its colour, and its dot ringed as a live dot.
        if (running > 0) g.push(`<rect class="rh" x="${(x - 8).toFixed(1)}" y="${y - 8}" width="${(w + 16).toFixed(1)}" height="54" rx="27" fill="${rgba(t.color, 0.3)}"/>`)
        g.push(
          `<rect class="glow" x="${(x - 5).toFixed(1)}" y="${y - 5}" width="${(w + 10).toFixed(1)}" height="48" rx="24" fill="${rgba(t.color, 0.22)}"${isTraced || isDrop ? ' opacity="1"' : ''}/>`,
          ...(running > 0 ? [`<rect class="rg" x="${(x - 3.5).toFixed(1)}" y="${y - 3.5}" width="${(w + 7).toFixed(1)}" height="45" rx="22.5" fill="none" stroke="${t.color}" stroke-width="1.5" opacity="0.9"/>`] : []),
          `<rect class="pill hit" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="38" rx="19" style="fill:var(${isTraced ? '--pill2' : '--pill'})" stroke="${t.color}" stroke-width="1.5"${dashed}/>`,
          ...(running > 0 ? [`<circle class="ld" cx="${(x + 17).toFixed(1)}" cy="${p.y}" r="7" fill="none" stroke="${t.color}" stroke-width="1.2" opacity="0.8"/>`] : []),
          `<circle cx="${(x + 17).toFixed(1)}" cy="${p.y}" r="4" fill="${t.color}"/>`,
          `<text class="nm" x="${(x + 28).toFixed(1)}" y="${p.y + 4.5}" font-size="13" font-weight="600" style="fill:var(--tx)">${esc(clipName(t.name, 28))}</text>`,
          `<text class="mono" x="${(x + w - 14).toFixed(1)}" y="${p.y + 4}" font-size="11" font-weight="500" fill="${t.color}" text-anchor="end">${esc(countLabel)}</text>`,
        )
      } else {
        // The label hangs right of the dot; the placement reserved that room.
        // Running: the halo and ring as a pill has them, and the dot itself filled as the live dot.
        if (running > 0) g.push(`<circle class="rh" cx="${p.x}" cy="${p.y}" r="14" fill="${rgba(t.color, 0.3)}"/>`, `<circle class="rg" cx="${p.x}" cy="${p.y}" r="9" fill="none" stroke="${t.color}" stroke-width="1.2" opacity="0.9"/>`)
        g.push(
          `<circle class="glow" cx="${p.x}" cy="${p.y}" r="11" fill="${rgba(t.color, 0.22)}"${isTraced || isDrop ? ' opacity="1"' : ''}/>`,
          `<circle class="hit${running > 0 ? ' ld' : ''}" cx="${p.x}" cy="${p.y}" r="5.5" ${running > 0 ? `fill="${t.color}"` : 'style="fill:var(--pill)"'} stroke="${t.color}" stroke-width="1.5"${isDrop ? ' stroke-dasharray="3 2"' : ''}/>`,
          `<text class="mono lbl" x="${p.x + 16}" y="${p.y + 4}" font-size="11.5" style="fill:var(${isTraced ? '--tx' : '--mu'})">${esc(clipName(t.name, 24))} <tspan fill="${t.color}">${esc(countLabel)}</tspan></text>`,
        )
      }
      g.push('</g>')
      parts.push(g.join(''))
    }
    if (model.topics.length === 0) {
      // An unformed constellation over the title: four faint stars a dashed hairline has yet to join.
      const cx = size.w / 2
      const cy = size.h / 2 - 62
      const stars: [number, number, number][] = [[-54, 10, 2.5], [-18, -12, 3.5], [20, 6, 2.5], [56, -10, 3]]
      parts.push(
        `<g class="empty"><path d="M${stars.map(([x, y]) => `${cx + x} ${cy + y}`).join('L')}" fill="none" style="stroke:var(--ln)" stroke-width="1" stroke-dasharray="3 5"/>`,
        ...stars.map(([x, y, r], k) => `<circle class="tw" cx="${cx + x}" cy="${cy + y}" r="${r}" style="fill:var(--star2);animation-duration:${4 + k * 1.3}s"/>`),
        '</g>',
      )
      parts.push(`<text x="${size.w / 2}" y="${size.h / 2 - 10}" font-size="15" font-weight="500" style="fill:var(--tx)" text-anchor="middle">No sessions on this map yet</text>`)
      parts.push(`<text x="${size.w / 2}" y="${size.h / 2 + 16}" font-size="12" style="fill:var(--mu)" text-anchor="middle">Sessions in this folder appear here once they have run; /topic names this one.</text>`)
    }
  } else {
    const steps = chainOf(view, focus)
    const positions = chainPositions(steps.length, size)
    const latest = latestOf(focus.sessions)
    const color = focus.color === MINOR_COLOR ? ACCENT : focus.color
    if (live) {
      // A hovered step or anchor brightens, the rest of the chain fades, and its meta takes the hint's place.
      css.push(
        `.f:has(.st:hover,.an:hover) .hint{opacity:0}`,
        `.f:has(.st:hover,.an:hover) .st:not(:hover),.f:has(.st:hover,.an:hover) .an:not(:hover),.f:has(.st:hover,.an:hover) .ch{opacity:.15}`,
        `.st:hover,.an:hover{opacity:1!important}`,
        `.st:hover .ring{stroke-width:3px}`,
        `.an:hover rect{stroke-dasharray:none;stroke-width:1.5px}`,
      )
    }
    // Each step to the next: a segment from circle edge to circle edge, its arrow at the next circle's rim.
    for (let i = 1; i < positions.length && i < steps.length; i += 1) {
      const a = positions[i - 1]
      const b = positions[i]
      if (!a || !b) continue
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const ux = (b.x - a.x) / d
      const uy = (b.y - a.y) / d
      parts.push(`<line${live ? ' class="ch"' : ''} x1="${(a.x + ux * 19).toFixed(1)}" y1="${(a.y + uy * 19).toFixed(1)}" x2="${(b.x - ux * 21).toFixed(1)}" y2="${(b.y - uy * 21).toFixed(1)}" stroke="${color}" stroke-width="1.6" marker-end="url(#arrow)" opacity="0.9"/>`)
    }
    const chars = chainLabelChars(steps.length, size)
    // Every step labelled: each meta line keeps to its room on its row. A crowded chain labels a few steps apart from each other, which take more.
    const metaChars = chainMetaChars(steps.length, size)
    // A crowded chain labels the steps that matter here: the selected one, then "you", then the latest, then the first.
    // Of two too close on one row the lesser goes; the tooltips carry the rest.
    const crowd = chars > 0
      ? undefined
      : crowdedLabels(steps.map((step, i) => {
          const s = step.session
          if (s !== undefined && ui.selected === s.id) return 4
          if (step.isYou) return 3
          if (s !== undefined && latest !== undefined && s.id === latest.id) return 2
          return i === 0 ? 1 : 0
        }), positions)
    steps.forEach((step, i) => {
      const pt = positions[i]
      if (!pt) return
      const s = step.session
      const isSel = s !== undefined && ui.selected === s.id
      const isLatest = s !== undefined && latest !== undefined && s.id === latest.id
      const status = s?.status ?? 'active'
      const isYou = step.isYou
      const fill = isYou ? rgba(ACCENT, 0.16) : isSel ? color : status === 'active' ? rgba(color, 0.25) : 'var(--pill)'
      const numColor = isYou ? ACCENT : isSel ? 'var(--inv)' : status === 'archived' ? 'var(--mu)' : 'var(--tx)'
      const ring = isYou ? ACCENT : status === 'archived' ? 'var(--dim)' : color
      const dash = isYou || status === 'archived' ? ' stroke-dasharray="4 3"' : ''
      const op = isYou || (s && matches(query, s)) ? 1 : 0.25
      const isTight = steps.length >= 5
      const title = isYou ? 'This session · you' : (s?.title ?? '')
      const crowded = crowd?.get(i)
      const isLabelled = chars > 0 || crowded !== undefined
      const room = crowded?.title ?? chars
      // The meta line keeps to its room on its row and to the field's edge. Where room is short it sheds its turns, then
      // "latest" (the glow says it), before a word is cut; "you" sheds its "now".
      const metaRoom = Math.max(6, Math.min(crowded?.meta ?? metaChars, Math.floor((2 * Math.min(pt.x, size.w - pt.x) - 8) / 6.3)))
      const age = s ? `${ageOf(s.lastAt, now)} ago` : ''
      const latestTag = isLatest ? ['latest'] : []
      const metas = isYou
        ? ['now · you', 'you']
        : s
          ? [...(isTight ? [] : [sessionMeta(s, now, isLatest ? 'latest' : '')]), [...latestTag, age, turnsOf(s)].join(' · '), [...latestTag, age].join(' · '), age]
          : ['']
      const meta = metas.find(m => m.length <= metaRoom) ?? metas[metas.length - 1] ?? ''
      const lines = isLabelled ? wrap2(title, Math.min(isTight ? room : 22, room)) : []
      const tip = withTooltips && s && !isYou ? `<title>${esc(s.title)}\n${esc(sessionMeta(s, now))}${noteText(s) ? `\n${esc(clip(noteText(s), 160))}` : ''}</title>` : ''
      if (live) {
        css.push(`.f:has(.st-${i}:hover) .q-${i}{opacity:1}`)
        capOf(`q-${i}`, `${i + 1} · ${isYou ? 'This session · you' : `${clip(title, 40)} · ${s ? sessionMeta(s, now, isLatest ? 'latest' : '') : ''}`}`, isYou ? ACCENT : color)
      }
      const g: string[] = [`<g class="n hit${live ? ` st st-${i}` : ''}" opacity="${op.toFixed(2)}">${tip}`]
      if (isLatest) g.push(`<circle${live ? ' class="br"' : ''} cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="21" fill="${rgba(color, 0.22)}"/>`)
      // A running step (and "you") ripples, and wears a bright core on its rim, clear of its number.
      const isRun = isYou || status === 'active'
      if (isRun) g.push(ripple(pt.x, pt.y, 17, ring, i * 5 + 2))
      g.push(`<circle${live ? ' class="ring"' : ''} cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="16" style="fill:${fill};stroke:${ring}" stroke-width="2"${dash}/>`)
      g.push(`<text class="mono" x="${pt.x.toFixed(1)}" y="${(pt.y + 4.5).toFixed(1)}" font-size="12.5" font-weight="600" style="fill:${numColor}" text-anchor="middle">${i + 1}</text>`)
      if (isRun) g.push(`<circle class="co" cx="${(pt.x + 11.3).toFixed(1)}" cy="${(pt.y + 11.3).toFixed(1)}" r="3.5" fill="#FFFFFF" stroke="${ring}" stroke-width="1.5"/>`)
      if (s?.isPinned) g.push(`<text x="${(pt.x + 12).toFixed(1)}" y="${(pt.y - 10).toFixed(1)}" font-size="10" fill="${ACCENT}">★</text>`)
      const labelColor = isYou ? ACCENT : isSel ? 'var(--tx)' : status === 'archived' ? 'var(--mu)' : 'var(--lb)'
      if (isLabelled) {
        // The upper row's label stands above its circle, the lower row's hangs below: neither meets the other row.
        const metaText = clip(meta, metaRoom)
        const isAbove = isUpperStep(i, size.w)
        const ty = isAbove ? pt.y - 26 - lines.length * 14 : pt.y + 32
        g.push(`<text x="${pt.x.toFixed(1)}" y="${ty}" font-size="11.5" style="fill:${labelColor}" text-anchor="middle">${lines.map((l, k) => `<tspan x="${pt.x.toFixed(1)}" dy="${k === 0 ? 0 : 14}">${esc(l)}</tspan>`).join('')}</text>`)
        g.push(`<text class="mono" x="${pt.x.toFixed(1)}" y="${ty + lines.length * 14}" font-size="10.5" style="fill:${isLatest ? color : 'var(--mu)'}" text-anchor="middle">${esc(metaText)}</text>`)
      }
      g.push('</g>')
      parts.push(g.join(''))
    })
    const { count: countLabel, w } = focusPillOf(view, focus)
    const pillX = size.w / 2
    const x = pillX - w / 2
    const y = FOCUS_PILL.y - 19
    parts.push(
      `<rect x="${(x - 6).toFixed(1)}" y="${y - 6}" width="${(w + 12).toFixed(1)}" height="50" rx="25" fill="${rgba(color, 0.2)}"/>`,
      `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="38" rx="19" style="fill:var(--pill2)" stroke="${color}" stroke-width="1.5"/>`,
      `<circle cx="${(x + 17).toFixed(1)}" cy="${FOCUS_PILL.y}" r="4" fill="${color}"/>`,
      `<text x="${(x + 28).toFixed(1)}" y="${FOCUS_PILL.y + 4.5}" font-size="13" font-weight="600" style="fill:var(--tx)">${esc(clipName(focus.name, 28))}</text>`,
      `<text class="mono" x="${(x + w - 14).toFixed(1)}" y="${FOCUS_PILL.y + 4}" font-size="11" font-weight="500" fill="${color}" text-anchor="end">${esc(countLabel)}</text>`,
    )
    if (focus.goal) {
      // Under the topic's pill, above the chain's upper labels.
      parts.push(`<text x="${pillX}" y="${FOCUS_PILL.y + 46}" font-size="11.5" style="fill:var(--lb)" text-anchor="middle"><tspan class="mono" style="fill:var(--mu)">GOAL</tspan>  ${esc(clip(focus.goal, Math.floor((size.w - 80) / 6.2)))}</text>`)
    }
    if (steps.length === 0) {
      parts.push(`<text x="${size.w / 2}" y="262" font-size="12.5" style="fill:var(--mu)" text-anchor="middle">${esc(clip('No sessions in the time range. Widen the range, or pin one.', Math.floor((size.w - 40) / 6.6)))}</text>`)
    }
    anchorsOf(view, focus, size).forEach((a, k) => {
      const left = a.x - a.w / 2
      if (live) {
        css.push(`.f:has(.an-${k}:hover) .r-${k}{opacity:1}`)
        capOf(`r-${k}`, `${clipName(a.topic.name, 28)} · via ${a.via} · ${captionOf(a.topic, now)}`, a.topic.color)
      }
      parts.push(
        `<g class="hit${live ? ` an an-${k}` : ''}" opacity="0.9"><rect x="${left.toFixed(1)}" y="${a.y - 16}" width="${a.w.toFixed(1)}" height="32" rx="16" style="fill:var(--glass)" stroke="${a.topic.color}" stroke-width="1" stroke-dasharray="4 3"/>`,
        `<circle cx="${(left + 15).toFixed(1)}" cy="${a.y}" r="3.5" fill="${a.topic.color}"/>`,
        `<text x="${(left + 25).toFixed(1)}" y="${a.y + 4}" font-size="12" style="fill:var(--lb)">${esc(a.name)}${a.file ? ` <tspan class="mono" font-size="10.5" style="fill:var(--mu)">${esc(a.file)}</tspan>` : ''}</text></g>`,
      )
    })
    parts.push(
      `<g class="hit"><rect x="14" y="12" width="96" height="30" rx="15" style="fill:var(--glass);stroke:var(--x)"/><text x="30" y="31" font-size="12" style="fill:var(--lb)">‹ All topics</text></g>`,
    )
  }

  // An empty map has nothing to hover and nothing to tell apart: its title alone, no hint and no legend.
  const isEmpty = !focus && model.topics.length === 0
  const hint = hintFitted(view, size)
  const hw = 24 + hint.length * 6.3
  if (!isEmpty) {
    parts.push(
      `<g class="hint"><rect x="${(size.w / 2 - hw / 2).toFixed(1)}" y="14" width="${hw.toFixed(1)}" height="30" rx="15" style="fill:var(--glass);stroke:var(--x)"/>`,
      `<text x="${size.w / 2}" y="33" font-size="12" style="fill:var(--lb)" text-anchor="middle">${esc(hint)}</text></g>`,
    )
  }
  parts.push(...caps)
  const ly = size.h - 16
  if (!isEmpty) parts.push(
    `<g font-size="11" style="fill:var(--mu)">`,
    `<circle cx="20" cy="${ly - 4}" r="4" fill="${ACCENT}"/><text x="29" y="${ly}">active</text>`,
    `<circle cx="78" cy="${ly - 4}" r="4" fill="none" style="stroke:var(--mu)" stroke-width="1.5"/><text x="87" y="${ly}">idle</text>`,
    `<circle cx="124" cy="${ly - 4}" r="4" fill="none" style="stroke:var(--dim)" stroke-width="1.5" stroke-dasharray="2 2"/><text x="133" y="${ly}">shipped</text>`,
    `<text x="186" y="${ly}" fill="${ACCENT}">★</text><text x="199" y="${ly}">pinned</text>`,
    `</g>`,
  )
  parts.push(`<rect x="0.5" y="0.5" width="${size.w - 1}" height="${size.h - 1}" rx="16" fill="none" style="stroke:var(--line)"/>`)
  parts.push('</g></svg>')
  parts[styleAt] = `<style>${css.join('')}</style>`
  return parts.join('')
}

/** What the drawing says, for a reader without the picture. */
export function altOf(view: View): string {
  const { model, ui } = view
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  if (focus) {
    const steps = chainOf(view, focus)
    return `${focus.name}, focused: ${steps.map((s, i) => `${i + 1} ${s.isYou ? 'this session' : (s.session?.title ?? '')}`).join('; ')}`
  }
  return `Topic map: ${model.topics.map(t => `${t.name} (${t.sessions.length})`).join(', ') || 'no topics yet'}`
}

/** The element constructors a tree here needs; the optional ones depend on the surface. */
export type Table = {
  Box: Elements['terminal']['Box']
  Text: Elements['terminal']['Text']
  Button: Elements['terminal']['Button']
  Input?: Elements['terminal']['Input']
  Select?: Elements['terminal']['Select']
  Svg?: Elements['desktop']['Svg']
}

/** Everything a press in the pane or the band may do; the entry point binds these to `$`. */
export type Actions = {
  setView: (view: UiState['view']) => void
  focusTopic: (id: string | null) => void
  selectSession: (id: string | null) => void
  setQuery: (q: string) => void
  setRange: (days: number) => void
  toggleSettings: () => void
  setSetting: (key: keyof MapSettings, value: string | number | boolean) => void
  join: (topicId: string) => void
  newTopic: () => void
  createTopic: (name: string) => void
  cancelNewTopic: () => void
  changeTopic: () => void
  dismissBand: () => void
  pickUp: (sessionId: string) => void
  pickUpLatest: (topicId: string) => void
  draft: (sessionId: string | null) => void
  parkPrompt: () => void
  park: (text: string) => void
  skipNote: () => void
  message: (sessionId: string, text: string) => void
  messageMode: (on: boolean) => void
  newSession: (sessionId: string) => void
  pin: (sessionId: string) => void
  archive: (sessionId: string) => void
  tidy: (topicId: string) => void
  moveMode: (on: boolean) => void
  moveTo: (topicId: string) => void
  edit: (kind: UiState['editing']) => void
  rename: (topicId: string, name: string) => void
  setGoal: (topicId: string, goal: string) => void
  setColor: (topicId: string, color: string) => void
  mergeMode: (topicId: string | null) => void
  mergeInto: (targetId: string) => void
  undo: () => void
  dismissToast: () => void
  dismissDigest: () => void
  back: () => void
  allTopics: () => void
  openMap: () => void
  jumpTo: (sessionId: string) => void
  myTopic: () => void
  toggleHelp: () => void
  toggleAdvanced: () => void
  refresh: () => void
}

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7d' },
  { value: '14', label: 'Last 14d' },
  { value: '30', label: 'Last 30d' },
  { value: String(ALL_TIME_DAYS), label: 'All time' },
]

const COLOR_OPTIONS = PALETTE.map((hex, i) => ({ value: hex, label: ['Lime', 'Violet', 'Mint', 'Sky', 'Rose'][i] ?? hex }))

/** The band's chooser keeps to the nine digit hotkeys; the pane's chooser lists every topic. */
const MAX_BAND_CHIPS = 9

function crumbOf(view: View): string {
  const { model, ui, me } = view
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  const sel = ui.selected ? model.byId[ui.selected] : undefined
  let crumb = me.folder || 'folder'
  if (focus) crumb += ` › ${focus.name}`
  if (focus && sel) crumb += ` › ${clip(sel.title, 36)}`
  if (!focus) crumb += ` › ${model.topics.length} topic${model.topics.length === 1 ? '' : 's'}`
  return crumb
}

export function statsOf(model: Model): string {
  const total = model.sessions.length
  const active = model.sessions.filter(s => s.status === 'active').length
  return `${model.topics.filter(t => t.id !== UNSORTED_ID).length} topics · ${total} sessions · ${active} active`
}

export function drawHeader(T: Table, view: View, act: Actions): RenderElement {
  const { Box, Text, Button, Input, Select } = T
  const { ui } = view
  // The Desktop draws each control as a chip, the current one tinted in the accent; the terminal has no
  // fills or hairlines to spare, so there the current view keeps its `primary` (reversed) button.
  const framed = view.surface !== 'terminal'
  const pick = (id: string, isOn: boolean, button: RenderElement) => (isOn ? chip(T, view, `hb:${id}`, ACCENT, 'accent', [button]) : outline(T, view, `hb:${id}`, [button]))
  return (
    <Box flexDirection="column" gap="xs">
      {/* The title and the crumb on one row, the controls on the next: a narrow pane wraps the controls alone, in order. */}
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Text weight="medium">Constellation</Text>
        <Text dimColor size="footnote" wrap="truncate">
          {crumbOf(view)}
        </Text>
      </Box>
      <Box flexDirection="row" alignItems="center" gap="xs" flexWrap="wrap">
        {Input ? <Input key="q" placeholder="Search sessions, notes, files" value={ui.query} submitLabel="search" onInput={v => act.setQuery(v)} onSubmit={v => act.setQuery(v)} /> : null}
        {Select ? <Select key="range" options={RANGE_OPTIONS} value={String(view.settings.rangeDays)} onSelect={v => act.setRange(Number(v))} /> : null}
        {pick('map', ui.view === 'map', <Button key="view:map" label="Map" hotkey={hk(view, 'm')} plain={framed || undefined} variant={framed ? undefined : ui.view === 'map' ? 'primary' : 'secondary'} onPress={() => act.setView('map')} />)}
        {pick('list', ui.view === 'list', <Button key="view:list" label="List" hotkey={hk(view, 'l')} plain={framed || undefined} variant={framed ? undefined : ui.view === 'list' ? 'primary' : 'secondary'} onPress={() => act.setView('list')} />)}
        {pick('settings', ui.showSettings, <Button key="settings" label={`${marks(view).gear}${ui.showSettings ? 'Done' : 'Settings'}`} hotkey={hk(view, 's')} plain={framed || undefined} onPress={() => act.toggleSettings()} />)}
        {pick('help', ui.showHelp, <Button key="help" label={ui.showHelp ? 'Close help' : 'Help'} hotkey={hk(view, 'h')} plain={framed || undefined} onPress={() => act.toggleHelp()} />)}
        {view.me.topicId ? (
          <Box key="hb:mine" flexDirection="row" alignItems="center" gap="xs" paddingX={1} hover={{ backgroundColor: rgba(ACCENT, 0.12) }}>
            <Text color={ACCENT}>♦</Text>
            <Button key="mine" label="my topic" hotkey={hk(view, 'y')} plain onPress={() => act.myTopic()} />
          </Box>
        ) : null}
        {ui.query.trim() ? <Button key="q:clear" label="× clear search" plain dimColor onPress={() => act.setQuery('')} /> : null}
        <Button key="refresh" label={`${marks(view).refresh}refresh`} plain dimColor onPress={() => act.refresh()} />
      </Box>
      {ui.digest ? (
        <Box flexDirection="row" gap="sm" alignItems="center">
          <Text dimColor size="footnote">
            {ui.digest}
          </Text>
          <Button key="digest:ok" label="OK" plain dimColor onPress={() => act.dismissDigest()} />
        </Box>
      ) : null}
    </Box>
  )
}

/** The buttons under the map: topics on the field, or the focused chain's steps, back and anchors. */
export function drawControls(T: Table, view: View, act: Actions): RenderElement {
  const { Box, Text, Button } = T
  const { model, ui } = view
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  const framed = view.surface !== 'terminal'
  if (!focus) {
    // A merge or move pick strengthens every chip so it reads as a target; the terminal shows it as buttons.
    const isPicking = ui.mergeFrom !== null || ui.moveMode
    return (
      <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
        {model.topics.map(t =>
          chip(T, view, `tb:${t.id}`, t.color, isPicking ? 'strong' : t.isMajor ? 'normal' : 'quiet', [
            <Text color={t.color}>●</Text>,
            <Button
              key={`t:${t.id}`}
              label={clip(t.name, 28)}
              plain={framed || !isPicking ? true : undefined}
              dimColor={!t.isMajor}
              onPress={() => (ui.mergeFrom !== null ? act.mergeInto(t.id) : ui.moveMode ? act.moveTo(t.id) : act.focusTopic(t.id))}
            />,
            <Text dimColor mono size="footnote">
              {String(t.sessions.length)}
            </Text>,
            runningOf(view, t) > 0 ? (
              <Text color={ACCENT} size="footnote">
                live
              </Text>
            ) : null,
          ]),
        )}
        {ui.mergeFrom !== null ? outline(T, view, 'xb:merge', [<Button key="merge:cancel" label="Cancel merge" plain={framed || undefined} onPress={() => act.mergeMode(null)} />]) : null}
        {ui.moveMode ? outline(T, view, 'xb:move', [<Button key="move:cancel" label="Cancel move" plain={framed || undefined} onPress={() => act.moveMode(false)} />]) : null}
      </Box>
    )
  }
  const steps = chainOf(view, focus)
  const rel = view.settings.showRelated ? relatedOf(model.links, focus.id) : []
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
        {outline(T, view, 'bb:back', [<Button key="back" label="‹ All topics" hotkey={hk(view, 'b')} plain={framed || undefined} onPress={() => act.allTopics()} />])}
        {steps.map((s, i) => {
          const isSelected = ui.selected === s.id
          // Steps 1–9 show their number as the hotkey's key cap; past nine, or in a chat row, it is a dim number.
          const hotkey = hk(view, i < 9 ? String(i + 1) : undefined)
          return chip(T, view, `sb:${s.id}`, focus.color, isSelected ? 'strong' : 'quiet', [
            hotkey ? null : (
              <Text dimColor mono size="footnote">
                {String(i + 1)}
              </Text>
            ),
            <Button
              key={`s:${s.id}`}
              label={s.isYou ? 'This session' : clip(s.session?.title ?? '', 26)}
              hotkey={hotkey}
              plain
              variant={!framed && isSelected ? 'primary' : undefined}
              onPress={() => (s.isYou ? act.selectSession(null) : act.selectSession(isSelected ? null : s.id))}
            />,
            s.isYou || s.session?.status === 'active' ? (
              <Text color={ACCENT} size="footnote">
                {s.isYou ? 'you' : 'live'}
              </Text>
            ) : null,
          ])
        })}
      </Box>
      {rel.length > 0 ? (
        <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
          <Text dimColor size="footnote">
            related
          </Text>
          {rel.map(r => {
            const rt = model.topicById[r.id]
            return rt
              ? chip(T, view, `ab:${rt.id}`, rt.color, 'quiet', [
                  <Text color={rt.color}>●</Text>,
                  <Button key={`a:${rt.id}`} label={clip(rt.name, 22)} plain dimColor onPress={() => act.focusTopic(rt.id)} />,
                  <Text dimColor mono size="footnote">
                    {r.via}
                  </Text>,
                ])
              : null
          })}
        </Box>
      ) : null}
    </Box>
  )
}

/** "Jump back in": the three most recent sessions, each one press from its card and a pick-up. */
export function drawRecent(T: Table, view: View, act: Actions): RenderElement | null {
  const { Box, Text, Button } = T
  const { model, ui, now } = view
  if (ui.focusTopic || ui.selected || ui.showSettings || ui.showHelp || ui.query.trim() || ui.moveMode || ui.mergeFrom !== null) return null
  const recent = model.sessions.filter(s => s.isInRange && s.status !== 'archived').slice(0, 3)
  if (recent.length === 0) return null
  return (
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      <Text dimColor size="footnote">
        Jump back in
      </Text>
      {recent.map(s => {
        const color = model.topicById[s.topicId]?.color ?? ACCENT
        // The chip carries its topic's colour; the glyph turns to the accent while the session runs.
        return chip(T, view, `rb:${s.id}`, color, 'quiet', [
          <Text color={s.status === 'active' ? ACCENT : color}>{statusGlyph(s)}</Text>,
          <Button key={`r:${s.id}`} label={clip(s.title, 32)} plain onPress={() => act.jumpTo(s.id)} />,
          <Text dimColor mono size="footnote">
            {ageOf(s.lastAt, now)}
          </Text>,
        ])
      })}
    </Box>
  )
}

/** Every command, for the help card and `/map help`. */
export const HELP_COMMANDS: [string, string][] = [
  ['/map', 'open or close the pane'],
  ['/map here', 'print the map in the chat, as of now'],
  ['/map <topic or n>', 'open the pane focused on a topic'],
  ['/map find <text>', 'open the pane searching titles, notes, files and branches'],
  ['/map settings', 'open the pane on its settings'],
  ['/map export [path]', 'write topics, goals and notes as Markdown'],
  ['/map close', 'close the pane'],
  ['/topic', 'say where this session is and list the topics, numbered'],
  ['/topic <name or n>', 'join a topic; a new name creates it'],
  ['/park <note>', 'save this session’s handoff note'],
  ['/pickup [n]', 'put step n’s note, or the latest, beside your next prompt'],
  ['/pickup list', 'list the steps of your topic with their notes'],
]

/** Every key the pane answers, for the help card and `/map help`. */
export const HELP_KEYS: [string, string][] = [
  ['Tab · Enter', 'walk the buttons; Enter presses the one under the ring'],
  ['1–9', 'a chooser topic, or a step of the focused topic'],
  ['Esc', 'back one level; closes the pane when nothing is left'],
  ['m · l', 'map · list'],
  ['s · h', 'settings · this help'],
  ['y', 'focus my topic'],
  ['b', 'back to all topics'],
  ['f', 'focus the topic shown'],
  ['u', 'pick up: its note goes beside your next prompt'],
  ['d', 'draft the next prompt into the composer'],
  ['j', 'join the topic shown'],
  ['c · p', 'change topic · park a note, on the joined card'],
  ['r · g · e', 'rename · goal · merge, on a topic card'],
  ['n', 'new topic in the chooser; new session from here on a session card'],
  ['p · v · x · t', 'pin · move to topic · archive · message, on a session card'],
  ['z', 'undo the last archive, move, rename or merge'],
  ['o', 'open the map, from the start band'],
]

const HELP_NOTE =
  'Hover or Tab onto a topic to trace it. In focus the numbers follow time order and the glowing step is the latest. Select a session, then Move to topic, to move it. The terminal map takes clicks and drags in the fullscreen renderer (/tui fullscreen, the default after the first start; CLAUDE_CODE_DISABLE_MOUSE=1 turns the mouse off); the classic inline pane has no mouse, so Tab and Enter do the same work there. A click never takes the keys: every hotkey still works after one.'

/** `/map help`: the help card's content as text. */
export function helpText(): string {
  return [
    'Constellation commands:',
    ...HELP_COMMANDS.map(([c, what]) => `  ${c.padEnd(20)} ${what}`),
    'Keys in the pane, while it has the focus (a click or ctrl+x tab gives it):',
    ...HELP_KEYS.map(([k, what]) => `  ${k.padEnd(20)} ${what}`),
    HELP_NOTE,
  ].join('\n')
}

export function drawHelp(T: Table, act: Actions): RenderElement {
  const { Box, Text, Button } = T
  return card(T, [
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Text dimColor mono size="footnote">
        HELP · commands and keys
      </Text>
      <Button key="help:done" label="Done" onPress={() => act.toggleHelp()} />
    </Box>,
    <Text dimColor mono size="footnote">
      COMMANDS
    </Text>,
    ...HELP_COMMANDS.map(([c, what]) => (
      <Box key={`help:${c}`} flexDirection="row" gap="sm">
        <Text mono>{c}</Text>
        <Text dimColor>{what}</Text>
      </Box>
    )),
    <Text dimColor mono size="footnote">
      KEYS · while the pane has the focus (a click or ctrl+x tab gives it)
    </Text>,
    ...HELP_KEYS.map(([k, what]) => (
      <Box key={`help:${k}`} flexDirection="row" gap="sm">
        <Text mono color={ACCENT}>
          {k}
        </Text>
        <Text dimColor>{what}</Text>
      </Box>
    )),
    <Text dimColor size="footnote">
      {HELP_NOTE}
    </Text>,
  ])
}

function statusGlyph(s: SessionView): string {
  // ◦ rather than ◌ for shipped: every console font has it.
  return s.status === 'active' ? '●' : s.status === 'archived' ? '◦' : '○'
}

/** The outline: every surface's list view and the terminal's map. */
export function drawList(T: Table, view: View, act: Actions): RenderElement {
  const { Box, Text, Button } = T
  const { model, ui, now } = view
  const query = ui.query
  const topics = model.topics.filter(t => topicMatches(query, t))
  // Before a join the chooser's chips hold the digits; the list's steps take them once this session has a topic.
  const stepHotkeys = view.me.topicId !== null || view.me.isNewTopic
  const framed = view.surface !== 'terminal'
  return (
    <Box flexDirection="column" gap="xs">
      {topics.length === 0
        ? card(
            T,
            query.trim()
              ? [<Text key="e:title" weight="medium">{`Nothing matches “${clip(query.trim(), 40)}”`}</Text>, <Text key="e:line" dimColor size="footnote">Search looks through titles, first prompts, notes, files and branches.</Text>]
              : [<Text key="e:title" weight="medium">No sessions on this map yet</Text>, <Text key="e:line" dimColor size="footnote">{'Sessions in this folder appear here once they have run; /topic <name> names this one.'}</Text>],
            HAIRLINE,
            { key: 'cd:empty' },
          )
        : null}
      {topics.map(t => {
        const isOpen = ui.focusTopic === t.id
        const steps = isOpen ? chainOf(view, t).filter(s => s.isYou || (s.session && matches(query, s.session))) : []
        // A shut row is a hairline that takes its topic's colour on hover; an open one wears it, as the cards do.
        const open = tinted(t.color)
        return (
          <Box
            key={`lr:${t.id}`}
            flexDirection="column"
            borderStyle="round"
            borderColor={isOpen ? open.borderColor : HAIRLINE}
            backgroundColor={isOpen ? open.fill : undefined}
            hover={isOpen ? undefined : { borderColor: rgba(t.color, 0.5), backgroundColor: rgba(t.color, 0.04) }}
            paddingX={1}
          >
            <Box key={`lh:${t.id}`} flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
              <Text color={t.color}>●</Text>
              <Button key={`t:${t.id}`} label={clip(t.name, 40)} plain dimColor={!t.isMajor} onPress={() => (ui.mergeFrom !== null ? act.mergeInto(t.id) : ui.moveMode ? act.moveTo(t.id) : act.focusTopic(isOpen ? null : t.id))} />
              <Text dimColor mono size="footnote">
                {`${t.id === UNSORTED_ID ? 'unsorted' : t.isMajor ? 'major' : 'minor'} · ${t.sessions.length} session${t.sessions.length === 1 ? '' : 's'}${t.sessions.length ? ` · ${ageOf(t.lastAt, now)} ago` : ''}`}
              </Text>
              {view.me.topicId === t.id ? (
                <Text color={ACCENT} size="footnote">
                  you
                </Text>
              ) : null}
              {runningOf(view, t) > 0 ? (
                <Text color={ACCENT} size="footnote">
                  live
                </Text>
              ) : null}
              <Text dimColor>{isOpen ? marks(view).open : marks(view).shut}</Text>
            </Box>
            {isOpen && t.goal ? (
              <Text dimColor size="footnote">
                {`Goal: ${clip(t.goal, 120)}`}
              </Text>
            ) : null}
            {steps.map((s, i) => {
              const isSelected = ui.selected === s.id
              const isLive = s.session?.status === 'active'
              const hotkey = hk(view, stepHotkeys && i < 9 ? String(i + 1) : undefined)
              return chip(T, view, `ls:${s.id}`, t.color, isSelected ? 'strong' : 'row', [
                hotkey ? null : (
                  <Text dimColor mono size="footnote">
                    {String(i + 1)}
                  </Text>
                ),
                s.isYou || isLive ? <Text color={ACCENT}>{s.isYou ? '♦' : '●'}</Text> : <Text dimColor>{statusGlyph(s.session as SessionView)}</Text>,
                <Button
                  key={`s:${s.id}`}
                  label={s.isYou ? 'This session' : clip(s.session?.title ?? '', 48)}
                  hotkey={hotkey}
                  plain
                  variant={!framed && isSelected ? 'primary' : undefined}
                  onPress={() => (s.isYou ? act.selectSession(null) : act.selectSession(isSelected ? null : s.id))}
                />,
                <Text dimColor mono size="footnote">
                  {s.isYou ? 'now' : ageOf(s.session?.lastAt ?? now, now)}
                </Text>,
                s.session?.isPinned ? <Text dimColor>{marks(view).pin}</Text> : null,
                s.isYou || isLive ? (
                  <Text color={ACCENT} size="footnote">
                    {s.isYou ? 'you' : 'live'}
                  </Text>
                ) : null,
              ])
            })}
          </Box>
        )
      })}
      {ui.mergeFrom !== null ? outline(T, view, 'xb:merge', [<Button key="merge:cancel" label="Cancel merge" plain={framed || undefined} onPress={() => act.mergeMode(null)} />]) : null}
      {ui.moveMode ? outline(T, view, 'xb:move', [<Button key="move:cancel" label="Cancel move" plain={framed || undefined} onPress={() => act.moveMode(false)} />]) : null}
    </Box>
  )
}

type SettingRow = { key: keyof MapSettings; label: string; help: string; options: { value: string | number | boolean; label: string }[] }

/** The settings card's rows in three groups; the last is folded until asked for. */
const SETTING_GROUPS: { title: string; rows: SettingRow[]; isAdvanced?: true }[] = [
  {
    title: 'Map',
    rows: [
      { key: 'scope', label: 'Scope', help: 'which transcripts the map reads', options: [{ value: 'folder', label: 'This folder' }, { value: 'all', label: 'Every folder' }] },
      { key: 'groupBasis', label: 'Grouping', help: 'how unassigned sessions find a topic', options: [{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }] },
      { key: 'fieldBackground', label: 'Field background', help: 'the pane’s own surface, or the solid night ground', options: [{ value: 'transparent', label: 'Transparent' }, { value: 'night', label: 'Night' }] },
      { key: 'numbering', label: 'Numbering in focus', help: 'order of the chain', options: [{ value: 'oldestFirst', label: 'Oldest first' }, { value: 'newestFirst', label: 'Newest first' }] },
      { key: 'showRelated', label: 'Related anchors', help: 'linked topics at the bottom', options: [{ value: true, label: 'Show' }, { value: false, label: 'Hide' }] },
    ],
  },
  {
    title: 'Session',
    rows: [
      { key: 'handoffNotes', label: 'Handoff notes', help: 'how a session gets its note', options: [{ value: 'manual', label: 'Manual /park' }, { value: 'auto', label: 'Auto (haiku)' }, { value: 'ask', label: 'Ask after a turn' }] },
      { key: 'autoJoin', label: 'Auto join', help: 'after the first prompt', options: [{ value: 'suggest', label: 'Suggest' }, { value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }] },
      { key: 'openOnStart', label: 'On session start', help: 'what shows when a session begins', options: [{ value: 'band', label: 'Band' }, { value: 'pane', label: 'Pane' }, { value: 'none', label: 'Nothing' }] },
      { key: 'useModelForTitles', label: 'Topic names', help: 'name auto topics with haiku', options: [{ value: false, label: 'Frequent words' }, { value: true, label: 'Model' }] },
    ],
  },
  {
    title: 'Advanced',
    isAdvanced: true,
    rows: [
      { key: 'majorRule', label: 'Major topic rule', help: 'what gets a labelled pill', options: [{ value: 'either', label: 'Either' }, { value: 'count', label: 'Count' }, { value: 'recent', label: 'Recent' }] },
      { key: 'majorMinSessions', label: 'Count threshold', help: 'sessions to count as major', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 5, label: '5' }] },
      { key: 'recentDays', label: 'Recent days', help: 'activity that keeps a topic major', options: [{ value: 3, label: '3d' }, { value: 7, label: '7d' }, { value: 14, label: '14d' }, { value: 30, label: '30d' }] },
      { key: 'pictureMode', label: 'Picture', help: 'live: hover traces and the map moves; clicks: a pointer layer over a still picture', options: [{ value: 'live', label: 'Live' }, { value: 'clicks', label: 'Clicks' }] },
      { key: 'pictureClicks', label: 'Clicks on the picture', help: 'with Picture on Clicks, the pointer layer over it; outline draws its edge', options: [{ value: 'on', label: 'On' }, { value: 'outline', label: 'Outline' }, { value: 'off', label: 'Off' }] },
      { key: 'layerHeight', label: 'Layer height', help: 'with Outline on, its edge should end at the picture’s bottom', options: [-3, -2, -1, 0, 1, 2, 3].map(v => ({ value: v, label: v === 0 ? '0' : v > 0 ? `+${v}` : `−${-v}` })) },
    ],
  },
]

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export function usageLine(usage: UsageState, settings: MapSettings): string {
  const path = settings.handoffNotes !== 'auto' && !settings.useModelForTitles ? 'zero-token settings' : settings.handoffNotes === 'auto' ? 'one haiku call per turn for notes' : 'haiku only for topic names'
  return `Model use this session: ${usage.calls} haiku call${usage.calls === 1 ? '' : 's'} · ${tokens(usage.inputTokens)} in · ${tokens(usage.outputTokens)} out · ${path}`
}

export function drawSettings(T: Table, view: View, act: Actions): RenderElement {
  const { Box, Text, Button } = T
  const framed = view.surface !== 'terminal'
  const rows: (RenderElement | null | false)[] = [
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
        <Text weight="medium">Settings</Text>
        <Text dimColor size="footnote">
          changes apply to the map above and are saved
        </Text>
      </Box>
      {outline(T, view, 'ob:settings:done', [<Button key="settings:done" label="Done" plain={framed || undefined} onPress={() => act.toggleSettings()} />])}
    </Box>,
  ]
  for (const group of SETTING_GROUPS) {
    const isFolded = group.isAdvanced === true && !view.ui.showAdvanced
    rows.push(
      <Box key={`group:${group.title}`} flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
        <Text dimColor size="footnote">
          {group.title}
        </Text>
        {group.isAdvanced ? <Button key="set:advanced" label={isFolded ? `Show ${marks(view).shut}` : `Hide ${marks(view).open}`} plain dimColor onPress={() => act.toggleAdvanced()} /> : null}
        {isFolded ? (
          <Text dimColor size="footnote">
            what earns a labelled pill, and the picture
          </Text>
        ) : null}
      </Box>,
    )
    if (isFolded) continue
    for (const row of group.rows) {
      rows.push(
        <Box key={`set:${row.key}`} flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
          <Text>
            {row.label} <Text dimColor>{row.help}</Text>
          </Text>
          {row.options.map(o => {
            // The chosen value is a chip in the accent (the current selection), the others outlines; the terminal
            // draws no chips, so there the chosen one stays reversed.
            const isOn = view.settings[row.key] === o.value
            const id = `${row.key}:${String(o.value)}`
            const button = <Button key={`set:${id}`} label={o.label} plain={framed || undefined} variant={!framed && isOn ? 'primary' : undefined} dimColor={!isOn} onPress={() => act.setSetting(row.key, o.value)} />
            return isOn ? chip(T, view, `so:${id}`, ACCENT, 'accent', [button]) : outline(T, view, `oo:${id}`, [button])
          })}
        </Box>,
      )
    }
  }
  rows.push(
    <Text dimColor size="footnote">
      {usageLine(view.usage, view.settings)}
    </Text>,
  )
  return card(T, rows, HAIRLINE, { key: 'cd:settings' })
}

/**
 * A chip's fill, hairline, and both on hover: row (a list line, bare until hovered; its clear hairline keeps its
 * height when it is chosen), quiet (a minor or unpicked thing), normal, strong (chosen), accent (the current view).
 */
const TINT = { row: [0, 0, 0.12, 0.35], quiet: [0.05, 0.2, 0.12, 0.5], normal: [0.1, 0.35, 0.18, 0.7], strong: [0.18, 1, 0.26, 1], accent: [0.16, 0.55, 0.22, 0.8] } as const

/**
 * A Box tinted in `color` around a plain Button and its parts: the Desktop flattens a Button's children into
 * one label in the button's own colours, so a dot, a dim count or an accent word sits beside the Button.
 * A border costs the terminal two rows: there the chips go borderless.
 */
function chip(T: Table, view: View, key: string, color: string, level: keyof typeof TINT, children: (RenderElement | null | false)[]): RenderElement {
  const { Box } = T
  const [fill, line, hoverFill, hoverLine] = TINT[level]
  return (
    <Box
      key={key}
      flexDirection="row"
      alignItems="center"
      gap="sm"
      paddingX={1}
      borderStyle={view.surface !== 'terminal' ? 'round' : undefined}
      borderColor={rgba(color, line)}
      backgroundColor={rgba(color, fill)}
      hover={{ backgroundColor: rgba(color, hoverFill), borderColor: rgba(color, hoverLine) }}
    >
      {children.filter(c => c !== null && c !== false)}
    </Box>
  )
}

/** A secondary action: a neutral outline that lifts on hover. */
function outline(T: Table, view: View, key: string, children: (RenderElement | null | false)[]): RenderElement {
  const { Box } = T
  return (
    <Box key={key} flexDirection="row" alignItems="center" gap="sm" paddingX={1} borderStyle={view.surface !== 'terminal' ? 'round' : undefined} borderColor={rgba(MUTED, 0.45)} hover={{ borderColor: rgba(MUTED, 0.85), backgroundColor: rgba(MUTED, 0.1) }}>
      {children.filter(c => c !== null && c !== false)}
    </Box>
  )
}

/**
 * A card's one main action, its secondary ones and the rest: a chip tinted in the card's colour, outlines, plain
 * text. The terminal draws no chips, so there the main action stays reversed, as the current view does.
 */
function ranked(T: Table, view: View, color: string, key: string, rank: 'main' | 'second' | 'rest', button: RenderElement): RenderElement {
  if (rank === 'rest') return button
  return rank === 'main' ? chip(T, view, `pb:${key}`, color, 'normal', [button]) : outline(T, view, `ob:${key}`, [button])
}

/** A card about one topic or session: a hairline and the faintest fill in its colour. */
function tinted(color: string): { borderColor: string; fill: string } {
  return { borderColor: rgba(color, 0.35), fill: rgba(color, 0.04) }
}

function card(T: Table, children: (RenderElement | null | false)[], borderColor = CARD_BORDER, opts: { key?: string; fill?: string } = {}): RenderElement {
  const { Box } = T
  return (
    <Box key={opts.key} flexDirection="column" gap="xs" borderStyle="round" borderColor={borderColor} backgroundColor={opts.fill} paddingX={1}>
      {children.filter(c => c !== null && c !== false)}
    </Box>
  )
}

/** The chooser: this session has no topic yet. */
export function drawChooser(T: Table, view: View, act: Actions, where: 'pane' | 'band'): RenderElement {
  const { Box, Text, Button } = T
  const { model, me } = view
  const topics = model.topics.filter(t => t.id !== UNSORTED_ID)
  const ranked = [...topics].sort((a, b) => {
    if (me.suggested === a.id) return -1
    if (me.suggested === b.id) return 1
    return b.lastAt - a.lastAt
  })
  const folder = me.folder || 'this folder'
  const rows: (RenderElement | null | false)[] = [
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
      <Text weight="medium">Continue a topic</Text>
      <Text dimColor mono size="footnote">{where === 'pane' ? `${folder} · ${statsOf(model)}` : `${folder} · ${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}`}</Text>
    </Box>,
  ]
  // The band keeps to the nine digits; the pane's chooser lists every topic.
  const shown = where === 'band' ? ranked.slice(0, MAX_BAND_CHIPS) : ranked
  const more = ranked.length - shown.length
  // The Desktop flattens a Button's children into one label in the button's own colours, so each chip is a
  // Box tinted in its topic's colour holding the dot, the name as a plain Button and the dim meta beside it.
  // A border costs the terminal two rows a chip: there the chips go borderless.
  const framed = view.surface !== 'terminal'
  rows.push(
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      {shown.map((t, i) => {
        const latest = latestOf(t.sessions)
        const isSuggested = me.suggested === t.id
        return (
          <Box
            key={`jc:${t.id}`}
            flexDirection="row"
            alignItems="center"
            gap="sm"
            paddingX={1}
            borderStyle={framed ? 'round' : undefined}
            borderColor={rgba(t.color, isSuggested ? 1 : 0.35)}
            backgroundColor={rgba(t.color, isSuggested ? 0.18 : 0.1)}
            hover={{ backgroundColor: rgba(t.color, isSuggested ? 0.26 : 0.18), borderColor: rgba(t.color, isSuggested ? 1 : 0.7) }}
          >
            <Text color={t.color}>●</Text>
            <Button key={`j:${t.id}`} plain label={clip(t.name, 26)} hotkey={hk(view, i < 9 ? String(i + 1) : undefined)} onPress={() => act.join(t.id)} />
            <Text dimColor mono size="footnote">{`${t.sessions.length}${latest ? ` · ${ageOf(latest.lastAt, view.now)}` : ''}`}</Text>
            {isSuggested ? <Text color={t.color} size="footnote">suggested</Text> : null}
          </Box>
        )
      })}
      {more > 0 ? <Button key="j:more" plain dimColor onPress={() => act.openMap()}>{`+${more} more in the map`}</Button> : null}
    </Box>,
  )
  rows.push(
    <Box key="j-actions" flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
      <Box key="j-new" paddingX={1} borderStyle={framed ? 'round' : undefined} borderColor={rgba(MUTED, 0.45)} hover={{ borderColor: rgba(MUTED, 0.85), backgroundColor: rgba(MUTED, 0.1) }}>
        <Button key="j:new" plain label="+ New topic" hotkey={hk(view, 'n')} onPress={() => act.newTopic()} />
      </Box>
      {where === 'band' ? <Button key="j:map" plain dimColor label="Open map" hotkey={hk(view, 'o')} onPress={() => act.openMap()} /> : null}
      {where === 'band' ? <Button key="j:dismiss" plain dimColor label="Dismiss" role="dismiss" onPress={() => act.dismissBand()} /> : null}
    </Box>,
  )
  rows.push(
    <Text dimColor size="footnote">
      {where === 'pane'
        ? 'Joining makes this session the topic’s next step and adds its goal and last handoff note to your next prompt. Nothing is chosen for you unless auto-join is on.'
        : 'Joining adds the topic’s goal and last handoff note to your next prompt.'}
    </Text>,
  )
  return card(T, rows, HAIRLINE)
}

export function drawJoinedCard(T: Table, view: View, act: Actions): RenderElement {
  const { Box, Text, Button, Input } = T
  const { model, me } = view
  const topic = me.topicId ? model.topicById[me.topicId] : undefined
  const latest = topic ? latestOf(topic.sessions) : undefined
  const step = topic ? stepNumber(view, topic, 'you') : 1
  const title = topic ? `This session is step ${step} of ${topic.name}` : me.isNewTopic ? 'This session starts a new topic' : 'This session has no topic'
  const summary = latest
    ? `Handoff note from “${clip(latest.title, 48)}” (${ageOf(latest.lastAt, view.now)} ago)${me.pendingNote ? ' goes into your next prompt' : ' is in your context'}: ${clip(noteText(latest) || '(no note yet)', 220)}`
    : topic
      ? 'No earlier session here yet. Your handoff note will be the first.'
      : 'Name it below or with /topic <name>. It appears on the map with its first handoff note.'
  const naming = !topic && me.isNewTopic
  const framed = view.surface !== 'terminal'
  const color = topic?.color ?? ACCENT
  const { borderColor, fill } = topic ? tinted(color) : { borderColor: CARD_BORDER, fill: undefined }
  return card(T, [
    <Box flexDirection="row" gap="sm" alignItems="center">
      <Text color={ACCENT} mono weight="semibold">{`[${step}]`}</Text>
      <Text weight="medium">{title}</Text>
    </Box>,
    topic?.goal ? <Text dimColor>{`Goal: ${clip(topic.goal, 200)}`}</Text> : null,
    <Text dimColor>{summary}</Text>,
    view.myNote ? <Text dimColor>{`Your handoff note (${view.myNote.source === 'auto' ? 'written after your last turn' : 'parked'}): ${clip(view.myNote.text, 220)}`}</Text> : null,
    naming && Input ? (
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Input key="topicname" placeholder="Name this topic" submitLabel="create" onSubmit={name => act.createTopic(name)} autoFocus />
        {outline(T, view, 'ob:topicname:cancel', [<Button key="topicname:cancel" label="Cancel" plain={framed || undefined} onPress={() => act.cancelNewTopic()} />])}
      </Box>
    ) : null,
    me.askNote && Input ? (
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Input key="park" placeholder="What is done, what is left, what to watch" submitLabel="park" onSubmit={text => act.park(text)} autoFocus />
        {outline(T, view, 'ob:park:skip', [<Button key="park:skip" label="Skip" plain={framed || undefined} onPress={() => act.skipNote()} />])}
      </Box>
    ) : null,
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      {topic
        ? ranked(T, view, color, 'c:focus', 'main', <Button key="c:focus" label="Focus my topic" hotkey={hk(view, 'f')} plain={framed || undefined} variant={framed ? undefined : 'primary'} onPress={() => act.focusTopic(topic.id)} />)
        : null}
      {latest ? ranked(T, view, color, 'c:draft', 'second', <Button key="c:draft" label="Draft next prompt" hotkey={hk(view, 'd')} plain={framed || undefined} onPress={() => act.draft(null)} />) : null}
      {ranked(T, view, color, 'c:change', 'second', <Button key="c:change" label="Change topic" hotkey={hk(view, 'c')} plain={framed || undefined} onPress={() => act.changeTopic()} />)}
      {!me.askNote ? ranked(T, view, color, 'c:park', 'rest', <Button key="c:park" label="Park a note" hotkey={hk(view, 'p')} plain={framed || undefined} dimColor={framed || undefined} onPress={() => act.parkPrompt()} />) : null}
    </Box>,
  ], borderColor, { key: 'cd:joined', fill })
}

export function drawTopicCard(T: Table, view: View, act: Actions, topic: Topic): RenderElement {
  const { Box, Text, Button, Input, Select } = T
  const { model, ui, now } = view
  const isFocused = ui.focusTopic === topic.id
  const isUnsorted = topic.id === UNSORTED_ID
  const idle = topic.sessions.filter(s => s.status === 'idle')
  const shipped = topic.sessions.filter(s => s.status === 'archived').length
  const latest = latestOf(topic.sessions)
  const tidyTargets = idle.filter(s => !latest || s.id !== latest.id)
  const rel = relatedOf(model.links, topic.id)
  const framed = view.surface !== 'terminal'
  const { borderColor, fill } = tinted(topic.color)
  return card(T, [
    <Box key="ch:topic" flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
      <Text color={topic.color}>●</Text>
      <Text weight="medium">{topic.name}</Text>
      <Text dimColor mono size="footnote">{`${isUnsorted ? 'unsorted' : topic.isMajor ? 'major' : 'minor'} · ${topic.sessions.length} sessions · ${idle.length} idle · ${shipped} shipped`}</Text>
      {runningOf(view, topic) > 0 ? (
        <Text color={ACCENT} size="footnote">
          live
        </Text>
      ) : null}
    </Box>,
    !isUnsorted ? <Text dimColor>{topic.goal ? `Goal: ${clip(topic.goal, 200)}` : 'No goal yet. A goal travels with every handoff on this topic.'}</Text> : null,
    latest ? (
      <Text>{`Latest: ${clip(latest.title, 60)} (${ageOf(latest.lastAt, now)} ago). ${clip(noteText(latest), 220)}`}</Text>
    ) : (
      <Text dimColor>{isUnsorted ? 'Sessions nothing else claimed. Select one and Move to topic to file it.' : 'No sessions yet. Each session that joins this topic becomes the next step of its chain.'}</Text>
    ),
    ui.editing === 'rename' && Input && !isUnsorted ? (
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Input key="rename" value={topic.name} placeholder="Topic name" submitLabel="rename" onSubmit={name => act.rename(topic.id, name)} autoFocus />
        {outline(T, view, 'ob:rename:cancel', [<Button key="rename:cancel" label="Cancel" plain={framed || undefined} onPress={() => act.edit(null)} />])}
      </Box>
    ) : null,
    ui.editing === 'goal' && Input && !isUnsorted ? (
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Input key="goal" value={topic.goal ?? ''} placeholder="What this topic is for, in a sentence" submitLabel="save" onSubmit={goal => act.setGoal(topic.id, goal)} autoFocus />
        {outline(T, view, 'ob:goal:cancel', [<Button key="goal:cancel" label="Cancel" plain={framed || undefined} onPress={() => act.edit(null)} />])}
      </Box>
    ) : null,
    rel.length === 0 ? (
      <Text dimColor size="footnote">
        No related topics yet; a topic whose sessions touch the same files links here.
      </Text>
    ) : null,
    rel.length === 0 ? null : <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      <Text dimColor size="footnote">
        related
      </Text>
      {rel.map(r => {
        const rt = model.topicById[r.id]
        return rt
          ? chip(T, view, `kb:${rt.id}`, rt.color, 'quiet', [
              <Text color={rt.color}>●</Text>,
              <Button key={`rel:${rt.id}`} label={clip(rt.name, 22)} plain onPress={() => act.focusTopic(rt.id)} />,
              <Text dimColor mono size="footnote">
                {r.via}
              </Text>,
            ])
          : null
      })}
    </Box>,
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      {ranked(
        T,
        view,
        topic.color,
        'tc:focus',
        'main',
        <Button key="tc:focus" label={isFocused ? 'Back to all topics' : 'Focus this topic'} hotkey={hk(view, 'f')} plain={framed || undefined} variant={framed ? undefined : 'primary'} onPress={() => (isFocused ? act.allTopics() : act.focusTopic(topic.id))} />,
      )}
      {latest ? ranked(T, view, topic.color, 'tc:pickup', 'second', <Button key="tc:pickup" label="Pick up latest" hotkey={hk(view, 'u')} plain={framed || undefined} onPress={() => act.pickUpLatest(topic.id)} />) : null}
      {view.me.topicId !== topic.id && !isUnsorted
        ? ranked(T, view, topic.color, 'tc:join', 'second', <Button key="tc:join" label="Join this topic" hotkey={hk(view, 'j')} plain={framed || undefined} onPress={() => act.join(topic.id)} />)
        : null}
      {tidyTargets.length
        ? ranked(T, view, topic.color, 'tc:tidy', 'second', <Button key="tc:tidy" label={`Archive ${tidyTargets.length} idle`} plain={framed || undefined} onPress={() => act.tidy(topic.id)} />)
        : null}
    </Box>,
    !isUnsorted ? (
      <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
        {Input ? <Button key="tc:rename" label="Rename" hotkey={hk(view, 'r')} plain={framed || undefined} dimColor={framed || undefined} onPress={() => act.edit(ui.editing === 'rename' ? null : 'rename')} /> : null}
        {Input ? <Button key="tc:goal" label={topic.goal ? 'Edit goal' : 'Set goal'} hotkey={hk(view, 'g')} plain={framed || undefined} dimColor={framed || undefined} onPress={() => act.edit(ui.editing === 'goal' ? null : 'goal')} /> : null}
        <Button key="tc:merge" label="Merge into…" hotkey={hk(view, 'e')} plain={framed || undefined} dimColor={framed || undefined} onPress={() => act.mergeMode(topic.id)} />
        {Select ? <Select key={`color:${topic.id}`} label="Colour" options={COLOR_OPTIONS} value={PALETTE.includes(topic.color as (typeof PALETTE)[number]) ? topic.color : undefined} onSelect={hex => act.setColor(topic.id, hex)} /> : null}
      </Box>
    ) : null,
  ], borderColor, { key: 'cd:topic', fill })
}

export function drawSessionCard(T: Table, view: View, act: Actions, s: SessionView): RenderElement {
  const { Box, Text, Button, Input } = T
  const { model, ui, now } = view
  const topic = model.topicById[s.topicId]
  const color = topic?.color ?? ACCENT
  const n = topic ? stepNumber(view, topic, s.id) : 0
  const framed = view.surface !== 'terminal'
  const { borderColor, fill } = tinted(color)
  const rows: (RenderElement | null | false)[] = [
    <Box key="ch:session" flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
      <Text color={color} mono weight="semibold">
        {n > 0 ? String(n) : '·'}
      </Text>
      <Text weight="medium">{s.title}</Text>
      {s.status === 'active' ? (
        <Text color={ACCENT} size="footnote">
          live
        </Text>
      ) : (
        <Text dimColor mono size="footnote">
          {s.status}
        </Text>
      )}
      {s.large ? (
        <Text dimColor mono size="footnote">
          large transcript
        </Text>
      ) : null}
    </Box>,
    <Text dimColor mono size="footnote">
      {sessionMeta(s, now, `ran ${durationOf(s.lastAt - s.startedAt)}${topic ? ` · in ${topic.name}` : ''}`)}
    </Text>,
    <Text dimColor size="footnote">
      Handoff note
    </Text>,
    <Text>{noteText(s) || 'No note yet. The last assistant text stands in once the session has one.'}</Text>,
  ]
  if (s.filesTouched.length) {
    rows.push(
      <Text dimColor mono size="footnote" wrap="truncate">
        {s.filesTouched.slice(0, 8).join('  ')}
        {s.filesTouched.length > 8 ? `  +${s.filesTouched.length - 8}` : ''}
      </Text>,
    )
  }
  if (ui.messageMode && Input) {
    rows.push(
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Input key="msg" placeholder={`Message “${clip(s.title, 30)}”`} submitLabel="send" onSubmit={text => act.message(s.id, text)} autoFocus />
        {outline(T, view, 'ob:msg:cancel', [<Button key="msg:cancel" label="Cancel" plain={framed || undefined} onPress={() => act.messageMode(false)} />])}
      </Box>,
    )
  }
  rows.push(
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      {ranked(T, view, color, 'sc:pickup', 'main', <Button key="sc:pickup" label="Pick up here" hotkey={hk(view, 'u')} plain={framed || undefined} variant={framed ? undefined : 'primary'} onPress={() => act.pickUp(s.id)} />)}
      {ranked(T, view, color, 'sc:draft', 'second', <Button key="sc:draft" label="Draft prompt" hotkey={hk(view, 'd')} plain={framed || undefined} onPress={() => act.draft(s.id)} />)}
      {ranked(T, view, color, 'sc:new', 'second', <Button key="sc:new" label="New session from here" hotkey={hk(view, 'n')} plain={framed || undefined} onPress={() => act.newSession(s.id)} />)}
    </Box>,
    <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
      <Button key="sc:pin" label={s.isPinned ? 'Unpin' : 'Pin'} hotkey={hk(view, 'p')} plain={framed || undefined} dimColor={framed || undefined} onPress={() => act.pin(s.id)} />
      <Button key="sc:move" label={ui.moveMode ? 'Cancel move' : 'Move to topic'} hotkey={hk(view, 'v')} plain={framed || undefined} dimColor={framed || undefined} onPress={() => act.moveMode(!ui.moveMode)} />
      <Button key="sc:archive" label={s.status === 'archived' ? 'Unarchive' : 'Archive'} hotkey={hk(view, 'x')} plain={framed || undefined} dimColor={framed || undefined} onPress={() => act.archive(s.id)} />
      {Input ? <Button key="sc:message" label="Message" hotkey={hk(view, 't')} plain={framed || undefined} dimColor={s.status !== 'active'} onPress={() => act.messageMode(!ui.messageMode)} /> : null}
    </Box>,
    <Text dimColor mono size="footnote" wrap="truncate">
      {`resume it in a terminal: claude --resume ${s.id}`}
    </Text>,
  )
  return card(T, rows, borderColor, { key: 'cd:session', fill })
}

export function drawToast(T: Table, view: View, act: Actions): RenderElement | null {
  const { Box, Text, Button } = T
  const toast = view.ui.toast
  if (!toast) return null
  // A word on what just happened: a translucent hairline card in no topic's colour, so it never reads as one;
  // a refused or failed action wears the problem coral and its own mark.
  const isProblem = toast.isProblem === true
  const framed = view.surface !== 'terminal'
  return (
    <Box
      key="cd:toast"
      flexDirection="row"
      gap="sm"
      alignItems="center"
      flexWrap="wrap"
      borderStyle="round"
      borderColor={isProblem ? rgba(PROBLEM, 0.55) : HAIRLINE}
      backgroundColor={isProblem ? rgba(PROBLEM, 0.08) : rgba(MUTED, 0.06)}
      paddingX={1}
    >
      <Text color={isProblem ? PROBLEM : MUTED}>{isProblem ? '!' : marks(view).done}</Text>
      <Text>{toast.text}</Text>
      {toast.hasUndo ? outline(T, view, 'ob:toast:undo', [<Button key="toast:undo" label="Undo" hotkey={hk(view, 'z')} plain={framed || undefined} onPress={() => act.undo()} />]) : null}
      <Button key="toast:dismiss" label="Dismiss" plain dimColor onPress={() => act.dismissToast()} />
    </Box>
  )
}

/** The card under the field, by state: settings, a session, a topic, the chooser or the joined card. */
export function drawCard(T: Table, view: View, act: Actions): RenderElement {
  const { model, ui, me } = view
  if (ui.showHelp) return drawHelp(T, act)
  if (ui.showSettings) return drawSettings(T, view, act)
  const sel = ui.selected ? model.byId[ui.selected] : undefined
  if (sel) return drawSessionCard(T, view, act, sel)
  const topic = ui.focusTopic ? model.topicById[ui.focusTopic] : ui.hover ? model.topicById[ui.hover] : undefined
  if (topic) return drawTopicCard(T, view, act, topic)
  if (me.topicId === null && !me.isNewTopic) return drawChooser(T, view, act, 'pane')
  return drawJoinedCard(T, view, act)
}

/**
 * The pane: header, the field, its controls, the card and the toast. The field
 * is the Svg where the surface has one, or what the entry point hands in: the
 * terminal's text-mode map, or the Desktop's Svg with the hit layer over it.
 */
export function drawPane(T: Table, view: View, act: Actions, field?: RenderElement): RenderElement {
  const { Box, Text, Svg } = T
  const { ui } = view
  const isMap = ui.view === 'map' && (field !== undefined || Svg !== undefined)
  const toast = drawToast(T, view, act)
  return (
    <Box flexDirection="column" gap="xs">
      {drawHeader(T, view, act)}
      {drawRecent(T, view, act)}
      {isMap ? (field ?? (Svg ? <Svg source={svgOf(view)} alt={altOf(view)} /> : null)) : null}
      {isMap ? drawControls(T, view, act) : drawList(T, view, act)}
      {!isMap && ui.view === 'map' ? (
        <Text dimColor size="footnote">
          This surface draws no vector field: the outline above is the map. Hotkeys 1–9 select a step.
        </Text>
      ) : null}
      {drawCard(T, view, act)}
      {toast}
    </Box>
  )
}

/**
 * `/map here`: the field, its controls and the card as a row in the main
 * conversation. The row is as wide as the transcript, scrolls with the chat,
 * and redraws while it is on screen; the pane stays the live sidebar.
 */
export function drawInlineRow(T: Table, raw: View, act: Actions): RenderElement {
  const { Box, Text, Svg } = T
  const view: View = { ...raw, isRow: true }
  const { model, me } = view
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
        <Text weight="medium">Constellation</Text>
        <Text dimColor size="footnote">{`${me.folder || 'folder'} · ${statsOf(model)} · /map opens the live pane`}</Text>
      </Box>
      {drawRecent(T, view, act)}
      {Svg ? <Svg source={svgOf(view)} alt={altOf(view)} /> : null}
      {Svg ? drawControls(T, view, act) : drawList(T, view, act)}
      {drawCard(T, view, act)}
    </Box>
  )
}

/** The band above the prompt: the chooser until this session has a topic, or the note question. */
export function drawBand(T: Table, view: View, act: Actions): RenderElement | null {
  const { Box, Text, Button, Input } = T
  const { me } = view
  const framed = view.surface !== 'terminal'
  if (me.askNote) {
    // The note goes with this session's topic, so the card wears that topic's colour, as the joined card does.
    const topic = me.topicId ? view.model.topicById[me.topicId] : undefined
    const { borderColor, fill } = topic ? tinted(topic.color) : { borderColor: HAIRLINE, fill: undefined }
    return card(T, [
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm">
        <Text weight="medium">Park a handoff note</Text>
        {topic ? <Text dimColor mono size="footnote">{clip(topic.name, 40)}</Text> : null}
      </Box>,
      <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
        {Input ? <Input key="park" placeholder="What is done, what is left, what to watch" submitLabel="park" onSubmit={text => act.park(text)} /> : null}
        {outline(T, view, 'ob:park:skip', [<Button key="park:skip" label="Skip" role="dismiss" plain={framed || undefined} onPress={() => act.skipNote()} />])}
      </Box>,
      <Text dimColor size="footnote">The next session on this topic gets it with its first prompt.</Text>,
    ], borderColor, { key: 'cd:park', fill })
  }
  if (me.topicId === null && me.isNewTopic) {
    return card(T, [
      <Text weight="medium">Name a new topic</Text>,
      <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
        {Input ? <Input key="topicname" placeholder="Name this topic" submitLabel="create" onSubmit={name => act.createTopic(name)} autoFocus /> : <Text dimColor>/topic &lt;name&gt; names it</Text>}
        {outline(T, view, 'ob:topicname:cancel', [<Button key="topicname:cancel" label="Cancel" role="dismiss" plain={framed || undefined} onPress={() => act.cancelNewTopic()} />])}
      </Box>,
      <Text dimColor size="footnote">This session becomes its first step; later sessions can join it.</Text>,
    ], HAIRLINE, { key: 'cd:name' })
  }
  if (me.topicId !== null || me.isBandHidden) return null
  return drawChooser(T, view, act, 'band')
}

/** One mark on the terminal's text-mode map (client/map.js). */
export type FieldNode = {
  id: string
  kind: 'topic' | 'session' | 'step' | 'you' | 'back'
  x: number
  y: number
  /** A pill's width, or a label's, in field units: what the pointer layer takes as the node's extent. */
  w?: number
  label: string
  label2?: string
  title?: string
  count?: number
  color: string
  isMajor?: boolean
  isDim?: boolean
  isSelected?: boolean
  isArchived?: boolean
  isActive?: boolean
  topicId?: string
  /** A related-topic anchor in focus mode: a pill centred on its point, unlike a minor topic's dot with a label to the right. */
  isAnchor?: boolean
}

export type FieldProps = {
  mode: 'map' | 'focus'
  hint: string
  nodes: FieldNode[]
  links: { x1: number; y1: number; x2: number; y2: number }[]
  legend: string
  /** The field the positions are in, so the Client scales them to its region. */
  fieldW: number
  fieldH: number
}

/** A node with its undefined keys dropped: a Client's props hold no undefined. */
function node(n: FieldNode): FieldNode {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(n)) if (v !== undefined) out[k] = v
  return out as FieldNode
}

/** A Client's props hold at most 100,000 characters; the field stays well under it. */
export const FIELD_CHARS = 90000

/** The field as plain data for the Client module: the same positions the Svg uses, bounded in size. */
export function fieldOf(view: View): FieldProps {
  const { model, ui, placed } = view
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  const size = sizeOf(view)
  const nodes: FieldNode[] = []
  const links: FieldProps['links'] = []
  const legend = '● active  ○ idle  ◦ shipped  ♦ you'
  // Over the picture, the layer holds what the picture kept once it shed to fit its cap; the terminal draws its own text map.
  const kept = view.surface === 'terminal' ? satellitesPerTopic(model.topics.length) : drawingOf(view).kept
  if (kept === null) return { mode: focus ? 'focus' : 'map', hint: hintFitted(view, size), nodes: [], links: [], legend, fieldW: size.w, fieldH: size.h }
  const perTopic = kept
  if (!focus) {
    // The focus ring may rest on a chip that is no topic (+ New topic): that traces nothing.
    const traced = ui.hover && model.topicById[ui.hover] ? ui.hover : null
    for (const t of model.topics) {
      const p = placed[t.id]
      if (!p) continue
      const isDim = (traced !== null && traced !== t.id) || !topicMatches(ui.query, t)
      const countLabel = ui.query.trim() ? `${t.sessions.filter(s => matches(ui.query, s)).length} match` : `${t.sessions.length}${view.me.topicId === t.id ? ' · you' : ''}`
      const w = t.isMajor ? pillWidth(t.name, countLabel) : 16 + (clipName(t.name, 24).length + countLabel.length + 1) * 6.9
      nodes.push(node({ id: t.id, kind: 'topic', x: p.x, y: p.y, w: Math.round(w), label: `${clipName(t.name, 24)} ${countLabel}`, color: t.color, isMajor: t.isMajor, isDim, isSelected: false, title: t.name }))
      t.sessions.slice(0, perTopic).forEach((s, k) => {
        const sp = satellitePosition(p, k, size)
        nodes.push(node({ id: s.id, kind: 'session', x: Math.round(sp.x), y: Math.round(sp.y), label: '', title: clip(s.title, 24), color: t.color, isDim: isDim || !s.isInRange || !matches(ui.query, s), isSelected: ui.selected === s.id, isArchived: s.status === 'archived', isActive: s.status === 'active', topicId: t.id }))
      })
    }
    for (const l of model.links) {
      const a = placed[l.a]
      const b = placed[l.b]
      if (a && b) links.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    }
  } else {
    const steps = chainOf(view, focus)
    const positions = chainPositions(steps.length, size)
    // The pill as the picture draws it, "· you" and all, so its whole width takes a click.
    const pill = focusPillOf(view, focus)
    nodes.push(node({ id: focus.id, kind: 'topic', x: size.w / 2, y: FOCUS_PILL.y, w: Math.round(pill.w), label: `${clipName(focus.name, 24)} ${pill.count}`, color: focus.color, isMajor: true, title: focus.name }))
    // The "‹ All topics" pill at the top left: a press on it goes back to every topic.
    nodes.push(node({ id: 'back', kind: 'back', x: 62, y: 27, w: 96, label: '‹ All topics', color: ACCENT }))
    steps.forEach((step, i) => {
      const pt = positions[i]
      if (!pt) return
      const s = step.session
      nodes.push(node({
        id: step.isYou ? 'you' : step.id,
        kind: step.isYou ? 'you' : 'step',
        x: pt.x,
        y: pt.y,
        label: String(i + 1),
        label2: step.isYou ? 'This session · you' : clip(s?.title ?? '', 18),
        title: step.isYou ? 'This session' : s?.title,
        color: step.isYou ? ACCENT : focus.color,
        isSelected: s !== undefined && ui.selected === s.id,
        isArchived: s?.status === 'archived',
        isActive: s?.status === 'active',
        isDim: s !== undefined && !matches(ui.query, s),
        topicId: focus.id,
      }))
    })
    for (const a of anchorsOf(view, focus, size)) {
      nodes.push(node({ id: a.topic.id, kind: 'topic', x: a.x, y: a.y, w: a.w, label: `${clipName(a.topic.name, 14)} · ${clip(a.via, 10)}`, color: a.topic.color, isMajor: false, isDim: true, isAnchor: true, title: a.topic.name }))
    }
  }
  const field: FieldProps = { mode: focus ? 'focus' : 'map', hint: view.surface === 'terminal' ? hintOf(view) : hintFitted(view, size), nodes, links, legend, fieldW: size.w, fieldH: size.h }
  if (JSON.stringify(field).length > FIELD_CHARS) field.nodes = nodes.filter(n => n.kind !== 'session')
  return field
}

export type { Point }
