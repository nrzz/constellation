// Constellation: positions on the field.
//
// The field is 860 wide and at least 520 tall; a crowded map grows taller
// rather than letting pills touch. Topics are packed into rows in hash order
// (so the picture is stable for one set of topics), each row's slack spread as
// gaps with a seeded jitter inside the slack, so no two boxes can overlap and
// every box stays inside the field. Sessions orbit their topic as satellites.
// Focus mode lays a topic's sessions out as a zigzag chain.
export const FIELD_W = 860
export const FIELD_H = 520
export const GRID = 60
export const FOCUS_PILL = { x: 430, y: 92 }
export const ANCHOR_GAP = 230
/** The y of the related anchors, in a field of the base height. */
export const ANCHOR_Y = 470

export type Point = { x: number; y: number }
export type FieldSize = { w: number; h: number }
/** The base field: focus mode, and a map that needs no more room. */
export const BASE: FieldSize = { w: FIELD_W, h: FIELD_H }
/** A topic's place: its anchor (pill centre or dot), its box, and the box's horizontal offset from the anchor (a minor label hangs right of its dot). */
export type PlacedTopic = Point & { id: string; w: number; h: number; ox: number }
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

/** A topic's box on the map, its satellites' orbit aside: the pill with its glow, or a dot with its label and count. */
export function topicBox(name: string, isMajor: boolean, count = ''): { w: number; h: number } {
  if (isMajor) return { w: pillWidth(name, count) + 12, h: 48 }
  return { w: 40 + Math.min(name.length, 24) * 6.9 + (count ? count.length * 6.9 + 6 : 0), h: 30 }
}

const PAD_X = 40
/** Under the hint pill at the top. */
const TOP_Y = 70
/** The legend row at the bottom. */
const BOTTOM_PAD = 56
/** Room between boxes for the satellites that orbit each pill. */
export const GAP_X = 56
export const GAP_Y = 52
const MAX_H = 1600

/**
 * Places topics: boxes packed into rows in hash order, the field grown as
 * tall as the rows need (never below the base height), spare height spread
 * between the rows, each row's slack spread as even gaps, and a seeded jitter
 * inside those gaps. Deterministic, and no two boxes can overlap.
 */
export function placeTopics(topics: ReadonlyArray<TopicSpec>): Placement {
  const usableW = FIELD_W - 2 * PAD_X
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
  const byId = new Map<string, PlacedTopic>()
  let y = TOP_Y + rowGap
  rows.forEach((r, ri) => {
    const rowTall = tallest[ri] ?? 0
    const used = r.reduce((a, it) => a + it.w, 0) + (r.length - 1) * GAP_X
    const share = Math.max(0, usableW - used) / (r.length + 1)
    let x = PAD_X + share
    for (const it of r) {
      const hsh = hashOf(it.t.id)
      // Jitter stays inside the gaps on either side, so boxes keep their clearance.
      const jx = ((hsh & 0xffff) / 0xffff - 0.5) * Math.min(share, 80) * 0.8
      const jy = (((hsh >>> 16) & 0xffff) / 0xffff - 0.5) * (GAP_Y / 2 - 4)
      const cx = x + it.w / 2 + jx
      const cy = y + rowTall / 2 + jy
      const ox = it.t.isMajor ? 0 : it.w / 2 - 14
      byId.set(it.t.id, { id: it.t.id, x: Math.round(cx - ox), y: Math.round(cy), w: it.w, h: it.h, ox: Math.round(ox) })
      x += it.w + GAP_X + share
    }
    y += rowTall + GAP_Y + rowGap
  })
  const placed = topics.map(t => byId.get(t.id) ?? { id: t.id, x: FIELD_W / 2, y: FIELD_H / 2, w: 40, h: 30, ox: 0 })
  return { placed, size: { w: FIELD_W, h } }
}

/**
 * The i-th satellite of a topic: radius 58 (major) or 40 (minor) plus a
 * 0/14/28 step, angle seed + i·2.399. Given the pill's half width, a major
 * topic's satellites orbit on an ellipse that clears the pill. Kept inside
 * the field.
 */
export function satellitePosition(center: Point, topicId: string, i: number, isMajor: boolean, halfWidth?: number, size: FieldSize = BASE): Point {
  const a = seedAngle(topicId) + i * 2.399
  const step = ((i * 37) % 3) * 14
  const rx = isMajor && halfWidth !== undefined ? halfWidth + 26 + step : (isMajor ? 58 : 40) + step
  const ry = isMajor && halfWidth !== undefined ? 36 + step : rx
  return {
    x: Math.min(size.w - 24, Math.max(24, center.x + rx * Math.cos(a))),
    y: Math.min(size.h - 24, Math.max(24, center.y + ry * Math.sin(a))),
  }
}

/** The numbered steps of a focused chain: spread across the field, zigzag ±26 around the middle. */
export function chainPositions(n: number, size: FieldSize = BASE): Point[] {
  const out: Point[] = []
  const mid = size.h / 2 + 2
  for (let i = 0; i < n; i += 1) {
    out.push({ x: n === 1 ? size.w / 2 : 120 + (i * (size.w - 240)) / (n - 1), y: mid + (i % 2 === 0 ? -26 : 26) })
  }
  return out
}

/** The related-topic anchors along the bottom of a focused chain. */
export function anchorPositions(n: number, size: FieldSize = BASE): Point[] {
  const out: Point[] = []
  for (let i = 0; i < n; i += 1) out.push({ x: size.w / 2 + (i - (n - 1) / 2) * ANCHOR_GAP, y: size.h - 50 })
  return out
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
