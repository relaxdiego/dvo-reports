import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ApiError, currentPosition, myReports, reportHistory, sendCode, submitReport, verifyCode } from './api'
import { forget, liveSession, remember, rememberedEmail } from './session'
import { validate, MAX_PHOTOS } from './validate'
import {
  CATEGORIES,
  CATEGORY_LABELS,
  STATUS_MEANING,
  type Draft,
  type Filed,
  type History,
  type Receipt,
} from './types'
import './app.css'

const CITY_SITE = 'https://reports.davaocity.gov.ph'

const emptyDraft: Draft = {
  category: '',
  description: '',
  address: '',
  lat: null,
  lon: null,
  photos: [],
}

type Tab = 'report' | 'past'

/**
 * Runs something that needs the city's session, asking the reporter for a
 * code when there is none. Returns null if they closed the sign-in instead.
 */
type WithSession = <T>(why: string, fn: (token: string) => Promise<T>) => Promise<T | null>

/**
 * What the past reports tab is holding. It lives up here so that moving
 * between the tabs does not throw the list away and ask the city for it
 * again: the reports are only fetched when the reporter asks for them, or
 * when the page itself is loaded afresh.
 */
type Past =
  | { at: 'unopened' }
  | { at: 'loading'; step: string }
  | { at: 'ready'; reports: Filed[] }
  /** The reporter closed the sign-in. Do not keep asking. */
  | { at: 'declined' }
  | { at: 'error'; error: string }

/** A pending request for a session. resolve carries the token, or null. */
interface Ask {
  why: string
  resolve: (token: string | null) => void
}

export function App() {
  const [tab, setTab] = useState<Tab>('report')
  const [ask, setAsk] = useState<Ask | null>(null)

  // The stored session is the source of truth, not a state variable: it
  // outlives the page, and reading it here keeps the two from drifting.
  const requestSession = useCallback((why: string): Promise<string | null> => {
    const live = liveSession()
    if (live) return Promise.resolve(live.token)
    return new Promise((resolve) => setAsk({ why, resolve }))
  }, [])

  const withSession = useCallback<WithSession>(
    async (why, fn) => {
      let token = await requestSession(why)
      if (token === null) return null
      try {
        return await fn(token)
      } catch (err) {
        // The city's session can die while a reporter is still typing. Ask
        // for a new code and do the same thing once more.
        if (!(err instanceof ApiError) || !err.expired) throw err
        forget()
        token = await requestSession('Your session with the city’s site has expired. Ask for a new code.')
        if (token === null) return null
        return await fn(token)
      }
    },
    [requestSession],
  )

  const [past, setPast] = useState<Past>({ at: 'unopened' })

  const loadPast = useCallback(async () => {
    setPast({ at: 'loading', step: 'Asking the city’s site for your reports.' })
    // The city's site can take its time. Saying so beats a spinner that
    // looks the same at one second and at twenty.
    const slow = setTimeout(
      () => setPast((p) => (p.at === 'loading' ? { at: 'loading', step: 'The city’s site is slow to answer. Still waiting.' } : p)),
      5000,
    )
    try {
      const list = await withSession(
        'Your reports are held by the city, so seeing them needs a code first.',
        (token) => myReports(token),
      )
      setPast(list === null ? { at: 'declined' } : { at: 'ready', reports: newestFirst(list) })
    } catch (err) {
      setPast({ at: 'error', error: messageOf(err) })
    } finally {
      clearTimeout(slow)
    }
  }, [withSession])

  const swipe = useSwipe((dir) => setTab(dir > 0 ? 'past' : 'report'))

  return (
    <main>
      <Header />
      <Tabs tab={tab} onChange={setTab} />
      <div class="tabbody" {...swipe}>
        {tab === 'report' ? (
          <ReportTab withSession={withSession} />
        ) : (
          <PastTab past={past} onLoad={loadPast} withSession={withSession} />
        )}
      </div>
      {ask && (
        <SignIn
          why={ask.why}
          onDone={(token) => {
            ask.resolve(token)
            setAsk(null)
          }}
        />
      )}
      <Footer />
    </main>
  )
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class={tab === 'report' ? 'tab on' : 'tab'}
        aria-selected={tab === 'report'}
        onClick={() => onChange('report')}
      >
        Report a problem
      </button>
      <button
        type="button"
        role="tab"
        class={tab === 'past' ? 'tab on' : 'tab'}
        aria-selected={tab === 'past'}
        onClick={() => onChange('past')}
      >
        My reports
      </button>
    </div>
  )
}

