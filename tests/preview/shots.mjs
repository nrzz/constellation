// Dev tooling only (Node + the preinstalled Playwright): PNG screenshots of the rendered SVGs in tests/out.
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The container's Playwright is on NODE_PATH, which only `require` reads.
const { chromium } = createRequire(import.meta.url)('playwright')

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out')
// The field is transparent: it is shot on the Desktop app's own dark surface, and once more in light.
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 })
for (const name of readdirSync(out).filter(f => f.endsWith('.svg'))) {
  const svg = readFileSync(join(out, name), 'utf8')
  // A crowded map draws taller than the base 520: the shot follows the document's own height.
  const height = Number(/<svg[^>]*\sheight="(\d+)"/.exec(svg)?.[1] ?? 520)
  await page.setViewportSize({ width: 900, height: height + 40 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setContent(`<body style="margin:0;background:#1b1b1d;padding:20px">${svg}</body>`)
  await page.screenshot({ path: join(out, name.replace('.svg', '.png')), clip: { x: 20, y: 20, width: 860, height } })
  if (name === 'map.svg' || name === 'focus.svg') {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setContent(`<body style="margin:0;background:#f4f4f5;padding:20px">${svg}</body>`)
    await page.screenshot({ path: join(out, name.replace('.svg', '-light.png')), clip: { x: 20, y: 20, width: 860, height } })
  }
  console.log(`shot ${name}`)
}
await browser.close()
