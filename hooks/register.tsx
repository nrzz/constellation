// Constellation: the hooks module entry. Scaffold commit: registers the /map
// command and opens an empty pane, so the manifest, hooks.json and this file
// validate and load. Phase 1 fills in scan.ts, cluster.ts, layout.ts,
// draw.tsx and the band; see PLAN.md.
import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'constellation'
const revision = atom({ plugin: 'constellation', key: 'revision' } as const, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'map',
        description: 'Open or close the Constellation topic map',
        argumentHint: '[settings|close]',
        immediate: true,
      })
    } catch (error) {
      $.ui.log(`constellation: /map not registered: ${String(error)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'map' }, async ($, e) => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen && e.args.trim() === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    await $.ui.open({ id: PANE, title: 'Constellation', focus: true, closeOnEscape: true, columns: 96 })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const n = await read($, revision)
    return (
      <Box flexDirection="column" padding={1}>
        <Text weight="semibold">Constellation</Text>
        <Text dimColor>Scaffold build (revision {n}). The topic map lands in Phase 1; see PLAN.md.</Text>
      </Box>
    )
  })
}
