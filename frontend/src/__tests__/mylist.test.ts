// jsdom has no IndexedDB. This is the same API over memory.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { forgetList, keepingList, keepList, keptList, startKeeping, stopKeeping, STALE_AFTER } from '../mylist'
import type { Filed } from '../types'

const REPORTS: Filed[] = [
  {
    reference: '20260822133825088',
    title: 'Road damage: J. P. Laurel Avenue',
    description: 'A hole in the outer lane, about a metre across.',
    location: 'J. P. Laurel Avenue',
    status: 'ONGOING',
    filed: '2026-08-22 13:38:25',
    photos: ['https://reports.davaocity.gov.ph/x/1.jpg'],
  },
]

beforeEach(() => {
  localStorage.clear()
  globalThis.indexedDB = new IDBFactory()
})

describe('keeping the list on this phone', () => {
  // The rule saved.ts keeps, and the reason this is allowed to exist at all.
  it('is off until the reporter turns it on', () => {
    expect(keepingList()).toBe(false)
  })

  it('is on once they do, and off once they stop', async () => {
    startKeeping()
    expect(keepingList()).toBe(true)

    await stopKeeping()
    expect(keepingList()).toBe(false)
  })

  it('holds nothing until a list is written', async () => {
    startKeeping()
    expect(await keptList()).toBeNull()
  })

  it('gives back the reports it was given', async () => {
    await keepList(REPORTS, 1000)

    const kept = await keptList()
    expect(kept?.at).toBe(1000)
    expect(kept?.reports).toEqual(REPORTS)
  })

  it('replaces the list rather than adding to it', async () => {
    await keepList(REPORTS, 1000)
    await keepList([], 2000)

    const kept = await keptList()
    expect(kept?.reports).toEqual([])
    expect(kept?.at).toBe(2000)
  })

  // The half that makes the promise on the button true: turning it off is
  // not just a flag, it is the reports leaving the phone.
  it('deletes the reports when the reporter stops', async () => {
    startKeeping()
    await keepList(REPORTS, 1000)
    await stopKeeping()

    expect(await keptList()).toBeNull()
    expect(keepingList()).toBe(false)
  })

  it('deletes them on its own too', async () => {
    await keepList(REPORTS, 1000)
    await forgetList()

    expect(await keptList()).toBeNull()
  })

  // Written by a version of this site that kept something else.
  it('ignores a row that is not a list of reports', async () => {
    await keepList(REPORTS, 1000)
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('dvo-reports-list', 1)
      req.onsuccess = () => {
        const db = req.result
        const put = db.transaction('list', 'readwrite').objectStore('list').put({ id: 1, at: 'yesterday' })
        put.onsuccess = () => { db.close(); resolve() }
        put.onerror = () => reject(put.error)
      }
      req.onerror = () => reject(req.error)
    })

    expect(await keptList()).toBeNull()
  })

  // A day, because an office moves a report in days and every refresh is the
  // whole list again — see the note on STALE_AFTER.
  it('calls a list stale after a day', () => {
    expect(STALE_AFTER).toBe(24 * 60 * 60 * 1000)
  })
})
