// Constellation: the text-mode map and the pointer layer, one Client surface
// module. It takes the field the hooks module computed (topics, sessions and
// links in field units of fieldW x fieldH) and does one of two jobs:
//
// - On the terminal (which draws no Svg) it draws the map in its region of
//   cells and gives the terminal what the picture cannot: pointer hover
//   traces a topic, a click picks a topic or a session, and dragging a
//   session onto a topic moves it.
// - On the Desktop (`hits`), where the Svg is a picture that passes no click
//   on, it lies over the picture at the same size, draws nothing (or, with
//   `outline`, its edge and its readings, so the two can be matched up), and
//   reports the same hovers and picks in the picture's own units.
//
// Everything it learns goes back to the hooks module as a post; the hooks
// answer by handing it fresh props.
//
// It takes no keys. A key listener would hold the keyboard after every click
// on the map (Escape alone gives it back), leaving the pane's hotkeys dead: a
// click on a step and then `u` would pick up nothing. The pane's own focus
// ring walks the topic buttons with Tab and the arrows, and traces as it goes,
// on every surface alike.
//
// Props (JSON): { mode: 'map' | 'focus', hint, nodes: [{ id, kind, x, y, w,
// label, label2, title, color, isMajor, isDim, isSelected, isArchived,
// isActive, topicId }], links: [{ x1, y1, x2, y2 }], legend, fieldW, fieldH,
// hits?, outline? }.

const ACCENT = '#F2A33A'
const MUTED = '#8B95A5'
const DIM = '#6F7988'

/** What the last render of each instance drew: the handlers are registered once and must hit-test the nodes of the latest props, not the first. */
const latest = new WeakMap()

function scale(surface, props) {
  const columns = Math.max(20, surface.columns || 100)
  const rows = Math.max(6, surface.rows || 24)
  const fieldW = props.fieldW > 0 ? props.fieldW : 860
  const fieldH = props.fieldH > 0 ? props.fieldH : 520
  const hits = props.hits === true
  return {
    columns,
    rows,
    fieldW,
    fieldH,
    // The text map keeps row 0 for the hint and the last row for the legend.
    col: x => Math.max(0, Math.min(columns - 1, Math.round((x / fieldW) * (columns - 1)))),
    row: y => Math.max(1, Math.min(rows - 2, Math.round((y / fieldH) * (rows - 3)) + 1)),
    // A pointer position back to field units: the whole region is the picture on the Desktop; the text grid elsewhere.
    fieldX: e => {
      const x = e.fine ? e.fine.x : e.x + 0.5
      return hits ? (x / columns) * fieldW : ((e.fine ? e.fine.x : e.x) / Math.max(1, columns - 1)) * fieldW
    },
    fieldY: e => {
      const y = e.fine ? e.fine.y : e.y + 0.5
      return hits ? (y / rows) * fieldH : ((e.fine ? e.fine.y : e.y) - 1) / Math.max(1, rows - 3) * fieldH
    },
  }
}

/** What the text map draws for a node: its glyph, with its label where one is drawn beside it (a topic's, a step's, the back pill's own). */
export function textOf(n) {
  if (n.kind === 'back') return String(n.label || '‹ All topics')
  const glyph = glyphOf(n)
  if (n.kind === 'topic') return `${glyph} ${n.label}`
  if (n.kind === 'step' || n.kind === 'you') return `${glyph} ${n.label2 || ''}`.trim()
  return glyph
}

/**
 * Where a node's text sits in the region: at its cell, pulled left where it
 * would run past the right edge (a wrapped label is unreadable), and cut with
 * an ellipsis where it still cannot fit. The hit test counts the same cells.
 */
export function placeText(n, s, rowOffset = 0) {
  let text = textOf(n)
  let left = s.col(n.x)
  if (left + text.length > s.columns) left = Math.max(0, s.columns - text.length)
  if (left + text.length > s.columns) text = text.slice(0, Math.max(1, s.columns - left - 1)) + '…'
  return { left, top: Math.min(s.rows - 2, s.row(n.y) + rowOffset), text }
}

/** In focus mode the related anchors share one row in the field; on the text map they alternate rows so their labels fit. */
function anchorsOf(nodes, mode) {
  return mode === 'focus' ? nodes.filter(n => n.kind === 'topic' && n.isDim) : []
}

