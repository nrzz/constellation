// Constellation: positions on the 860x520 field.
//
// Topic pills get seeded positions from a hash of their id, then a few rounds
// of repulsion so they do not overlap; the result depends only on the topics'
// ids and sizes, so it is stable across reopenings. Sessions orbit their topic
// as satellites. Focus mode lays a topic's sessions out as a zigzag chain.
export const FIELD_W = 860
export const FIELD_H = 520
export const GRID = 60
export const FOCUS_PILL = { x: 430, y: 92 }
export const ANCHOR_Y = 470
export const ANCHOR_GAP = 230

export type Point = { x: number; y: number }
/** A topic's place: its anchor (pill centre or dot), its box, and the box's horizontal offset from the anchor (a minor label hangs to one side). */
export type PlacedTopic = Point & { id: string; w: number; h: number; ox: number }

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

/** The approximate box of a topic on the map: a pill for a major topic, a dot with a label for a minor one. */
export function topicBox(name: string, isMajor: boolean): { w: number; h: number } {
  const chars = Math.min(name.length, 28)
  return isMajor ? { w: 64 + chars * 7.4, h: 40 } : { w: 40 + chars * 6.6, h: 30 }
}

const PAD_X = 100
const TOP_Y = 96
const BOTTOM_Y = 452

/**
 * Places topics: each takes a cell of a grid that covers the field evenly
 * (cells dealt in hash order, so the picture is stable for one set of
 * topics), jittered by its hash, then up to 80 rounds of pairwise
 * separation on the axis of least overlap. Deterministic.
 */
export function placeTopics(topics: ReadonlyArray<{ id: string; name: string; isMajor: boolean }>): PlacedTopic[] {
  const n = topics.length
  const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt((n * (FIELD_W - 2 * PAD_X)) / (BOTTOM_Y - TOP_Y)))))
  const rows = Math.max(1, Math.ceil(n / cols))
  const cellW = (FIELD_W - 2 * PAD_X) / cols
  const cellH = (BOTTOM_Y - TOP_Y) / rows
  const dealt = [...topics].sort((a, b) => hashOf(a.id) - hashOf(b.id) || a.id.localeCompare(b.id))
  const placed: PlacedTopic[] = dealt.map((t, k) => {
    const h = hashOf(t.id)
    const box = topicBox(t.name, t.isMajor)
    const col = k % cols
    const row = Math.floor(k / cols)
    const jx = ((h & 0xffff) / 0xffff - 0.5) * cellW * 0.6
    const jy = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * cellH * 0.6
    const x = PAD_X + cellW * (col + 0.5) + jx
    // A minor topic's label hangs right of its dot (left of it past x 700), so its box does too.
    const ox = t.isMajor ? 0 : x > 700 ? -(box.w / 2 - 14) : box.w / 2 - 14
    return { id: t.id, x, y: TOP_Y + cellH * (row + 0.5) + jy, w: box.w, h: box.h, ox }
  })
  const gapX = 36
  const gapY = 44
  for (let round = 0; round < 80; round += 1) {
    let moved = false
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        if (!a || !b) continue
        const needX = (a.w + b.w) / 2 + gapX
        const needY = (a.h + b.h) / 2 + gapY
        let dx = b.x + b.ox - (a.x + a.ox)
        let dy = b.y - a.y
        const overX = needX - Math.abs(dx)
        const overY = needY - Math.abs(dy)
        if (overX <= 0 || overY <= 0) continue
        moved = true
        if (dx === 0 && dy === 0) {
          dx = (hashOf(a.id + b.id) % 2 === 0 ? 1 : -1) * 0.5
          dy = 0.25
        }
        if (overX / needX < overY / needY) {
          const push = (overX / 2 + 1) * Math.sign(dx || 1)
          a.x -= push
          b.x += push
        } else {
          const push = (overY / 2 + 1) * Math.sign(dy || 1)
          a.y -= push
          b.y += push
        }
      }
    }
    for (const p of placed) {
      p.x = Math.min(FIELD_W - p.w / 2 - 10 - p.ox, Math.max(p.w / 2 + 10 - p.ox, p.x))
      p.y = Math.min(BOTTOM_Y, Math.max(TOP_Y, p.y))
    }
    if (!moved) break
  }
  const byId = new Map(placed.map(p => [p.id, p]))
  return topics.map(t => {
    const p = byId.get(t.id)
    return p ? { ...p, x: Math.round(p.x), y: Math.round(p.y) } : { id: t.id, x: FIELD_W / 2, y: FIELD_H / 2, w: 40, h: 30, ox: 0 }
  })
}

/**
 * The i-th satellite of a topic: radius 58 (major) or 40 (minor) plus a
 * 0/14/28 step, angle seed + i·2.399. Given the pill's half width, a major
 * topic's satellites orbit on an ellipse that clears the pill.
 */
export function satellitePosition(center: Point, topicId: string, i: number, isMajor: boolean, halfWidth?: number): Point {
  const a = seedAngle(topicId) + i * 2.399
  const step = ((i * 37) % 3) * 14
  const rx = isMajor && halfWidth !== undefined ? halfWidth + 26 + step : (isMajor ? 58 : 40) + step
  const ry = isMajor && halfWidth !== undefined ? 36 + step : rx
  return {
    x: Math.min(FIELD_W - 24, Math.max(24, center.x + rx * Math.cos(a))),
    y: Math.min(FIELD_H - 24, Math.max(24, center.y + ry * Math.sin(a))),
  }
}

/** The numbered steps of a focused chain: spread across the field, zigzag ±26 around y 262. */
export function chainPositions(n: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < n; i += 1) {
    out.push({ x: n === 1 ? 430 : 120 + (i * 620) / (n - 1), y: 262 + (i % 2 === 0 ? -26 : 26) })
  }
  return out
}

/** The related-topic anchors along the bottom of a focused chain. */
export function anchorPositions(n: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < n; i += 1) out.push({ x: 430 + (i - (n - 1) / 2) * ANCHOR_GAP, y: ANCHOR_Y })
  return out
}

/** Star dots for the field, as the prototype draws them: `count` points stepping across. */
export function starPath(count: number, step: number, offset: number): string {
  let p = ''
  for (let i = 0; i < count; i += 1) {
    const x = ((i * step + offset) % FIELD_W).toFixed(1)
    const y = ((i * 97.3 + offset * 1.7 + 31) % FIELD_H).toFixed(1)
    p += `M${x} ${y}l0.01 0`
  }
  return p
}
