import { afterEach, describe, expect, it, vi } from 'vitest'
import { askOpenStreetMap } from '../street'

afterEach(() => vi.unstubAllGlobals())

function reply(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status })))
}

describe('askOpenStreetMap', () => {
  // A Shell station on J. P. Laurel Avenue, not anyone's home.
  it('puts the barangay in the middle slot, from quarter', async () => {
    reply({
      display_name: 'Shell, J. P. Laurel Avenue, Agdao, Davao City, Davao del Sur, 8000, Philippines',
      address: {
        road: 'J. P. Laurel Avenue',
        neighbourhood: 'Kalayaan',
        quarter: 'Wilfredo C. Aquino',
        suburb: 'Agdao District',
        city: 'Davao City',
        postcode: '8000',
      },
    })

    const place = await askOpenStreetMap(7.0691, 125.6081)

    expect(place?.address).toBe('J. P. Laurel Avenue, Wilfredo C. Aquino, Davao City')
    expect(place?.street).toBe(true)
    expect(place?.in_davao).toBe(true)
    expect(place?.credit).toBe('© OpenStreetMap contributors')
  })

  it('falls back to suburb when there is no quarter', async () => {
    reply({
      address: {
        road: 'J. P. Laurel Avenue',
        suburb: 'Agdao District',
        city: 'Davao City',
        postcode: '8000',
      },
    })

    const place = await askOpenStreetMap(7.0691, 125.6081)

    expect(place?.address).toBe('J. P. Laurel Avenue, Agdao District, Davao City')
  })

  it('still names a place with no road, but says so is not a street', async () => {
    reply({
      address: {
        neighbourhood: 'Kalayaan',
        quarter: 'Wilfredo C. Aquino',
        city: 'Davao City',
        postcode: '8000',
      },
    })

    const place = await askOpenStreetMap(7.0691, 125.6081)

    expect(place?.address).toBe('Kalayaan, Wilfredo C. Aquino, Davao City')
    expect(place?.street).toBe(false)
  })

  it('has nothing to say when the reply carries no address at all', async () => {
    reply({ address: {} })

    expect(await askOpenStreetMap(7.0691, 125.6081)).toBeNull()
  })

  it('gives up quietly on a refusal', async () => {
    reply({}, 500)

    expect(await askOpenStreetMap(7.0691, 125.6081)).toBeNull()
  })

  it('does not mistake another city for Davao', async () => {
    reply({
      address: {
        road: 'Rizal Street',
        city: 'Manila',
        postcode: '1000',
      },
    })

    const place = await askOpenStreetMap(14.5995, 120.9842)

    expect(place?.in_davao).toBe(false)
  })

  it('asks for street-level detail with the address broken out', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ address: {} })))
    vi.stubGlobal('fetch', fetchMock)

    await askOpenStreetMap(7.0691, 125.6081)

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('zoom=18')
    expect(url).toContain('addressdetails=1')
  })
})
