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
