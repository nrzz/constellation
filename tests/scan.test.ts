import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, FsEntry } from 'claude-code'

import {
  LARGE_BYTES,
  basenameOf,
  isTranscript,
  largeStub,
  parseTranscript,
  relativeTo,
  scanSlug,
  slugOf,
} from '../hooks/scan'
import type { ScanCache } from '../hooks/scan'
import { transcripts } from './fixtures/transcripts'

const CHECKOUT = transcripts['checkout-tests'] ?? ''
const ORDERS = transcripts['orders-pagination'] ?? ''
const EMPTY = transcripts['empty-queue'] ?? ''
const seed = (id: string) => ({ id, slug: 'D--Projects-web-app', size: 100, mtimeMs: 1000 })

describe('slug and paths', () => {
  test('a folder slugs as Claude Code files it', async () => {
    expect(slugOf('D:\\Projects')).toBe('D--Projects')
    expect(slugOf('/home/naresh/web-app')).toBe('-home-naresh-web-app')
  })

  test('files are stored relative to the cwd', async () => {
    expect(relativeTo('D:\\Projects\\web-app', 'D:\\Projects\\web-app\\src\\Cart.test.tsx')).toBe('src/Cart.test.tsx')
    expect(relativeTo('/home/n/app', '/home/n/app/lib/x.ts')).toBe('lib/x.ts')
    expect(relativeTo('/home/n/app', '/etc/hosts')).toBe('/etc/hosts')
    expect(basenameOf('src/orders.route.ts')).toBe('orders.route.ts')
  })

  test('only main-loop transcripts count', async () => {
    const entry = (name: string, kind: FsEntry['kind'] = 'file'): FsEntry => ({ name, kind, size: 1, mtimeMs: 1, isLink: false })
    expect(isTranscript(entry('abc.jsonl'))).toBe(true)
    expect(isTranscript(entry('agent-abc.jsonl'))).toBe(false)
    expect(isTranscript(entry('abc', 'dir'))).toBe(false)
    expect(isTranscript(entry('notes.txt'))).toBe(false)
  })
})

describe('parseTranscript', () => {
  test('the checkout fixture parses as its README promises', async () => {
    const s = parseTranscript(CHECKOUT, seed('11111111-aaaa-4bbb-8ccc-000000000001'))
    expect(s).toBeDefined()
    if (!s) return
    expect(s.id).toBe('11111111-aaaa-4bbb-8ccc-000000000001')
    expect(s.title).toBe('Fix flaky cart wait')
    expect(s.firstPrompt).toBe('fix the flaky cart wait in the checkout tests')
    expect(s.turns).toBe(2)
    expect(s.branch).toBe('main')
    expect(s.cwd).toBe('D:\\Projects\\web-app')
    expect(s.filesTouched).toEqual(['src/Cart.test.tsx', 'src/test-utils.ts'])
    expect(new Date(s.startedAt).toISOString()).toBe('2026-10-20T09:00:00.200Z')
    expect(new Date(s.lastAt).toISOString()).toBe('2026-10-20T09:05:00.000Z')
    expect(s.lastAssistantText.startsWith('Replaced the fixed')).toBe(true)
    expect(s.size).toBe(100)
    expect(s.mtimeMs).toBe(1000)
  })

  test('a summary at the top, a bad line, MultiEdit, a local-command row and a detached HEAD', async () => {
    const s = parseTranscript(ORDERS, seed('22222222-aaaa-4bbb-8ccc-000000000002'))
    expect(s).toBeDefined()
    if (!s) return
    expect(s.title).toBe('Cursor pagination API')
    expect(s.firstPrompt).toBe('add cursor pagination to the orders API')
    expect(s.turns).toBe(1)
    expect(s.branch).toBe('feat/cursor-pages')
    expect(s.filesTouched).toEqual(['src/orders.route.ts'])
    expect(new Date(s.startedAt).toISOString()).toBe('2026-10-19T14:00:01.000Z')
    expect(new Date(s.lastAt).toISOString()).toBe('2026-10-19T14:03:00.000Z')
    expect(s.lastAssistantText).toBe('Cursor endpoint done. The client still calls the old offset route.')
  })

  test('a transcript with no conversation row is no session', async () => {
    expect(parseTranscript(EMPTY, seed('33333333-aaaa-4bbb-8ccc-000000000003'))).toBeUndefined()
    expect(parseTranscript('', seed('x'))).toBeUndefined()
  })

  test('a long first prompt is cut to 60 characters for the title', async () => {
    const prompt = 'please '.repeat(30).trim()
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: prompt }, timestamp: '2026-10-01T00:00:00.000Z', sessionId: 's' })
    const s = parseTranscript(line, seed('s'))
    expect(s?.title.length).toBe(60)
    expect(s?.title.endsWith('…')).toBe(true)
    expect(s?.firstPrompt.length).toBeLessThanOrEqual(200)
  })
})

type FakeFile = { size: number; mtimeMs: number; text?: string }

