/**
 * Drives a real browser through the photo opened from a thumbnail.
 *
 * jsdom has no layout, so the unit tests can say the picture is in the
 * document and nothing more. Everything that makes it worth having is a
 * question only a browser answers: whether it is on top of the form, whether
 * the map drawn on the form paints through it the way it once painted through
 * the place sheet, and whether the picture is actually bigger than the
 * thumbnail that opened it.
 *
 * The thumbnail is checked against both maps the form can be showing. Beside
 * a photo that carries its own place there is the real map; beside one that
 * carries none there is `MapUnknown`, the grey map that asks for a location,
 * which is the same Leaflet with the same numbering plus a box of its own
 * laid over it. A picture that opened under either would look like a broken
 * thumbnail rather than a photograph.
 *
 * Then a real finger. Moving between photographs is a touch gesture, and the
 * unit tests drive it with events they build themselves — which proves the
 * arithmetic and nothing about whether a browser's own touches ever reach the
 * handler. Only a browser with a touchscreen answers that, and only a browser
 * lays the row out: whether the photograph waiting at the side is really off
 * the screen, and whether the row moves under a finger that is still down,
 * are both questions about pixels.
 *
 *   node scripts/check-lightbox.mjs <url> <photo> <photo-with-no-place> <shot-dir>
 */
import puppeteer from 'puppeteer-core'
import { chromium } from './chromium.mjs'

const [url, photo, placeless, shots] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: chromium(),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const fail = []

/** A page that has been here before, so the welcome sheet is not in the way. */
async function visit(touch = false) {
  const page = await browser.newPage()
  // A phone. The touchscreen is asked for only where it is used: it changes
  // what the browser reports about itself, and the checks above were written
  // against a page without one.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: touch })
  await page.evaluateOnNewDocument(() => localStorage.setItem('dvo-reports.welcomed', 'yes'))
  await page.goto(url, { waitUntil: 'networkidle2' })
  return page
}

/**
 * Every point across the open picture, not three hopeful ones: the map on the
 * form covered the lower half of the place sheet and three samples fell in
 * the gaps. Anything answering from outside the lightbox is something the
 * reporter would be looking at instead of their photograph.
 */
async function covered(page) {
  return page.evaluate(() => {
    const box = document.querySelector('.lightbox').getBoundingClientRect()
    const hits = []
    const step = 20
    for (let y = box.top + 4; y < box.bottom - 4; y += step) {
      for (let x = box.left + 4; x < box.right - 4; x += step) {
        const el = document.elementFromPoint(x, y)
        if (el && !el.closest('.lightbox')) {
          hits.push({ x: Math.round(x), y: Math.round(y), what: el.className || el.tagName })
        }
      }
    }
    return hits
  })
}

/**
 * Gives every picture on the page real pixels, of a known size.
 *
 * The fixture is exactly the bytes the metadata reader is tested against: a
 * JPEG header, the tags, and no image data at all. A browser draws that as a
 * broken image with no size of its own, so nothing about how big a photograph
 * opens can be measured from it. The CSS does not care where pixels come
 * from, and a picture larger than the screen is what a camera hands over.
 */
async function withPixels(page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 900
    const pen = canvas.getContext('2d')
    pen.fillStyle = '#2e7d32'
    pen.fillRect(0, 0, 1200, 900)
    pen.fillStyle = '#ffffff'
    pen.fillRect(300, 225, 600, 450)
    const src = canvas.toDataURL('image/png')
    await Promise.all(
      [...document.images].map(
        (img) =>
          new Promise((done) => {
            img.addEventListener('load', done, { once: true })
            img.addEventListener('error', done, { once: true })
            img.src = src
          }),
      ),
    )
  })
}

