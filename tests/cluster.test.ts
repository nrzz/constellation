import { describe, expect, test } from 'claude-code/testing'

import {
  ALL_TIME_DAYS,
  DAY_MS,
  EMPTY_STORE,
  MINOR_COLOR,
  PALETTE,
  UNSORTED_ID,
  ageOf,
  autoName,
  buildModel,
  isMajorTopic,
  joinable,
  orderChain,
  scoreJoin,
  tokensOf,
  topicIdFor,
} from '../hooks/cluster'
import type { ClusterSettings, StoreData } from '../hooks/cluster'
import type { SessionSummary } from '../hooks/scan'

const NOW = Date.parse('2026-10-26T12:00:00.000Z')
const SETTINGS: ClusterSettings = {
  groupBasis: 'auto',
  majorRule: 'either',
  majorMinSessions: 3,
  recentDays: 7,
  numbering: 'oldestFirst',
  rangeDays: 30,
}

let counter = 0
function session(over: Partial<SessionSummary> & { title: string; daysAgo: number }): SessionSummary {
  counter += 1
  const lastAt = NOW - over.daysAgo * DAY_MS
  return {
    id: over.id ?? `s${counter}`,
    cwd: 'D:\\Projects\\web-app',
    slug: 'D--Projects-web-app',
    branch: over.branch ?? 'main',
    firstPrompt: over.firstPrompt ?? over.title.toLowerCase(),
    title: over.title,
    startedAt: over.startedAt ?? lastAt - 3600_000,
    lastAt,
    turns: over.turns ?? 5,
    filesTouched: over.filesTouched ?? [],
    lastAssistantText: over.lastAssistantText ?? '',
    size: 10,
    mtimeMs: over.mtimeMs ?? lastAt,
  }
}

/** The folder of the prototype: checkout tests, auth, pagination, CI, and two loners. */
function folder(): SessionSummary[] {
  counter = 0
  return [
    session({ id: 'c1', title: 'Fix flaky cart wait', daysAgo: 0.1, filesTouched: ['src/Cart.test.tsx', 'src/test-utils.ts'], mtimeMs: NOW - 60_000 }),
    session({ id: 'c2', title: 'Checkout total rounding tests', daysAgo: 1, branch: 'fix/rounding', filesTouched: ['src/total.ts', 'src/Checkout.test.tsx'] }),
    session({ id: 'c3', title: 'Mock payment API for checkout tests', daysAgo: 3, branch: 'test/mock-payments', filesTouched: ['msw/handlers.ts'] }),
    session({ id: 'c4', title: 'Speed up the checkout test suite', daysAgo: 6, filesTouched: ['vitest.config.ts', 'src/Cart.test.tsx'] }),
    session({ id: 'a1', title: 'Tokens to httpOnly cookies', daysAgo: 2, branch: 'feat/cookie-auth', filesTouched: ['src/auth.ts', 'src/middleware.ts'] }),
    session({ id: 'a2', title: 'Refresh token race', daysAgo: 4, branch: 'feat/cookie-auth', filesTouched: ['src/refresh.ts'] }),
    session({ id: 'p1', title: 'Cursor pagination API', daysAgo: 1, branch: 'feat/cursor-pages', filesTouched: ['src/orders.route.ts'] }),
    session({ id: 'p2', title: 'Infinite scroll orders list', daysAgo: 5, branch: 'feat/cursor-pages', filesTouched: ['src/OrdersList.tsx'] }),
    session({ id: 'i1', title: 'Cache node_modules in CI', daysAgo: 7, branch: 'ci/cache', filesTouched: ['.github/ci.yml'] }),
    session({ id: 'i2', title: 'Parallel CI shards', daysAgo: 11, filesTouched: ['.github/ci.yml'] }),
    session({ id: 'o1', title: 'Docs search', daysAgo: 18, filesTouched: ['docs/search.ts'] }),
    session({ id: 'n1', title: 'Analytics funnel events', daysAgo: 25, filesTouched: ['src/analytics.ts'] }),
  ]
}

