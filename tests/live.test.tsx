// The live picture: the field Svg drawn in the Desktop's script-less frame (`isInteractive`), so hover and motion work in
// CSS; no pointer layer lies over it. The click picture (the image plus the Client layer) stays as `pictureMode: clicks`.
import { expect, test } from 'claude-code/testing'

import { pointerHint } from '../hooks/draw'
import { DEFAULT_SETTINGS, settingValue } from '../hooks/state'
import { CWD, paneOn, stubEngine } from './helpers'

test('live is the default: the Desktop picture is interactive and no Client layer lies over it', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  expect(DEFAULT_SETTINGS.pictureMode).toBe('live')
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBe(true)
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeUndefined()
  await ui.unmount()
})

test('live on VS Code: the picture is interactive too', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount(paneOn('vscode'))
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBe(true)
  await ui.unmount()
})

test('clicks: the picture is an image with the Client layer over it, as before', { options: { pictureMode: 'clicks' } }, async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeDefined()
  await ui.unmount()
})

test('the terminal keeps its text map in either mode', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneOn('terminal'))
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('the live hint says hover traces and the button under the map focuses', () => {
  const settings = { ...DEFAULT_SETTINGS }
  expect(pointerHint({ surface: 'desktop', placement: 'dock', settings })).toBe('Hover a topic to trace it · its button below focuses it')
  expect(pointerHint({ surface: 'vscode', placement: 'dock', settings })).toBe('Hover a topic to trace it · its button below focuses it')
  expect(pointerHint({ surface: 'desktop', placement: 'dock', settings: { ...settings, pictureMode: 'clicks' } })).toBe('Hover or focus a topic to trace it · Enter or click to focus')
  expect(pointerHint({ surface: 'terminal', placement: 'dock', settings })).toBe('Click or Tab to a topic · Enter focuses')
})

test('pictureMode reads live or clicks and nothing else', () => {
  expect(settingValue('pictureMode', 'clicks')).toBe('clicks')
  expect(settingValue('pictureMode', 'live')).toBe('live')
  expect(settingValue('pictureMode', 'canvas')).toBeUndefined()
})

test('the settings view offers Picture: Live / Clicks under ADVANCED, and a press switches the picture', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(paneOn('desktop'))
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Button', key: 'set:pictureMode:clicks' })).toBeUndefined()
  await ui.press({ key: 'set:advanced' })
  expect(await ui.find({ type: 'Text', text: /^Picture/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'set:pictureMode:live' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'set:pictureMode:clicks' })
  expect((await ui.find({ type: 'Button', key: 'set:pictureMode:clicks' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'settings:done' })
  expect(await ui.find({ type: 'Client', key: 'map' })).toBeDefined()
  expect((await ui.find({ type: 'Svg' }))?.props.isInteractive).toBeUndefined()
  await ui.unmount()
})
