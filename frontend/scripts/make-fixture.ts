// Writes the test fixture photo to a file, so a real browser can upload it.
import { writeFileSync } from 'node:fs'
import { jpegPhoto } from '../src/__tests__/fixtures'

const out = process.argv[2]
const file = jpegPhoto()
void file.arrayBuffer().then((b) => {
  writeFileSync(out, Buffer.from(b))
  console.log(`wrote ${out}`)
})
