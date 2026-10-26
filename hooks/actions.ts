// Constellation: everything a press, a command or an event may do.
//
// Each function here is a top-level `$`-taking helper (what `claude plugin
// validate` asks of code that reaches the engine): it reads the atoms, changes
// the store through `saveStore` (which writes `$.store` and the mirror atom),
// and leaves a toast. `actionsFor($)` binds them for the drawing.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, PluginOptions, Timer } from 'claude-code'

import { UNSORTED_ID, ageOf, buildModel, cleanName, latestOf, orderChain, scoreJoin, topicIdFor } from './cluster'
import type { Model, SessionView, Topic } from './cluster'
import { clip, noteText } from './draw'
import type { Actions, View } from './draw'
import { placeTopics } from './layout'
import type { PlacedTopic } from './layout'
import { basenameOf, scanProject, slugOf } from './scan'
import { DEFAULT_SETTINGS, EMPTY_STORE, INITIAL_ME, INITIAL_SCAN, INITIAL_UI, INITIAL_USAGE, PANE, resolveSettings, settingValue } from './state'
import type { MapSettings, MeState, NoteRecord, SessionSummary, StoreData, UiState, UndoState, UsageState } from '../types'

// The atoms are declared where they are read, as `claude plugin validate` asks.
const sessionsAtom = atom({ plugin: 'constellation', key: 'sessions' } as const, [] as SessionSummary[], { shape: 'sessions-1' })
const storeAtom = atom({ plugin: 'constellation', key: 'store' } as const, EMPTY_STORE, { shape: 'store-2' })
const settingsAtom = atom({ plugin: 'constellation', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-1' })
const uiAtom = atom({ plugin: 'constellation', key: 'ui' } as const, INITIAL_UI, { shape: 'ui-2' })
const meAtom = atom({ plugin: 'constellation', key: 'me' } as const, INITIAL_ME, { shape: 'me-1' })
const scanAtom = atom({ plugin: 'constellation', key: 'scan' } as const, INITIAL_SCAN, { shape: 'scan-1' })
const undoAtom = atom({ plugin: 'constellation', key: 'undo' } as const, null as UndoState | null, { shape: 'undo-2' })
const usageAtom = atom({ plugin: 'constellation', key: 'usage' } as const, INITIAL_USAGE, { shape: 'usage-1' })

const STORE_KEYS = ['topics', 'assign', 'notes', 'archived', 'pins', 'titles', 'goals', 'seen'] as const
const NOTE_WORDS = 60
const NOTE_SYSTEM =
  'You write the handoff note a developer leaves for the next Claude Code session on the same topic. ' +
  `At most ${NOTE_WORDS} words of plain text, no preamble, no markdown: what was done, what is left, what to watch out for.`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cloneStore(s: StoreData): StoreData {
  return {
    topics: { ...s.topics },
    assign: { ...s.assign },
    notes: { ...s.notes },
    archived: { ...s.archived },
    pins: { ...s.pins },
    titles: { ...s.titles },
    goals: { ...s.goals },
    seen: { ...s.seen },
  }
}

/** One store key's value from `$.store`, kept only where it has the shape the key wants. */
function sanitise(key: (typeof STORE_KEYS)[number], value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!isRecord(value)) return out
  for (const [id, v] of Object.entries(value)) {
    if (key === 'topics' && isRecord(v) && typeof v.name === 'string') out[id] = { name: v.name, createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0, ...(typeof v.color === 'string' ? { color: v.color } : {}) }
    else if (key === 'notes' && isRecord(v) && typeof v.text === 'string') out[id] = { text: v.text, at: typeof v.at === 'number' ? v.at : 0, source: v.source === 'auto' ? 'auto' : 'manual' }
    else if ((key === 'assign' || key === 'titles' || key === 'goals') && typeof v === 'string') out[id] = v
    else if ((key === 'archived' || key === 'pins') && v === true) out[id] = true
    else if (key === 'seen' && typeof v === 'number') out[id] = v
  }
  return out
}

export async function loadStore($: EngineInterface): Promise<StoreData> {
  const next = cloneStore(EMPTY_STORE)
  for (const key of STORE_KEYS) {
    let value: unknown
    try {
      value = await $.store.get(key)
    } catch {
      value = undefined
    }
    ;(next as unknown as Record<string, unknown>)[key] = sanitise(key, value)
  }
  await update($, storeAtom, () => next)
  return next
}

/** Writes the keys that changed to `$.store` and the whole store to its atom. */
export async function saveStore($: EngineInterface, next: StoreData): Promise<void> {
  const current = await read($, storeAtom)
  for (const key of STORE_KEYS) {
    if (JSON.stringify(current[key]) === JSON.stringify(next[key])) continue
    try {
      await $.store.set(key, next[key])
    } catch (error) {
      $.ui.log(`constellation: ${key} not saved: ${String(error)}`, { to: 'debug' })
    }
  }
  await update($, storeAtom, () => next)
}

export async function loadSettings($: EngineInterface, options: PluginOptions): Promise<MapSettings> {
  let saved: unknown
  try {
    saved = await $.store.get('settings')
  } catch {
    saved = undefined
  }
  const settings = resolveSettings(options, saved)
  await update($, settingsAtom, () => settings)
  return settings
}

export async function setSetting($: EngineInterface, key: keyof MapSettings, value: unknown): Promise<void> {
  const clean = settingValue(key, value)
  if (clean === undefined) return
  const next: MapSettings = { ...(await read($, settingsAtom)) }
  ;(next as Record<string, unknown>)[key] = clean
  await update($, settingsAtom, () => next)
  try {
    await $.store.set('settings', next)
  } catch (error) {
    $.ui.log(`constellation: settings not saved: ${String(error)}`, { to: 'debug' })
  }
  if (key === 'scope') await rescan($)
}

/** The model of everything but this session, which the chain shows as "you". */
export function modelOf(sessions: readonly SessionSummary[], store: StoreData, settings: MapSettings, now: number, me: MeState): Model {
  return buildModel(
    sessions.filter(s => s.id !== me.sessionId),
    store,
    settings,
    now,
    me.sessionId,
  )
}

export function placementOf(model: Model): Record<string, PlacedTopic> {
  const out: Record<string, PlacedTopic> = {}
  for (const p of placeTopics(model.topics.map(t => ({ id: t.id, name: t.name, isMajor: t.isMajor })))) out[p.id] = p
  return out
}

export type Snapshot = { sessions: SessionSummary[]; store: StoreData; settings: MapSettings; ui: UiState; me: MeState; usage: UsageState; now: number; model: Model }

export async function snapshot($: EngineInterface): Promise<Snapshot> {
  const [sessions, store, settings, ui, me, usage, now] = await Promise.all([
    read($, sessionsAtom),
    read($, storeAtom),
    read($, settingsAtom),
    read($, uiAtom),
    read($, meAtom),
    read($, usageAtom),
    $.clock.now(),
  ])
  return { sessions, store, settings, ui, me, usage, now, model: modelOf(sessions, store, settings, now, me) }
}

/** What a render hook draws from; the reads subscribe the drawing. */
export async function viewOf($: EngineInterface, surface: string): Promise<View> {
  const snap = await snapshot($)
  const myNote = snap.store.notes[snap.me.sessionId]
  return {
    model: snap.model,
    placed: placementOf(snap.model),
    ui: snap.ui,
    me: snap.me,
    settings: snap.settings,
    usage: snap.usage,
    now: snap.now,
    surface,
    ...(myNote ? { myNote } : {}),
  }
}

export async function toast($: EngineInterface, text: string, options: { undo?: boolean; quiet?: boolean } = {}): Promise<void> {
  await update($, uiAtom, u => ({ ...u, toast: { text, hasUndo: options.undo === true } }))
  if (!options.quiet) $.ui.toast(text)
}

async function patchUi($: EngineInterface, patch: Partial<UiState>): Promise<void> {
  await update($, uiAtom, u => ({ ...u, ...patch }))
}

async function patchMe($: EngineInterface, patch: Partial<MeState>): Promise<void> {
  await update($, meAtom, m => ({ ...m, ...patch }))
}

async function recordUsage($: EngineInterface, usage: ModelUsage): Promise<void> {
  await update($, usageAtom, u => ({
    calls: u.calls + 1,
    inputTokens: u.inputTokens + usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: u.outputTokens + usage.output_tokens,
  }))
}

/** The status line: this session's topic and step, while it has one. */
export async function refreshStatus($: EngineInterface): Promise<void> {
  const snap = await snapshot($)
  const topic = snap.me.topicId ? snap.model.topicById[snap.me.topicId] : undefined
  if (!topic) {
    $.ui.status(undefined)
    return
  }
  const chain = orderChain(topic.sessions.filter(s => s.isInRange), snap.settings.numbering)
  const step = snap.settings.numbering === 'newestFirst' ? 1 : chain.length + 1
  $.ui.status(`◆ ${clip(topic.name, 24)} · step ${step}${snap.store.notes[snap.me.sessionId] ? ' · note ✓' : ''}`)
}

let scanTimer: Timer | undefined

/** Reads every transcript in scope (cached ones from the store) into the sessions atom. */
export async function rescan($: EngineInterface): Promise<void> {
  const settings = await read($, settingsAtom)
  const me = await read($, meAtom)
  await update($, scanAtom, s => ({ ...s, isScanning: true }))
  try {
    const { sessions, root } = await scanProject($, settings.scope, me.cwd)
    await update($, sessionsAtom, () => sessions)
    await update($, scanAtom, () => ({ isScanning: false, at: Date.now(), root, error: null }))
    if (settings.useModelForTitles) void nameAutoTopics($)
  } catch (error) {
    await update($, scanAtom, s => ({ ...s, isScanning: false, error: String(error) }))
    $.ui.log(`constellation: scan failed: ${String(error)}`, { to: 'debug' })
  }
}

export function scheduleRescan($: EngineInterface, ms = 3000): void {
  scanTimer?.cancel()
  scanTimer = $.clock.after(ms, () => {
    scanTimer = undefined
    void rescan($)
  })
}

/** The timer's rescan: only while the pane is shown. */
export async function periodicRescan($: EngineInterface): Promise<void> {
  try {
    const panes = await $.ui.panes()
    if (panes.some(p => p.id === PANE && p.isShown)) await rescan($)
  } catch {
    // no surface to ask
  }
}

/** Session start, and again after /clear or a resume: settings, store, this session's place, a scan. */
export async function bootstrap($: EngineInterface, options: PluginOptions, cwd: string): Promise<void> {
  let sessionId = ''
  try {
    sessionId = await $.session.id()
  } catch {
    sessionId = ''
  }
  await loadSettings($, options)
  const store = await loadStore($)
  const topicId = store.assign[sessionId] ?? null
  await update($, meAtom, () => ({ ...INITIAL_ME, sessionId, cwd, folder: basenameOf(cwd.replace(/[\\/]+$/, '')) || cwd, topicId, isBandHidden: topicId !== null }))
  await update($, uiAtom, () => INITIAL_UI)
  await update($, undoAtom, () => null)
  await update($, usageAtom, () => INITIAL_USAGE)
  await rescan($)
  await refreshStatus($)
}

/** The text a join or a pick-up puts beside the next prompt: only Claude reads it. */
export function handoffText(s: SessionView, topic: Topic | undefined, step: number | undefined, now: number): string {
  const where = topic ? `${step ? `step ${step} of ` : ''}${topic.name}, ` : ''
  const lines = [
    `[Constellation] Handoff note from the earlier session “${s.title}” (${where}${ageOf(s.lastAt, now)} ago${s.branch ? `, branch ${s.branch}` : ''}):`,
    noteText(s) || '(that session left no note)',
  ]
  if (topic?.goal) lines.push(`Topic goal: ${topic.goal}`)
  if (s.filesTouched.length) lines.push(`Files it touched: ${s.filesTouched.slice(0, 12).join(', ')}${s.filesTouched.length > 12 ? ', …' : ''}`)
  lines.push('This is background from a previous session on the same topic; the prompt above is what to do now.')
  return lines.join('\n')
}

function stepOf(snap: Snapshot, topic: Topic, sessionId: string): number | undefined {
  const i = orderChain(topic.sessions.filter(s => s.isInRange), snap.settings.numbering).findIndex(s => s.id === sessionId)
  return i >= 0 ? i + 1 : undefined
}

/** Makes an auto topic explicit: a record with its name and colour, and every current member assigned. */
function materialise(store: StoreData, topic: Topic, now: number): void {
  if (topic.id === UNSORTED_ID || store.topics[topic.id]) return
  store.topics[topic.id] = { name: topic.name, color: topic.color, createdAt: now }
  for (const s of topic.sessions) if (!store.assign[s.id]) store.assign[s.id] = topic.id
}

/** This session joins a topic: next numbered step, the topic's goal and latest note queued for the next prompt. */
export async function joinTopic($: EngineInterface, topicId: string, options: { quiet?: boolean; keepView?: boolean } = {}): Promise<void> {
  const snap = await snapshot($)
  const topic = snap.model.topicById[topicId]
  if (!topic || topicId === UNSORTED_ID) {
    await toast($, 'That topic is not on the map any more.')
    return
  }
  const next = cloneStore(snap.store)
  materialise(next, topic, snap.now)
  next.assign[snap.me.sessionId] = topicId
  await saveStore($, next)
  const latest = latestOf(topic.sessions)
  const step = snap.settings.numbering === 'newestFirst' ? 1 : topic.sessions.filter(s => s.isInRange).length + 1
  const note = latest ? handoffText(latest, topic, stepOf(snap, topic, latest.id), snap.now) : topic.goal ? `[Constellation] Topic goal for ${topic.name}: ${topic.goal}` : null
  await patchMe($, { topicId, suggested: null, isNewTopic: false, isBandHidden: true, pendingNote: note })
  if (!options.keepView) await patchUi($, { focusTopic: topicId, selected: null, hover: null, moveMode: false, mergeFrom: null })
  await toast(
    $,
    `Joined ${topic.name} as step ${step}.${latest ? ` Handoff note from “${clip(latest.title, 40)}” goes into your next prompt.` : ' No earlier note to pick up.'}`,
    { quiet: options.quiet },
  )
  await refreshStatus($)
}

/** `/topic <name>` and the chooser's new topic: joins the topic of that name, creating it when new. */
export async function createTopic($: EngineInterface, rawName: string): Promise<void> {
  const name = cleanName(rawName)
  if (!name) {
    await toast($, 'A topic needs a name.')
    return
  }
  const snap = await snapshot($)
  const id = topicIdFor(name)
  if (snap.model.topicById[id]) {
    await joinTopic($, id)
    return
  }
  const byName = snap.model.topics.find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== UNSORTED_ID)
  if (byName) {
    await joinTopic($, byName.id)
    return
  }
  const next = cloneStore(snap.store)
  next.topics[id] = { name, createdAt: snap.now }
  next.assign[snap.me.sessionId] = id
  await saveStore($, next)
  await patchMe($, { topicId: id, suggested: null, isNewTopic: false, isBandHidden: true, pendingNote: null })
  await patchUi($, { focusTopic: null, selected: null, hover: null })
  await toast($, `Started the topic ${name}. This session is its first step; later sessions can join it.`)
  await refreshStatus($)
}

