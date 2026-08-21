import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitReport, ApiError } from '../api'
import type { Draft } from '../types'

// shrink() needs canvas and createImageBitmap, which jsdom does not have.
// The resizing itself is not what these tests are about.
vi.mock('../image', () => ({ shrink: async (f: File) => f }))

function draft(over: Partial<Draft> = {}): Draft {
  return {
    category: 'pothole',
    description: 'Deep pothole in the outer lane near the corner.',
    address: 'Quimpo Blvd',
    contact: '',
    lat: 7.0731,
    lon: 125.6128,
    photos: [],
    ...over,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('submitReport', () => {
  it('posts every field and returns the receipt', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ reference: 'REF-1' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const photo = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    const receipt = await submitReport(draft({ photos: [photo] }))

    expect(receipt.reference).toBe('REF-1')
    const body = fetchMock.mock.calls[0][1]!.body as FormData
    expect(body.get('category')).toBe('pothole')
    expect(body.get('lat')).toBe('7.0731')
    expect(body.getAll('photos')).toHaveLength(1)
  })

  it('omits coordinates when the reporter did not share them', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ reference: 'REF-2' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await submitReport(draft({ lat: null, lon: null }))

    const body = fetchMock.mock.calls[0][1]!.body as FormData
    expect(body.get('lat')).toBeNull()
  })

  it("surfaces the server's own message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'description is too short' }), { status: 422 })),
    )
    await expect(submitReport(draft())).rejects.toThrow(/too short/)
  })

  it('explains a network failure in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch') }))
    await expect(submitReport(draft())).rejects.toThrow(ApiError)
    await expect(submitReport(draft())).rejects.toThrow(/connection/)
  })
})
