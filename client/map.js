// Constellation: the text-mode map, a Client surface module for the terminal
// (which draws no Svg). It takes the field the hooks module computed (topics,
// sessions and links in the 860x520 space), scales it to its region of cells,
// and gives the terminal what the picture cannot: pointer hover traces a
// topic, a click picks a topic or a session, dragging a session onto a topic
// moves it, and the arrow keys walk the topics or the chain. Everything it
// learns goes back to the hooks module as a post; the hooks answer by handing
// it fresh props.
//
// Props (JSON): { mode: 'map' | 'focus', hint, nodes: [{ id, kind, x, y, label,
// color, isMajor, isDim, isSelected, isTraced, isArchived, isActive, topicId }],
// links: [{ x1, y1, x2, y2 }], legend }.

const FIELD_W = 860
const FIELD_H = 520
const ACCENT = '#F2A33A'
const MUTED = '#8B95A5'
const DIM = '#6F7988'

function scale(surface) {
  const columns = Math.max(40, surface.columns || 100)
  const rows = Math.max(12, surface.rows || 24)
  return {
    columns,
    rows,
    col: x => Math.max(0, Math.min(columns - 1, Math.round((x / FIELD_W) * (columns - 1)))),
    row: y => Math.max(1, Math.min(rows - 2, Math.round((y / FIELD_H) * (rows - 3)) + 1)),
  }
}

/** The node whose cell is nearest the pointer, within two cells; labels count along their length. */
function nodeAt(nodes, s, x, y) {
  let best = null
  let bestD = 3
  for (const n of nodes) {
    const c = s.col(n.x)
    const r = s.row(n.y)
    const width = n.kind === 'topic' ? n.label.length + 2 : 1
    const dx = x < c ? c - x : x > c + width - 1 ? x - (c + width - 1) : 0
    const dy = Math.abs(y - r)
    const d = dx + dy * 2
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
  return n.isMajor ? '●' : '○'
}

export default function Map(props, surface) {
  const { Box, Text } = surface.elements
  const state = surface.state || { hover: null, drag: null, cursor: 0, pressed: null }
  const nodes = Array.isArray(props.nodes) ? props.nodes : []
  const links = Array.isArray(props.links) ? props.links : []
  const s = scale(surface)
  const topics = nodes.filter(n => n.kind === 'topic')
  const steps = nodes.filter(n => n.kind === 'step' || n.kind === 'you')
  const walk = props.mode === 'focus' ? steps : topics

  if (!surface.state) {
    surface.setState(state)
    surface.onPointer(e => {
      const st = surface.state || state
      const hit = nodeAt(nodes, s, e.x, e.y)
      if (e.type === 'move' || e.type === 'enter') {
        const hover = hit ? (hit.kind === 'session' || hit.kind === 'step' ? hit.topicId || hit.id : hit.id) : null
        if (hover !== st.hover) {
          surface.setState({ ...st, hover })
          surface.post({ type: 'hover', id: hover })
        }
        return
      }
      if (e.type === 'leave') {
        if (st.hover !== null || st.drag !== null) {
          surface.setState({ ...st, hover: null, drag: null })
          surface.post({ type: 'hover', id: null })
        }
        return
      }
      if (e.type === 'down') {
        surface.setState({ ...st, pressed: hit ? hit.id : null, drag: hit && hit.kind === 'session' ? hit.id : null })
        return
      }
      if (e.type === 'up') {
        const next = { ...st, pressed: null, drag: null }
        surface.setState(next)
        if (st.drag && hit && hit.kind === 'topic' && hit.id !== (nodes.find(n => n.id === st.drag) || {}).topicId) {
          surface.post({ type: 'drop', id: st.drag, targetId: hit.id })
        } else if (hit && hit.id === st.pressed) {
          surface.post({ type: 'pick', id: hit.id, kind: hit.kind })
        }
      }
    })
    surface.onKey(e => {
      const st = surface.state || state
      const list = (props.mode === 'focus' ? steps : topics)
      if (list.length === 0) return
      if (e.key === 'left' || e.key === 'up' || e.key === 'right' || e.key === 'down') {
        const dir = e.key === 'left' || e.key === 'up' ? -1 : 1
        const cursor = (st.cursor + dir + list.length) % list.length
        const target = list[cursor]
        surface.setState({ ...st, cursor })
        surface.post({ type: 'cursor', id: target.id, kind: target.kind })
        return
      }
      if (e.key === 'return') {
        const target = list[st.cursor % list.length]
        if (target) surface.post({ type: 'pick', id: target.id, kind: target.kind })
        return
      }
      if (e.key === 'backspace' || e.key === 'delete') surface.post({ type: 'back' })
    })
  }

  const children = []
  children.push(Box({ position: 'absolute', top: 0, left: Math.max(0, Math.floor((s.columns - String(props.hint || '').length) / 2)), children: [Text({ dimColor: true, children: String(props.hint || '') })] }))
  for (const l of links) {
    // One dim dot midway marks a link between topics; the text grid has no lines.
    children.push(Box({ position: 'absolute', top: s.row((l.y1 + l.y2) / 2), left: s.col((l.x1 + l.x2) / 2), children: [Text({ color: DIM, children: '┄' })] }))
  }
  for (const n of nodes) {
    const isHover = state.hover !== null && (n.id === state.hover || n.topicId === state.hover)
    const isCursor = walk[state.cursor % Math.max(1, walk.length)] && walk[state.cursor % walk.length].id === n.id
    const color = n.isArchived ? DIM : n.color || ACCENT
    const glyph = glyphOf(n)
    const label = n.kind === 'topic' ? `${glyph} ${n.label}` : n.kind === 'step' || n.kind === 'you' ? `${glyph} ${n.label2 || ''}`.trim() : glyph
    children.push(
      Box({
        position: 'absolute',
        top: s.row(n.y),
        left: s.col(n.x),
        children: [
          Text({
            color,
            dimColor: n.isDim && !isHover ? true : undefined,
            inverse: n.isSelected || isCursor ? true : undefined,
            weight: n.kind === 'topic' && n.isMajor ? 'semibold' : undefined,
            children: label,
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
