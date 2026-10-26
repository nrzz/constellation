// Dev tooling only (Node + the preinstalled Playwright): PNG screenshots of the rendered SVGs in tests/out.
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The container's Playwright is on NODE_PATH, which only `require` reads.
const { chromium } = createRequire(import.meta.url)('playwright')

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 })
for (const name of readdirSync(out).filter(f => f.endsWith('.svg'))) {
  const svg = readFileSync(join(out, name), 'utf8')
  await page.setContent(`<body style="margin:0;background:#0B0E13;padding:20px">${svg}</body>`)
  await page.screenshot({ path: join(out, name.replace('.svg', '.png')), clip: { x: 20, y: 20, width: 860, height: 520 } })
  console.log(`shot ${name}`)
}
await browser.close()
