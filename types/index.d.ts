// Constellation's $.state contract. Every value the hooks module keeps in
// $.state is declared here under the plugin's name; `claude plugin validate`
// holds each `atom({ plugin: 'constellation', key })` in the module to it.
//
// Phase 1 will add: ui (view, focusTopic, selected, hover, query, rangeDays,
// showSettings, moveMode, toast), revision (bumps when the model changes),
// me (this session's topic, the suggested topic, band state).

declare module 'claude-code' {
  interface PluginState {
    constellation: {
      /** Bumps whenever the scanned model (sessions, topics, notes) changes. */
      revision: number
    }
  }
}
