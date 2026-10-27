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
  isStub,
  nameKey,
  uniqueNames,
} from '../hooks/cluster'
import type { ClusterSettings } from '../hooks/cluster'
import type { StoreData } from '../types'
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

  test('a name in any script has its own id and key: two Hindi names are two topics, never one', async () => {
    // Devanagari vowel signs are combining marks: they belong to the word, not between words.
    expect(topicIdFor('भुगतान')).not.toBe(topicIdFor('रिफंड'))
    expect(topicIdFor('भुगतान फिर से')).toBe('topic:भुगतान-फिर-से')
    expect(topicIdFor('Café crème')).toBe('topic:café-crème')
    expect(nameKey('भुगतान')).not.toBe(nameKey('रिफंड'))
    expect(nameKey('भुगतान')).not.toBe('')
    expect(nameKey('फिर से भुगतान')).toBe(nameKey('भुगतान फिर से'))
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

  test('a session moved to Unsorted by hand stays there, and its old cluster keeps the others', async () => {
    const m = buildModel(folder(), { ...EMPTY_STORE, assign: { c2: UNSORTED_ID } }, SETTINGS, NOW)
    expect(m.byId.c2?.topicId).toBe(UNSORTED_ID)
    expect(m.byId.c1?.topicId).not.toBe(UNSORTED_ID)
    expect(m.byId.c1?.topicId).toBe(m.byId.c4?.topicId)
    const unsorted = m.topics.find(t => t.id === UNSORTED_ID)
    expect(unsorted?.sessions.some(s => s.id === 'c2')).toBe(true)
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
    // c4 and c3 share words with c2 and each other, so they follow while the topic is small; by the time c1 arrives
    // (one file shared with one of five members) the topic needs two links, so c1 stays out instead of chaining in.
    expect(m.byId.c4?.topicId).toBe('topic:auth-refactor')
    expect(m.byId.c3?.topicId).toBe('topic:auth-refactor')
    expect(m.byId.c1?.topicId).toBe(UNSORTED_ID)
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

  test('a pasted prompt scores by its text: the Desktop’s paste tags add no words', async () => {
    const blog = ['Content pipeline for the blog', 'Blog content schema', 'Publish blog content nightly'].map((title, i) =>
      session({ id: `w${i + 1}`, title, daysAgo: 2 + i, filesTouched: ['blog/content.ts'] }),
    )
    const m = buildModel([...folder(), ...blog], EMPTY_STORE, SETTINGS, NOW)
    expect(m.topics.some(t => t.sessions.some(s => s.id === 'w1') && t.id !== UNSORTED_ID)).toBe(true)
    const bare = scoreJoin('the checkout cart test is flaky again', m.topics)
    const pasted = scoreJoin('<pasted_content id="5e1f">\nthe checkout cart test is flaky again\n</pasted_content id="5e1f">', m.topics)
    expect(pasted.ranked).toEqual(bare.ranked)
    expect(pasted.best?.topicId).toBe('auto:c4')
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

describe('topic names', () => {
  test('two auto topics led by the same two words get distinct names: the bigger keeps it, the other adds its own next word', async () => {
    counter = 0
    const sessions: SessionSummary[] = []
    // Every session of the folder says "cashfree handover", so those words cluster nothing, but they lead both names.
    for (let i = 0; i < 6; i += 1) sessions.push(session({ title: `Cashfree handover webhook retry ${i}`, firstPrompt: 'cashfree handover webhook retry', daysAgo: i, filesTouched: ['src/webhook.ts'] }))
    for (let i = 0; i < 4; i += 1) sessions.push(session({ title: `Cashfree handover refund flow ${i}`, firstPrompt: 'cashfree handover refund flow', daysAgo: i + 0.5, filesTouched: ['src/refund.ts'] }))
    const m = buildModel(sessions, EMPTY_STORE, SETTINGS, NOW)
    const named = m.topics.filter(t => t.id !== UNSORTED_ID)
    expect(named.length).toBe(2)
    const names = named.map(t => t.name)
    expect(new Set(names.map(nameKey)).size).toBe(2)
    const big = named.find(t => t.sessions.length === 6)
    const small = named.find(t => t.sessions.length === 4)
    expect(big?.name).toBe('Cashfree Handover')
    expect(small?.name).toBe('Cashfree Handover Refund')
  })

  test('the same words in another order are the same name; the person’s names are never changed; a clash with no word left gets a number', async () => {
    counter = 0
    const a = [session({ title: 'cashfree continuation payout', daysAgo: 1 }), session({ title: 'cashfree continuation payout retry', daysAgo: 2 })]
    const b = [session({ title: 'continuation cashfree', daysAgo: 3 })]
    const c = [session({ title: 'continuation cashfree', daysAgo: 4 })]
    expect(nameKey('Cashfree Continuation')).toBe(nameKey('continuation cashfree'))
    const out = uniqueNames([
      { id: 'mine', name: 'Cashfree Continuation', isExplicit: true, sessions: b },
      { id: 'auto:a', name: 'Cashfree Continuation', isExplicit: false, sessions: a },
      { id: 'auto:c', name: 'Continuation Cashfree', isExplicit: false, sessions: c },
    ])
    expect(out.get('mine')).toBe('Cashfree Continuation')
    expect(out.get('auto:a')).toBe('Cashfree Continuation Payout')
    expect(out.get('auto:c')).toBe('Continuation Cashfree 3')
    expect(new Set([...out.values()].map(nameKey)).size).toBe(3)
  })
})

describe('a big folder', () => {
  test('a transcript over 4 MiB read in slices clusters with its theme, on what the slices held; a stub stays Unsorted', async () => {
    const sessions = folder()
    const c1 = sessions.find(s => s.id === 'c1')
    if (!c1) return
    // Read in slices: the head and the tail gave its title, its prompt and its files; its turn count is a floor.
    sessions.push({ ...c1, id: 'sliced', title: 'Cart test flake again', firstPrompt: 'the cart test is flaky again', large: true })
    sessions.push({ ...session({ id: 'stub', title: '(large transcript)', daysAgo: 1 }), large: true, stub: true })
    const m = buildModel(sessions, EMPTY_STORE, SETTINGS, NOW)
    expect(m.byId.sliced?.topicId).toBe(m.byId.c1?.topicId)
    expect(m.byId.sliced?.topicId).not.toBe(UNSORTED_ID)
    expect(m.byId.stub?.topicId).toBe(UNSORTED_ID)
    // Stubs cached before they were marked (large, nothing read) are stubs too: two never clump on "large transcript".
    const old = [...sessions, { ...session({ id: 'old1', title: '(large transcript)', daysAgo: 2 }), firstPrompt: '', filesTouched: [], large: true as const }, { ...session({ id: 'old2', title: '(large transcript)', daysAgo: 3 }), firstPrompt: '', filesTouched: [], large: true as const }]
    const m2 = buildModel(old, EMPTY_STORE, SETTINGS, NOW)
    expect(m2.byId.old1?.topicId).toBe(UNSORTED_ID)
    expect(m2.byId.old2?.topicId).toBe(UNSORTED_ID)
    expect(m2.byId.sliced?.topicId).toBe(m2.byId.c1?.topicId)
    // A large transcript read in slices whose prompts were all images and that edited nothing is no stub: its title clusters.
    expect(isStub({ ...session({ id: 'img', title: 'Dashboard spacing review', daysAgo: 1 }), firstPrompt: '', filesTouched: [], large: true })).toBe(false)
    expect(isStub({ ...session({ id: 'old', title: '(large transcript)', daysAgo: 1 }), firstPrompt: '', filesTouched: [], large: true })).toBe(true)
    expect(isStub({ ...session({ id: 'small', title: '(large transcript)', daysAgo: 1 }), firstPrompt: '', filesTouched: [] })).toBe(false)
  })

  test('135 sessions that all share common words and noise files still split into their themes; stubs stay Unsorted', async () => {
    const themes = ['checkout', 'auth', 'orders', 'billing', 'search', 'deploy', 'docs', 'analytics']
    const kinds = ['flow', 'tests', 'api', 'page']
    const sessions: SessionSummary[] = []
    counter = 1000
    for (let i = 0; i < 125; i += 1) {
      const theme = themes[i % themes.length] ?? 'misc'
      const kind = kinds[i % kinds.length] ?? 'flow'
      sessions.push(
        session({
          id: `b${i}`,
          title: `Fix the ${theme} ${kind} in the project`,
          firstPrompt: `please fix the ${theme} ${kind} bug in the project api`,
          daysAgo: i * 0.2,
          filesTouched: [`src/${theme}/${theme}.ts`, 'CLAUDE.md', '.claude/plans/plan.md', 'README.md'],
        }),
      )
    }
    for (let i = 0; i < 10; i += 1) sessions.push({ ...session({ id: `big${i}`, title: '(large transcript)', daysAgo: i }), large: true, stub: true })
    const m = buildModel(sessions, EMPTY_STORE, { ...SETTINGS, rangeDays: ALL_TIME_DAYS }, NOW)
    const topics = m.topics.filter(t => t.id !== UNSORTED_ID)
    expect(topics.length).toBe(8)
    expect(Math.max(...topics.map(t => t.sessions.length))).toBeLessThanOrEqual(16)
    for (const theme of themes) {
      const ids = new Set(sessions.filter(s => !s.stub && s.title.includes(` ${theme} `)).map(s => m.byId[s.id]?.topicId))
      expect(`${theme}: ${ids.size} topic(s)`).toBe(`${theme}: 1 topic(s)`)
    }
    for (const s of sessions.filter(s => s.stub)) expect(m.byId[s.id]?.topicId).toBe(UNSORTED_ID)
    expect(m.topicById[UNSORTED_ID]?.sessions.length).toBe(10)
    // Nothing links through the words every session shares, or the files every session edits.
    expect(m.links.length).toBe(0)
    expect(m.topics.find(t => t.sessions.some(s => s.id === 'b0'))?.name).toContain('Checkout')
  })

  test('one hub session that shares a word with everyone does not fuse the themes', async () => {
    const sessions: SessionSummary[] = []
    counter = 2000
    for (let i = 0; i < 30; i += 1) {
      const theme = i < 15 ? 'checkout' : 'billing'
      sessions.push(session({ id: `h${i}`, title: `${theme} work item ${i}`, firstPrompt: `${theme} ${i % 2 ? 'tests' : 'flow'}`, daysAgo: i, filesTouched: [`src/${theme}.ts`] }))
    }
    // The hub shares a word and a file with every session of both themes.
    sessions.push(session({ id: 'hub', title: 'checkout and billing refactor', daysAgo: 0.5, filesTouched: ['src/checkout.ts', 'src/billing.ts'] }))
    const m = buildModel(sessions, EMPTY_STORE, { ...SETTINGS, rangeDays: ALL_TIME_DAYS }, NOW)
    expect(m.byId.h0?.topicId).not.toBe(m.byId.h20?.topicId)
    expect(m.byId.h0?.topicId).toBe(m.byId.h14?.topicId)
    expect(m.byId.h15?.topicId).toBe(m.byId.h29?.topicId)
  })
})
