/**
 * Drives a real browser through the disclaimer page.
 *
 * Everything that matters about this page is a thing jsdom cannot see. It
 * has no layout, so it cannot tell that the page behind shows through, that
 * something inside scrolls on its own and hides the rest, or that the Close
 * button sits on the first screen instead of after the last of the terms.
 * The unit tests check the words and the order; this checks the shape.
 *
 *   node scripts/check-disclaimer.mjs <url> <shot-dir>
 */
import puppeteer from 'puppeteer-core'

const [url, shots] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM ?? 'chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

// A phone and a laptop: the page is much longer than one screen on the
// first and only somewhat longer on the second, and Close has to be off
// the first screen on both.
const SCREENS = [
  ['phone', { width: 390, height: 844, deviceScaleFactor: 2 }],
  ['laptop', { width: 1280, height: 900, deviceScaleFactor: 1 }],
]

const fail = []
try {
  for (const [name, viewport] of SCREENS) {
    const page = await browser.newPage()
    await page.setViewport(viewport)
    // A fresh browser profile is always a first visit, so the welcome sheet
    // would open over the form. It is not what this script checks, so this
    // page arrives as a reporter who has been here before. See session.ts.
    await page.evaluateOnNewDocument(() => localStorage.setItem('dvo-reports.welcomed', 'yes'))
    await page.goto(url, { waitUntil: 'networkidle2' })

    await page.evaluate(() => {
      const link = [...document.querySelectorAll('header .linky')].find(
        (b) => b.textContent.trim() === 'disclaimer',
      )
      if (!link) throw new Error('no link reading "disclaimer" in the header')
      link.click()
    })
    await page.waitForSelector('[role="dialog"].full')
    await page.screenshot({ path: `${shots}/disclaimer-${name}-top.png` })

    const seen = await page.evaluate(() => {
      const sheet = document.querySelector('[role="dialog"]')
      const close = [...sheet.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close')
      const box = sheet.getBoundingClientRect()

      // Every point across the viewport, not three hopeful ones: a gap in
      // a full-page pop-up is the whole of the bug.
      const through = []
      for (let y = 4; y < window.innerHeight - 4; y += 20)
        for (let x = 4; x < window.innerWidth - 4; x += 20)
          if (!document.elementFromPoint(x, y)?.closest('[role="dialog"]')) through.push({ x, y })

      // Anything with its own scrollbar hides text from a reader who
      // scrolls the page, which is how the terms go unread.
      const scrollers = [...sheet.querySelectorAll('*')]
        .filter((el) => {
          const style = getComputedStyle(el)
          return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
        })
        .map((el) => el.className || el.tagName)

      return {
        covers: box.top === 0 && box.left === 0 && box.width === window.innerWidth && box.height === window.innerHeight,
        through: through.length,
        scrollers,
        frames: sheet.querySelectorAll('iframe').length,
        closeOnFirstScreen: close.getBoundingClientRect().top < window.innerHeight,
        height: Math.round(sheet.scrollHeight),
        screen: window.innerHeight,
      }
    })

    const wrong = []
    if (!seen.covers) wrong.push('the disclaimer does not cover the whole page')
    if (seen.through) wrong.push(`the page behind shows through at ${seen.through} points`)
    if (seen.scrollers.length) wrong.push(`scrolls inside the disclaimer: ${seen.scrollers.join(', ')}`)
    if (seen.frames) wrong.push('there is an iframe in the disclaimer')
    if (seen.closeOnFirstScreen) wrong.push('Close is on the first screen, before the terms')

    // The end, where the way out is, and the seam where the city's half
    // takes over from this site's. Both are worth a look by eye.
    await page.evaluate(() => {
      const sheet = document.querySelector('[role="dialog"]')
      sheet.scrollTop = sheet.scrollHeight
    })
    await page.screenshot({ path: `${shots}/disclaimer-${name}-end.png` })
    await page.evaluate(() => {
      document.querySelectorAll('[role="dialog"] h3')[1].scrollIntoView({ block: 'center' })
    })
    await page.screenshot({ path: `${shots}/disclaimer-${name}-seam.png` })

    await page.evaluate(() => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click()
    })
    if (await page.$('[role="dialog"]')) wrong.push('Close did not close it')

    for (const w of wrong) console.log(`FAIL  ${name}: ${w}`)
    if (!wrong.length) {
      console.log(
        `pass  ${name}: covers the page, ${seen.height}px of it over a ${seen.screen}px screen, Close at the end`,
      )
    }
    fail.push(...wrong.map((w) => `${name}: ${w}`))
    await page.close()
  }
} finally {
  await browser.close()
}

if (fail.length) {
  console.error(`\n${fail.length} thing(s) wrong with the disclaimer, listed above`)
  process.exit(1)
}
console.log('\nthe disclaimer covers the page and is read on the way to the way out')
