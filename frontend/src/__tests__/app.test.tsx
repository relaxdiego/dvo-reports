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
    if (root.querySelectorAll('.photorow').length > 0) break
  }
  // A photo is read once to decide whether it may be attached at all, and
  // again to show what it says. The rows can be on the page before that
  // second read has finished.
  await settle()
}

function click(text: string) {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!button) throw new Error(`no button reading "${text}"`)
  act(() => button.click())
}

/**
 * Files the draft and hands back the form data the browser would have posted.
 * The picker no longer prints the coordinates it is sitting on, so sending
 * the report is how a test sees where the pin actually was.
 */
async function fileAndRead(): Promise<FormData> {
  localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
  const sent = vi.fn<typeof fetch>(async (input) =>
    String(input).includes('/api/place')
      ? new Response(JSON.stringify({ address: '', in_davao: true }), { status: 200 })
      : new Response(JSON.stringify({ reference: 'DCR-1' }), { status: 201 }),
  )
  vi.stubGlobal('fetch', sent)
  click('Garbage')
  const description = root.querySelector<HTMLTextAreaElement>('#description')!
  description.value = 'Something worth describing.'
  act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })
  act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await settle()
  const filed = sent.mock.calls.find(([url]) => String(url).endsWith('/api/reports'))!
  return filed[1]?.body as FormData
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
    expect(chips()).toContain('Illegal parking')
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
    expect(chips()).toContain('Pothole (Lubak)')
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
    await attach(jpegPhoto({ offset: '+08:00' }))

    const rows = root.querySelectorAll('.photorow')
    expect(rows).toHaveLength(1)

    const link = rows[0].querySelector('a')
    expect(link?.textContent).toBe('7.09753, 125.62229')
    expect(link?.getAttribute('href')).toContain('openstreetmap.org')
    expect(link?.getAttribute('href')).toContain('mlat=7.09753')
    expect(link?.getAttribute('target')).toBe('_blank')
    // The time sits under the coordinates, in the same row.
    expect(rows[0].textContent).toContain('2025')
  })

  // The rule the whole form rests on. The place is not typed and not picked
  // off a map, so a photograph that does not carry one cannot be part of a
  // report, and it is turned away where it is chosen rather than at the end.
  it('turns away a photo that does not say where it was taken', async () => {
    await attach(jpegPhoto({ gps: false }))

    expect(root.querySelectorAll('.photorow')).toHaveLength(0)
    const refused = root.querySelector('[role="alert"]')
    expect(refused?.textContent).toContain('does not record where it was taken')
    expect(refused?.textContent).toContain('Switch location on in your camera')
  })

  it('keeps the photos that do carry a place and refuses the rest', async () => {
    await attach(jpegPhoto(), jpegPhoto({ gps: false }))

    expect(root.querySelectorAll('.photorow')).toHaveLength(1)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('does not record where it was taken')
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
    // The sheet no longer spells the place out. What names the photograph it
    // belongs to is the date the camera wrote on it.
    expect(sheet?.textContent).toContain('Taken September 7, 2025')
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

  // The photo already knows where the problem is. Nobody is asked for it
  // again, and nobody may answer differently.
  it('takes the place from the photos, and lets it go with them', async () => {
    await attach(jpegPhoto())
    await settle()

    // The form is ordered so the photos come first and put the pin down.
    const form = root.querySelector('form')!.textContent!
    expect(form.indexOf('Photos')).toBeLessThan(form.indexOf('Location'))

    const remove = root.querySelector<HTMLButtonElement>('.photorow .remove')!
    act(() => remove.click())
    await settle()

    // With the photo gone there is nothing to file and nowhere to file it,
    // so the whole location section goes with it.
    expect(root.querySelector('form')!.textContent).not.toContain('Location')
  })
})

describe('the map on the form', () => {
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

  // Leaflet is tens of kilobytes. A reporter who has attached nothing has
  // nowhere to put a pin, so nothing may load it yet.
  it('does not fetch the map until a photo gives it somewhere to draw', () => {
    act(() => render(<App />, root))

    expect(root.querySelector('.leaflet-container')).toBeNull()
    expect(root.textContent).not.toContain('Location')
  })

  // The point of the whole arrangement: the photograph says where it was
  // taken, so the reporter is never asked and never has to answer.
  it('draws the place on the form as soon as a photo carries one', async () => {
    await attachPhotos(jpegPhoto())
    await waitFor('the map on the form', '.leaflet-container')

    // On the form, not over it, and with nothing to press: this map shows a
    // place, it does not ask for one.
    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.querySelector('.mapwrap.inline .leaflet-container')).not.toBeNull()
    expect(root.textContent).not.toContain('Adjust location')
    expect(root.textContent).not.toContain('Set the location')
  })

  it('files the report at the place the photo recorded', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    await attachPhotos(jpegPhoto())
    await settle()

    const body = await fileAndRead()
    expect(body.get('lat')).toBe('7.09753')
    expect(body.get('lon')).toBe('125.62229')
    expect(body.getAll('photos')).toHaveLength(1)
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
  it('warns when the photos were taken outside the city', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ address: 'Session Road, Baguio', in_davao: false }), { status: 200 }),
    ))

    await attachPhotos(jpegPhoto({ at: { lat: 16.4116, lon: 120.5933 } }))
    await settle()

    const warning = root.querySelector('[role="alert"]')
    expect(warning?.textContent).toContain('outside Davao City')
    // Said, not enforced: the reporter can still file it.
    expect(root.querySelector('button.primary')?.hasAttribute('disabled')).toBe(false)
  })

  // A geocoder that is down must not stop anybody filing anything.
  it('files with the coordinates alone when no street can be found', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('nope', { status: 503 })))

    await attachPhotos(jpegPhoto({ at: { lat: 7.11111, lon: 125.61111 } }))
    await settle()

    expect(root.querySelector('.street')).toBeNull()
    expect(root.textContent).toContain('Location')
    expect(root.textContent).not.toContain('Looking up the street')
  })
})

