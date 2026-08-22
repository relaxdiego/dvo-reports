import { describe, expect, it } from 'vitest'
import { validate, MAX_PHOTOS } from '../validate'
import type { Draft } from '../types'

function draft(over: Partial<Draft> = {}): Draft {
  return {
    category: 'pothole',
    description: 'Deep pothole in the outer lane near the corner.',
    address: 'Quimpo Blvd',
    lat: null,
    lon: null,
    photos: [],
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

  it('accepts coordinates instead of an address', () => {
    expect(validate(draft({ address: '', lat: 7.0731, lon: 125.6128 }))).toBeNull()
  })

  it('needs a location of some kind', () => {
    expect(validate(draft({ address: '' }))).toMatch(/address/)
  })

  it('caps the number of photos', () => {
    const photos = Array.from(
      { length: MAX_PHOTOS + 1 },
      (_, i) => new File(['x'], `${i}.jpg`, { type: 'image/jpeg' }),
    )
    expect(validate(draft({ photos }))).toMatch(/at most/)
  })
})
