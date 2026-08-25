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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromium } from './chromium.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', 'brand', 'citizen-reporter.jpg')
const out = join(here, '..', 'public')

// The staging tiles do not go in public/, because public/ is copied into
// every build. They are an input to the build instead: vite.config.ts lays
// them over the real ones when the build is not for production. See the
// blueprint plugin there.
const staging = join(here, '..', 'brand', 'staging')

// A home screen icon, at the three sizes that get asked for: iOS reads the
// first by name, and site.webmanifest names the other two.
const TILES = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]

/**
 * The favicon, at the two sizes a browser actually draws in a tab.
 *
 * It is the same artwork, but not the same picture: the whole eagle with the
 * report card beside it turns to mush at 16 pixels, which was checked rather
 * than assumed. What survives is the head — the dark eye stripe and the hook
 * of the beak are two strong shapes, and two is all a 16-pixel square holds.
 */
const FAVICONS = [
  ['favicon-32.png', 32],
  ['favicon-16.png', 16],
]

/**
 * Where the head is, as a share of the box the whole eagle sits in. Named
 * this way rather than in pixels so it survives the artwork being re-cut at
 * another size — but it still describes *this* picture. Replace the artwork
 * and these four numbers have to be looked at again.
 */
const HEAD = { left: 0.43, top: 0.16, right: 0.98, bottom: 0.53 }

// The staging tile: the same eagle drawn as a blueprint, so a maintainer
// with both on one home screen can tell at a glance which icon files a real
// report. Paper blue, white ink, and the grid a drawing is set out on.
const BLUEPRINT_PAPER = '#123a75'
const BLUEPRINT_INK = [255, 255, 255]

