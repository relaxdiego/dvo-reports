/**
 * Asks OpenStreetMap what street a pin sits on, from the reporter's own
 * browser.
 *
 * This is loaded with a dynamic `import()` and never on the first page load.
 * There is nothing to name until a photo is attached, which is the same rule
 * the map follows, and the bundle everybody downloads is budgeted.
 *
 * **The phone asks for itself, and this used to be the backend's job.** That
 * change costs something and it is deliberate: OpenStreetMap now sees the
 * reporter's device and the network it is connected from. It already did —
 * the map drawn directly above this street name is made of OpenStreetMap's
 * own pictures, fetched by the same phone at the same moment — so the street
 * name tells them nothing the map had not already told them. What it buys is
 * a street name that is right: Azure Maps answers a Davao pin with the
 * nearest postal address, which is often on a different lane and carries a
 * house number belonging to somebody else, while OpenStreetMap answers with
 * the road the pin is actually on and the barangay around it.
 *
 * Azure Maps stays behind the backend, because its key must never be shipped
 * to a browser. `lookupPlace` in `api.ts` asks it when there is no road here.
 *
 * Nominatim's usage policy wants a Referer *or* a User-Agent naming the
 * caller. A page cannot set a User-Agent — the browser drops the header
 * without a word — but it sends this site's Referer and Origin on its own,
 * which is the other half of that sentence. The policy also asks that
 * answers be cached and that OpenStreetMap be credited: `api.ts` keeps the
 * answers for as long as the page is open, and Leaflet draws OpenStreetMap's
 * credit in the corner of the map that is on the screen directly above the
 * street name.
 *
 * `sitenotice.tsx` tells the reporter all of this. If what is sent from the
 * phone changes, change it there too.
 */
import type { Place } from './api'

const REVERSE = 'https://nominatim.openstreetmap.org/reverse'

/** The fields of Nominatim's `address` object this reads. Any may be absent. */
interface Address {
  road?: string
  neighbourhood?: string
  quarter?: string
  suburb?: string
  village?: string
  town?: string
  city?: string
  county?: string
  postcode?: string
}

/**
 * Names the street at lat,lon, or null when OpenStreetMap has nothing to say.
 * Throws when the request itself fails; the caller treats that as no answer.
 */
export async function askOpenStreetMap(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<Place | null> {
  const q = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    zoom: '18', // Street level. Any closer names a building.
    addressdetails: '1',
  })
  const res = await fetch(`${REVERSE}?${q}`, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) return null

  const body = (await res.json()) as { display_name?: string; address?: Address }
  const a = body.address ?? {}

  // The same line the backend builds, for the same reason: what a city
  // worker needs to find the spot is the street, the barangay and the city.
  // Nominatim's own display_name adds the region, the country and a
  // postcode, which only make the line harder to read. In Davao the barangay
  // is in quarter rather than suburb, so quarter wins when there is one.
  // Change this and change backend/internal/place, which still answers a
  // developer who has no Azure key.
  const address =
    join(firstOf(a.road, a.neighbourhood), firstOf(a.quarter, a.suburb, a.village), firstOf(a.city, a.town)) ||
    body.display_name ||
    ''
  if (!address) return null

  return { address, in_davao: looksLikeDavao(a), street: Boolean(a.road) }
}

/**
 * Mirrors the test the city's own form makes before it will accept a pin:
 * the locality is Davao, or the postcode is 8000. Theirs is loose, and this
 * is no stricter — it only warns.
 */
function looksLikeDavao(a: Address): boolean {
  if (a.postcode === '8000') return true
  return [a.city, a.town, a.county].some((s) => s?.toLowerCase().includes('davao'))
}

function firstOf(...vals: (string | undefined)[]): string {
  return vals.find((v) => v) ?? ''
}

function join(...vals: string[]): string {
  return vals.filter((v) => v).join(', ')
}