// One page, opened from one link. The city has no page for its terms, so a
// reporter who never visits the city's own site would otherwise never see
// what they are agreeing to.
describe('the disclaimer', () => {
  function open() {
    act(() => render(<App />, root))
    const link = [...root.querySelectorAll<HTMLButtonElement>('header .linky')].find(
      (b) => b.textContent?.trim() === 'disclaimer',
    )
    if (!link) throw new Error('no preamble link reading "disclaimer"')
    act(() => link.click())
  }

  // The line on the form says the one thing a reporter has to know before
  // they start. Everything else waits behind the link.
  it('is one link, under a line short enough to read', () => {
    act(() => render(<App />, root))

    const line = root.querySelector('header .unofficial')!
    expect(line.textContent).toContain('Unofficial site, not run by the city government')
    expect(line.textContent).toContain('Use at your own risk')
    // The one thing that binds the reporter, on the form and not only
    // behind the link: on the city's own site it is a button they press.
    expect(line.textContent).toContain("Sending a report means agreeing to the city's terms")
    expect(root.querySelectorAll('header .linky')).toHaveLength(1)
  })

  it('covers the page, this site first and the city after', () => {
    open()

    const sheet = root.querySelector<HTMLElement>('[role="dialog"]')!
    expect(sheet.classList.contains('full')).toBe(true)
    expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1)

    const headings = [...sheet.querySelectorAll('h2, h3')].map((h) => h.textContent?.trim())
    expect(headings).toEqual(['Disclaimer', 'What this site is', "The city's disclaimer"])
  })

  // Nobody else's page is embedded here: the city's words are a copy this
  // repository holds, and a frame would leak every reader to their server.
  it('carries the terms itself rather than framing them', () => {
    open()

    expect(root.querySelector('[role="dialog"] iframe')).toBeNull()
  })

  // A pothole form is the wrong place to report a fire. Whoever tries it
  // anyway should be sent somewhere useful in the first few words.
  it('sends an emergency to 911, before anything else', () => {
    open()

    const sheet = root.querySelector('[role="dialog"]')!
    const warning = sheet.querySelector('.emergency')!
    expect(warning.textContent).toContain('call 911 from any phone')
    expect(warning.textContent).toContain('can take days to be seen')

    // Above the terms themselves, not buried inside them.
    const notice = sheet.querySelector('.notice')!
    expect(warning.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says the plain things: nothing kept, nothing promised', () => {
    open()

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
    open()

    const sheet = root.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('Only those two things go on to the city')
    expect(sheet.textContent).toContain('the identifiers it puts on each photograph — is removed')
  })

  it("keeps the city's words the city's", () => {
    open()

    const sheet = root.querySelector('[role="dialog"]')!
    // "the site's", where the city writes "our": on this page "our" would
    // read as this project, which wrote none of it.
    expect(sheet.textContent).toContain(
      "By using Davao City Reports App, you hereby consent to the site's Privacy Policy",
    )
    expect(sheet.textContent).not.toContain('consent to our Privacy Policy')
    expect(sheet.textContent).toContain('Disclaimer Acceptance:')
  })

  // A copy is only as good as the day it was taken, and the city can change
  // its terms without telling anyone.
  it('says when the copy was taken, and whose words they are', () => {
    open()

    const sheet = root.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('as of 22 August 2026')
    expect(sheet.textContent).toContain("The following are the city's words")
    // The one edited word is named where a reader sees it, not only in a
    // code comment: text called somebody's exact words has to be.
    expect(sheet.textContent).toContain('One word is changed')
  })

  // The way out is at the end of the reading, not beside the start of it,
  // and nothing inside scrolls on its own to hide the rest.
  it('puts the only way out after the last of the terms', () => {
    open()

    const body = root.querySelector('[role="dialog"] .sheetbody')!
    const buttons = [...body.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Close'])
    expect(buttons[0]).toBe(body.lastElementChild)

    const city = [...body.querySelectorAll('section')].at(-1)!
    expect(city.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('closes again and leaves the form behind it', () => {
    open()
    click('Close')

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.querySelector('#description')).not.toBeNull()
  })
})

// The line on the page and the one in the disclaimer have to agree, and the
// one on the page has to be there without anybody asking for it.
describe('the emergency line on the page', () => {
  it('is on the form itself, before any pop-up is opened', () => {
    act(() => render(<App />, root))

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    const line = root.querySelector('header .emergencyline')!
    expect(line.textContent).toContain('For emergencies')
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
