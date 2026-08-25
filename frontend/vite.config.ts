import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import preact from '@preact/preset-vite'

// Where the blueprint tiles ride along in the build. The deploy job knows
// this name too; it is the one thing the two have to agree on.
const BLUEPRINT_DIR = 'blueprint'

// Stamped onto the page so a bug report can say which build it came from.
// There is no other way to tell: the site stores nothing and the bundle's
// content hash is not visible to whoever is looking at the page.
const buildTime = new Date().toISOString().slice(0, 19) + 'Z'

// Short, because it is read off a phone screen and still names one commit.
// A build from a tarball or a shallow archive has no git to ask, and a
// missing stamp must not fail the build — the site is the point, not this.
let buildSha = 'unknown'
try {
  buildSha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim()
} catch {
  // Left as 'unknown'.
}

/**
 * Carries the blueprint home screen tile into the build, without using it.
 *
 * Staging and production are the same site to look at, and a maintainer with
 * both added to one phone has two identical icons and no way to tell which
 * one files a real report. The blueprint says "this is the drawing, not the
 * building" without a word on it.
 *
 * One build is published to both, so which tile a copy gets is no longer a
 * build-time question: the deploy job lays these over the top for staging and
 * deletes them for production. They land in a directory of their own rather
 * than in public/, which every build copies to the root — a file at the root
 * is a file Cloudflare would serve, and the real tile has to stay the one
 * that is there by default.
 *
 * Only a build. `npm run dev` serves public/ straight from disk and shows
 * the production tile; nobody adds a dev server to their home screen.
 */
function blueprintTiles(): Plugin {
  const from = fileURLToPath(new URL('brand/staging', import.meta.url))
  let outDir = 'dist'
  return {
    name: 'blueprint-tiles',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    // After writeBundle, so the directory survives Vite writing the build.
    closeBundle() {
      const to = join(outDir, BLUEPRINT_DIR)
      mkdirSync(to, { recursive: true })
      for (const name of readdirSync(from)) {
        copyFileSync(join(from, name), join(to, name))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact(), blueprintTiles()],
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  server: {
    // In development the Go backend runs on 8080, so /api is same-origin
    // here and CORS never enters the picture.
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    // Stated rather than inherited, because the size of what a citizen
    // downloads on mobile data is the point of this project and must not
    // depend on a default staying what it is. `true` rather than a named
    // minifier on purpose: Vite picks the best one it has, and naming
    // 'esbuild' here measured 0.32 kB larger gzipped than the default.
    // `cssMinify` follows this setting.
    minify: true,

    // The reporter is on a phone, often on a slow connection. Keep an eye on
    // the bundle: this warns well below Vite's 500 kB default.
    //
    // The number is above Leaflet's own size on purpose. Leaflet is the map
    // picker's chunk and nothing else imports it, so it is only fetched by a
    // reporter who opens the map; the first page load does not pay for it.
    // What this guards is the chunk everybody downloads.
    chunkSizeWarningLimit: 200,
  },
  test: {
    environment: 'jsdom',
  },
})
