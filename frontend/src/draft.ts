/**
 * The half-written report, kept in this tab so an app switch does not lose
 * it.
 *
 * A reporter leaves the page to get a photograph — to the camera, or to the
 * library. A phone short of memory throws the page away while they are gone
 * and reloads it when they come back, and what they had typed went with it.
 * This keeps the words.
 *
 * Only the words. Writing photographs of a real place into a browser's
 * storage costs more than picking one again does, and picking one again is a
 * few taps, because it is still wherever the reporter got it. This used to
 * rest on something narrower — a photo was let in only if it carried its own
 * place, so it had to have come from the camera app and had to be in the
 * library still. That rule is gone and a photo from anywhere is accepted
 * now; the reason for not keeping them never depended on it. A reporter who
 * needs the photographs themselves to survive has `saved.ts`, which keeps
 * the whole report and only when they ask for it.
 *
 * `sessionStorage`, not `localStorage`: it belongs to this tab, a phone
 * hands it back when it restores the tab it discarded, and it is gone when
 * the reporter closes the tab. A report says where somebody is and what they
 * are looking at, and a phone is lent to people.
 */

import { CATEGORIES } from './types'

const KEY = 'dvo-reports.draft'

/** The part of a draft worth keeping: what the reporter typed. */
export interface SavedDraft {
  category: string
  description: string
}

/** What was being written in this tab, or nothing. */
export function savedDraft(): SavedDraft | null {
  const raw = read()
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as SavedDraft
    // Anything else in there is not ours, or is from a version that wrote
    // something different. Either way it is not worth restoring.
    if (typeof saved?.category !== 'string' || typeof saved?.description !== 'string') return null
    // A chip this build no longer has, saved before it went: restoring it
    // would press nothing and hide every other chip, leaving a reporter no
    // way to choose. The words are still worth keeping, so only the category
    // is dropped.
    const category = (CATEGORIES as readonly string[]).includes(saved.category) ? saved.category : ''
    return { category, description: saved.description }
  } catch {
    return null
  }
}

/** Keeps what has been typed. An empty draft is forgotten rather than kept. */
export function saveDraft(draft: SavedDraft): void {
  if (draft.category === '' && draft.description === '') {
    forgetDraft()
    return
  }
  write(JSON.stringify({ category: draft.category, description: draft.description }))
}

/** Drops it: the report has gone to the city, or the reporter started again. */
export function forgetDraft(): void {
  write(null)
}

// Storage throws in a browser that has it switched off, and in a private
// window in some browsers. Losing a draft is survivable — it is what happens
// today — so nothing here reports a failure.
function read(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

function write(value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, value)
  } catch {
    // Nothing to do: the draft lasts as long as the page does.
  }
}
