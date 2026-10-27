// Constellation: the text-mode map and the pointer layer, one Client surface
// module. It takes the field the hooks module computed (topics, sessions and
// links in field units of fieldW x fieldH) and does one of two jobs:
//
// - On the terminal (which draws no Svg) it draws the map in its region of
//   cells and gives the terminal what the picture cannot: pointer hover
//   traces a topic, a click picks a topic or a session, and dragging a
//   session onto a topic moves it.
// - On the Desktop (`hits`), where the Svg is a picture that passes no click
//   on, it lies over the picture, draws nothing (or, with `outline`, its edge
//   and its readings, so the two can be matched up), and reports the same
//   hovers and picks in the picture's own units.
//
//   The Desktop gives a Client the width of its box (the picture's) and the
//   height of what it draws: a layer that drew six rows covered the top six
//   rows of an eighteen-row picture, and every click landed rows below where it
//   was aimed. So the layer draws the picture's own height, worked out from its
//   width in columns, the field's proportions and a cell's width-to-height
//   ratio (`cellAspect`, 0.39 for the Desktop's code font, fine-tuned by the
//   Layer height setting), and maps the pointer by the same measure.
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
// hits?, outline?, cellAspect? }.

const ACCENT = '#F2A33A'
/** A Desktop cell's width over its height: 7.7 px by 19.8 px, measured on Claude Desktop 3.6556 (hooks/layout.ts, DESKTOP_CELL). */
export const DESKTOP_ASPECT = 7.7 / 19.8
const MUTED = '#8B95A5'
const DIM = '#6F7988'

/** What the last render of each instance drew: the handlers are registered once and must hit-test the nodes of the latest props, not the first. */
const latest = new WeakMap()

/**
 * The pointer layer's grid over the picture (the Desktop). Columns are the
 * host's: the layer spans the picture's width. Rows are the layer's own: the
 * picture is `columns × fieldH / fieldW × cellAspect` rows tall, and the layer
 * draws that many (whole rows, so it never reaches past the picture onto the
 * buttons under it). A host that sizes the layer by its box instead reports
 * more rows than were drawn; its own count is the better measure then.
 */
export function layerFor(columns0, rows0, props) {
  const columns = columns0 > 0 ? columns0 : 100
  const fieldW = props.fieldW > 0 ? props.fieldW : 860
  const fieldH = props.fieldH > 0 ? props.fieldH : 520
  const aspect = props.cellAspect > 0 ? props.cellAspect : DESKTOP_ASPECT
  const exact = (columns * fieldH * aspect) / fieldW
  const drawn = Math.max(1, Math.floor(exact))
  const reported = rows0 > 0 ? rows0 : 0
  const byBox = reported > drawn + 1
  const span = byBox ? reported : exact
  return {
    columns,
    rows: drawn,
    reported,
    byBox,
    fieldW,
    fieldH,
    aspect,
    /** One cell in field units: how far a whole-cell pointer's position can lie from where it was aimed. */
    cell: { w: fieldW / columns, h: fieldH / span },
    col: x => Math.max(0, Math.min(columns - 1, Math.floor((x / fieldW) * columns))),
    row: y => Math.max(0, Math.min(drawn - 1, Math.floor((y / fieldH) * span))),
    fieldX: e => ((e.fine ? e.fine.x : e.x + 0.5) / columns) * fieldW,
    fieldY: e => ((e.fine ? e.fine.y : e.y + 0.5) / span) * fieldH,
  }
}

/**
 * The text map's cell grid over the field (the terminal). The map's rows span
 * the nodes, not the whole field: a tall field's empty top and bottom would
 * waste a pane's few rows. Row 0 holds the hint, the last row the legend.
 */
export function scaleFor(columns0, rows0, props) {
  if (props.hits === true) return layerFor(columns0, rows0, props)
  const columns = Math.max(20, columns0 || 100)
  const rows = Math.max(6, rows0 || 24)
  const fieldW = props.fieldW > 0 ? props.fieldW : 860
  const fieldH = props.fieldH > 0 ? props.fieldH : 520
  const ys = (Array.isArray(props.nodes) ? props.nodes : []).map(n => n.y).filter(Number.isFinite)
  let yLo = 0
  let span = fieldH
  if (ys.length > 0) {
    // Fit the nodes, but zoom in no further than 20 field units a row, or a few topics' satellites drift rows away from them.
    const lo = Math.max(0, Math.min(...ys) - 20)
    const hi = Math.min(fieldH, Math.max(...ys) + 20)
    span = Math.min(fieldH, Math.max(hi - lo, (rows - 3) * 20))
    yLo = Math.max(0, Math.min(fieldH - span, (lo + hi) / 2 - span / 2))
  }
  span = Math.max(1, span)
  return {
    columns,
    rows,
    fieldW,
    fieldH,
    col: x => Math.max(0, Math.min(columns - 1, Math.round((x / fieldW) * (columns - 1)))),
    row: y => Math.max(1, Math.min(rows - 2, Math.round(((y - yLo) / span) * (rows - 3)) + 1)),
    fieldX: e => ((e.fine ? e.fine.x : e.x) / Math.max(1, columns - 1)) * fieldW,
    fieldY: e => yLo + (((e.fine ? e.fine.y : e.y) - 1) / Math.max(1, rows - 3)) * span,
  }
}