/**
 * Left and right swipes, for moving between the tabs on a phone. A swipe has
 * to be clearly sideways, so that scrolling the page does not switch tabs.
 */
function useSwipe(onSwipe: (dir: -1 | 1) => void) {
  const from = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0]
      from.current = { x: t.clientX, y: t.clientY }
    },
    onTouchEnd: (e: TouchEvent) => {
      const start = from.current
      from.current = null
      if (!start) return
      const t = e.changedTouches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return
      onSwipe(dx < 0 ? 1 : -1)
    },
  }
}

function ReportTab({ withSession }: { withSession: WithSession }) {
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
      const sent = await withSession(
        'The city only accepts a report from a registered reporter, so it needs a code first.',
        (token) => submitReport(draft, token),
      )
      if (sent) setReceipt(sent)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSending(false)
    }
  }

  return (
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
      </fieldset>

      {error && <p class="error" role="alert">{error}</p>}

      <button class="primary" type="submit" disabled={sending}>
        {sending ? 'Sending…' : 'Send report'}
      </button>
    </form>
  )
}

/**
 * How many reports are put on the page at once. The city sends every report
 * an account has in one reply — there is no page or limit to ask it for — so
 * this only bounds how many rows the browser builds, not what is fetched.
 */
const PAGE = 20

function PastTab({
  past,
  onLoad,
  withSession,
}: {
  past: Past
  onLoad: () => Promise<void>
  withSession: WithSession
}) {
  const [query, setQuery] = useState('')
  const [showing, setShowing] = useState(PAGE)

  // Only the first time the tab is opened. After that the list is reloaded
  // when the reporter asks for it, or when the page is loaded again.
  useEffect(() => {
    if (past.at === 'unopened') void onLoad()
  }, [past.at, onLoad])

  const reports = past.at === 'ready' ? past.reports : []
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return reports
    return reports.filter(
      (r) =>
        r.reference.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q),
    )
  }, [reports, query])

  // A new search starts at the top of its own results.
  useEffect(() => setShowing(PAGE), [query])

  const more = useCallback(() => setShowing((n) => n + PAGE), [])
  const sentinel = useEndOfList(more, showing < matching.length)

  if (past.at === 'loading') return <Loading step={past.step} />
  if (past.at === 'error') {
    return (
      <>
        <p class="error" role="alert">{past.error}</p>
        <button class="secondary" type="button" onClick={() => void onLoad()}>Try again</button>
      </>
    )
  }
  if (past.at === 'declined') {
    return (
      <>
        <p class="hint">These come from the city's own records, so this needs a code from them.</p>
        <button class="primary" type="button" onClick={() => void onLoad()}>Show my reports</button>
      </>
    )
  }
  if (past.at === 'unopened') return <Loading step="Starting." />
  if (reports.length === 0) {
    return (
      <>
        <p class="hint">The city has no reports under this account yet.</p>
        <Refresh onClick={() => void onLoad()} />
      </>
    )
  }

  return (
    <>
      <div class="listtop">
        <input
          id="search"
          type="search"
          aria-label="Search your reports"
          placeholder="Number, subject, or status"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <Refresh onClick={() => void onLoad()} />
      </div>
      <ul class="reports">
        {matching.slice(0, showing).map((r) => (
          <FiledReport key={r.reference} report={r} withSession={withSession} />
        ))}
        {showing < matching.length && <li class="sentinel" ref={sentinel} aria-hidden="true" />}
      </ul>
      {matching.length === 0 && <p class="hint">Nothing matches “{query}”.</p>}
      <p class="meta">
        {matching.length === reports.length
          ? `${reports.length} ${reports.length === 1 ? 'report' : 'reports'}`
          : `${matching.length} of ${reports.length} reports`}
      </p>
      <Refresh onClick={() => void onLoad()} />
    </>
  )
}

