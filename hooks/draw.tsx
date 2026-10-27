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
import { BASE, FOCUS_PILL, anchorSlots, chainLabelChars, chainPositions, chainRows, focusSize, pillWidth, satellitePosition, starPath, unitEdge } from './layout'
import type { FieldSize, PlacedTopic, Point } from './layout'
import { durationOf } from './state'
import type { MapSettings, MeState, NoteRecord, UiState, UsageState } from '../types'

export const BG = '#0B0E13'
export const PANEL = '#10141A'
export const BORDER = '#1C222B'
export const CARD_BORDER = '#20262F'
export const TEXT = '#E8ECF2'
export const MUTED = '#8B95A5'
export const DIM = '#6F7988'
export const LABEL = '#C9D1DC'
export const SANS = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"
export const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"
export const SVG_CAP = 131072

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
  if (view.surface === 'desktop' && view.settings.pictureClicks !== 'off') return 'Hover or focus a topic to trace it · Enter or click to focus'
  return 'Tab onto a topic to trace it · Enter or its button under the map focuses'
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

/** The field a drawing draws: the map's, or a focused topic's (as wide as the map's, the base height). */
export function sizeOf(view: View): FieldSize {
  return view.ui.focusTopic && view.model.topicById[view.ui.focusTopic] ? focusSize(view.field) : view.field
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
    const name = clip(r.topic.name, Math.min(20, Math.max(4, chars - (chars >= 14 ? 8 : 0))))
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

/** The whole field as an SVG document, under the 131072-character cap. */
export function svgOf(view: View, options: SvgOptions = {}): string {
  const withTooltips = options.withTooltips ?? true
  const { model, ui, placed, now } = view
  // The same budget the pointer layer takes, so what is drawn is what is clickable.
  const maxSessions = options.maxSessions ?? satellitesPerTopic(model.topics.length)
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  const size = sizeOf(view)
  const query = ui.query.trim()
  const parts: string[] = []
  const css: string[] = [
    themeCss(view.settings.fieldBackground),
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
  const indexOf = new Map<string, number>()
  model.topics.forEach((t, i) => indexOf.set(t.id, i))

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
  parts.push(`<g clip-path="url(#field)">`)
  // Transparent by default: the field sits on the pane's own surface; `night` paints the prototype's solid ground.
  if (view.settings.fieldBackground === 'night') parts.push(`<rect width="${size.w}" height="${size.h}" fill="${BG}"/>`)
  parts.push(`<rect width="${size.w}" height="${size.h}" fill="url(#glow)"/>`)
  parts.push(`<rect width="${size.w}" height="${size.h}" fill="url(#grid)"/>`)
  parts.push(`<path d="${starPath(Math.round((70 * size.w * size.h) / (BASE.w * BASE.h)), 137.5, 11, size)}" style="stroke:var(--star)" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.8"/>`)
  parts.push(`<path d="${starPath(Math.round((18 * size.w * size.h) / (BASE.w * BASE.h)), 211.7, 53, size)}" style="stroke:var(--star2)" stroke-width="2.4" stroke-linecap="round" fill="none" opacity="0.8"/>`)

  if (!focus) {
    const traced = ui.hover && model.topicById[ui.hover] ? ui.hover : null
    const related = new Set<string>(traced ? relatedOf(model.links, traced).map(r => r.id) : [])
    const dropSource = ui.mergeFrom ?? (ui.moveMode && ui.selected ? model.byId[ui.selected]?.topicId : undefined)
    for (const l of model.links) {
      const a = placed[l.a]
      const b = placed[l.b]
      if (!a || !b) continue
      const isBright = traced !== null && (l.a === traced || l.b === traced)
      const strokeAttr = isBright ? `stroke="${model.topicById[traced ?? '']?.color ?? ACCENT}"` : 'style="stroke:var(--x)"'
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
      css.push(`.t-${i}:hover .ln{stroke:${t.color}}`, `.t-${i}:hover .sat{r:10px}`)
      for (const r of relatedOf(model.links, t.id)) {
        const j = indexOf.get(r.id)
        if (j !== undefined) css.push(`svg:has(.t-${i}:hover) .t-${j}{opacity:.8}`, `svg:has(.t-${i}:hover) .x-${i}{stroke:${t.color};opacity:.8}`)
      }
      const g: string[] = [`<g class="t t-${i}" opacity="${opacity.toFixed(2)}">`]
      const sessions = t.sessions.slice(0, maxSessions)
      sessions.forEach((s, k) => {
        const sp = satellitePosition(p, k, size)
        if (s.isInRange) {
          // From the unit's edge, never across its own label.
          const from = unitEdge(p, sp)
          g.push(`<line class="ln" x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${sp.x.toFixed(1)}" y2="${sp.y.toFixed(1)}" ${isTraced ? `stroke="${t.color}"` : 'style="stroke:var(--ln)"'} stroke-width="${isTraced ? 1.2 : 1}" opacity="${isTraced ? 0.75 : traced ? 0.35 : 0.8}"/>`)
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
        const fillAttr = s.status === 'active' ? `fill="${t.color}"` : 'style="fill:var(--pill)"'
        const ringAttr = s.status === 'archived' ? 'style="stroke:var(--dim)"' : `stroke="${t.color}"`
        const dash = s.status === 'archived' ? ' stroke-dasharray="2 2"' : ''
        const glow = isSel || (query && isMatch) ? `<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r + 4}" fill="${rgba(t.color, 0.3)}"/>` : ''
        const halo = `<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r + 5}" fill="${rgba(t.color, 0.12)}"/>`
        const tip = withTooltips ? `<title>${esc(s.title)}\n${esc(sessionMeta(s, now))}${noteText(s) ? `\n${esc(clip(noteText(s), 160))}` : ''}</title>` : ''
        const pin = s.isPinned ? `<text x="${(sp.x + 5).toFixed(1)}" y="${(sp.y - 5).toFixed(1)}" font-size="9" fill="${ACCENT}">★</text>` : ''
        g.push(`<g class="s n hit" opacity="${op.toFixed(2)}">${tip}${halo}${glow}<circle class="sat" cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r}" ${fillAttr} ${ringAttr} stroke-width="1.5"${dash}/>${pin}</g>`)
      })
      if (t.isMajor) {
        const w = pillWidth(t.name, countLabel)
        const x = p.x - w / 2
        const y = p.y - 19
        const dashed = isDrop ? ' stroke-dasharray="4 3"' : ''
        g.push(
          `<rect class="glow" x="${(x - 5).toFixed(1)}" y="${y - 5}" width="${(w + 10).toFixed(1)}" height="48" rx="24" fill="${rgba(t.color, 0.22)}"${isTraced || isDrop ? ' opacity="1"' : ''}/>`,
          `<rect class="pill hit" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="38" rx="19" style="fill:var(${isTraced ? '--pill2' : '--pill'})" stroke="${t.color}" stroke-width="1.5"${dashed}/>`,
          `<circle cx="${(x + 17).toFixed(1)}" cy="${p.y}" r="4" fill="${t.color}"/>`,
          `<text x="${(x + 28).toFixed(1)}" y="${p.y + 4.5}" font-size="13" font-weight="600" style="fill:var(--tx)">${esc(clip(t.name, 28))}</text>`,
          `<text class="mono" x="${(x + w - 14).toFixed(1)}" y="${p.y + 4}" font-size="11" font-weight="500" fill="${t.color}" text-anchor="end">${esc(countLabel)}</text>`,
        )
      } else {
        // The label hangs right of the dot; the placement reserved that room.
        g.push(
          `<circle class="glow" cx="${p.x}" cy="${p.y}" r="11" fill="${rgba(t.color, 0.22)}"${isTraced || isDrop ? ' opacity="1"' : ''}/>`,
          `<circle class="hit" cx="${p.x}" cy="${p.y}" r="5.5" style="fill:var(--pill)" stroke="${t.color}" stroke-width="1.5"${isDrop ? ' stroke-dasharray="3 2"' : ''}/>`,
          `<text class="mono lbl" x="${p.x + 16}" y="${p.y + 4}" font-size="11.5" style="fill:var(${isTraced ? '--tx' : '--mu'})">${esc(clip(t.name, 24))} <tspan fill="${t.color}">${esc(countLabel)}</tspan></text>`,
        )
      }
      g.push('</g>')
      parts.push(g.join(''))
    }
    if (model.topics.length === 0) {
      parts.push(`<text x="${size.w / 2}" y="${size.h / 2 - 10}" font-size="15" font-weight="500" style="fill:var(--tx)" text-anchor="middle">No sessions on this map yet</text>`)
      parts.push(`<text x="${size.w / 2}" y="${size.h / 2 + 16}" font-size="12" style="fill:var(--mu)" text-anchor="middle">Sessions in this folder appear here once they have run; /topic names this one.</text>`)
    }
  } else {
    const steps = chainOf(view, focus)
    const positions = chainPositions(steps.length, size)
    const latest = latestOf(focus.sessions)
    const color = focus.color === MINOR_COLOR ? ACCENT : focus.color
    // Each step to the next: a segment from circle edge to circle edge, its arrow at the next circle's rim.
    for (let i = 1; i < positions.length && i < steps.length; i += 1) {
      const a = positions[i - 1]
      const b = positions[i]
      if (!a || !b) continue
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const ux = (b.x - a.x) / d
      const uy = (b.y - a.y) / d
      parts.push(`<line x1="${(a.x + ux * 19).toFixed(1)}" y1="${(a.y + uy * 19).toFixed(1)}" x2="${(b.x - ux * 21).toFixed(1)}" y2="${(b.y - uy * 21).toFixed(1)}" stroke="${color}" stroke-width="1.6" marker-end="url(#arrow)" opacity="0.9"/>`)
    }
    const chars = chainLabelChars(steps.length, size)
    const { upper } = chainRows(size)
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
      // A crowded chain labels only the steps that matter here; the tooltips carry the rest.
      const isLabelled = chars > 0 || isYou || isSel || isLatest || i === 0
      const room = chars > 0 ? chars : 14
      const meta = isYou
        ? 'now · you'
        : s
          ? isTight
            ? [...(isLatest ? ['latest'] : []), `${ageOf(s.lastAt, now)} ago`, turnsOf(s)].join(' · ')
            : sessionMeta(s, now, isLatest ? 'latest' : '')
          : ''
      const lines = isLabelled ? wrap2(title, Math.min(isTight ? room : 22, room)) : []
      const tip = withTooltips && s && !isYou ? `<title>${esc(s.title)}\n${esc(sessionMeta(s, now))}${noteText(s) ? `\n${esc(clip(noteText(s), 160))}` : ''}</title>` : ''
      const g: string[] = [`<g class="n hit" opacity="${op.toFixed(2)}">${tip}`]
      if (isLatest) g.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="21" fill="${rgba(color, 0.22)}"/>`)
      g.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="16" style="fill:${fill};stroke:${ring}" stroke-width="2"${dash}/>`)
      g.push(`<text class="mono" x="${pt.x.toFixed(1)}" y="${(pt.y + 4.5).toFixed(1)}" font-size="12.5" font-weight="600" style="fill:${numColor}" text-anchor="middle">${i + 1}</text>`)
      if (s?.isPinned) g.push(`<text x="${(pt.x + 12).toFixed(1)}" y="${(pt.y - 10).toFixed(1)}" font-size="10" fill="${ACCENT}">★</text>`)
      const labelColor = isYou ? ACCENT : isSel ? 'var(--tx)' : status === 'archived' ? 'var(--mu)' : 'var(--lb)'
      if (isLabelled) {
        // The upper row's label stands above its circle, the lower row's hangs below: neither meets the other row.
        const metaText = clip(meta, Math.max(room + 4, isTight ? 0 : 34))
        const isAbove = pt.y <= upper
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
      `<text x="${(x + 28).toFixed(1)}" y="${FOCUS_PILL.y + 4.5}" font-size="13" font-weight="600" style="fill:var(--tx)">${esc(clip(focus.name, 28))}</text>`,
      `<text class="mono" x="${(x + w - 14).toFixed(1)}" y="${FOCUS_PILL.y + 4}" font-size="11" font-weight="500" fill="${color}" text-anchor="end">${esc(countLabel)}</text>`,
    )
    if (focus.goal) {
      // Under the topic's pill, above the chain's upper labels.
      parts.push(`<text x="${pillX}" y="${FOCUS_PILL.y + 46}" font-size="11.5" style="fill:var(--lb)" text-anchor="middle"><tspan class="mono" style="fill:var(--mu)">GOAL</tspan>  ${esc(clip(focus.goal, Math.floor((size.w - 80) / 6.2)))}</text>`)
    }
    if (steps.length === 0) {
      parts.push(`<text x="${size.w / 2}" y="262" font-size="12.5" style="fill:var(--mu)" text-anchor="middle">${esc(clip('No sessions in the time range. Widen the range, or pin one.', Math.floor((size.w - 40) / 6.6)))}</text>`)
    }
    for (const a of anchorsOf(view, focus, size)) {
      const left = a.x - a.w / 2
      parts.push(
        `<g class="hit" opacity="0.9"><rect x="${left.toFixed(1)}" y="${a.y - 16}" width="${a.w.toFixed(1)}" height="32" rx="16" style="fill:var(--glass)" stroke="${a.topic.color}" stroke-width="1" stroke-dasharray="4 3"/>`,
        `<circle cx="${(left + 15).toFixed(1)}" cy="${a.y}" r="3.5" fill="${a.topic.color}"/>`,
        `<text x="${(left + 25).toFixed(1)}" y="${a.y + 4}" font-size="12" style="fill:var(--lb)">${esc(a.name)}${a.file ? ` <tspan class="mono" font-size="10.5" style="fill:var(--mu)">${esc(a.file)}</tspan>` : ''}</text></g>`,
      )
    }
    parts.push(
      `<g class="hit"><rect x="14" y="12" width="96" height="30" rx="15" style="fill:var(--glass);stroke:var(--x)"/><text x="30" y="31" font-size="12" style="fill:var(--lb)">‹ All topics</text></g>`,
    )
  }

  const hint = hintFitted(view, size)
  const hw = 24 + hint.length * 6.3
  parts.push(
    `<rect x="${(size.w / 2 - hw / 2).toFixed(1)}" y="14" width="${hw.toFixed(1)}" height="30" rx="15" style="fill:var(--glass);stroke:var(--x)"/>`,
    `<text x="${size.w / 2}" y="33" font-size="12" style="fill:var(--lb)" text-anchor="middle">${esc(hint)}</text>`,
  )
  const ly = size.h - 16
  parts.push(
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
  const svg = parts.join('')
  if (svg.length > SVG_CAP) {
    // Shed detail in steps: tooltips first, then satellites per topic, until the document fits whole.
    const ladder: SvgOptions[] = [
      { withTooltips: false, maxSessions },
      { withTooltips: false, maxSessions: 12 },
      { withTooltips: false, maxSessions: 4 },
      { withTooltips: false, maxSessions: 0 },
    ]
    const next = ladder.find(step => step.withTooltips !== withTooltips || (step.maxSessions ?? maxSessions) < maxSessions)
    if (next) return svgOf(view, next)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}"><style>${themeCss(view.settings.fieldBackground)}</style><rect width="${size.w}" height="${size.h}" rx="16" fill="none" style="stroke:var(--line)"/><text x="${size.w / 2}" y="${size.h / 2}" font-size="13" style="fill:var(--mu)" text-anchor="middle">Too many topics to draw at once: narrow the time range or search.</text></svg>`
  }
  return svg
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

const COLOR_OPTIONS = PALETTE.map((hex, i) => ({ value: hex, label: ['Amber', 'Violet', 'Mint', 'Sky', 'Rose'][i] ?? hex }))

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
  return (
    <Box flexDirection="column" gap="xs">
      {/* The title and the crumb on one row, the controls on the next: a narrow pane wraps the controls alone, in order. */}
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Text weight="semibold" mono>
          CONSTELLATION
        </Text>
        <Text dimColor size="footnote" wrap="truncate">
          {crumbOf(view)}
        </Text>
      </Box>
      <Box flexDirection="row" alignItems="center" gap="sm" flexWrap="wrap">
        {Input ? <Input key="q" placeholder="Search sessions, notes, files" value={ui.query} submitLabel="search" onInput={v => act.setQuery(v)} onSubmit={v => act.setQuery(v)} /> : null}
        {Select ? <Select key="range" options={RANGE_OPTIONS} value={String(view.settings.rangeDays)} onSelect={v => act.setRange(Number(v))} /> : null}
        <Button key="view:map" label="Map" hotkey={hk(view, 'm')} variant={ui.view === 'map' ? 'primary' : 'secondary'} onPress={() => act.setView('map')} />
        <Button key="view:list" label="List" hotkey={hk(view, 'l')} variant={ui.view === 'list' ? 'primary' : 'secondary'} onPress={() => act.setView('list')} />
        <Button key="settings" label={`${marks(view).gear}${ui.showSettings ? 'Done' : 'Settings'}`} hotkey={hk(view, 's')} onPress={() => act.toggleSettings()} />
        <Button key="help" label={ui.showHelp ? 'Close help' : 'Help'} hotkey={hk(view, 'h')} onPress={() => act.toggleHelp()} />
        {view.me.topicId ? (
          <Button key="mine" hotkey={hk(view, 'y')} plain onPress={() => act.myTopic()}>
            <Text color={ACCENT}>♦</Text> my topic
          </Button>
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
  if (!focus) {
    const isPicking = ui.mergeFrom !== null || ui.moveMode
    return (
      <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
        {model.topics.map(t => (
          <Button
            key={`t:${t.id}`}
            plain={isPicking ? undefined : true}
            dimColor={!t.isMajor}
            onPress={() => (ui.mergeFrom !== null ? act.mergeInto(t.id) : ui.moveMode ? act.moveTo(t.id) : act.focusTopic(t.id))}
          >
            <Text color={t.color}>●</Text> {clip(t.name, 28)} <Text dimColor mono>{String(t.sessions.length)}</Text>
          </Button>
        ))}
        {ui.mergeFrom !== null ? <Button key="merge:cancel" label="Cancel merge" onPress={() => act.mergeMode(null)} /> : null}
        {ui.moveMode ? <Button key="move:cancel" label="Cancel move" onPress={() => act.moveMode(false)} /> : null}
      </Box>
    )
  }
  const steps = chainOf(view, focus)
  const rel = view.settings.showRelated ? relatedOf(model.links, focus.id) : []
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
        <Button key="back" label="‹ All topics" hotkey={hk(view, 'b')} onPress={() => act.allTopics()} />
        {steps.map((s, i) => (
          <Button
            key={`s:${s.id}`}
            hotkey={hk(view, i < 9 ? String(i + 1) : undefined)}
            plain
            variant={ui.selected === s.id ? 'primary' : undefined}
            onPress={() => (s.isYou ? act.selectSession(null) : act.selectSession(ui.selected === s.id ? null : s.id))}
          >
            {`${i + 1} `}
            {s.isYou ? 'This session · you' : clip(s.session?.title ?? '', 26)}
          </Button>
        ))}
      </Box>
      {rel.length > 0 ? (
        <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
          <Text dimColor size="footnote" mono>
            RELATED
          </Text>
          {rel.map(r => {
            const rt = model.topicById[r.id]
            return rt ? (
              <Button key={`a:${rt.id}`} plain dimColor onPress={() => act.focusTopic(rt.id)}>
                <Text color={rt.color}>●</Text> {clip(rt.name, 22)} <Text dimColor mono>{r.via}</Text>
              </Button>
            ) : null
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
      <Text dimColor size="footnote" mono>
        JUMP BACK IN
      </Text>
      {recent.map(s => {
        const t = model.topicById[s.topicId]
        return (
          <Button key={`r:${s.id}`} plain onPress={() => act.jumpTo(s.id)}>
            <Text color={t?.color ?? ACCENT}>{statusGlyph(s)}</Text> {clip(s.title, 32)} <Text dimColor mono>{ageOf(s.lastAt, now)}</Text>
          </Button>
        )
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
  return (
    <Box flexDirection="column" gap="xs">
      {topics.length === 0 ? <Text dimColor>{query ? 'Nothing matches the search.' : 'No sessions on this map yet. Run a session in this folder, or name this one with /topic <name>.'}</Text> : null}
      {topics.map(t => {
        const isOpen = ui.focusTopic === t.id
        const steps = isOpen ? chainOf(view, t).filter(s => s.isYou || (s.session && matches(query, s.session))) : []
        return (
          <Box key={`row:${t.id}`} flexDirection="column" borderStyle="round" borderColor={isOpen ? t.color : CARD_BORDER} paddingX={1}>
            <Button key={`t:${t.id}`} plain onPress={() => (ui.mergeFrom !== null ? act.mergeInto(t.id) : ui.moveMode ? act.moveTo(t.id) : act.focusTopic(isOpen ? null : t.id))}>
              <Text color={t.color}>●</Text> <Text weight="medium">{clip(t.name, 40)}</Text>{' '}
              <Text dimColor mono>
                {`${t.id === UNSORTED_ID ? 'unsorted' : t.isMajor ? 'major' : 'minor'} · ${t.sessions.length} session${t.sessions.length === 1 ? '' : 's'}${t.sessions.length ? ` · ${ageOf(t.lastAt, now)} ago` : ''}${view.me.topicId === t.id ? ' · you' : ''} ${isOpen ? marks(view).open : marks(view).shut}`}
              </Text>
            </Button>
            {isOpen && t.goal ? (
              <Text dimColor size="footnote">
                {`Goal: ${clip(t.goal, 120)}`}
              </Text>
            ) : null}
            {steps.map((s, i) => (
              <Button
                key={`s:${s.id}`}
                plain
                hotkey={hk(view, stepHotkeys && i < 9 ? String(i + 1) : undefined)}
                variant={ui.selected === s.id ? 'primary' : undefined}
                onPress={() => (s.isYou ? act.selectSession(null) : act.selectSession(ui.selected === s.id ? null : s.id))}
              >
                <Text color={t.color} mono>
                  {String(i + 1)}
                </Text>{' '}
                {s.isYou ? <Text color={ACCENT}>♦ This session · you</Text> : `${statusGlyph(s.session as SessionView)} ${clip(s.session?.title ?? '', 48)}`}{' '}
                <Text dimColor mono>
                  {s.isYou ? 'now' : ageOf(s.session?.lastAt ?? now, now)}
                  {s.session?.isPinned ? ` ${marks(view).pin}` : ''}
                </Text>
              </Button>
            ))}
          </Box>
        )
      })}
      {ui.mergeFrom !== null ? <Button key="merge:cancel" label="Cancel merge" onPress={() => act.mergeMode(null)} /> : null}
      {ui.moveMode ? <Button key="move:cancel" label="Cancel move" onPress={() => act.moveMode(false)} /> : null}
    </Box>
  )
}

type SettingRow = { key: keyof MapSettings; label: string; help: string; options: { value: string | number | boolean; label: string }[] }

/** The settings card's rows in three groups; the last is folded until asked for. */
const SETTING_GROUPS: { title: string; rows: SettingRow[]; isAdvanced?: true }[] = [
  {
    title: 'MAP',
    rows: [
      { key: 'scope', label: 'Scope', help: 'which transcripts the map reads', options: [{ value: 'folder', label: 'This folder' }, { value: 'all', label: 'Every folder' }] },
      { key: 'groupBasis', label: 'Grouping', help: 'how unassigned sessions find a topic', options: [{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }] },
      { key: 'fieldBackground', label: 'Field background', help: 'the pane’s own surface, or the solid night ground', options: [{ value: 'transparent', label: 'Transparent' }, { value: 'night', label: 'Night' }] },
      { key: 'numbering', label: 'Numbering in focus', help: 'order of the chain', options: [{ value: 'oldestFirst', label: 'Oldest first' }, { value: 'newestFirst', label: 'Newest first' }] },
      { key: 'showRelated', label: 'Related anchors', help: 'linked topics at the bottom', options: [{ value: true, label: 'Show' }, { value: false, label: 'Hide' }] },
    ],
  },
  {
    title: 'SESSION',
    rows: [
      { key: 'handoffNotes', label: 'Handoff notes', help: 'how a session gets its note', options: [{ value: 'manual', label: 'Manual /park' }, { value: 'auto', label: 'Auto (haiku)' }, { value: 'ask', label: 'Ask after a turn' }] },
      { key: 'autoJoin', label: 'Auto join', help: 'after the first prompt', options: [{ value: 'suggest', label: 'Suggest' }, { value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }] },
      { key: 'openOnStart', label: 'On session start', help: 'what shows when a session begins', options: [{ value: 'band', label: 'Band' }, { value: 'pane', label: 'Pane' }, { value: 'none', label: 'Nothing' }] },
      { key: 'useModelForTitles', label: 'Topic names', help: 'name auto topics with haiku', options: [{ value: false, label: 'Frequent words' }, { value: true, label: 'Model' }] },
    ],
  },
  {
    title: 'ADVANCED',
    isAdvanced: true,
    rows: [
      { key: 'majorRule', label: 'Major topic rule', help: 'what gets a labelled pill', options: [{ value: 'either', label: 'Either' }, { value: 'count', label: 'Count' }, { value: 'recent', label: 'Recent' }] },
      { key: 'majorMinSessions', label: 'Count threshold', help: 'sessions to count as major', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 5, label: '5' }] },
      { key: 'recentDays', label: 'Recent days', help: 'activity that keeps a topic major', options: [{ value: 3, label: '3d' }, { value: 7, label: '7d' }, { value: 14, label: '14d' }, { value: 30, label: '30d' }] },
      { key: 'pictureClicks', label: 'Clicks on the picture', help: 'the Desktop’s pointer layer over the picture; outline draws its edge', options: [{ value: 'on', label: 'On' }, { value: 'outline', label: 'Outline' }, { value: 'off', label: 'Off' }] },
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
  const rows: (RenderElement | null | false)[] = [
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Text dimColor mono size="footnote">
        SETTINGS · changes apply to the map above and are saved
      </Text>
      <Button key="settings:done" label="Done" onPress={() => act.toggleSettings()} />
    </Box>,
  ]
  for (const group of SETTING_GROUPS) {
    const isFolded = group.isAdvanced === true && !view.ui.showAdvanced
    rows.push(
      <Box key={`group:${group.title}`} flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
        <Text dimColor mono size="footnote">
          {group.title}
        </Text>
        {group.isAdvanced ? <Button key="set:advanced" label={isFolded ? `Show ${marks(view).shut}` : `Hide ${marks(view).open}`} plain dimColor onPress={() => act.toggleAdvanced()} /> : null}
        {isFolded ? (
          <Text dimColor size="footnote">
            what earns a labelled pill, and the Desktop’s pointer layer
          </Text>
        ) : null}
      </Box>,
    )
    if (isFolded) continue
    for (const row of group.rows) {
      rows.push(
        <Box key={`set:${row.key}`} flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
          <Text>
            {row.label} <Text dimColor>{row.help}</Text>
          </Text>
          {row.options.map(o => {
            const isOn = view.settings[row.key] === o.value
            return <Button key={`set:${row.key}:${String(o.value)}`} label={o.label} variant={isOn ? 'primary' : 'secondary'} dimColor={!isOn} onPress={() => act.setSetting(row.key, o.value)} />
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
  return card(T, rows)
}

function card(T: Table, children: (RenderElement | null | false)[], borderColor = CARD_BORDER): RenderElement {
  const { Box } = T
  return (
    <Box flexDirection="column" gap="xs" borderStyle="round" borderColor={borderColor} paddingX={1}>
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
  const rows: (RenderElement | null | false)[] = [
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
      <Text weight="medium">{`New session in ${me.folder || 'this folder'} · continuing which topic?`}</Text>
      {where === 'pane' ? <Text dimColor mono size="footnote">{statsOf(model)}</Text> : null}
    </Box>,
  ]
  // The band keeps to the nine digits; the pane's chooser lists every topic.
  const shown = where === 'band' ? ranked.slice(0, MAX_BAND_CHIPS) : ranked
  const more = ranked.length - shown.length
  rows.push(
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      {shown.map((t, i) => {
        const latest = latestOf(t.sessions)
        return (
          <Button key={`j:${t.id}`} hotkey={hk(view, i < 9 ? String(i + 1) : undefined)} variant={me.suggested === t.id ? 'primary' : undefined} onPress={() => act.join(t.id)}>
            <Text color={t.color}>●</Text> {clip(t.name, 26)}{' '}
            <Text dimColor mono>{`${t.sessions.length}${latest ? ` · ${ageOf(latest.lastAt, view.now)} ago` : ''}`}</Text>
            {me.suggested === t.id ? <Text color={ACCENT}> SUGGESTED</Text> : ''}
          </Button>
        )
      })}
      {more > 0 ? <Button key="j:more" plain onPress={() => act.openMap()}>{`+${more} more in the map`}</Button> : null}
      <Button key="j:new" label="+ New topic" hotkey={hk(view, 'n')} onPress={() => act.newTopic()} />
      {where === 'band' ? <Button key="j:map" label="Open map" hotkey={hk(view, 'o')} onPress={() => act.openMap()} /> : null}
      {where === 'band' ? <Button key="j:dismiss" label="Dismiss" role="dismiss" onPress={() => act.dismissBand()} /> : null}
    </Box>,
  )
  rows.push(
    <Text dimColor size="footnote">
      {where === 'pane'
        ? 'Joining makes this session the topic’s next step and puts its goal and latest handoff note beside your next prompt. The suggestion comes from your first prompt; nothing is chosen for you unless auto-join is on.'
        : 'Joining adds the topic’s goal and latest handoff note to your next prompt · /map opens the map'}
    </Text>,
  )
  return card(T, rows, rgba(ACCENT, 0.45))
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
        <Button key="topicname:cancel" label="Cancel" onPress={() => act.cancelNewTopic()} />
      </Box>
    ) : null,
    me.askNote && Input ? (
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Input key="park" placeholder="What is done, what is left, what to watch" submitLabel="park" onSubmit={text => act.park(text)} autoFocus />
        <Button key="park:skip" label="Skip" onPress={() => act.skipNote()} />
      </Box>
    ) : null,
    <Box flexDirection="row" gap="xs" flexWrap="wrap">
      {topic ? <Button key="c:focus" label="Focus my topic" hotkey={hk(view, 'f')} variant="primary" onPress={() => act.focusTopic(topic.id)} /> : null}
      {latest ? <Button key="c:draft" label="Draft next prompt" hotkey={hk(view, 'd')} onPress={() => act.draft(null)} /> : null}
      <Button key="c:change" label="Change topic" hotkey={hk(view, 'c')} onPress={() => act.changeTopic()} />
      {!me.askNote ? <Button key="c:park" label="Park a note" hotkey={hk(view, 'p')} onPress={() => act.parkPrompt()} /> : null}
    </Box>,
  ])
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
  return card(T, [
    <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
      <Text color={topic.color}>●</Text>
      <Text weight="medium">{topic.name}</Text>
      <Text dimColor mono size="footnote">
        {isUnsorted ? 'UNSORTED' : topic.isMajor ? 'MAJOR' : 'MINOR'}
      </Text>
      <Text dimColor mono size="footnote">{`${topic.sessions.length} sessions · ${idle.length} idle · ${shipped} shipped`}</Text>
    </Box>,
    !isUnsorted ? <Text dimColor>{topic.goal ? `Goal: ${clip(topic.goal, 200)}` : 'No goal yet. A goal travels with every handoff on this topic.'}</Text> : null,
    <Text>{latest ? `Latest: ${clip(latest.title, 60)} (${ageOf(latest.lastAt, now)} ago). ${clip(noteText(latest), 220)}` : isUnsorted ? 'Sessions nothing else claimed. Select one and Move to topic to file it.' : 'No sessions yet.'}</Text>,
    ui.editing === 'rename' && Input && !isUnsorted ? (
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Input key="rename" value={topic.name} placeholder="Topic name" submitLabel="rename" onSubmit={name => act.rename(topic.id, name)} autoFocus />
        <Button key="rename:cancel" label="Cancel" onPress={() => act.edit(null)} />
      </Box>
    ) : null,
    ui.editing === 'goal' && Input && !isUnsorted ? (
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Input key="goal" value={topic.goal ?? ''} placeholder="What this topic is for, in a sentence" submitLabel="save" onSubmit={goal => act.setGoal(topic.id, goal)} autoFocus />
        <Button key="goal:cancel" label="Cancel" onPress={() => act.edit(null)} />
      </Box>
    ) : null,
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      <Text dimColor mono size="footnote">
        RELATED
      </Text>
      {rel.length === 0 ? <Text dimColor>none</Text> : null}
      {rel.map(r => {
        const rt = model.topicById[r.id]
        return rt ? (
          <Button key={`rel:${rt.id}`} plain onPress={() => act.focusTopic(rt.id)}>
            {clip(rt.name, 22)} <Text dimColor mono>{r.via}</Text>
          </Button>
        ) : null
      })}
    </Box>,
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      <Button key="tc:focus" label={isFocused ? 'Back to all topics' : 'Focus this topic'} hotkey={hk(view, 'f')} variant="primary" onPress={() => (isFocused ? act.allTopics() : act.focusTopic(topic.id))} />
      {latest ? <Button key="tc:pickup" label="Pick up latest" hotkey={hk(view, 'u')} onPress={() => act.pickUpLatest(topic.id)} /> : null}
      {view.me.topicId !== topic.id && !isUnsorted ? <Button key="tc:join" label="Join this topic" hotkey={hk(view, 'j')} onPress={() => act.join(topic.id)} /> : null}
      {tidyTargets.length ? <Button key="tc:tidy" label={`Archive ${tidyTargets.length} idle`} onPress={() => act.tidy(topic.id)} /> : null}
    </Box>,
    !isUnsorted ? (
      <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
        {Input ? <Button key="tc:rename" label="Rename" hotkey={hk(view, 'r')} onPress={() => act.edit(ui.editing === 'rename' ? null : 'rename')} /> : null}
        {Input ? <Button key="tc:goal" label={topic.goal ? 'Edit goal' : 'Set goal'} hotkey={hk(view, 'g')} onPress={() => act.edit(ui.editing === 'goal' ? null : 'goal')} /> : null}
        <Button key="tc:merge" label="Merge into…" hotkey={hk(view, 'e')} onPress={() => act.mergeMode(topic.id)} />
        {Select ? <Select key={`color:${topic.id}`} label="Colour" options={COLOR_OPTIONS} value={PALETTE.includes(topic.color as (typeof PALETTE)[number]) ? topic.color : undefined} onSelect={hex => act.setColor(topic.id, hex)} /> : null}
      </Box>
    ) : null,
  ])
}

export function drawSessionCard(T: Table, view: View, act: Actions, s: SessionView): RenderElement {
  const { Box, Text, Button, Input } = T
  const { model, ui, now } = view
  const topic = model.topicById[s.topicId]
  const color = topic?.color ?? ACCENT
  const n = topic ? stepNumber(view, topic, s.id) : 0
  const rows: (RenderElement | null | false)[] = [
    <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
      <Text color={color} mono weight="semibold">{`[${n > 0 ? n : '·'}]`}</Text>
      <Text weight="medium">{s.title}</Text>
      <Text color={s.status === 'active' ? color : MUTED} mono size="footnote">
        {s.status.toUpperCase()}
      </Text>
      {s.large ? (
        <Text dimColor mono size="footnote">
          LARGE TRANSCRIPT
        </Text>
      ) : null}
    </Box>,
    <Text dimColor mono size="footnote">
      {sessionMeta(s, now, `ran ${durationOf(s.lastAt - s.startedAt)}${topic ? ` · in ${topic.name}` : ''}`)}
    </Text>,
    <Text dimColor mono size="footnote">
      HANDOFF NOTE
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
        <Button key="msg:cancel" label="Cancel" onPress={() => act.messageMode(false)} />
      </Box>,
    )
  }
  rows.push(
    <Box flexDirection="row" gap="xs" flexWrap="wrap">
      <Button key="sc:pickup" label="Pick up here" hotkey={hk(view, 'u')} variant="primary" onPress={() => act.pickUp(s.id)} />
      <Button key="sc:draft" label="Draft prompt" hotkey={hk(view, 'd')} onPress={() => act.draft(s.id)} />
      <Button key="sc:new" label="New session from here" hotkey={hk(view, 'n')} onPress={() => act.newSession(s.id)} />
    </Box>,
    <Box flexDirection="row" gap="xs" flexWrap="wrap">
      <Button key="sc:pin" label={s.isPinned ? 'Unpin' : 'Pin'} hotkey={hk(view, 'p')} onPress={() => act.pin(s.id)} />
      <Button key="sc:move" label={ui.moveMode ? 'Cancel move' : 'Move to topic'} hotkey={hk(view, 'v')} onPress={() => act.moveMode(!ui.moveMode)} />
      <Button key="sc:archive" label={s.status === 'archived' ? 'Unarchive' : 'Archive'} hotkey={hk(view, 'x')} onPress={() => act.archive(s.id)} />
      {Input ? <Button key="sc:message" label="Message" hotkey={hk(view, 't')} dimColor={s.status !== 'active'} onPress={() => act.messageMode(!ui.messageMode)} /> : null}
    </Box>,
    <Text dimColor mono size="footnote" wrap="truncate">
      {`resume it in a terminal: claude --resume ${s.id}`}
    </Text>,
  )
  return card(T, rows, ui.selected === s.id ? rgba(color, 0.45) : CARD_BORDER)
}

export function drawToast(T: Table, view: View, act: Actions): RenderElement | null {
  const { Box, Text, Button } = T
  const toast = view.ui.toast
  if (!toast) return null
  return (
    <Box flexDirection="row" gap="sm" alignItems="center" borderStyle="round" borderColor="#5FD3A6" paddingX={1}>
      <Text color="#5FD3A6">{marks(view).done}</Text>
      <Text>{toast.text}</Text>
      {toast.hasUndo ? <Button key="toast:undo" label="Undo" hotkey={hk(view, 'z')} onPress={() => act.undo()} /> : null}
      <Button key="toast:dismiss" label="Dismiss" plain onPress={() => act.dismissToast()} />
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
        <Text weight="semibold" mono>
          CONSTELLATION
        </Text>
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
  if (me.askNote) {
    return (
      <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
        <Text>Park a handoff note for this session?</Text>
        {Input ? <Input key="park" placeholder="What is done, what is left, what to watch" submitLabel="park" onSubmit={text => act.park(text)} /> : null}
        <Button key="park:skip" label="Skip" role="dismiss" onPress={() => act.skipNote()} />
      </Box>
    )
  }
  if (me.topicId === null && me.isNewTopic) {
    return (
      <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
        <Text>New topic for this session:</Text>
        {Input ? <Input key="topicname" placeholder="Name this topic" submitLabel="create" onSubmit={name => act.createTopic(name)} autoFocus /> : <Text dimColor>/topic &lt;name&gt; names it</Text>}
        <Button key="topicname:cancel" label="Cancel" role="dismiss" onPress={() => act.cancelNewTopic()} />
      </Box>
    )
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
  const perTopic = satellitesPerTopic(model.topics.length)
  if (!focus) {
    // The focus ring may rest on a chip that is no topic (+ New topic): that traces nothing.
    const traced = ui.hover && model.topicById[ui.hover] ? ui.hover : null
    for (const t of model.topics) {
      const p = placed[t.id]
      if (!p) continue
      const isDim = (traced !== null && traced !== t.id) || !topicMatches(ui.query, t)
      const countLabel = ui.query.trim() ? `${t.sessions.filter(s => matches(ui.query, s)).length} match` : `${t.sessions.length}${view.me.topicId === t.id ? ' · you' : ''}`
      const w = t.isMajor ? pillWidth(t.name, countLabel) : 16 + (clip(t.name, 24).length + countLabel.length + 1) * 6.9
      nodes.push(node({ id: t.id, kind: 'topic', x: p.x, y: p.y, w: Math.round(w), label: `${clip(t.name, 24)} ${countLabel}`, color: t.color, isMajor: t.isMajor, isDim, isSelected: false, title: t.name }))
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
    nodes.push(node({ id: focus.id, kind: 'topic', x: size.w / 2, y: FOCUS_PILL.y, w: Math.round(pill.w), label: `${clip(focus.name, 24)} ${pill.count}`, color: focus.color, isMajor: true, title: focus.name }))
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
      nodes.push(node({ id: a.topic.id, kind: 'topic', x: a.x, y: a.y, w: a.w, label: `${clip(a.topic.name, 14)} · ${clip(a.via, 10)}`, color: a.topic.color, isMajor: false, isDim: true, isAnchor: true, title: a.topic.name }))
    }
  }
  const field: FieldProps = { mode: focus ? 'focus' : 'map', hint: view.surface === 'terminal' ? hintOf(view) : hintFitted(view, size), nodes, links, legend, fieldW: size.w, fieldH: size.h }
  if (JSON.stringify(field).length > FIELD_CHARS) field.nodes = nodes.filter(n => n.kind !== 'session')
  return field
}

export type { Point }
