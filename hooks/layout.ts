// Constellation: positions on the field.
//
// The field is 860 wide (narrower in a narrow pane, so its text stays legible
// there) and at least 520 tall; a crowded map grows taller rather than letting
// pills touch. Topics are packed into rows in hash order
// (so the picture is stable for one set of topics), each row's slack spread as
// gaps with a seeded jitter inside the slack, so no two boxes can overlap and
// every box stays inside the field. Sessions orbit their topic as satellites.
// Focus mode lays a topic's sessions out as a zigzag chain, a long one wrapped
// into more bands (the field grows taller for them).
export const FIELD_W = 860
export const FIELD_H = 520
export const GRID = 60
/** The focused topic's pill: centred across the field, at this y. */
export const FOCUS_PILL = { y: 92 }
export const ANCHOR_GAP = 230

export type Point = { x: number; y: number }
export type FieldSize = { w: number; h: number }
/** The base field: focus mode, and a map that needs no more room. */
export const BASE: FieldSize = { w: FIELD_W, h: FIELD_H }

/**
 * One cell of the Desktop's panes, measured on Claude Desktop 3.6556 (Windows,
 * 96 DPI): a 300 px picture spans 39 columns and six rows span 119 px. The
 * pointer layer's rows follow from it (client/map.js), and so does the field's
 * width in a narrow pane.
 */
export const DESKTOP_CELL = { w: 7.7, h: 19.8 }
/** The field's narrowest width: the focused chain, the hint and the back pill still fit. */
export const MIN_FIELD_W = 520

/**
 * The field's width for a pane `columns` cells wide. The picture is drawn at
 * the pane's width, so an 860-unit field in a 300 px pane draws 13 px text at
 * 4.5 px. Below about 83 columns the field narrows (to 520 at most) so its text
 * draws at 7 px or more from 42 columns (6.5 px at 39, where 520 is the floor);
 * a wider pane, or none known, gets the full 860.
 */
export function fieldWidthFor(columns?: number): number {
  const slotPx = slotWidthFor(columns)
  if (slotPx === undefined) return FIELD_W
  // Field units the slot may hold for 13-unit text to draw at about 9 px.
  const w = Math.round((slotPx * 1.45) / 20) * 20
  return Math.max(MIN_FIELD_W, Math.min(FIELD_W, w))
}

/** The picture's slot in a pane `columns` cells wide, in CSS px: the pane's body less its padding; none when unknown. */
export function slotWidthFor(columns?: number): number | undefined {
  if (!columns || !Number.isFinite(columns) || columns <= 0) return undefined
  return columns * DESKTOP_CELL.w - 40
}

/** The engine's bound on an Svg's width and height, in CSS px. */
export const SVG_MAX_PX = 4096

/**
 * The live picture's frame in CSS px. The Desktop draws an interactive Svg in
 * an iframe sized by the Svg's width and height alone, and an iframe has no
 * size of its own: unsized, it is as wide as its column and 150 px tall, and
 * the picture shrinks to fit inside. So the frame takes the size the Clicks
 * picture's image takes by itself: the field at the slot's width (never wider
 * than its own), at the field's aspect, within the engine's bound.
 */
export function frameSize(size: FieldSize, columns?: number): { width: number; height: number } {
  const slot = slotWidthFor(columns) ?? size.w
  const width = Math.max(1, Math.floor(Math.min(size.w, slot)))
  const height = Math.max(1, Math.round((width * size.h) / size.w))
  if (height <= SVG_MAX_PX) return { width, height }
  return { width: Math.max(1, Math.floor((SVG_MAX_PX * size.w) / size.h)), height: SVG_MAX_PX }
}

/** A focused topic's field: as wide as the map's, the base height, and a band taller for each band a chain of `steps` wraps into. */
export function focusSize(map: FieldSize, steps = 0): FieldSize {
  return { w: map.w, h: FIELD_H + (chainBands(steps, map.w) - 1) * CHAIN_BAND_PITCH }
}
/**
 * A topic's place: its anchor (the pill's centre, or a minor topic's dot), its
 * box (the drawn unit and the halo its satellites orbit in), the box's
 * horizontal offset from the anchor (a minor label hangs right of its dot, so
 * its unit and box centre lie right of the dot), and the drawn unit's width.
 */
