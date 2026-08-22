/**
 * Fixtures shared by the tests.
 *
 * Nothing here is a test; vitest only collects *.test.ts.
 */

/**
 * A JPEG built by hand, so the reader is tested against bytes it did not
 * write. Both byte orders are covered: phones write little-endian, and the
 * backend's filter rewrites photos big-endian on the way through, so the
 * browser meets both.
 */
export function jpegPhoto(
  opts: { big?: boolean; gps?: boolean; date?: boolean; offset?: string; at?: { lat: number; lon: number } } = {},
) {
  const big = opts.big ?? false
  const parts: number[] = []
  const u16 = (v: number) => (big ? [v >> 8, v & 255] : [v & 255, v >> 8])
  const u32 = (v: number) =>
    big
      ? [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
      : [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]
  const rational = (n: number, d: number) => [...u32(n), ...u32(d)]

  const tiff: number[] = []
  const push = (...xs: number[]) => tiff.push(...xs)

  // Header, then the main directory at offset 8.
  push(...(big ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(8))

  const entries: { tag: number; type: number; count: number; inline?: number[]; data?: number[] }[] = []
  if (opts.date ?? true) {
    entries.push({ tag: 0x0132, type: 2, count: 20, data: [...'2025:09:07 09:16:00'].map((c) => c.charCodeAt(0)).concat(0) })
  }
  entries.push({ tag: 0x8769, type: 4, count: 1, inline: [] }) // Exif pointer
  if (opts.gps ?? true) entries.push({ tag: 0x8825, type: 4, count: 1, inline: [] })

  const exifEntries: typeof entries = [
    { tag: 0x9003, type: 2, count: 20, data: [...'2025:09:07 09:16:00'].map((c) => c.charCodeAt(0)).concat(0) },
  ]
  if (opts.offset) {
    exifEntries.push({ tag: 0x9011, type: 2, count: 7, data: [...opts.offset].map((c) => c.charCodeAt(0)).concat(0) })
  }

  // Degrees, minutes and seconds, the way a camera writes a coordinate.
  // Seconds carry two decimal places, which is finer than the app keeps.
  const dms = (v: number) => {
    const d = Math.floor(v)
    const m = Math.floor((v - d) * 60)
    const s = Math.round(((v - d) * 60 - m) * 6000)
    return [...rational(d, 1), ...rational(m, 1), ...rational(s, 100)]
  }
  const at = opts.at ?? { lat: 7.09753, lon: 125.62229 }

  const gpsEntries: typeof entries = [
    { tag: 0x0001, type: 2, count: 2, inline: ['N'.charCodeAt(0), 0] },
    { tag: 0x0002, type: 5, count: 3, data: dms(at.lat) },
    { tag: 0x0003, type: 2, count: 2, inline: ['E'.charCodeAt(0), 0] },
    { tag: 0x0004, type: 5, count: 3, data: dms(at.lon) },
  ]

  const dirSize = (n: number) => 2 + 12 * n + 4
  const ifd0At = 8
  const exifAt = ifd0At + dirSize(entries.length)
  const gpsAt = exifAt + dirSize(exifEntries.length)
  const dataAt = gpsAt + ((opts.gps ?? true) ? dirSize(gpsEntries.length) : 0)

  entries.find((e) => e.tag === 0x8769)!.inline = u32(exifAt)
  const gpsPointer = entries.find((e) => e.tag === 0x8825)
  if (gpsPointer) gpsPointer.inline = u32(gpsAt)

  const data: number[] = []
  const writeDir = (list: typeof entries) => {
    push(...u16(list.length))
    for (const e of list) {
      push(...u16(e.tag), ...u16(e.type), ...u32(e.count))
      if (e.data) {
        push(...u32(dataAt + data.length))
        data.push(...e.data)
        if (data.length % 2) data.push(0)
      } else {
        const v = [...(e.inline ?? [])]
        while (v.length < 4) v.push(0)
        push(...v)
      }
    }
    push(...u32(0))
  }
  writeDir(entries)
  writeDir(exifEntries)
  if (opts.gps ?? true) writeDir(gpsEntries)
  push(...data)

  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff] // "Exif\0\0"
  parts.push(0xff, 0xd8)
  parts.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body)
  parts.push(0xff, 0xda, 0, 8, 1, 1, 0, 0, 0, 0)
  parts.push(0xff, 0xd9)
  return new File([new Uint8Array(parts)], 'photo.jpg', { type: 'image/jpeg' })
}

