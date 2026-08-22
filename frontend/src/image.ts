/**
 * Shrinking photos in the browser before upload.
 *
 * A phone camera file is 3-8 MB. The city site does not need that: a report
 * is read on a screen. Resizing here is the difference between a report that
 * sends in a second and one that stalls on a mobile connection, and it is
 * why this client feels faster than the original site.
 */

/** Longest edge of an uploaded photo, in pixels. */
export const MAX_EDGE = 1600

/** JPEG quality for the re-encoded photo. */
export const QUALITY = 0.82

/**
 * Returns a smaller JPEG version of `file`. If the browser cannot decode the
 * image, the original file is returned unchanged and the backend decides.
 */
export async function shrink(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.type === 'image/jpeg') return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    if (!blob || blob.size >= file.size) return file
    const carried = await carryMetadata(file, blob)
    return new File([carried], renameToJpeg(file.name), { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}

function renameToJpeg(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg'
}

/**
 * Copies the original's metadata block onto the resized photo.
 *
 * Drawing to a canvas keeps the pixels and nothing else, so a resized photo
 * would otherwise reach the backend with no date and no place. This moves the
 * block across as bytes, unread: what is worth keeping is decided in one
 * place, `backend/internal/photo`, and it is not here. Whatever survives that
 * filter is what the city receives.
 *
 * The tags describing the old pixels — the size and the orientation — travel
 * with it and are wrong for the new image. The backend drops both.
 */
async function carryMetadata(original: File, resized: Blob): Promise<Blob> {
  const from = await original.arrayBuffer()
  const exif = exifRange(new Uint8Array(from))
  if (!exif) return resized
  const to = await resized.arrayBuffer()
  const at = afterLeadingSegment(new Uint8Array(to))
  return new Blob([to.slice(0, at), from.slice(exif[0], exif[1]), to.slice(at)], {
    type: 'image/jpeg',
  })
}

/** Start and end of the Exif application segment, marker and length included. */
function exifRange(d: Uint8Array): [number, number] | null {
  for (let i = 2; i + 4 <= d.length && d[i] === 0xff; ) {
    const marker = d[i + 1]
    // Nothing past the start of the image data can be a metadata segment.
    if (marker === 0xda || marker === 0xd9) return null
    const length = (d[i + 2] << 8) | d[i + 3]
    if (length < 2 || i + 2 + length > d.length) return null
    const isExif =
      marker === 0xe1 &&
      d[i + 4] === 0x45 && d[i + 5] === 0x78 && d[i + 6] === 0x69 && d[i + 7] === 0x66
    if (isExif) return [i, i + 2 + length]
    i += 2 + length
  }
  return null
}

/**
 * Where to put the block: after a JFIF header if the encoder wrote one, and
 * straight after the start of the image if it did not. Both are ordinary
 * places for it, and readers accept either.
 */
function afterLeadingSegment(d: Uint8Array): number {
  if (d.length > 4 && d[2] === 0xff && d[3] === 0xe0) {
    return 4 + ((d[4] << 8) | d[5])
  }
  return 2
}