function scale(surface, props) {
  return scaleFor(surface.columns, surface.rows, props)
}

/** A line cut to `room` cells with an ellipsis. */
export function fitText(text, room) {
  if (room <= 0) return ''
  return text.length <= room ? text : room >= 3 ? `${text.slice(0, room - 1)}…` : text.slice(0, room)
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
 * Where a node's text sits in the region: its glyph (a step's number, a dot)
 * at its own cell, always, and the label after it cut with an ellipsis where it
 * would run past the right edge (a wrapped label is unreadable). The hit test
 * counts the same cells.
 */
export function placeText(n, s, rowOffset = 0) {
  let text = textOf(n)
  const left = s.col(n.x)
  const room = s.columns - left
  if (text.length > room) text = room >= 3 ? `${text.slice(0, room - 1)}…` : text.slice(0, Math.max(1, room))
  return { left, top: Math.min(s.rows - 2, s.row(n.y) + rowOffset), text }
}

/** In focus mode the related anchors share one row in the field; on the text map they alternate rows so their labels fit. */
function anchorsOf(nodes, mode) {
  return mode === 'focus' ? nodes.filter(n => n.kind === 'topic' && n.isDim) : []
}

/**
 * Every node's text as the text map draws it: placed at its cell (see
 * placeText), then cut one cell short of the next node on its row that draws
 * at the same layer or above, so two steps' labels never run into each other.
 * A satellite's dot never cuts a topic's name: the name draws over it.
 */
export function layoutText(nodes, s, mode) {
  const anchors = anchorsOf(nodes, mode)
  const items = inDrawingOrder(nodes).map(n => {
    const i = anchors.indexOf(n)
    return { n, ...placeText(n, s, i >= 0 ? i % 2 : 0) }
  })
  const byRow = new Map()
  for (const it of items) byRow.set(it.top, [...(byRow.get(it.top) ?? []), it])
  for (const row of byRow.values()) {
    row.sort((a, b) => a.left - b.left)
    row.forEach((a, i) => {
      const layer = DRAW_ORDER[a.n.kind] ?? 0
      const next = row.slice(i + 1).find(b => b.left > a.left && (DRAW_ORDER[b.n.kind] ?? 0) >= layer)
      if (!next) return
      const room = next.left - a.left - 1
      if (a.text.length > room) a.text = room >= 3 ? `${a.text.slice(0, room - 1)}…` : a.text.slice(0, Math.max(1, room))
    })
  }
  return new Map(items.map(it => [it.n, { left: it.left, top: it.top, text: it.text }]))
}

