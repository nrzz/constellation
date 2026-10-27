// Constellation: the hooks module entry.
//
// Wires the engine's events to the scanner, the clustering, the drawing and
// the actions: a scan at session start, the band with the join chooser, the
// /map pane, /topic, /park and /pickup, the handoff note injected beside the
// next prompt, a note generated after each turn when that setting is on,
// tracing on focus, and Escape backing out of focus mode before it closes.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, ResolveInput } from 'claude-code'

import {
  actionsFor,
  backedOut,
  bootstrap,
  describeTopics,
  exportMarkdown,
  joinOrCreate,
  listSteps,
  onClientMessage,
  openMapAt,
  openMapFind,
  openMapPane,
  parkNote,
  periodicRescan,
  pickUpStep,
  rescan,
  scheduleNote,
  scheduleRescan,
  suggestFor,
  viewOf,
} from './actions'
import { altOf, drawBand, drawInlineRow, drawPane, fieldOf, helpText, svgOf } from './draw'
import type { Table } from './draw'
import { DEFAULT_SETTINGS, INITIAL_ME, INITIAL_UI, PANE } from './state'

// The atoms are declared where they are read, as `claude plugin validate` asks.
const settingsAtom = atom({ plugin: 'constellation', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-1' })
const uiAtom = atom({ plugin: 'constellation', key: 'ui' } as const, INITIAL_UI, { shape: 'ui-3' })
const meAtom = atom({ plugin: 'constellation', key: 'me' } as const, INITIAL_ME, { shape: 'me-1' })

/** Rows the Desktop hit layer takes: about the Svg's 520 px at the code font's line height; tune once seen locally. */
const HIT_ROWS = 30

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

async function start($: EngineInterface, options: PluginOptions, cwd: string, isInteractive: boolean): Promise<void> {
  try {
    await bootstrap($, options, cwd)
  } catch (error) {
    $.ui.log(`constellation: start failed: ${String(error)}`, { to: 'debug' })
  }
  const settings = await read($, settingsAtom)
  if (settings.openOnStart === 'pane' && isInteractive) {
    try {
      await openMapPane($)
    } catch (error) {
      $.ui.log(`constellation: pane not opened: ${String(error)}`, { to: 'debug' })
    }
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await registerCommands($)
    await start($, options, e.cwd, e.isInteractive)
    $.clock.every(120_000, () => void periodicRescan($))
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      await start($, options, e.cwd, true)
    }
    return next(e)
  })

  on('command.run', { command: 'map' }, async ($, e) => {
    const args = e.args.trim()
    const [word = '', ...rest] = args.split(/\s+/)
    const arg = word.toLowerCase()
    if (arg === 'help') return { text: helpText() }
    if (arg === 'export') return { text: await exportMarkdown($, rest.join(' ')) }
    if (arg === 'find') return { text: await openMapFind($, rest.join(' ')) }
    if (arg === 'here') {
      // The CommandOutput hook below draws this row as the field; the text stands where a surface draws no tree.
      await rescan($)
      return { text: 'Constellation map (as of now). /map opens the live pane.' }
    }
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (arg === 'close') {
      if (isOpen) await $.ui.close({ id: PANE })
      return { text: 'Constellation closed.' }
    }
    if (arg === 'settings') {
      await update($, uiAtom, u => ({ ...u, showSettings: true, showHelp: false, selected: null }))
    } else if (args) {
      // Anything else names a topic: its number in /topic's list, its name, or the start of one.
      return { text: await openMapAt($, args) }
    } else if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Constellation closed.' }
    }
    const placed = await openMapPane($)
    return { text: placed.isPlaced ? 'Constellation opened. /map here prints the map in the chat; /map help lists the commands and keys.' : `Constellation is open but not drawn: ${placed.reason ?? 'no surface'}` }
  })

  on('command.run', { command: 'topic' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg) return { text: await describeTopics($) }
    return { text: await joinOrCreate($, arg) }
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) return { text: 'Usage: /park <note>. The note is saved as this session’s handoff note for the next session on its topic.' }
    await parkNote($, text, 'manual', { quiet: true })
    return { text: `Parked: “${text}”.` }
  })

  on('command.run', { command: 'pickup' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'list' || arg === '?') return { text: await listSteps($) }
    return { text: await pickUpStep($, e.args) }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
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
    if (e.agentId === undefined && !e.isAborted && e.reason === 'answer') {
      const settings = await read($, settingsAtom)
      if (settings.handoffNotes === 'auto') scheduleNote($)
      else if (settings.handoffNotes === 'ask') await update($, meAtom, m => ({ ...m, askNote: true }))
      scheduleRescan($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await viewOf($, e.surface)
    if (e.surface === 'terminal') {
      // No Svg here: the text-mode map Client stands in for the field, with pointer and arrow keys.
      const { Client } = $.ui.resolve({ ...e, surface: 'terminal' as const })
      const rows = Math.max(14, Math.min(26, Math.floor((e.props.scroll.bodyRows || 40) * 0.55)))
      const field = <Client key="map" module="../client/map.js" props={fieldOf(view)} height={rows} />
      return drawPane(tableOf($, e), view, actionsFor($), field)
    }
    if (e.surface === 'desktop' && view.settings.desktopHits) {
      // Experimental: the same Client, drawing nothing, laid over the Svg to take pointer hits on the picture.
      const { Box, Client, Svg } = $.ui.resolve({ ...e, surface: 'desktop' as const })
      const field = (
        <Box flexDirection="column" key="field">
          <Svg source={svgOf(view)} alt={altOf(view)} />
          <Box position="absolute" top={0} left={0} width="100%" height={HIT_ROWS}>
            <Client key="map" module="../client/map.js" props={{ ...fieldOf(view), hits: true }} width="100%" height={HIT_ROWS} />
          </Box>
        </Box>
      )
      return drawPane(tableOf($, e), view, actionsFor($), field)
    }
    return drawPane(tableOf($, e), view, actionsFor($))
  })

  on('ui.message', { element: 'map' }, async ($, e, next) => {
    await onClientMessage($, e.data)
    return next(e)
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'map' } }, async ($, e, next) => {
    const word = e.props.args.trim().split(/\s+/)[0]?.toLowerCase()
    if (word !== 'here') return next(e)
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
    if (e.origin.kind !== 'person') return next(e)
    const ui = await read($, uiAtom)
    const backed = backedOut(ui)
    if (!backed) return next(e)
    await update($, uiAtom, () => backed)
    return { value: undefined }
  })
}
