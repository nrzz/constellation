// Constellation: the initial values of the `$.state` atoms and the settings' defaults.
// (Each module declares the atoms it reads itself: `claude plugin validate` reads
// them off the file that calls `read` and `update`.)
import type { PluginOptions } from 'claude-code'

import type { MeState, ScanState, MapSettings, StoreData, UiState } from '../types'

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
}

export const EMPTY_STORE: StoreData = { topics: {}, assign: {}, notes: {}, archived: {}, pins: {}, titles: {} }

export const INITIAL_UI: UiState = {
  view: 'map',
  focusTopic: null,
  selected: null,
  hover: null,
  query: '',
  showSettings: false,
  moveMode: false,
  messageMode: false,
  toast: null,
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