export type PlacedTopic = Point & { id: string; w: number; h: number; ox: number; uw: number; isMajor: boolean }
/** What the placement needs of a topic: the count label is part of the drawn pill, so it is part of the box. */
export type TopicSpec = { id: string; name: string; isMajor: boolean; count?: string }
export type Placement = { placed: PlacedTopic[]; size: FieldSize }

/** FNV-1a over UTF-16 code units, 32-bit unsigned. */
export function hashOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** A seed angle in [0, 2π) from an id. */
export function seedAngle(id: string): number {
  return ((hashOf(`angle:${id}`) % 10000) / 10000) * Math.PI * 2
}

/** The width of a major topic's pill as the field draws it: a dot, the name (28 characters at most) and its count label. */
export function pillWidth(name: string, count: string): number {
  return 50 + Math.min(name.length, 28) * 7.9 + count.length * 6.8
}

/** A minor topic's dot and glow reach this far left of its centre; its label starts this far right. */
const DOT_LEFT = 11
const LABEL_AT = 16
/** A minor label's monospace advance at 11.5px. */
const MONO_ADVANCE = 6.9

/** The drawn unit's width: the pill, or a minor topic's dot, label and count. */
export function unitWidth(name: string, isMajor: boolean, count = ''): number {
  if (isMajor) return pillWidth(name, count)
  return DOT_LEFT + LABEL_AT + (Math.min(name.length, 24) + (count ? count.length + 1 : 0)) * MONO_ADVANCE
}

/**
 * The halo around a unit that its satellites orbit in: as far beyond the unit
 * as the outermost satellite band reaches, its dot and halo included. The
 * layout keeps halos apart, so no satellite lands on another topic or on the
 * hint at the top.
 */
const HALO = { major: { x: 36, y: 54 }, minor: { x: 40, y: 44 } }

/** A topic's box on the map: its drawn unit (the pill, or a dot with its label and count) and the halo its satellites orbit in. */
export function topicBox(name: string, isMajor: boolean, count = ''): { w: number; h: number } {
  const halo = isMajor ? HALO.major : HALO.minor
  return { w: unitWidth(name, isMajor, count) + 2 * halo.x, h: 2 * halo.y }
}

const PAD_X = 20
/** Under the hint pill at the top (which ends at 44). */
const TOP_Y = 52
/** The legend row at the bottom. */
const BOTTOM_PAD = 44
/** Room between halos: the halos themselves keep the pills apart. */
export const GAP_X = 10
export const GAP_Y = 10
/** The engine draws an Svg up to 4096 px; past this, rows close up rather than run off the picture. */
const MAX_H = 4000

/**
 * Places topics: boxes packed into rows in hash order, the field grown as
 * tall as the rows need (never below the base height), spare height spread
 * between the rows, each row's slack spread as even gaps, and a seeded jitter
 * inside those gaps. Deterministic, and no two boxes can overlap.
 */