export async function startNewTopic($: EngineInterface): Promise<void> {
  await patchMe($, { isNewTopic: true, isBandHidden: false })
}

export async function cancelNewTopic($: EngineInterface): Promise<void> {
  await patchMe($, { isNewTopic: false })
}

export async function changeTopic($: EngineInterface): Promise<void> {
  const snap = await snapshot($)
  const next = cloneStore(snap.store)
  delete next.assign[snap.me.sessionId]
  await saveStore($, next)
  await patchMe($, { topicId: null, isNewTopic: false, isBandHidden: false, pendingNote: null })
  await patchUi($, { focusTopic: null, selected: null })
  await refreshStatus($)
}

export async function dismissBand($: EngineInterface): Promise<void> {
  await patchMe($, { isBandHidden: true, isNewTopic: false })
}

export async function parkNote($: EngineInterface, text: string, source: NoteRecord['source'], options: { quiet?: boolean } = {}): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim()
  const snap = await snapshot($)
  if (!clean) {
    await patchMe($, { askNote: false })
    return
  }
  const next = cloneStore(snap.store)
  next.notes[snap.me.sessionId] = { text: clip(clean, 600), at: snap.now, source }
  await saveStore($, next)
  await patchMe($, { askNote: false })
  if (source === 'manual') await toast($, `Parked: “${clip(clean, 80)}”. Saved as this session’s handoff note for the next step.`, { quiet: options.quiet })
  await refreshStatus($)
}

