// Constellation: the Svg field and the element trees around it.
//
// `svgOf` renders the map (every topic as a pill or dot with its satellites)
// or a focused topic (a numbered zigzag chain with related anchors) as one
// SVG string, from the model and the pane's view state, in the look of
// design/TopicMap.dc.html. The trees here are built from the surface's
// element table and the actions the entry point hands in; nothing here
// touches `$`.
import type { Elements, RenderElement } from 'claude-code'

import { ACCENT, ALL_TIME_DAYS, MINOR_COLOR, PALETTE, UNSORTED_ID, ageOf, latestOf, orderChain } from './cluster'
import type { Link, Model, SessionView, Topic } from './cluster'
import { ANCHOR_Y, FIELD_H, FIELD_W, FOCUS_PILL, anchorPositions, chainPositions, satellitePosition, starPath } from './layout'
import type { PlacedTopic, Point } from './layout'
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
  ui: UiState
  me: MeState
  settings: MapSettings
  usage: UsageState
  now: number
  surface: string
  /** This session's own handoff note, when one is parked. */
  myNote?: NoteRecord
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

export function sessionMeta(s: SessionView, now: number, extra = ''): string {
  const parts = [`${ageOf(s.lastAt, now)} ago`]
  if (s.branch) parts.push(s.branch)
  parts.push(`${s.turns} turns`)
  if (extra) parts.push(extra)
  return parts.join(' · ')
}

/** The note text a card and a tooltip show: the parked note, else the last assistant text, else nothing. */
export function noteText(s: SessionView): string {
  return s.note?.text ?? s.lastAssistantText
}

/** The focused topic's chain: in-range sessions in order, plus a "you" step when this session joined it. */
export type Step = { id: string; session?: SessionView; isYou: boolean }

export function chainOf(view: View, topic: Topic): Step[] {
  const inRange = orderChain(topic.sessions.filter(s => s.isInRange), view.settings.numbering)
  const steps: Step[] = inRange.map(s => ({ id: s.id, session: s, isYou: false }))
  if (view.me.topicId === topic.id) {
    const you: Step = { id: 'you', isYou: true }
    if (view.settings.numbering === 'newestFirst') steps.unshift(you)
    else steps.push(you)
  }
  return steps
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
  return 'Hover or focus a topic to trace it · Enter or click to focus'
}

type SvgOptions = { withTooltips?: boolean; maxSessions?: number }

function pillWidth(name: string, count: string): number {
  return 46 + Math.min(name.length, 28) * 7.4 + count.length * 6.8
}