/**
 * Puts the next page on screen when the end of the list comes into view. The
 * reports are already here; this only decides how many are drawn.
 */
function useEndOfList(onReach: () => void, armed: boolean) {
  const node = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const el = node.current
    // A browser without IntersectionObserver still gets every report: the
    // pages just grow when the reporter searches, not when they scroll.
    if (!armed || !el || typeof IntersectionObserver === 'undefined') return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onReach()
    })
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [armed, onReach])
  return node
}

function Refresh({ onClick }: { onClick: () => void }) {
  return (
    <button class="iconbutton" type="button" onClick={onClick} aria-label="Refresh" title="Refresh">
      <span aria-hidden="true">⟳</span>
    </button>
  )
}

/**
 * Something moving, so that a slow reply does not read as a page that has
 * stopped working, and a line saying what is being waited for.
 */
function Loading({ step }: { step: string }) {
  return (
    <p class="loading" role="status">
      <span class="spinner" aria-hidden="true" />
      Loading past reports…
      <span class="step">{step}</span>
    </p>
  )
}

function FiledReport({ report, withSession }: { report: Filed; withSession: WithSession }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<History | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The history is a second call to the city, so it is only made for the
  // report the reporter actually opened, and only once.
  useEffect(() => {
    if (!open || history || error) return
    let dropped = false
    void (async () => {
      try {
        const h = await withSession('Reading this report needs a code from the city’s site.', (token) =>
          reportHistory(report.reference, token),
        )
        if (!dropped && h) setHistory(h)
      } catch (err) {
        if (!dropped) setError(messageOf(err))
      }
    })()
    return () => { dropped = true }
  }, [open, history, error, report.reference, withSession])

  return (
    <li class="report">
      <button type="button" class="reporthead" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="status">{statusWord(report.status)}</span>
        <span class="title">{report.title}</span>
        <span class="meta">
          {report.reference} · {whenText(report.filed)}
        </span>
      </button>
      {open && (
        <div class="reportbody">
          <p class="hint">{STATUS_MEANING[report.status] ?? ''}</p>
          <p>{report.description}</p>
          {report.location && <p class="hint">Where: {report.location}</p>}
          {report.photos && report.photos.length > 0 && (
            <ul class="thumbs">
              {report.photos.map((src) => (
                <li key={src}>
                  <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="" loading="lazy" /></a>
                </li>
              ))}
            </ul>
          )}
          {error && <p class="error" role="alert">{error}</p>}
          {!history && !error && <p class="hint">Reading what happened…</p>}
          {history && <Progress history={history} />}
        </div>
      )}
    </li>
  )
}

function Progress({ history }: { history: History }) {
  return (
    <>
      {history.note && <p class="note">The city says: {history.note}</p>}
      {history.city_reference && (
        <p class="hint">The city also files this one as reference {history.city_reference}.</p>
      )}
      <ol class="steps">
        {history.steps.map((s, i) => (
          <li key={`${s.status}-${s.at}-${i}`}>
            <strong>{statusWord(s.status)}</strong>
            {s.office ? ` · ${s.office}` : ''}
            <span class="meta"> {whenText(s.at)}</span>
          </li>
        ))}
      </ol>
      {history.resolutions?.map((r) => (
        <p key={r.office} class="hint">
          {r.office} answered.
          {r.files?.map((f, i) => (
            <span key={f}>
              {' '}
              <a href={f} target="_blank" rel="noreferrer">File {i + 1}</a>
            </span>
          ))}
        </p>
      ))}
    </>
  )
}

/**
 * The e-mail and code steps. The city sends a one-time code to a registered
 * address; this app relays both and keeps the token in this browser only.
 */
