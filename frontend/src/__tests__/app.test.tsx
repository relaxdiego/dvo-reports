import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { App } from '../app'
import { welcomed } from '../session'
import { MAX_DESCRIPTION, MAX_PHOTOS } from '../validate'
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
  sessionStorage.clear()
  // Everything below is a reporter who has been here before. The welcome
  // sheet is only for a first visit, and it covers the page, so a test that
  // did not say so would be testing the sheet rather than the form. The
  // sheet has its own tests at the end of this file.
  welcomed()
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
    reference: `20260501080000${String(i + 1).padStart(3, '0')}`,
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
      : new Response(JSON.stringify({ reference: '20260501080000001' }), { status: 201 }),
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

// The bar is guarded by __ENVIRONMENT__, a build-time constant. These tests
// run without DEPLOY_ENV set, so they see the same 'development' build a
// developer gets, and that is the case worth pinning: a build not told it is
// production says so. The production case is the constant being 'production',
// which no test can reach without a second build.
describe('the bar saying this is not the real site', () => {
  it('says so, and says a report sent from here is not filed', () => {
    act(() => render(<App />, root))

    const bar = root.querySelector('.testbanner')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain('Development')
    expect(bar?.textContent).toContain('not filed with the city')
  })

  // It has to be read before the report is written, not after.
  it('sits above everything else on the page', () => {
    act(() => render(<App />, root))

    expect(root.querySelector('main')?.firstElementChild?.className).toBe('testbanner')
  })
})

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
            { reference: '20260501080000001', title: 'Pothole: outer lane', description: 'x', location: 'y', status: 'ONGOING', filed: '2026-05-01 08:00:00' },
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

describe('signing in', () => {
  /**
   * The one backend error a reporter can only act on somewhere else. Typing
   * a host into a phone's address bar is where most people stop, so the
   * host in the sentence is the link to it.
   */
  it('makes the city\u2019s site tappable when the address has no account there', async () => {
    const refusal =
      'no city account is registered under that e-mail address; register at reports.davaocity.gov.ph first, then come back'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: refusal }), { status: 404 })),
    )

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    const email = root.querySelector<HTMLInputElement>('#email')!
    email.value = 'nobody@example.org'
    act(() => { email.dispatchEvent(new Event('input', { bubbles: true })) })
    click('Request a code')
    await settle()

    const error = root.querySelector('.error')!
    // The sentence still reads as one sentence, link and all.
    expect(error.textContent).toContain(refusal)
    const link = error.querySelector('a')!
    expect(link.textContent).toBe('reports.davaocity.gov.ph')
    expect(link.getAttribute('href')).toBe('https://reports.davaocity.gov.ph')
  })

  /**
   * The code arrives in a text message, so the reporter leaves the page to
   * read it. What they come back to has to be the field that wants it.
   */
  it('waits for the code in a focused field, and sends nobody away from a half-written report', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 })))

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    // The way to an account is a link out, and it opens beside this sheet
    // rather than replacing it.
    const register = root.querySelector<HTMLAnchorElement>('[role="dialog"] p a')!
    expect(register.getAttribute('href')).toBe('https://reports.davaocity.gov.ph')
    expect(register.getAttribute('target')).toBe('_blank')

    const email = root.querySelector<HTMLInputElement>('#email')!
    email.value = 'somebody@example.org'
    act(() => { email.dispatchEvent(new Event('input', { bubbles: true })) })
    click('Request a code')
    await settle()

    const box = root.querySelector<HTMLInputElement>('#code')!
    expect(document.activeElement).toBe(box)
    // The address it was sent to stays on the screen, and stays put.
    expect(email.value).toBe('somebody@example.org')
    expect(email.disabled).toBe(true)
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
    const refresh = [...root.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Refresh list',
    )
    // One, at the foot of the list.
    expect(refresh).toHaveLength(1)
    act(() => refresh[0].click())
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

  // Backspacing a search out on a phone is several presses of a small key.
  // The cross is one press, and it is only there when there is something to
  // clear.
  it('clears the search from inside the box', async () => {
    stubList(3)

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    const box = root.querySelector<HTMLInputElement>('#search')!
    expect(root.querySelector('.searchbox .x')).toBeNull()

    box.value = 'nothing matches this'
    act(() => { box.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(root.querySelectorAll('li.report')).toHaveLength(0)

    const clear = root.querySelector<HTMLButtonElement>('.searchbox .x')!
    act(() => clear.click())

    expect(box.value).toBe('')
    expect(root.querySelectorAll('li.report')).toHaveLength(3)
    // The box keeps the focus, so the next search is typed straight away.
    expect(document.activeElement).toBe(box)
    expect(root.querySelector('.searchbox .x')).toBeNull()
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

  // The three things somebody quotes when they write to the city about a
  // report. Copying them off a phone screen by hand is what this replaces,
  // so all three have to be there, each on a labelled line: pasted
  // elsewhere, a bare number or a bare date says nothing about what it is.
  it('copies the reference, the subject and the date, each labelled', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ reports: listOf(1) }), { status: 200 })),
    )
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    const button = root.querySelector<HTMLButtonElement>('.copy')!
    act(() => button.click())
    await settle()

    const copied = writeText.mock.calls[0][0]
    expect(copied).toBe(
      'Reference #: 20260501080000001\nSubject: Report number 1\nDate: May 01, 2026',
    )
    expect(button.textContent).toBe('Copied')
  })

  // ENCODED says nothing to the person who filed the report. The sentence
  // that explains it belongs on the line it explains, not alone at the top
  // of the card.
  it('says what each of the city\u2019s status words means, on its own line', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith('/api/reports')) {
          return new Response(JSON.stringify({ reports: listOf(1) }), { status: 200 })
        }
        return new Response(
          JSON.stringify({
            reference: '20260501080000001',
            steps: [
              { status: 'ENCODED', at: '2026-05-01 08:00:00' },
              { status: 'RECEIVED', office: 'City Engineer', at: '2026-05-02 08:00:00' },
            ],
          }),
          { status: 200 },
        )
      }),
    )

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    const steps = [...root.querySelectorAll('.steps li')]
    expect(steps[0].textContent).toContain('ENCODED')
    expect(steps[0].querySelector('.hint')!.textContent).toContain('Added to the city')
    expect(steps[1].querySelector('.hint')!.textContent).toContain('Sent to the office')
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
    expect(chips()).toContain('Road hazard')
  })
})

