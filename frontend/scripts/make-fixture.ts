// Writes the test fixture photos to files, so a real browser can upload them.
// The second one carries no place, which is what the site turns away — the
// checks need one of each.
import { writeFileSync } from 'node:fs'
import { jpegPhoto } from '../src/__tests__/fixtures'

const [out, placeless] = process.argv.slice(2)

async function write(path: string, file: File) {
  writeFileSync(path, Buffer.from(await file.arrayBuffer()))
  console.log(`wrote ${path}`)
}

void (async () => {
  await write(out, jpegPhoto())
  if (placeless) await write(placeless, jpegPhoto({ gps: false }))
})()