export async function askForNote($: EngineInterface): Promise<void> {
  await patchMe($, { askNote: true })
}

export async function skipNote($: EngineInterface): Promise<void> {
  await patchMe($, { askNote: false })
}

/** Queues a session's note for the next prompt; joins its topic when this session has none. */
export async function pickUp($: EngineInterface, sessionId: string): Promise<void> {
  const snap = await snapshot($)
  const s = snap.model.byId[sessionId]
  if (!s) {
    await toast($, 'That session is not on the map any more.')
    return
  }
  const topic = snap.model.topicById[s.topicId]
  if (snap.me.topicId === null && topic && topic.id !== UNSORTED_ID) {
    await joinTopic($, topic.id, { quiet: true, keepView: true })
  }
  const note = handoffText(s, topic && topic.id !== UNSORTED_ID ? topic : undefined, topic ? stepOf(snap, topic, s.id) : undefined, snap.now)
  await patchMe($, { pendingNote: note })
  await toast($, `Handoff note from “${clip(s.title, 40)}” goes into your next prompt.`)
}

export async function pickUpLatest($: EngineInterface, topicId: string): Promise<void> {
  const snap = await snapshot($)
  const topic = snap.model.topicById[topicId]
  const latest = topic ? latestOf(topic.sessions) : undefined
  if (!latest) {
    await toast($, 'That topic has no session to pick up from yet.')
    return
  }
  await pickUp($, latest.id)
}

