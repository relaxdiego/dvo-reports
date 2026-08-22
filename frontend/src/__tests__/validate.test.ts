import { describe, expect, it } from 'vitest'
import { validate, MAX_PHOTOS } from '../validate'
import type { Draft } from '../types'

const photo = (name = 'a.jpg') => new File(['x'], name, { type: 'image/jpeg' })

function draft(over: Partial<Draft> = {}): Draft {
  return {
    category: 'pothole',
    description: 'Deep pothole in the outer lane near the corner.',
    address: 'Quimpo Boulevard, Talomo, Davao City',
    lat: 7.0731,
    lon: 125.6128,
    photos: [photo()],
    ...over,
  }
}

describe('validate', () => {
  it('accepts a complete draft', () => {
    expect(validate(draft())).toBeNull()
  })

  it('needs a category', () => {
    expect(validate(draft({ category: '' }))).toMatch(/kind of problem/)
  })

  it('needs a description of some length', () => {
    expect(validate(draft({ description: 'hole' }))).toMatch(/at least/)
  })

  it('rejects an over-long description', () => {
    expect(validate(draft({ description: 'x'.repeat(2001) }))).toMatch(/too long/)
  })

  // A report the city can act on shows the problem.
  it('needs a photo', () => {
    expect(validate(draft({ photos: [] }))).toMatch(/at least one photo/)
  })

  it('caps the number of photos', () => {
    const photos = Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => photo(`${i}.jpg`))
    expect(validate(draft({ photos }))).toMatch(/at most/)
  })

  // The place comes from the photo when the camera recorded one, and from
  // the reporter when it did not. Either way it has to end up set.
  it('needs a place', () => {
    expect(validate(draft({ lat: null, lon: null }))).toMatch(/where they were taken/)
  })

  // The place is the photographs'. A draft that has photos but no place
  // should not be reachable, because a photo without one is never accepted.
  it('takes the place the photos gave it', () => {
    expect(validate(draft({ lat: 7.1, lon: 125.6 }))).toBeNull()
  })
})
