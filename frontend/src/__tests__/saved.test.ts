/**
 * The reports kept on the phone when the city would not take them.
 *
 * jsdom has no IndexedDB, so these run against fake-indexeddb, which is the
 * same API over memory. Each test gets a new factory, because a database
 * carried between them would make the order of the file matter.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { dropReport, savedReports, saveReport } from '../saved'
import type { Draft } from '../types'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

function photo(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
}

function draft(over: Partial<Draft> = {}): Draft {
  return {
    category: 'garbage',
    description: 'Rubbish left on the pavement.',
    address: 'J. P. Laurel Avenue',
    lat: 7.09753,
    lon: 125.62229,
    photos: [photo('one.jpg')],
    ...over,
  }
}

describe('keeping a report on this phone', () => {
  it('gives back everything the form put in, photographs included', async () => {
    await saveReport(draft())

    const [kept] = await savedReports()
    expect(kept.category).toBe('garbage')
    expect(kept.description).toBe('Rubbish left on the pavement.')
    expect(kept.address).toBe('J. P. Laurel Avenue')
    expect(kept.lat).toBe(7.09753)
    expect(kept.lon).toBe(125.62229)
    expect(kept.photos).toHaveLength(1)
    expect(kept.photos[0].name).toBe('one.jpg')
    // The bytes, not only the name: a draft whose photographs came back
    // empty would send an empty report the day the city answered again.
    expect(await kept.photos[0].arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer)
  })

  // The pin is the reporter's to move, and a draft that forgot a nudge would
  // file the report at the place the camera guessed.
  it('keeps a pin the reporter moved, not the one the photo carried', async () => {
    await saveReport(draft({ lat: 7.1, lon: 125.6 }))

    const [kept] = await savedReports()
    expect([kept.lat, kept.lon]).toEqual([7.1, 125.6])
  })

  it('keeps each report apart', async () => {
    const first = await saveReport(draft({ description: 'The first one.' }))
    const second = await saveReport(draft({ description: 'The second one.' }))

    expect(second).not.toBe(first)
    expect(await savedReports()).toHaveLength(2)
  })

  // Saving the same report again is the reporter carrying on writing, not a
  // second report. Two cards for one problem is how a draft gets sent twice.
  it('writes over the report it was given, rather than adding another', async () => {
    const id = await saveReport(draft({ description: 'First go.' }))
    await saveReport(draft({ description: 'Said better.' }), id)

    const kept = await savedReports()
    expect(kept).toHaveLength(1)
    expect(kept[0].description).toBe('Said better.')
    expect(kept[0].id).toBe(id)
  })

  it('lists the newest first', async () => {
    await saveReport(draft({ description: 'Older.' }))
    await new Promise((r) => setTimeout(r, 5))
    await saveReport(draft({ description: 'Newer.' }))

    expect((await savedReports()).map((r) => r.description)).toEqual(['Newer.', 'Older.'])
  })

  it('forgets one the reporter threw away', async () => {
    const id = await saveReport(draft())
    await saveReport(draft({ description: 'Still wanted.' }))

    await dropReport(id)

    expect((await savedReports()).map((r) => r.description)).toEqual(['Still wanted.'])
  })

  /*
    A chip this build no longer has cannot be drawn as pressed, and would
    leave the reporter unable to see or change what the report was filed
    under. The words and the photographs are worth more than the chip.
  */
  it('drops a category this build no longer has, and keeps the rest', async () => {
    await saveReport(draft({ category: 'sky-writing' }))

    const [kept] = await savedReports()
    expect(kept.category).toBe('')
    expect(kept.description).toBe('Rubbish left on the pavement.')
    expect(kept.photos).toHaveLength(1)
  })

  it('says so rather than losing the report, when there is nowhere to put it', async () => {
    // A browser with IndexedDB switched off, which is a private window in
    // some of them. The reporter is about to close the page believing their
    // photographs are safe, so this one cannot fail quietly.
    const real = globalThis.indexedDB
    // @ts-expect-error the point of the test is the browser that has none
    delete globalThis.indexedDB

    await expect(saveReport(draft())).rejects.toThrow(/will not let this site keep/)

    globalThis.indexedDB = real
  })
})