describe('tokens and names', () => {
  test('stopwords, short words and numbers are dropped', async () => {
    expect(tokensOf('Fix the flaky cart wait in the checkout tests, v2 of 3')).toEqual(['flaky', 'cart', 'wait', 'checkout', 'test'])
    expect(tokensOf('Cart.test.tsx cookies shards class')).toEqual(['cart', 'test', 'tsx', 'cookie', 'shard', 'class'])
  })

  test('an auto topic is named by its two most frequent words', async () => {
    const name = autoName([
      session({ title: 'Fix flaky cart wait', daysAgo: 1, firstPrompt: 'fix the flaky cart wait in the checkout tests' }),
      session({ title: 'Speed up the checkout test suite', daysAgo: 2, firstPrompt: 'make the checkout tests faster' }),
    ])
    expect(name).toBe('Checkout Tests')
  })

  test('a typed topic name has a stable id', async () => {
    expect(topicIdFor('Checkout tests')).toBe('topic:checkout-tests')
    expect(topicIdFor('  CI / pipeline!! ')).toBe('topic:ci-pipeline')
  })
})

describe('clustering several topics in one folder', () => {
  test('sessions cluster by shared words, shared files and a shared non-main branch', async () => {
    const m = buildModel(folder(), EMPTY_STORE, SETTINGS, NOW)
    const topicOf = (id: string) => m.byId[id]?.topicId
    expect(topicOf('c1')).toBe(topicOf('c4'))
    expect(topicOf('c3')).toBe(topicOf('c4'))
    expect(topicOf('a1')).toBe(topicOf('a2'))
    expect(topicOf('p1')).toBe(topicOf('p2'))
    expect(topicOf('i1')).toBe(topicOf('i2'))
    expect(topicOf('a1')).not.toBe(topicOf('c1'))
    expect(topicOf('p1')).not.toBe(topicOf('c1'))
    expect(topicOf('o1')).toBe(UNSORTED_ID)
    expect(topicOf('n1')).toBe(UNSORTED_ID)
    const checkout = m.topicById[topicOf('c1') ?? '']
    expect(checkout?.id).toBe('auto:c4')
    expect(checkout?.name).toBe('Checkout Tests')
    expect(checkout?.isExplicit).toBe(false)
    expect(m.topicById[UNSORTED_ID]?.sessions.length).toBe(2)
    expect(m.topics.length).toBe(5)
    expect(m.topics[0]?.id).toBe('auto:c4')
  })

  test('two explicit topics whose sessions touch one file are linked, with the file as the label', async () => {
    const sessions = folder().map(s => (s.id === 'a1' ? { ...s, filesTouched: [...s.filesTouched, 'src/Checkout.test.tsx'] } : s))
    const store: StoreData = {
      ...EMPTY_STORE,
      topics: { 'topic:checkout': { name: 'Checkout', createdAt: 1 }, 'topic:auth': { name: 'Auth', createdAt: 2 } },
      assign: { c2: 'topic:checkout', a1: 'topic:auth' },
    }
    const m = buildModel(sessions, store, SETTINGS, NOW)
    expect(m.byId.c2?.topicId).toBe('topic:checkout')
    expect(m.byId.a1?.topicId).toBe('topic:auth')
    const link = m.links.find(l => l.via === 'Checkout.test.tsx')
    expect(link).toBeDefined()
    expect([link?.a, link?.b].sort()).toEqual(['topic:auth', 'topic:checkout'])
    expect(m.links.some(l => l.a === UNSORTED_ID || l.b === UNSORTED_ID)).toBe(false)
  })

  test('an explicit assignment wins over the cluster, and unassigned sessions linked to it join it', async () => {
    const store: StoreData = {
      ...EMPTY_STORE,
      topics: { 'topic:auth-refactor': { name: 'Auth refactor', createdAt: NOW - 10 * DAY_MS } },
      assign: { a1: 'topic:auth-refactor', c2: 'topic:auth-refactor' },
    }
    const m = buildModel(folder(), store, SETTINGS, NOW)
    expect(m.byId.a1?.topicId).toBe('topic:auth-refactor')
    expect(m.byId.a2?.topicId).toBe('topic:auth-refactor')
    expect(m.byId.c2?.topicId).toBe('topic:auth-refactor')
    // c3 shares words with c2, c4 with c3 and c1 a file with c4: the chain follows.
    expect(m.byId.c3?.topicId).toBe('topic:auth-refactor')
    expect(m.byId.c1?.topicId).toBe('topic:auth-refactor')
    expect(m.byId.p1?.topicId).toBe('auto:p2')
    expect(m.topicById['topic:auth-refactor']?.name).toBe('Auth refactor')
    expect(m.topicById['topic:auth-refactor']?.isExplicit).toBe(true)
  })

  test('an edge that would merge two explicit topics is skipped', async () => {
    const store: StoreData = {
      ...EMPTY_STORE,
      topics: { 'topic:one': { name: 'One', createdAt: 1 }, 'topic:two': { name: 'Two', createdAt: 2 } },
      assign: { p1: 'topic:one', p2: 'topic:two' },
    }
    const m = buildModel(folder(), store, SETTINGS, NOW)
    expect(m.byId.p1?.topicId).toBe('topic:one')
    expect(m.byId.p2?.topicId).toBe('topic:two')
  })

  test('manual grouping leaves unassigned sessions Unsorted', async () => {
    const m = buildModel(folder(), { ...EMPTY_STORE, assign: { c1: 'topic:x' }, topics: { 'topic:x': { name: 'X', createdAt: 1 } } }, { ...SETTINGS, groupBasis: 'manual' }, NOW)
    expect(m.byId.c1?.topicId).toBe('topic:x')
    expect(m.byId.c2?.topicId).toBe(UNSORTED_ID)
    expect(m.topicById[UNSORTED_ID]?.sessions.length).toBe(11)
  })

  test('an explicit topic with no sessions yet still shows', async () => {
    const m = buildModel([], { ...EMPTY_STORE, topics: { 'topic:new': { name: 'New', createdAt: NOW } } }, SETTINGS, NOW)
    expect(m.topics.map(t => t.id)).toEqual(['topic:new'])
    expect(m.topics[0]?.sessions.length).toBe(0)
  })
})

