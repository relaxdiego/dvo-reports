// jsdom has no IndexedDB, and a report kept on the phone is written to one.
// This is the same API over memory; each test below gets a fresh factory.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { App } from '../app'
import { welcomed } from '../session'
import { MAX_DESCRIPTION, MAX_PHOTOS } from '../validate'
import { jpegPhoto } from './fixtures'

/**
 * Lets the fetch, the state updates it causes, and the re-render settle.
 *
 * Each turn yields to the task queue rather than only draining microtasks.
 * Naming the street crosses a dynamic import() — street.ts is fetched the
 * first time a photo is attached — and a module load is not a microtask, so
 * a microtask-only drain returned before the answer arrived. That failed on
 * a slow machine and passed on a fast one, which is the worst way for a test
 * to be wrong.
 */
async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r)) })
}

/**
 * Waits for something to become true, however many turns it takes.
 *
 * A fixed number of turns cannot express "after the street lookup", because
 * how long that takes is not this test's to know. Anything that waits on the
 * lookup waits on a condition instead.
 */
async function until(done: () => boolean, what: string) {
  const deadline = Date.now() + 5000
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`)
    await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
  }
}

/** Waits until the street under the pin has been looked up, or has failed. */
async function streetNamed() {
  await until(() => !root.textContent?.includes('Looking up the street'), 'the street lookup')
}

// shrink() needs canvas, which jsdom does not have. Nothing here uploads.
vi.mock('../image', () => ({ shrink: async (f: File) => f }))

// street.ts is the one file that talks to OpenStreetMap, and it has its own
// tests. Mocking it here keeps `make test` off the network: nothing stubs
// fetch by default, so without this every test that attaches a photo sent a
// real request to nominatim.openstreetmap.org — slow, rude, and answered
// differently on a CI runner than on a laptop. Answering "no road" sends
// each lookup on to the backend, which every test below stubs for itself.
vi.mock('../street', () => ({ askOpenStreetMap: async () => null }))

let root: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  globalThis.indexedDB = new IDBFactory()
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

/**
 * A finger put down on something and lifted off again, the way a phone
 * reports it. jsdom has no Touch to build, and the code reads nothing but the
 * two coordinates, so the points go on a plain event.
 */
function swipe(el: Element, dx: number, dy = 0, fingers = 1) {
  hold(el, dx, dy, fingers)
  const up = Object.assign(new Event('touchend', { bubbles: true }), {
    touches: [],
    changedTouches: [{ clientX: 200 + dx, clientY: 400 + dy }],
  })
  act(() => { el.dispatchEvent(up) })
}

/** The same, but the finger stays down, the way it is partway through one. */
function hold(el: Element, dx: number, dy = 0, fingers = 1) {
  const at = (x: number, y: number) => ({ clientX: x, clientY: y })
  const points = (x: number, y: number) =>
    fingers === 1 ? [at(x, y)] : [at(x - 20, y), at(x + 20, y)]
  const down = Object.assign(new Event('touchstart', { bubbles: true }), { touches: points(200, 400) })
  const move = Object.assign(new Event('touchmove', { bubbles: true }), {
    touches: points(200 + dx, 400 + dy),
  })
  act(() => {
    el.dispatchEvent(down)
    el.dispatchEvent(move)
  })
}

/** Which of how many the open picture says it is, or null when it is alone. */
function counted() {
  return root.querySelector('.lightbox .count')?.textContent ?? null
}

/** Where the row of photographs is resting, and what is left in the style. */
function track() {
  return root.querySelector<HTMLElement>('.lightbox .track')!.getAttribute('style') ?? ''
}

/**
 * The picture on the screen: the one the row has been moved to. Every
 * photograph of the group is in the page now, laid out in a row, so the first
 * img is no longer the one being looked at.
 */
function shown() {
  const percent = Number(track().match(/calc\((-?\d+)%/)![1])
  return root.querySelectorAll('.lightbox img')[percent / -100].getAttribute('src')
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
  // The pin's street is still being looked up when a photo has just been
  // attached. Let it finish before filing, so the report is not sent out
  // from under it.
  await streetNamed()
  click('Garbage')
  const description = root.querySelector<HTMLTextAreaElement>('#description')!
  description.value = 'Something worth describing.'
  act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })
  act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  const wasFiled = () => sent.mock.calls.some(([url]) => String(url).endsWith('/api/reports'))
  await until(wasFiled, 'the report to be sent')
  await settle()
  const filed = sent.mock.calls.find(([url]) => String(url).endsWith('/api/reports'))!
  return filed[1]?.body as FormData
}

// The bar is guarded by `ENVIRONMENT`, read from the `<html>` tag when the
// page loads. jsdom renders that tag without the attribute, so these tests
// see the 'development' default, and that is the case worth pinning: a copy
// not told what it is says so rather than passing for the real site.
describe('the bar saying this is not the real site', () => {
  it('names the environment, and nothing else', () => {
    act(() => render(<App />, root))

    const bar = root.querySelector('.testbanner')
    expect(bar).not.toBeNull()
    expect(bar?.textContent?.trim()).toBe('Development')
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
      'the city has no account under that e-mail address; register at reports.davaocity.gov.ph first, then come back'
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

  // Only over a kept list: a list just fetched is already the city's newest,
  // so there is nothing for the link to go and get.
  it('offers no refresh link over a list fetched fresh', async () => {
    stubList(1)

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(root.textContent).toContain('Report number 1')
    expect([...root.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Refresh now')
  })

  it('asks again when the refresh link is used', async () => {
    localStorage.setItem('dvo-reports.keeplist', '1')
    const { keepList } = await import('../mylist')
    await keepList(listOf(1) as never, Date.now() - 60_000)
    const fetchMock = stubList(1)

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    // Nothing was asked for: the list came off the phone.
    expect(fetchMock).toHaveBeenCalledTimes(0)
    const refresh = [...root.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Refresh now',
    )
    // One, at the foot of the list.
    expect(refresh).toHaveLength(1)
    act(() => refresh[0].click())
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
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
  /** Opens a report carrying these photographs, and taps the first of them. */
  async function openPhotos(photos: string[]) {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    const withPhotos = listOf(1).map((r) => ({ ...r, photos }))
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith('/api/reports')) {
          return new Response(JSON.stringify({ reports: withPhotos }), { status: 200 })
        }
        return new Response(JSON.stringify({ reference: '1', steps: [] }), { status: 200 })
      }),
    )

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    const link = root.querySelector<HTMLAnchorElement>('.reportbody .thumbs a')!
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    await settle()
  }

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

  /*
    The list can be read off the phone while the city's token is dead, so
    opening a report is the first thing to meet the sign-in. Closing that
    sheet is not a failure and there is nothing to apologise for — but the
    spinner has to stop, because nothing is left running that could ever
    end it, and a report stuck on "Reading what happened…" reads as an app
    that has hung.
  */
  it('stops waiting, and offers to ask again, when the sign-in is closed', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-old' }))
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        // The list is fine; only the second call meets the dead token.
        if (String(input).endsWith('/api/reports')) {
          return new Response(JSON.stringify({ reports: listOf(1) }), { status: 200 })
        }
        return new Response(JSON.stringify({ error: 'expired' }), { status: 401 })
      }),
    )

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
    click('Not now')
    await settle()

    const body = root.querySelector('.reportbody')!
    expect(body.textContent).not.toContain('Reading what happened')
    expect(body.querySelector('.spinner')).toBeNull()
    expect(body.textContent).toContain('a code from the city')

    // And the way back: the same question, asked again.
    click('Show history')
    await settle()
    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
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

  // The same as the photos on the form: a thumbnail is a square crop, and the
  // photograph the city holds is the whole frame. Opening a new tab would
  // lose the list, which is several taps and a code to get back to.
  it('opens a past report\u2019s photo over the page when it is tapped', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    const withPhotos = listOf(1).map((r) => ({
      ...r,
      photos: ['https://city.example/a.jpg', 'https://city.example/b.jpg'],
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith('/api/reports')) {
          return new Response(JSON.stringify({ reports: withPhotos }), { status: 200 })
        }
        return new Response(JSON.stringify({ reference: '1', steps: [] }), { status: 200 })
      }),
    )

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    const links = root.querySelectorAll<HTMLAnchorElement>('.reportbody .thumbs a')
    expect(links).toHaveLength(2)
    // The city sends no name with a photograph, so the number is the only
    // thing a screen reader can tell one from another by.
    expect(links[1].getAttribute('aria-label')).toBe('Show photo 2 larger')

    act(() => {
      links[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    await settle()

    // Every photograph of the group is in the page, laid out in a row; the
    // one being looked at is the one the row has been moved to.
    expect(shown()).toBe('https://city.example/b.jpg')
    // The list is still underneath, not replaced.
    expect(root.querySelector('.reporthead')).not.toBeNull()

    act(() => root.querySelector<HTMLButtonElement>('.lightbox .x')!.click())
    await settle()
    expect(root.querySelector('.lightbox')).toBeNull()
  })

  // Going back to the row of squares to open the one beside it is three taps.
  // Every photo viewer on a phone moves along the group with a swipe.
  it('swipes along the photos of the report it was opened from', async () => {
    await openPhotos(['https://city.example/a.jpg', 'https://city.example/b.jpg'])

    const box = root.querySelector('.lightbox')!
    expect(shown()).toBe('https://city.example/a.jpg')
    // Nothing else on the screen says there is a second photograph.
    expect(counted()).toBe('1 of 2')

    swipe(box, -120)
    await settle()
    expect(shown()).toBe('https://city.example/b.jpg')
    expect(counted()).toBe('2 of 2')
    // A swipe is not a tap. The photo just reached is not put away again.
    expect(root.querySelector('.lightbox')).not.toBeNull()

    swipe(box, 120)
    await settle()
    expect(shown()).toBe('https://city.example/a.jpg')
  })

  // Stopping is how the reporter learns there is no more. Wrapping round
  // shows them the first photo again, which reads as a photo they missed.
  it('stops at each end of the group', async () => {
    await openPhotos(['https://city.example/a.jpg', 'https://city.example/b.jpg'])
    const box = root.querySelector('.lightbox')!

    swipe(box, 120)
    await settle()
    expect(shown()).toBe('https://city.example/a.jpg')

    swipe(box, -120)
    swipe(box, -120)
    await settle()
    expect(shown()).toBe('https://city.example/b.jpg')
  })

  // A thumb resting on a photograph slides a few pixels, and a drag down the
  // screen is somebody scrolling, not somebody asking for the next photo.
  it('leaves the photo alone on anything that is not a sideways swipe', async () => {
    await openPhotos(['https://city.example/a.jpg', 'https://city.example/b.jpg'])
    const box = root.querySelector('.lightbox')!

    swipe(box, -20)
    swipe(box, -120, 200)
    // Two fingers are a pinch, and zooming into a photograph is half the
    // reason to open it large.
    swipe(box, -120, 0, 2)
    await settle()

    expect(shown()).toBe('https://city.example/a.jpg')
  })

  // The point of the animation. A swipe that gives back nothing until the
  // finger is lifted looks like a page that did not notice the finger.
  it('takes the row of photos with the finger before it is let go', async () => {
    await openPhotos(['https://city.example/a.jpg', 'https://city.example/b.jpg'])
    const box = root.querySelector('.lightbox')!

    // At rest on the first of them, and eased.
    expect(track()).toContain('calc(0% + 0px)')
    expect(track()).not.toContain('transition: none')

    hold(box, -80)
    // Exactly where the finger put it: easing partway through a drag would
    // put the picture behind the thumb dragging it.
    expect(track()).toContain('calc(0% + -80px)')
    expect(track()).toContain('transition: none')

    // Letting go settles it the rest of the way, with the easing back on.
    swipe(box, -80)
    await settle()
    expect(track()).toContain('calc(-100% + 0px)')
    expect(track()).not.toContain('transition: none')
  })

  // Dragging into nothing has to feel like nothing is there, or the reporter
  // keeps trying. It gives way a little and springs back.
  it('barely moves the row when it is dragged past the end', async () => {
    await openPhotos(['https://city.example/a.jpg', 'https://city.example/b.jpg'])
    const box = root.querySelector('.lightbox')!

    hold(box, 120)
    expect(track()).toContain('calc(0% + 30px)')

    swipe(box, 120)
    await settle()
    expect(shown()).toBe('https://city.example/a.jpg')
    expect(track()).toContain('calc(0% + 0px)')
  })

  // Nobody swipes a keyboard.
  it('moves along the group with the arrow keys', async () => {
    await openPhotos(['https://city.example/a.jpg', 'https://city.example/b.jpg'])

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })) })
    await settle()
    expect(shown()).toBe('https://city.example/b.jpg')

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })) })
    await settle()
    expect(shown()).toBe('https://city.example/a.jpg')
  })

  // One photograph is not a group, and "1 of 1" is a line that says nothing.
  it('says nothing about a group when there is only one photo', async () => {
    await openPhotos(['https://city.example/a.jpg'])
    expect(counted()).toBeNull()
  })

  // It is still a link. Someone who asks for a new tab gets one.
  it('leaves a ctrl-click on a past report\u2019s photo to the browser', async () => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    const withPhotos = listOf(1).map((r) => ({ ...r, photos: ['https://city.example/a.jpg'] }))
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith('/api/reports')) {
          return new Response(JSON.stringify({ reports: withPhotos }), { status: 200 })
        }
        return new Response(JSON.stringify({ reference: '1', steps: [] }), { status: 200 })
      }),
    )

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    const link = root.querySelector<HTMLAnchorElement>('.reportbody .thumbs a')!
    expect(link.getAttribute('href')).toBe('https://city.example/a.jpg')
    expect(link.getAttribute('target')).toBe('_blank')

    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
    act(() => { link.dispatchEvent(e) })
    await settle()

    expect(e.defaultPrevented).toBe(false)
    expect(root.querySelector('.lightbox')).toBeNull()
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
    // One photo can have come from the camera the page opened, so this is the
    // reporter who is asked about the taps they have just made.
    expect(refused?.textContent).toContain('Did you take it just now')
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
    expect(refused?.textContent).toContain('Take the photos there')
    expect(refused?.textContent).toContain('Pick the photos you just took')
  })

  // Neither phone hands back more than one photo from its camera, so several
  // at once came from the library. Asking this reporter whether they took them
  // just now describes taps they did not make.
  it('does not blame the page camera when several photos are turned away', async () => {
    await attach(jpegPhoto({ gps: false }), jpegPhoto({ gps: false }))

    const refused = root.querySelector('[role="alert"]')
    expect(refused?.textContent).not.toContain('Did you take them just now')
    expect(refused?.textContent).toContain('A photo already on your phone has no location')
  })

  // A reporter who picks four and gets one in has to see the one that landed
  // before the red box, or they read the box as being about all four.
  it('puts the refusal below the photos that did get in', async () => {
    await attach(jpegPhoto(), jpegPhoto({ gps: false }))

    const list = root.querySelector('.photolist')
    const refused = root.querySelector('[role="alert"]')
    expect(list).not.toBeNull()
    expect(refused?.textContent).toContain('has no location')
    // DOCUMENT_POSITION_FOLLOWING: the box comes after the list, not before.
    expect(list!.compareDocumentPosition(refused!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  // The steps cannot help a reporter whose browser is inside another app: the
  // place was there and that app took it out. Both messages say so.
  it('names the in-app browser in both messages', async () => {
    await attach(jpegPhoto({ gps: false }))
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Opening this page inside another app',
    )

    await attach(jpegPhoto({ gps: false }), jpegPhoto({ gps: false }))
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Opening this page inside another app',
    )
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

  // A thumbnail is a square crop of a photograph. What the city gets is the
  // whole frame, and the reporter gets to look at that before pressing Send.
  it('opens the photo over the page when its thumbnail is tapped', async () => {
    await attach(jpegPhoto())

    const thumb = root.querySelector<HTMLButtonElement>('.photorow .thumbtap')!
    // A phone calls them all image.jpg, so the name is no use on the screen —
    // but it is all a screen reader has to tell one thumbnail from another.
    expect(thumb.getAttribute('aria-label')).toBe('Show photo.jpg larger')

    act(() => thumb.click())
    await settle()

    const box = root.querySelector('.lightbox')!
    expect(box).not.toBeNull()
    // The same file the thumbnail is drawing, not a second copy of it.
    expect(box.querySelector('img')?.getAttribute('src')).toBe('blob:x')
    // The form is still underneath, not replaced. A half-written report
    // survives a look at a photo.
    expect(root.querySelector('#description')).not.toBeNull()

    act(() => root.querySelector<HTMLButtonElement>('.lightbox .x')!.click())
    await settle()
    expect(root.querySelector('.lightbox')).toBeNull()
  })

  // What a photo opened on a phone does everywhere else.
  it('puts the photo away when the picture itself is tapped', async () => {
    await attach(jpegPhoto())

    act(() => root.querySelector<HTMLButtonElement>('.photorow .thumbtap')!.click())
    await settle()

    const image = root.querySelector<HTMLImageElement>('.lightbox img')!
    act(() => { image.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await settle()

    expect(root.querySelector('.lightbox')).toBeNull()
  })

  // The photos already attached are a group, the same as a past report's
  // are. A reporter checking what they are about to send looks at all of
  // them, not at one and then back to the row of squares.
  it('swipes along the photos already attached', async () => {
    await attach(jpegPhoto(), jpegPhoto({ at: { lat: 7.1, lon: 125.6 } }))
    expect(root.querySelectorAll('.photorow')).toHaveLength(2)

    act(() => root.querySelector<HTMLButtonElement>('.photorow .thumbtap')!.click())
    await settle()
    expect(counted()).toBe('1 of 2')

    swipe(root.querySelector('.lightbox')!, -120)
    await settle()
    expect(counted()).toBe('2 of 2')
  })

  // The refused photos are where "which one?" is asked hardest: several
  // pictures of the same street are one picture at this size.
  it('opens a refused photo over the page too', async () => {
    await attach(jpegPhoto({ gps: false }))

    const thumb = root.querySelector<HTMLButtonElement>('[role="alert"] .thumbtap')!
    act(() => thumb.click())
    await settle()

    expect(root.querySelector('.lightbox img')?.getAttribute('alt')).toBe('photo.jpg')
  })

  // "Which ones?" is a question about all of them, so the refused photos are
  // a group to swipe through as well.
  it('swipes along the refused photos', async () => {
    await attach(jpegPhoto({ gps: false }), jpegPhoto({ gps: false, date: false }))
    expect(root.querySelectorAll('[role="alert"] .thumbtap')).toHaveLength(2)

    act(() => root.querySelector<HTMLButtonElement>('[role="alert"] .thumbtap')!.click())
    await settle()
    expect(counted()).toBe('1 of 2')

    swipe(root.querySelector('.lightbox')!, -120)
    await settle()
    expect(counted()).toBe('2 of 2')
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

  /** The link beside the street name, which opens the picker over the form. */
  function adjust() {
    const link = root.querySelector<HTMLButtonElement>('.street .adjust')
    if (!link) throw new Error('no way to adjust the pin')
    return link
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

    // On the form, not over it. Nothing on this map asks for anything: the
    // one way to move the pin is the link beside the street name, and it
    // opens a map of its own over the form.
    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.querySelector('.mapwrap.inline .leaflet-container')).not.toBeNull()
    expect(root.textContent).not.toContain('Adjust location')
  })

  // The pin is where the photographs said, so the picker opens there: an
  // adjustment starts from the photograph rather than from nowhere.
  it('opens the picker on the pin the photos put down', async () => {
    await attachPhotos(jpegPhoto())
    await waitFor('the way to adjust the pin', '.street .adjust')
    act(() => adjust().click())
    await waitFor('the picker', '[role="dialog"] .leaflet-container')

    // Taking the place without moving the map takes whatever the picker
    // opened on, which is what the photograph recorded.
    click('Use this location')
    await settle()
    expect(root.querySelector('[role="dialog"]')).toBeNull()

    const body = await fileAndRead()
    expect(body.get('lat')).toBe('7.09753')
    expect(body.get('lon')).toBe('125.62229')
  })

  // Once the reporter has put the pin somewhere, it is theirs. Another photo
  // would otherwise pull it back to the middle of the two, undoing what they
  // just did.
  it('keeps the pin the reporter chose when another photo is added', async () => {
    await attachPhotos(jpegPhoto())
    await waitFor('the way to adjust the pin', '.street .adjust')
    act(() => adjust().click())
    await waitFor('the picker', '[role="dialog"] .leaflet-container')
    click('Use this location')
    await settle()

    // Near enough to be the same problem, so the two photos together would
    // put the pin at 7.09777 — between them — if they still decided it.
    await attachPhotos(jpegPhoto({ at: { lat: 7.098, lon: 125.62229 } }))

    const body = await fileAndRead()
    expect(body.get('lat')).toBe('7.09753')
  })

  // Taking the last photo out takes the place with it, and what the reporter
  // chose goes too: the next photograph starts the pin again, or there is no
  // report to file.
  it('forgets the pin the reporter chose when the photos go', async () => {
    await attachPhotos(jpegPhoto())
    await waitFor('the way to adjust the pin', '.street .adjust')
    act(() => adjust().click())
    await waitFor('the picker', '[role="dialog"] .leaflet-container')
    click('Use this location')
    await settle()

    act(() => root.querySelector<HTMLButtonElement>('.photorow .remove')!.click())
    await settle()
    expect(root.querySelector('form')!.textContent).not.toContain('Location')

    await attachPhotos(jpegPhoto({ at: { lat: 7.11111, lon: 125.61111 } }))

    const body = await fileAndRead()
    expect(body.get('lat')).toBe('7.11111')
    expect(body.get('lon')).toBe('125.61111')
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
    await streetNamed()

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
    await streetNamed()

    const warning = root.querySelector('[role="alert"]')
    expect(warning?.textContent).toContain('outside Davao City')
    // Said, not enforced: the reporter can still file it.
    expect(root.querySelector('button.primary')?.hasAttribute('disabled')).toBe(false)
  })

  // A geocoder that is down must not stop anybody filing anything.
  it('files with the coordinates alone when no street can be found', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('nope', { status: 503 })))

    await attachPhotos(jpegPhoto({ at: { lat: 7.11111, lon: 125.61111 } }))
    await streetNamed()

    // No name for the place, so the line under the map holds nothing but the
    // way to move the pin off it.
    await waitFor('the way to adjust the pin', '.street .adjust')
    expect(root.querySelector('.street')?.textContent?.trim()).toBe('Adjust')
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

  function hide() {
    const button = root.querySelector<HTMLButtonElement>('header .unofficial .dismiss')
    if (!button) throw new Error('no cross on the unofficial notice')
    return button
  }

  // Read once, the paragraph is only in the way of the form under it. The
  // cross takes the whole of it away, and this browser remembers that, so a
  // returning reporter is not asked to read it again.
  it('goes away when the cross is pressed, and stays away next visit', () => {
    act(() => render(<App />, root))
    act(() => hide().click())

    expect(root.querySelector('header .unofficial')).toBeNull()
    expect(root.textContent).not.toContain('Volunteers built it')

    render(null, root)
    act(() => render(<App />, root))
    expect(root.querySelector('header .unofficial')).toBeNull()
  })

  // A reporter carrying the old flag agreed to a shorter notice, never to no
  // notice. They are shown the whole of it once more.
  it('does not treat an old shortened notice as one that was hidden', () => {
    localStorage.setItem('dvo-reports.unofficial-minimized', '1')
    act(() => render(<App />, root))

    expect(root.querySelector('header .unofficial')).not.toBeNull()
  })

  // The same cross as everywhere else on the page, in the same corner as the
  // one that puts an error away, and named for what it actually does.
  it("is the page's shared cross, in the corner", () => {
    act(() => render(<App />, root))

    expect(hide().classList.contains('x')).toBe(true)
    expect(hide().classList.contains('dismiss')).toBe(true)
    expect(hide().textContent?.trim()).toBe('\u00d7')
    expect(hide().getAttribute('aria-label')).toBe('Hide this notice')
  })

  // Both facts survive the notice being put away, because both are written
  // again above the send button — where they are read at the moment of
  // agreeing, and where no cross can reach them.
  it('still says whose site this is, above the send button, once hidden', () => {
    act(() => render(<App />, root))
    act(() => hide().click())

    const send = [...root.querySelectorAll('button[type="submit"]')].find(
      (b) => b.textContent?.trim() === 'Send report',
    )!
    const terms = send.previousElementSibling!
    expect(terms.textContent).toContain("Unofficial site, not the city government's")
    expect(terms.textContent).toContain("Sending a report means you agree to the city's terms")
    // Nothing to press: this copy is not one a reporter can put away.
    expect(terms.querySelector('.dismiss')).toBeNull()

    const link = terms.querySelector<HTMLButtonElement>('.linky')!
    expect(link.textContent?.trim()).toBe('disclaimer')
    act(() => link.click())
    expect(root.textContent).toContain("The city's disclaimer")
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

/**
 * The reports the city would not take, kept on the phone until it will.
 *
 * These drive the whole path a reporter walks on a day the city's site is
 * down: the send that fails, the offer, the card in the other tab, and the
 * send that works afterwards. The storage itself has its own tests in
 * saved.test.ts; what is checked here is that the form and the tab agree
 * with it.
 */
describe('a report the city would not take', () => {
  /** The city's site, refusing everything but the street lookup. */
  function cityDown() {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/api/place')
        ? new Response(JSON.stringify({ address: '', in_davao: true }), { status: 200 })
        : new Response(JSON.stringify({ error: 'The city’s site is not answering.' }), { status: 502 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  /** Fills in what the form insists on, and presses the button. */
  async function fillAndSend(words = 'Rubbish left on the pavement.') {
    await streetNamed()
    click('Garbage')
    const description = root.querySelector<HTMLTextAreaElement>('#description')!
    description.value = words
    act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await settle()
  }

  /** Opens the reports tab and waits for the card of a kept report. */
  async function openDrafts() {
    click('My reports')
    await until(() => root.querySelector('.status.kept') !== null, 'the kept report')
  }

  /*
    One notice, not two. The offer used to sit in a box of its own under the
    error, opening with the same fact the error had just stated; it is now a
    clause on the end of the sentence it answers, with the action as a link
    inside it. The city's own message still leads, because that is the part
    that changes.
  */
  it('offers a draft inside the message that says why', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()

    const notice = root.querySelector('.error')!
    expect(root.querySelectorAll('.error')).toHaveLength(1)
    expect(notice.textContent).toContain('The city’s site is not answering.')
    expect([...notice.querySelectorAll('button')].map((b) => b.textContent?.trim()))
      .toContain('save it as a draft')
  })

  // The reporter's own mistake is theirs to fix here and now. Offering them
  // a place on the phone for it teaches that the button means "give up".
  it('offers nothing when the form is what refused the report', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await streetNamed()
    act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await settle()

    expect(root.querySelector('.error')).not.toBeNull()
    expect(root.querySelector('.keep')).toBeNull()
  })

  /*
    The whole point of a draft is that it exists on a day when the city's
    site is down — which is the same day the list below it cannot load. A
    report reachable only through a section showing an error is a report the
    reporter has lost.
  */
  it('shows it in the reports tab even when the city’s list will not load', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('save it as a draft')
    await settle()

    await openDrafts()

    expect(root.querySelector('.status.kept')?.textContent).toBe('Draft')
    expect(root.textContent).toContain('Drafts on this phone')
    expect(root.textContent).toContain('Rubbish left on the pavement.')
    // The city's half of the tab failed, as it would on the day this matters,
    // and the card above it is there all the same.
    await until(() => root.querySelector('.error') !== null, 'the city’s list to fail')
    expect(root.querySelector('.status.kept')).not.toBeNull()
  })

  it('keeps the photographs with it', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('Save draft on this phone')
    await settle()
    await openDrafts()

    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    expect(root.querySelectorAll('.reportbody .thumbs li')).toHaveLength(1)
  })

  /*
    Writing the report down used to change nothing on the screen: the same
    notice, the same button. A reporter could only read that as nothing
    having happened, and press it again. The sheet is what says otherwise,
    and the first thing it has to say is that the report is still not sent —
    a sheet after a button press reads as a success, and "sent" is the
    success it is easiest to assume.
  */
  it('says where the report went, and that it still has not been sent', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('save it as a draft')
    await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')

    const sheet = root.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('This report has not been sent.')
    expect(sheet.textContent).toContain('My reports')
    expect(sheet.textContent).toContain('Draft')
  })

  // A form left full after the report was put away is two of the same thing
  // in front of the reporter, with no way to tell which one is which.
  it('empties the form once the report is somewhere else', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('save it as a draft')
    await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
    click('Start a new report')
    await settle()

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.querySelector<HTMLTextAreaElement>('#description')?.value).toBe('')
    expect(root.querySelectorAll('.photorow')).toHaveLength(0)
    // Nothing left saying a report failed, because there is no longer one here.
    expect(root.querySelector('.error')).toBeNull()
  })

  it('takes the reporter to where it is waiting', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('save it as a draft')
    await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
    click('Show me where it is')
    await until(() => root.querySelector('.status.kept') !== null, 'the kept report')

    expect(root.querySelector('.status.kept')?.textContent).toBe('Draft')
  })

  // Keeping it again is the reporter carrying on writing, not a second
  // report. Two cards for one problem is how a report gets sent twice.
  it('writes over itself rather than making a second card', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('save it as a draft')
    await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
    click('Start a new report')
    await settle()

    // Back to it, changed, and the city is still not taking it.
    await openDrafts()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()
    click('Open it and send')
    await settle()
    const description = root.querySelector<HTMLTextAreaElement>('#description')!
    description.value = 'Said better the second time.'
    act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await settle()

    expect(root.querySelector('.error')?.textContent).toContain('An older draft')
    click('save the changes')
    await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
    click('Start a new report')
    await settle()
    await openDrafts()

    expect(root.querySelectorAll('.status.kept')).toHaveLength(1)
    expect(root.textContent).toContain('Said better the second time.')
  })

  /*
    Keeping a report empties the form, so coming back to the same draft a
    second time has to fill it in again. It did not: the form was drawn under
    a key built from the draft's own id, which had not moved, so nothing was
    rebuilt and the reporter was left looking at an empty form with their
    report still waiting in the other tab.
  */
  it('fills the form again when the same draft is opened a second time', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('save it as a draft')
    await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
    click('Start a new report')
    await settle()

    for (const go of [1, 2]) {
      await openDrafts()
      act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
      await settle()
      click('Open it and send')
      await settle()

      expect(root.querySelector<HTMLTextAreaElement>('#description')?.value).toBe(
        'Rubbish left on the pavement.',
      )
      expect(root.querySelectorAll('.photorow')).toHaveLength(1)

      if (go === 1) {
        // Put it away again without sending, the way a reporter would.
        act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
        await settle()
        click('save the changes')
        await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
        click('Start a new report')
        await settle()
      }
    }
  })

  it('sends it when the city is answering again, and stops holding it', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('Save draft on this phone')
    await settle()
    await openDrafts()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    // The city comes back up, and the reporter opens what they were holding.
    const sent = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/api/place')
        ? new Response(JSON.stringify({ address: '', in_davao: true }), { status: 200 })
        : new Response(JSON.stringify({ reference: '20260501080000001' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', sent)
    click('Open it and send')
    await settle()

    // The form came back with the report in it, ready to go as it was.
    expect(root.querySelector<HTMLTextAreaElement>('#description')?.value).toBe(
      'Rubbish left on the pavement.',
    )
    expect(root.querySelectorAll('.photorow')).toHaveLength(1)

    act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await until(() => root.textContent?.includes('Reference number') ?? false, 'the receipt')

    click('My reports')
    await settle()
    expect(root.querySelector('.status.kept')).toBeNull()
  })

  // The photographs are the part that is nowhere else. One mis-tap on a
  // phone must not be able to take them.
  it('takes two taps to delete, and the first can be taken back', async () => {
    cityDown()
    await attachPhotos(jpegPhoto())
    await fillAndSend()
    click('Save draft on this phone')
    await settle()
    await openDrafts()
    act(() => root.querySelector<HTMLButtonElement>('.reporthead')!.click())
    await settle()

    click('Delete this draft')
    expect(root.textContent).toContain('Delete this report and its photos from this phone?')
    click('Keep it')
    expect(root.querySelector('.status.kept')).not.toBeNull()

    click('Delete this draft')
    click('Delete')
    await until(() => root.querySelector('.status.kept') === null, 'the card to go')

    expect(root.textContent).not.toContain('Drafts on this phone')
  })

  /*
    Keeping a report without trying to send it first, for the reporter who
    simply has to stop. Waiting for a failure meant the only way to put a
    half-written report somewhere safe was to press Send and hope it broke.
  */
  describe('keeping one before any send', () => {
    /** Every button offering to keep this report, wherever it is drawn. */
    function keepButtons() {
      return [...root.querySelectorAll('button')].filter((b) =>
        /^Save (draft on this phone|the changes)$/.test(b.textContent?.trim() ?? ''),
      )
    }

    // Before a photograph there is nothing here worth a place on the phone:
    // the words alone already survive leaving for the camera app.
    it('is not offered until there is a photograph', async () => {
      cityDown()
      act(() => render(<App />, root))
      expect(keepButtons()).toHaveLength(0)

      await attachPhotos(jpegPhoto())

      expect(keepButtons()).toHaveLength(1)
    })

    it('keeps the report without a send being tried at all', async () => {
      const fetchMock = cityDown()
      await attachPhotos(jpegPhoto())
      await streetNamed()
      click('Garbage')
      const description = root.querySelector<HTMLTextAreaElement>('#description')!
      description.value = 'Half written, and I have to go.'
      act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })

      click('Save draft on this phone')
      await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')

      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/reports'))).toBe(false)
      await openDrafts()
      expect(root.textContent).toContain('Half written, and I have to go.')
    })

    // The reporter pressed it in order to be able to stop, not to be moved
    // somewhere else. Clearing the form here would be taking the report away
    // from somebody who was still writing it.
    it('leaves the form alone, unlike putting a refused report away', async () => {
      cityDown()
      await attachPhotos(jpegPhoto())
      await streetNamed()
      const description = root.querySelector<HTMLTextAreaElement>('#description')!
      description.value = 'Still writing this one.'
      act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })

      click('Save draft on this phone')
      await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
      click('Keep writing')
      await settle()

      expect(root.querySelector('[role="dialog"]')).toBeNull()
      expect(root.querySelector<HTMLTextAreaElement>('#description')?.value).toBe('Still writing this one.')
      expect(root.querySelectorAll('.photorow')).toHaveLength(1)
    })

    // Pressing it again is the same report, further along.
    it('writes over its own card as the report grows', async () => {
      cityDown()
      await attachPhotos(jpegPhoto())
      await streetNamed()
      const description = root.querySelector<HTMLTextAreaElement>('#description')!
      description.value = 'First half.'
      act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })
      click('Save draft on this phone')
      await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
      click('Keep writing')
      await settle()

      description.value = 'First half, and the second.'
      act(() => { description.dispatchEvent(new Event('input', { bubbles: true })) })
      expect(keepButtons()[0].textContent?.trim()).toBe('Save the changes')
      click('Save the changes')
      await until(() => root.querySelector('[role="dialog"]') !== null, 'the sheet')
      click('Keep writing')
      await settle()

      await openDrafts()
      expect(root.querySelectorAll('.status.kept')).toHaveLength(1)
      expect(root.textContent).toContain('First half, and the second.')
    })

    /*
      After a failed send there are two ways to a draft, and they are not the
      same control said twice: a link inside the sentence explaining the
      failure, for the reporter who is reading it, and the standing button
      under Send report, for the reporter who has stopped reading and is
      looking for something to press. The button stays where it always is.
    */
    it('stays where it is after a failed send, beside the link in the notice', async () => {
      cityDown()
      await attachPhotos(jpegPhoto())
      await fillAndSend()

      const standing = keepButtons()
      expect(standing).toHaveLength(1)
      expect(standing[0].closest('.error')).toBeNull()
      expect(standing[0].closest('form')).not.toBeNull()

      const inNotice = [...root.querySelectorAll('.error button')].map((b) => b.textContent?.trim())
      expect(inNotice).toContain('save it as a draft')
    })
  })

  /*
    The send button is always live, and the sign-in sheet opens on the tap.
    So on a day the city is down the reporter can be stopped inside the sheet
    instead — the code never comes — and close it. That used to leave a
    filled-in form, no message, and no way to keep any of it.
  */
  it('offers to keep it when the sign-in is what could not be finished', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/api/place')
        ? new Response(JSON.stringify({ address: '', in_davao: true }), { status: 200 })
        : new Response(JSON.stringify({ error: 'The city’s site is not answering.' }), { status: 502 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    // No session: the sheet opens when the button is pressed.
    await attachPhotos(jpegPhoto())
    await fillAndSend()

    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
    click('Not now')
    await settle()

    const notice = root.querySelector('.error')!
    expect(notice.textContent).toContain('has not been sent')
    expect([...notice.querySelectorAll('button')].map((b) => b.textContent?.trim()))
      .toContain('save it as a draft')
  })
})

/**
 * The list kept on the phone.
 *
 * The city's list call has no paging — one reply carries every report an
 * account ever filed — so these tests are mostly about what is *not* asked
 * of the city, and about the button being telling the truth.
 */
describe('keeping the list on this phone', () => {
  const KEPT = [
    {
      reference: '20260822133825088',
      title: 'Road damage: J. P. Laurel Avenue',
      description: 'A hole in the outer lane.',
      location: 'J. P. Laurel Avenue',
      status: 'ONGOING',
      filed: '2026-08-22 13:38:25',
    },
  ]

  /** Writes a list onto the phone, as the city having said it at `at`. */
  async function onThePhone(reports: unknown[], at: number) {
    localStorage.setItem('dvo-reports.keeplist', '1')
    const { keepList } = await import('../mylist')
    await keepList(reports as never, at)
  }

  const listCalls = (f: ReturnType<typeof vi.fn>) =>
    f.mock.calls.filter(([u]) => String(u).endsWith('/api/reports')).length

  function cityAnswering(reports = listOf(3)) {
    return vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ reports }), { status: 200 }))
  }

  beforeEach(() => {
    localStorage.setItem('dvo-reports.session', JSON.stringify({ token: 'tk-1' }))
  })

  // The whole point: a reporter who turned it on does not wait for the city.
  it('draws a fresh kept list without asking the city at all', async () => {
    await onThePhone(KEPT, Date.now() - 60_000)
    const fetchMock = cityAnswering()
    vi.stubGlobal('fetch', fetchMock)

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(root.textContent).toContain('Road damage: J. P. Laurel Avenue')
    expect(listCalls(fetchMock)).toBe(0)
    // A day less the minute it has been on the phone.
    expect(root.textContent).toContain('List will auto refresh in 23h 59m')
  })

  // The line vanished for the rest of the visit every time a refresh
  // succeeded, because the list written back carried no due time.
  it('still says when it next checks, after a refresh has replaced the list', async () => {
    await onThePhone(KEPT, Date.now() - 60_000)
    vi.stubGlobal('fetch', cityAnswering())

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    click('Refresh now')
    await settle()

    expect(root.textContent).toContain('List will auto refresh in 24h 0m')
  })

  // Stale is still worth reading. The new one arrives behind it.
  it('draws a day-old list at once and refreshes it behind the reporter', async () => {
    await onThePhone(KEPT, Date.now() - 25 * 60 * 60 * 1000)
    const fetchMock = cityAnswering()
    vi.stubGlobal('fetch', fetchMock)

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(listCalls(fetchMock)).toBe(1)
    // The city's answer replaced it, and no spinner stood in for the wait.
    expect(root.textContent).toContain('Report number 1')
    expect(root.textContent).not.toContain('Loading past reports')
  })

  // A refresh behind a list must not replace it with a red sentence.
  it('leaves a stale list on the screen when the refresh fails', async () => {
    await onThePhone(KEPT, Date.now() - 25 * 60 * 60 * 1000)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('offline') }))

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(root.textContent).toContain('Road damage: J. P. Laurel Avenue')
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })

  /*
    The line says the list refreshes itself, so it has to, on a reporter who
    is doing nothing but reading it. Before this, the countdown reached zero
    and stopped there until the tab was opened again.

    Fake timers with `shouldAdvanceTime` so that `settle`'s own setTimeout
    still fires: without it the render never settles and the test hangs.
  */
  it('refreshes a list that goes stale while the reporter is reading it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      // Half a minute short of a day: fresh when the tab opens, stale a
      // minute later.
      await onThePhone(KEPT, Date.now() - (24 * 60 * 60 * 1000 - 30_000))
      const fetchMock = cityAnswering()
      vi.stubGlobal('fetch', fetchMock)

      act(() => render(<App />, root))
      click('My reports')
      await settle()
      expect(listCalls(fetchMock)).toBe(0)

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      await settle()

      expect(listCalls(fetchMock)).toBe(1)
      expect(root.textContent).toContain('Report number 1')
    } finally {
      vi.useRealTimers()
    }
  })

  /*
    Not while they are writing a report. The city's session can be dead by
    now, and asking for it raises the sign-in sheet — over the form, that is
    a sheet nobody asked for.
  */
  it('does not refresh behind a reporter who is on the form', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await onThePhone(KEPT, Date.now() - (24 * 60 * 60 * 1000 - 30_000))
      const fetchMock = cityAnswering()
      vi.stubGlobal('fetch', fetchMock)

      act(() => render(<App />, root))
      click('My reports')
      await settle()
      click('Report a problem')
      await settle()

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      await settle()

      expect(listCalls(fetchMock)).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // Off by default: this is the rule saved.ts keeps, and the reason a list
  // of somebody's reports is allowed on their phone at all.
  it('keeps nothing until the reporter taps the button', async () => {
    vi.stubGlobal('fetch', cityAnswering())

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    const { keptList } = await import('../mylist')
    expect(await keptList()).toBeNull()
    expect([...root.querySelectorAll('button')].map((b) => b.textContent?.trim()))
      .toContain('Keep my reports on this phone')
  })

  // Tapping it writes down the list already on the screen. Waiting for some
  // later fetch would make the button's promise false while they looked at it.
  it('writes down the list already on screen when the reporter taps', async () => {
    vi.stubGlobal('fetch', cityAnswering())

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    click('Keep my reports on this phone')
    await settle()

    const { keptList, keepingList } = await import('../mylist')
    expect(keepingList()).toBe(true)
    expect((await keptList())?.reports).toHaveLength(3)
  })

  // The other half of the promise on the button.
  it('deletes the reports from the phone when the reporter stops', async () => {
    await onThePhone(KEPT, Date.now() - 60_000)
    vi.stubGlobal('fetch', cityAnswering())

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    click('Stop keeping my reports on this phone')
    await settle()

    const { keptList, keepingList } = await import('../mylist')
    expect(keepingList()).toBe(false)
    expect(await keptList()).toBeNull()
  })

  // `Refresh now` is the reporter asking for the city's newest, so it goes
  // past whatever is on the phone.
  it('asks the city when the reporter presses refresh', async () => {
    await onThePhone(KEPT, Date.now() - 60_000)
    const fetchMock = cityAnswering()
    vi.stubGlobal('fetch', fetchMock)

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    expect(listCalls(fetchMock)).toBe(0)

    click('Refresh now')
    await settle()

    expect(listCalls(fetchMock)).toBe(1)
    expect(root.textContent).toContain('Report number 1')
  })

  // Pressing Refresh must not take the list away to go and fetch a copy of
  // it. On a slow day that is ten seconds of nothing where the thing the
  // reporter came for used to be.
  it('leaves the list on screen while a refresh the reporter asked for runs', async () => {
    await onThePhone(listOf(3), Date.now() - 60_000)
    let answer: (r: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      if (!String(input).endsWith('/api/reports')) return new Response('{}', { status: 200 })
      // The only call is the refresh, and it is held open.
      return new Promise<Response>((r) => { answer = r })
    }))

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    expect(root.textContent).toContain('Report number 1')

    click('Refresh now')
    await settle()

    // Still there, and the line the link sat in says what is happening
    // rather than the list being replaced by a spinner.
    expect(root.textContent).toContain('Report number 1')
    expect(root.textContent).not.toContain('Loading past reports')
    expect(root.textContent).toContain('Checking with the city')

    answer(new Response(JSON.stringify({ reports: listOf(5) }), { status: 200 }))
    await settle()

    expect(root.textContent).toContain('Report number 5')
    expect(root.textContent).not.toContain('Checking with the city')
  })

  /*
    A report just filed is not in the copy on the phone, and that copy is a
    day fresh — so without this the reporter opens their reports and does not
    find the one they just sent, until tomorrow.

    Marked old rather than deleted: the list is still drawn at once, and the
    refresh that fetches the new report happens behind it.
  */
  it('marks the kept list old once the city has taken a report', async () => {
    await onThePhone(KEPT, Date.now() - 60_000)
    const { keptList } = await import('../mylist')
    expect((await keptList())?.at).toBeGreaterThan(0)

    act(() => render(<App />, root))
    await attachPhotos(await jpegPhoto())
    await fileAndRead()

    expect((await keptList())?.at).toBe(0)
    // The reports it already had are still there. Only the age changed.
    expect((await keptList())?.reports).toHaveLength(KEPT.length)
  })

  // Nobody who has not asked for one gets a database opened on their phone.
  // `keptList` would open one to answer, so this asks the browser instead.
  it('opens no database on a phone that keeps nothing', async () => {
    act(() => render(<App />, root))
    await attachPhotos(await jpegPhoto())
    await fileAndRead()
    await settle()

    expect(await indexedDB.databases()).toEqual([])
  })

  // A refresh nobody pressed stays silent when it fails. One the reporter
  // pressed cannot: otherwise the link did nothing they can see, and they
  // press it again.
  it('says a refresh the reporter asked for failed, and keeps the list', async () => {
    await onThePhone(listOf(3), Date.now() - 60_000)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      if (!String(input).endsWith('/api/reports')) return new Response('{}', { status: 200 })
      throw new TypeError('offline')
    }))

    act(() => render(<App />, root))
    click('My reports')
    await settle()
    click('Refresh now')
    await settle()

    expect(root.querySelector('[role="alert"]')).not.toBeNull()
    expect(root.textContent).toContain('Report number 1')
  })

  // A reporter who has not turned it on sees exactly what they always saw.
  it('changes nothing for a reporter who has not turned it on', async () => {
    const fetchMock = cityAnswering()
    vi.stubGlobal('fetch', fetchMock)

    act(() => render(<App />, root))
    click('My reports')
    await settle()

    expect(listCalls(fetchMock)).toBe(1)
    expect(root.textContent).toContain('Report number 1')
  })
})
