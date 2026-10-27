import { describe, expect, test } from 'claude-code/testing'

import { BASE, FIELD_H, FIELD_W, GAP_X, anchorPositions, chainLabelChars, chainPositions, focusSize, hashOf, placeTopics, satellitePosition, seedAngle, topicBox, unitCentre, unitEdge, unitWidth } from '../hooks/layout'
import type { PlacedTopic, TopicSpec } from '../hooks/layout'

/** Two boxes overlap when they are apart on neither axis. */
function overlaps(a: PlacedTopic, b: PlacedTopic): boolean {
  const apartX = Math.abs(a.x + a.ox - (b.x + b.ox)) >= (a.w + b.w) / 2
  const apartY = Math.abs(a.y - b.y) >= (a.h + b.h) / 2
  return !(apartX || apartY)
}

/** The room between two boxes on the axis that separates them. */
function clearance(a: PlacedTopic, b: PlacedTopic): number {
  const gapX = Math.abs(a.x + a.ox - (b.x + b.ox)) - (a.w + b.w) / 2
  const gapY = Math.abs(a.y - b.y) - (a.h + b.h) / 2
  return Math.max(gapX, gapY)
}

const SMALL: TopicSpec[] = [
  { id: 'auto:c4', name: 'Checkout Tests', isMajor: true, count: '4' },
  { id: 'auto:a2', name: 'Auth Refactor', isMajor: true, count: '2' },
  { id: 'auto:p2', name: 'Orders Pagination', isMajor: true, count: '2 · you' },
  { id: 'auto:i2', name: 'CI Pipeline', isMajor: true, count: '2' },
  { id: 'topic:design-tokens', name: 'Design tokens', isMajor: true, count: '1' },
  { id: 'topic:docs-site', name: 'Docs site', isMajor: false, count: '1' },
  { id: 'topic:analytics', name: 'Analytics events', isMajor: false, count: '1' },
  { id: 'unsorted', name: 'Unsorted', isMajor: false, count: '2' },
]