/** The node whose drawn text is nearest the pointer on the text map, within two cells; labels count along their length. */
export function nodeAtCell(nodes, s, x, y, mode) {
  let best = null
  let bestD = 3
  const anchors = anchorsOf(nodes, mode)
  // In drawing order, a later node winning a tie: where labels overlap, the one on top is the one under the pointer.
  for (const n of inDrawingOrder(nodes)) {
    const anchorIndex = anchors.indexOf(n)
    const { left: c, top: r, text } = placeText(n, s, anchorIndex >= 0 ? anchorIndex % 2 : 0)
    const width = Math.max(1, text.length)
    const dx = x < c ? c - x : x > c + width - 1 ? x - (c + width - 1) : 0
    const dy = Math.abs(y - r)
    const d = dx + dy * 2
    if (d < 3 && (best === null || d <= bestD)) {
      bestD = d
      best = n
    }
  }
  return best
}

/** Sessions first, then steps, then topics, then the back pill, so a label is never overwritten by a glyph; the drawing and the hit test share it. */
const DRAW_ORDER = { session: 0, step: 1, you: 1, topic: 2, back: 3 }
function inDrawingOrder(nodes) {
  return [...nodes].sort((a, b) => (DRAW_ORDER[a.kind] ?? 0) - (DRAW_ORDER[b.kind] ?? 0))
}

/** How far a point is outside a box, 0 inside. */
function outside(p, left, top, right, bottom) {
  const dx = p.x < left ? left - p.x : p.x > right ? p.x - right : 0
  const dy = p.y < top ? top - p.y : p.y > bottom ? p.y - bottom : 0
  return Math.hypot(dx, dy)
}

/**
 * The node under a point of the picture, in field units, as the picture
 * draws it: a pill's rectangle, a dot's label, the back pill, a satellite's
 * or a step's circle. A little slack around each, since the layer's cells are
 * coarser than the picture. A satellite inside a pill's glow wins over the pill.
 */
