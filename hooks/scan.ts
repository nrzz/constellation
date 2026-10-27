// Constellation: the transcript scanner.
//
// Reads Claude Code's transcripts, one `<sessionId>.jsonl` per session under
// `~/.claude/projects/<slug>/`, into small per-session summaries and keeps them
// in `$.store` (`cache:<slug>`, keyed by session id, each with the file's
// `size` and `mtimeMs`) so a rescan reads only the files that changed. It never
// writes a transcript. `$.fs.read` is capped at 4 MiB: a larger transcript
// keeps its cached summary flagged `large`, or becomes a stub.
import type { EngineInterface, FsEntry } from 'claude-code'

import type { SessionSummary } from '../types'

/** `$.fs.read` rejects a file over this many bytes. */
export const LARGE_BYTES = 4 * 1024 * 1024
const TITLE_CHARS = 60
const PROMPT_CHARS = 200
const ANSWER_CHARS = 300
const FILES_MAX = 40
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export type { SessionSummary }

/** A transcript read and found to hold no conversation row yet: cached so it is not re-read. */
export type EmptyMarker = { id: string; size: number; mtimeMs: number; isEmpty: true }

export type ScanCache = Record<string, SessionSummary | EmptyMarker>

export function isSummary(entry: SessionSummary | EmptyMarker | undefined): entry is SessionSummary {
  return entry !== undefined && !('isEmpty' in entry)
}

export type ScanResult = {
  sessions: SessionSummary[]
  cache: ScanCache
  /** True when a file was read or a stale entry dropped: the cache wants saving. */
  isChanged: boolean
  /** True when the pass hit its read budget and files are left unread. */
  isPartial: boolean
}

/** Transcripts one pass reads at most, so a first scan of a big folder stays short; the rest follows. */
export const READS_PER_PASS = 40

/** The slug Claude Code files a folder's transcripts under: `D:\Projects` → `D--Projects`. */
export function slugOf(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function trimSlash(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

/** The folder that holds every slug: `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`. */
export async function projectsRoot($: EngineInterface): Promise<string> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir) return `${trimSlash(configDir)}/projects`
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '~'
  return `${trimSlash(home)}/.claude/projects`
}

type Json = Record<string, unknown>