describe('layout', () => {
  test('hashes and seeds are stable', async () => {
    expect(hashOf('auto:c4')).toBe(hashOf('auto:c4'))
    expect(hashOf('a')).not.toBe(hashOf('b'))
    const a = seedAngle('x')
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(Math.PI * 2)
  })

  test('a few topics sit inside the base field, apart from each other, the same way every time and whatever the input order', async () => {
    const { placed, size } = placeTopics(SMALL)
    expect(size).toEqual(BASE)
    expect(placed.length).toBe(8)
    expect(placed.map(p => p.id)).toEqual(SMALL.map(t => t.id))
    for (const p of placed) {
      expect(p.x + p.ox - p.w / 2).toBeGreaterThanOrEqual(0)
      expect(p.x + p.ox + p.w / 2).toBeLessThanOrEqual(FIELD_W)
      expect(p.y - p.h / 2).toBeGreaterThanOrEqual(50)
      expect(p.y + p.h / 2).toBeLessThanOrEqual(FIELD_H - 40)
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        if (!a || !b) continue
        expect(overlaps(a, b)).toBe(false)
      }
    }
    expect(placeTopics(SMALL)).toEqual({ placed, size })
    const again = placeTopics([...SMALL].reverse()).placed
    for (const p of placed) expect(again.find(q => q.id === p.id)).toEqual(p)
  })

  test('a crowded map: twenty-five topics with long names and counts never overlap, keep room for satellites, and grow the field', async () => {
    const topics: TopicSpec[] = []
    for (let i = 0; i < 25; i += 1) {
      topics.push({
        id: `auto:${i}`,
        name: i % 3 === 0 ? `Topic ${i} with a long descriptive name` : `Topic ${i}`,
        isMajor: i % 5 !== 4,
        count: i % 7 === 0 ? '12 · you' : i % 4 === 0 ? '10 match' : String(i),
      })
    }
    const { placed, size } = placeTopics(topics)
    expect(size.w).toBe(FIELD_W)
    expect(size.h).toBeGreaterThan(FIELD_H)
    expect(size.h % 20).toBe(0)
    for (const p of placed) {
      expect(p.x + p.ox - p.w / 2).toBeGreaterThanOrEqual(0)
      expect(p.x + p.ox + p.w / 2).toBeLessThanOrEqual(FIELD_W)
      expect(p.y - p.h / 2).toBeGreaterThanOrEqual(50)
      expect(p.y + p.h / 2).toBeLessThanOrEqual(size.h - 40)
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        if (!a || !b) continue
        expect(`${a.id} vs ${b.id} overlap: ${overlaps(a, b)}`).toBe(`${a.id} vs ${b.id} overlap: false`)
        expect(clearance(a, b)).toBeGreaterThanOrEqual(6)
      }
    }
    // Neighbours in a row keep the satellites' full gap.
    const rows = new Map<number, PlacedTopic[]>()
    for (const p of placed) {
      const key = Math.round(p.y / 30)
      rows.set(key, [...(rows.get(key) ?? []), p])
    }
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a.x + a.ox - (b.x + b.ox))
      for (let i = 1; i < sorted.length; i += 1) {
        const a = sorted[i - 1]
        const b = sorted[i]
        if (!a || !b) continue
        if (Math.abs(a.y - b.y) < (a.h + b.h) / 2) expect(clearance(a, b)).toBeGreaterThanOrEqual(GAP_X - 1)
      }
    }
    expect(topicBox('Name', true, '12 · you').w).toBeGreaterThan(topicBox('Name', true, '3').w)
    expect(topicBox('Name', false, '12').w).toBeGreaterThan(topicBox('Name', false, '').w)
    // A name longer than the field is clipped to it.
    const huge = placeTopics([{ id: 'x', name: 'n'.repeat(400), isMajor: false, count: '1' }]).placed[0]
    expect(huge && huge.x + huge.ox + huge.w / 2).toBeLessThanOrEqual(FIELD_W)
    expect(placeTopics([])).toEqual({ placed: [], size: BASE })
  })

  test('satellites orbit the whole unit inside its halo: never on the pill or the label, never past the halo, under the hint and on the field', async () => {
    const major: PlacedTopic = { id: 't', x: 430, y: 260, ox: 0, uw: 160, isMajor: true, w: 160 + 72, h: 108 }
    // A minor topic: its dot at x, its label to the right; the unit (dot and label) is centred right of the dot.
    const minor: PlacedTopic = { id: 'm', x: 300, y: 300, ox: 75 - 11, uw: 150, isMajor: false, w: 150 + 80, h: 88 }
    for (const p of [major, minor]) {
      const c = unitCentre(p)
      const hw = p.uw / 2
      const hh = p.isMajor ? 21 : 11
      for (let i = 0; i < 60; i += 1) {
        const sp = satellitePosition(p, i, { w: 860, h: 1200 })
        // Off the unit itself.
        expect(Math.abs(sp.x - c.x) > hw || Math.abs(sp.y - c.y) > hh).toBe(true)
        // Inside the halo, the satellite's dot and its glow (11) included.
        expect(Math.abs(sp.x - c.x) + 11).toBeLessThanOrEqual(p.w / 2 + 0.5)
        expect(Math.abs(sp.y - c.y) + 11).toBeLessThanOrEqual(p.h / 2 + 0.5)
      }
    }
    // A minor topic's satellites clear its label: none lands on the text to the right of the dot.
    for (let i = 0; i < 60; i += 1) {
      const sp = satellitePosition(minor, i)
      // …and keeps 12 clear of its end, so a dot never reads as part of the count.
      const onLabel = sp.x > minor.x + 10 && sp.x < minor.x - 11 + minor.uw + 12 && Math.abs(sp.y - minor.y) < 10
      expect(onLabel).toBe(false)
    }
    // Clamped on the field, and under the hint pill at the top.
    const corner: PlacedTopic = { ...major, x: 20, y: 20 }
    for (let i = 0; i < 12; i += 1) {
      const sp = satellitePosition(corner, i)
      expect(sp.x).toBeGreaterThanOrEqual(16)
      expect(sp.y).toBeGreaterThanOrEqual(52)
    }
    const tall = { w: 860, h: 760 }
    for (let i = 0; i < 12; i += 1) {
      const sp = satellitePosition({ ...major, x: 850, y: 740 }, i, tall)
      expect(sp.x).toBeLessThanOrEqual(844)
      expect(sp.y).toBeLessThanOrEqual(744)
    }
  })

  test('during a search a pill grows to say “N match” and still never meets its neighbour’s pill', async () => {
    const topics: TopicSpec[] = []
    for (let i = 0; i < 30; i += 1) topics.push({ id: `auto:${i}`, name: i % 3 === 0 ? `Topic ${i} with a long descriptive name` : `Topic ${i}`, isMajor: i % 5 !== 4, count: String(i % 12) })
    const { placed } = placeTopics(topics)
    // The drawn unit with the search's label, the longest it gets: "11 match".
    const drawn = placed.map(p => {
      const t = topics.find(x => x.id === p.id)
      const uw = unitWidth(t?.name ?? '', p.isMajor, `${t?.count ?? ''} match`)
      const cx = p.isMajor ? p.x : p.x - 11 + uw / 2
      return { id: p.id, left: cx - uw / 2, right: cx + uw / 2, top: p.y - 21, bottom: p.y + 21 }
    })
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        const a = drawn[i]
        const b = drawn[j]
        if (!a || !b) continue
        const apart = a.right + 4 <= b.left || b.right + 4 <= a.left || a.bottom + 4 <= b.top || b.bottom + 4 <= a.top
        expect(`${a.id} vs ${b.id} apart: ${apart}`).toBe(`${a.id} vs ${b.id} apart: true`)
      }
    }
  })

  test('a spoke leaves its unit at the unit’s edge, so it never crosses the topic’s own label', async () => {
    const major: PlacedTopic = { id: 't', x: 430, y: 260, ox: 0, uw: 160, isMajor: true, w: 252, h: 116 }
    expect(unitEdge(major, { x: 630, y: 260 })).toEqual({ x: 513, y: 260 })
    expect(unitEdge(major, { x: 430, y: 330 })).toEqual({ x: 430, y: 284 })
    const e = unitEdge(major, { x: 560, y: 320 })
    expect(Math.abs(e.x - 430) <= 83.01 && Math.abs(e.y - 260) <= 24.01).toBe(true)
    expect(Math.abs(e.x - 430) > 82.9 || Math.abs(e.y - 260) > 23.9).toBe(true)
    // A target inside the unit gets no spoke to speak of: the line starts where it ends.
    expect(unitEdge(major, { x: 440, y: 262 })).toEqual({ x: 440, y: 262 })
  })

  test('a chain alternates between two rows far enough apart for labels above and below; one step sits in the middle; anchors line the bottom', async () => {
    expect(chainPositions(1)).toEqual([{ x: 430, y: 250 }])
    const five = chainPositions(5)
    expect(five.map(p => Math.round(p.x))).toEqual([90, 260, 430, 600, 770])
    expect(five.map(p => p.y)).toEqual([250, 342, 250, 342, 250])
    expect(chainPositions(3, { w: 860, h: 720 }).map(p => p.y)).toEqual([364, 456, 364])
    // Labels get the room to their same-row neighbour; past about two dozen steps only the key steps are labelled.
    expect(chainLabelChars(2)).toBe(26)
    expect(chainLabelChars(11)).toBe(19)
    expect(chainLabelChars(20)).toBe(9)
    expect(chainLabelChars(30)).toBe(0)
    expect(anchorPositions(3).map(p => p.x)).toEqual([200, 430, 660])
    expect(anchorPositions(1)[0]).toEqual({ x: 430, y: 470 })
    expect(anchorPositions(1, { w: 860, h: 720 })[0]).toEqual({ x: 430, y: 670 })
  })

  test('step circles never meet: a long chain wraps into more two-row bands, the field growing to hold them, every same-row gap at least 34', async () => {
    const problems: string[] = []
    for (const w of [520, 620, 860]) {
      for (let n = 1; n <= 60; n += 1) {
        const size = focusSize({ w, h: FIELD_H }, n)
        const at = chainPositions(n, size)
        const tag = `${w} wide, ${n} steps`
        if (at.length !== n) problems.push(`${tag}: ${at.length} positions`)
        // A circle is r 16 with a 2-unit stroke: 34 across. No two meet, on a row or across rows.
        for (let i = 0; i < at.length; i += 1) {
          for (let k = i + 1; k < at.length; k += 1) {
            const a = at[i]
            const b = at[k]
            if (a && b && a.y === b.y && Math.abs(a.x - b.x) < 34) problems.push(`${tag}: steps ${i + 1} and ${k + 1} ${Math.abs(a.x - b.x).toFixed(1)} apart on a row`)
            else if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < 34) problems.push(`${tag}: steps ${i + 1} and ${k + 1} meet`)
          }
        }
        // Rows keep the room the labels above and below them take: 92 within a band, more between bands.
        const rows = [...new Set(at.map(p => p.y))].sort((a, b) => a - b)
        rows.forEach((y, k) => { if (k > 0 && y - (rows[k - 1] ?? 0) < 92) problems.push(`${tag}: rows ${rows[k - 1]} and ${y} too close`) })
        // On the field, under the pill and its goal, over the related anchors.
        const anchorY = anchorPositions(1, size)[0]?.y ?? 0
        for (const p of at) if (p.x < 90 - 1e-9 || p.x > w - 90 + 1e-9 || p.y < 200 || p.y > anchorY - 100) problems.push(`${tag}: a step at ${p.x.toFixed(1)},${p.y} leaves its room`)
        // Each step leads to the next: within a band a short diagonal, between bands straight down at the band's end.
        for (let i = 1; i < at.length; i += 1) {
          const a = at[i - 1]
          const b = at[i]
          if (a && b && b.y < a.y && Math.abs(b.x - a.x) > (2 * (w - 180)) / 2) problems.push(`${tag}: step ${i + 1} jumps back`)
        }
      }
    }
    expect(problems).toEqual([])
    // A chain that fits two rows is drawn as before, on the base field.
    expect(focusSize({ w: 520, h: FIELD_H }, 20)).toEqual({ w: 520, h: FIELD_H })
    expect(chainPositions(20, focusSize({ w: 520, h: FIELD_H }, 20)).map(p => p.y).slice(0, 2)).toEqual([250, 342])
    // Past it the field grows, and the anchors move down with it.
    expect(focusSize({ w: 520, h: FIELD_H }, 21).h).toBeGreaterThan(FIELD_H)
  })
})
