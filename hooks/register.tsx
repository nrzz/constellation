// Constellation: the hooks module entry.
//
// Wires the engine's events to the scanner, the clustering, the drawing and
// the actions: a scan at session start, the band with the join chooser, the
// /map pane, /topic, /park and /pickup, the handoff note injected beside the
// next prompt, a note generated after each turn when that setting is on,
// tracing on focus, and Escape backing out of focus mode before it closes.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, ResolveInput, Timer } from 'claude-code'

import {
  actionsFor,
  describeTopics,
  ensureSession,
  escape,
  notePaneFocus,
  INLINE_TEXT,
  exportMarkdown,
  inlineMapText,
  joinOrCreate,
  listSteps,
  onClientMessage,
  openMapAt,
  openMapFind,
  openMapPane,
  openOnAttach,
  paneHadKeys,
  parkNote,
  periodicRescan,
  pickUpStep,
  rescan,
  scheduleNote,
  scheduleRescan,
  startSession,
  suggestFor,
  viewOf,
} from './actions'
import { altOf, drawBand, drawInlineRow, drawPane, fieldOf, helpText, svgOf } from './draw'
import type { Table, View } from './draw'
import { DEFAULT_SETTINGS, INITIAL_ME, INITIAL_UI, PANE } from './state'

// The atoms are declared where they are read, as `claude plugin validate` asks.
const settingsAtom = atom({ plugin: 'constellation', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-2' })
const uiAtom = atom({ plugin: 'constellation', key: 'ui' } as const, INITIAL_UI, { shape: 'ui-3' })
const meAtom = atom({ plugin: 'constellation', key: 'me' } as const, INITIAL_ME, { shape: 'me-1' })

// One of each, however often session.start fires in a process (a reload, a respawn).
let rescanTimer: Timer | undefined
let watchTimer: Timer | undefined

const COMMANDS = [
  { name: 'map', description: 'Open or close the Constellation topic map; "here" prints it in the chat, a topic name opens on it', argumentHint: '[here|<topic>|find <text>|settings|export [path]|close|help]' },
  { name: 'topic', description: 'Join or create a Constellation topic for this session; alone, lists the topics numbered', argumentHint: '[name|n]' },
  { name: 'park', description: 'Save a handoff note for this session on the Constellation map', argumentHint: '<note>' },
  { name: 'pickup', description: 'Add the handoff note of a step of your Constellation topic to the next prompt; "list" shows the steps', argumentHint: '[n|list]' },
] as const

async function registerCommands($: EngineInterface): Promise<void> {
  for (const command of COMMANDS) {
    try {
      await $.command.register({ ...command, immediate: true })
    } catch (error) {
      $.ui.log(`constellation: /${command.name} not registered: ${String(error)}`, { to: 'debug' })
    }
  }
}

/** The surface's constructors as the drawing takes them: by surface, since the tables differ (no Svg on the terminal, no fields on mobile). */
function tableOf<E extends ResolveInput>($: EngineInterface, e: E): Table {
  if (e.surface === 'terminal') {
    const T = $.ui.resolve({ ...e, surface: 'terminal' as const })
    return { Box: T.Box, Text: T.Text, Button: T.Button, Input: T.Input, Select: T.Select }
  }
  if (e.surface === 'mobile') {
    const T = $.ui.resolve({ ...e, surface: 'mobile' as const })
    return { Box: T.Box, Text: T.Text, Button: T.Button, Svg: T.Svg }
  }
  const T = $.ui.resolve({ ...e, surface: 'desktop' as const })
  return { Box: T.Box, Text: T.Text, Button: T.Button, Input: T.Input, Select: T.Select, Svg: T.Svg }
}

/**
 * Whether a surface can show the pane at start: a person at a REPL, a
 * Desktop or VS Code window (whose sessions the engine starts headless, with
 * `isInteractive` false), or that window's entry point in the environment.
 */
async function canOpenPane($: EngineInterface, e: { surface: string | null; isInteractive: boolean }): Promise<boolean> {
  if (e.isInteractive || e.surface === 'desktop' || e.surface === 'vscode') return true
  try {
    const entry = (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) ?? ''
    return entry === 'claude-desktop' || entry === 'claude-vscode'
  } catch {
    return false
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await registerCommands($)
    await startSession($, options, e.cwd, await canOpenPane($, e))
    rescanTimer?.cancel()
    rescanTimer = $.clock.every(120_000, () => void periodicRescan($))
    // The session can change under the process (/clear, a resume) without a hook this mod can count on: a cheap watch.
    watchTimer?.cancel()
    watchTimer = $.clock.every(3000, () => void ensureSession($))
    return next(e)
  })

  // Where this hook reaches the mod (another plugin may keep it), the session the engine runs is checked and a new one started over.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') await ensureSession($)
    return next(e)
  })

  // A Desktop or VS Code window joins after the start: the pane opens now when the settings ask.
  on('session.attach', async ($, e, next) => {
    await openOnAttach($, e.surface)
    return next(e)
  })

  // /clear and a resume move the process to a new session id and reset the state; this hook runs even where classic.SessionStart is kept from the mod.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') $.clock.after(400, () => void ensureSession($))
    return next(e)
  })

  on('command.run', { command: 'map' }, async ($, e) => {
    await ensureSession($)
    const args = e.args.trim()
    const [word = '', ...rest] = args.split(/\s+/)
    const arg = word.toLowerCase()
    if (arg === 'help') return { text: helpText() }
    if (arg === 'export') return { text: await exportMarkdown($, rest.join(' ')) }
    if (arg === 'find') return { text: await openMapFind($, rest.join(' ')) }
    if (arg === 'here') {
      // The CommandOutput hook below draws this row as the field where the surface draws trees; a terminal shows the text.
      await rescan($)
      return { text: await inlineMapText($) }
    }
    // Open means drawn: a pane the start left waiting unplaced is shown, not closed.
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
    if (arg === 'close') {
      if (isOpen) await $.ui.close({ id: PANE })
      return { text: 'Constellation closed.' }
    }
    if (arg !== 'settings' && args) {
      // Anything else names a topic: its number in /topic's list, its name, or the start of one.
      return { text: await openMapAt($, args) }
    }
    if (arg !== 'settings' && isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Constellation closed.' }
    }
    const placed = await openMapPane($, { settings: arg === 'settings' })
    return { text: placed.isPlaced ? 'Constellation opened. /map here prints the map in the chat; /map help lists the commands and keys.' : `Constellation is open but not drawn: ${placed.reason ?? 'no surface'}` }
  })

  on('command.run', { command: 'topic' }, async ($, e) => {
    await ensureSession($)
    const arg = e.args.trim()
    if (!arg) return { text: await describeTopics($) }
    return { text: await joinOrCreate($, arg) }
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    await ensureSession($)
    const text = e.args.trim()
    if (!text) return { text: 'Usage: /park <note>. The note is saved as this session’s handoff note for the next session on its topic.' }
    await parkNote($, text, 'manual', { quiet: true })
    return { text: `Parked: “${text}”.` }
  })

  on('command.run', { command: 'pickup' }, async ($, e) => {
    await ensureSession($)
    const arg = e.args.trim().toLowerCase()
    if (arg === 'list' || arg === '?') return { text: await listSteps($) }
    return { text: await pickUpStep($, e.args) }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    await ensureSession($)
    const me = await read($, meAtom)
    const settings = await read($, settingsAtom)
    const context = [...(e.context ?? [])]
    let pendingNote = me.pendingNote
    if (pendingNote === null && me.topicId === null && !me.isNewTopic && me.prompts === 0 && settings.autoJoin !== 'off') {
      const { joined } = await suggestFor($, e.text)
      if (joined) pendingNote = (await read($, meAtom)).pendingNote
    }
    if (pendingNote) context.push(pendingNote)
    await update($, meAtom, m => ({ ...m, prompts: m.prompts + 1, pendingNote: null }))
    return next(context.length ? { ...e, context } : e)
  })

  on('turn.complete', async ($, e, next) => {
    await ensureSession($)
    if (e.agentId === undefined && !e.isAborted && e.reason === 'answer') {
      const settings = await read($, settingsAtom)
      if (settings.handoffNotes === 'auto') scheduleNote($)
      else if (settings.handoffNotes === 'ask') await update($, meAtom, m => ({ ...m, askNote: true }))
      scheduleRescan($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Whether the person has given the pane the keyboard, as of its last drawing on each surface (see the close below).
    notePaneFocus(e.surface, e.props.isFocused === true)
    const view: View = { ...(await viewOf($, e.surface)), placement: e.props.placement, ...(e.viewport ? { isFullscreen: e.viewport.isFullscreen } : {}) }
    if (e.surface === 'terminal') {
      // No Svg here: the text-mode map Client stands in for the field and takes the pointer; the pane's ring takes the keys.
      const { Client } = $.ui.resolve({ ...e, surface: 'terminal' as const })
      // About half the window the pane gets: a docked pane has forty rows or more, one above the prompt may have fourteen.
      const rows = Math.max(8, Math.min(26, Math.floor((e.props.scroll.bodyRows || 40) * 0.5)))
      const field = <Client key="map" module="../client/map.js" props={fieldOf(view)} height={rows} />
      return drawPane(tableOf($, e), view, actionsFor($), field)
    }
    if (e.surface === 'desktop' && view.settings.pictureClicks !== 'off') {
      // The Svg is drawn as an image: it takes the slot's width at its own aspect, and passes no click on. The same Client
      // as the terminal's map lies over it, drawing nothing (or its outline), and fills the picture's box through the box's
      // own geometry (a relative parent, an inset child) rather than any pixel size, so it needs no tuning; it reports
      // the picks on the picture, and the buttons under the field do the same work without it.
      const { Box, Client, Svg } = $.ui.resolve({ ...e, surface: 'desktop' as const })
      const field = (
        <Box key="field" position="relative" flexDirection="column" alignSelf="flex-start">
          <Svg source={svgOf(view)} alt={altOf(view)} />
          <Box key="layer" position="absolute" top={0} left={0} right={0} bottom={0}>
            <Client key="map" module="../client/map.js" props={{ ...fieldOf(view), hits: true, outline: view.settings.pictureClicks === 'outline' }} width="100%" height="100%" />
          </Box>
        </Box>
      )
      return drawPane(tableOf($, e), view, actionsFor($), field)
    }
    // Elsewhere the picture alone, as an image that takes the slot's width; the buttons under it pick.
    const T = tableOf($, e)
    const field = T.Svg ? <T.Svg source={svgOf(view)} alt={altOf(view)} /> : undefined
    return drawPane(T, view, actionsFor($), field)
  })

  on('ui.message', { element: 'map' }, async ($, e, next) => {
    await ensureSession($)
    await onClientMessage($, e.data)
    return next(e)
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'map' } }, async ($, e, next) => {
    // The row of `/map here`: by its arguments where the surface passes them, else by the text the command printed.
    const word = e.props.args.trim().split(/\s+/)[0]?.toLowerCase()
    if (word !== 'here' && !e.props.text.startsWith(INLINE_TEXT)) return next(e)
    const view = await viewOf($, e.surface)
    return drawInlineRow(tableOf($, e), view, actionsFor($))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const view = await viewOf($, e.surface)
    const tree = drawBand(tableOf($, e), view, actionsFor($))
    return tree ?? next(e)
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    // The person's ring move names the element; a plugin's `$.ui.focus` (and the test kit) names a key.
    const key = e.element ?? (e as { key?: string }).key ?? ''
    const m = /^(?:t|j|a|rel):(.+)$/.exec(key)
    const hover = m?.[1] ?? null
    await update($, uiAtom, u => (u.hover === hover ? u : { ...u, hover }))
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    // Read first, before anything is awaited: the engine redraws the pane without the keyboard a few milliseconds
    // after raising this close, so only now does the last drawing say whether the pane held the keyboard.
    const hadKeys = paneHadKeys()
    if (e.origin.kind !== 'person') return next(e)
    await ensureSession($)
    // One level back, keeping the pane (and the keyboard, when it held it); with nothing left to back out of, the pane closes.
    if (!(await escape($, hadKeys))) return next(e)
    return { value: undefined }
  })
}