export function placeTopics(topics: ReadonlyArray<TopicSpec>, width: number = FIELD_W): Placement {
  const fieldW = Math.max(MIN_FIELD_W, Math.min(FIELD_W, width))
  const usableW = fieldW - 2 * PAD_X
  type Item = { t: TopicSpec; w: number; h: number }
  const items: Item[] = [...topics]
    .sort((a, b) => hashOf(a.id) - hashOf(b.id) || a.id.localeCompare(b.id))
    .map(t => {
      const box = topicBox(t.name, t.isMajor, t.count ?? '')
      return { t, w: Math.min(box.w, usableW), h: box.h }
    })
  const rows: Item[][] = []
  let row: Item[] = []
  let rowW = 0
  for (const it of items) {
    const need = rowW + (row.length ? GAP_X : 0) + it.w
    if (row.length && need > usableW) {
      rows.push(row)
      row = []
      rowW = 0
    }
    rowW += (row.length ? GAP_X : 0) + it.w
    row.push(it)
  }
  if (row.length) rows.push(row)
  const tallest = rows.map(r => r.reduce((m, it) => Math.max(m, it.h), 0))
  const contentH = tallest.reduce((a, t) => a + t + GAP_Y, 0)
  const h = Math.max(FIELD_H, Math.min(MAX_H, Math.ceil((TOP_Y + contentH + BOTTOM_PAD) / 20) * 20))
  const spareY = Math.max(0, h - TOP_Y - BOTTOM_PAD - contentH)
  const rowGap = rows.length ? spareY / (rows.length + 1) : 0
  // More rows than the tallest picture holds: they close up (halos overlap) rather than run off it.
  const squeeze = Math.min(1, (h - TOP_Y - BOTTOM_PAD) / Math.max(1, contentH))
  const byId = new Map<string, PlacedTopic>()
  let y = TOP_Y + rowGap
  rows.forEach((r, ri) => {
    const rowTall = (tallest[ri] ?? 0) * squeeze
    const used = r.reduce((a, it) => a + it.w, 0) + (r.length - 1) * GAP_X
    const share = Math.max(0, usableW - used) / (r.length + 1)
    let x = PAD_X + share
    for (const it of r) {
      const hsh = hashOf(it.t.id)
      // Jitter stays inside the gaps on either side, so boxes keep their clearance.
      const jx = ((hsh & 0xffff) / 0xffff - 0.5) * Math.min(share, 80) * 0.8
      // Vertical jitter only inside the row's spare room, so halos of neighbouring rows never meet.
      const jy = (((hsh >>> 16) & 0xffff) / 0xffff - 0.5) * Math.max(0, Math.min(rowGap, 40) - 4)
      const cx = x + it.w / 2 + jx
      const cy = y + rowTall / 2 + jy
      const uw = Math.min(unitWidth(it.t.name, it.t.isMajor, it.t.count ?? ''), usableW)
      // A minor topic's unit (and its box) is centred right of its dot, by half the unit less the dot's reach.
      const ox = it.t.isMajor ? 0 : uw / 2 - DOT_LEFT
      byId.set(it.t.id, { id: it.t.id, x: Math.round(cx - ox), y: Math.round(cy), w: it.w, h: it.h, ox: Math.round(ox), uw: Math.round(uw), isMajor: it.t.isMajor })
      x += it.w + GAP_X + share
    }
    y += rowTall + GAP_Y * squeeze + rowGap
  })
  const placed = topics.map(t => byId.get(t.id) ?? { id: t.id, x: fieldW / 2, y: FIELD_H / 2, w: 40, h: 30, ox: 0, uw: 40, isMajor: t.isMajor })
  return { placed, size: { w: fieldW, h } }
}

/** The centre of a topic's drawn unit (the pill's centre; for a minor topic, the middle of its dot and label). */
export function unitCentre(p: PlacedTopic): Point {
  return { x: p.x + p.ox, y: p.y }
}

/** A unit's half height: the pill with its stroke, or the minor dot's glow. */
const unitHalfHeight = (p: PlacedTopic): number => (p.isMajor ? 21 : 11)

/**
 * Where a line from the unit's centre towards `to` leaves the unit (a little
 * outside its edge), so a spoke never crosses the topic's own label.
 */
export function unitEdge(p: PlacedTopic, to: Point): Point {
  const c = unitCentre(p)
  const dx = to.x - c.x
  const dy = to.y - c.y
  const hw = p.uw / 2 + 3
  const hh = unitHalfHeight(p) + 3
  const t = Math.min(dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx), dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy))
  if (!Number.isFinite(t) || t >= 1) return to
  return { x: c.x + dx * t, y: c.y + dy * t }
}

/**
 * The i-th satellite of a topic: on an ellipse around the whole drawn unit (so
 * a minor topic's satellites clear its label too), in one of three bands
 * picked by i, at the seed angle plus i golden-angle turns. The bands stay
 * inside the topic's halo, which the layout keeps clear. Kept on the field,
 * under the hint at the top.
 */
export function satellitePosition(p: PlacedTopic, i: number, size: FieldSize = BASE): Point {
  const c = unitCentre(p)
  const a = seedAngle(p.id) + i * 2.399
  const band = (i * 37) % 3
  const rx = p.uw / 2 + (p.isMajor ? 10 + band * 7 : 12 + band * 8)
  const ry = p.isMajor ? 28 + band * 7 : 20 + band * 6
  let dx = rx * Math.cos(a)
  let dy = ry * Math.sin(a)
  // An ellipse cuts a rectangle's corners: a point that falls within 8 of the unit is pushed out along its own direction.
  const mx = p.uw / 2 + (p.isMajor ? 8 : 12)
  const my = unitHalfHeight(p) + 8
  if (Math.abs(dx) < mx && Math.abs(dy) < my) {
    const t = Math.min(dx === 0 ? Number.POSITIVE_INFINITY : mx / Math.abs(dx), dy === 0 ? Number.POSITIVE_INFINITY : my / Math.abs(dy))
    dx *= t
    dy *= t
  }
  return {
    x: Math.min(size.w - 16, Math.max(16, c.x + dx)),
    y: Math.min(size.h - 16, Math.max(52, c.y + dy)),
  }
}

