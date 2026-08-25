/**
 * The reporter's own list of filed reports, kept on their phone so it opens
 * at once instead of after the city has answered.
 *
 * The city's list call has no paging. `getuserdetails` answers with every
 * report an account has ever filed, in one reply, so the reporter this site
 * is built for — the one who reports things, month after month — waits longer
 * every month, and waits again on every visit for a list that has barely
 * changed. Keeping it here turns that into one wait, and then none.
 *
 * **Nothing is written unless the reporter turns it on.** It is off until
 * they tap, the same rule `saved.ts` keeps, and for the same reason: what is
 * kept here is not small. Each report brings the words they wrote, the place
 * it was filed at, and links to their photographs on the city's site. That is
 * a citizen's report sitting in a browser, on a phone that `sitenotice.tsx`
 * already warns is lent to people. Turning it off deletes all of it, and that
 * is `stopKeeping`.
 *
 * So there are four things on a reporter's phone now, and they are
 * deliberately four different sizes:
 *
 *   - `draft.ts` — what is being typed, this tab only, no photographs.
 *   - `saved.ts` — whole reports the city refused, photographs included. The
 *     only place in the project that holds a photograph.
 *   - this file — reports the city has already taken, without the
 *     photographs themselves: only the city's links to them.
 *
 * The links are worth being exact about. They are addresses on the city's
 * site, not the pictures, so the pictures still need a live session to draw,
 * and a reporter reading a kept list offline gets the words and no images.
 * Keeping the bytes instead would be the whole photo library of somebody who
 * reports things often, and this file will not do that.
 *
 * A database of its own rather than a second store inside `saved.ts`'s. Both
 * would then have to agree on a version number, and a browser refuses to open
 * one database at two versions — the tab that lost that race would get an
 * error where a draft should have been. Two names cost nothing.
 *
 * Not on the first page load: `app.tsx` reaches this through a dynamic
 * `import()`, so a reporter who never opens their reports never downloads it,
 * and this site never opens the database on their phone.
 */

import type { Filed } from './types'

const DB = 'dvo-reports-list'
const STORE = 'list'
const VERSION = 1
const ROW = 1
const FLAG = 'dvo-reports.keeplist'

/**
 * How old the kept list may be before this site asks the city for a new one.
 *
 * A day, because that is the rhythm the thing being watched actually moves
 * at: a report goes from RECEIVED to ONGOING when an office picks it up, and
 * offices work in days. Asking more often spends a reporter's mobile data on
 * a reply that has not changed — the city has no paging and no "changed
 * since", so every refresh is the whole list again.
 *
 * A stale list is still shown at once. The refresh happens behind it, and
 * only what comes back replaces it, so a city that is down leaves the
 * reporter reading yesterday's list rather than an error.
 */
export const STALE_AFTER = 24 * 60 * 60 * 1000

/** What is on the phone, and when the city said it. */
export interface KeptList {
  reports: Filed[]
  at: number
}

/**
 * Whether the reporter has turned this on.
 *
 * Read from `localStorage` and not from the database, because the tab has to
 * draw the right control before an `open()` could have resolved, and a
 * control that says "keep" and flips to "stop keeping" a moment later has
 * told the reporter the state of their own phone wrongly, on the one screen
 * that is about what it holds.
 */
export function keepingList(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}

/** Turns it on. Nothing is written until a list is handed to `keepList`. */
export function startKeeping(): void {
  try {
    localStorage.setItem(FLAG, '1')
  } catch {
    // Storage off. `keepingList` will keep saying no, which is the honest
    // answer: nothing could have been kept anyway.
  }
}

/**
 * Turns it off and deletes what was kept.
 *
 * The flag goes first. If the delete then fails there is no way back to the
 * data through this module, which is the safer of the two ways to be wrong.
 */
export async function stopKeeping(): Promise<void> {
  try {
    localStorage.removeItem(FLAG)
  } catch {
    // Nothing to do.
  }
  await forgetList()
}

/** The list this phone is holding, or nothing. */
export async function keptList(): Promise<KeptList | null> {
  const db = await open()
  try {
    const row = await request<unknown>(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(ROW),
    )
    return isKept(row) ? { reports: row.reports, at: row.at } : null
  } finally {
    db.close()
  }
}

/**
 * Writes down the list the city just gave. It replaces whatever was there:
 * this is a copy of the city's answer, not a history of them.
 */
export async function keepList(reports: Filed[], at: number): Promise<void> {
  const db = await open()
  try {
    await request(
      db.transaction(STORE, 'readwrite').objectStore(STORE).put({ id: ROW, reports, at }),
    )
  } finally {
    db.close()
  }
}

/**
 * Says the list on this phone is old, without throwing it away.
 *
 * A report the reporter has just filed is not in it, and the copy is a day
 * fresh, so nothing would go and ask the city until tomorrow — the reporter
 * would open their reports and not find the one they had just sent.
 *
 * Marked rather than deleted, so the next visit still draws the list at once
 * and the refresh happens behind it. The reports already in it are not
 * wrong; the list is only short of one.
 *
 * Quiet when there is nothing to mark. The reporter has just sent a report
 * and is reading the reference number; nothing here is worth a word to them,
 * and the cost of failing is that the list is a day late, which is what it
 * was before this existed.
 */
export async function listIsOld(): Promise<void> {
  try {
    const kept = await keptList()
    if (kept) await keepList(kept.reports, 0)
  } catch {
    // No database, or no room to write it back.
  }
}

/** Deletes it. */
export async function forgetList(): Promise<void> {
  try {
    const db = await open()
    try {
      await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(ROW))
    } finally {
      db.close()
    }
  } catch {
    // No database to clear, or a browser that will not open one. Either way
    // there is nothing on this phone to worry about.
  }
}

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser will not let this site keep anything on your phone.'))
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(failure(req.error))
    req.onblocked = () => reject(new Error('This site is open in another tab. Close that tab and try again.'))
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(failure(req.error))
  })
}

/**
 * A sentence the reporter can act on. Running out of room is the one worth
 * naming, because deleting a photo or an old draft actually fixes it — and
 * it is the likely one here, since this list grows with every report they
 * ever file.
 */
function failure(err: DOMException | null): Error {
  if (err?.name === 'QuotaExceededError') {
    return new Error('There is no room left on this phone. Delete some photos, or an old draft, and try again.')
  }
  return new Error('This browser would not keep your reports on your phone.')
}

/**
 * Whether a row is one of ours. Anything else was written by a version of
 * this site that kept something different, and drawing it as a list of
 * reports would put somebody else's shape on the screen.
 */
function isKept(row: unknown): row is { reports: Filed[]; at: number } {
  if (typeof row !== 'object' || row === null) return false
  const r = row as { reports?: unknown; at?: unknown }
  return (
    typeof r.at === 'number' &&
    Array.isArray(r.reports) &&
    r.reports.every((x) => typeof (x as Filed)?.reference === 'string')
  )
}