try {
  // 1. The photo that is going with the report, opened from its row.
  const page = await visit()
  const input = await page.waitForSelector('#photos')
  await input.uploadFile(photo)

  // The map on the form is the hazard: Leaflet numbers its own layers up to
  // 1000. Wait for it to exist, and scroll it into view — an off-screen map
  // cannot cover anything, so a check taken before this proves nothing.
  await page.waitForSelector('.mapwrap.inline .leaflet-container', { timeout: 15000 })
  await page.evaluate(() => {
    document.querySelector('.photorow').scrollIntoView({ block: 'center' })
  })
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: `${shots}/lightbox-1-form.png` })

  await page.evaluate(() => document.querySelector('.photorow .thumbtap').click())
  await page.waitForSelector('.lightbox img', { timeout: 5000 })
  await withPixels(page)
  await new Promise((r) => setTimeout(r, 300)) // the picture, and the layout settling
  await page.screenshot({ path: `${shots}/lightbox-2-open.png` })

  const bleed = await covered(page)
  if (bleed.length) {
    const ys = bleed.map((h) => h.y)
    console.log(`FAIL  the form paints over the photo at ${bleed.length} points`)
    console.log(`      between y=${Math.min(...ys)} and y=${Math.max(...ys)}, first is ${bleed[0].what}`)
    fail.push('the form covers the open photo')
  } else {
    console.log('pass  nothing from the form paints over the open photo')
  }

  // Bigger than the square it was opened from, or there was no point.
  const sizes = await page.evaluate(() => {
    const thumb = document.querySelector('.photorow .thumbtap img').getBoundingClientRect()
    const big = document.querySelector('.lightbox img').getBoundingClientRect()
    return { thumb: Math.round(thumb.width), big: Math.round(big.width), page: window.innerWidth }
  })
  if (sizes.big <= sizes.thumb * 2) {
    console.log(`FAIL  the photo opens ${sizes.big}px wide, next to a ${sizes.thumb}px thumbnail`)
    fail.push('the open photo is barely larger than its thumbnail')
  } else {
    console.log(`pass  the photo opens ${sizes.big}px wide on a ${sizes.page}px screen, from a ${sizes.thumb}px thumbnail`)
  }

  await page.evaluate(() => document.querySelector('.lightbox .x').click())
  await new Promise((r) => setTimeout(r, 200))
  if (await page.$('.lightbox')) {
    console.log('FAIL  the cross did not put the photo away')
    fail.push('the photo will not close')
  } else {
    console.log('pass  the cross puts the photo away and the form is back')
  }

  // 2. The same, on the form that a photo carrying no place produces: the
  // grey map asking for a location, with its own box laid over Leaflet's
  // panes. That box is positioned, and a picture rising only as far as it
  // would be trapped behind the words and the button.
  const second = await visit()
  const picker = await second.waitForSelector('#photos')
  await picker.uploadFile(placeless)
  await second.waitForSelector('.mapwrap.unknown .leaflet-container', { timeout: 15000 })
  await second.evaluate(() => {
    document.querySelector('.mapwrap.unknown').scrollIntoView({ block: 'center' })
  })
  await new Promise((r) => setTimeout(r, 300))
  await second.screenshot({ path: `${shots}/lightbox-3-noplace-form.png` })

  // The button has to be reachable, which is the whole point of the box: it
  // is the only way a place reaches a report the photographs said nothing
  // about. Something else answering at its middle is something the reporter
  // would press instead.
  const onButton = await second.evaluate(() => {
    const b = document.querySelector('.mapask .share')
    if (!b) return 'no share button on the grey map'
    const box = b.getBoundingClientRect()
    const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return el && b.contains(el) ? null : `${el?.className || el?.tagName} is over the button`
  })
  if (onButton) {
    console.log(`FAIL  ${onButton}`)
    fail.push('the share button cannot be pressed')
  } else {
    console.log('pass  the share button on the grey map takes the tap')
  }

  await second.evaluate(() => document.querySelector('.photorow .thumbtap').click())
  await second.waitForSelector('.lightbox img', { timeout: 5000 })
  await withPixels(second)
  await new Promise((r) => setTimeout(r, 300))
  await second.screenshot({ path: `${shots}/lightbox-4-noplace-open.png` })

  const held = await second.evaluate(() => {
    const box = document.querySelector('.lightbox').getBoundingClientRect()
    return { w: Math.round(box.width), h: Math.round(box.height), vw: window.innerWidth, vh: window.innerHeight }
  })
  if (held.w < held.vw || held.h < held.vh) {
    console.log(`FAIL  the photo opens in a ${held.w}x${held.h} box on a ${held.vw}x${held.vh} screen`)
    fail.push('the photo does not cover the page')
  } else {
    console.log('pass  the photo covers the page, over the grey map as well')
  }

  const bleed2 = await covered(second)
  if (bleed2.length) {
    console.log(`FAIL  the form paints over the photo at ${bleed2.length} points, first is ${bleed2[0].what}`)
    fail.push('the grey map covers the open photo')
  } else {
    console.log('pass  nothing from the form, grey map included, paints over the open photo')
  }

  // 3. A finger moving across the open photograph, with two attached. The
  // same file twice is two photographs as far as the page is concerned, and
  // the line at the foot is what says which one is on the screen.
  const third = await visit(true)
  const both = await third.waitForSelector('#photos')
  await both.uploadFile(photo, photo)
  await third.waitForFunction(() => document.querySelectorAll('.photorow').length === 2, {
    timeout: 15000,
  })
  await third.evaluate(() => document.querySelector('.photorow .thumbtap').click())
  await third.waitForSelector('.lightbox .count', { timeout: 5000 })
  await withPixels(third)
  await new Promise((r) => setTimeout(r, 200))

  const said = () => third.$eval('.lightbox .count', (el) => el.textContent.trim())
  const first = await said()

  /*
    Both measurements are of the row and its screens, never of a photograph's
    own box. An <img> is as wide as the picture inside it, so it changes size
    the moment one finishes loading, and a baseline taken a moment earlier
    then reads as movement that never happened.
  */
  const where = () =>
    third.evaluate(() => ({
      row: Math.round(document.querySelector('.lightbox .track').getBoundingClientRect().left),
      next: Math.round(document.querySelectorAll('.lightbox .slide')[1].getBoundingClientRect().left),
      screen: window.innerWidth,
    }))

  // At rest the photograph being looked at has the screen to itself. The row
  // is one screen wide per photograph, and a screen has to be exactly a
  // screen: put the margin round the picture on the lightbox instead of on
  // each of those screens and the next photograph shows a sliver of itself.
  const parked = await where()
  if (parked.next < parked.screen) {
    console.log(`FAIL  the next photo starts ${parked.next}px in, on a ${parked.screen}px screen`)
    fail.push('the next photo shows at the edge before it is asked for')
  } else {
    console.log('pass  the photo beside the open one is off the screen until it is asked for')
  }

  // Across the middle of the screen, in steps, the way a thumb travels. One
  // jump from end to end is a gesture no hand makes and some browsers drop.
  await third.touchscreen.touchStart(300, 420)
  for (const x of [260, 220, 180, 140]) await third.touchscreen.touchMove(x, 420)

  /*
    Still down. This is the whole point of the animation: the reporter sees
    the next photograph coming while they are dragging, so a swipe that will
    not be far enough shows itself as one before they let go.

    Measured before the screenshot, never after. Taking one moves the finger:
    the capture re-states the device metrics, the browser re-reports the touch
    it is still holding at coordinates of its own, and the row jumps further
    than any finger went. That read as the drag working, and would have gone
    on reading that way whatever the code did.

    Not the whole 160px either. A browser is free to run several of those
    moves together and report one, so what is checked is that the row went a
    long way with the finger, not that it went exactly as far.
  */
  const dragged = await where()
  const moved = parked.row - dragged.row
  if (moved < 100) {
    console.log(`FAIL  160px of finger moved the row ${moved}px`)
    fail.push('the row does not follow the finger')
  } else {
    console.log(`pass  the row follows the finger, ${moved}px of it while still down`)
  }

  await third.screenshot({ path: `${shots}/lightbox-4-dragging.png` })
  await third.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 400)) // the row settling
  await third.screenshot({ path: `${shots}/lightbox-5-swiped.png` })

  const now = await said()
  if (first !== '1 of 2' || now !== '2 of 2') {
    console.log(`FAIL  a swipe left took "${first}" to "${now}", wanted "1 of 2" to "2 of 2"`)
    fail.push('a swipe does not move along the group')
  } else {
    console.log('pass  a swipe left moves to the next photo of the two')
  }

  // The swipe must not also be read as a tap, which is what puts it away.
  if (!(await third.$('.lightbox'))) {
    console.log('FAIL  the swipe closed the photo instead of moving along it')
    fail.push('a swipe closes the photo')
  } else {
    console.log('pass  the swipe leaves the photo open')
  }

  await third.touchscreen.touchStart(140, 420)
  for (const x of [180, 220, 260, 300]) await third.touchscreen.touchMove(x, 420)
  await third.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 200))
  const back = await third.$eval('.lightbox .count', (el) => el.textContent.trim())
  if (back !== '1 of 2') {
    console.log(`FAIL  a swipe right left it saying "${back}", wanted "1 of 2"`)
    fail.push('a swipe right does not go back')
  } else {
    console.log('pass  a swipe right goes back to the photo before')
  }
} finally {
  await browser.close()
}

if (fail.length) {
  console.error(`\nthe open photo is wrong at: ${fail.join(', ')}`)
  process.exit(1)
}
console.log('\nthe photo opens over everything, and a finger moves between them')
