import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { App } from '../app'

/** Lets the fetch, the state updates it causes, and the re-render settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

// shrink() needs canvas, which jsdom does not have. Nothing here uploads.
vi.mock('../image', () => ({ shrink: async (f: File) => f }))

let root: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  render(null, root)
  root.remove()
  vi.unstubAllGlobals()
})

function listOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    reference: `DCR-${i + 1}`,
    title: `Report number ${i + 1}`,
    description: 'x',
    location: 'y',
    status: 'ONGOING',
    filed: `2026-05-01 08:00:0${i % 10}`,
  }))
}

function click(text: string) {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!button) throw new Error(`no button reading "${text}"`)
  act(() => button.click())
}

describe('the two tabs', () => {
  it('opens on the form', () => {
    act(() => render(<App />, root))

    expect(root.querySelector('#description')).not.toBeNull()
    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })

  // Past reports live with the city, so reading them needs a code first.
  it('asks for a code when the past reports are opened without a session', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
    // Nothing was asked of the backend until the reporter has a session.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('goes straight to the list when a session is already live', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          reports: [
            { reference: 'DCR-1', title: 'Pothole: outer lane', description: 'x', location: 'y', status: 'ONGOING', filed: '2026-05-01 08:00:00' },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.textContent).toContain('Pothole: outer lane')
    // The city's timestamp layout is not one the browser reads on its own.
    expect(root.textContent).not.toContain('Invalid Date')
    expect(root.textContent).toContain('2026')
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'X-City-Session': 'tk-1' })
  })

  // The city's session dies while the reporter is still reading. One 401 is
  // not a failure to show them; it is a request for another code.
  it('asks for a new code when the city refuses the stored session', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-old' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'expired' }), { status: 401 })),
    )

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
    expect(localStorage.getItem('dvo-reports.session')).toBeNull()
  })
})

describe('reloading the list', () => {
  beforeEach(() => localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' })))

  function stubList(n: number) {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ reports: listOf(n) }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  // Leaving the tab and coming back is not a request to ask the city again.
  it('does not ask the city again when the tabs are switched', async () => {
    const fetchMock = stubList(1)

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    click('Report a problem')
    click('My reports')
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(root.textContent).toContain('Report number 1')
  })

  it('asks again when the refresh button is used', async () => {
    const fetchMock = stubList(1)

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    const refresh = root.querySelectorAll('button[aria-label="Refresh"]')
    // One above the list and one below it.
    expect(refresh).toHaveLength(2)
    act(() => (refresh[0] as HTMLButtonElement).click())
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // The city sends every report in one reply, so this only bounds how many
  // rows are drawn at once.
  it('draws the first page of a long list', async () => {
    stubList(25)

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(root.querySelectorAll('li.report')).toHaveLength(20)
    expect(root.textContent).toContain('25 reports')
  })

  it('says what it is waiting for while it waits', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    const status = root.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Loading past reports')
    expect(status?.textContent).toContain('Asking the city')
  })
})

describe('opening one report', () => {
  // A line of text alone reads as a page that has stopped working. The list
  // already turns a spinner while it waits; so does this.
  it('turns a spinner while the city is asked what happened', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        // The list answers; the history never does, so the wait stays on screen.
        if (String(input).endsWith('/api/reports')) {
          return new Response(JSON.stringify({ reports: listOf(1) }), { status: 200 })
        }
        return new Promise<Response>(() => {})
      }),
    )

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    const waiting = root.querySelector('.reportbody [role="status"]')
    expect(waiting?.textContent).toContain('Reading what happened')
    expect(waiting?.querySelector('.spinner')).not.toBeNull()
  })
})

describe('the photo field', () => {
  // `capture` would send a phone straight to the camera and hide the photos
  // the reporter already has.
  it('lets the reporter pick photos already on the phone', () => {
    act(() => render(<App />, root))

    const input = root.querySelector<HTMLInputElement>('#photos')
    expect(input).not.toBeNull()
    expect(input?.hasAttribute('capture')).toBe(false)
    expect(input?.multiple).toBe(true)
    expect(input?.accept).toBe('image/*')
  })
})

describe('picking the place on a map', () => {
  /**
   * A browser that hands over a location, or refuses to. Only `geolocation`
   * is replaced: Leaflet reads the rest of `navigator` as it loads, so a
   * stand-in object would break the map before it started.
   */
  function geolocation(coords: { latitude: number; longitude: number } | null) {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) =>
          coords ? ok({ coords } as GeolocationPosition) : fail({} as GeolocationPositionError),
      },
    })
  }

  afterEach(() => {
    // @ts-expect-error jsdom has no geolocation of its own to put back.
    delete navigator.geolocation
  })

  /** The map arrives by dynamic import, so it needs longer than one tick. */
  async function opened() {
    for (let i = 0; i < 40; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 1)) })
      if (root.querySelector('.leaflet-container')) return
    }
    throw new Error(`the map never appeared; the page says: ${root.textContent}`)
  }

  // Leaflet is tens of kilobytes. A reporter who types an address never pays
  // for it, so nothing may load it until the button is used.
  it('does not open a map until it is asked for', () => {
    act(() => render(<App />, root))

    expect(root.querySelector('.leaflet-container')).toBeNull()
    expect(root.textContent).toContain('Pick it on a map')
  })

  it('opens the map where the reporter is', async () => {
    geolocation({ latitude: 7.06423, longitude: 125.60778 })

    act(() => render(<App />, root))
    click('Pick it on a map')
    await opened()

    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
    expect(root.textContent).toContain('The ring is at 7.06423, 125.60778')
  })

  it('starts at the middle of the city when the browser refuses', async () => {
    geolocation(null)

    act(() => render(<App />, root))
    click('Pick it on a map')
    await opened()

    expect(root.textContent).toContain('the map starts at the middle of the city')
    expect(root.textContent).toContain('The ring is at 7.0731, 125.6128')
  })

  it('sends the place the reporter picked', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    geolocation({ latitude: 7.06423, longitude: 125.60778 })
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ reference: 'DCR-9' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    act(() => render(<App />, root))
    click('Pick it on a map')
    await opened()
    click('Use this place')
    await settle()

    // The map closes, and the form says where the report will go.
    expect(root.querySelector('.leaflet-container')).toBeNull()
    expect(root.textContent).toContain('the place you picked on the map (7.06423, 125.60778)')

    click('Pothole')
    const description = root.querySelector<HTMLTextAreaElement>('#description')!
    description.value = 'A deep pothole in the outer lane.'
    act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await settle()

    const body = fetchMock.mock.calls[0][1]?.body as FormData
    expect(body.get('lat')).toBe('7.06423')
    expect(body.get('lon')).toBe('125.60778')
    // No address was typed, and the map alone is enough to file.
    expect(body.get('address')).toBe('')
  })

  it('turns a spinner while it looks for the reporter', async () => {
    // A browser that is asked and never answers, which is what a phone
    // waiting on a permission prompt looks like.
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: () => {} },
    })

    act(() => render(<App />, root))
    click('Pick it on a map')
    for (let i = 0; i < 40; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 1)) })
      if (root.querySelector('[role="dialog"]')) break
    }

    const waiting = root.querySelector('[role="dialog"] [role="status"]')
    expect(waiting?.textContent).toContain('Finding where you are')
    expect(waiting?.querySelector('.spinner')).not.toBeNull()
    // Nothing to confirm yet, so the button that would file a place is off.
    const use = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Use this place')
    expect(use?.disabled).toBe(true)
  })

  it('closes without changing the report when it is cancelled', async () => {
    geolocation({ latitude: 7.06423, longitude: 125.60778 })

    act(() => render(<App />, root))
    click('Pick it on a map')
    await opened()
    click('Cancel')
    await settle()

    expect(root.querySelector('.leaflet-container')).toBeNull()
    expect(root.textContent).not.toContain('the place you picked on the map')
  })
})