function SignIn({ why, onDone }: { why: string; onDone: (token: string | null) => void }) {
  const [email, setEmail] = useState(rememberedEmail())
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = async (e: Event) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await sendCode(email.trim())
      setStage('code')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e: Event) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await verifyCode(email.trim(), code.trim())
      remember(session, email.trim())
      onDone(session.token)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Sign in with the city">
      <form class="sheetbody" onSubmit={stage === 'email' ? ask : confirm} noValidate>
        <h2>The city needs to know who is reporting</h2>
        <p class="hint">{why}</p>
        <fieldset disabled={busy}>
          <label for="email">Your e-mail address</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            disabled={stage === 'code'}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
          {stage === 'email' && (
            <p class="hint">
              The city sends the code by text message, to the phone number registered with this
              address. Have that phone with you.
            </p>
          )}
          {stage === 'code' && (
            <>
              <label for="code">The six-digit code</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onInput={(e) => setCode((e.target as HTMLInputElement).value)}
              />
              <p class="hint">
                The city has sent a text message to the phone number registered with that address.
                The code runs out after a few minutes.
              </p>
            </>
          )}
        </fieldset>

        {error && <p class="error" role="alert">{error}</p>}

        <button class="primary" type="submit" disabled={busy || !email.trim() || (stage === 'code' && !code.trim())}>
          {busy ? 'Waiting…' : stage === 'email' ? 'Send me a code' : 'Sign in'}
        </button>
        {stage === 'code' && (
          <button class="secondary" type="button" disabled={busy} onClick={() => { setStage('email'); setCode('') }}>
            Use a different address
          </button>
        )}
        <button class="secondary" type="button" onClick={() => onDone(null)}>Not now</button>
        <p class="hint">
          You need an account on <a href={CITY_SITE}>the city's own site</a> first. This app cannot
          register you, and never sees your password.
        </p>
      </form>
    </div>
  )
}

function Header() {
  return (
    <header>
      <h1>Davao City issue report</h1>
      <p class="unofficial">
        Unofficial. This is a community-run front end for{' '}
        <a href={CITY_SITE}>reports.davaocity.gov.ph</a>. It is not run
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
      {/*
        No `capture` attribute on purpose. With it, a phone opens the camera
        straight away and the reporter cannot reach the photos already on the
        phone. Without it, the phone offers both, and iOS also honours
        `multiple`.
      */}
      <input
        ref={input}
        id="photos"
        type="file"
        accept="image/*"
        multiple
        onChange={add}
      />
      <p class="hint">Take a new photo, or pick ones already on your phone.</p>
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
    <>
      <h2>Report sent</h2>
      <p class="reference">
        Reference number: <strong>{receipt.reference}</strong>
      </p>
      <p class="hint">Write this down. It is how you follow up with the city.</p>
      {receipt.warning && <p class="note" role="alert">{receipt.warning}</p>}
      {receipt.track_url && (
        <p>
          <a href={receipt.track_url}>Track this report</a>
        </p>
      )}
      <button class="primary" type="button" onClick={onAgain}>
        Report something else
      </button>
    </>
  )
}

function Footer() {
  return (
    <footer>
      <a href="https://github.com/relaxdiego/dvo-reports">Source code</a>
    </footer>
  )
}

/** Newest first, the way the city's own tracking page orders them. */
function newestFirst(list: Filed[]): Filed[] {
  return [...list].sort((a, b) => {
    const d = time(b.filed) - time(a.filed)
    return d !== 0 ? d : b.reference.localeCompare(a.reference)
  })
}

/**
 * The city writes a timestamp as "2026-03-14 16:55:59": a space where the
 * browser wants a T, and no time zone. Some browsers refuse that outright, so
 * it is repaired here and read as local time, which is what the city means.
 */
function cityTime(s: string): number {
  return Date.parse(s.trim().replace(' ', 'T'))
}

function time(s: string): number {
  const t = cityTime(s)
  return Number.isNaN(t) ? 0 : t
}

/**
 * A timestamp in a layout no browser can read is shown as the city wrote it,
 * rather than as "Invalid Date".
 */
function whenText(s: string): string {
  const t = cityTime(s)
  if (Number.isNaN(t)) return s
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/** The city writes FORRESUBMISSION as one word; a reporter reads two. */
function statusWord(status: string): string {
  return status.replace(/^FOR/, 'FOR ')
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.'
}
