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
    return new File([blob], renameToJpeg(file.name), { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}

function renameToJpeg(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg'
}