function asObject(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function cut(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

function normalise(path: string): string {
  return path.replace(/\\/g, '/')
}

/** `D:\Projects\app\src\a.ts` under `D:\Projects\app` → `src/a.ts`; elsewhere, the path with `/`. */
export function relativeTo(cwd: string, path: string): string {
  const base = trimSlash(normalise(cwd))
  const file = normalise(path)
  if (base && file.startsWith(`${base}/`)) return file.slice(base.length + 1)
  if (base && file.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return file.slice(base.length + 1)
  return file
}

/** The last path segment: what a link label and a join score use. */
export function basenameOf(path: string): string {
  const parts = normalise(path).split('/')
  return parts[parts.length - 1] ?? path
}

/**
 * Files that unrelated sessions edit alike, so they say nothing about a
 * topic: anything under a `.claude` folder (memory, plans, settings), the
 * project's instruction files, lockfiles, env files and the gitignore.
 */
export function isNoiseFile(path: string): boolean {
  const p = normalise(path).toLowerCase()
  if (/(^|\/)\.claude\//.test(p)) return true
  const base = p.split('/').pop() ?? p
  if (base === 'claude.md' || base === 'agents.md' || base === '.gitignore' || base === '.env' || base.startsWith('.env.')) return true
  return /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock|go\.sum|composer\.lock|gemfile\.lock|uv\.lock|bun\.lockb?)$/.test(base)
}

/** A typed user prompt: a string body that is not a meta row and not a slash command's record. */
function promptOf(row: Json): string | undefined {
  if (row.isMeta === true) return undefined
  const message = asObject(row.message)
  const content = asString(message?.content)
  if (content === undefined) return undefined
  const text = content.trim()
  if (text === '' || text.startsWith('<')) return undefined
  return text
}

/**
 * One transcript's lines into a summary; `undefined` when it holds no
 * conversation row (a session that has not started). Tolerates bad lines.
 */
export function parseTranscript(
  text: string,
  seed: { id: string; slug: string; size: number; mtimeMs: number },
): SessionSummary | undefined {
  let id = seed.id
  let cwd = ''
  let branch = ''
  let firstPrompt = ''
  let summary = ''
  // Claude Code 2.1.3xx names a session in `custom-title` (the person's) and `ai-title` rows; older builds in `summary` rows.
  let customTitle = ''
  let aiTitle = ''
  let startedAt = Number.POSITIVE_INFINITY
  let lastAt = Number.NEGATIVE_INFINITY
  let turns = 0
  let lastAssistantText = ''
  const files: string[] = []
  const seenFiles = new Set<string>()

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const row = asObject(parsed)
    if (!row) continue
    const type = asString(row.type)
    if (type === 'summary') {
      const s = asString(row.summary)
      if (s) summary = s
      continue
    }
    if (type === 'custom-title') {
      const s = asString(row.customTitle)
      if (s && s.trim()) customTitle = s
      continue
    }
    if (type === 'ai-title') {
      const s = asString(row.aiTitle)
      if (s && s.trim()) aiTitle = s
      continue
    }
    if (type !== 'user' && type !== 'assistant') continue

    const sessionId = asString(row.sessionId)
    if (sessionId) id = sessionId
    const rowCwd = asString(row.cwd)
    if (rowCwd) cwd = rowCwd
    const rowBranch = asString(row.gitBranch)
    if (rowBranch && (rowBranch !== 'HEAD' || branch === '')) branch = rowBranch
    const at = Date.parse(asString(row.timestamp) ?? '')
    if (!Number.isNaN(at)) {
      if (at < startedAt) startedAt = at
      if (at > lastAt) lastAt = at
    }

    if (type === 'user') {
      const prompt = promptOf(row)
      if (prompt !== undefined) {
        turns += 1
        if (firstPrompt === '') firstPrompt = prompt
      }
      continue
    }

    const message = asObject(row.message)
    const content = message?.content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      const block = asObject(item)
      if (!block) continue
      if (block.type === 'text') {
        const t = asString(block.text)
        if (t && t.trim() !== '') lastAssistantText = t
      } else if (block.type === 'tool_use' && EDIT_TOOLS.has(asString(block.name) ?? '')) {
        const input = asObject(block.input)
        const filePath = asString(input?.file_path) ?? asString(input?.notebook_path)
        if (!filePath || isNoiseFile(filePath)) continue
        const rel = relativeTo(cwd, filePath)
        if (!seenFiles.has(rel) && files.length < FILES_MAX) {
          seenFiles.add(rel)
          files.push(rel)
        }
      }
    }
  }

  if (!Number.isFinite(startedAt)) return undefined
  const shortPrompt = cut(firstPrompt, PROMPT_CHARS)
  return {
    id,
    cwd,
    slug: seed.slug,
    branch,
    firstPrompt: shortPrompt,
    title: cut(customTitle || aiTitle || summary, 80) || cut(firstPrompt, TITLE_CHARS) || '(untitled session)',
    startedAt,
    lastAt,
    turns,
    filesTouched: files,
    lastAssistantText: cut(lastAssistantText, ANSWER_CHARS),
    size: seed.size,
    mtimeMs: seed.mtimeMs,
  }
}

/** The stub for a transcript over 4 MiB with no cached summary. */
export function largeStub(seed: { id: string; slug: string; size: number; mtimeMs: number }): SessionSummary {
  return {
    id: seed.id,
    cwd: '',
    slug: seed.slug,
    branch: '',
    firstPrompt: '',
    title: '(large transcript)',
    startedAt: seed.mtimeMs,
    lastAt: seed.mtimeMs,
    turns: 0,
    filesTouched: [],
    lastAssistantText: '',
    size: seed.size,
    mtimeMs: seed.mtimeMs,
    large: true,
  }
}

/** Which directory entries are main-loop transcripts: `<id>.jsonl`, never `agent-*` or a folder. */
export function isTranscript(entry: FsEntry): boolean {
  return entry.kind === 'file' && entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-')
}

/**
 * Scans one slug's folder against its cache: unchanged files (same size and
 * mtime) are taken from the cache, changed ones read and parsed, large ones
 * kept or stubbed, gone ones dropped.
 */
export async function scanSlug(
  $: EngineInterface,
  dir: string,
  slug: string,
  cache: ScanCache,
  maxReads = READS_PER_PASS,
): Promise<ScanResult> {
  let entries: FsEntry[]
  try {
    entries = await $.fs.list(dir)
  } catch {
    entries = []
  }
  const next: ScanCache = {}
  let isChanged = false
  let isPartial = false
  let reads = 0
  // Newest files first, so a bounded pass shows the recent work before the old.
  const transcriptsNewestFirst = entries.filter(isTranscript).sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const entry of transcriptsNewestFirst) {
    const id = entry.name.slice(0, -'.jsonl'.length)
    const seed = { id, slug, size: entry.size, mtimeMs: entry.mtimeMs }
    const known = cache[id]
    if (known && known.size === entry.size && known.mtimeMs === entry.mtimeMs) {
      next[id] = known
      continue
    }
    const cached = isSummary(known) ? known : undefined
    if (entry.size > LARGE_BYTES) {
      isChanged = true
      next[id] = cached ? { ...cached, size: entry.size, mtimeMs: entry.mtimeMs, large: true } : largeStub(seed)
      continue
    }
    if (reads >= maxReads) {
      isPartial = true
      if (known) next[id] = known
      continue
    }
    reads += 1
    isChanged = true
    let text: string
    try {
      text = await $.fs.read(`${dir}/${entry.name}`)
    } catch {
      if (cached) next[id] = { ...cached, size: entry.size, mtimeMs: entry.mtimeMs }
      continue
    }
    next[id] = parseTranscript(text, seed) ?? { id, size: entry.size, mtimeMs: entry.mtimeMs, isEmpty: true }
  }
  if (Object.keys(cache).some(id => !(id in next))) isChanged = true
  const sessions = Object.values(next).filter(isSummary).sort((a, b) => b.lastAt - a.lastAt)
  return { sessions, cache: next, isChanged, isPartial }
}