function nodeAtPoint(nodes, p) {
  let best = null
  let bestD = Number.POSITIVE_INFINITY
  for (const n of nodes) {
    let d
    if (n.kind === 'topic') {
      // A pill (a major topic, or a related anchor) is centred on its point; a minor topic's label hangs right of its dot.
      const w = n.w > 0 ? n.w : 60
      const centred = n.isMajor || n.isAnchor
      const left = centred ? n.x - w / 2 : n.x - 14
      const right = centred ? n.x + w / 2 : n.x + w
      const half = n.isMajor ? 24 : 16
      d = outside(p, left, n.y - half, right, n.y + half)
      if (d > 14) continue
    } else if (n.kind === 'back') {
      const w = n.w > 0 ? n.w : 96
      d = outside(p, n.x - w / 2, n.y - 15, n.x + w / 2, n.y + 15)
      if (d > 10) continue
    } else {
      const r = n.kind === 'session' ? 16 : 26
      d = Math.hypot(p.x - n.x, p.y - n.y) - r
      if (d > 10) continue
    }
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return best
}

function glyphOf(n) {
  if (n.kind === 'you') return '◆'
  if (n.kind === 'step') return String(n.label)
  if (n.kind === 'session') return n.isArchived ? '◌' : n.isActive ? '●' : '○'
  if (n.kind === 'back') return '‹'
  return n.isMajor ? '●' : '○'
}

function describe(e) {
  return `${e.type} at ${e.x},${e.y}${e.fine ? ` (${e.fine.x.toFixed(1)},${e.fine.y.toFixed(1)})` : ''}`
}

export default function Map(props, surface) {
  const { Box, Text } = surface.elements
  const state = surface.state || { hover: null, drag: null, pressed: null, last: '', at: null }
  const nodes = Array.isArray(props.nodes) ? props.nodes : []
  const links = Array.isArray(props.links) ? props.links : []
  const s = scale(surface, props)
  const hits = props.hits === true
  latest.set(surface, { nodes, s, props })
  const current = () => latest.get(surface) || { nodes, s, props }
  const hitAt = e => {
    const c = current()
    return c.props.hits === true ? nodeAtPoint(c.nodes, { x: c.s.fieldX(e), y: c.s.fieldY(e) }) : nodeAtCell(c.nodes, c.s, e.x, e.y, c.props.mode)
  }

  if (!surface.state) {
    surface.setState(state)
    surface.onPointer(e => {
      const st = surface.state || state
      const { nodes, props } = current()
      const hit = hitAt(e)
      const seen = props.outline ? { last: describe(e), at: { x: e.x, y: e.y } } : {}
      if (e.type === 'move' || e.type === 'enter') {
        const hover = hit ? (hit.kind === 'session' || hit.kind === 'step' ? hit.topicId || hit.id : hit.kind === 'back' ? null : hit.id) : null
        if (hover !== st.hover || props.outline) {
          surface.setState({ ...st, ...seen, hover })
          if (hover !== st.hover) surface.post({ type: 'hover', id: hover })
        }
        return
      }
      if (e.type === 'leave') {
        if (st.hover !== null || st.drag !== null || props.outline) {
          surface.setState({ ...st, ...seen, hover: null, drag: null })
          if (st.hover !== null) surface.post({ type: 'hover', id: null })
        }
        return
      }
      if (e.type === 'down') {
        surface.setState({ ...st, ...seen, pressed: hit ? hit.id : null, drag: hit && hit.kind === 'session' ? hit.id : null })
        return
      }
      if (e.type === 'up') {
        const next = { ...st, ...seen, pressed: null, drag: null }
        surface.setState(next)
        if (st.drag && hit && hit.kind === 'topic' && hit.id !== (nodes.find(n => n.id === st.drag) || {}).topicId) {
          surface.post({ type: 'drop', id: st.drag, targetId: hit.id })
        } else if (hit && hit.id === st.pressed) {
          surface.post({ type: 'pick', id: hit.id, kind: hit.kind })
        }
      }
    })
  }

  if (hits) {
    if (!props.outline) return Box({ flexDirection: 'column', width: '100%', height: s.rows, children: [] })
    // The outline: the layer's edge, its size and the last pointer event, and a mark where the pointer was.
    const children = [
      Box({
        position: 'absolute',
        top: 0,
        left: 1,
        children: [Text({ color: ACCENT, children: `layer ${s.columns}×${s.rows} cells · field ${s.fieldW}×${s.fieldH} · ${state.last || 'no pointer event yet'}` })],
      }),
      Box({ position: 'absolute', top: s.rows - 1, left: 1, children: [Text({ color: ACCENT, children: 'this edge sits on the picture; if a click on the picture does nothing, set Clicks on the picture to Off and use the buttons under it' })] }),
    ]
    if (state.at) children.push(Box({ position: 'absolute', top: Math.max(0, Math.min(s.rows - 1, state.at.y)), left: Math.max(0, Math.min(s.columns - 1, state.at.x)), children: [Text({ color: ACCENT, children: '+' })] }))
    return Box({ flexDirection: 'column', width: '100%', height: s.rows, borderStyle: 'round', borderColor: ACCENT, children })
  }

  const children = []
  children.push(Box({ position: 'absolute', top: 0, left: Math.max(0, Math.floor((s.columns - String(props.hint || '').length) / 2)), children: [Text({ dimColor: true, children: String(props.hint || '') })] }))
  for (const l of links) {
    // One dim dot midway marks a link between topics; the text grid has no lines.
    children.push(Box({ position: 'absolute', top: s.row((l.y1 + l.y2) / 2), left: s.col((l.x1 + l.x2) / 2), children: [Text({ color: DIM, children: '┄' })] }))
  }
  const anchors = anchorsOf(nodes, props.mode)
  for (const n of inDrawingOrder(nodes)) {
    const anchorIndex = anchors.indexOf(n)
    const rowOffset = anchorIndex >= 0 ? anchorIndex % 2 : 0
    const isHover = state.hover !== null && (n.id === state.hover || n.topicId === state.hover)
    const color = n.isArchived ? DIM : n.color || ACCENT
    const { left, top, text } = placeText(n, s, rowOffset)
    children.push(
      Box({
        position: 'absolute',
        top,
        left,
        children: [
          Text({
            color,
            dimColor: n.isDim && !isHover ? true : undefined,
            inverse: n.isSelected ? true : undefined,
            weight: n.kind === 'topic' && n.isMajor ? 'semibold' : undefined,
            children: text,
          }),
        ],
      }),
    )
  }
  children.push(Box({ position: 'absolute', top: s.rows - 1, left: 0, children: [Text({ color: MUTED, children: String(props.legend || '● active  ○ idle  ◌ shipped  ★ pinned') })] }))
  if (state.drag) {
    const d = nodes.find(n => n.id === state.drag)
    children.push(Box({ position: 'absolute', top: s.rows - 1, left: Math.max(0, s.columns - 40), children: [Text({ color: ACCENT, children: `moving “${String(d ? d.title || d.id : '').slice(0, 24)}”` })] }))
  }
  return Box({ flexDirection: 'column', width: '100%', height: s.rows, children })
}
