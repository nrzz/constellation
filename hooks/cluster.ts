// Constellation: topics, links, status, join suggestions and chain order.
//
// A folder is only the scope of the map, never a topic. A topic is a named
// chain of sessions inside a folder, ordered by time. Branch is a weak hint,
// never a bucket. Assignment, in priority order: an explicit `assign` (a join,
// `/topic`, a move), then auto-clustering of the rest (union-find over shared
// title tokens, shared files, a shared non-main branch), then "Unsorted".
// Everything here is pure: the store's data and the clock come in as values.
import { basenameOf, isNoiseFile } from './scan'
import type { SessionSummary } from './scan'
import type { NoteRecord, StoreData } from '../types'

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

export const EMPTY_STORE: StoreData = { topics: {}, assign: {}, notes: {}, archived: {}, pins: {}, titles: {}, goals: {}, seen: {} }

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
  /** The topic's standing objective, when one is set. */
  goal?: string
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

/** A word, a file or a branch that more than this many sessions share says nothing about a topic: the project's own name, "bug", its README. A topic may still hold most of a small folder. */
export function commonBound(n: number): number {
  return Math.max(4, Math.floor(n * 0.6))
}

export type Signals = { tokens: Set<string>; files: Set<string>; branch: string }

const NO_SIGNALS: Signals = { tokens: new Set(), files: new Set(), branch: '' }

/**
 * Each session's distinguishing signals: the words of its title and first
 * prompt, its touched files (noise files aside) and its non-main branch, each
 * kept only while fewer than `commonBound` sessions share it. A large stub
 * has none, so its placeholder title clusters nothing.
 */
export function signalsOf(sessions: readonly SessionSummary[]): Map<string, Signals> {
  const bound = commonBound(sessions.length)
  const raw = sessions.map(s => ({
    id: s.id,
    tokens: s.large ? new Set<string>() : new Set([...tokensOf(s.title), ...tokensOf(s.firstPrompt)]),
    files: new Set(s.large ? [] : s.filesTouched.filter(f => !isNoiseFile(f))),
    branch: s.large || isPlainBranch(s.branch) ? '' : s.branch.trim().toLowerCase(),
  }))
  const frequency = (pick: (r: (typeof raw)[number]) => Iterable<string>) => {
    const m = new Map<string, number>()
    for (const r of raw) for (const x of pick(r)) m.set(x, (m.get(x) ?? 0) + 1)
    return m
  }
  const tokenDf = frequency(r => r.tokens)
  const fileDf = frequency(r => r.files)
  const branchDf = frequency(r => (r.branch ? [r.branch] : []))
  const out = new Map<string, Signals>()
  for (const r of raw) {
    out.set(r.id, {
      tokens: new Set([...r.tokens].filter(t => (tokenDf.get(t) ?? 0) <= bound)),
      files: new Set([...r.files].filter(f => (fileDf.get(f) ?? 0) <= bound)),
      branch: r.branch && (branchDf.get(r.branch) ?? 0) <= bound ? r.branch : '',
    })
  }
  return out
}

/** How far two sessions' signals agree: a shared file 2 (two at most), a shared word 1 (three at most), a shared branch 2. */
export function relationOf(a: Signals, b: Signals): number {
  let score = Math.min(2, sharedCount(a.files, b.files)) * 2
  score += Math.min(3, sharedCount(a.tokens, b.tokens))
  if (a.branch && a.branch === b.branch) score += 2
  return score
}

/** Two sessions belong together from a score of 2: a shared rare file, two shared rare words, or a shared rare branch. */
export const RELATED_AT = 2

/** The share of a cluster's members a session must relate to in order to join it: average linkage, so chains never fuse into one blob. */
export const LINKAGE = 0.34

/** How many of a cluster's members a session must relate to: one while the cluster is small, a `LINKAGE` share once it has grown. */
export function neededLinks(size: number): number {
  return size <= 3 ? 1 : Math.ceil(size * LINKAGE)
}

/** Why two sessions belong together, if they do, judged on their own. */
export function areRelated(a: SessionSummary, b: SessionSummary): boolean {
  const signals = signalsOf([a, b])
  const sa = signals.get(a.id)
  const sb = signals.get(b.id)
  return sa !== undefined && sb !== undefined && relationOf(sa, sb) >= RELATED_AT
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
 * Assigns every session a topic id. Explicit assignments first: their
 * sessions seed one cluster per explicit topic and never move. Then the
 * rest, oldest first: each joins the cluster it relates to best, when it
 * relates to at least a `LINKAGE` share of that cluster's members (so one
 * shared word never chains a folder into a blob), else it starts a cluster.
 * A cluster of one is Unsorted; a large stub is always Unsorted. Returns the
 * id per session and the auto topics' member lists.
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
  const byStart = [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  const signals = signalsOf(byStart)
  type Cluster = { explicitId?: string; members: SessionSummary[]; signals: Signals[] }
  const clusters: Cluster[] = []
  const explicitClusters = new Map<string, Cluster>()
  for (const s of byStart) {
    const t = explicit(s)
    if (!t) continue
    let c = explicitClusters.get(t)
    if (!c) {
      c = { explicitId: t, members: [], signals: [] }
      explicitClusters.set(t, c)
      clusters.push(c)
    }
    c.members.push(s)
    c.signals.push(signals.get(s.id) ?? NO_SIGNALS)
  }
  for (const s of byStart) {
    if (explicit(s)) continue
    if (s.large) {
      topicOf[s.id] = UNSORTED_ID
      continue
    }
    const sig = signals.get(s.id) ?? NO_SIGNALS
    let best: Cluster | undefined
    let bestShare = 0
    let bestRelated = 0
    for (const c of clusters) {
      const related = c.signals.filter(x => relationOf(sig, x) >= RELATED_AT).length
      if (related < neededLinks(c.members.length)) continue
      const share = related / c.members.length
      if (share > bestShare || (share === bestShare && related > bestRelated)) {
        best = c
        bestShare = share
        bestRelated = related
      }
    }
    if (best) {
      best.members.push(s)
      best.signals.push(sig)
    } else {
      clusters.push({ members: [s], signals: [sig] })
    }
  }
  const autoMembers: Record<string, SessionSummary[]> = {}
  for (const c of clusters) {
    if (c.explicitId) {
      for (const s of c.members) topicOf[s.id] = explicit(s) ?? c.explicitId
      continue
    }
    if (c.members.length < 2) {
      for (const s of c.members) topicOf[s.id] = UNSORTED_ID
      continue
    }
    const earliest = c.members[0]
    if (!earliest) continue
    const id = `auto:${earliest.id}`
    autoMembers[id] = c.members
    for (const s of c.members) topicOf[s.id] = id
  }
  return { topicOf, autoMembers }
}

/** Links between topics: a shared touched file (noise files and files most of the folder edits aside), the most-shared one as the label. */
export function linksOf(topics: readonly Topic[]): Link[] {
  const out: Link[] = []
  const signals = signalsOf(topics.flatMap(t => t.sessions))
  const fileSets = topics.map(t => {
    const set = new Set<string>()
    for (const s of t.sessions) for (const f of signals.get(s.id)?.files ?? []) set.add(f)
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
    const goal = store.goals[id]
    topics.push({
      id,
      name,
      color: MINOR_COLOR,
      ...(goal ? { goal } : {}),
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
    const notes = new Set<string>(t.goal ? tokensOf(t.goal) : [])
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