// A tile is drawn on squared paper and can carry fine lines. A 16-pixel
// favicon can carry neither: the grid turns to noise and the lines thin to
// nothing, so the drawing is filled in instead and reads as a shape.
const TILE_LOOK = { grid: true, fill: 0.14 }
const FAVICON_LOOK = { grid: false, fill: 0.5 }

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
  const { square, head } = await page.evaluate(async (src, headBox) => {
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

    const width = right - left + 1
    const height = bottom - top + 1

    // Cuts a piece of the artwork out, centred on a white square of its own.
    const cutOut = (x, y, w, h, margin) => {
      const box = Math.round(Math.max(w, h) * margin)
      const cut = document.createElement('canvas')
      cut.width = box
      cut.height = box
      const cutCtx = cut.getContext('2d')
      cutCtx.fillStyle = '#ffffff'
      cutCtx.fillRect(0, 0, box, box)
      cutCtx.drawImage(img, x, y, w, h, (box - w) / 2, (box - h) / 2, w, h)
      return cut.toDataURL('image/png')
    }

    return {
      // Square, because every size below is, and the tall side decides. The
      // small margin keeps the beak and the wing tips off the edge without
      // shrinking the eagle into the middle of nothing.
      square: cutOut(left, top, width, height, 1.04),
      // The head alone, named as a share of the box the whole eagle sits in.
      head: cutOut(
        left + headBox.left * width,
        top + headBox.top * height,
        (headBox.right - headBox.left) * width,
        (headBox.bottom - headBox.top) * height,
        1,
      ),
    }
  }, artwork, HEAD)

  // Traced once, at the largest tile's size, and then shrunk like any other
  // picture. Tracing each size on its own would find different edges in each
  // and give three icons that are not quite the same drawing.
  const blueprint = await page.evaluate(traceBlueprint, square, 512, BLUEPRINT_PAPER, BLUEPRINT_INK, TILE_LOOK)

  // Traced at 64, not at 512 like the tile. Lines found on a large drawing
  // and then shrunk to 16 pixels thin away to nothing; found at 64 they are
  // already thick enough in proportion to survive the last halving.
  const blueprintHead = await page.evaluate(traceBlueprint, head, 64, BLUEPRINT_PAPER, BLUEPRINT_INK, FAVICON_LOOK)

  mkdirSync(staging, { recursive: true })
  for (const [name, size] of TILES) {
    write(join(out, name), await page.evaluate(scale, square, size, '#ffffff'))
    write(join(staging, name), await page.evaluate(scale, blueprint, size, BLUEPRINT_PAPER))
  }
  for (const [name, size] of FAVICONS) {
    write(join(out, name), await page.evaluate(scale, head, size, '#ffffff'))
    write(join(staging, name), await page.evaluate(scale, blueprintHead, size, BLUEPRINT_PAPER))
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
      <h1>Bantay<br>Dabaw</h1>
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

/*
 * Everything below runs inside the browser, not here. Each one is handed to
 * page.evaluate, which sends its source across, so they can use nothing from
 * this file — only what is passed in.
 */

/** Draws a square picture at `side`, on an opaque background. */
async function scale(src, side, background) {
  const img = new Image()
  img.src = src
  await img.decode()

  // Halved until one more halving would overshoot, then drawn to the size
  // asked for. One jump from 1200-odd pixels to 180 leaves the feathers
  // ragged however good the browser's smoothing is.
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
  // transparency, so a tile is opaque under the eagle.
  ctx.fillStyle = background
  ctx.fillRect(0, 0, side, side)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(from, 0, 0, side, side)
  return canvas.toDataURL('image/png')
}

/**
 * The same eagle as a drawing on blueprint paper.
 *
 * A blueprint is a negative — pale lines on blue — so what is wanted is the
 * boundaries of the artwork rather than its colours. Those come from a Sobel
 * pass over the brightness: it answers "how fast is this changing here",
 * which is large where one flat colour meets another and near zero inside
 * them. The gold, the white and the navy of the original therefore leave no
 * trace at all except where they meet, which is exactly the wanted result.
 *
 * The edges are found at the icon's own size, not the artwork's. At full
 * size a JPEG's own speckle is an edge too, and tracing it gives a tile
 * covered in white dust.
 */
async function traceBlueprint(src, side, paper, ink, look) {
  const img = new Image()
  img.src = src
  await img.decode()

  const flat = document.createElement('canvas')
  flat.width = side
  flat.height = side
  const flatCtx = flat.getContext('2d')
  flatCtx.fillStyle = '#ffffff'
  flatCtx.fillRect(0, 0, side, side)
  flatCtx.imageSmoothingQuality = 'high'
  flatCtx.drawImage(img, 0, 0, side, side)
  const px = flatCtx.getImageData(0, 0, side, side).data

  const light = new Float32Array(side * side)
  for (let i = 0; i < light.length; i++) {
    light[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
  }

  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, side, side)

  // The grid a drawing is set out on. Faint, and every fourth line a little
  // less so, the way squared paper is printed.
  ctx.lineWidth = Math.max(1, Math.round(side / 512))
  const step = side / 16
  for (let n = 1; look.grid && n < 16; n++) {
    const at = Math.round(n * step) + 0.5
    ctx.strokeStyle = `rgba(${ink}, ${n % 4 === 0 ? 0.22 : 0.1})`
    ctx.beginPath()
    ctx.moveTo(at, 0)
    ctx.lineTo(at, side)
    ctx.moveTo(0, at)
    ctx.lineTo(side, at)
    ctx.stroke()
  }

  // White where the drawing has an edge, clear where it does not, on a layer
  // of its own: putImageData would overwrite the paper and the grid rather
  // than lie on top of them.
  const lines = document.createElement('canvas')
  lines.width = side
  lines.height = side
  const linesCtx = lines.getContext('2d')
  const out = linesCtx.createImageData(side, side)
  const at = (x, y) => light[Math.min(side - 1, Math.max(0, y)) * side + Math.min(side - 1, Math.max(0, x))]
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const gx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        at(x + 1, y - 1) - 2 * at(x + 1, y) - at(x + 1, y + 1)
      const gy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        at(x - 1, y + 1) - 2 * at(x, y + 1) - at(x + 1, y + 1)
      // The floor drops the last of the speckle; the divisor decides how
      // much of a change counts as a line worth drawing.
      const edge = Math.min(1, Math.max(0, (Math.hypot(gx, gy) - 24) / 150))
      // A wash inside the eagle as well, so it reads as a shape and not as
      // an outline floating on the paper. Anything not the white it was
      // drawn on is inside it.
      const fill = light[y * side + x] < 246 ? look.fill : 0
      const i = (y * side + x) * 4
      out.data[i] = ink[0]
      out.data[i + 1] = ink[1]
      out.data[i + 2] = ink[2]
      out.data[i + 3] = Math.round(255 * Math.min(1, edge + fill))
    }
  }
  linesCtx.putImageData(out, 0, 0)
  ctx.drawImage(lines, 0, 0)
  return canvas.toDataURL('image/png')
}