/** The whole field as an SVG document, under the 131072-character cap. */
export function svgOf(view: View, options: SvgOptions = {}): string {
  const withTooltips = options.withTooltips ?? true
  const maxSessions = options.maxSessions ?? 60
  const { model, ui, placed, now } = view
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  const query = ui.query.trim()
  const parts: string[] = []
  const css: string[] = [
    `.t,.x,.s{transition:opacity .25s}`,
    `.hit{cursor:pointer}`,
    `.glow{opacity:0;transition:opacity .25s}`,
    `.t:hover .glow{opacity:1}`,
    `.t:hover .lbl{fill:${TEXT}}`,
    `.t:hover .ln{opacity:.75}`,
    `svg:has(.t:hover) .t:not(:hover){opacity:.3}`,
    `svg:has(.t:hover) .x{opacity:.35}`,
    `text{font-family:${SANS}}`,
    `.mono{font-family:${MONO}}`,
  ]
  const indexOf = new Map<string, number>()
  model.topics.forEach((t, i) => indexOf.set(t.id, i))

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${FIELD_W}" height="${FIELD_H}" viewBox="0 0 ${FIELD_W} ${FIELD_H}" role="img">`,
    `<defs><pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#151A22" stroke-width="1"/></pattern>`,
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9z" fill="${focus ? focus.color : ACCENT}"/></marker>`,
    `<clipPath id="field"><rect width="${FIELD_W}" height="${FIELD_H}" rx="16"/></clipPath>`,
  )
  const styleAt = parts.length
  parts.push('')
  parts.push(`</defs>`)
  parts.push(`<g clip-path="url(#field)">`)
  parts.push(`<rect width="${FIELD_W}" height="${FIELD_H}" fill="${BG}"/>`)
  parts.push(`<rect width="${FIELD_W}" height="${FIELD_H}" fill="url(#grid)"/>`)
  parts.push(`<path d="${starPath(70, 137.5, 11)}" stroke="#3A4252" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.6"/>`)
  parts.push(`<path d="${starPath(18, 211.7, 53)}" stroke="#55607A" stroke-width="2.4" stroke-linecap="round" fill="none" opacity="0.6"/>`)

  if (!focus) {
    const traced = ui.hover && model.topicById[ui.hover] ? ui.hover : null
    const related = new Set<string>(traced ? relatedOf(model.links, traced).map(r => r.id) : [])
    const dropSource = ui.mergeFrom ?? (ui.moveMode && ui.selected ? model.byId[ui.selected]?.topicId : undefined)
    for (const l of model.links) {
      const a = placed[l.a]
      const b = placed[l.b]
      if (!a || !b) continue
      const isBright = traced !== null && (l.a === traced || l.b === traced)
      const color = isBright ? (model.topicById[traced ?? '']?.color ?? ACCENT) : '#2A3240'
      const ia = indexOf.get(l.a) ?? 0
      const ib = indexOf.get(l.b) ?? 0
      parts.push(
        `<line class="x x-${ia} x-${ib}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${isBright ? 1.2 : 1}" stroke-dasharray="2 5" opacity="${isBright ? 0.8 : traced ? 0.35 : 0.8}"/>`,
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
      const half = t.isMajor ? pillWidth(t.name, countLabel) / 2 : undefined
      sessions.forEach((s, k) => {
        const sp = satellitePosition(p, t.id, k, t.isMajor, half)
        if (s.isInRange) {
          g.push(`<line class="ln" x1="${p.x}" y1="${p.y}" x2="${sp.x.toFixed(1)}" y2="${sp.y.toFixed(1)}" stroke="${isTraced ? t.color : '#2E3644'}" stroke-width="${isTraced ? 1.2 : 1}" opacity="${isTraced ? 0.75 : traced ? 0.35 : 0.8}"/>`)
        }
      })
      sessions.forEach((s, k) => {
        const sp = satellitePosition(p, t.id, k, t.isMajor, half)
        const isSel = ui.selected === s.id
        const isMatch = matches(query, s)
        let r = isTraced ? 5 : t.isMajor ? 3.5 : 2.5
        if (isSel) r = 6
        if (query && isMatch) r = Math.max(r, 4.5)
        let op = s.isInRange ? 1 : 0.18
        if (traced && !isTraced) op = Math.min(op, 0.25)
        if (!isMatch) op = Math.min(op, 0.15)
        const fill = s.status === 'active' ? t.color : s.status === 'idle' ? '#161B23' : '#1C222C'
        const ring = s.status === 'archived' ? DIM : t.color
        const dash = s.status === 'archived' ? ' stroke-dasharray="2 2"' : ''
        const glow = isSel || (query && isMatch) ? `<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r + 4}" fill="${rgba(t.color, 0.3)}"/>` : ''
        const halo = `<circle cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r + 5}" fill="${rgba(t.color, 0.12)}"/>`
        const tip = withTooltips ? `<title>${esc(s.title)}\n${esc(sessionMeta(s, now))}${noteText(s) ? `\n${esc(clip(noteText(s), 160))}` : ''}</title>` : ''
        const pin = s.isPinned ? `<text x="${(sp.x + 5).toFixed(1)}" y="${(sp.y - 5).toFixed(1)}" font-size="9" fill="${ACCENT}">★</text>` : ''
        g.push(`<g class="s n hit" opacity="${op.toFixed(2)}">${tip}${halo}${glow}<circle class="sat" cx="${sp.x.toFixed(1)}" cy="${sp.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${ring}" stroke-width="1.5"${dash}/>${pin}</g>`)
      })
      if (t.isMajor) {
        const w = pillWidth(t.name, countLabel)
        const x = p.x - w / 2
        const y = p.y - 19
        const dashed = isDrop ? ' stroke-dasharray="4 3"' : ''
        g.push(
          `<rect class="glow" x="${(x - 5).toFixed(1)}" y="${y - 5}" width="${(w + 10).toFixed(1)}" height="48" rx="24" fill="${rgba(t.color, 0.22)}"${isTraced || isDrop ? ' opacity="1"' : ''}/>`,
          `<rect class="pill hit" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="38" rx="19" fill="${isTraced ? '#1C2230' : '#161B23'}" stroke="${t.color}" stroke-width="1.5"${dashed}/>`,
          `<circle cx="${(x + 17).toFixed(1)}" cy="${p.y}" r="4" fill="${t.color}"/>`,
          `<text x="${(x + 28).toFixed(1)}" y="${p.y + 4.5}" font-size="13" font-weight="600" fill="${TEXT}">${esc(clip(t.name, 28))}</text>`,
          `<text class="mono" x="${(x + w - 14).toFixed(1)}" y="${p.y + 4}" font-size="11" font-weight="500" fill="${t.color}" text-anchor="end">${esc(countLabel)}</text>`,
        )
      } else {
        const onRight = p.x > 700
        const lx = onRight ? p.x - 16 : p.x + 16
        g.push(
          `<circle class="glow" cx="${p.x}" cy="${p.y}" r="11" fill="${rgba(t.color, 0.22)}"${isTraced || isDrop ? ' opacity="1"' : ''}/>`,
          `<circle class="hit" cx="${p.x}" cy="${p.y}" r="5.5" fill="#161B23" stroke="${t.color}" stroke-width="1.5"${isDrop ? ' stroke-dasharray="3 2"' : ''}/>`,
          `<text class="mono lbl" x="${lx}" y="${p.y + 4}" font-size="11.5" fill="${isTraced ? TEXT : MUTED}" text-anchor="${onRight ? 'end' : 'start'}">${esc(clip(t.name, 24))} <tspan fill="${t.color}">${esc(countLabel)}</tspan></text>`,
        )
      }
      g.push('</g>')
      parts.push(g.join(''))
    }
    if (model.topics.length === 0) {
      parts.push(`<text x="430" y="250" font-size="15" font-weight="500" fill="${TEXT}" text-anchor="middle">No sessions on this map yet</text>`)
      parts.push(`<text x="430" y="276" font-size="12" fill="${MUTED}" text-anchor="middle">Sessions in this folder appear here once they have run; /topic names this one.</text>`)
    }
  } else {
    const steps = chainOf(view, focus)
    const positions = chainPositions(steps.length)
    const latest = latestOf(focus.sessions)
    const color = focus.color === MINOR_COLOR ? ACCENT : focus.color
    const points: string[] = []
    steps.forEach((step, i) => {
      const pt = positions[i]
      if (!pt) return
      points.push(`${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      parts.push(`<line x1="${FOCUS_PILL.x}" y1="${FOCUS_PILL.y}" x2="${pt.x.toFixed(1)}" y2="${pt.y.toFixed(1)}" stroke="#2E3644" stroke-width="1" opacity="0.8"/>`)
    })
    if (points.length > 1) {
      parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" marker-mid="url(#arrow)" marker-end="url(#arrow)" opacity="0.9"/>`)
    }
    steps.forEach((step, i) => {
      const pt = positions[i]
      if (!pt) return
      const s = step.session
      const isSel = s !== undefined && ui.selected === s.id
      const isLatest = s !== undefined && latest !== undefined && s.id === latest.id
      const status = s?.status ?? 'active'
      const isYou = step.isYou
      const fill = isYou ? rgba(ACCENT, 0.16) : isSel ? color : status === 'active' ? rgba(color, 0.25) : '#161B23'
      const numColor = isYou ? ACCENT : isSel ? '#12161D' : status === 'archived' ? '#9AA3B2' : TEXT
      const ring = isYou ? ACCENT : status === 'archived' ? DIM : color
      const dash = isYou || status === 'archived' ? ' stroke-dasharray="4 3"' : ''
      const op = isYou || (s && matches(query, s)) ? 1 : 0.25
      const isTight = steps.length >= 5
      const title = isYou ? 'This session · you' : (s?.title ?? '')
      const meta = isYou
        ? 'now · you'
        : s
          ? isTight
            ? [`${ageOf(s.lastAt, now)} ago`, `${s.turns} turns`, ...(isLatest ? ['latest'] : [])].join(' · ')
            : sessionMeta(s, now, isLatest ? 'latest' : '')
          : ''
      const lines = wrap2(title, isTight ? 17 : 22)
      const tip = withTooltips && s && !isYou ? `<title>${esc(s.title)}\n${esc(sessionMeta(s, now))}${noteText(s) ? `\n${esc(clip(noteText(s), 160))}` : ''}</title>` : ''
      const g: string[] = [`<g class="n hit" opacity="${op.toFixed(2)}">${tip}`]
      if (isLatest) g.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="21" fill="${rgba(color, 0.22)}"/>`)
      g.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="16" fill="${fill}" stroke="${ring}" stroke-width="2"${dash}/>`)
      g.push(`<text class="mono" x="${pt.x.toFixed(1)}" y="${(pt.y + 4.5).toFixed(1)}" font-size="12.5" font-weight="600" fill="${numColor}" text-anchor="middle">${i + 1}</text>`)
      if (s?.isPinned) g.push(`<text x="${(pt.x + 12).toFixed(1)}" y="${(pt.y - 10).toFixed(1)}" font-size="10" fill="${ACCENT}">★</text>`)
      const ty = pt.y + 32
      const labelColor = isYou ? ACCENT : isSel ? TEXT : status === 'archived' ? MUTED : LABEL
      g.push(`<text x="${pt.x.toFixed(1)}" y="${ty}" font-size="11.5" fill="${labelColor}" text-anchor="middle">${lines.map((l, k) => `<tspan x="${pt.x.toFixed(1)}" dy="${k === 0 ? 0 : 14}">${esc(l)}</tspan>`).join('')}</text>`)
      g.push(`<text class="mono" x="${pt.x.toFixed(1)}" y="${ty + lines.length * 14}" font-size="10.5" fill="${isLatest ? color : MUTED}" text-anchor="middle">${esc(clip(meta, isTight ? 27 : 34))}</text>`)
      g.push('</g>')
      parts.push(g.join(''))
    })
    const countLabel = `${steps.filter(s => !s.isYou).length} of ${focus.sessions.length}${view.me.topicId === focus.id ? ' · you' : ''}`
    const w = pillWidth(focus.name, countLabel)
    const x = FOCUS_PILL.x - w / 2
    const y = FOCUS_PILL.y - 19
    parts.push(
      `<rect x="${(x - 6).toFixed(1)}" y="${y - 6}" width="${(w + 12).toFixed(1)}" height="50" rx="25" fill="${rgba(color, 0.2)}"/>`,
      `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="38" rx="19" fill="#161B23" stroke="${color}" stroke-width="1.5"/>`,
      `<circle cx="${(x + 17).toFixed(1)}" cy="${FOCUS_PILL.y}" r="4" fill="${color}"/>`,
      `<text x="${(x + 28).toFixed(1)}" y="${FOCUS_PILL.y + 4.5}" font-size="13" font-weight="600" fill="${TEXT}">${esc(clip(focus.name, 28))}</text>`,
      `<text class="mono" x="${(x + w - 14).toFixed(1)}" y="${FOCUS_PILL.y + 4}" font-size="11" font-weight="500" fill="${color}" text-anchor="end">${esc(countLabel)}</text>`,
    )
    if (focus.goal) {
      parts.push(`<text x="${FOCUS_PILL.x}" y="408" font-size="11.5" fill="${LABEL}" text-anchor="middle"><tspan class="mono" fill="${MUTED}">GOAL</tspan>  ${esc(clip(focus.goal, 96))}</text>`)
    }
    if (steps.length === 0) {
      parts.push(`<text x="430" y="262" font-size="12.5" fill="${MUTED}" text-anchor="middle">No sessions in the time range. Widen the range, or pin one.</text>`)
    }
    if (view.settings.showRelated) {
      const rel = relatedOf(model.links, focus.id)
      const apos = anchorPositions(rel.length)
      rel.forEach((r, i) => {
        const rt = model.topicById[r.id]
        const ap = apos[i]
        if (!rt || !ap) return
        const label = `${clip(rt.name, 20)}  ${clip(r.via, 18)}`
        const aw = 40 + label.length * 6.4
        parts.push(
          `<g class="hit" opacity="0.85"><rect x="${(ap.x - aw / 2).toFixed(1)}" y="${ANCHOR_Y - 16}" width="${aw.toFixed(1)}" height="32" rx="16" fill="rgba(22,27,35,0.9)" stroke="${rt.color}" stroke-width="1" stroke-dasharray="4 3"/>`,
          `<circle cx="${(ap.x - aw / 2 + 15).toFixed(1)}" cy="${ANCHOR_Y}" r="3.5" fill="${rt.color}"/>`,
          `<text x="${(ap.x - aw / 2 + 25).toFixed(1)}" y="${ANCHOR_Y + 4}" font-size="12" fill="${LABEL}">${esc(clip(rt.name, 20))} <tspan class="mono" font-size="10.5" fill="${MUTED}">${esc(clip(r.via, 18))}</tspan></text></g>`,
        )
      })
    }
    parts.push(
      `<g class="hit"><rect x="14" y="12" width="96" height="30" rx="15" fill="rgba(16,20,26,0.9)" stroke="#2A3240"/><text x="30" y="31" font-size="12" fill="${LABEL}">‹ All topics</text></g>`,
    )
  }

  const hint = hintOf(view)
  const hw = 24 + hint.length * 6.3
  parts.push(
    `<rect x="${(FIELD_W / 2 - hw / 2).toFixed(1)}" y="14" width="${hw.toFixed(1)}" height="30" rx="15" fill="rgba(16,20,26,0.9)" stroke="#2A3240"/>`,
    `<text x="${FIELD_W / 2}" y="33" font-size="12" fill="${LABEL}" text-anchor="middle">${esc(hint)}</text>`,
  )
  const ly = FIELD_H - 16
  parts.push(
    `<g font-size="11" fill="${MUTED}">`,
    `<circle cx="20" cy="${ly - 4}" r="4" fill="${ACCENT}"/><text x="29" y="${ly}">active</text>`,
    `<circle cx="78" cy="${ly - 4}" r="4" fill="none" stroke="${MUTED}" stroke-width="1.5"/><text x="87" y="${ly}">idle</text>`,
    `<circle cx="124" cy="${ly - 4}" r="4" fill="none" stroke="${DIM}" stroke-width="1.5" stroke-dasharray="2 2"/><text x="133" y="${ly}">shipped</text>`,
    `<text x="186" y="${ly}" fill="${ACCENT}">★</text><text x="199" y="${ly}">pinned</text>`,
    `</g>`,
  )
  parts.push(`<rect x="0.5" y="0.5" width="${FIELD_W - 1}" height="${FIELD_H - 1}" rx="16" fill="none" stroke="${BORDER}"/>`)
  parts.push('</g></svg>')
  parts[styleAt] = `<style>${css.join('')}</style>`
  const svg = parts.join('')
  if (svg.length > SVG_CAP) {
    if (withTooltips) return svgOf(view, { withTooltips: false, maxSessions })
    if (maxSessions > 12) return svgOf(view, { withTooltips: false, maxSessions: 12 })
    return svg.slice(0, SVG_CAP)
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
}

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7d' },
  { value: '14', label: 'Last 14d' },
  { value: '30', label: 'Last 30d' },
  { value: String(ALL_TIME_DAYS), label: 'All time' },
]