/*
  The site sends a reporter out to their camera app, because a photograph is
  the only thing that can say where the problem is. A phone short of memory
  throws this page away while they are gone, and what they had typed used to
  go with it.
*/
describe('a half-written report', () => {
  function typeInto(text: string) {
    const box = root.querySelector<HTMLTextAreaElement>('#description')!
    box.value = text
    act(() => { box.dispatchEvent(new Event('input', { bubbles: true })) })
  }

  it('is still there when the page comes back', async () => {
    act(() => render(<App />, root))
    click('Garbage')
    typeInto('The bins by the gate have not been emptied.')

    // The phone discarded the tab and built the page again.
    render(null, root)
    act(() => render(<App />, root))
    await settle()

    expect(root.querySelector<HTMLTextAreaElement>('#description')!.value).toBe(
      'The bins by the gate have not been emptied.',
    )
    // The chip carries a cross to clear it, so its text is more than its name.
    expect(root.querySelector('[aria-pressed="true"]')?.textContent).toContain('Garbage')
  })

  // The photos are not kept, and do not need to be: one is only let in if it
  // carries its own place, so it was taken in the camera app and is in the
  // reporter's library still.
  it('does not keep the photos', async () => {
    await attachPhotos(jpegPhoto())
    expect(root.querySelectorAll('.photorow')).toHaveLength(1)

    render(null, root)
    act(() => render(<App />, root))
    await settle()

    expect(root.querySelectorAll('.photorow')).toHaveLength(0)
  })

  it('is gone once the report has been sent', async () => {
    await attachPhotos(jpegPhoto())
    await fileAndRead()

    expect(sessionStorage.getItem('dvo-reports.draft')).toBeNull()
  })
})

