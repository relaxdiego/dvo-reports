/**
 * Reports the city would not take, kept whole on the reporter's own phone.
 *
 * The city's site goes down, sometimes for a day. A reporter who is standing
 * in front of the problem with the photographs already taken should not have
 * to walk back and do it again, so a send that fails offers to keep the
 * report here until the city is answering.
 *
 * This is the one place in the project that keeps a photograph. It is a
 * deliberate exception and it is narrow:
 *
 *   - Nothing is written unless the reporter taps the button. A report that
 *     sends first time never touches this file.
 *   - It is written to their own browser on their own phone, and goes no
 *     further. Nothing here is sent anywhere.
 *   - It is theirs to end: sending the draft removes it, and so does the
 *     delete button on its card.
 *
 * `sitenotice.tsx` says all of that to the reporter, including the two parts
 * that are not flattering — that another person holding the phone can open
 * the draft, and that a phone short of storage may throw it away. If what is
 * kept here changes, change that notice in the same commit.
 *
 * IndexedDB rather than `localStorage`, which is where this started: a photo
 * is a `File`, `localStorage` holds strings only, and base64 adds a third
 * again to a photograph that is already several megabytes. A phone's photos
 * do not fit in the five megabytes a browser usually gives an origin.
 * IndexedDB stores bytes unencoded, and its quota is measured against the
 * disk rather than against a fixed number.
 *
 * A photograph is taken apart on the way in and put back together on the way
 * out: the bytes go in as an `ArrayBuffer`, and the name, the type and the
 * date sit beside them as plain fields. A browser will store a `File` whole,
 * so this is more code than the shortest thing that works — but it says in
 * one place exactly what is kept, and it holds the name, which is the part
 * that travels on to the city with the photograph.
 *
 * The photographs are kept as the camera wrote them, not shrunk. `api.ts`
 * shrinks on the way out, so a draft is several megabytes where it could
 * have been a few hundred kilobytes, and reading one back holds it all in
 * memory for a moment. That is the price of not quietly re-encoding
 * somebody's evidence twice: a report is often a photograph of a plate, a
 * sign, or a house number, and the second pass through a JPEG encoder is
 * detail nobody agreed to lose. When there is no room, `saveReport` says so.
 *
 * Everything here opens the database and closes it again. There is no handle
 * kept between calls: the tab that saved a draft may be discarded by the
 * phone at any moment, and a stale handle is one more thing to be wrong.
 *
 * Nothing in here is on the first page load. `app.tsx` reaches it through a
 * dynamic `import()`, so a reporter who never opens their reports and never
 * has a send fail does not download it.
 */

import { CATEGORIES, type Draft } from './types'

const DB = 'dvo-reports'
const STORE = 'drafts'
const VERSION = 1

/** A whole report waiting on this phone, as it was when the send failed. */
export interface SavedReport {
  /** The browser's own key. Saving the same draft again writes over it. */
  id: number
  /** When it was saved, as an ISO timestamp, so `whenText` can read it. */
  at: string
  category: string
  description: string
  address: string
  lat: number | null
  lon: number | null
  photos: File[]
}

/** A photograph as it is written down: the bytes, and what names them. */
interface KeptPhoto {
  name: string
  type: string
  lastModified: number
  bytes: ArrayBuffer
}

/**
 * Keeps a report, or writes over the one it came from.
 *
 * Unlike the half-written words in `draft.ts`, a failure here has to be
 * shown. The reporter asked for this and is about to close the page
 * believing their photographs are safe, so a browser with storage switched
 * off, or a phone with no room left, has to say so rather than lose the
 * report quietly. Every call can throw and the caller shows the message.
 */
export async function saveReport(d: Draft, id?: number): Promise<number> {
  const record = {
    ...(id === undefined ? {} : { id }),
    at: new Date().toISOString(),
    category: d.category,
    description: d.description,
    address: d.address,
    lat: d.lat,
    lon: d.lon,
    // Read before the transaction opens. IndexedDB closes a transaction the
    // moment it is left idle, and awaiting a file read inside one is the
    // classic way to have it finish out from under the write.
    photos: await Promise.all(d.photos.map(taken)),
  }

  const db = await open()
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).put(record)
      // On the commit, not on the request. The key is known as soon as the
      // request succeeds, but the report is not on the phone until the
      // transaction commits — and the reporter is about to be told that it
      // is. It is also what makes the reports tab, reading through its own
      // connection a moment later, see what was just written.
      tx.oncomplete = () => resolve(req.result as number)
      // A phone with no room left aborts the transaction rather than failing
      // the request, so both endings are listened for.
      tx.onerror = () => reject(failure(tx.error))
      tx.onabort = () => reject(failure(tx.error))
    })
  } finally {
    db.close()
  }
}

