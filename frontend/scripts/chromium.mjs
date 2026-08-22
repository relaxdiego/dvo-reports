/**
 * Finds the browser the checks drive.
 *
 * Puppeteer wants the path of a binary, not a name to look up: given a bare
 * "chromium" it reports that no browser was found there, however well the
 * shell could have found one. So the lookup happens here, and both checks
 * use it — one of them resolving the name its own way and the other not is
 * how `make test-browser` came to fail on a machine that had chromium.
 */
import { execFileSync } from 'node:child_process'

export function chromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    try {
      return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim()
    } catch {
      // Not this one.
    }
  }
  throw new Error('no chromium on PATH; install one or set CHROMIUM to its path')
}