describe('the description count', () => {
  function type(text: string) {
    const box = root.querySelector<HTMLTextAreaElement>('#description')!
    box.value = text
    act(() => { box.dispatchEvent(new Event('input', { bubbles: true })) })
    return root.querySelector('.count')!
  }

  it('counts up as the reporter types, and says which limit it is counting to', () => {
    act(() => render(<App />, root))

    expect(root.querySelector('.count')!.textContent).toBe(`0/${MAX_DESCRIPTION}`)
    expect(type('Deep pothole.').textContent).toBe(`13/${MAX_DESCRIPTION}`)
  })

  // Nothing stops the typing or the paste. The reporter is told the text is
  // over and chooses what to cut.
  it('says when the text is too long to send, and keeps it', () => {
    act(() => render(<App />, root))

    const over = type('x'.repeat(MAX_DESCRIPTION + 1))
    expect(over.className).toContain('over')
    expect(over.textContent).toContain('too long')
    expect(root.querySelector<HTMLTextAreaElement>('#description')!.value).toHaveLength(
      MAX_DESCRIPTION + 1,
    )
  })

  // The city counts UTF-16 code units, so an emoji is two of them.
  it('counts the way the city counts', () => {
    act(() => render(<App />, root))

    expect(type('🕳').textContent).toBe(`2/${MAX_DESCRIPTION}`)
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
    expect(refused?.textContent).toContain('has no location')
    // The advice has to name the camera app: the commonest way to reach a
    // photo with no place is to take one through the page, and no setting
    // fixes that one.
    expect(refused?.textContent).toContain('Open your camera app')
    // And the hint saying the same thing steps aside while it is up, rather
    // than repeating it in different words directly underneath.
    expect(root.textContent).not.toContain('Take the photo with your camera app first')
    // The photo itself is in the message, so "which one?" is answered without
    // reading. Its name is the alt text: a phone calls them all image.jpg, so
    // it is no use on the screen, and a screen reader has nothing else.
    const shown = refused?.querySelectorAll('.thumbs img')
    expect(shown).toHaveLength(1)
    expect(shown?.[0].getAttribute('alt')).toBe('photo.jpg')
    // One photo, so the message is about one photo throughout.
    expect(refused?.textContent).toContain('This photo has no location')
    expect(refused?.textContent).toContain('Pick the photo you just took')
  })

  // Picking several at once is ordinary — the phone offers the whole library.
  // Every one that is turned away is shown, and the message reads as being
  // about all of them rather than about one.
  it('shows every photo it turns away, and says so in the plural', async () => {
    await attach(jpegPhoto({ gps: false }), jpegPhoto({ gps: false }), jpegPhoto({ gps: false }))

    expect(root.querySelectorAll('.photorow')).toHaveLength(0)
    const refused = root.querySelector('[role="alert"]')
    expect(refused?.querySelectorAll('.thumbs img')).toHaveLength(3)
    expect(refused?.textContent).toContain('These photos have no location, so they were not added')
    expect(refused?.textContent).toContain('Did you take them just now')
    expect(refused?.textContent).toContain('Take the photos there')
    expect(refused?.textContent).toContain('Pick the photos you just took')
  })

  it('keeps the photos that do carry a place and refuses the rest', async () => {
    await attach(jpegPhoto(), jpegPhoto({ gps: false }))

    expect(root.querySelectorAll('.photorow')).toHaveLength(1)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('has no location')
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

  // A full report has nothing left to add, so the way to add is taken away
  // rather than left there to be pressed for nothing.
  it('takes the button away once the report is full', async () => {
    await attach(...Array.from({ length: MAX_PHOTOS }, () => jpegPhoto()))

    expect(root.querySelectorAll('.photorow')).toHaveLength(MAX_PHOTOS)
    expect(root.querySelector('.filebutton')).toBeNull()
    // The control goes too: a keyboard must not land on a picker that can
    // accept nothing.
    expect(root.querySelector('#photos')).toBeNull()
  })

  // A phone's picker cannot be told how many files it may choose, so it will
  // offer more than a report holds. The extra ones are cut here, and saying
  // so is the difference between a rule and a photo that vanishes.
  it('says how many photos it had to leave behind', async () => {
    await attach(...Array.from({ length: MAX_PHOTOS + 2 }, () => jpegPhoto()))

    expect(root.querySelectorAll('.photorow')).toHaveLength(MAX_PHOTOS)
    const alert = root.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('2 photos were not added')
    expect(alert?.textContent).toContain(`at most ${MAX_PHOTOS}`)
  })

  // A message that has been read and acted on is only in the way of the
  // photos below it.
  it('lets the reporter put an error away', async () => {
    await attach(jpegPhoto({ gps: false }))

    const alert = root.querySelector('[role="alert"]')!
    const x = alert.querySelector<HTMLButtonElement>('.dismiss')!
    expect(x.getAttribute('aria-label')).toBe('Dismiss this message')
    // The cross itself is decoration; the label is what is read out.
    expect(x.querySelector('[aria-hidden="true"]')?.textContent).toBe('×')

    act(() => x.click())
    await settle()

    expect(root.querySelector('[role="alert"]')).toBeNull()
  })

  // Four crosses can be on the screen at once: the one on the unofficial
  // notice, the one on a chosen kind, one per photo row, and the one that
  // puts an error away. They are drawn by a single shared class, so a cross
  // that does not carry it is one that will drift away from the others.
  it('draws every cross from the same class', async () => {
    await attach(...Array.from({ length: MAX_PHOTOS + 1 }, () => jpegPhoto()))
    click('Garbage')

    const crosses = [...root.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === '×',
    )
    // One per row, one on the chip, one on the "not added" error, one on
    // the unofficial notice in the header.
    expect(crosses).toHaveLength(MAX_PHOTOS + 3)
    for (const cross of crosses) {
      // On the glyph itself, or on the button holding it.
      const drawn = cross.classList.contains('x') || cross.parentElement!.classList.contains('x')
      expect(drawn).toBe(true)
    }
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
    expect(line.textContent).toContain('Unofficial site, not run by or connected to the city government')
    expect(line.textContent).toContain('Use at your own risk')
    // The one thing that binds the reporter, on the form and not only
    // behind the link: on the city's own site it is a button they press.
    expect(line.textContent).toContain("Sending a report means you agree to the city's terms")
    expect(root.querySelectorAll('header .linky')).toHaveLength(1)
  })

  function shorten() {
    const button = root.querySelector<HTMLButtonElement>('header .unofficial .dismiss')
    if (!button) throw new Error('no cross on the unofficial notice')
    return button
  }

  // Read once, the paragraph is only in the way of the form under it. The
  // cross shortens it, and this browser remembers that, so a returning
  // reporter is not asked to read the whole of it again.
  it('shortens when the cross is pressed, and stays short next visit', () => {
    act(() => render(<App />, root))
    act(() => shorten().click())

    const brief = root.querySelector('header .unofficial.brief')!
    expect(brief.textContent).toContain('Unofficial site')
    expect(brief.textContent).not.toContain('Volunteers built it')
    expect(brief.querySelector('.dismiss')).toBeNull()

    render(null, root)
    act(() => render(<App />, root))
    expect(root.querySelector('header .unofficial.brief')).not.toBeNull()
  })

  // The same cross as everywhere else on the page, in the same corner as the
  // one that puts an error away, and named for what it actually does.
  it("is the page's shared cross, in the corner", () => {
    act(() => render(<App />, root))

    expect(shorten().classList.contains('x')).toBe(true)
    expect(shorten().classList.contains('dismiss')).toBe(true)
    expect(shorten().textContent?.trim()).toBe('\u00d7')
    expect(shorten().getAttribute('aria-label')).toBe('Shorten this notice')
  })

  // The fact that nobody official is behind this never leaves the page, and
  // the terms are still one tap away from the header after it is shortened.
  it('still says it is unofficial, and still opens the terms, once short', () => {
    act(() => render(<App />, root))
    act(() => shorten().click())

    const link = root.querySelector<HTMLButtonElement>('header .unofficial.brief .linky')!
    expect(link.textContent?.trim()).toBe('disclaimer')
    act(() => link.click())
    expect(root.textContent).toContain("The city's disclaimer")
  })

  // Shortening the notice does not touch what sending binds the reporter to:
  // that is written again beside the button, where it is read at the moment
  // of agreeing.
  it('leaves the terms beside the send button when it is short', () => {
    act(() => render(<App />, root))
    act(() => shorten().click())

    const send = [...root.querySelectorAll('button[type="submit"]')].find(
      (b) => b.textContent?.trim() === 'Send report',
    )!
    const terms = send.previousElementSibling!
    expect(terms.textContent).toContain("Sending a report means you agree to the city's terms")
    expect(terms.querySelector('.linky')).not.toBeNull()
  })

  // And again just above the send button, because the header is scrolled off
  // the screen by the time anyone presses it, and because a notice under the
  // button is one the eye never reaches.
  it('says what sending binds the reporter to, above the send button', () => {
    act(() => render(<App />, root))

    const send = [...root.querySelectorAll('button[type="submit"]')].find(
      (b) => b.textContent?.trim() === 'Send report',
    )
    if (!send) throw new Error('no "Send report" button')
    const terms = send.previousElementSibling!
    expect(terms.textContent).toContain("Sending a report means you agree to the city's terms")
    expect(terms.querySelector('.linky')?.textContent?.trim()).toBe('disclaimer')
  })

  // Both links open the same page, so the reporter can read the terms at the
  // moment they are about to agree to them, not only before they started.
  it('opens from the line by the send button too', () => {
    act(() => render(<App />, root))

    const link = root.querySelector<HTMLButtonElement>('.terms .linky')!
    act(() => link.click())
    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
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
    expect(sheet.textContent).toContain('One wording is changed')
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

// Nothing here works without an account on the city's site, and this app
// cannot make one. Said on the way in, it costs a first-time reporter one
// tap; left unsaid, it costs them a written report and a set of photos.
describe('the welcome sheet', () => {
  /** A reporter who has never been here, unlike everybody else in this file. */
  function firstVisit() {
    localStorage.clear()
    act(() => render(<App />, root))
    return root.querySelector('[role="dialog"]')
  }

  it('opens on a first visit and says where to register', () => {
    const sheet = firstVisit()!

    expect(sheet.textContent).toContain('You need a city account first')
    // Their front page, not a deep link to the registration form: opened on
    // its own that form draws broken. See welcome.tsx.
    const go = sheet.querySelector('a.gobutton')!
    expect(go.getAttribute('href')).toBe('https://reports.davaocity.gov.ph')
  })

  // The code is texted to the number the account was registered with, so the
  // number chosen at registration is the one decision that cannot be undone
  // later without registering again.
  it('says the sign-in code goes to a phone, not an inbox', () => {
    expect(firstVisit()!.textContent).toContain('text message')
  })

  it('stays away once it has been put away', () => {
    firstVisit()
    click('I already have one')
    expect(root.querySelector('[role="dialog"]')).toBeNull()

    render(null, root)
    act(() => render(<App />, root))
    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })

  // Somebody signed in has an account by definition. Sending them off to get
  // one is worse than saying nothing.
  it('stays away from a reporter who is already signed in', () => {
    localStorage.clear()
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    act(() => render(<App />, root))

    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })

  // The address outlives the token: a reporter whose session has expired has
  // still been here, and still has an account.
  it('stays away from a reporter whose session has expired', () => {
    localStorage.clear()
    localStorage.setItem('dvo-reports.email', 'someone@example.com')
    act(() => render(<App />, root))

    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })
})

/**
 * The offer to put this on a home screen, which is made at the foot of the
 * report form and nowhere else. See addtohome.tsx for why there.
 */
describe('the offer to add this to a home screen', () => {
  /**
   * jsdom has no matchMedia, so every one of these has to say what kind of
   * browser this is. `standalone` is the site already opened from the icon.
   */
  function browser({ phone, standalone = false }: { phone: boolean; standalone?: boolean }) {
    vi.stubGlobal('matchMedia', (query: string) =>
      query.includes('display-mode') ? { matches: standalone } : { matches: phone },
    )
  }

  async function sendAReport() {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    await attachPhotos(jpegPhoto())
    await settle()
    await fileAndRead()
  }

  // The icon is worth most to whoever has not filed a report yet.
  it('is made before anything has been sent', () => {
    browser({ phone: true })
    act(() => render(<App />, root))

    expect(root.textContent).toContain('Send report')
    expect(root.textContent).toContain('Add it to your home screen')
  })

  // Below the send button, so nothing the form asks for is pushed down.
  it('sits under the send button', () => {
    browser({ phone: true })
    act(() => render(<App />, root))

    const buttons = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(buttons.indexOf('Add it to your home screen')).toBeGreaterThan(
      buttons.indexOf('Send report'),
    )
  })

  // One offer, in one place. The reference number is what the Sent screen
  // is for.
  it('is not made again on the Sent screen', async () => {
    browser({ phone: true })
    await sendAReport()

    expect(root.textContent).toContain('Report sent')
    expect(root.textContent).not.toContain('Add it to your home screen')
  })

  // Every step names something only a phone has.
  it('is not made on a browser with a mouse', () => {
    browser({ phone: false })
    act(() => render(<App />, root))

    expect(root.textContent).toContain('Send report')
    expect(root.textContent).not.toContain('Add it to your home screen')
  })

  // Whoever took the offer has stopped needing it.
  it('is not made inside the home screen app itself', () => {
    browser({ phone: true, standalone: true })
    act(() => render(<App />, root))

    expect(root.textContent).toContain('Send report')
    expect(root.textContent).not.toContain('Add it to your home screen')
  })

  it('opens a sheet carrying the steps for both kinds of phone', () => {
    browser({ phone: true })
    act(() => render(<App />, root))
    click('Add it to your home screen')

    const sheet = root.querySelector('[role="dialog"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.textContent).toContain('Add to Home Screen')
    expect(sheet?.textContent).toContain('Add to Home screen')
    expect(sheet?.querySelectorAll('ol')).toHaveLength(2)
  })

  // The icon has no address bar under it to say whose site this is.
  it('says in the sheet that the icon is not an app from the city', () => {
    browser({ phone: true })
    act(() => render(<App />, root))
    click('Add it to your home screen')

    const sheet = root.querySelector('[role="dialog"]')
    expect(sheet?.textContent).toContain('unofficial')
    expect(sheet?.textContent).toContain('not an app from the city government')
  })

  it('closes again, leaving the form as it was', () => {
    browser({ phone: true })
    act(() => render(<App />, root))
    click('Add it to your home screen')
    click('Close')

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.textContent).toContain('Send report')
  })
})
