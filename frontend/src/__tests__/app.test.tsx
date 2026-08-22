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

/**
 * Puts files on the picker the way a phone would, and waits for the rows.
 * A photo is now the first thing a report needs, so most of these tests
 * start by attaching one.
 */
async function attachPhotos(...files: File[]) {
  // jsdom has no object URLs, and the thumbnails ask for one. Only the two
  // methods are added: replacing URL itself would swap the constructor for
  // a plain object, and the dynamic import of the map needs it to work.
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:x', configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
  if (!root.querySelector('#photos')) act(() => render(<App />, root))
  const input = root.querySelector<HTMLInputElement>('#photos')!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  for (let i = 0; i < 20; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 2)) })
    if (root.querySelectorAll('.photorow').length === files.length) break
  }
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

describe('choosing what the problem is', () => {
  function chips() {
    return [...root.querySelectorAll('.chip')].map((c) => c.textContent?.trim())
  }

  it('offers every kind until one is chosen, then only that one', () => {
    act(() => render(<App />, root))

    expect(chips()).toContain('Garbage')
    expect(chips()).toContain('Stray animal')
    expect(root.querySelector('.chips')!.className).toBe('chips')

    click('Garbage')

    // The rest are hidden by CSS, which jsdom cannot see. What it can see is
    // the class that hides them, and that only one chip is pressed.
    expect(root.querySelector('.chips')!.className).toBe('chips picked')
    const pressed = root.querySelectorAll('[aria-pressed="true"]')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].textContent).toContain('Garbage')
  })

  it('lets a reporter who picked the wrong one press it again to go back', () => {
    act(() => render(<App />, root))

    click('Garbage')
    // The cross is decoration; the chip itself is the way back.
    const chosen = root.querySelector<HTMLButtonElement>('.chip.on')!
    expect(chosen.querySelector('.x')!.getAttribute('aria-hidden')).toBe('true')

    act(() => chosen.click())

    expect(root.querySelector('.chips')!.className).toBe('chips')
    expect(root.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
    expect(chips()).toContain('Pothole')
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
  const attach = attachPhotos

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

  // The way to add another sits under what is already attached, so a reporter
  // adding a third photo does not have to look back past the first two.
  it('keeps the button under the photos it adds to', async () => {
    await attach(jpegPhoto())

    const list = root.querySelector('.photolist')!
    const button = root.querySelector('.filebutton')!
    expect(list.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // The photo already knows where the problem is. Asking the reporter for the
  // same thing again is work they do not need to do.
  it('starts the place from the photos, and lets it go with them', async () => {
    await attach(jpegPhoto())
    await settle()

    // The form is ordered so the photos come first and put the pin down.
    const form = root.querySelector('form')!.textContent!
    expect(form.indexOf('Photos')).toBeLessThan(form.indexOf('Location'))

    // The pin is really down, not only described: the button offers to move
    // it rather than to place one.
    expect(form).toContain('Adjust location')

    const remove = root.querySelector<HTMLButtonElement>('.photorow .remove')!
    act(() => remove.click())
    await settle()

    // With the photo gone there is nothing to file and nowhere to file it,
    // so the whole location section goes with it.
    const after = root.querySelector('form')!.textContent!
    expect(after).not.toContain('Adjust location')
    expect(after).not.toContain('Set the location')
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

  // Leaflet is tens of kilobytes. A reporter who has attached nothing has
  // nowhere to put a pin, so nothing may load it yet.
  it('does not fetch the map until a photo gives it somewhere to start', () => {
    act(() => render(<App />, root))

    expect(root.querySelector('.leaflet-container')).toBeNull()
    expect(root.textContent).not.toContain('Location')
    expect(root.textContent).not.toContain('Adjust location')
  })

  // The point of the whole rearrangement: a geotagged photo means the
  // reporter never has to say where they are.
  it('draws the place on the form as soon as a photo carries one', async () => {
    await attachPhotos(jpegPhoto())
    await waitFor('the map on the form', '.leaflet-container')

    // On the form, not over it.
    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.querySelector('.mapwrap.inline .leaflet-container')).not.toBeNull()
    expect(root.textContent).toContain('Adjust location')

    // The way to move the pin sits under the map showing where it is.
    const drawn = root.querySelector('.mapwrap.inline')!
    const adjust = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Adjust location')!
    expect(drawn.compareDocumentPosition(adjust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the picker on the pin the photo already put down', async () => {
    await attachPhotos(jpegPhoto())
    await waitFor('the map on the form', '.leaflet-container')
    click('Adjust location')
    await waitFor('the picker', '[role="dialog"]')

    // The photo's own place, not the browser's idea of where the phone is.
    expect(root.textContent).toContain('The ring is at 7.09753, 125.62229')
  })

  // A camera with its location switched off is common, and that reporter is
  // not turned away.
  it('lets a reporter whose photo has no place set one by hand', async () => {
    geolocation({ latitude: 7.06423, longitude: 125.60778 })
    await attachPhotos(jpegPhoto({ gps: false }))
    await settle()

    expect(root.textContent).toContain('None of your photos recorded where it was taken')
    expect(root.querySelector('.leaflet-container')).toBeNull()

    click('Set the location')
    await opened()
    click('Use this place')
    await waitFor('the map on the form', '.mapwrap.inline .leaflet-container')

    expect(root.textContent).toContain('Adjust location')
    click('Adjust location')
    await waitFor('the picker', '[role="dialog"]')
    expect(root.textContent).toContain('The ring is at 7.06423, 125.60778')
  })

  // The city's form fills its location box from the pin. So does this one,
  // and it shows the answer, because it is what a city worker will read.
  it('names the street under the pin and sends that as the location', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ address: 'Quimpo Boulevard, Talomo, Davao City', in_davao: true }),
        { status: 200 },
      ),
    ))

    await attachPhotos(jpegPhoto())
    await settle()

    expect(root.querySelector('.street')?.textContent).toContain('Quimpo Boulevard, Talomo, Davao City')
    expect(root.textContent).not.toContain('outside Davao City')
  })

  // Their own site turns these away. Better to say so here than to have the
  // report vanish after it is sent.
  // Each of these pins somewhere of its own: answers are remembered for as
  // long as the page is open, so two tests sharing a spot would share a
  // street as well.
  it('warns when the pin is outside the city', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ address: 'Session Road, Baguio', in_davao: false }), { status: 200 }),
    ))
    geolocation({ latitude: 16.4116, longitude: 120.5933 })

    await attachPhotos(jpegPhoto({ gps: false }))
    click('Set the location')
    await opened()
    click('Use this place')
    await settle()

    const warning = root.querySelector('[role="alert"]')
    expect(warning?.textContent).toContain('outside Davao City')
    // Said, not enforced: the reporter can still file it.
    expect(root.querySelector('button.primary')?.hasAttribute('disabled')).toBe(false)
  })

  // A geocoder that is down must not stop anybody filing anything.
  it('files with the coordinates alone when no street can be found', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('nope', { status: 503 })))
    geolocation({ latitude: 7.11111, longitude: 125.61111 })

    await attachPhotos(jpegPhoto({ gps: false }))
    click('Set the location')
    await opened()
    click('Use this place')
    await settle()

    expect(root.querySelector('.street')).toBeNull()
    expect(root.textContent).toContain('Adjust location')
    expect(root.textContent).not.toContain('Looking up the street')
  })

  it('starts at the middle of the city when the browser refuses', async () => {
    geolocation(null)
    await attachPhotos(jpegPhoto({ gps: false }))
    click('Set the location')
    await opened()

    expect(root.textContent).toContain('the map starts at the middle of the city')
    expect(root.textContent).toContain('The ring is at 7.0731, 125.6128')
  })

  it('sends the place the reporter picked', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    geolocation({ latitude: 7.06423, longitude: 125.60778 })
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes('/api/place')) {
        return new Response(
          JSON.stringify({ address: 'Quimpo Boulevard, Talomo, Davao City', in_davao: true }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ reference: 'DCR-9' }), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await attachPhotos(jpegPhoto({ gps: false }))
    click('Set the location')
    await opened()
    click('Use this place')
    await settle()

    // The picker closes, and the form draws where the report will go.
    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.textContent).toContain('Adjust location')

    click('Pothole')
    const description = root.querySelector<HTMLTextAreaElement>('#description')!
    description.value = 'A deep pothole in the outer lane.'
    act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await settle()

    const filed = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/reports'))!
    const body = filed[1]?.body as FormData
    expect(body.get('lat')).toBe('7.06423')
    expect(body.get('lon')).toBe('125.60778')
    // Nobody typed this. It is the street under the pin, looked up the way
    // the city's own form looks its own up.
    expect(body.get('address')).toBe('Quimpo Boulevard, Talomo, Davao City')
    expect(body.getAll('photos')).toHaveLength(1)
  })

  it('turns a spinner while it looks for the reporter', async () => {
    // A browser that is asked and never answers, which is what a phone
    // waiting on a permission prompt looks like.
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: () => {} },
    })

    await attachPhotos(jpegPhoto({ gps: false }))
    click('Set the location')
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
    await attachPhotos(jpegPhoto({ gps: false }))
    click('Set the location')
    await opened()
    click('Cancel')
    await settle()

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    // No pin was put down, so the button still offers to place one.
    expect(root.querySelector('.mapwrap.inline')).toBeNull()
    expect(root.textContent).toContain('Set the location')
    expect(root.textContent).not.toContain('Adjust location')
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
// The line on the page and the one in the notice have to agree, and the
// one on the page has to be there without anybody asking for it.
describe('the emergency line on the page', () => {
  it('is on the form itself, before any pop-up is opened', () => {
    act(() => render(<App />, root))

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    const line = root.querySelector('header .emergencyline')!
    expect(line.textContent).toContain('In an emergency')
    expect(line.textContent).toContain('call 911')
  })

  // On a phone, the number should be one press away, not something to
  // memorise and retype.
  it('dials rather than describes', () => {
    act(() => render(<App />, root))

    const call = root.querySelector('header .emergencyline a')!
    expect(call.getAttribute('href')).toBe('tel:911')
  })
})

describe("this site's own notice", () => {
  function openSite() {
    act(() => render(<App />, root))
    const link = [...root.querySelectorAll<HTMLButtonElement>('header .linky')].find(
      (b) => b.textContent?.trim() === 'how this site handles your report',
    )!
    act(() => link.click())
  }

  // A pothole form is the wrong place to report a fire. Whoever tries it
  // anyway should be sent somewhere useful in the first few words.
  it('sends an emergency to 911, before anything else', () => {
    openSite()

    const sheet = root.querySelector('[role="dialog"]')!
    const warning = sheet.querySelector('.emergency')!
    expect(warning.textContent).toContain('call 911 from any phone')
    expect(warning.textContent).toContain('take days to reach the city')

    // Above the notice itself, not buried inside it.
    const notice = sheet.querySelector('.notice')!
    expect(warning.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

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