const COLOR_OPTIONS = PALETTE.map((hex, i) => ({ value: hex, label: ['Amber', 'Violet', 'Mint', 'Sky', 'Rose'][i] ?? hex }))

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
      <Box flexDirection="row" alignItems="center" gap="sm" flexWrap="wrap">
        <Box flexDirection="column">
          <Text weight="semibold" mono>
            CONSTELLATION
          </Text>
          <Text dimColor size="footnote" wrap="truncate">
            {crumbOf(view)}
          </Text>
        </Box>
        {Input ? <Input key="q" placeholder="Search sessions, notes, files" value={ui.query} submitLabel="search" onInput={v => act.setQuery(v)} onSubmit={v => act.setQuery(v)} /> : null}
        {Select ? <Select key="range" options={RANGE_OPTIONS} value={String(view.settings.rangeDays)} onSelect={v => act.setRange(Number(v))} /> : null}
        <Button key="view:map" label="Map" hotkey="m" variant={ui.view === 'map' ? 'primary' : 'secondary'} onPress={() => act.setView('map')} />
        <Button key="view:list" label="List" hotkey="l" variant={ui.view === 'list' ? 'primary' : 'secondary'} onPress={() => act.setView('list')} />
        <Button key="settings" label={ui.showSettings ? 'Done' : 'Settings'} hotkey="s" onPress={() => act.toggleSettings()} />
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
        <Button key="back" label="‹ All topics" hotkey="b" onPress={() => act.back()} />
        {steps.map((s, i) => (
          <Button
            key={`s:${s.id}`}
            hotkey={i < 9 ? String(i + 1) : undefined}
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

function statusGlyph(s: SessionView): string {
  return s.status === 'active' ? '●' : s.status === 'archived' ? '◌' : '○'
}

/** The outline: every surface's list view and the terminal's map. */
export function drawList(T: Table, view: View, act: Actions): RenderElement {
  const { Box, Text, Button } = T
  const { model, ui, now } = view
  const query = ui.query
  const topics = model.topics.filter(t => topicMatches(query, t))
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
                {`${t.id === UNSORTED_ID ? 'unsorted' : t.isMajor ? 'major' : 'minor'} · ${t.sessions.length} session${t.sessions.length === 1 ? '' : 's'}${t.sessions.length ? ` · ${ageOf(t.lastAt, now)} ago` : ''}${view.me.topicId === t.id ? ' · you' : ''} ${isOpen ? '▾' : '▸'}`}
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
                hotkey={i < 9 ? String(i + 1) : undefined}
                variant={ui.selected === s.id ? 'primary' : undefined}
                onPress={() => (s.isYou ? act.selectSession(null) : act.selectSession(ui.selected === s.id ? null : s.id))}
              >
                <Text color={t.color} mono>
                  {String(i + 1)}
                </Text>{' '}
                {s.isYou ? <Text color={ACCENT}>◆ This session · you</Text> : `${statusGlyph(s.session as SessionView)} ${clip(s.session?.title ?? '', 48)}`}{' '}
                <Text dimColor mono>
                  {s.isYou ? 'now' : ageOf(s.session?.lastAt ?? now, now)}
                  {s.session?.isPinned ? ' ★' : ''}
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

const SETTING_ROWS: { key: keyof MapSettings; label: string; help: string; options: { value: string | number | boolean; label: string }[] }[] = [
  { key: 'scope', label: 'Scope', help: 'which transcripts the map reads', options: [{ value: 'folder', label: 'This folder' }, { value: 'all', label: 'Every folder' }] },
  { key: 'groupBasis', label: 'Grouping', help: 'how unassigned sessions find a topic', options: [{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }] },
  { key: 'majorRule', label: 'Major topic rule', help: 'what gets a labelled pill', options: [{ value: 'either', label: 'Either' }, { value: 'count', label: 'Count' }, { value: 'recent', label: 'Recent' }] },
  { key: 'majorMinSessions', label: 'Count threshold', help: 'sessions to count as major', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 5, label: '5' }] },
  { key: 'recentDays', label: 'Recent days', help: 'activity that keeps a topic major', options: [{ value: 3, label: '3d' }, { value: 7, label: '7d' }, { value: 14, label: '14d' }, { value: 30, label: '30d' }] },
  { key: 'numbering', label: 'Numbering in focus', help: 'order of the chain', options: [{ value: 'oldestFirst', label: 'Oldest first' }, { value: 'newestFirst', label: 'Newest first' }] },
  { key: 'showRelated', label: 'Related anchors', help: 'linked topics at the bottom', options: [{ value: true, label: 'Show' }, { value: false, label: 'Hide' }] },
  { key: 'handoffNotes', label: 'Handoff notes', help: 'how a session gets its note', options: [{ value: 'manual', label: 'Manual /park' }, { value: 'auto', label: 'Auto (haiku)' }, { value: 'ask', label: 'Ask after a turn' }] },
  { key: 'autoJoin', label: 'Auto join', help: 'after the first prompt', options: [{ value: 'suggest', label: 'Suggest' }, { value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }] },
  { key: 'useModelForTitles', label: 'Topic names', help: 'name auto topics with haiku', options: [{ value: false, label: 'Frequent words' }, { value: true, label: 'Model' }] },
  { key: 'openOnStart', label: 'On session start', help: 'what shows when a session begins', options: [{ value: 'band', label: 'Band' }, { value: 'pane', label: 'Pane' }, { value: 'none', label: 'Nothing' }] },
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
  return (
    <Box flexDirection="column" gap="xs" borderStyle="round" borderColor={CARD_BORDER} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text dimColor mono size="footnote">
          SETTINGS · changes apply to the map above and are saved
        </Text>
        <Button key="settings:done" label="Done" onPress={() => act.toggleSettings()} />
      </Box>
      {SETTING_ROWS.map((row, n) => (
        <Box key={`set:${row.key}`} flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
          <Text dimColor mono size="footnote">
            {String(n + 1).padStart(2, '0')}
          </Text>
          <Text>
            {row.label} <Text dimColor>{row.help}</Text>
          </Text>
          {row.options.map(o => {
            const isOn = view.settings[row.key] === o.value
            return <Button key={`set:${row.key}:${String(o.value)}`} label={o.label} variant={isOn ? 'primary' : 'secondary'} dimColor={!isOn} onPress={() => act.setSetting(row.key, o.value)} />
          })}
        </Box>
      ))}
      <Text dimColor size="footnote">
        {usageLine(view.usage, view.settings)}
      </Text>
    </Box>
  )
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
  if (where === 'pane') {
    rows.push(
      <Text dimColor size="footnote">
        This folder holds every topic below. The suggestion comes from matching your first prompt against each topic's titles, goal, notes and files. Confirm it or pick another.
      </Text>,
    )
  }
  rows.push(
    <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
      {ranked.map((t, i) => {
        const latest = latestOf(t.sessions)
        return (
          <Button key={`j:${t.id}`} hotkey={i < 9 ? String(i + 1) : undefined} variant={me.suggested === t.id ? 'primary' : undefined} onPress={() => act.join(t.id)}>
            <Text color={t.color}>●</Text> {clip(t.name, 26)}{' '}
            <Text dimColor mono>{`${t.sessions.length}${latest ? ` · ${ageOf(latest.lastAt, view.now)} ago` : ''}`}</Text>
            {me.suggested === t.id ? <Text color={ACCENT}> SUGGESTED</Text> : ''}
          </Button>
        )
      })}
      <Button key="j:new" label="+ New topic" hotkey="n" onPress={() => act.newTopic()} />
      {where === 'band' ? <Button key="j:dismiss" label="Dismiss" role="dismiss" onPress={() => act.dismissBand()} /> : null}
    </Box>,
  )
  rows.push(
    <Text dimColor size="footnote">
      {where === 'pane'
        ? "Choosing a topic makes this session its next numbered step and adds that topic's goal and latest handoff note to your next prompt. Nothing is chosen for you unless auto-join is on."
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
      {topic ? <Button key="c:focus" label="Focus my topic" hotkey="f" variant="primary" onPress={() => act.focusTopic(topic.id)} /> : null}
      {latest ? <Button key="c:draft" label="Draft next prompt" hotkey="d" onPress={() => act.draft(null)} /> : null}
      <Button key="c:change" label="Change topic" hotkey="c" onPress={() => act.changeTopic()} />
      {!me.askNote ? <Button key="c:park" label="Park a note" hotkey="p" onPress={() => act.parkPrompt()} /> : null}
    </Box>,
    <Text dimColor size="footnote">
      Hover or Tab onto a topic to trace it, Enter or click to focus. Select a session, then Move to topic, to move it.
    </Text>,
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
      <Button key="tc:focus" label={isFocused ? 'Back to all topics' : 'Focus this topic'} hotkey="f" variant="primary" onPress={() => (isFocused ? act.back() : act.focusTopic(topic.id))} />
      {latest ? <Button key="tc:pickup" label="Pick up latest" hotkey="u" onPress={() => act.pickUpLatest(topic.id)} /> : null}
      {view.me.topicId !== topic.id && !isUnsorted ? <Button key="tc:join" label="Join this topic" hotkey="j" onPress={() => act.join(topic.id)} /> : null}
      <Button key="tc:tidy" label={tidyTargets.length ? `Archive ${tidyTargets.length} idle` : 'Nothing to tidy'} dimColor={tidyTargets.length === 0} onPress={() => act.tidy(topic.id)} />
    </Box>,
    !isUnsorted ? (
      <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
        {Input ? <Button key="tc:rename" label="Rename" hotkey="r" onPress={() => act.edit(ui.editing === 'rename' ? null : 'rename')} /> : null}
        {Input ? <Button key="tc:goal" label={topic.goal ? 'Edit goal' : 'Set goal'} hotkey="g" onPress={() => act.edit(ui.editing === 'goal' ? null : 'goal')} /> : null}
        <Button key="tc:merge" label="Merge into…" hotkey="e" onPress={() => act.mergeMode(topic.id)} />
        {Select ? <Select key={`color:${topic.id}`} label="Colour" options={COLOR_OPTIONS} value={PALETTE.includes(topic.color as (typeof PALETTE)[number]) ? topic.color : undefined} onSelect={hex => act.setColor(topic.id, hex)} /> : null}
      </Box>
    ) : null,
    <Text dimColor size="footnote">
      {isFocused ? 'Numbers follow time order. The glowing number is the latest session.' : 'Focus the topic to see its sessions in order.'}
    </Text>,
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
      <Button key="sc:pickup" label="Pick up here" hotkey="u" variant="primary" onPress={() => act.pickUp(s.id)} />
      <Button key="sc:draft" label="Draft prompt" hotkey="d" onPress={() => act.draft(s.id)} />
      {Input ? <Button key="sc:message" label="Message" hotkey="t" onPress={() => act.messageMode(!ui.messageMode)} /> : null}
      <Button key="sc:new" label="New session from here" hotkey="n" onPress={() => act.newSession(s.id)} />
      <Button key="sc:pin" label={s.isPinned ? 'Unpin' : 'Pin'} hotkey="p" onPress={() => act.pin(s.id)} />
      <Button key="sc:move" label={ui.moveMode ? 'Cancel move' : 'Move to topic'} hotkey="v" onPress={() => act.moveMode(!ui.moveMode)} />
      <Button key="sc:archive" label={s.status === 'archived' ? 'Unarchive' : 'Archive'} hotkey="x" onPress={() => act.archive(s.id)} />
    </Box>,
  )
  return card(T, rows, ui.selected === s.id ? rgba(color, 0.45) : CARD_BORDER)
}

export function drawToast(T: Table, view: View, act: Actions): RenderElement | null {
  const { Box, Text, Button } = T
  const toast = view.ui.toast
  if (!toast) return null
  return (
    <Box flexDirection="row" gap="sm" alignItems="center" borderStyle="round" borderColor="#5FD3A6" paddingX={1}>
      <Text color="#5FD3A6">✓</Text>
      <Text>{toast.text}</Text>
      {toast.hasUndo ? <Button key="toast:undo" label="Undo" hotkey="z" onPress={() => act.undo()} /> : null}
      <Button key="toast:dismiss" label="Dismiss" plain onPress={() => act.dismissToast()} />
    </Box>
  )
}

/** The card under the field, by state: settings, a session, a topic, the chooser or the joined card. */
export function drawCard(T: Table, view: View, act: Actions): RenderElement {
  const { model, ui, me } = view
  if (ui.showSettings) return drawSettings(T, view, act)
  const sel = ui.selected ? model.byId[ui.selected] : undefined
  if (sel) return drawSessionCard(T, view, act, sel)
  const topic = ui.focusTopic ? model.topicById[ui.focusTopic] : ui.hover ? model.topicById[ui.hover] : undefined
  if (topic) return drawTopicCard(T, view, act, topic)
  if (me.topicId === null && !me.isNewTopic) return drawChooser(T, view, act, 'pane')
  return drawJoinedCard(T, view, act)
}

/** The pane: header, the field (Svg where the surface has it, else the outline), its controls, the card and the toast. */
export function drawPane(T: Table, view: View, act: Actions, field?: RenderElement): RenderElement {
  const { Box, Text, Svg } = T
  const { ui } = view
  const isSvgMap = ui.view === 'map' && Svg !== undefined
  const isClientMap = ui.view === 'map' && Svg === undefined && field !== undefined
  const toast = drawToast(T, view, act)
  return (
    <Box flexDirection="column" gap="xs">
      {drawHeader(T, view, act)}
      {isSvgMap && Svg ? <Svg source={svgOf(view)} alt={altOf(view)} isInteractive /> : null}
      {isClientMap ? field : null}
      {isSvgMap || isClientMap ? drawControls(T, view, act) : drawList(T, view, act)}
      {!Svg && ui.view === 'map' && !field ? (
        <Text dimColor size="footnote">
          This surface draws no vector field: the outline above is the map. Hotkeys 1–9 select a step.
        </Text>
      ) : null}
      {drawCard(T, view, act)}
      {toast}
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
  kind: 'topic' | 'session' | 'step' | 'you'
  x: number
  y: number
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
}

export type FieldProps = {
  mode: 'map' | 'focus'
  hint: string
  nodes: FieldNode[]
  links: { x1: number; y1: number; x2: number; y2: number }[]
  legend: string
}

/** A node with its undefined keys dropped: a Client's props hold no undefined. */
function node(n: FieldNode): FieldNode {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(n)) if (v !== undefined) out[k] = v
  return out as FieldNode
}

/** The field as plain data for the Client module: the same positions the Svg uses. */
export function fieldOf(view: View): FieldProps {
  const { model, ui, placed } = view
  const focus = ui.focusTopic ? model.topicById[ui.focusTopic] : undefined
  const nodes: FieldNode[] = []
  const links: FieldProps['links'] = []
  const legend = '● active  ○ idle  ◌ shipped  ◆ you'
  if (!focus) {
    const traced = ui.hover
    for (const t of model.topics) {
      const p = placed[t.id]
      if (!p) continue
      const isDim = (traced !== null && traced !== t.id) || !topicMatches(ui.query, t)
      const countLabel = ui.query.trim() ? `${t.sessions.filter(s => matches(ui.query, s)).length} match` : `${t.sessions.length}${view.me.topicId === t.id ? ' · you' : ''}`
      nodes.push(node({ id: t.id, kind: 'topic', x: p.x, y: p.y, label: `${clip(t.name, 24)} ${countLabel}`, color: t.color, isMajor: t.isMajor, isDim, isSelected: false, title: t.name }))
      const half = t.isMajor ? pillWidth(t.name, countLabel) / 2 : undefined
      t.sessions.slice(0, 40).forEach((s, k) => {
        const sp = satellitePosition(p, t.id, k, t.isMajor, half)
        nodes.push(node({ id: s.id, kind: 'session', x: sp.x, y: sp.y, label: '', title: s.title, color: t.color, isDim: isDim || !s.isInRange || !matches(ui.query, s), isSelected: ui.selected === s.id, isArchived: s.status === 'archived', isActive: s.status === 'active', topicId: t.id }))
      })
    }
    for (const l of model.links) {
      const a = placed[l.a]
      const b = placed[l.b]
      if (a && b) links.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    }
  } else {
    const steps = chainOf(view, focus)
    const positions = chainPositions(steps.length)
    nodes.push(node({ id: focus.id, kind: 'topic', x: FOCUS_PILL.x, y: FOCUS_PILL.y, label: `${clip(focus.name, 24)} ${steps.filter(s => !s.isYou).length} of ${focus.sessions.length}`, color: focus.color, isMajor: true, title: focus.name }))
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
    if (view.settings.showRelated) {
      const rel = relatedOf(model.links, focus.id)
      const apos = anchorPositions(rel.length)
      rel.forEach((r, i) => {
        const rt = model.topicById[r.id]
        const ap = apos[i]
        if (rt && ap) nodes.push(node({ id: rt.id, kind: 'topic', x: ap.x, y: ap.y, label: `${clip(rt.name, 18)} ${r.via}`, color: rt.color, isMajor: false, isDim: true, title: rt.name }))
      })
    }
  }
  return { mode: focus ? 'focus' : 'map', hint: hintOf(view), nodes, links, legend }
}

export type { Point }
