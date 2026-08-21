import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { submitReport, currentPosition } from './api'
import { validate, MAX_PHOTOS } from './validate'
import { CATEGORIES, CATEGORY_LABELS, type Draft, type Receipt } from './types'
import './app.css'

const emptyDraft: Draft = {
  category: '',
  description: '',
  address: '',
  contact: '',
  lat: null,
  lon: null,
  photos: [],
}

export function App() {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value })),
    [],
  )

  if (receipt) {
    return <Sent receipt={receipt} onAgain={() => { setReceipt(null); setDraft(emptyDraft) }} />
  }

  const onSubmit = async (e: Event) => {
    e.preventDefault()
    const problem = validate(draft)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSending(true)
    try {
      setReceipt(await submitReport(draft))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSending(false)
    }
  }

  return (
    <main>
      <Header />
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={sending}>
          <legend>What is the problem?</legend>
          <div class="chips">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                class={draft.category === c ? 'chip on' : 'chip'}
                aria-pressed={draft.category === c}
                onClick={() => set('category', c)}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          <label for="description">Describe it</label>
          <textarea
            id="description"
            rows={4}
            placeholder="A deep pothole in the outer lane, about 30 cm across."
            value={draft.description}
            onInput={(e) => set('description', (e.target as HTMLTextAreaElement).value)}
          />

          <LocationField draft={draft} set={set} />
          <PhotoField photos={draft.photos} onChange={(p) => set('photos', p)} />

          <label for="contact">Your email or phone (optional)</label>
          <input
            id="contact"
            type="text"
            inputMode="email"
            autoComplete="email"
            value={draft.contact}
            onInput={(e) => set('contact', (e.target as HTMLInputElement).value)}
          />
        </fieldset>

        {error && <p class="error" role="alert">{error}</p>}

        <button class="primary" type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send report'}
        </button>
      </form>
      <Footer />
    </main>
  )
}

function Header() {
  return (
    <header>
      <h1>Davao City issue report</h1>
      <p class="unofficial">
        Unofficial. This is a community-run front end for{' '}
        <a href="https://reports.davaocity.gov.ph">reports.davaocity.gov.ph</a>. It is not run
        by the city government. Your report is passed on to that site and is not stored here.
      </p>
    </header>
  )
}

function LocationField({
  draft,
  set,
}: {
  draft: Draft
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

  const locate = async () => {
    setLocating(true)
    setStatus(null)
    try {
      const { lat, lon } = await currentPosition()
      set('lat', lat)
      set('lon', lon)
      setStatus(`Using your location (${lat}, ${lon}).`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not get your location.')
    } finally {
      setLocating(false)
    }
  }

  return (
    <>
      <label for="address">Where is it?</label>
      <input
        id="address"
        type="text"
        placeholder="Street, landmark, barangay"
        autoComplete="street-address"
        value={draft.address}
        onInput={(e) => set('address', (e.target as HTMLInputElement).value)}
      />
      <button type="button" class="secondary" onClick={locate} disabled={locating}>
        {locating ? 'Locating…' : 'Use my location'}
      </button>
      {status && <p class="hint">{status}</p>}
    </>
  )
}

function PhotoField({ photos, onChange }: { photos: File[]; onChange: (p: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)

  const add = (e: Event) => {
    const picked = Array.from((e.target as HTMLInputElement).files ?? [])
    onChange([...photos, ...picked].slice(0, MAX_PHOTOS))
    // Let the same file be picked again after it is removed.
    if (input.current) input.current.value = ''
  }

  return (
    <>
      <label for="photos">Photos (up to {MAX_PHOTOS})</label>
      <input
        ref={input}
        id="photos"
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        onChange={add}
      />
      {photos.length > 0 && (
        <ul class="thumbs">
          {photos.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <Thumb file={f} />
              <button
                type="button"
                class="remove"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(photos.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Thumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img src={url} alt="" />
}

function Sent({ receipt, onAgain }: { receipt: Receipt; onAgain: () => void }) {
  return (
    <main>
      <header>
        <h1>Report sent</h1>
      </header>
      <p class="reference">
        Reference number: <strong>{receipt.reference}</strong>
      </p>
      <p class="hint">Write this down. It is how you follow up with the city.</p>
      {receipt.track_url && (
        <p>
          <a href={receipt.track_url}>Track this report</a>
        </p>
      )}
      <button class="primary" type="button" onClick={onAgain}>
        Report something else
      </button>
      <Footer />
    </main>
  )
}

function Footer() {
  return (
    <footer>
      <a href="https://github.com/relaxdiego/dvo-reports">Source code</a>
    </footer>
  )
}
