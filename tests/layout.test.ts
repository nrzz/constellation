import { describe, expect, test } from 'claude-code/testing'

import { FIELD_H, FIELD_W, anchorPositions, chainPositions, hashOf, placeTopics, satellitePosition, seedAngle } from '../hooks/layout'

describe('layout', () => {
  test('hashes and seeds are stable', async () => {
    expect(hashOf('auto:c4')).toBe(hashOf('auto:c4'))
    expect(hashOf('a')).not.toBe(hashOf('b'))
    const a = seedAngle('x')
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(Math.PI * 2)
  })

  test('topics are placed inside the field, apart from each other, the same way every time', async () => {
    const topics = [
      { id: 'auto:c4', name: 'Checkout Tests', isMajor: true },
      { id: 'auto:a2', name: 'Auth Refactor', isMajor: true },
      { id: 'auto:p2', name: 'Orders Pagination', isMajor: true },
      { id: 'auto:i2', name: 'CI Pipeline', isMajor: true },
      { id: 'topic:design-tokens', name: 'Design tokens', isMajor: true },
      { id: 'topic:docs-site', name: 'Docs site', isMajor: false },
      { id: 'topic:analytics', name: 'Analytics events', isMajor: false },
      { id: 'unsorted', name: 'Unsorted', isMajor: false },
    ]
    const placed = placeTopics(topics)
    expect(placed.length).toBe(8)
    for (const p of placed) {
      expect(p.x - p.w / 2).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w / 2).toBeLessThanOrEqual(FIELD_W)
      expect(p.y).toBeGreaterThanOrEqual(90)
      expect(p.y).toBeLessThanOrEqual(FIELD_H - 60)
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        if (!a || !b) continue
        const apartX = Math.abs(a.x + a.ox - (b.x + b.ox)) >= (a.w + b.w) / 2
        const apartY = Math.abs(a.y - b.y) >= (a.h + b.h) / 2
        expect(apartX || apartY).toBe(true)
      }
    }
    expect(placeTopics(topics)).toEqual(placed)
    const again = placeTopics([...topics].reverse())
    const byId = Object.fromEntries(again.map(p => [p.id, p]))
    for (const p of placed) expect(byId[p.id]?.id).toBe(p.id)
  })

  test('satellites orbit at the planned radii and stay on the field', async () => {
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
  })

  test('a chain spreads across the field and zigzags; one step sits in the middle', async () => {
    expect(chainPositions(1)).toEqual([{ x: 430, y: 236 }])
    const five = chainPositions(5)
    expect(five.map(p => Math.round(p.x))).toEqual([120, 275, 430, 585, 740])
    expect(five.map(p => p.y)).toEqual([236, 288, 236, 288, 236])
    expect(anchorPositions(3).map(p => p.x)).toEqual([200, 430, 660])
    expect(anchorPositions(1)[0]).toEqual({ x: 430, y: 470 })
  })
})