/** `/pickup [n]`: step n of the joined topic's chain, or its latest session. */
export async function pickUpStep($: EngineInterface, arg: string): Promise<string> {
  const snap = await snapshot($)
  const topic = snap.me.topicId ? snap.model.topicById[snap.me.topicId] : undefined
  if (!topic) return 'This session has not joined a topic yet. Use /topic <name>, or pick one in the band or /map.'
  const chain = orderChain(topic.sessions.filter(s => s.isInRange), snap.settings.numbering)
  const n = Number.parseInt(arg.trim(), 10)
  const target = arg.trim() === '' ? latestOf(topic.sessions) : chain[n - 1]
  if (!target) return `${topic.name} has ${chain.length} step${chain.length === 1 ? '' : 's'} in range; nothing at ${arg.trim()}.`
  await pickUp($, target.id)
  return `Handoff note from “${target.title}” (${arg.trim() === '' ? 'latest' : `step ${n}`} of ${topic.name}) goes into your next prompt.`
}

/** Fills the composer with a prompt drafted from a note; the person edits and sends it. */
export async function draftPrompt($: EngineInterface, sessionId: string | null): Promise<void> {
  const snap = await snapshot($)
  const topic = sessionId ? snap.model.topicById[snap.model.byId[sessionId]?.topicId ?? ''] : snap.me.topicId ? snap.model.topicById[snap.me.topicId] : undefined
  const s = sessionId ? snap.model.byId[sessionId] : topic ? latestOf(topic.sessions) : undefined
  if (!s) {
    await toast($, 'Nothing to draft from yet.')
    return
  }
  const name = topic && topic.id !== UNSORTED_ID ? topic.name : 'this work'
  const text = `Continue ${name} from “${s.title}”${topic?.goal ? ` (goal: ${clip(topic.goal, 120)})` : ''}. Last state: ${clip(noteText(s) || 'no note', 300)} Next step: `
  try {
    await $.prompt.fill({ text, mode: 'replace' })
    await toast($, 'Drafted the next prompt in the composer; edit it and send.', { quiet: true })
  } catch (error) {
    await toast($, `Could not fill the prompt: ${String(error)}`)
  }
}

export async function messageSession($: EngineInterface, sessionId: string, text: string): Promise<void> {
  const snap = await snapshot($)
  const s = snap.model.byId[sessionId]
  const body = text.trim()
  await patchUi($, { messageMode: false })
  if (!s || !body) return
  try {
    const sent = await $.session.send({ to: { sessionId }, text: body })
    await toast($, sent.isDelivered ? `Message sent to “${clip(s.title, 40)}”. Its reply arrives here.` : `Not delivered: ${sent.reason}. That session is not running.`)
  } catch (error) {
    await toast($, `Not delivered: ${String(error)}`)
  }
}

