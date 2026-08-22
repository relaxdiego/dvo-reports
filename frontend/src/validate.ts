import type { Draft } from './types'

export const MAX_PHOTOS = 5
export const MIN_DESCRIPTION = 10
export const MAX_DESCRIPTION = 2000

/**
 * Returns the first reason the draft cannot be sent, or null.
 *
 * The backend runs the same rules and its answer is the one that counts.
 * This copy exists so the reporter learns about a problem before spending
 * time and mobile data uploading photos.
 *
 * A photo is required: a report the city can act on shows the problem. Its
 * place is not required to come from the photo, though — a camera that does
 * not record where it was is common, and a reporter can move the pin
 * themselves. What is required is that a place ends up set.
 */
export function validate(d: Draft): string | null {
  if (!d.category) return 'Pick what kind of problem this is.'
  const desc = d.description.trim()
  if (desc.length < MIN_DESCRIPTION) return `Describe the problem in at least ${MIN_DESCRIPTION} characters.`
  if (desc.length > MAX_DESCRIPTION) return `The description is too long (limit ${MAX_DESCRIPTION} characters).`
  if (d.photos.length === 0) return 'Add at least one photo of the problem.'
  if (d.photos.length > MAX_PHOTOS) return `You can attach at most ${MAX_PHOTOS} photos.`
  if (d.lat === null || d.lon === null) return 'Set the place on the map.'
  return null
}