describe('major rule, colours, status and range', () => {
  test('either, count and recent', async () => {
    const m = buildModel(folder(), EMPTY_STORE, SETTINGS, NOW)
    const ci = m.topicById[m.byId.i1?.topicId ?? '']
    expect(ci).toBeDefined()
    if (!ci) return
    expect(isMajorTopic(ci.sessions, { ...SETTINGS, majorRule: 'count' }, NOW)).toBe(false)
    expect(isMajorTopic(ci.sessions, { ...SETTINGS, majorRule: 'recent' }, NOW)).toBe(true)
    expect(isMajorTopic(ci.sessions, { ...SETTINGS, majorRule: 'either' }, NOW)).toBe(true)
    expect(isMajorTopic(ci.sessions, { ...SETTINGS, majorRule: 'recent', recentDays: 3 }, NOW)).toBe(false)
    expect(isMajorTopic(ci.sessions, { ...SETTINGS, majorRule: 'count', majorMinSessions: 2 }, NOW)).toBe(true)
    const old = buildModel(folder(), EMPTY_STORE, { ...SETTINGS, majorRule: 'recent', recentDays: 1 }, NOW)
    expect(old.topicById[old.byId.i1?.topicId ?? '']?.isMajor).toBe(false)
    expect(old.topicById[old.byId.i1?.topicId ?? '']?.color).toBe(MINOR_COLOR)
  })

  test('major topics take palette colours in a stable order; a stored colour wins', async () => {
    const m = buildModel(folder(), EMPTY_STORE, SETTINGS, NOW)
    const majors = m.topics.filter(t => t.isMajor)
    expect(majors.length).toBe(4)
    for (const t of majors) expect(PALETTE.includes(t.color as (typeof PALETTE)[number])).toBe(true)
    expect(new Set(majors.map(t => t.color)).size).toBe(4)
    const store: StoreData = { ...EMPTY_STORE, topics: { 'auto:c4': { name: 'Checkout tests', color: '#123456', createdAt: 1 } } }
    expect(buildModel(folder(), store, SETTINGS, NOW).topicById['auto:c4']?.color).toBe('#123456')
  })

  test('status: active within five minutes of the transcript changing, archived from the store, else idle', async () => {
    const m = buildModel(folder(), { ...EMPTY_STORE, archived: { i2: true } }, SETTINGS, NOW, 'p2')
    expect(m.byId.c1?.status).toBe('active')
    expect(m.byId.c2?.status).toBe('idle')
    expect(m.byId.i2?.status).toBe('archived')
    expect(m.byId.p2?.status).toBe('active')
  })

  test('the time range dims old sessions unless pinned; 45 means all time', async () => {
    const m = buildModel(folder(), { ...EMPTY_STORE, pins: { n1: true } }, SETTINGS, NOW)
    expect(m.byId.o1?.isInRange).toBe(true)
    expect(m.byId.n1?.isInRange).toBe(true)
    const week = buildModel(folder(), EMPTY_STORE, { ...SETTINGS, rangeDays: 7 }, NOW)
    expect(week.byId.i2?.isInRange).toBe(false)
    expect(week.byId.c1?.isInRange).toBe(true)
    const all = buildModel(folder(), EMPTY_STORE, { ...SETTINGS, rangeDays: ALL_TIME_DAYS }, NOW)
    expect(all.byId.n1?.isInRange).toBe(true)
  })
})

