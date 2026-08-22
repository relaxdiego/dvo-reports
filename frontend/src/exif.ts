/**
 * Reading the date and place out of a photo, to show the reporter.
 *
 * This only reads. What a photo is allowed to carry to the city is decided
 * in one place, `backend/internal/photo`, and it is not here. If the two ever
 * disagree, this one is wrong: it is a preview, not a rule.
 */

import { roundCoord } from './api'

/** What a photo says about itself. Any field may be missing. */
export interface Snapshot {
  lat: number | null
  lon: number | null
  /** The camera's own clock, with its offset applied when it gave one. */
  taken: Date | null
}

/**
 * How much of the file to read. The metadata block sits near the front, and a
 * camera photo is several megabytes: reading it whole, five times over, is
 * work a phone does not need to do.
 */
const SCAN_BYTES = 256 * 1024

const TYPE_WIDTH: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825

export async function readSnapshot(file: File): Promise<Snapshot | null> {
  let buf: ArrayBuffer
  try {
    buf = await file.slice(0, SCAN_BYTES).arrayBuffer()
  } catch {
    return null
  }
  const d = new DataView(buf)
  const tiff = findExif(d)
  if (tiff === null) return null
  try {
    return readTiff(d, tiff)
  } catch {
    // A malformed photo is not worth an error on screen. It still uploads.
    return null
  }
}

/** Offset of the TIFF block inside an Exif segment, or null. */
function findExif(d: DataView): number | null {
  if (d.byteLength < 4 || d.getUint16(0) !== 0xffd8) return null
  let i = 2
  while (i + 4 <= d.byteLength && d.getUint8(i) === 0xff) {
    const marker = d.getUint8(i + 1)
    if (marker === 0xda || marker === 0xd9) return null
    const length = d.getUint16(i + 2)
    if (length < 2 || i + 2 + length > d.byteLength) return null
    if (marker === 0xe1 && d.getUint32(i + 4) === 0x45786966) return i + 10
    i += 2 + length
  }
  return null
}

function readTiff(d: DataView, base: number): Snapshot | null {
  const order = d.getUint16(base)
  if (order !== 0x4d4d && order !== 0x4949) return null
  const big = order === 0x4d4d
  const u16 = (at: number) => d.getUint16(at, !big)
  const u32 = (at: number) => d.getUint32(at, !big)
  if (u16(base + 2) !== 42) return null

  const dir = (off: number): Map<number, number> => {
    const out = new Map<number, number>()
    if (off === 0 || base + off + 2 > d.byteLength) return out
    const n = u16(base + off)
    if (base + off + 2 + n * 12 > d.byteLength) return out
    for (let i = 0; i < n; i++) out.set(u16(base + off + 2 + i * 12), base + off + 2 + i * 12)
    return out
  }

  /** The bytes of one record's value, wherever the file chose to put them. */
  const valueAt = (rec: number): { at: number; type: number; count: number } | null => {
    const type = u16(rec + 2)
    const count = u32(rec + 4)
    const width = TYPE_WIDTH[type]
    if (!width) return null
    const size = width * count
    const at = size > 4 ? base + u32(rec + 8) : rec + 8
    if (at + size > d.byteLength) return null
    return { at, type, count }
  }

  const text = (rec: number | undefined): string | null => {
    if (rec === undefined) return null
    const v = valueAt(rec)
    if (!v || v.type !== 2) return null
    let s = ''
    for (let i = 0; i < v.count; i++) {
      const c = d.getUint8(v.at + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s || null
  }

  /** Degrees, minutes, seconds, as three rationals. */
  const degrees = (rec: number | undefined): number | null => {
    if (rec === undefined) return null
    const v = valueAt(rec)
    if (!v || v.type !== 5 || v.count < 3) return null
    let out = 0
    for (let i = 0; i < 3; i++) {
      const num = u32(v.at + i * 8)
      const den = u32(v.at + i * 8 + 4)
      if (den === 0) return null
      out += num / den / 60 ** i
    }
    return out
  }

  const ifd0 = dir(u32(base + 4))
  const exif = ifd0.has(TAG_EXIF_IFD) ? dir(u32(ifd0.get(TAG_EXIF_IFD)! + 8)) : new Map()
  const gps = ifd0.has(TAG_GPS_IFD) ? dir(u32(ifd0.get(TAG_GPS_IFD)! + 8)) : new Map()

  let lat = degrees(gps.get(0x0002))
  let lon = degrees(gps.get(0x0004))
  if (lat !== null && text(gps.get(0x0001)) === 'S') lat = -lat
  if (lon !== null && text(gps.get(0x0003)) === 'W') lon = -lon

  const stamp = text(exif.get(0x9003)) ?? text(ifd0.get(0x0132))
  const offset = text(exif.get(0x9011)) ?? text(exif.get(0x9010))

  return {
    lat: lat === null ? null : roundCoord(lat),
    lon: lon === null ? null : roundCoord(lon),
    taken: stamp ? parseStamp(stamp, offset) : null,
  }
}

/**
 * A camera writes "2025:09:07 09:16:00" — colons where a browser wants
 * dashes, and no time zone unless a separate tag carries one. Without that
 * tag the time is read as this phone's, which is the closest thing to right.
 */
function parseStamp(stamp: string, offset: string | null): Date | null {
  const m = stamp.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset ?? ''}`
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t)
}

/** Where to look at a place, on a map anyone can open. */
export function osmLink(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`
}

/** One place on the earth, the way the rest of the app writes one. */
interface Spot {
  lat: number
  lon: number
}

/** Where the attached photos say the problem is, and how that was decided. */
export interface Place extends Spot {
  /** How many of the photos carried a place. */
  of: number
  /**
   * True when those places were too far apart to be one problem, so the
   * first photo's place was used instead of the middle of them.
   */
  spread: boolean
}

/**
 * Near enough that two photos are of the same problem. Past this, the middle
 * of them is somewhere nobody stood: a reporter who attaches photos from two
 * different days would get a pin on a street between them.
 */
const SAME_PLACE_METRES = 100

/**
 * Where to start the pin, read from the photos. Null when none of them
 * carries a place. This is a starting point, not an answer — the reporter
 * can move it, and once they do, the photos stop deciding.
 */
export function placeOfPhotos(snaps: readonly (Snapshot | null)[]): Place | null {
  const spots = snaps.flatMap((s) =>
    s && s.lat !== null && s.lon !== null ? [{ lat: s.lat, lon: s.lon }] : [],
  )
  if (spots.length === 0) return null

  const middle = {
    lat: spots.reduce((t, s) => t + s.lat, 0) / spots.length,
    lon: spots.reduce((t, s) => t + s.lon, 0) / spots.length,
  }
  const spread = spots.some((s) => metresApart(s, middle) > SAME_PLACE_METRES)
  const at = spread ? spots[0] : middle
  return { lat: roundCoord(at.lat), lon: roundCoord(at.lon), of: spots.length, spread }
}

/**
 * How far apart two places are, in metres, treating the earth as flat. Over
 * the few hundred metres this is ever asked about, that is exact enough.
 */
function metresApart(a: Spot, b: Spot): number {
  const rad = Math.PI / 180
  const y = (b.lat - a.lat) * rad
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  return Math.hypot(x, y) * 6_371_000
}
