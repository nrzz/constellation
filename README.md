# Constellation

A Claude Code mod that maps the sessions of one project folder as a
constellation of topics. One folder holds many topics; each topic is an ordered
chain of sessions; every new session joins a chain and picks up that chain's
latest handoff note, so same-topic sessions stop piling up in the Desktop
sidebar.

Status: scaffold. The design is approved: the interactive prototype is public at
https://claude.ai/artifact/EAVPtFffcFroUfjiKKp7C6#play-b8188f0249b0 and its
source is `design/TopicMap.dc.html`. The full build plan, API notes and next
steps are in [PLAN.md](PLAN.md). Phase 1
(the Svg map, join chooser, handoff injection, list view) and Phase 2 (the
Client hit layer) are not built yet.

## Install (once released)

```bash
claude plugin marketplace add nrzz/constellation
claude plugin install constellation@constellation
```

Requires Claude Code 2.1.287 or later. In the Desktop app's Code tab: click +
next to the prompt box, then Plugins, Add marketplace with `nrzz/constellation`,
then Add plugin.

## Commands (planned)

- `/map` opens or closes the Constellation pane; `/map settings` opens its settings.
- `/topic <name>` joins or creates a topic for this session.
- `/park <note>` saves a handoff note for this session.
- `/pickup [n]` injects the note of step n of the joined topic.

## Known limits

- A node on the map can never switch the Desktop app to an existing session;
  it can message it, pick up its note, or start a new session from it.
- The terminal gets the list view only (no Svg there).

MIT licensed.
