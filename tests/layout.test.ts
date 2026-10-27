import { describe, expect, test } from 'claude-code/testing'

import { BASE, FIELD_H, FIELD_W, GAP_X, anchorPositions, chainPositions, hashOf, placeTopics, satellitePosition, seedAngle, topicBox } from '../hooks/layout'
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

  test('satellites orbit at the planned radii and stay on the field, a tall one too', async () => {
    const c = { x: 430, y: 260 }
    const p0 = satellitePosition(c, 't', 0, true)
    expect(Math.round(Math.hypot(p0.x - c.x, p0.y - c.y))).toBe(58)
    const p1 = satellitePosition(c, 't', 1, true)
    expect(Math.round(Math.hypot(p1.x - c.x, p1.y - c.y))).toBe(72)
    const minor = satellitePosition(c, 't', 0, false)
    expect(Math.round(Math.hypot(minor.x - c.x, minor.y - c.y))).toBe(40)
    const orbit = satellitePosition(c, 't', 0, true, 80)
    expect(Math.abs(orbit.x - c.x)).toBeLessThanOrEqual(106)
    expect(Math.abs(orbit.y - c.y)).toBeLessThanOrEqual(36)
    expect(Math.abs(orbit.x - c.x) > 80 || Math.abs(orbit.y - c.y) > 20).toBe(true)
    const edge = satellitePosition({ x: 10, y: 10 }, 't', 2, true)
    expect(edge.x).toBeGreaterThanOrEqual(24)
    expect(edge.y).toBeGreaterThanOrEqual(24)
    const tall = { w: 860, h: 760 }
    for (let i = 0; i < 12; i += 1) {
      const p = satellitePosition({ x: 850, y: 740 }, 't', i, true, 90, tall)
      expect(p.x).toBeLessThanOrEqual(836)
      expect(p.y).toBeLessThanOrEqual(736)
      expect(p.y).toBeGreaterThan(520)
    }
  })

  test('a chain spreads across the field and zigzags; one step sits in the middle; anchors line the bottom', async () => {
    expect(chainPositions(1)).toEqual([{ x: 430, y: 236 }])
    const five = chainPositions(5)
    expect(five.map(p => Math.round(p.x))).toEqual([120, 275, 430, 585, 740])
    expect(five.map(p => p.y)).toEqual([236, 288, 236, 288, 236])
    expect(chainPositions(3, { w: 860, h: 720 }).map(p => p.y)).toEqual([336, 388, 336])
    expect(anchorPositions(3).map(p => p.x)).toEqual([200, 430, 660])
    expect(anchorPositions(1)[0]).toEqual({ x: 430, y: 470 })
    expect(anchorPositions(1, { w: 860, h: 720 })[0]).toEqual({ x: 430, y: 670 })
  })
})
