/**
 * Drives a real browser to the two maps that open over the form: the one a
 * photo's coordinates open, and the picker behind the `Adjust` link.
 *
 * jsdom renders nothing, so the test suite cannot see a stacking bug: the
 * map drawn on the form painted straight over the sheet opened above it,
 * and every test still passed. This opens the page in Chromium, attaches a
 * geotagged photo, opens each sheet in turn, and asks the browser what is
 * actually on top.
 *
 * It also puts a real finger on the map on the form and drags. That map must
 * not move: it sits in the middle of a form somebody scrolls with their
 * thumb, so a drag on it has to scroll the page. Whether it does is decided
 * by a `touch-action` Leaflet writes onto the element, which is another thing
 * jsdom has no opinion about.
 *
 *   node scripts/check-place-sheet.mjs <url> <photo> <shot-dir>
 */
import puppeteer from 'puppeteer-core'
import { chromium } from './chromium.mjs'

const [url, photo, shots] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: chromium(),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const fail = []

/** Opens a sheet with a map in it and waits for the map and the tiles. */
async function open(page, tap) {
  await page.evaluate(tap)
  await page.waitForSelector('.sheet .leaflet-container', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 800)) // tiles, and the sheet settling
}

/**
 * Every point across the sheet, not three hopeful ones: the map on the form
 * covered the lower half and three samples fell in the gaps.
 */
function bleeding(page) {
  return page.evaluate(() => {
    const box = document.querySelector('.sheet').getBoundingClientRect()
    const hits = []
    const step = 20
    for (let y = box.top + 4; y < box.bottom - 4; y += step) {
      for (let x = box.left + 4; x < box.right - 4; x += step) {
        const el = document.elementFromPoint(x, y)
        if (el?.closest('.mapwrap.inline')) hits.push({ x: Math.round(x), y: Math.round(y) })
      }
    }
    return { hits, sheet: { w: Math.round(box.width), h: Math.round(box.height) } }
  })
}

/** Says whether the form's map painted over the sheet that is open. */
function check(bleed, what) {
  if (bleed.hits.length) {
    const ys = bleed.hits.map((h) => h.y)
    console.log(`FAIL  the map on the form paints over ${what} at ${bleed.hits.length} points`)
    console.log(`      between y=${Math.min(...ys)} and y=${Math.max(...ys)}, in a sheet ${bleed.sheet.h} tall`)
    fail.push(`the form map covers ${what}`)
  } else {
    console.log(`pass  nothing from the form paints over ${what}`)
  }
}

/**
 * Puts a finger on something and drags it up the screen, in steps, the way a
 * thumb scrolls. Answers what moved: the page, the map inside, or neither.
 */
async function drag(page, selector) {
  const before = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const box = el.getBoundingClientRect()
    return {
      x: Math.round(box.left + box.width / 2),
      y: Math.round(box.top + box.height / 2),
      scroll: Math.round(window.scrollY),
      pane: el.querySelector('.leaflet-map-pane').style.transform,
      touchAction: getComputedStyle(el.querySelector('.leaflet-container')).touchAction,
    }
  }, selector)

  await page.touchscreen.touchStart(before.x, before.y)
  for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(before.x, before.y - i * 15)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 600)) // the scroll settling

  const after = await page.evaluate((sel) => ({
    scroll: Math.round(window.scrollY),
    pane: document.querySelector(sel).querySelector('.leaflet-map-pane').style.transform,
  }), selector)

  return {
    touchAction: before.touchAction,
    pageScrolled: after.scroll - before.scroll,
    mapMoved: after.pane !== before.pane,
  }
}

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true }) // a phone
  // A fresh browser profile is always a first visit, so the welcome sheet
  // would open over the form. It is not what this script checks, so this
  // page arrives as a reporter who has been here before. See session.ts.
  await page.evaluateOnNewDocument(() => localStorage.setItem('dvo-reports.welcomed', 'yes'))
  await page.goto(url, { waitUntil: 'networkidle2' })

  const input = await page.waitForSelector('#photos')
  await input.uploadFile(photo)

  // The map on the form, drawn from the photo's own place.
  await page.waitForSelector('.mapwrap.inline .leaflet-container', { timeout: 15000 })
  await page.screenshot({ path: `${shots}/1-form.png` })

  // Scrolled to, not clicked from nowhere. A reporter reaches the place on a
  // photo's row by scrolling the form, which is what puts the map on the form
  // on screen — and an off-screen map cannot cover anything.
  await page.evaluate(() => {
    document.querySelector('.mapwrap.inline').scrollIntoView({ block: 'center' })
  })
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: `${shots}/1b-scrolled.png` })
  // A thumb dragged up the map on the form. The page has to move and the
  // map has to stay: it is a picture of a place, not a thing to steer.
  const dragged = await drag(page, '.mapwrap.inline')
  if (dragged.mapMoved) {
    console.log('FAIL  the map on the form slid under the finger instead of the page scrolling')
    fail.push('the form map drags')
  } else if (!dragged.pageScrolled) {
    console.log(`FAIL  a drag on the map on the form scrolled nothing (touch-action: ${dragged.touchAction})`)
    fail.push('the form map swallows a scroll')
  } else {
    console.log(`pass  a drag on the map on the form scrolls the page by ${dragged.pageScrolled}px`)
  }

  // The map a photo's coordinates open, and then the picker behind the
  // Adjust link. Both are sheets with a map inside, over a form with a map
  // in it, which is the arrangement that went wrong before.
  await open(page, () => document.querySelector('.photorow a').click())
  await page.screenshot({ path: `${shots}/2-sheet.png` })
  check(await bleeding(page), 'the sheet on a photo’s place')

  await page.evaluate(() => {
    ;[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.trim() === 'Close').click()
  })
  await page.waitForSelector('.sheet', { hidden: true, timeout: 15000 })

  await open(page, () => document.querySelector('.street .adjust').click())
  await page.screenshot({ path: `${shots}/3-picker.png` })
  check(await bleeding(page), 'the picker')

} finally {
  await browser.close()
}

if (fail.length) {
  console.error(`\nwhat went wrong: ${fail.join(', ')}`)
  process.exit(1)
}
console.log('\nboth sheets are on top everywhere they were tested, and the form’s map stays put')
