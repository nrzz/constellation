// Constellation: topics, links, status, join suggestions and chain order.
//
// A folder is only the scope of the map, never a topic. A topic is a named
// chain of sessions inside a folder, ordered by time. Branch is a weak hint,
// never a bucket. Assignment, in priority order: an explicit `assign` (a join,
// `/topic`, a move), then auto-clustering of the rest (union-find over shared
// title tokens, shared files, a shared non-main branch), then "Unsorted".
// Everything here is pure: the store's data and the clock come in as values.
import { basenameOf } from './scan'
import type { SessionSummary } from './scan'

export const PALETTE = ['#F2A33A', '#9B8CFF', '#5FD3A6', '#7FB8FF', '#ED93B1'] as const
export const MINOR_COLOR = '#B4B2A9'
export const ACCENT = '#F2A33A'
export const UNSORTED_ID = 'unsorted'
export const UNSORTED_NAME = 'Unsorted'
export const ACTIVE_MS = 5 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000
/** The `rangeDays` value that means all time. */
export const ALL_TIME_DAYS = 45

export type MajorRule = 'either' | 'count' | 'recent'
export type Numbering = 'oldestFirst' | 'newestFirst'
export type GroupBasis = 'auto' | 'manual'

export type ClusterSettings = {
  groupBasis: GroupBasis
  majorRule: MajorRule
  majorMinSessions: number
  recentDays: number
  numbering: Numbering
  rangeDays: number
}

export type TopicRecord = { name: string; color?: string; createdAt: number }
export type NoteRecord = { text: string; at: number; source: 'manual' | 'auto' }

/** What the mod keeps in `$.store` beside the scan caches and the settings. */
export type StoreData = {
  topics: Record<string, TopicRecord>
  assign: Record<string, string>
  notes: Record<string, NoteRecord>
  archived: Record<string, true>
  pins: Record<string, true>
  /** Names the model wrote for auto topics, by topic id. */
  titles: Record<string, string>
}

export const EMPTY_STORE: StoreData = { topics: {}, assign: {}, notes: {}, archived: {}, pins: {}, titles: {} }

export type SessionStatus = 'active' | 'idle' | 'archived'

export type SessionView = SessionSummary & {
  topicId: string
  status: SessionStatus
  isPinned: boolean
  /** Within the time range (pinned sessions always are). */
  isInRange: boolean
  note?: NoteRecord
}

export type Topic = {
  id: string
  name: string
  color: string
  /** Recorded in the store (joined, moved, renamed or created), as against auto-clustered. */
  isExplicit: boolean
  isMajor: boolean
  /** Newest activity first. */
  sessions: SessionView[]
  lastAt: number
  firstAt: number
}

export type Link = { a: string; b: string; via: string }

export type Model = {
  topics: Topic[]
  links: Link[]
  /** Every session in scope, newest first. */
  sessions: SessionView[]
  byId: Record<string, SessionView>
  topicById: Record<string, Topic>
}

const STOPWORDS = new Set(
  (
    'a an the and or but for to of in on at by with from into onto this that these those it its is are was were be been ' +
    'being have has had do does did not no yes can could should would will just now then than so if as up out all any ' +
    'some my our your me we you i fix fixing fixed add adding added update updating updated make making made use using ' +
    'used change changing changes changed new get set run running please help need want like also here there when where ' +
    'what which how why who let lets still again more less one two first last next done try check look see show about ' +
    'after before over under only very really thing things something work working works file files code let’s ' +
    'session claude continue continuing finish finishing current the same into via per each every both other another ' +
    'can’t don’t doesn’t isn’t wasn’t won’t should’t'
  ).split(/\s+/),
)

/** A light stem: a plural's trailing `s` goes (`cookies` → `cookie`, `tests` → `test`), never below 3 letters. */
export function stemOf(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

/** Significant words with their stems: lowercase runs of letters/digits of 3+ chars, no pure numbers, no stopwords. */
export function wordsOf(text: string): { word: string; stem: string }[] {
  const out: { word: string; stem: string }[] = []
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 3) continue
    if (/^\d+$/.test(word)) continue
    if (STOPWORDS.has(word)) continue
    const stem = stemOf(word)
    if (STOPWORDS.has(stem)) continue
    out.push({ word, stem })
  }
  return out
}

/** Significant tokens, stemmed: what clustering and scoring compare. */
export function tokensOf(text: string): string[] {
  return wordsOf(text).map(w => w.stem)
}