/** Opens a new Desktop session in the folder, seeded with the session's note, through the claude:// link. */
export async function newSessionFrom($: EngineInterface, sessionId: string): Promise<void> {
  const snap = await snapshot($)
  const s = snap.model.byId[sessionId]
  if (!s) return
  const topic = snap.model.topicById[s.topicId]
  const prompt = `Continue ${topic && topic.id !== UNSORTED_ID ? `the topic “${topic.name}”` : 'the work'} from the session “${s.title}”. ${clip(noteText(s), 500)}`
  const folder = s.cwd || snap.me.cwd
  const url = `claude://code/new?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(prompt)}`
  let argv: string[]
  const os = (await $.env.get('OS')) ?? ''
  if (/windows/i.test(os)) argv = ['rundll32', 'url.dll,FileProtocolHandler', url]
  else if (await $.fs.exists('/System/Library/CoreServices')) argv = ['open', url]
  else argv = ['xdg-open', url]
  try {
    const run = await $.process.run(argv, { timeoutMs: 10000 })
    if (run.exitCode === 0) await toast($, `Opening a new session on ${topic?.name ?? 'this topic'}, seeded from “${clip(s.title, 40)}”. Desktop asks you to confirm the folder.`)
    else await toast($, `Could not open the link (${argv[0]} exited ${run.exitCode}).`)
  } catch (error) {
    await toast($, `Could not open the link: ${String(error)}`)
  }
}

export async function togglePin($: EngineInterface, sessionId: string): Promise<void> {
  const snap = await snapshot($)
  const s = snap.model.byId[sessionId]
  if (!s) return
  const next = cloneStore(snap.store)
  if (next.pins[sessionId]) delete next.pins[sessionId]
  else next.pins[sessionId] = true
  await saveStore($, next)
  await toast($, `${next.pins[sessionId] ? 'Pinned' : 'Unpinned'} “${clip(s.title, 40)}”. Pinned sessions ignore the time range.`)
}

async function desktopArchiveServer($: EngineInterface): Promise<string | undefined> {
  try {
    for (const t of await $.tool.list()) {
      const m = /^mcp__(.+)__archive_session$/.exec(t.name)
      if (m) return m[1]
    }
  } catch {
    return undefined
  }
  return undefined
}

async function rememberUndo($: EngineInterface, label: string, before: StoreData): Promise<void> {
  await update($, undoAtom, () => ({ label, store: before }))
}

export async function toggleArchive($: EngineInterface, sessionId: string): Promise<void> {
  const snap = await snapshot($)
  const s = snap.model.byId[sessionId]
  if (!s) return
  const next = cloneStore(snap.store)
  const isArchiving = !next.archived[sessionId]
  if (isArchiving) next.archived[sessionId] = true
  else delete next.archived[sessionId]
  await rememberUndo($, isArchiving ? 'Undo archive' : 'Undo unarchive', snap.store)
  await saveStore($, next)
  await toast($, `${isArchiving ? 'Archived' : 'Unarchived'} “${clip(s.title, 40)}”.`, { undo: true })
  if (!isArchiving) return
  const server = await desktopArchiveServer($)
  if (!server) return
  try {
    const answer = await $.ui.ask(`Also archive “${clip(s.title, 40)}” in the Desktop sidebar?`, ['Archive there too', 'Only on the map'])
    if (answer !== 'Archive there too') return
    const result = await $.mcp.call(server, 'archive_session', { session_id: sessionId })
    if (result.isError) await toast($, 'The Desktop did not archive it.')
  } catch {
    // dismissed, or no dialog here
  }
}

/** Archives a topic's idle sessions but the latest, asking per session. */
export async function tidyTopic($: EngineInterface, topicId: string): Promise<void> {
  const snap = await snapshot($)
  const topic = snap.model.topicById[topicId]
  if (!topic) return
  const latest = latestOf(topic.sessions)
  const targets = topic.sessions.filter(s => s.status === 'idle' && (!latest || s.id !== latest.id))
  if (targets.length === 0) {
    await toast($, `Nothing to tidy in ${topic.name}.`)
    return
  }
  const next = cloneStore(snap.store)
  let n = 0
  for (const s of targets) {
    let answer: string
    try {
      answer = await $.ui.ask(`Archive “${clip(s.title, 50)}” (${ageOf(s.lastAt, snap.now)} ago, ${topic.name})?`, ['Archive', 'Keep', 'Stop'])
    } catch {
      break
    }
    if (answer === 'Stop') break
    if (answer !== 'Archive') continue
    next.archived[s.id] = true
    n += 1
  }
  if (n === 0) {
    await toast($, `Nothing archived in ${topic.name}.`)
    return
  }
  await rememberUndo($, 'Undo tidy', snap.store)
  await saveStore($, next)
  await toast($, `Archived ${n} idle session${n === 1 ? '' : 's'} in ${topic.name}.`, { undo: true })
}

export async function setMoveMode($: EngineInterface, on: boolean): Promise<void> {
  const snap = await snapshot($)
  const s = snap.ui.selected ? snap.model.byId[snap.ui.selected] : undefined
  if (!on || !s) {
    await patchUi($, { moveMode: false })
    return
  }
  await patchUi($, { moveMode: true, mergeFrom: null, focusTopic: null, hover: null, showSettings: false })
  await toast($, `Pick a topic on the map to move “${clip(s.title, 40)}”.`, { quiet: true })
}

