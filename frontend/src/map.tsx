import { useEffect, useRef, useState } from 'preact/hooks'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { currentPosition, roundCoord } from './api'
import './map.css'

/**
 * The map picker. It is loaded with a dynamic import, so Leaflet and its CSS
 * are only fetched by a reporter who actually opens the map. Everyone else
 * downloads the same small page as before.
 */

/** One place on the earth, in the shape the rest of the app uses. */
export interface Spot {
  lat: number
  lon: number
}

/**
 * Where the map opens when the browser will not say where the reporter is.
 * Roughly the middle of Davao City, which is what every report here is about.
 */
const FALLBACK: Spot = { lat: 7.0731, lon: 125.6128 }

/** Close enough to see which side of a street something is on. */
const START_ZOOM = 17

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/** OpenStreetMap asks that this stay on the map. Leaflet draws it in a corner. */
const CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export function MapPicker({
  at,
  onPick,
  onClose,
}: {
  /** Where to open, when the reporter has already set a place. */
  at: Spot | null
  onPick: (spot: Spot) => void
  onClose: () => void
}) {
  const [start, setStart] = useState<Spot | null>(at)
  const [centre, setCentre] = useState<Spot | null>(at)
  const [note, setNote] = useState<string | null>(null)

  // Start at the reporter's own location. The map is not drawn until there is
  // somewhere to draw it: moving it afterwards, under a finger that has
  // already begun dragging, is worse than a short wait.
  useEffect(() => {
    if (at) return
    let dropped = false
    void (async () => {
      try {
        const here = await currentPosition()
        if (!dropped) {
          setStart(here)
          setCentre(here)
        }
      } catch {
        if (dropped) return
        setStart(FALLBACK)
        setCentre(FALLBACK)
        setNote(
          'Your browser did not share your location, so the map starts at the middle of the city. Move it to the right place.',
        )
      }
    })()
    return () => {
      dropped = true
    }
  }, [at])

  // Escape closes it, the way the rest of the browser behaves.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Pick the place on a map">
      <div class="sheetbody">
        <h2>Point at the place</h2>
        {!start && (
          <p class="hint waiting" role="status">
            <span class="spinner" aria-hidden="true" />
            Finding where you are…
          </p>
        )}
        {start && (
          <>
            <div class="mapwrap">
              <Canvas start={start} onMove={setCentre} />
              <span class="mappin" aria-hidden="true" />
            </div>
            <p class="hint">Move the map until the ring sits on the problem. Pinch, or use + and −, to zoom in.</p>
            {note && <p class="hint">{note}</p>}
          </>
        )}
        {centre && (
          <p class="hint" role="status">
            The ring is at {centre.lat}, {centre.lon}.
          </p>
        )}

        <button class="primary" type="button" disabled={!centre} onClick={() => centre && onPick(centre)}>
          Use this place
        </button>
        <button class="secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <p class="hint">
          The map is drawn by <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>. Opening it asks
          their servers for the squares of map around this spot, so it tells them roughly where you are looking.
          Your report itself never goes to them.
        </p>
      </div>
    </div>
  )
}

/**
 * The Leaflet map itself. It is set up once and then left alone: Leaflet owns
 * this element, and re-rendering must not reach inside it.
 */
function Canvas({ start, onMove }: { start: Spot; onMove: (spot: Spot) => void }) {
  const node = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = node.current
    if (!el) return
    const map = L.map(el, { center: [start.lat, start.lon], zoom: START_ZOOM })
    L.tileLayer(TILES, { maxZoom: 19, attribution: CREDIT }).addTo(map)

    // The pin does not move; the map moves under it. On a small screen that
    // beats dragging a marker, which the finger covers up.
    const report = () => {
      const c = map.getCenter()
      onMove({ lat: roundCoord(c.lat), lon: roundCoord(c.lng) })
    }
    map.on('move', report)

    // The sheet animates open, so the element can still be growing when
    // Leaflet measures it. This makes it measure again once it has settled.
    const settled = setTimeout(() => map.invalidateSize(), 150)

    return () => {
      clearTimeout(settled)
      map.off('move', report)
      map.remove()
    }
    // Deliberately once: `start` is where the map opens, not somewhere it
    // follows afterwards.
  }, [])

  return <div class="mapcanvas" ref={node} />
}
