import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { roundCoord } from './api'
import './map.css'

/**
 * The maps. They are loaded with a dynamic import, so Leaflet and its CSS are
 * only fetched by a reporter who has a place to draw. Everyone else downloads
 * the same small page as before.
 *
 * The place on a report starts as the one the photographs carry. Two of these
 * maps only draw it — the one on the form and the one a photo's coordinates
 * open — and the third, the picker, is the only thing in the app that moves
 * it, and only because the reporter opened it to do that.
 */

/** One place on the earth, in the shape the rest of the app uses. */
export interface Spot {
  lat: number
  lon: number
}

/** Close enough to see which side of a street something is on. */
const START_ZOOM = 17

/**
 * Davao City, and far enough out to be read as the city rather than as a
 * place. It is only ever the backdrop to `MapUnknown`, which is drawn when
 * the report has no place yet: a pin on it would be a lie, so there is none.
 */
const DAVAO: Spot = { lat: 7.0707, lon: 125.6087 }
const CITY_ZOOM = 12

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/** OpenStreetMap asks that this stay on the map. Leaflet draws it in a corner. */
const CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/**
 * The picker, opened from the `Adjust` link beside the street name. The pin
 * is held still in the middle of the frame and the map moves under it: on a
 * phone that beats dragging a marker, which the finger covers up.
 *
 * It only ever opens on a place that is already set, so there is nothing to
 * find and nothing to wait for. What it hands back is where the reporter put
 * it, which from then on is the place the report is filed at.
 */
export function MapPicker({
  at,
  onPick,
  onClose,
}: {
  /** Where the pin is now: the photographs' place, or the last one chosen. */
  at: Spot
  onPick: (spot: Spot) => void
  onClose: () => void
}) {
  const [centre, setCentre] = useState<Spot>(at)

  useEscape(onClose)

  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Adjust the place on a map">
      <div class="sheetbody">
        <h2>Adjust location</h2>
        <div class="mapwrap">
          <Canvas start={at} onMove={setCentre} />
          <span class="mappin" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PIN }} />
        </div>
        <p class="hint">Move the map until the pin is on the right spot.</p>
        <button class="primary" type="button" onClick={() => onPick(centre)}>
          Use this location
        </button>
        <button class="secondary wide" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

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
          <Canvas start={at} mark />
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
 * over it. It does not move under the finger: a thumb that lands here is
 * scrolling the form it sits in the middle of, and a map that slid under it
 * would take the pin somewhere nobody chose. Moving the pin is the picker's
 * job, and the picker gets the whole screen.
 *
 * Leaflet sets itself up once per element, so give this a key that changes
 * with the place to have it drawn again somewhere else.
 */
export function MapHere({ at }: { at: Spot }) {
  return (
    <div class="mapwrap inline">
      <Canvas start={at} mark still />
    </div>
  )
}

/**
 * The same box as `MapHere`, in the same place on the form, for a report that
 * has no place yet — because none of the photographs carried one.
 *
 * It shows Davao, drained of its colour and with no pin, and holds whatever
 * is handed to it: the words saying the place is unknown, and the button that
 * asks the phone for one. A grey map with a hole where the answer goes says
 * "something is missing here" without a sentence, and it says it in the box
 * the answer will appear in, which is the point of drawing it at all.
 *
 * It costs a handful of tiles from OpenStreetMap before the reporter has
 * agreed to share anything. Those tiles are of the whole city and say nothing
 * about where the reporter is; `sitenotice.tsx` says they are asked for.
 *
 * Nothing about it moves — same reasoning as `MapHere`, and more so: there is
 * nothing here to look around at.
 */
export function MapUnknown({ children }: { children: ComponentChildren }) {
  return (
    <div class="mapwrap inline unknown">
      <Canvas start={DAVAO} zoom={CITY_ZOOM} still />
      {/*
        Over the map rather than under it, so the eye lands on the question
        and the grey behind it is only the reason the question is being
        asked. It lets taps through to everything it is not itself, which is
        what keeps OpenStreetMap's credit in the corner clickable.
      */}
      <div class="mapask">{children}</div>
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
 * this element, and re-rendering must not reach inside it.
 *
 * With `mark` it plants a pin on the spot; otherwise the pin is the fixed one
 * in the middle of the frame and `onMove` says where the map has been slid
 * to. With `still` nothing moves it at all — see MapHere for why.
 */
function Canvas({
  start,
  zoom = START_ZOOM,
  onMove,
  mark,
  still,
}: {
  start: Spot
  /** How close in it opens. The default is close enough to read a street. */
  zoom?: number
  onMove?: (spot: Spot) => void
  mark?: boolean
  still?: boolean
}) {
  const node = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = node.current
    if (!el) return
    // A map with neither handler switched on keeps Leaflet's touch-action
    // classes off its container, which is what leaves a finger on it
    // scrolling the page. The zoom buttons stay: they are taps, not drags.
    const map = L.map(el, {
      center: [start.lat, start.lon],
      zoom,
      dragging: !still,
      touchZoom: !still,
      scrollWheelZoom: !still,
      doubleClickZoom: !still,
      keyboard: !still,
    })
    L.tileLayer(TILES, { maxZoom: 19, attribution: CREDIT }).addTo(map)

    if (mark) {
      // Leaflet's own pin is an image file, and image files do not survive a
      // bundler without being pointed at by hand. This is the same shape
      // drawn inline, anchored on its point rather than its middle, and
      // coloured from map.css so the colour lives in one place.
      L.marker([start.lat, start.lon], {
        icon: L.divIcon({ html: PIN, className: 'mappin-drop', iconSize: [26, 35], iconAnchor: [13, 35] }),
        interactive: false,
        keyboard: false,
      }).addTo(map)
    }

    // The pin does not move; the map moves under it. On a small screen that
    // beats dragging a marker, which the finger covers up.
    const report = () => {
      const c = map.getCenter()
      onMove?.({ lat: roundCoord(c.lat), lon: roundCoord(c.lng) })
    }
    if (onMove) map.on('move', report)

    // The sheet animates open, so the element can still be growing when
    // Leaflet measures it. This makes it measure again once it has settled.
    const settled = setTimeout(() => map.invalidateSize(), 150)

    return () => {
      clearTimeout(settled)
      if (onMove) map.off('move', report)
      map.remove()
    }
    // Deliberately once: `start` is where the map opens, not somewhere it
    // follows afterwards.
  }, [])

  return <div class="mapcanvas" ref={node} />
}