export async function moveSelected($: EngineInterface, topicId: string): Promise<void> {
  const snap = await snapshot($)
  const s = snap.ui.selected ? snap.model.byId[snap.ui.selected] : undefined
  const target = snap.model.topicById[topicId]
  if (!s || !target) {
    await patchUi($, { moveMode: false })
    return
  }
  if (s.topicId === topicId) {
    await patchUi($, { moveMode: false })
    await toast($, `“${clip(s.title, 40)}” is already in ${target.name}.`)
    return
  }
  const next = cloneStore(snap.store)
  const from = snap.model.topicById[s.topicId]
  if (from) materialise(next, from, snap.now)
  materialise(next, target, snap.now)
  next.assign[s.id] = topicId
  await rememberUndo($, 'Undo move', snap.store)
  await saveStore($, next)
  await patchUi($, { moveMode: false, selected: null })
  await toast($, `Moved “${clip(s.title, 40)}” to ${target.name}.`, { undo: true })
}

export async function setEditing($: EngineInterface, kind: UiState['editing']): Promise<void> {
  await patchUi($, { editing: kind })
}

/** Renames a topic (an auto topic becomes explicit first). */
export async function renameTopic($: EngineInterface, topicId: string, rawName: string): Promise<void> {
  const name = cleanName(rawName)
  const snap = await snapshot($)
  const topic = snap.model.topicById[topicId]
  await patchUi($, { editing: null })
  if (!topic || topicId === UNSORTED_ID || !name) return
  const next = cloneStore(snap.store)
  materialise(next, topic, snap.now)
  const record = next.topics[topicId]
  if (!record) return
  next.topics[topicId] = { ...record, name }
  await rememberUndo($, 'Undo rename', snap.store)
  await saveStore($, next)
  await toast($, `Renamed ${topic.name} to ${name}.`, { undo: true })
  await refreshStatus($)
}

/** Sets or clears a topic's goal; it travels with every handoff on the topic. */
export async function setGoal($: EngineInterface, topicId: string, rawGoal: string): Promise<void> {
  const goal = rawGoal.replace(/\s+/g, ' ').trim()
  const snap = await snapshot($)
  const topic = snap.model.topicById[topicId]
  await patchUi($, { editing: null })
  if (!topic || topicId === UNSORTED_ID) return
  const next = cloneStore(snap.store)
  materialise(next, topic, snap.now)
  if (goal) next.goals[topicId] = clip(goal, 300)
  else delete next.goals[topicId]
  await saveStore($, next)
  await toast($, goal ? `Goal set for ${topic.name}. It goes with every handoff on this topic.` : `Goal cleared for ${topic.name}.`)
}