/** The two rows of a focused chain, as far apart as its labels need: the upper row's labels sit above it, the lower row's below. */
export function chainRows(size: FieldSize = BASE): { upper: number; lower: number } {
  const mid = Math.round(size.h * 0.57)
  return { upper: mid - 46, lower: mid + 46 }
}

/** A step circle is r 16 with a 2-unit stroke: two on one row keep at least this far apart, centre to centre. */
export const STEP_GAP = 34
/**
 * One band of a wrapped chain below the last: its two rows (92) and the room
 * between the lower row's labels and the next band's upper row's (63 each, and 8).
 */
export const CHAIN_BAND_PITCH = 226

/**
 * How many steps one band of a chain holds in a field `w` wide: as many as
 * keep `STEP_GAP` between the steps on a row, and even, so a band ends on its
 * lower row and the link to the next band runs clear of every circle.
 */
export function chainBandSize(w: number): number {
  const fit = Math.floor((2 * (w - 180)) / STEP_GAP) + 1
  return Math.max(2, fit - (fit % 2))
}

/** How many bands a chain of `n` steps takes in a field `w` wide (at least one). */
export function chainBands(n: number, w: number): number {
  return Math.max(1, Math.ceil(n / chainBandSize(w)))
}

/** Whether the i-th step of a chain sits on its band's upper row (its label above it) rather than its lower (the label below). */
export function isUpperStep(i: number, w: number): boolean {
  return (i % chainBandSize(w)) % 2 === 0
}

/** How far a label beside a band-to-band link keeps from it: clear of the line and its arrowhead. */
export const LINK_CLEAR = 8

/**
 * Where the i-th step of an `n`-step chain draws its label: 0 centred on it;
 * 1 or -1 to the right or left of it, outward, for the two steps at a band's
 * end that the link to the next band joins (it runs straight down between
 * them, through a centred label).
 */
export function labelSide(i: number, n: number, w: number): -1 | 0 | 1 {
  if (chainBands(n, w) < 2) return 0
  const per = chainBandSize(w)
  const band = Math.floor(i / per)
  const j = i % per
  // Band b ends on the right when b is even, on the left when odd; the next band starts under that end.
  if (j === per - 1 && i < n - 1) return band % 2 === 0 ? 1 : -1
  if (j === 0 && band > 0) return (band - 1) % 2 === 0 ? 1 : -1
  return 0
}

/**
 * The numbered steps of a focused chain: spread across the field, alternating
 * between the two rows. A chain too long for that (its circles would meet)
 * wraps: each band keeps `STEP_GAP` on a row and runs the other way from the
 * one above (left to right, then right to left), one `CHAIN_BAND_PITCH` lower,
 * in a field `focusSize` made taller for it.
 */
export function chainPositions(n: number, size: FieldSize = BASE): Point[] {
  const bands = chainBands(n, size.w)
  const { upper, lower } = chainRows({ w: size.w, h: size.h - (bands - 1) * CHAIN_BAND_PITCH })
  const out: Point[] = []
  if (bands === 1) {
    for (let i = 0; i < n; i += 1) {
      out.push({ x: n === 1 ? size.w / 2 : 90 + (i * (size.w - 180)) / (n - 1), y: i % 2 === 0 ? upper : lower })
    }
    return out
  }
  const per = chainBandSize(size.w)
  const dx = (size.w - 180) / (per - 1)
  for (let i = 0; i < n; i += 1) {
    const band = Math.floor(i / per)
    const j = i % per
    out.push({ x: band % 2 === 0 ? 90 + j * dx : size.w - 90 - j * dx, y: (j % 2 === 0 ? upper : lower) + band * CHAIN_BAND_PITCH })
  }
  return out
}

