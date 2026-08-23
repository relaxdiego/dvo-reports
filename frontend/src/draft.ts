/**
 * The half-written report, kept in this tab so an app switch does not lose
 * it.
 *
 * A reporter is told to leave for their camera app — the site cannot get a
 * photograph's place any other way. A phone short of memory throws the page
 * away while they are gone and reloads it when they come back, and what they
 * had typed went with it. This keeps the words.
 *
 * Only the words. The photographs are not kept, and do not need to be: a
 * photo is let in only if it carries its own place, which means it was taken
 * in the camera app, which means it is in the reporter's own library still.
 * Picking it again costs two taps. Writing photographs of a real place into
 * a browser's storage costs more than that.
 *
 * `sessionStorage`, not `localStorage`: it belongs to this tab, a phone
 * hands it back when it restores the tab it discarded, and it is gone when
 * the reporter closes the tab. A report says where somebody is and what they
 * are looking at, and a phone is lent to people.
 */

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
    return { category: saved.category, description: saved.description }
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
