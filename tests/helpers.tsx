// The engine beneath the plugin, for the end-to-end tests: the kit's clock,
// store and env, and a stub for every other call the mod makes, each
// recording what it was asked so a test can assert on it.
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On, UiPane } from 'claude-code'

import { transcripts } from './fixtures/transcripts'

export const CWD = 'D:\\Projects\\web-app'
export const SLUG = 'D--Projects-web-app'
export const ROOT = '/home/n/.claude/projects'
export const NOW = Date.parse('2026-10-20T10:00:00.000Z')
export const ME = 'me-session-0001'
export const IDS = {
  tests: '11111111-aaaa-4bbb-8ccc-000000000001',
  rounding: '44444444-aaaa-4bbb-8ccc-000000000004',
  orders: '22222222-aaaa-4bbb-8ccc-000000000002',
  empty: '33333333-aaaa-4bbb-8ccc-000000000003',
}
/** The auto topic of the two checkout fixtures: named after its earliest session. */
export const CHECKOUT = `auto:${IDS.rounding}`

export type FakeFile = { key?: string; text?: string; mtime: string; size?: number }

export const FIXTURE_FILES: Record<string, FakeFile> = {
  [IDS.tests]: { key: 'checkout-tests', mtime: '2026-10-20T09:05:00.000Z' },
  [IDS.rounding]: { key: 'checkout-rounding', mtime: '2026-10-18T15:04:00.000Z' },
  [IDS.orders]: { key: 'orders-pagination', mtime: '2026-10-19T14:03:00.000Z' },
  [IDS.empty]: { key: 'empty-queue', mtime: '2026-10-21T08:00:00.000Z' },
}

export function textOf(file: FakeFile): string {
  return file.text ?? transcripts[file.key ?? ''] ?? ''
}

/** A path as the engine hands it to a stub, made comparable on every platform: forward slashes, no drive letter (`C:\home\n\x` → `/home/n/x`). */
export function pathOf(path: string): string {
  return path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')
}