/**
 * How many characters a chain step's label line may hold before it reaches
 * its neighbour on the same row; 0 when there is too little room to label
 * every step (the picture then labels the latest, the selected and this
 * session, and the tooltips carry the rest).
 */
export function chainLabelChars(n: number, size: FieldSize = BASE): number {
  if (n <= 2) return 26
  const sameRow = (2 * (size.w - 180)) / (n - 1)
  const chars = Math.floor((sameRow - 12) / 6.4)
  return chars < 8 ? 0 : Math.min(24, chars)
}

/**
 * How many characters a chain step's meta line ("55m ago · 3 turns", mono at
 * 10.5: 6.3 units a character) may hold before it reaches the meta of its
 * neighbour on the same row. A narrow field's crowded chain gets fewer.
 */
export function chainMetaChars(n: number, size: FieldSize = BASE): number {
  if (n <= 2) return 34
  const sameRow = (2 * (size.w - 180)) / (n - 1)
  return Math.max(6, Math.min(34, Math.floor((sameRow - 10) / 6.3)))
}

/** The closest two labelled steps of a crowded chain may sit on one row: a whole age ("12h ago", 7 characters of meta) each, and 4 apart. */
export const CROWD_GAP = 49

/**
 * The labels a crowded chain draws (one that `chainLabelChars` cannot label
 * whole) and each one's room in characters. `priority` ranks each step (0: no
 * label wanted); the higher wins its row, and a lower one closer than
 * `CROWD_GAP` to a kept label on its row is dropped (its tooltip keeps it).
 * Each kept label takes the room to its nearest kept neighbour on its row, so
 * no two meet.
 */
export function crowdedLabels(priority: readonly number[], positions: readonly Point[]): Map<number, { title: number; meta: number }> {
  const wanted = positions.map((_, i) => i).filter(i => (priority[i] ?? 0) > 0)
  wanted.sort((a, b) => (priority[b] ?? 0) - (priority[a] ?? 0) || a - b)
  const kept: { i: number; p: Point }[] = []
  for (const i of wanted) {
    const p = positions[i]
    if (p && !kept.some(k => k.p.y === p.y && Math.abs(k.p.x - p.x) < CROWD_GAP)) kept.push({ i, p })
  }
  const out = new Map<number, { title: number; meta: number }>()
  for (const { i, p } of kept) {
    const d = Math.min(Infinity, ...kept.filter(k => k.i !== i && k.p.y === p.y).map(k => Math.abs(k.p.x - p.x)))
    out.set(i, { title: Math.max(5, Math.min(14, Math.floor((d - 4) / 6.4))), meta: Math.max(7, Math.min(18, Math.floor((d - 4) / 6.3))) })
  }
  return out
}

/** The related-topic anchors along the bottom of a focused chain. */
/** The narrowest room an anchor gets: its name, part of the shared file, and its dashed pill. */
export const ANCHOR_MIN_SLOT = 150

/**
 * The related anchors along the bottom of a focused chain: as many of `n` as
 * the field's width holds at `ANCHOR_MIN_SLOT` each, centred, `ANCHOR_GAP`
 * apart where there is room and closer where not. `slot` is each one's room:
 * an anchor drawn at most `slot - 12` wide never meets its neighbour or the
 * field's edge.
 */
export function anchorSlots(n: number, size: FieldSize = BASE): { positions: Point[]; slot: number } {
  const room = size.w - 40
  const count = Math.max(0, Math.min(n, Math.floor(room / ANCHOR_MIN_SLOT)))
  const slot = Math.min(ANCHOR_GAP, room / Math.max(1, count))
  const positions: Point[] = []
  for (let i = 0; i < count; i += 1) positions.push({ x: size.w / 2 + (i - (count - 1) / 2) * slot, y: size.h - 50 })
  return { positions, slot }
}

export function anchorPositions(n: number, size: FieldSize = BASE): Point[] {
  return anchorSlots(n, size).positions
}

/** Star dots for the field, as the prototype draws them: `count` points stepping across. */
export function starPath(count: number, step: number, offset: number, size: FieldSize = BASE): string {
  let p = ''
  for (let i = 0; i < count; i += 1) {
    const x = ((i * step + offset) % size.w).toFixed(1)
    const y = ((i * 97.3 + offset * 1.7 + 31) % size.h).toFixed(1)
    p += `M${x} ${y}l0.01 0`
  }
  return p
}
