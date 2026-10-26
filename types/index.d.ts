// Constellation's contract: every value the hooks module keeps in `$.state`,
// declared under the plugin's name, and the data types the modules share.
// `claude plugin validate` holds each `atom({ plugin: 'constellation', key })`
// in the module to this file. Values that may change shape across versions
// are declared `Shaped<T>` and written under a shape tag, so old stored
// values are declined after a reload rather than misread.

/** What the map keeps of one session (hooks/scan.ts). */
export type SessionSummary = {
  id: string
  cwd: string
  slug: string
  branch: string
  firstPrompt: string
  title: string
  startedAt: number
  lastAt: number
  turns: number
  filesTouched: string[]
  lastAssistantText: string
  size: number
  mtimeMs: number
  large?: true
}

/** A transcript read and found to hold no conversation row yet. */
export type EmptyMarker = { id: string; size: number; mtimeMs: number; isEmpty: true }

export type TopicRecord = { name: string; color?: string; createdAt: number }
export type NoteRecord = { text: string; at: number; source: 'manual' | 'auto' }

/** What the mod keeps in `$.store` beside the scan caches and the settings; mirrored in `$.state`. */
export type StoreData = {
  topics: Record<string, TopicRecord>
  assign: Record<string, string>
  notes: Record<string, NoteRecord>
  archived: Record<string, true>
  pins: Record<string, true>
  titles: Record<string, string>
}

export type MapSettings = {
  scope: 'folder' | 'all'
  groupBasis: 'auto' | 'manual'
  majorRule: 'either' | 'count' | 'recent'
  majorMinSessions: number
  recentDays: number
  numbering: 'oldestFirst' | 'newestFirst'
  showRelated: boolean
  handoffNotes: 'auto' | 'manual' | 'ask'
  autoJoin: 'suggest' | 'auto' | 'off'
  rangeDays: number
  useModelForTitles: boolean
  openOnStart: 'band' | 'pane' | 'none'
}

export type ToastState = { text: string; hasUndo: boolean }

/** The pane's own view state. */
export type UiState = {
  view: 'map' | 'list'
  focusTopic: string | null
  selected: string | null
  hover: string | null
  query: string
  showSettings: boolean
  moveMode: boolean
  messageMode: boolean
  toast: ToastState | null
}

/** This session's place on the map. */
export type MeState = {
  sessionId: string
  cwd: string
  folder: string
  topicId: string | null
  suggested: string | null
  isNewTopic: boolean
  isBandHidden: boolean
  pendingNote: string | null
  prompts: number
  askNote: boolean
}

export type ScanState = { isScanning: boolean; at: number; root: string; error: string | null }

/** The store before the last reversible change, with the toast's label. */
export type UndoState = { label: string; store: StoreData }

declare module 'claude-code' {
  interface PluginState {
    constellation: {
      sessions: Shaped<SessionSummary[]>
      store: Shaped<StoreData>
      settings: Shaped<MapSettings>
      ui: Shaped<UiState>
      me: Shaped<MeState>
      scan: Shaped<ScanState>
      undo: Shaped<UndoState | null>
    }
  }
}
