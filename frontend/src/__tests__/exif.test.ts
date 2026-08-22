import { describe, expect, it } from 'vitest'
import { osmLink, placeOfPhotos, readSnapshot, type Snapshot } from '../exif'
import { jpegPhoto as photo } from './fixtures'

describe('reading a photo', () => {
  it('finds the place a little-endian photo was taken', async () => {
    const s = await readSnapshot(photo())
    // 7 deg 5' 51.12" N, 125 deg 37' 20.25" E
    expect(s?.lat).toBe(7.09753)
    expect(s?.lon).toBe(125.62229)
  })

  // The backend rewrites photos big-endian, so a reporter can meet one.
  it('finds the place in a big-endian photo', async () => {
    const s = await readSnapshot(photo({ big: true }))
    expect(s?.lat).toBe(7.09753)
    expect(s?.lon).toBe(125.62229)
  })

  it('reads the time the camera recorded, with its offset', async () => {
    const s = await readSnapshot(photo({ offset: '+08:00' }))
    expect(s?.taken?.toISOString()).toBe('2025-09-07T01:16:00.000Z')
  })

  it('says nothing about a photo that carries no place', async () => {
    const s = await readSnapshot(photo({ gps: false }))
    expect(s?.lat).toBeNull()
    expect(s?.lon).toBeNull()
    expect(s?.taken).not.toBeNull()
  })

  it('gives up quietly on a file that is not a photo', async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5])], 'notes.txt')
    expect(await readSnapshot(junk)).toBeNull()
  })

  it('gives up quietly on a truncated photo', async () => {
    const whole = new Uint8Array(await photo().arrayBuffer())
    const half = new File([whole.slice(0, Math.floor(whole.length / 2))], 'half.jpg')
    // The point is that it answers at all, rather than throwing.
    await expect(readSnapshot(half)).resolves.toBeDefined()
  })
})

describe('the map link', () => {
  it('points at the place, with a marker on it', () => {
    const url = osmLink(7.09753, 125.62229)
    expect(url).toContain('openstreetmap.org')
    expect(url).toContain('mlat=7.09753')
    expect(url).toContain('mlon=125.62229')
  })
})

describe('where the photos put the pin', () => {
  /** A photo that carries a place, and nothing else worth reading. */
  function at(lat: number, lon: number): Snapshot {
    return { lat, lon, taken: null }
  }

  it('has nowhere to start when no photo carries a place', () => {
    expect(placeOfPhotos([])).toBeNull()
    expect(placeOfPhotos([{ lat: null, lon: null, taken: null }, null])).toBeNull()
  })

  it('uses the one place a single photo carries', () => {
    expect(placeOfPhotos([at(7.09753, 125.62229)])).toEqual({
      lat: 7.09753,
      lon: 125.62229,
      of: 1,
      spread: false,
    })
  })

  // Photos of one pothole are metres apart. Their middle is still the pothole.
  it('takes the middle of photos of the same place', () => {
    const place = placeOfPhotos([at(7.1, 125.6), at(7.1002, 125.6), null])
    expect(place).toEqual({ lat: 7.1001, lon: 125.6, of: 2, spread: false })
  })

  // Photos picked from a gallery can be from anywhere. The middle of two
  // distant places is a street nobody photographed.
  it('falls back to the first photo when the places are far apart', () => {
    const place = placeOfPhotos([at(7.1, 125.6), at(7.2, 125.7)])
    expect(place).toEqual({ lat: 7.1, lon: 125.6, of: 2, spread: true })
  })
})