export type ScanScope = 'folder' | 'all'

/** Every slug the scope covers: this folder's, or each folder under the projects root. */
export async function slugsInScope($: EngineInterface, root: string, scope: ScanScope, cwd: string): Promise<string[]> {
  if (scope !== 'all') return [slugOf(cwd)]
  try {
    const entries = await $.fs.list(root)
    const slugs = entries.filter(e => e.kind === 'dir').map(e => e.name)
    const own = slugOf(cwd)
    return slugs.includes(own) ? slugs : [own, ...slugs]
  } catch {
    return [slugOf(cwd)]
  }
}

/** Scans every slug in scope, reading and saving each slug's cache in `$.store`. */
export async function scanProject(
  $: EngineInterface,
  scope: ScanScope,
  cwd: string,
): Promise<{ sessions: SessionSummary[]; root: string; slugs: string[]; isPartial: boolean }> {
  const root = await projectsRoot($)
  const slugs = await slugsInScope($, root, scope, cwd)
  const sessions: SessionSummary[] = []
  let isPartial = false
  for (const slug of slugs) {
    // `scan2`: summaries parsed since titles came from the title rows and noise files were dropped; the old key is cleared once.
    const key = `scan2:${slug}`
    try {
      if ((await $.store.get(`cache:${slug}`)) !== undefined) await $.store.delete(`cache:${slug}`)
    } catch {
      // the old key stays; it is never read
    }
    const stored = asObject(await $.store.get(key))
    const cache: ScanCache = {}
    if (stored) {
      for (const [id, value] of Object.entries(stored)) {
        const s = asObject(value)
        if (!s || typeof s.size !== 'number' || typeof s.mtimeMs !== 'number') continue
        if (s.isEmpty === true) cache[id] = { id, size: s.size, mtimeMs: s.mtimeMs, isEmpty: true }
        else if (typeof s.lastAt === 'number') cache[id] = s as unknown as SessionSummary
      }
    }
    const result = await scanSlug($, `${root}/${slug}`, slug, cache)
    if (result.isPartial) isPartial = true
    if (result.isChanged) {
      try {
        await $.store.set(key, result.cache)
      } catch (error) {
        $.ui.log(`constellation: cache for ${slug} not saved: ${String(error)}`, { to: 'debug' })
      }
    }
    sessions.push(...result.sessions)
  }
  sessions.sort((a, b) => b.lastAt - a.lastAt)
  return { sessions, root, slugs, isPartial }
}