export async function setTopicColor($: EngineInterface, topicId: string, color: string): Promise<void> {
  const snap = await snapshot($)
  const topic = snap.model.topicById[topicId]
  if (!topic || topicId === UNSORTED_ID || !/^#[0-9a-f]{6}$/i.test(color)) return
  const next = cloneStore(snap.store)
  materialise(next, topic, snap.now)
  const record = next.topics[topicId]
  if (!record) return
  next.topics[topicId] = { ...record, color }
  await saveStore($, next)
}

export async function setMergeMode($: EngineInterface, topicId: string | null): Promise<void> {
  const snap = await snapshot($)
  const topic = topicId ? snap.model.topicById[topicId] : undefined
  if (!topic || topicId === UNSORTED_ID) {
    await patchUi($, { mergeFrom: null })
    return
  }
  await patchUi($, { mergeFrom: topicId, moveMode: false, focusTopic: null, selected: null, hover: null, editing: null, showSettings: false })
  await toast($, `Pick the topic to merge ${topic.name} into.`, { quiet: true })
}

/** Moves every session of the merging topic into the target and drops the merged topic's record. */
export async function mergeInto($: EngineInterface, targetId: string): Promise<void> {
  const snap = await snapshot($)
  const from = snap.ui.mergeFrom ? snap.model.topicById[snap.ui.mergeFrom] : undefined
  const target = snap.model.topicById[targetId]
  await patchUi($, { mergeFrom: null })
  if (!from || !target) return
  if (from.id === target.id) {
    await toast($, `${from.name} cannot merge into itself.`)
    return
  }
  const next = cloneStore(snap.store)
  materialise(next, target, snap.now)
  for (const s of from.sessions) next.assign[s.id] = targetId === UNSORTED_ID ? UNSORTED_ID : targetId
  if (snap.me.topicId === from.id) next.assign[snap.me.sessionId] = targetId
  if (targetId !== UNSORTED_ID && !next.goals[targetId] && next.goals[from.id]) next.goals[targetId] = next.goals[from.id] ?? ''
  delete next.topics[from.id]
  delete next.goals[from.id]
  delete next.titles[from.id]
  await rememberUndo($, 'Undo merge', snap.store)
  await saveStore($, next)
  if (snap.me.topicId === from.id) await patchMe($, { topicId: targetId === UNSORTED_ID ? null : targetId })
  await toast($, `Merged ${from.name} into ${target.name}: ${from.sessions.length} session${from.sessions.length === 1 ? '' : 's'} moved.`, { undo: true })
  await refreshStatus($)
}

export async function undoLast($: EngineInterface): Promise<void> {
  const undo = await read($, undoAtom)
  if (!undo) return
  await saveStore($, undo.store)
  await update($, undoAtom, () => null)
  const me = await read($, meAtom)
  const assigned = undo.store.assign[me.sessionId] ?? null
  if (assigned !== me.topicId) await patchMe($, { topicId: assigned === UNSORTED_ID ? null : assigned })
  await toast($, 'Undone.')
  await refreshStatus($)
}

export async function focusTopic($: EngineInterface, id: string | null): Promise<void> {
  const snap = await snapshot($)
  if (snap.ui.mergeFrom !== null && id) {
    await mergeInto($, id)
    return
  }
  if (snap.ui.moveMode && id && snap.ui.selected) {
    await moveSelected($, id)
    return
  }
  await patchUi($, { focusTopic: id, selected: null, hover: null, showSettings: false, messageMode: false, editing: null })
}

/** Esc, the back button, the close mark: one level out, or nothing left to back out of. */
export function backedOut(ui: UiState): UiState | null {
  if (ui.editing) return { ...ui, editing: null }
  if (ui.messageMode) return { ...ui, messageMode: false }
  if (ui.mergeFrom !== null) return { ...ui, mergeFrom: null }
  if (ui.moveMode) return { ...ui, moveMode: false }
  if (ui.selected) return { ...ui, selected: null }
  if (ui.focusTopic) return { ...ui, focusTopic: null, hover: null }
  if (ui.showSettings) return { ...ui, showSettings: false }
  return null
}

export async function back($: EngineInterface): Promise<boolean> {
  const ui = await read($, uiAtom)
  const next = backedOut(ui)
  if (!next) return false
  await update($, uiAtom, () => next)
  return true
}

/** The suggestion for the first prompt: marks the best topic, or joins it when auto-join is on and the match is clear. */
export async function suggestFor($: EngineInterface, prompt: string): Promise<{ joined: boolean }> {
  const snap = await snapshot($)
  const s = scoreJoin(prompt, snap.model.topics)
  if (!s.best) return { joined: false }
  if (snap.settings.autoJoin === 'auto' && s.isClear) {
    await joinTopic($, s.best.topicId)
    return { joined: true }
  }
  await patchMe($, { suggested: s.best.topicId, isBandHidden: false })
  return { joined: false }
}

/** The "since your last look" line for the pane, and the slug's seen time moved to now. */
export async function openDigest($: EngineInterface): Promise<void> {
  const snap = await snapshot($)
  const slug = slugOf(snap.me.cwd)
  const seen = snap.store.seen[slug]
  const fresh = snap.model.sessions.filter(s => seen === undefined || s.lastAt > seen)
  let digest: string
  if (seen === undefined) {
    digest = `First look at ${snap.me.folder}: ${snap.model.sessions.length} session${snap.model.sessions.length === 1 ? '' : 's'} across ${snap.model.topics.filter(t => t.id !== UNSORTED_ID).length} topic${snap.model.topics.filter(t => t.id !== UNSORTED_ID).length === 1 ? '' : 's'}.`
  } else if (fresh.length === 0) {
    digest = `Nothing new since your last look (${ageOf(seen, snap.now)} ago).`
  } else {
    const newest = fresh[0]
    const topic = newest ? snap.model.topicById[newest.topicId] : undefined
    digest = `Since your last look (${ageOf(seen, snap.now)} ago): ${fresh.length} session${fresh.length === 1 ? '' : 's'} new or updated · newest: ${clip(newest?.title ?? '', 40)}${topic && topic.id !== UNSORTED_ID ? ` (${topic.name})` : ''}${newest && noteText(newest) ? ` · ${clip(noteText(newest), 90)}` : ''}`
  }
  await patchUi($, { digest })
  const next = cloneStore(snap.store)
  next.seen[slug] = snap.now
  await saveStore($, next)
}

let noteTimer: Timer | undefined

export function scheduleNote($: EngineInterface, ms = 2000): void {
  noteTimer?.cancel()
  noteTimer = $.clock.after(ms, () => {
    noteTimer = undefined
    void generateNote($)
  })
}

/** One haiku call over the last 20 messages: a note of at most 60 words, saved as this session's. */
export async function generateNote($: EngineInterface): Promise<void> {
  try {
    const messages = await $.session.messages()
    const recent = messages.slice(-20).filter(m => m.text.trim() !== '' || m.toolUses.length > 0)
    if (recent.length === 0) return
    let transcript = recent
      .map(m => {
        const tools = [...new Set(m.toolUses.map(t => t.tool))]
        return `${m.role === 'user' ? 'User' : 'Assistant'}: ${clip(m.text, 500)}${tools.length ? ` [used ${tools.join(', ')}]` : ''}`
      })
      .join('\n')
    if (transcript.length > 8000) transcript = transcript.slice(-8000)
    const r = await $.model.complete({ model: 'haiku', system: NOTE_SYSTEM, prompt: `${transcript}\n\nWrite the handoff note now.`, maxTokens: 120, timeoutMs: 20000, effort: 'low' })
    await recordUsage($, r.usage)
    if (!r.isAnswered) {
      $.ui.log(`constellation: note not written: ${r.reason}`, { to: 'debug' })
      return
    }
    const text = r.text.replace(/\s+/g, ' ').trim()
    if (text) await parkNote($, text, 'auto', { quiet: true })
  } catch (error) {
    $.ui.log(`constellation: note failed: ${String(error)}`, { to: 'debug' })
  }
}

/** Names up to five unnamed auto topics with one 30-token haiku call each; the names are cached in the store. */
export async function nameAutoTopics($: EngineInterface): Promise<void> {
  const snap = await snapshot($)
  const pending = snap.model.topics.filter(t => t.id.startsWith('auto:') && !snap.store.titles[t.id] && !snap.store.topics[t.id]).slice(0, 5)
  for (const t of pending) {
    const titles = t.sessions.slice(0, 8).map(s => s.title).join('; ')
    try {
      const r = await $.model.complete({
        model: 'haiku',
        prompt: `Session titles: ${titles}\n\nName the topic these sessions share in two or three words, Title Case, no punctuation, nothing else.`,
        maxTokens: 30,
        timeoutMs: 15000,
        effort: 'low',
      })
      await recordUsage($, r.usage)
      if (!r.isAnswered) continue
      const name = cleanName(r.text.replace(/["'.\n]/g, ' ')).slice(0, 40)
      if (!name) continue
      const store = cloneStore(await read($, storeAtom))
      store.titles[t.id] = name
      await saveStore($, store)
    } catch (error) {
      $.ui.log(`constellation: topic not named: ${String(error)}`, { to: 'debug' })
    }
  }
}

/** `/topic` with no name: where this session stands and what it could join. */
export async function describeTopics($: EngineInterface): Promise<string> {
  const snap = await snapshot($)
  const mine = snap.me.topicId ? snap.model.topicById[snap.me.topicId] : undefined
  const lines = [mine ? `This session is in ${mine.name}.` : 'This session has no topic yet.']
  const topics = snap.model.topics.filter(t => t.id !== UNSORTED_ID)
  if (topics.length) lines.push(`Topics in ${snap.me.folder}: ${topics.map(t => `${t.name} (${t.sessions.length})`).join(', ')}.`)
  lines.push('/topic <name> joins or creates one; /map opens the map.')
  return lines.join(' ')
}

/** `/map export [path]`: the folder's topics, goals and notes as Markdown, for a handover to a person. */
export async function exportMarkdown($: EngineInterface, rawPath: string): Promise<string> {
  const snap = await snapshot($)
  const path = rawPath.trim() || 'constellation-map.md'
  const day = (at: number) => new Date(at).toISOString().slice(0, 10)
  const lines = [`# Constellation map of ${snap.me.folder}`, '', `Generated ${day(snap.now)} · ${snap.model.sessions.length} sessions · ${snap.model.topics.filter(t => t.id !== UNSORTED_ID).length} topics`, '']
  for (const t of snap.model.topics) {
    lines.push(`## ${t.name} (${t.sessions.length} session${t.sessions.length === 1 ? '' : 's'}${t.isMajor ? '' : ', minor'})`, '')
    if (t.goal) lines.push(`Goal: ${t.goal}`, '')
    const chain = orderChain(t.sessions, snap.settings.numbering)
    chain.forEach((s, i) => {
      lines.push(`${i + 1}. ${day(s.lastAt)} · ${s.title}${s.status === 'archived' ? ' (archived)' : ''}${s.branch ? ` · ${s.branch}` : ''}`)
      const note = noteText(s)
      if (note) lines.push(`   ${note}`)
      if (s.filesTouched.length) lines.push(`   Files: ${s.filesTouched.slice(0, 10).join(', ')}`)
    })
    lines.push('')
  }
  try {
    await $.fs.write(path, `${lines.join('\n')}\n`)
    return `Wrote ${path} (${snap.model.topics.length} topics).`
  } catch (error) {
    return `Could not write ${path}: ${String(error)}`
  }
}

/** The drawing's presses, bound to `$`. */
export function actionsFor($: EngineInterface): Actions {
  return {
    setView: view => void patchUi($, { view }),
    focusTopic: id => void focusTopic($, id),
    selectSession: id => void patchUi($, { selected: id, messageMode: false, showSettings: false, editing: null, moveMode: id === null ? false : undefined }),
    setQuery: q => void patchUi($, { query: q }),
    setRange: days => void setSetting($, 'rangeDays', days),
    toggleSettings: () => void update($, uiAtom, u => ({ ...u, showSettings: !u.showSettings, selected: null, editing: null })),
    setSetting: (key, value) => void setSetting($, key, value),
    join: topicId => void joinTopic($, topicId),
    newTopic: () => void startNewTopic($),
    createTopic: name => void createTopic($, name),
    cancelNewTopic: () => void cancelNewTopic($),
    changeTopic: () => void changeTopic($),
    dismissBand: () => void dismissBand($),
    pickUp: sessionId => void pickUp($, sessionId),
    pickUpLatest: topicId => void pickUpLatest($, topicId),
    draft: sessionId => void draftPrompt($, sessionId),
    parkPrompt: () => void askForNote($),
    park: text => void parkNote($, text, 'manual'),
    skipNote: () => void skipNote($),
    message: (sessionId, text) => void messageSession($, sessionId, text),
    messageMode: on => void patchUi($, { messageMode: on }),
    newSession: sessionId => void newSessionFrom($, sessionId),
    pin: sessionId => void togglePin($, sessionId),
    archive: sessionId => void toggleArchive($, sessionId),
    tidy: topicId => void tidyTopic($, topicId),
    moveMode: on => void setMoveMode($, on),
    moveTo: topicId => void moveSelected($, topicId),
    edit: kind => void setEditing($, kind),
    rename: (topicId, name) => void renameTopic($, topicId, name),
    setGoal: (topicId, goal) => void setGoal($, topicId, goal),
    setColor: (topicId, color) => void setTopicColor($, topicId, color),
    mergeMode: topicId => void setMergeMode($, topicId),
    mergeInto: targetId => void mergeInto($, targetId),
    undo: () => void undoLast($),
    dismissToast: () => void patchUi($, { toast: null }),
    dismissDigest: () => void patchUi($, { digest: null }),
    back: () => void back($),
  }
}