export function paneOn<S extends 'desktop' | 'terminal' | 'vscode' | 'mobile'>(surface: S) {
  return {
    plugin: 'constellation',
    component: 'Pane',
    requestId: 'constellation',
    surface,
    props: { title: 'Constellation', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const
}

export function bandOn<S extends 'desktop' | 'terminal' | 'vscode' | 'mobile'>(surface: S) {
  return {
    plugin: 'constellation',
    component: 'AbovePrompt',
    requestId: 'band',
    surface,
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  } as const
}

export type Stubs = {
  clock: ReturnType<typeof mock.clock>
  /** What `$.session.id()` answers; change it before a /clear to play a new session. */
  sessionId: string
  modelCalls: number
  reads: string[]
  written: Record<string, string>
  toasts: string[]
  status: (string | undefined)[]
  filled: string[]
  sent: { to: unknown; text: string }[]
  opened: number
  closed: number
  ran: string[][]
  /** What `$.ui.open` answers; flip it to play a surface that cannot place the pane. */
  isPlaced: boolean
}

export type StubOptions = {
  store?: Record<string, unknown>
  now?: number
  files?: Record<string, FakeFile>
  panes?: UiPane[]
  /** Every `$.store.set` rejects. */
  failStore?: boolean
  /** A store the test can read and write from outside, as another session would. */
  liveStore?: Record<string, unknown>
  /** The model's answer: a text, `'error'` for an API error, `'empty'` for an empty reply. */
  model?: string
  /** Names `$.tool.list()` answers. */
  tools?: string[]
  env?: Record<string, string>
  /** `$.session.send` answers this. */
  delivered?: boolean
  /** `$.prompt.fill` answers this. */
  filled?: boolean
  /** `$.ui.ask` (a tool call of AskUserQuestion) is refused. */
  dismissAsks?: boolean
}

export function stubEngine(on: On, options: StubOptions = {}): Stubs {
  const files = options.files ?? FIXTURE_FILES
  const stubs: Stubs = {
    clock: mock.clock(on, { now: options.now ?? NOW }),
    sessionId: ME,
    modelCalls: 0,
    reads: [],
    written: {},
    toasts: [],
    status: [],
    filled: [],
    sent: [],
    opened: 0,
    closed: 0,
    ran: [],
    isPlaced: true,
  }
  if (options.liveStore) {
    const live = options.liveStore
    on('store.get', (_, e) => ({ value: live[e.key] }))
    on('store.set', (_, e) => {
      live[e.key] = JSON.parse(JSON.stringify(e.value))
      return { value: undefined }
    })
    on('store.delete', (_, e) => {
      delete live[e.key]
      return { value: undefined }
    })
    on('store.keys', () => ({ value: Object.keys(live) }))
  } else if (options.failStore) {
    const seed = options.store ?? {}
    on('store.get', (_, e) => ({ value: seed[e.key] }))
    on('store.set', () => ({ deny: 'the store is full' }))
    on('store.delete', () => ({ value: undefined }))
    on('store.keys', () => ({ value: Object.keys(seed) }))
  } else {
    mock.store(on, options.store ?? {})
  }
  mock.env(on, { CLAUDE_CONFIG_DIR: '/home/n/.claude', ...(options.env ?? {}) })
  on('classic.SessionStart', () => ({}))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: stubs.sessionId }))
  on('ui.open', () => {
    stubs.opened += 1
    return { value: stubs.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } }
  })
  on('ui.panes', () => ({ value: options.panes ?? [] }))
  on('ui.close', () => {
    stubs.closed += 1
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    stubs.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    stubs.status.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.focus', () => ({}))
  on('tool.list', () => ({ value: (options.tools ?? []).map(name => ({ name, description: '', mcp: true })) }))
  if (options.dismissAsks) on('tool.call', () => ({ deny: 'dismissed' }))
  on('mcp.call', () => ({ value: { content: [], isError: false } }))
  on('fs.list', (_, e) => ({
    value:
      pathOf(e.path) === `${ROOT}/${SLUG}`
        ? [
            ...Object.entries(files).map(([id, f]): FsEntry => ({ name: `${id}.jsonl`, kind: 'file', size: f.size ?? textOf(f).length, mtimeMs: Date.parse(f.mtime), isLink: false })),
            { name: 'agent-55555555.jsonl', kind: 'file', size: 10, mtimeMs: 1, isLink: false },
            { name: IDS.tests, kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
          ]
        : [],
  }))
  on('fs.read', (_, e) => {
    const id = (pathOf(e.path).split('/').pop() ?? '').replace(/\.jsonl$/, '')
    stubs.reads.push(id)
    const file = files[id]
    if (!file) return { deny: `no such file ${e.path}` }
    return { value: textOf(file) }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_, e) => {
    stubs.written[pathOf(e.path)] = e.text
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    stubs.ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.fill', (_, e) => {
    stubs.filled.push(e.text)
    return options.filled === false ? { isFilled: false, refusal: 'no_composer' } : { isFilled: true }
  })
  on('session.send', (_, e) => {
    stubs.sent.push({ to: e.to, text: e.text })
    return options.delivered === false ? { isDelivered: false, reason: 'not running' } : { isDelivered: true }
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'fix the flaky wait', toolUses: [] },
      { role: 'assistant', text: 'Replaced it with findByText.', toolUses: [] },
    ],
  }))
  on('model.complete', () => {
    stubs.modelCalls += 1
    const usage = { input_tokens: 120, output_tokens: 18, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    if (options.model === 'error') return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage } }
    if (options.model === 'empty') return { value: { isAnswered: false, reason: 'empty-reply', usage } }
    return { value: { isAnswered: true, text: options.model ?? 'Replaced the fixed wait with findByText; the CI re-run is still pending.', usage } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('session.cwd', () => ({ value: CWD }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return stubs
}

/** A prompt typed at the composer, as the engine raises it. */
export function submit($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** A slash command typed at the composer. */
export function run($: Engine, command: string, args: string) {
  return $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
}

/** A main-loop turn that answered. */
export function turn($: Engine, answer = 'done') {
  return $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: `t-${Math.random().toString(36).slice(2, 8)}`, reason: 'answer' })
}

/** One synthetic transcript line. */
export function line(row: Record<string, unknown>): string {
  return JSON.stringify(row)
}

export function userRow(id: string, uuid: string, at: string, content: unknown, extra: Record<string, unknown> = {}): string {
  return line({ parentUuid: null, type: 'user', message: { role: 'user', content }, uuid, timestamp: at, cwd: CWD, sessionId: id, version: '2.1.310', gitBranch: 'main', ...extra })
}

export function assistantRow(id: string, uuid: string, at: string, content: unknown[]): string {
  return line({ parentUuid: null, type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content }, uuid, timestamp: at, cwd: CWD, sessionId: id, version: '2.1.310', gitBranch: 'main' })
}