function tokenSet(session: SessionSummary): Set<string> {
  return new Set([...tokensOf(session.title), ...tokensOf(session.firstPrompt)])
}

/** A branch that says nothing about the topic. */
export function isPlainBranch(branch: string): boolean {
  const b = branch.trim().toLowerCase()
  return b === '' || b === 'main' || b === 'master' || b === 'head' || b === 'develop' || b === 'dev'
}

function sharedCount<T>(a: Set<T>, b: Set<T>): number {
  let n = 0
  for (const x of a) if (b.has(x)) n += 1
  return n
}

/** A stable topic id for a name typed in `/topic <name>` or the chooser. */
export function topicIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `topic:${slug || 'topic'}`
}

/** `/topic <name>` as a display name: trimmed, collapsed, at most 48 characters. */
export function cleanName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? `${clean.slice(0, 47).trimEnd()}…` : clean
}

function titleCase(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1)
}

/** A name from the most frequent significant words of the sessions' titles: two words, Title Case. */
export function autoName(sessions: readonly SessionSummary[]): string {
  const freq = new Map<string, { n: number; first: number; forms: Map<string, number> }>()
  let order = 0
  for (const s of sessions) {
    const seen = new Set<string>()
    for (const { word, stem } of [...wordsOf(s.title), ...wordsOf(s.firstPrompt)]) {
      if (seen.has(stem)) continue
      seen.add(stem)
      const hit = freq.get(stem) ?? { n: 0, first: order, forms: new Map<string, number>() }
      hit.n += 1
      hit.forms.set(word, (hit.forms.get(word) ?? 0) + 1)
      freq.set(stem, hit)
      order += 1
    }
  }
  const ranked = [...freq.values()].sort((a, b) => b.n - a.n || a.first - b.first)
  const commonForm = (forms: Map<string, number>) => [...forms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const words = ranked.slice(0, 2).map(({ forms }) => titleCase(commonForm(forms)))
  if (words.length === 0) return sessions[0]?.title.slice(0, 40) || 'Topic'
  return words.join(' ')
}

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let root = x
    while ((this.parent.get(root) ?? root) !== root) root = this.parent.get(root) ?? root
    let cur = x
    while (cur !== root) {
      const next = this.parent.get(cur) ?? cur
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/** Why two sessions belong together, if they do. */
export function areRelated(a: SessionSummary, b: SessionSummary, tokensA: Set<string>, tokensB: Set<string>): boolean {
  if (sharedCount(tokensA, tokensB) >= 2) return true
  if (a.filesTouched.length && b.filesTouched.length) {
    const files = new Set(a.filesTouched)
    if (b.filesTouched.some(f => files.has(f))) return true
  }
  if (!isPlainBranch(a.branch) && a.branch === b.branch) return true
  return false
}

export function statusOf(session: SessionSummary, store: StoreData, now: number, thisSessionId?: string): SessionStatus {
  if (store.archived[session.id]) return 'archived'
  if (session.id === thisSessionId) return 'active'
  return now - session.mtimeMs <= ACTIVE_MS ? 'active' : 'idle'
}

export function isMajorTopic(sessions: readonly SessionView[], settings: ClusterSettings, now: number): boolean {
  const byCount = sessions.length >= settings.majorMinSessions
  const byRecent = sessions.some(s => s.status !== 'archived' && now - s.lastAt <= settings.recentDays * DAY_MS)
  if (settings.majorRule === 'count') return byCount
  if (settings.majorRule === 'recent') return byRecent
  return byCount || byRecent
}

/**
 * Assigns every session a topic id: explicit assignments first, then
 * union-find clusters (an edge that would merge two explicit topics is
 * skipped; an unassigned session linked to an explicit topic's session joins
 * it), then `unsorted` for the rest. Returns the id per session and the
 * auto topics' member lists.
 */
export function assignTopics(
  sessions: readonly SessionSummary[],
  store: StoreData,
  groupBasis: GroupBasis,
): { topicOf: Record<string, string>; autoMembers: Record<string, SessionSummary[]> } {
  const topicOf: Record<string, string> = {}
  const explicit = (s: SessionSummary): string | undefined => {
    const id = store.assign[s.id]
    return id && id !== UNSORTED_ID ? id : undefined
  }
  if (groupBasis === 'manual') {
    for (const s of sessions) topicOf[s.id] = explicit(s) ?? UNSORTED_ID
    return { topicOf, autoMembers: {} }
  }
  const byStart = [...sessions].sort((a, b) => a.startedAt - b.startedAt)
  const uf = new UnionFind()
  const explicitOfRoot = new Map<string, string>()
  for (const s of byStart) {
    const t = explicit(s)
    if (t) explicitOfRoot.set(uf.find(s.id), t)
  }
  const tokens = new Map<string, Set<string>>()
  for (const s of byStart) tokens.set(s.id, tokenSet(s))
  for (let i = 0; i < byStart.length; i += 1) {
    const a = byStart[i]
    if (!a) continue
    for (let j = i + 1; j < byStart.length; j += 1) {
      const b = byStart[j]
      if (!b) continue
      const ra = uf.find(a.id)
      const rb = uf.find(b.id)
      if (ra === rb) continue
      const ta = explicitOfRoot.get(ra)
      const tb = explicitOfRoot.get(rb)
      if (ta && tb && ta !== tb) continue
      if (!areRelated(a, b, tokens.get(a.id) ?? new Set(), tokens.get(b.id) ?? new Set())) continue
      uf.union(a.id, b.id)
      const root = uf.find(a.id)
      const keep = ta ?? tb
      if (keep) explicitOfRoot.set(root, keep)
    }
  }
  const members = new Map<string, SessionSummary[]>()
  for (const s of byStart) {
    const root = uf.find(s.id)
    const list = members.get(root) ?? []
    list.push(s)
    members.set(root, list)
  }
  const autoMembers: Record<string, SessionSummary[]> = {}
  for (const [root, list] of members) {
    const t = explicitOfRoot.get(root)
    if (t) {
      for (const s of list) topicOf[s.id] = explicit(s) ?? t
      continue
    }
    if (list.length < 2) {
      for (const s of list) topicOf[s.id] = UNSORTED_ID
      continue
    }
    const earliest = list[0]
    if (!earliest) continue
    const id = `auto:${earliest.id}`
    autoMembers[id] = list
    for (const s of list) topicOf[s.id] = id
  }
  return { topicOf, autoMembers }
}

/** Links between topics: a shared touched file, the most-shared one as the label. */
export function linksOf(topics: readonly Topic[]): Link[] {
  const out: Link[] = []
  const fileSets = topics.map(t => {
    const set = new Set<string>()
    for (const s of t.sessions) for (const f of s.filesTouched) set.add(f)
    return set
  })
  for (let i = 0; i < topics.length; i += 1) {
    for (let j = i + 1; j < topics.length; j += 1) {
      const a = topics[i]
      const b = topics[j]
      const fa = fileSets[i]
      const fb = fileSets[j]
      if (!a || !b || !fa || !fb) continue
      if (a.id === UNSORTED_ID || b.id === UNSORTED_ID) continue
      let via: string | undefined
      let best = -1
      for (const f of fa) {
        if (!fb.has(f)) continue
        const n = a.sessions.filter(s => s.filesTouched.includes(f)).length + b.sessions.filter(s => s.filesTouched.includes(f)).length
        if (n > best) {
          best = n
          via = f
        }
      }
      if (via !== undefined) out.push({ a: a.id, b: b.id, via: basenameOf(via) })
    }
  }
  return out
}

/** The whole model from the scan, the store and the settings. */
export function buildModel(
  sessions: readonly SessionSummary[],
  store: StoreData,
  settings: ClusterSettings,
  now: number,
  thisSessionId?: string,
): Model {
  const { topicOf, autoMembers } = assignTopics(sessions, store, settings.groupBasis)
  const rangeMs = settings.rangeDays >= ALL_TIME_DAYS ? Number.POSITIVE_INFINITY : settings.rangeDays * DAY_MS
  const views: SessionView[] = sessions.map(s => {
    const isPinned = store.pins[s.id] === true
    return {
      ...s,
      topicId: topicOf[s.id] ?? UNSORTED_ID,
      status: statusOf(s, store, now, thisSessionId),
      isPinned,
      isInRange: isPinned || now - s.lastAt <= rangeMs,
      note: store.notes[s.id],
    }
  })
  views.sort((a, b) => b.lastAt - a.lastAt)
  const grouped = new Map<string, SessionView[]>()
  for (const id of Object.keys(store.topics)) grouped.set(id, [])
  for (const v of views) {
    const list = grouped.get(v.topicId) ?? []
    list.push(v)
    grouped.set(v.topicId, list)
  }
  const topics: Topic[] = []
  for (const [id, list] of grouped) {
    if (id === UNSORTED_ID && list.length === 0) continue
    const record = store.topics[id]
    const isExplicit = record !== undefined
    if (!isExplicit && id !== UNSORTED_ID && !(id in autoMembers) && list.length === 0) continue
    const name =
      id === UNSORTED_ID ? UNSORTED_NAME : (record?.name ?? store.titles[id] ?? autoName(autoMembers[id] ?? list))
    const firstAt = list.reduce((m, s) => Math.min(m, s.startedAt), record?.createdAt ?? Number.POSITIVE_INFINITY)
    topics.push({
      id,
      name,
      color: MINOR_COLOR,
      isExplicit,
      isMajor: id !== UNSORTED_ID && isMajorTopic(list, settings, now),
      sessions: list,
      lastAt: list.reduce((m, s) => Math.max(m, s.lastAt), 0),
      firstAt: Number.isFinite(firstAt) ? firstAt : now,
    })
  }
  const ranked = [...topics].filter(t => t.id !== UNSORTED_ID).sort((a, b) => a.firstAt - b.firstAt || a.id.localeCompare(b.id))
  ranked.forEach((t, i) => {
    const stored = store.topics[t.id]?.color
    t.color = t.isMajor ? (stored ?? PALETTE[i % PALETTE.length] ?? ACCENT) : MINOR_COLOR
  })
  topics.sort((a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name))
  const byId: Record<string, SessionView> = {}
  for (const v of views) byId[v.id] = v
  const topicById: Record<string, Topic> = {}
  for (const t of topics) topicById[t.id] = t
  return { topics, links: linksOf(topics), sessions: views, byId, topicById }
}

/** The chain order of a topic's sessions in focus mode: by start time, oldest or newest first. */
export function orderChain(sessions: readonly SessionView[], numbering: Numbering): SessionView[] {
  const asc = [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  return numbering === 'newestFirst' ? asc.reverse() : asc
}

/** The session with the newest activity. */
export function latestOf(sessions: readonly SessionView[]): SessionView | undefined {
  return [...sessions].sort((a, b) => b.lastAt - a.lastAt)[0]
}

export type JoinScore = { topicId: string; score: number }
export type JoinSuggestion = { ranked: JoinScore[]; best?: JoinScore; isClear: boolean }

/**
 * Scores a prompt against each topic: its titles (x2), notes (x1) and file
 * basenames (x2). Clear when the best is at least 3 and at least twice the
 * second. Unsorted is never suggested.
 */
export function scoreJoin(prompt: string, topics: readonly Topic[]): JoinSuggestion {
  const words = new Set(tokensOf(prompt))
  const ranked: JoinScore[] = []
  for (const t of topics) {
    if (t.id === UNSORTED_ID) continue
    const titles = new Set<string>(tokensOf(t.name))
    const notes = new Set<string>()
    const files = new Set<string>()
    for (const s of t.sessions) {
      for (const w of tokensOf(s.title)) titles.add(w)
      for (const w of tokensOf(s.firstPrompt)) titles.add(w)
      if (s.note) for (const w of tokensOf(s.note.text)) notes.add(w)
      for (const f of s.filesTouched) for (const w of tokensOf(basenameOf(f).replace(/\.[a-z0-9]+$/i, ''))) files.add(w)
    }
    const score = sharedCount(words, titles) * 2 + sharedCount(words, notes) + sharedCount(words, files) * 2
    ranked.push({ topicId: t.id, score })
  }
  ranked.sort((a, b) => b.score - a.score)
  const best = ranked[0]
  const second = ranked[1]
  const isClear = !!best && best.score >= 3 && best.score >= 2 * (second?.score ?? 0)
  return { ranked, best: best && best.score > 0 ? best : undefined, isClear }
}

/** Topics a new session may join, most recently active first; never Unsorted. */
export function joinable(topics: readonly Topic[]): Topic[] {
  return topics.filter(t => t.id !== UNSORTED_ID)
}

/** The relative age of a timestamp: `2h`, `3d`, `now`. */
export function ageOf(at: number, now: number): string {
  const ms = Math.max(0, now - at)
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(ms / 3600000)
  if (hours < 24) return `${hours}h`
  const days = Math.round(ms / DAY_MS)
  if (days < 60) return `${days}d`
  return `${Math.round(days / 30)}mo`
}