/** A `$` with only the file system, counting reads, for scanSlug. */
function fakeFs(files: Record<string, FakeFile>): { $: EngineInterface; reads: string[] } {
  const reads: string[] = []
  const fs = {
    list: async () =>
      Object.entries(files).map(([name, f]): FsEntry => ({ name, kind: name.endsWith('/') ? 'dir' : 'file', size: f.size, mtimeMs: f.mtimeMs, isLink: false })),
    read: async (path: string) => {
      const name = path.split('/').pop() ?? ''
      reads.push(name)
      const file = files[name]
      if (!file || file.text === undefined) throw new Error(`no such file ${path}`)
      return file.text
    },
  }
  return { $: { fs } as unknown as EngineInterface, reads }
}

describe('scanSlug and its cache', () => {
  const files: Record<string, FakeFile> = {
    '11111111-aaaa-4bbb-8ccc-000000000001.jsonl': { size: CHECKOUT.length, mtimeMs: 5000, text: CHECKOUT },
    '22222222-aaaa-4bbb-8ccc-000000000002.jsonl': { size: ORDERS.length, mtimeMs: 4000, text: ORDERS },
    '33333333-aaaa-4bbb-8ccc-000000000003.jsonl': { size: EMPTY.length, mtimeMs: 6000, text: EMPTY },
    'agent-44444444.jsonl': { size: 10, mtimeMs: 7000, text: CHECKOUT },
    '11111111-aaaa-4bbb-8ccc-000000000001/': { size: 0, mtimeMs: 0 },
  }

  test('a first scan reads every transcript, newest last activity first', async () => {
    const { $, reads } = fakeFs(files)
    const r = await scanSlug($, '/root/D--Projects-web-app', 'D--Projects-web-app', {})
    expect(r.isChanged).toBe(true)
    expect(reads.length).toBe(3)
    expect(r.sessions.map(s => s.title)).toEqual(['Fix flaky cart wait', 'Cursor pagination API'])
    expect(Object.keys(r.cache).sort()).toEqual([
      '11111111-aaaa-4bbb-8ccc-000000000001',
      '22222222-aaaa-4bbb-8ccc-000000000002',
      '33333333-aaaa-4bbb-8ccc-000000000003',
    ])
    expect(r.cache['33333333-aaaa-4bbb-8ccc-000000000003']).toEqual({ id: '33333333-aaaa-4bbb-8ccc-000000000003', size: EMPTY.length, mtimeMs: 6000, isEmpty: true })
    expect(r.sessions[0]?.slug).toBe('D--Projects-web-app')
  })

  test('a second scan with the cache reads nothing', async () => {
    const first = await scanSlug(fakeFs(files).$, '/root/x', 'x', {})
    const { $, reads } = fakeFs(files)
    const r = await scanSlug($, '/root/x', 'x', first.cache)
    expect(reads).toEqual([])
    expect(r.isChanged).toBe(false)
    expect(r.sessions.length).toBe(2)
  })

  test('a changed file is re-read and a gone file is dropped', async () => {
    const first = await scanSlug(fakeFs(files).$, '/root/x', 'x', {})
    const changed: Record<string, FakeFile> = {
      '11111111-aaaa-4bbb-8ccc-000000000001.jsonl': { size: CHECKOUT.length + 1, mtimeMs: 9000, text: `${CHECKOUT}\n` },
    }
    const { $, reads } = fakeFs(changed)
    const r = await scanSlug($, '/root/x', 'x', first.cache)
    expect(reads).toEqual(['11111111-aaaa-4bbb-8ccc-000000000001.jsonl'])
    expect(r.isChanged).toBe(true)
    expect(r.sessions.map(s => s.id)).toEqual(['11111111-aaaa-4bbb-8ccc-000000000001'])
    expect(r.sessions[0]?.mtimeMs).toBe(9000)
  })

  test('a transcript over 4 MiB becomes a stub, or keeps its cached summary flagged large', async () => {
    const big: Record<string, FakeFile> = { 'bigbig.jsonl': { size: LARGE_BYTES + 1, mtimeMs: 123456 } }
    const { $, reads } = fakeFs(big)
    const r = await scanSlug($, '/root/x', 'x', {})
    expect(reads.length).toBe(0)
    expect(r.sessions.length).toBe(1)
    const stub = r.sessions[0]
    expect(stub?.title).toBe('(large transcript)')
    expect(stub?.large).toBe(true)
    expect(stub?.startedAt).toBe(123456)
    expect(stub?.lastAt).toBe(123456)
    expect(stub).toEqual(largeStub({ id: 'bigbig', slug: 'x', size: LARGE_BYTES + 1, mtimeMs: 123456 }))

    const cached: ScanCache = {
      bigbig: { ...(parseTranscript(CHECKOUT, { id: 'bigbig', slug: 'x', size: 10, mtimeMs: 1 }) as NonNullable<ReturnType<typeof parseTranscript>>) },
    }
    const again = await scanSlug(fakeFs(big).$, '/root/x', 'x', cached)
    expect(again.sessions[0]?.title).toBe('Fix flaky cart wait')
    expect(again.sessions[0]?.large).toBe(true)
    expect(again.sessions[0]?.size).toBe(LARGE_BYTES + 1)
  })

  test('a folder that cannot be listed scans as empty', async () => {
    const $ = { fs: { list: async () => { throw new Error('ENOENT') }, read: async () => '' } } as unknown as EngineInterface
    const r = await scanSlug($, '/nowhere', 'x', {})
    expect(r.sessions).toEqual([])
    expect(r.isChanged).toBe(false)
  })
})
