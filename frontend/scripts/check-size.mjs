/**
 * Fails when the first page load grows past its budget.
 *
 * The size of what a citizen downloads on mobile data is the point of this
 * project, and nothing else measures it: Vite's chunkSizeWarningLimit counts
 * raw bytes and only warns, so a build stays green while the bundle doubles.
 *
 * What it measures is every file dist/index.html references — the module, the
 * stylesheet, and any modulepreload — gzipped, because that is what travels.
 * Reading them off the page rather than globbing assets/ matters: it follows
 * Vite's content hashes without being told, and it counts a newly eager chunk
 * the day one appears. Globbing index-*.js would miss that, and measuring all
 * of dist/ would wrongly count Leaflet, which only a reporter who has attached
 * a photo ever fetches.
 *
 *   node scripts/check-size.mjs <dist-dir>
 */
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

// Room for ordinary work above today's 24.4 kB, while a doubling fails loudly.
// Raising this is a decision, not a formality: read the table this prints and
// say in the commit message what the extra bytes buy a reporter.
//
// It was 23.0 kB against a 22.5 kB page, and went to 24.5 when the form and
// the reports tab learned about a report kept on the phone: the card a draft
// is drawn as, the offer a failed send puts up, the button under Send report
// that does the same thing at any moment, and the sheet that says where the
// report went. The storage behind all of it is not in this number — saved.ts
// is its own chunk, fetched when a photograph is attached — but none of the
// four can wait behind an import() that only one of the others would
// trigger.
//
// Raised again here rather than left at 24.5, which the page had come within
// 0.1 kB of. A budget that fails on the next unrelated line is a budget that
// gets raised without being read, which is the one thing this file exists to
// prevent.
//
// And again to 26.0, for the same reason: the page had crept to within 0.03 kB
// of 25.5, so the next line of any kind failed. The line that met it was a
// report card learning to stop waiting when the reporter closes the sign-in
// instead of asking the city for a code — before it, that card sat under
// "Reading what happened…" for the rest of the visit. Shortening the sentence
// bought 9 bytes of the 43 needed, so the cost is the branch, not the words.
//
// And again to 26.5, for the notice rather than for a feature. Four sentences
// in sitenotice.tsx did not match the code: the draft button was said to be
// there whenever the reporter likes when it needs a photograph first, the log
// line was said to be written only when a report fails when every report
// leaves one, the kept list's photographs were said to need a signal when they
// need a signal and a live city session, and the photograph was said to carry
// its place and its time onward when the whole GPS reading travels. Saying so
// is longer than not saying so. Trimming the new words back bought 13 bytes of
// the 43, which is what prose costs after gzip, so the choice was the budget or
// the truth. If this line is ever the one in the way again, the disclaimer's
// text is about 5.5 kB that only a reporter who opens it ever reads, and it
// could go behind an import() the way the map does.
// And again to 27.0, for the wash of colour over something that has just been
// loaded behind the reporter — the list when the city's newest replaces it,
// and a report's history when it lands a moment after the card was opened.
// 156 bytes measured, most of it the rule and its keyframes; the history has
// the wash for nothing, since a browser animates a new element by itself, and
// the bytes are the class the list needs because its rows outlive the refresh.
// What they buy is the answer to what the light at the top of the list stops
// without saying: a list that changes in silence while it is being read is one
// the reporter has to read again to trust.
const BUDGET = 27_000

const dist = process.argv[2] ?? 'dist'
const html = readFileSync(join(dist, 'index.html'), 'utf8')

// Both tags that block or feed the first render. A favicon is rel="icon" and
// is not one of them; neither is a prefetch, which by definition is not needed
// to show the form.
const wanted = [
  /<script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"/g,
  /<link[^>]*\srel="(?:stylesheet|modulepreload)"[^>]*\shref="([^"]+)"/g,
]

const files = wanted.flatMap((re) => [...html.matchAll(re)].map((m) => m[1]))
if (!files.length) {
  console.error(`no module or stylesheet referenced from ${dist}/index.html — did the build run?`)
  process.exit(1)
}

let total = 0
for (const file of files.sort()) {
  const size = gzipSync(readFileSync(join(dist, file.replace(/^\//, '')))).length
  total += size
  console.log(`  ${kb(size).padStart(8)}  ${file}`)
}

if (total > BUDGET) {
  console.error(
    `\nFAIL  the first page load is ${kb(total)} gzipped, over its ${kb(BUDGET)} budget.\n` +
      `      Everybody downloads this before they see the form. Put the new weight\n` +
      `      behind a dynamic import(), the way frontend/src/map.tsx holds Leaflet,\n` +
      `      or raise BUDGET in this file and say in the commit message why.`,
  )
  process.exit(1)
}

console.log(`\npass  the first page load is ${kb(total)} gzipped, within its ${kb(BUDGET)} budget`)

function kb(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`
}
