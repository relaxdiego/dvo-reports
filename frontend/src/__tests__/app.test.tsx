import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { App } from '../app'
import { jpegPhoto } from './fixtures'

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

  // The picker is opened by a label, so it needs no script and keeps working
  // with the input itself out of sight.
  it("opens the picker from a label, not the browser's own control", () => {
    act(() => render(<App />, root))

    const button = root.querySelector<HTMLLabelElement>('.filebutton')!
    expect(button.htmlFor).toBe('photos')
    expect(button.textContent).toBe('Add photos')
    // Hidden, not removed: a keyboard still reaches the control.
    expect(root.querySelector('#photos')?.className).toBe('filepicker')
  })

  /** Puts files on the picker the way a phone would. */
  async function attach(...files: File[]) {
    // jsdom has no object URLs, and the thumbnails ask for one. Only the two
    // methods are added: replacing URL itself would swap the constructor for
    // a plain object, and the dynamic import of the map needs it to work.
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:x', configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
    act(() => render(<App />, root))
    const input = root.querySelector<HTMLInputElement>('#photos')!
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    for (let i = 0; i < 20; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 2)) })
      if (root.querySelectorAll('.photorow').length === files.length) break
    }
  }

  // A reporter is sending a photograph of a real place to a government site.
  // What it carries is theirs to see first.
  it('gives each photo a row showing where and when it was taken', async () => {
    await attach(jpegPhoto({ offset: '+08:00' }), jpegPhoto({ gps: false }))

    const rows = root.querySelectorAll('.photorow')
    expect(rows).toHaveLength(2)

    const link = rows[0].querySelector('a')
    expect(link?.textContent).toBe('7.09753, 125.62229')
    expect(link?.getAttribute('href')).toContain('openstreetmap.org')
    expect(link?.getAttribute('href')).toContain('mlat=7.09753')
    expect(link?.getAttribute('target')).toBe('_blank')
    // The time sits under the coordinates, in the same row.
    expect(rows[0].textContent).toContain('2025')

    // A photo with no place says so rather than showing nothing.
    expect(rows[1].querySelector('a')).toBeNull()
    expect(rows[1].textContent).toContain('No place recorded')
  })

  // Opening a new tab loses a half-written report, so a plain tap shows the
  // place over the form instead.
  it('opens the place over the form when the coordinates are tapped', async () => {
    await attach(jpegPhoto())

    const deadline = Date.now() + 4000
    const link = root.querySelector<HTMLAnchorElement>('.photorow a')!
    act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })) })
    for (let i = 0; i < 400; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
      if (root.querySelector('.leaflet-container')) break
      if (Date.now() > deadline) throw new Error(`no map; the page says: ${root.textContent}`)
    }

    const sheet = root.querySelector('[role="dialog"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.querySelector('.leaflet-container')).not.toBeNull()
    expect(sheet?.textContent).toContain('7.09753, 125.62229')
    // The form is still underneath, not replaced.
    expect(root.querySelector('#description')).not.toBeNull()

    click('Close')
    await settle()
    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })

  // It is still a link. Someone who asks for a new tab gets one.
  it('leaves a ctrl-click to the browser', async () => {
    await attach(jpegPhoto())

    const link = root.querySelector<HTMLAnchorElement>('.photorow a')!
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('href')).toContain('openstreetmap.org')

    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
    act(() => { link.dispatchEvent(e) })
    await settle()

    expect(e.defaultPrevented).toBe(false)
    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })

  it('takes a photo out of the list when its row is removed', async () => {
    await attach(jpegPhoto(), jpegPhoto())
    expect(root.querySelectorAll('.photorow')).toHaveLength(2)

    const remove = root.querySelector<HTMLButtonElement>('.photorow .remove')!
    act(() => remove.click())
    await settle()

    expect(root.querySelectorAll('.photorow')).toHaveLength(1)
  })

  it('offers more photos once there are some', async () => {
    await attach(jpegPhoto())
    expect(root.querySelector('.filebutton')?.textContent).toBe('Add more photos')
  })

  // The photo already knows where the problem is. Asking the reporter for the
  // same thing again is work they do not need to do.
  it('starts the place from the photos, and lets it go with them', async () => {
    await attach(jpegPhoto())
    await settle()

    // The form is ordered so the photos come first and put the pin down.
    const form = root.querySelector('form')!.textContent!
    expect(form).toContain('Using the place your photo was taken (7.09753, 125.62229)')
    expect(form.indexOf('Photos')).toBeLessThan(form.indexOf('Where is it?'))

    // The pin is really down, not only described: the map button offers to
    // move it rather than to place one.
    expect(form).toContain('Move the pin on a map')

    const remove = root.querySelector<HTMLButtonElement>('.photorow .remove')!
    act(() => remove.click())
    await settle()

    const after = root.querySelector('form')!.textContent!
    expect(after).not.toContain('Using the place')
    expect(after).toContain('Pick it on a map')
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

  /**
   * Waits for something the dynamic import has to arrive before. Loading
   * Leaflet is real work competing with the other test files, so this waits
   * on a deadline rather than a tick count, which used to fail under load.
   */
  async function waitFor(what: string, selector: string) {
    const until = Date.now() + 4000
    while (Date.now() < until) {
      await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
      if (root.querySelector(selector)) return
    }
    throw new Error(`${what} never appeared; the page says: ${root.textContent}`)
  }

  const opened = () => waitFor('the map', '.leaflet-container')

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
    await waitFor('the map sheet', '[role="dialog"]')

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

// The city has no page for its terms, so a reporter who never visits the
// city's own site would otherwise never see what they are agreeing to.
describe("the city's terms", () => {
  function open(phrase: string) {
    act(() => render(<App />, root))
    const link = [...root.querySelectorAll<HTMLButtonElement>('header .linky')].find(
      (b) => b.textContent?.trim() === phrase,
    )
    if (!link) throw new Error(`no preamble link reading "${phrase}"`)
    act(() => link.click())
  }

  const openCity = () => open("the city's disclaimer and privacy terms")

  it("opens the city's words over the page", () => {
    openCity()

    const sheet = root.querySelector('[role="dialog"]')
    expect(sheet).not.toBeNull()
    // "the site's", where the city writes "our": on this page "our" would
    // read as this project, which wrote none of it.
    expect(sheet?.textContent).toContain(
      "By using Davao City Reports App, you hereby consent to the site's Privacy Policy",
    )
    expect(sheet?.textContent).not.toContain('consent to our Privacy Policy')
    expect(sheet?.textContent).toContain('Disclaimer Acceptance:')
  })

  // A copy is only as good as the day it was taken, and the city can change
  // its terms without telling anyone.
  it('says when the copy was taken, and whose words they are', () => {
    openCity()

    const sheet = root.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('as of 22 August 2026')
    expect(sheet.textContent).toContain("The following are the city's words")
    expect(sheet.querySelector('a')?.getAttribute('href')).toBe('https://reports.davaocity.gov.ph')
  })

  it('closes again and leaves the form behind it', () => {
    openCity()
    click('Close')

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.querySelector('#description')).not.toBeNull()
  })
})

// This site's own terms. Separate from the city's on purpose: a reporter
// should be able to tell whose promise is whose.
describe("this site's own notice", () => {
  function openSite() {
    act(() => render(<App />, root))
    const link = [...root.querySelectorAll<HTMLButtonElement>('header .linky')].find(
      (b) => b.textContent?.trim() === 'how this site handles your report',
    )!
    act(() => link.click())
  }

  it('says the plain things: nothing kept, nothing promised', () => {
    openSite()

    const sheet = root.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('What this site is')
    expect(sheet.textContent).toContain('There is no database')
    expect(sheet.textContent).toContain('you use it at your own risk')
    expect(sheet.textContent).toContain('not run by the city government')
  })

  // The notice and backend/internal/photo have to say the same thing. If
  // the filter starts keeping something again, this is the sentence that
  // becomes a lie.
  it('says a photo carries on only its place and time', () => {
    openSite()

    const sheet = root.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('Only the place and the time a photo carries go on')
    expect(sheet.textContent).toContain('the identifiers it puts on each photograph — is removed')
  })

  // Two notices, never both at once, and each closes on its own.
  it("stands apart from the city's notice", () => {
    openSite()
    expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(root.querySelector('[role="dialog"]')?.textContent).not.toContain(
      'Disclaimer Acceptance:',
    )

    click('Close')
    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })
})
