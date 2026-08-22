import type { Draft, Filed, History, Receipt } from './types'
import type { Session } from './session'
import { shrink } from './image'

/**
 * Where the backend lives. Empty in development, where Vite proxies /api to
 * the local Go server. Set VITE_API_BASE for the deployed frontend, which is
 * served from a different origin than the backend.
 */
const API_BASE: string = import.meta.env.VITE_API_BASE ?? ''

/** The header the backend reads the city's session token from. */
const SESSION_HEADER = 'X-City-Session'

export class ApiError extends Error {
  /**
   * True when the city no longer accepts the session. The caller asks for a
   * new code and tries the same thing again.
   */
  readonly expired: boolean

  constructor(message: string, expired = false) {
    super(message)
    this.expired = expired
  }
}

/** Asks the city to send a one-time code to this address. */
export async function sendCode(email: string, signal?: AbortSignal): Promise<void> {
  const res = await post('/api/auth/otp', { email }, signal)
  if (!res.ok) throw new ApiError(await errorMessage(res))
}

/** Exchanges the code for a session with the city. */
export async function verifyCode(email: string, code: string, signal?: AbortSignal): Promise<Session> {
  const res = await post('/api/auth/session', { email, otp: code }, signal)
  if (!res.ok) throw new ApiError(await errorMessage(res))
  return (await res.json()) as Session
}

/** Sends the report. Photos are shrunk first. Resolves with the receipt. */
export async function submitReport(d: Draft, token: string, signal?: AbortSignal): Promise<Receipt> {
  const body = new FormData()
  body.set('category', d.category)
  body.set('description', d.description.trim())
  body.set('address', d.address.trim())
  if (d.lat !== null && d.lon !== null) {
    body.set('lat', String(d.lat))
    body.set('lon', String(d.lon))
  }
  for (const photo of await Promise.all(d.photos.map(shrink))) {
    body.append('photos', photo, photo.name)
  }

  const res = await send(`${API_BASE}/api/reports`, { method: 'POST', body, headers: { [SESSION_HEADER]: token }, signal })
  if (!res.ok) throw await apiError(res)
  return (await res.json()) as Receipt
}

/** Lists the reports this reporter has already filed. */
export async function myReports(token: string, signal?: AbortSignal): Promise<Filed[]> {
  const res = await send(`${API_BASE}/api/reports`, { headers: { [SESSION_HEADER]: token }, signal })
  if (!res.ok) throw await apiError(res)
  const body = (await res.json()) as { reports: Filed[] | null }
  return body.reports ?? []
}

/** Reads what became of one filed report. */
export async function reportHistory(reference: string, token: string, signal?: AbortSignal): Promise<History> {
  const url = `${API_BASE}/api/reports/${encodeURIComponent(reference)}`
  const res = await send(url, { headers: { [SESSION_HEADER]: token }, signal })
  if (!res.ok) throw await apiError(res)
  return (await res.json()) as History
}

function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return send(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.')
  }
}

/** A 401 means the city's session died, and the caller can recover from it. */
async function apiError(res: Response): Promise<ApiError> {
  return new ApiError(await errorMessage(res), res.status === 401)
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // fall through to the generic message
  }
  return `The server refused the request (${res.status}).`
}

/**
 * ~1 m of precision, and no more of the reporter's location than that. A
 * photograph's own coordinates are rounded the same way, so a place carries
 * it was chosen.
 */
export function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

/** What the street under a pin turns out to be. */
export interface Place {
  address: string
  in_davao: boolean
}

/**
 * Answers already given, for as long as the page is open. OpenStreetMap asks
 * that results be cached, and a reporter taking a photo out and putting it
 * back would otherwise ask the same question twice.
 */
const named = new Map<string, Place>()

/**
 * Names the street under a pin, through this project's own backend rather
 * than from the browser: OpenStreetMap wants a User-Agent saying who is
 * calling, which a page cannot set, and this way a citizen's location is
 * never sent to a third party from their own device.
 *
 * Returns null when there is no answer. That is not an error worth showing:
 * the report goes to the city with its coordinates, which is what happened
 * before any of this existed.
 */
export async function lookupPlace(lat: number, lon: number, signal?: AbortSignal): Promise<Place | null> {
  const key = `${lat},${lon}`
  const seen = named.get(key)
  if (seen) return seen
  try {
    const res = await fetch(`${API_BASE}/api/place?lat=${lat}&lon=${lon}`, { signal })
    if (!res.ok) return null
    const found = (await res.json()) as Place
    named.set(key, found)
    return found
  } catch {
    return null
  }
}
