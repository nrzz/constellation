// Constellation: the initial values of the `$.state` atoms and the settings' defaults.
// (Each module declares the atoms it reads itself: `claude plugin validate` reads
// them off the file that calls `read` and `update`.)
import type { PluginOptions } from 'claude-code'

import type { MapSettings, MeState, ScanState, StoreData, UiState, UsageState } from '../types'

export const PANE = 'constellation'
export const PLUGIN = 'constellation'

export const DEFAULT_SETTINGS: MapSettings = {
  scope: 'folder',
  groupBasis: 'auto',
  majorRule: 'either',
  majorMinSessions: 3,
  recentDays: 7,
  numbering: 'oldestFirst',
  showRelated: true,
  handoffNotes: 'auto',
  autoJoin: 'suggest',
  rangeDays: 30,
  useModelForTitles: false,
  openOnStart: 'band',
  fieldBackground: 'transparent',
  pictureClicks: 'on',
}

export const EMPTY_STORE: StoreData = { topics: {}, assign: {}, notes: {}, archived: {}, pins: {}, titles: {}, goals: {}, seen: {} }

export const INITIAL_UI: UiState = {
  view: 'map',
  focusTopic: null,
  selected: null,
  hover: null,
  query: '',
  showSettings: false,
  moveMode: false,
  messageMode: false,
  editing: null,
  mergeFrom: null,
  digest: null,
  toast: null,
  showHelp: false,
  showAdvanced: false,
}

export const INITIAL_ME: MeState = {
  sessionId: '',
  cwd: '',
  folder: '',
  topicId: null,
  suggested: null,
  isNewTopic: false,
  isBandHidden: false,
  pendingNote: null,
  prompts: 0,
  askNote: false,
}

export const INITIAL_SCAN: ScanState = { isScanning: false, at: 0, root: '', error: null }
export const INITIAL_USAGE: UsageState = { calls: 0, inputTokens: 0, outputTokens: 0 }

const CHOICES: { [K in keyof MapSettings]: readonly MapSettings[K][] | 'number' | 'boolean' } = {
  scope: ['folder', 'all'],
  groupBasis: ['auto', 'manual'],
  majorRule: ['either', 'count', 'recent'],
  majorMinSessions: 'number',
  recentDays: 'number',
  numbering: ['oldestFirst', 'newestFirst'],
  showRelated: 'boolean',
  handoffNotes: ['auto', 'manual', 'ask'],
  autoJoin: ['suggest', 'auto', 'off'],
  rangeDays: 'number',
  useModelForTitles: 'boolean',
  openOnStart: ['band', 'pane', 'none'],
  fieldBackground: ['transparent', 'night'],
  pictureClicks: ['on', 'outline', 'off'],
}

const RANGES: Partial<Record<keyof MapSettings, [number, number]>> = {
  majorMinSessions: [1, 20],
  recentDays: [1, 90],
  rangeDays: [1, 45],
}

/** One setting's value from an untyped source, or `undefined` when it does not fit. */
export function settingValue<K extends keyof MapSettings>(key: K, value: unknown): MapSettings[K] | undefined {
  const choice = CHOICES[key]
  if (choice === 'number') {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    if (!Number.isFinite(n)) return undefined
    const [min, max] = RANGES[key] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
    return Math.min(max, Math.max(min, Math.round(n))) as MapSettings[K]
  }
  if (choice === 'boolean') {
    if (typeof value === 'boolean') return value as MapSettings[K]
    if (value === 'true' || value === 'false') return (value === 'true') as MapSettings[K]
    return undefined
  }
  return (choice as readonly unknown[]).includes(value) ? (value as MapSettings[K]) : undefined
}

/** The settings: the defaults, under the manifest's options, under what the pane saved to the store. */
export function resolveSettings(options: PluginOptions, saved: unknown): MapSettings {
  const out: MapSettings = { ...DEFAULT_SETTINGS }
  const layers: unknown[] = [options, saved]
  for (const layer of layers) {
    if (typeof layer !== 'object' || layer === null) continue
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof MapSettings)[]) {
      const value = settingValue(key, (layer as Record<string, unknown>)[key])
      if (value !== undefined) (out as Record<string, unknown>)[key] = value
    }
  }
  return out
}

/** `2h 10m`, `45m`, `3d 2h`: how long a session ran. */
export function durationOf(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
