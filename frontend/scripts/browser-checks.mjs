/**
 * Runs the browser checks against a preview server of their own.
 *
 * Three things here exist because several agent sessions now run this target
 * at once, in different worktrees on one machine:
 *
 *   - The port is asked for as 0, so the OS hands out a free one and the
 *     checks are told which. A fixed port meant the second session's server
 *     quietly moved to the next number while its checks still drove the
 *     first session's — passing or failing for reasons that had nothing to
 *     do with the change under test.
 *   - The fixture and the screenshots go in a directory of this run's own.
 *     Shared names in /tmp meant the shots you read after a failure could be
 *     another session's.
 *   - The server is started in a process group of its own and the whole
 *     group is killed on the way out, however this exits. `kill %1` in the
 *     recipe this replaces signalled the npx wrapper, not the node server
 *     under it, so every run left one behind. A leaked server holds the
 *     inherited stdout open, and `make test-browser | ...` then waits for an
 *     end-of-file that never comes — the work is long done but the terminal
 *     looks hung.
 *
 *   node scripts/browser-checks.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const shots = mkdtempSync(join(tmpdir(), 'dvo-browser-'))
const photo = join(shots, 'photo.jpg')

// Piped, not inherited: whatever happens to the server, it never holds this
// process's stdout, so nothing reading our output can be left waiting on it.
const server = spawn('npx', ['vite', 'preview', '--port', '0'], {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stopped = false
function stop() {
  if (stopped) return
  stopped = true
  try {
    process.kill(-server.pid, 'SIGTERM') // the group: npx, and the node under it
  } catch {
    // Already gone.
  }
}
process.on('exit', stop)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop()
    process.exit(130)
  })
}

/** Waits for the line vite prints once it is listening, and reads the port off it. */
function serving() {
  return new Promise((resolve, reject) => {
    let said = ''
    const timer = setTimeout(() => {
      reject(new Error(`the preview server never said it was listening. It said:\n${said}`))
    }, 30000)
    const watch = (chunk) => {
      said += chunk
      process.stderr.write(chunk)
      const found = said.match(/http:\/\/localhost:(\d+)/)
      if (found) {
        clearTimeout(timer)
        resolve(`http://localhost:${found[1]}/`)
      }
    }
    server.stdout.on('data', watch)
    server.stderr.on('data', watch)
    server.on('error', reject)
    server.on('exit', (code) => reject(new Error(`the preview server exited (${code}). It said:\n${said}`)))
  })
}

/** Runs one check and answers whether it passed. */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code === 0))
  })
}

let ok = false
try {
  const url = await serving()
  if (!(await run('npx', ['vite-node', 'scripts/make-fixture.ts', photo]))) {
    throw new Error('could not write the fixture photo')
  }
  ok =
    (await run('node', ['scripts/check-place-sheet.mjs', url, photo, shots])) &&
    (await run('node', ['scripts/check-disclaimer.mjs', url, shots]))
} finally {
  stop()
  console.log(`\nscreenshots in ${shots}`)
}

process.exit(ok ? 0 : 1)
