import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupPlace, myReports, reportHistory, sendCode, submitReport, verifyCode, ApiError } from '../api'
import type { Draft } from '../types'

// shrink() needs canvas and createImageBitmap, which jsdom does not have.
// The resizing itself is not what these tests are about.
vi.mock('../image', () => ({ shrink: async (f: File) => f }))

function draft(over: Partial<Draft> = {}): Draft {
  return {
    category: 'obstruction',
    description: 'Deep pothole in the outer lane near the corner.',
    address: 'Quimpo Boulevard, Talomo, Davao City',
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
    const receipt = await submitReport(draft({ photos: [photo] }), 'tk-1')

    expect(receipt.reference).toBe('REF-1')
    const body = fetchMock.mock.calls[0][1]!.body as FormData
    expect(body.get('category')).toBe('obstruction')
    expect(body.get('lat')).toBe('7.0731')
    expect(body.getAll('photos')).toHaveLength(1)
    // The city's session token rides in a header, not in the form.
    const headers = fetchMock.mock.calls[0][1]!.headers as Record<string, string>
    expect(headers['X-City-Session']).toBe('tk-1')
    expect(body.get('contact')).toBeNull()
  })

  it('omits coordinates when the reporter did not share them', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ reference: 'REF-2' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await submitReport(draft({ lat: null, lon: null }), 'tk-1')

    const body = fetchMock.mock.calls[0][1]!.body as FormData
    expect(body.get('lat')).toBeNull()
  })

  it("surfaces the server's own message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'description is too short' }), { status: 422 })),
    )
    await expect(submitReport(draft(), 'tk-1')).rejects.toThrow(/too short/)
  })

  it('explains a network failure in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch') }))
    await expect(submitReport(draft(), 'tk-1')).rejects.toThrow(ApiError)
    await expect(submitReport(draft(), 'tk-1')).rejects.toThrow(/connection/)
  })
})

describe('a dead session', () => {
  it('is marked so the caller can ask for a new code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'your session has expired' }), { status: 401 })),
    )
    await expect(submitReport(draft(), 'tk-old')).rejects.toMatchObject({ expired: true })
    await expect(myReports('tk-old')).rejects.toMatchObject({ expired: true })
  })

  it('is not confused with any other refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'no' }), { status: 422 })),
    )
    await expect(submitReport(draft(), 'tk-1')).rejects.toMatchObject({ expired: false })
  })
})

describe('the sign-in calls', () => {
  it('asks the backend to send a code', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendCode('someone@example.com')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/auth/otp')
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'someone@example.com' })
  })

  it('exchanges the code for a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ token: 'tk-1', expires: '2026-05-01T08:05:00Z' }), { status: 200 })),
    )

    const session = await verifyCode('someone@example.com', '123456')

    expect(session.token).toBe('tk-1')
  })
})

describe('reading past reports', () => {
  it('returns an empty list when the city has none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ reports: null }), { status: 200 })))

    expect(await myReports('tk-1')).toEqual([])
  })

  it('asks for one report by its reference', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ reference: 'DCR 2026/1', steps: [] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await reportHistory('DCR 2026/1', 'tk-1')

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/reports/DCR%202026%2F1')
  })
})

describe('naming the street under a pin', () => {
  // lookupPlace caches by coordinates for as long as the module is loaded,
  // so each test below asks about a pin no earlier test has asked about.

  function osmReply(address: Record<string, string>): Response {
    return new Response(JSON.stringify({ address }), { status: 200 })
  }

  function azureReply(place: { address: string; in_davao?: boolean } | null): Response {
    return new Response(JSON.stringify(place ?? { address: '', in_davao: false }), { status: 200 })
  }

  it('never asks the backend once OpenStreetMap names a road', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('nominatim')) {
        return osmReply({ road: 'Quimpo Boulevard', city: 'Davao City', postcode: '8000' })
      }
      throw new Error('the backend should not have been asked')
    })
    vi.stubGlobal('fetch', fetchMock)

    const place = await lookupPlace(7.001, 125.001)

    expect(place?.address).toBe('Quimpo Boulevard, Davao City')
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/place'))).toBe(false)
  })

  it("asks the backend when OpenStreetMap has no road, and uses its answer", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('nominatim')) return osmReply({ city: 'Davao City', postcode: '8000' })
      return azureReply({ address: 'Quimpo Boulevard, Talomo, Davao City', in_davao: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const place = await lookupPlace(7.002, 125.002)

    expect(place?.address).toBe('Quimpo Boulevard, Talomo, Davao City')
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/place'))).toBe(true)
  })

  it('keeps the coarse OpenStreetMap answer when the backend has nothing', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('nominatim')) return osmReply({ city: 'Davao City', postcode: '8000' })
      return azureReply(null)
    })
    vi.stubGlobal('fetch', fetchMock)

    const place = await lookupPlace(7.003, 125.003)

    expect(place?.address).toBe('Davao City')
    expect(place?.street).toBe(false)
  })

  it('falls back to the backend when OpenStreetMap fails outright', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('nominatim')) throw new TypeError('failed to fetch')
      return azureReply({ address: 'Quimpo Boulevard, Talomo, Davao City', in_davao: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const place = await lookupPlace(7.004, 125.004)

    expect(place?.address).toBe('Quimpo Boulevard, Talomo, Davao City')
  })

  it('gives up when neither has an answer', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('nominatim')) throw new TypeError('failed to fetch')
      return azureReply(null)
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await lookupPlace(7.005, 125.005)).toBeNull()
  })

  it('does not ask twice about the same pin', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('nominatim')) return osmReply({ road: 'Quimpo Boulevard', city: 'Davao City' })
      throw new Error('the backend should not have been asked')
    })
    vi.stubGlobal('fetch', fetchMock)

    await lookupPlace(7.006, 125.006)
    const callsAfterFirst = fetchMock.mock.calls.length
    await lookupPlace(7.006, 125.006)

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })
})
