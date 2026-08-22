import { beforeEach, describe, expect, it } from 'vitest'
import { forget, liveSession, remember, rememberedEmail } from '../session'

beforeEach(() => localStorage.clear())

describe('the city session', () => {
  it('is absent before anyone signs in', () => {
    expect(liveSession()).toBeNull()
  })

  it('comes back with the address that earned it', () => {
    remember({ token: 'tk-1' }, 'someone@example.com')

    expect(liveSession()?.token).toBe('tk-1')
    expect(rememberedEmail()).toBe('someone@example.com')
  })

  it('is gone once the city says it has run out', () => {
    remember({ token: 'tk-1', expires: '2020-01-01T00:00:00Z' }, 'someone@example.com')

    expect(liveSession()).toBeNull()
  })

  // The reporter has to ask for a new code, not retype their address.
  it('keeps the address after the token is dropped', () => {
    remember({ token: 'tk-1' }, 'someone@example.com')
    forget()

    expect(liveSession()).toBeNull()
    expect(rememberedEmail()).toBe('someone@example.com')
  })

  it('survives a stored value that is not a session', () => {
    localStorage.setItem('dvo-reports.session', 'not json')

    expect(liveSession()).toBeNull()
  })
})
