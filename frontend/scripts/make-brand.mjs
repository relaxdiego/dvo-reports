/**
 * Draws the app tile and the social card from the one piece of artwork.
 *
 * Both come from brand/citizen-reporter.jpg, so the icon on a home screen and
 * the picture a chat app shows cannot drift apart. The outputs land in
 * public/, which Vite copies into the build untouched — none of them is part
 * of the first page load, so none of them counts against the size budget.
 *
 * It runs in a browser because the card carries words, and laying out words is
 * what a browser is for. The same browser the sheet checks use; see
 * chromium.mjs. Nothing here runs in CI, and nothing here runs at build time:
 * the results are committed. Run it again after changing the artwork or the
 * wording on the card, and commit what it writes.
 *
 *   node scripts/make-brand.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromium } from './chromium.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', 'brand', 'citizen-reporter.jpg')
const out = join(here, '..', 'public')

// A home screen icon, at the three sizes that get asked for: iOS reads the
// first by name, and site.webmanifest names the other two.
const TILES = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]

// What every scraper wants, and the shape they crop to: 1.91:1.
const CARD = { width: 1200, height: 630 }

// Read off the artwork itself, so the words beside it belong to the same
// picture. The muted grey is the site's own --muted, from src/index.css.
const NAVY = '#16294d'
const GOLD = '#d9a441'
const MUTED = '#5b6470'

const artwork = `data:image/jpeg;base64,${readFileSync(source).toString('base64')}`

const browser = await puppeteer.launch({
  executablePath: chromium(),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  await page.setViewport(CARD)
  await page.goto('about:blank')

  // The artwork sits in the middle of a large white field, and an icon made
  // from it as it arrives would be mostly margin. So the page finds where the
  // eagle actually is and cuts to it, rather than this file carrying four
  // numbers that are only true of today's picture.
  const square = await page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, img.width, img.height)

    // Anything that is not the white it was drawn on. The threshold is loose
    // because the file is a JPEG: a flat white field comes back a shade off.
    let left = img.width
    let top = img.height
    let right = 0
    let bottom = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4
        if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245) continue
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }

    // Square, because every size below is, and the tall side decides. The
    // small margin keeps the beak and the wing tips off the edge without
    // shrinking the eagle into the middle of nothing.
    const width = right - left + 1
    const height = bottom - top + 1
    const side = Math.round(Math.max(width, height) * 1.04)

    const cut = document.createElement('canvas')
    cut.width = side
    cut.height = side
    const cutCtx = cut.getContext('2d')
    cutCtx.fillStyle = '#ffffff'
    cutCtx.fillRect(0, 0, side, side)
    cutCtx.drawImage(img, left, top, width, height, (side - width) / 2, (side - height) / 2, width, height)
    return cut.toDataURL('image/png')
  }, artwork)

  for (const [name, size] of TILES) {
    // Halved until one more halving would overshoot, then drawn to the size
    // asked for. One jump from 1200-odd pixels to 180 leaves the feathers
    // ragged however good the browser's smoothing is.
    const png = await page.evaluate(
      async (src, side) => {
        const img = new Image()
        img.src = src
        await img.decode()

        let from = img
        let width = img.width
        while (width / 2 > side) {
          width = Math.round(width / 2)
          const step = document.createElement('canvas')
          step.width = width
          step.height = width
          const ctx = step.getContext('2d')
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(from, 0, 0, width, width)
          from = step
        }

        const canvas = document.createElement('canvas')
        canvas.width = side
        canvas.height = side
        const ctx = canvas.getContext('2d')
        // iOS draws its own rounded corners over this and does not honour
        // transparency, so the tile is opaque white under the eagle.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, side, side)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(from, 0, 0, side, side)
        return canvas.toDataURL('image/png')
      },
      square,
      size,
    )
    write(join(out, name), png)
  }

  // The card says the two things the header says, because a link shared in a
  // group chat is read by people who never scroll: that this is the city's
  // site being written to, and that nobody official is behind it.
  await page.setContent(`
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        width: ${CARD.width}px;
        height: ${CARD.height}px;
        display: flex;
        align-items: center;
        gap: 56px;
        padding: 0 72px;
        box-sizing: border-box;
        background: #fff;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        color: ${MUTED};
      }
      img { width: 400px; height: 400px; flex: none; }
      h1 {
        margin: 0;
        font-size: 62px;
        line-height: 1.08;
        letter-spacing: -0.02em;
        color: ${NAVY};
      }
      hr {
        width: 96px;
        height: 6px;
        margin: 26px 0;
        border: 0;
        border-radius: 3px;
        background: ${GOLD};
      }
      p { margin: 0; font-size: 27px; line-height: 1.4; }
      .plain { color: ${NAVY}; font-weight: 600; margin-bottom: 10px; }
    </style>
    <img src="${square}" alt="">
    <div>
      <h1>Davao Citizen<br>Reporter</h1>
      <hr>
      <p class="plain">Unofficial — not run by the city government</p>
      <p>A faster way to send a report to reports.davaocity.gov.ph</p>
    </div>
  `)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(out, 'social-card.png'), type: 'png' })
  console.log(`  wrote ${join(out, 'social-card.png')}`)
} finally {
  await browser.close()
}

function write(path, dataUrl) {
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`  wrote ${path}`)
}
