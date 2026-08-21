import type { Draft, Receipt } from './types'
import { shrink } from './image'

/**
 * Where the backend lives. Empty in development, where Vite proxies /api to
 * the local Go server. Set VITE_API_BASE for the deployed frontend, which is
 * served from a different origin than the backend.
 */
const API_BASE: string = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {}

/** Sends the report. Photos are shrunk first. Resolves with the receipt. */
export async function submitReport(d: Draft, signal?: AbortSignal): Promise<Receipt> {
  const body = new FormData()
  body.set('category', d.category)
  body.set('description', d.description.trim())
  body.set('address', d.address.trim())
  body.set('contact', d.contact.trim())
  if (d.lat !== null && d.lon !== null) {
    body.set('lat', String(d.lat))
    body.set('lon', String(d.lon))
  }
  for (const photo of await Promise.all(d.photos.map(shrink))) {
    body.append('photos', photo, photo.name)
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/reports`, { method: 'POST', body, signal })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.')
  }
  if (!res.ok) {
    throw new ApiError(await errorMessage(res))
  }
  return (await res.json()) as Receipt
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // fall through to the generic message
  }
  return `The server refused the report (${res.status}).`
}

/** Reads the browser's location. Rejects with a message fit to show. */
export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share a location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: round(p.coords.latitude), lon: round(p.coords.longitude) }),
      () => reject(new Error('Could not get your location. Type the address instead.')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

/** ~1 m of precision, and no more of the reporter's location than that. */
function round(n: number): number {
  return Math.round(n * 1e5) / 1e5
}
