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
 */
export function validate(d: Draft): string | null {
  if (!d.category) return 'Pick what kind of problem this is.'
  const desc = d.description.trim()
  if (desc.length < MIN_DESCRIPTION) return `Describe the problem in at least ${MIN_DESCRIPTION} characters.`
  if (desc.length > MAX_DESCRIPTION) return `The description is too long (limit ${MAX_DESCRIPTION} characters).`
  if (!d.address.trim() && d.lat === null) return 'Add an address, or share your location.'
  if (d.photos.length > MAX_PHOTOS) return `You can attach at most ${MAX_PHOTOS} photos.`
  return null
}
