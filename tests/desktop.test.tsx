// The office-PC pass: a Desktop session is headless to the engine, its
// `classic.SessionStart` may be kept from the mod by another plugin, the
// picture must be told its size, and the test stubs must read the paths the
// engine resolves on Windows.
import { expect, test } from 'claude-code/testing'

import { CHECKOUT, CWD, IDS, ME, bandOn, paneOn, pathOf, run, stubEngine } from './helpers'

const ROW = {
  plugin: 'constellation',
  component: 'CommandOutput',
  requestId: 'msg-1',
  props: { command: 'map', args: 'here', text: 'Constellation map (as of now). /map opens the live pane.', isErrored: false },
} as const

test('openOnStart pane: the pane opens for a Desktop or VS Code surface although the engine starts it headless', { options: { openOnStart: 'pane' } }, async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: false })
  expect(stubs.opened).toBe(1)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: false })
  expect(stubs.opened).toBe(1)
})

test('openOnStart pane: a headless start with the Desktop entry point in the environment opens too; a bare headless start does not', { options: { openOnStart: 'pane' } }, async ($, on) => {
  const stubs = stubEngine(on, { env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } })
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
  expect(stubs.opened).toBe(1)
})

test('openOnStart pane: a bare headless start opens nothing until a Desktop window attaches, and then once', { options: { openOnStart: 'pane' } }, async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
  expect(stubs.opened).toBe(0)
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:1' })
  expect(stubs.opened).toBe(0)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(stubs.opened).toBe(1)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:2' })
  expect(stubs.opened).toBe(1)
})

test('openOnStart band: a Desktop attach opens nothing', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(stubs.opened).toBe(0)
})

test('after a /clear the mod starts over for the new session without classic.SessionStart: session.end schedules it, and the watch and every command check the id', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  expect((await run($, 'topic', '1')).text).toContain('This session is in the topic')
  expect(stubs.status[stubs.status.length - 1]).toContain('step 3')
  // /clear: the engine moves the process to a new id; no session.start, no classic.SessionStart here.
  stubs.sessionId = 'me-session-0002'
  await $.session.end({ reason: 'clear', sessionId: ME, resume: { id: ME } })
  await stubs.clock.advance(400)
  expect(stubs.status[stubs.status.length - 1]).toBeUndefined()
  const pane = await $.ui.mount(paneOn('desktop'))
  expect(await pane.find({ type: 'Text', text: /continuing which topic/ })).toBeDefined()
  await pane.unmount()
  expect((await run($, 'topic', '')).text).toContain('This session has no topic yet')
  // A resume the hooks never heard of: the three-second watch finds the new id.
  stubs.sessionId = 'me-session-0003'
  expect((await run($, 'topic', '1')).text).toContain('This session is in the topic')
  stubs.sessionId = 'me-session-0004'
  await stubs.clock.advance(3000)
  const again = await $.ui.mount(paneOn('desktop'))
  expect(await again.find({ type: 'Text', text: /continuing which topic/ })).toBeDefined()
  await again.unmount()
  // A press after a switch acts for the session the engine runs, never for the old id.
  stubs.sessionId = 'me-session-0005'
  const band = await $.ui.mount(bandOn('terminal'))
  await band.press({ key: `j:${CHECKOUT}` })
  await band.unmount()
  expect((await run($, 'topic', '')).text).toContain('This session is in')
  expect(stubs.status[stubs.status.length - 1]).toContain('step 3')
  // Joining focuses the topic; this session is its last step.
  const joined = await $.ui.mount(paneOn('desktop'))
  expect(await joined.find({ type: 'Button', key: 's:you' })).toBeDefined()
  await joined.press({ key: 'back' })
  expect(await joined.find({ type: 'Text', text: /This session is step 3 of/ })).toBeDefined()
  await joined.unmount()
})

test('a session.end that is not a clear or a resume starts nothing over', async ($, on) => {
  const stubs = stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await run($, 'topic', '1')
  stubs.sessionId = 'me-session-0002'
  await $.session.end({ reason: 'prompt_input_exit', sessionId: ME, resume: { id: ME } })
  await stubs.clock.advance(400)
  expect(stubs.status[stubs.status.length - 1]).toContain('step 3')
})

test('/map here prints a picture sized for the transcript, and the header shows the gear', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await run($, 'map', 'here')
  const row = await $.ui.mount({ ...ROW, surface: 'desktop' })
  const svg = await row.find({ type: 'Svg' })
  // 100 columns at 7.2 px.
  expect(svg?.props.width).toBe(720)
  expect(svg?.props.height).toBe(435)
  expect(await row.find({ type: 'Client' })).toBeUndefined()
  await row.unmount()
  const pane = await $.ui.mount(paneOn('desktop'))
  expect((await pane.find({ type: 'Button', key: 'settings' }))?.props.label).toBe('⚙ Settings')
  await pane.unmount()
})

test('the stubs read paths as the engine resolves them on Windows', async () => {
  expect(pathOf('C:\\home\\n\\.claude\\projects\\D--Projects-web-app')).toBe('/home/n/.claude/projects/D--Projects-web-app')
  expect(pathOf('/home/n/.claude/projects/D--Projects-web-app')).toBe('/home/n/.claude/projects/D--Projects-web-app')
  expect(pathOf(`C:\\x\\${IDS.tests}.jsonl`).split('/').pop()).toBe(`${IDS.tests}.jsonl`)
  expect(pathOf('D:\\Projects\\constellation\\notes\\handover.md').endsWith('notes/handover.md')).toBe(true)
})