describe('join suggestion', () => {
  test('a clear winner', async () => {
    const m = buildModel(folder(), EMPTY_STORE, SETTINGS, NOW)
    const s = scoreJoin('the checkout cart test is flaky again', m.topics)
    expect(s.best?.topicId).toBe('auto:c4')
    expect(s.isClear).toBe(true)
    expect(s.ranked[0]?.score).toBeGreaterThanOrEqual(3)
  })

  test('a tie is not clear, and an unrelated prompt suggests nothing', async () => {
    const m = buildModel(folder(), EMPTY_STORE, SETTINGS, NOW)
    const tie = scoreJoin('pagination cookies', m.topics)
    expect(tie.isClear).toBe(false)
    expect(tie.ranked[0]?.score).toBe(tie.ranked[1]?.score)
    const none = scoreJoin('write a haiku about autumn', m.topics)
    expect(none.best).toBeUndefined()
    expect(none.isClear).toBe(false)
    expect(joinable(m.topics).some(t => t.id === UNSORTED_ID)).toBe(false)
  })

  test('notes and file names count', async () => {
    const store: StoreData = { ...EMPTY_STORE, notes: { o1: { text: 'the search index rebuild still fails on windows', at: NOW, source: 'manual' } }, topics: { 'topic:docs': { name: 'Docs', createdAt: 1 } }, assign: { o1: 'topic:docs' } }
    const m = buildModel(folder(), store, SETTINGS, NOW)
    const s = scoreJoin('rebuild the search index on windows', m.topics)
    expect(s.best?.topicId).toBe('topic:docs')
    const files = scoreJoin('orders route handler', m.topics)
    expect(files.best?.topicId).toBe(m.byId.p1?.topicId)
  })
})

describe('chain order and ages', () => {
  test('oldest first by start time, newest first reversed', async () => {
    const m = buildModel(folder(), EMPTY_STORE, SETTINGS, NOW)
    const checkout = m.topicById['auto:c4']
    expect(checkout).toBeDefined()
    if (!checkout) return
    expect(orderChain(checkout.sessions, 'oldestFirst').map(s => s.id)).toEqual(['c4', 'c3', 'c2', 'c1'])
    expect(orderChain(checkout.sessions, 'newestFirst').map(s => s.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  test('relative ages', async () => {
    expect(ageOf(NOW, NOW)).toBe('now')
    expect(ageOf(NOW - 5 * 60_000, NOW)).toBe('5m')
    expect(ageOf(NOW - 2 * 3600_000, NOW)).toBe('2h')
    expect(ageOf(NOW - 3 * DAY_MS, NOW)).toBe('3d')
    expect(ageOf(NOW - 90 * DAY_MS, NOW)).toBe('3mo')
  })
})