/** Every report waiting on this phone, newest first. */
export async function savedReports(): Promise<SavedReport[]> {
  const db = await open()
  try {
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result as unknown[])
      tx.onerror = () => reject(failure(tx.error))
      tx.onabort = () => reject(failure(tx.error))
    })
    return rows
      .filter(isRow)
      .map(restored)
      .sort((a, b) => b.at.localeCompare(a.at))
  } finally {
    db.close()
  }
}

/** Forgets one: the reporter sent it, or threw it away. */
export async function dropReport(id: number): Promise<void> {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(failure(tx.error))
      tx.onabort = () => reject(failure(tx.error))
    })
  } finally {
    db.close()
  }
}

function open(): Promise<IDBDatabase> {
  // Switched off in some browsers, and absent in a private window in others.
  // There is nowhere to put the report, and the reporter has to be told.
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser will not let this site keep anything on your phone.'))
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      // The browser hands out the key. Nothing here has to invent one, and
      // two drafts saved in the same second cannot collide.
      req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(failure(req.error))
    // Another tab of this site is holding the database open at an older
    // version. Rare, and it would otherwise hang here with no message.
    req.onblocked = () => reject(new Error('This site is open in another tab. Close that tab and try again.'))
  })
}

/**
 * A sentence the reporter can act on, in place of the browser's own name for
 * what went wrong. There is only one thing they can do about any of these,
 * and running out of room is the one worth naming, because deleting a photo
 * or an old draft actually fixes it.
 */
function failure(err: DOMException | null): Error {
  if (err?.name === 'QuotaExceededError') {
    return new Error('There is no room left on this phone. Delete some photos, or an old draft, and try again.')
  }
  return new Error('This browser would not keep the report on your phone.')
}

/** A photograph, written down. */
async function taken(f: File): Promise<KeptPhoto> {
  return { name: f.name, type: f.type, lastModified: f.lastModified, bytes: await f.arrayBuffer() }
}

/** The same photograph, handed back as the form and the upload want it. */
function photoOf(p: KeptPhoto): File {
  return new File([p.bytes], p.name, { type: p.type, lastModified: p.lastModified })
}

/** What one row looks like on the way out of the database. */
interface Row extends Omit<SavedReport, 'photos'> {
  photos: KeptPhoto[]
}

/**
 * Whether a row is one of ours. Anything else was written by a version of
 * this site that kept something different, and putting it back into the form
 * would face the reporter with a report that is missing a piece.
 */
function isRow(row: unknown): row is Row {
  const r = row as Partial<Row> | null
  return (
    typeof r?.id === 'number' &&
    typeof r.at === 'string' &&
    typeof r.category === 'string' &&
    typeof r.description === 'string' &&
    typeof r.address === 'string' &&
    Array.isArray(r.photos) &&
    // `instanceof ArrayBuffer` is the obvious check and the wrong one: what
    // comes back out of the database was built somewhere else, so it is an
    // ArrayBuffer that fails an identity test against this page's own. What
    // matters is that there are bytes.
    r.photos.every((p) => typeof p?.name === 'string' && typeof p.bytes?.byteLength === 'number')
  )
}

/**
 * A row as the form takes it.
 *
 * A category this build no longer has is dropped, the way `draft.ts` drops
 * one: a chip that is not there cannot be drawn as pressed, and the reporter
 * would be left unable to see or change what the report was filed under. The
 * words and the photographs are worth more than the chip, so only the chip
 * goes.
 */
function restored(r: Row): SavedReport {
  const known = (CATEGORIES as readonly string[]).includes(r.category)
  return { ...r, category: known ? r.category : '', photos: r.photos.map(photoOf) }
}
