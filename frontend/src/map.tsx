import { useEffect, useRef } from 'preact/hooks'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './map.css'

/**
 * The maps. They are loaded with a dynamic import, so Leaflet and its CSS are
 * only fetched by a reporter who has a place to draw. Everyone else downloads
 * the same small page as before.
 *
 * Neither map chooses anything. The place on a report is the one the
 * photographs carry, so there is nothing here to drag: these draw where that
 * is, on the form and over it.
 */

/** One place on the earth, in the shape the rest of the app uses. */
export interface Spot {
  lat: number
  lon: number
}

/** Close enough to see which side of a street something is on. */
const START_ZOOM = 17

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/** OpenStreetMap asks that this stay on the map. Leaflet draws it in a corner. */
const CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/**
 * A place on the map, opened over the form. This is what a reporter gets when
 * they tap the coordinates on one of their photos: the report they are
 * part-way through writing is still there when they close it.
 */
export function MapView({
  at,
  caption,
  onClose,
}: {
  at: Spot
  /** What this place is, in the reporter's terms. */
  caption?: string
  onClose: () => void
}) {
  useEscape(onClose)

  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Where this photo was taken">
      <div class="sheetbody">
        <h2>Where this photo was taken</h2>
        <div class="mapwrap">
          <Canvas start={at} />
        </div>
        {caption && <p class="hint">{caption}</p>}
        <button class="primary" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

/**
 * The place the report will be filed under, drawn on the page rather than
 * over it. It does not move under the finger, and nothing here moves it: the
 * photographs decided it.
 *
 * Leaflet sets itself up once per element, so give this a key that changes
 * with the place to have it drawn again somewhere else.
 */
export function MapHere({ at }: { at: Spot }) {
  return (
    <div class="mapwrap inline">
      <Canvas start={at} />
    </div>
  )
}

/** Escape closes a sheet, the way the rest of the browser behaves. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
}

/**
 * The pin dropped on a place that is settled. A balloon with a point and a
 * darker circle in its head, which is what Google Maps drops and therefore
 * what a reporter already reads without being told. `currentColor` hands the
 * body colour to map.css; the circle carries its own, because it only means
 * anything against the body.
 */
const PIN = `
  <svg width="26" height="35" viewBox="0 0 26 35" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="currentColor" d="M13 34C13 34 24.5 18.6 24.5 11.6A11.5 11.5 0 1 0 1.5 11.6C1.5 18.6 13 34 13 34Z"/>
    <circle cx="13" cy="11.6" r="4.2" fill="#a52714"/>
  </svg>`

/**
 * The Leaflet map itself. It is set up once and then left alone: Leaflet owns
 * this element, and re-rendering must not reach inside it. It draws a pin on
 * the spot it is given and answers nothing back.
 */
function Canvas({ start }: { start: Spot }) {
  const node = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = node.current
    if (!el) return
    const map = L.map(el, { center: [start.lat, start.lon], zoom: START_ZOOM })
    L.tileLayer(TILES, { maxZoom: 19, attribution: CREDIT }).addTo(map)

    // Leaflet's own pin is an image file, and image files do not survive a
    // bundler without being pointed at by hand. This is the same shape drawn
    // inline, anchored on its point rather than its middle, and coloured from
    // map.css so the colour lives in one place.
    L.marker([start.lat, start.lon], {
      icon: L.divIcon({ html: PIN, className: 'mappin-drop', iconSize: [26, 35], iconAnchor: [13, 35] }),
      interactive: false,
      keyboard: false,
    }).addTo(map)

    // The sheet animates open, so the element can still be growing when
    // Leaflet measures it. This makes it measure again once it has settled.
    const settled = setTimeout(() => map.invalidateSize(), 150)

    return () => {
      clearTimeout(settled)
      map.remove()
    }
    // Deliberately once: `start` is where the map opens, not somewhere it
    // follows afterwards.
  }, [])

  return <div class="mapcanvas" ref={node} />
}
