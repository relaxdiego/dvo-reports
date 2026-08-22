/**
 * Drives a real browser through the adjust-location flow.
 *
 * jsdom renders nothing, so the test suite cannot see a stacking bug: the
 * map drawn on the form painted straight over the sheet opened above it,
 * and every test still passed. This opens the page in Chromium, attaches a
 * geotagged photo, opens the picker, and asks the browser what is actually
 * on top.
 *
 *   node scripts/check-adjust-location.mjs <url> <photo> <shot-dir>
 */
import puppeteer from 'puppeteer-core'

const [url, photo, shots] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM ?? 'chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const fail = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }) // a phone
  await page.goto(url, { waitUntil: 'networkidle2' })

  const input = await page.waitForSelector('#photos')
  await input.uploadFile(photo)

  // The map on the form, drawn from the photo's own place.
  await page.waitForSelector('.mapwrap.inline .leaflet-container', { timeout: 15000 })
  await page.screenshot({ path: `${shots}/1-form.png` })

  // Scrolled to, not clicked from nowhere. A reporter reaches this button by
  // scrolling the form down, which is what puts the map on the form on
  // screen — and an off-screen map cannot cover anything.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Adjust location')
    b.scrollIntoView({ block: 'center' })
  })
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: `${shots}/1b-scrolled.png` })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Adjust location')
    b.click()
  })
  await page.waitForSelector('.sheet .leaflet-container', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 800)) // tiles, and the sheet settling
  await page.screenshot({ path: `${shots}/2-picker.png` })

  // Every point across the sheet, not three hopeful ones: the map on the
  // form covered the lower half and three samples fell in the gaps.
  const bleed = await page.evaluate(() => {
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

  if (bleed.hits.length) {
    const ys = bleed.hits.map((h) => h.y)
    console.log(`FAIL  the map on the form paints over the sheet at ${bleed.hits.length} points`)
    console.log(`      between y=${Math.min(...ys)} and y=${Math.max(...ys)}, in a sheet ${bleed.sheet.h} tall`)
    fail.push('the form map covers the picker')
  } else {
    console.log('pass  nothing from the form paints over the sheet')
  }

} finally {
  await browser.close()
}

if (fail.length) {
  console.error(`\nthe sheet is covered at: ${fail.join(', ')}`)
  process.exit(1)
}
console.log('\nthe picker is on top everywhere it was tested')
