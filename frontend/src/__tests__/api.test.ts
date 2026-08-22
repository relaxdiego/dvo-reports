import { afterEach, describe, expect, it, vi } from 'vitest'
import { myReports, reportHistory, sendCode, submitReport, verifyCode, ApiError } from '../api'
import type { Draft } from '../types'

// shrink() needs canvas and createImageBitmap, which jsdom does not have.
// The resizing itself is not what these tests are about.
vi.mock('../image', () => ({ shrink: async (f: File) => f }))

function draft(over: Partial<Draft> = {}): Draft {
  return {
    category: 'pothole',
    description: 'Deep pothole in the outer lane near the corner.',
    address: 'Quimpo Blvd',
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
    expect(body.get('category')).toBe('pothole')
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
