import type { Draft } from './types'

export const MAX_PHOTOS = 5
export const MIN_DESCRIPTION = 10

/**
 * The city's own limit: their description box declares `maxlength="1000"`
 * and counts up to the same number beneath it. A description this client
 * accepts is one their form would have accepted, so the city is never left
 * deciding what to do with text it did not ask for.
 */
export const MAX_DESCRIPTION = 1000

/**
 * Counts a description the way the city's form counts one, and the way the
 * backend does: `String.length` is UTF-16 code units, which is exactly what
 * their counter reads. An emoji counts as two. Count with this rather than
 * some other way, so what the reporter watches is what the limit measures.
 */
export function descriptionLength(s: string): number {
  return s.length
}

/**
 * Returns the first reason the draft cannot be sent, or null.
 *
 * The backend runs the same rules and its answer is the one that counts.
 * This copy exists so the reporter learns about a problem before spending
 * time and mobile data uploading photos.
 *
 * A photo is required: a report the city can act on shows the problem. So is
 * a place, and nobody types one. It comes from the photographs when they
 * carry it, and from the reporter's own phone when they do not — see
 * LocationField in app.tsx. Either way it was measured by a device, and the
 * reporter may nudge the pin off it afterwards from the map on the form.
 */
export function validate(d: Draft): string | null {
  if (!d.category) return 'Pick what kind of problem this is.'
  const desc = descriptionLength(d.description.trim())
  if (desc < MIN_DESCRIPTION) return `Describe the problem in at least ${MIN_DESCRIPTION} characters.`
  if (desc > MAX_DESCRIPTION) return `The description is too long (limit ${MAX_DESCRIPTION} characters).`
  if (d.photos.length === 0) return 'Add at least one photo of the problem.'
  if (d.photos.length > MAX_PHOTOS) return `You can attach at most ${MAX_PHOTOS} photos.`
  if (d.lat === null || d.lon === null) return 'Add the location: tap Share your location.'
  return null
}
