import { beforeEach, describe, expect, it } from 'vitest'
import { forgetDraft, saveDraft, savedDraft } from '../draft'

beforeEach(() => sessionStorage.clear())

describe('the half-written report', () => {
  it('is nothing until something is typed', () => {
    expect(savedDraft()).toBeNull()
  })

  it('comes back as it was left', () => {
    saveDraft({ category: 'Pothole (Lubak)', description: 'Deep hole by the gate.' })

    expect(savedDraft()).toEqual({
      category: 'Pothole (Lubak)',
      description: 'Deep hole by the gate.',
    })
  })

  // Nothing typed is nothing worth keeping, and a reporter who clears the
  // form should not leave an empty draft behind on the phone.
  it('is dropped when the form is emptied again', () => {
    saveDraft({ category: 'Street light', description: 'Out for a week.' })
    saveDraft({ category: '', description: '' })

    expect(savedDraft()).toBeNull()
    expect(sessionStorage.getItem('dvo-reports.draft')).toBeNull()
  })

  it('is dropped when it is forgotten', () => {
    saveDraft({ category: 'Street light', description: 'Out for a week.' })
    forgetDraft()

    expect(savedDraft()).toBeNull()
  })

  // Written by some older version of this site, or by something else on the
  // same host. Restoring half of it would put the reporter in a form they
  // did not fill in.
  it('ignores anything that is not a draft', () => {
    sessionStorage.setItem('dvo-reports.draft', '{"category":"Pothole"}')
    expect(savedDraft()).toBeNull()

    sessionStorage.setItem('dvo-reports.draft', 'not json at all')
    expect(savedDraft()).toBeNull()
  })
})