/** The node whose drawn text is nearest the pointer on the text map, within two cells; labels count along their length. */
export function nodeAtCell(nodes, s, x, y, mode) {
  let best = null
  let bestD = 3
  const laid = layoutText(nodes, s, mode)
  // In drawing order, a later node winning a tie: where labels overlap, the one on top is the one under the pointer.
  for (const n of inDrawingOrder(nodes)) {
    const { left: c, top: r, text } = laid.get(n)
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
 * coarser than the picture. `cell`, where the pointer reports whole cells, is
 * one cell's size in field units, and `p` the cell's centre.
 */
export function nodeAtPoint(nodes, p, cell) {
  // Inside a topic's own drawn box (its pill, its dot and label, an anchor, the back pill) the box wins: a satellite's
  // generous slack must not take a press on the pill's edge. Only a press on a dot beats it: within 8 units of its
  // centre, or in the very cell its centre lies in (a whole-cell pointer can come no closer than that).
  const inside = nodes.find(n => isInsideDrawn(n, p))
  if (inside) {
    const halfW = cell ? cell.w / 2 : 0
    const halfH = cell ? cell.h / 2 : 0
    let dot = null
    let dotD = Number.POSITIVE_INFINITY
    for (const n of nodes) {
      if (n.kind !== 'session' && n.kind !== 'step') continue
      const d = Math.hypot(p.x - n.x, p.y - n.y)
      const onDot = d <= 8 || (Math.abs(p.x - n.x) <= halfW && Math.abs(p.y - n.y) <= halfH)
      if (onDot && d < dotD) {
        dot = n
        dotD = d
      }
    }
    return dot || inside
  }
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

/** Whether a point lies on a topic's or the back pill's box as the picture draws it. */
function isInsideDrawn(n, p) {
  if (n.kind === 'back') {
    const w = n.w > 0 ? n.w : 96
    return outside(p, n.x - w / 2, n.y - 15, n.x + w / 2, n.y + 15) === 0
  }
  if (n.kind !== 'topic') return false
  const w = n.w > 0 ? n.w : 60
  if (n.isAnchor) return outside(p, n.x - w / 2, n.y - 16, n.x + w / 2, n.y + 16) === 0
  if (n.isMajor) return outside(p, n.x - w / 2, n.y - 19, n.x + w / 2, n.y + 19) === 0
  // A minor topic: its dot's glow (11 to the left) and its label to the right.
  return outside(p, n.x - 11, n.y - 11, n.x + w, n.y + 11) === 0
}

function glyphOf(n) {
  if (n.kind === 'you') return '♦'
  if (n.kind === 'step') return String(n.label)
  if (n.kind === 'session') return n.isArchived ? '◦' : n.isActive ? '●' : '○'
  if (n.kind === 'back') return '‹'
  return n.isMajor ? '●' : '○'
}

function describe(e) {
  return `${e.type} at ${e.x},${e.y}${e.fine ? ` (${e.fine.x.toFixed(1)},${e.fine.y.toFixed(1)})` : ''}`
}

export default function ConstellationMap(props, surface) {
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
    return c.props.hits === true ? nodeAtPoint(c.nodes, { x: c.s.fieldX(e), y: c.s.fieldY(e) }, e.fine ? undefined : c.s.cell) : nodeAtCell(c.nodes, c.s, e.x, e.y, c.props.mode)
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
    // The picture's own height: the Desktop sizes the layer to what it draws.
    if (!props.outline) return Box({ flexDirection: 'column', width: '100%', height: s.rows, children: [] })
    // The outline: the layer's edge, its size and the last pointer event, a mark where the pointer was, and how to fit it.
    const host = s.byBox ? ` (the host's ${s.reported})` : ''
    const children = [
      Box({
        position: 'absolute',
        top: 0,
        left: 1,
        children: [Text({ color: ACCENT, wrap: 'truncate', children: `layer ${s.columns}×${s.rows}${host} · field ${s.fieldW}×${s.fieldH} · cell ${s.aspect.toFixed(2)} · ${state.last || 'no pointer yet'}` })],
      }),
      Box({ position: 'absolute', top: Math.max(1, s.rows - 1), left: 1, children: [Text({ color: ACCENT, wrap: 'truncate', children: 'this edge should meet the picture’s bottom; if not, Settings › Advanced › Layer height' })] }),
    ]
    if (state.at) children.push(Box({ position: 'absolute', top: Math.max(0, Math.min(s.rows - 1, state.at.y)), left: Math.max(0, Math.min(s.columns - 1, state.at.x)), children: [Text({ color: ACCENT, children: '+' })] }))
    return Box({ flexDirection: 'column', width: '100%', height: s.rows, borderStyle: 'round', borderColor: ACCENT, children })
  }

  const children = []
  // The hint on row 0, cut to the region's width: wrapped, its second line would run into the map's first row.
  const hint = fitText(String(props.hint || ''), s.columns - 2)
  children.push(Box({ position: 'absolute', top: 0, left: Math.max(0, Math.floor((s.columns - hint.length) / 2)), children: [Text({ dimColor: true, wrap: 'truncate', children: hint })] }))
  for (const l of links) {
    // One dim dot midway marks a link between topics; the text grid has no lines.
    children.push(Box({ position: 'absolute', top: s.row((l.y1 + l.y2) / 2), left: s.col((l.x1 + l.x2) / 2), children: [Text({ color: DIM, children: '·' })] }))
  }
  const laid = layoutText(nodes, s, props.mode)
  for (const n of inDrawingOrder(nodes)) {
    const isHover = state.hover !== null && (n.id === state.hover || n.topicId === state.hover)
    const color = n.isArchived ? DIM : n.color || ACCENT
    const { left, top, text } = laid.get(n)
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
  children.push(Box({ position: 'absolute', top: s.rows - 1, left: 0, children: [Text({ color: MUTED, children: String(props.legend || '● active  ○ idle  ◦ shipped  ♦ you') })] }))
  if (state.drag) {
    const d = nodes.find(n => n.id === state.drag)
    children.push(Box({ position: 'absolute', top: s.rows - 1, left: Math.max(0, s.columns - 40), children: [Text({ color: ACCENT, children: `moving “${String(d ? d.title || d.id : '').slice(0, 24)}”` })] }))
  }
  return Box({ flexDirection: 'column', width: '100%', height: s.rows, children })
}
