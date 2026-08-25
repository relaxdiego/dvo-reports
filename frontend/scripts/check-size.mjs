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
const BUDGET = 25_500

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
