// Dev tooling only (Node + the preinstalled Playwright): the plugin icon,
// .claude-plugin/icon.png, 1024 px square: the prototype's constellation glyph.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 24 24">
  <rect width="24" height="24" fill="#0B0E13"/>
  <g stroke="#F2A33A" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M7.6 15.6L10.8 8.8"/><path d="M13.9 7.9L17.2 12"/><path d="M8 17h9"/>
  </g>
  <g fill="#F2A33A">
    <circle cx="6" cy="17" r="2.6" opacity=".25"/><circle cx="12" cy="7" r="2.6" opacity=".25"/><circle cx="19" cy="13" r="2.6" opacity=".25"/>
    <circle cx="6" cy="17" r="1.5"/><circle cx="12" cy="7" r="1.5"/><circle cx="19" cy="13" r="1.5"/>
  </g>
  <g fill="#55607A" opacity=".7"><circle cx="4" cy="6" r=".35"/><circle cx="20" cy="4.5" r=".3"/><circle cx="16" cy="19.5" r=".3"/><circle cx="9.5" cy="12.5" r=".25"/><circle cx="3.5" cy="12" r=".25"/></g>
</svg>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
await page.setContent(`<body style="margin:0;background:#0B0E13">${svg}</body>`)
await page.screenshot({ path: join(repo, '.claude-plugin', 'icon.png'), clip: { x: 0, y: 0, width: 1024, height: 1024 } })
await browser.close()
console.log('wrote .claude-plugin/icon.png')
