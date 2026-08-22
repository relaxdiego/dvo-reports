import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ApiError, lookupPlace, myReports, reportHistory, sendCode, submitReport, verifyCode, type Place as Street } from './api'
import { forget, liveSession, remember, rememberedEmail } from './session'
import { validate, MAX_PHOTOS } from './validate'
import { osmLink, placeOfPhotos, readSnapshot, type Place, type Snapshot } from './exif'
import { Disclaimer } from './disclaimer'
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

/**
 * An error the reporter can put away. Each one names something they can do
 * about it, and once they have done it the message is only in the way — of
 * the photo rows it sits above, or of the button it sits under. The cross
 * clears whatever state put it there, so it does not come back until the
 * thing goes wrong again.
 */
function ErrorMessage({
  onDismiss,
  children,
}: {
  onDismiss: () => void
  children: ComponentChildren
}) {
  return (
    <p class="error" role="alert">
      {children}
      <button type="button" class="dismiss" aria-label="Dismiss this message" onClick={onDismiss}>
        {/* The cross is decoration; the button's own label is what is read out. */}
        <span aria-hidden="true">×</span>
      </button>
    </p>
  )
}

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
  // The disclaimer is not a page anyone can link to: the city's terms are a
  // box on its front page, and this site's are its own. Both are carried
  // here and opened over the form. See disclaimer.tsx. It lives up here
  // because the header opens it and so does the line beside the send
  // button.
  const [showDisclaimer, setShowDisclaimer] = useState(false)
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

  return (
    <main>
      {__ENVIRONMENT__ !== 'production' && <NotTheRealSite />}
      <Header onDisclaimer={() => setShowDisclaimer(true)} />
      <Tabs tab={tab} onChange={setTab} />
      {tab === 'report' ? (
        <ReportTab withSession={withSession} onDisclaimer={() => setShowDisclaimer(true)} />
      ) : (
        <PastTab past={past} onLoad={loadPast} withSession={withSession} />
      )}
      {ask && (
        <SignIn
          why={ask.why}
          onDone={(token) => {
            ask.resolve(token)
            setAsk(null)
          }}
        />
      )}
      {showDisclaimer && <Disclaimer onClose={() => setShowDisclaimer(false)} />}
      <footer class="build">{__BUILD_TIME__} {__BUILD_SHA__}</footer>
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

function ReportTab({
  withSession,
  onDisclaimer,
}: {
  withSession: WithSession
  onDisclaimer: () => void
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value })),
    [],
  )

  // Read up here, not in the row that shows it: the location field below
  // starts its pin from these places.
  const facts = usePhotoFacts(draft.photos)
  const fromPhotos = useMemo(
    () => placeOfPhotos(draft.photos.map((f) => facts.get(f) ?? null)),
    [draft.photos, facts],
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
        <div class={draft.category ? 'chips picked' : 'chips'}>
          {CATEGORIES.map((c) => {
            const on = draft.category === c
            return (
              <button
                key={c}
                type="button"
                class={on ? 'chip on' : 'chip'}
                aria-pressed={on}
                onClick={() => set('category', on ? '' : c)}
              >
                {CATEGORY_LABELS[c]}
                {on && (
                  <span class="x" aria-hidden="true">
                    &times;
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <label for="description">Describe it</label>
        <textarea
          id="description"
          rows={4}
          placeholder="Tap to add a description."
          value={draft.description}
          onInput={(e) => set('description', (e.target as HTMLTextAreaElement).value)}
        />

        <PhotoField photos={draft.photos} facts={facts} onChange={(p) => set('photos', p)} />
        <LocationField draft={draft} set={set} fromPhotos={fromPhotos} />
      </fieldset>

      {error && <ErrorMessage onDismiss={() => setError(null)}>{error}</ErrorMessage>}

      {/*
        The other half of the header's notice, worded the same, above the
        button rather than below it: the eye travels down to the button and
        stops there, and on a phone anything under it can be off the screen.
        See the note in the header before changing this wording.
      */}
      <p class="terms">
        Sending a report means you agree to the city's terms — see the{' '}
        <button type="button" class="linky" onClick={onDisclaimer}>
          disclaimer
        </button>
        .
      </p>
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
  /*
    Put away rather than cleared: the error is what stops the effect below
    asking the city again, so forgetting it would send the same failing
    request the moment the message was dismissed.
  */
  const [hidden, setHidden] = useState(false)

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
          {error && !hidden && <ErrorMessage onDismiss={() => setHidden(true)}>{error}</ErrorMessage>}
          {!history && !error && (
            <p class="hint waiting" role="status">
              <span class="spinner" aria-hidden="true" />
              Reading what happened…
            </p>
          )}
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

        {error && <ErrorMessage onDismiss={() => setError(null)}>{error}</ErrorMessage>}

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

/**
 * A bar saying this build is not the real site.
 *
 * Staging runs `upstream.NoSubmit`, which does everything a real submission
 * does except file the report. Without this the page is production to the
 * eye, so a report can be written, sent, and lost. The reference number does
 * say nothing was filed, but only after all that work. This says it first.
 *
 * It is never in what production serves: `__ENVIRONMENT__` is a build-time
 * constant, so the comparison above is `"production" !== "production"` there
 * and the minifier drops this and the branch that calls it.
 */
function NotTheRealSite() {
  return (
    <p class="testbanner">
      <strong>{__ENVIRONMENT__}</strong> — a practice copy of this site. A report sent from here is
      not filed with the city.
    </p>
  )
}

function Header({ onDisclaimer }: { onDisclaimer: () => void }) {
  return (
    <header>
      <h1>Davao City issue report</h1>
      {/*
        On the page itself, not only inside the notice below. Whoever needs
        this is the last person who would open an optional pop-up to find
        it. A tel: link opens the dialer with the number in it; both iOS and
        Android still make the caller press to connect.
      */}
      <p class="emergencyline">
        For emergencies, <strong><a href="tel:911">call 911</a></strong> instead.
      </p>
      {/*
        Short enough to be read rather than skipped past. Two things have to
        survive being skimmed: that nobody official is behind this, and that
        sending binds the reporter to the city's terms — on the city's own
        site that is a button they press, so it cannot live only behind a
        link nobody opens. The rest is the disclaimer page.

        The terms half is written twice, like the emergency line: once here,
        and once beside the send button, because this header is scrolled off
        the screen by the time anyone presses it. Change one and change the
        other.
      */}
      <p class="unofficial">
        Unofficial site, not run by or connected to the city government. Volunteers built it to
        send your report to <a href={CITY_SITE}>reports.davaocity.gov.ph</a>. Use at your own
        risk. Sending a report means you agree to the city's terms — see the{' '}
        <button type="button" class="linky" onClick={onDisclaimer}>
          disclaimer
        </button>
        .
      </p>
    </header>
  )
}

/**
 * The map is a few tens of kilobytes of Leaflet, and a reporter who has
 * attached nothing has no place to draw. So it is fetched the moment there is
 * one, and never before.
 *
 * Both the map on the form and the one a photo's coordinates open come from
 * that one chunk, so whichever is wanted first pays for it and the second is
 * immediate.
 */
type MapModule = typeof import('./map')

function useMapChunk() {
  const [module, setModule] = useState<MapModule | null>(null)
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  const open = useCallback(async () => {
    setOpening(true)
    try {
      setModule(await import('./map'))
    } catch {
      setFailed(true)
    } finally {
      setOpening(false)
    }
  }, [])

  const close = useCallback(() => setModule(null), [])
  return { module, opening, failed, open, close }
}

function LocationField({
  draft,
  set,
  fromPhotos,
}: {
  draft: Draft
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  /** Where the attached photos say the problem is. */
  fromPhotos: Place | null
}) {
  const [street, setStreet] = useState<Street | null>(null)
  const [naming, setNaming] = useState(false)
  const map = useMapChunk()
  const MapHere = map.module?.MapHere

  // The place is the photographs' to give, and nobody's to type. Every photo
  // attached carries one, because one that does not is turned away in the
  // field above, so the pin is simply where they were taken. It follows them
  // as they are added and removed, and goes when the last one does.
  useEffect(() => {
    set('lat', fromPhotos?.lat ?? null)
    set('lon', fromPhotos?.lon ?? null)
  }, [fromPhotos, set])

  const placed = draft.lat !== null && draft.lon !== null
  const at = placed ? { lat: draft.lat as number, lon: draft.lon as number } : null

  // Leaflet is fetched once there is a place to draw, not on first load: a
  // reporter who has attached nothing never asks for it.
  useEffect(() => {
    if (!placed || map.module || map.opening || map.failed) return
    void map.open()
  }, [placed, map.module, map.opening, map.failed, map.open])

  // The city's own form fills its location box from whatever the pin sits
  // on, so this one does too. The answer is shown rather than hidden: it is
  // what a city worker will read, and the reporter can see it is wrong
  // before anybody is sent to the wrong street.
  const lat = draft.lat
  const lon = draft.lon
  useEffect(() => {
    if (lat === null || lon === null) {
      setStreet(null)
      set('address', '')
      return
    }
    let dropped = false
    setNaming(true)
    void lookupPlace(lat, lon).then((found) => {
      if (dropped) return
      setNaming(false)
      setStreet(found)
      set('address', found?.address ?? '')
    })
    return () => { dropped = true }
  }, [lat, lon, set])

  return (
    <>
      {/*
        Nothing here until there is a photo. The pin comes off the
        photograph, so before one is attached this section has no map to draw
        and nothing to say that the photo field has not already said.
      */}
      {at && <label>Location</label>}

      {at && MapHere && <MapHere key={`${at.lat},${at.lon}`} at={at} />}
      {at && !MapHere && !map.failed && (
        <p class="hint waiting" role="status">
          <span class="spinner" aria-hidden="true" />
          Drawing the map…
        </p>
      )}
      {at && naming && (
        <p class="hint waiting" role="status">
          <span class="spinner" aria-hidden="true" />
          Looking up the street…
        </p>
      )}
      {at && !naming && street?.address && <p class="street">{street.address}</p>}
      {at && !naming && street && !street.in_davao && (
        <p class="note" role="alert">
          This looks like it is outside Davao City. The city's own site turns away a report from
          outside the city, so this one may not be accepted. Check that you attached the right
          photos.
        </p>
      )}
      {/*
        Nothing is said about a pin that is where it should be. The map shows
        it, and the street under it is named above. The one thing the map
        cannot show is photographs that disagree with each other, so that is
        the only case that still gets a sentence.
      */}
      {at && fromPhotos?.spread && (
        <p class="hint">
          Your photos were taken in different places, so the report goes to the first one. Take out
          the photos that belong somewhere else.
        </p>
      )}

      {/*
        A map that will not load costs the reporter nothing now: the place is
        already on the report, and this only says why the picture of it is
        missing.
      */}
      {at && map.failed && (
        <p class="hint">
          The map could not be drawn. The place your photos recorded is still on the report.
        </p>
      )}
    </>
  )
}

/** True when a photo says where it was taken, which is what lets it in. */
function carriesPlace(snap: Snapshot | null): boolean {
  return snap !== null && snap.lat !== null && snap.lon !== null
}

/** What each attached photo says about itself. Missing until it is read. */
type Facts = Map<File, Snapshot | null>

/**
 * Reads the date and place out of each attached photo, once per file. A
 * photo already read is not read again when another is added or removed, and
 * a photo taken out is forgotten.
 */
function usePhotoFacts(photos: File[]): Facts {
  const read = useRef<Facts>(new Map())
  const [facts, setFacts] = useState<Facts>(read.current)

  useEffect(() => {
    let dropped = false
    void Promise.all(
      photos.map(async (f) => {
        if (!read.current.has(f)) read.current.set(f, await readSnapshot(f))
        return [f, read.current.get(f) ?? null] as const
      }),
    ).then((pairs) => {
      if (dropped) return
      read.current = new Map(pairs)
      setFacts(read.current)
    })
    return () => { dropped = true }
  }, [photos])

  return facts
}

function PhotoField({
  photos,
  facts,
  onChange,
}: {
  photos: File[]
  facts: Facts
  onChange: (p: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [refused, setRefused] = useState<string[]>([])
  /*
    How many photos the last pick had to leave behind. A file input cannot be
    told how many files the picker may choose, so a phone will happily offer
    ten. They are cut here instead, and the reporter is told, because a photo
    that vanishes without a word looks like a bug.
  */
  const [overflow, setOverflow] = useState(0)

  /*
    A photo is read before it is accepted, and one that does not say where it
    was taken is turned away. This is the whole rule the report rests on: the
    place is not typed, not guessed, and not picked off a map — it is what the
    camera wrote into the picture. A photograph without it cannot say where
    the problem is, so it is not a report.
  */
  const add = async (e: Event) => {
    const picked = Array.from((e.target as HTMLInputElement).files ?? [])
    // Let the same file be picked again after it is removed. Cleared now,
    // because the reads below take a moment and the reporter may be quick.
    if (input.current) input.current.value = ''
    const snaps = await Promise.all(picked.map(readSnapshot))
    const kept = picked.filter((_, i) => carriesPlace(snaps[i]))
    setRefused(picked.filter((_, i) => !carriesPlace(snaps[i])).map((f) => f.name))
    setOverflow(Math.max(0, photos.length + kept.length - MAX_PHOTOS))
    if (kept.length > 0) onChange([...photos, ...kept].slice(0, MAX_PHOTOS))
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
      {/*
        Out of sight but still the control: a label opens the picker on its
        own, so the button below needs no script, and a keyboard still lands
        on the input itself rather than on something pretending to be it.
      */}
      {refused.length > 0 && (
        <ErrorMessage onDismiss={() => setRefused([])}>
          {refused.length === 1
            ? `${refused[0]} does not record where it was taken, so it was not added.`
            : `${refused.length} photos do not record where they were taken, so they were not added.`}{' '}
          This site files a report at the place the photograph itself carries. Switch location on in
          your camera and take the picture again.
        </ErrorMessage>
      )}
      {overflow > 0 && (
        <ErrorMessage onDismiss={() => setOverflow(0)}>
          {overflow === 1 ? 'One photo was' : `${overflow} photos were`} not added: a report
          carries at most {MAX_PHOTOS}.
        </ErrorMessage>
      )}
      {photos.length > 0 && (
        <>
          <ul class="photolist">
            {photos.map((f, i) => (
              <PhotoRow
                key={`${f.name}-${i}`}
                file={f}
                snap={facts.get(f) ?? null}
                read={facts.has(f)}
                onRemove={() => onChange(photos.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
          {/*
            This has to stay true as the filter changes. The list of what
            survives is in backend/internal/photo, and it is short enough to
            name here rather than summarise.
          */}
          <p class="hint">
            The coordinates and times shown above will be sent to the city along with your
            report.
          </p>
        </>
      )}
      {/*
        Gone once the report is full, control and all. Leaving the input
        behind would keep a keyboard landing on a picker that can accept
        nothing.
      */}
      {photos.length < MAX_PHOTOS && (
        <>
          <input
            ref={input}
            id="photos"
            class="filepicker"
            type="file"
            accept="image/*"
            multiple
            onChange={add}
          />
          <label class="filebutton" for="photos">
            {photos.length === 0 ? 'Add photos' : 'Add more photos'}
          </label>
        </>
      )}
    </>
  )
}

/**
 * One photo, and what it says about itself. A reporter is sending a
 * photograph of a real place to a government site, so they get to see the
 * place and the time it carries before they send it, rather than after.
 */
function PhotoRow({
  file,
  snap,
  read,
  onRemove,
}: {
  file: File
  snap: Snapshot | null
  /** False while the photo is still being read. */
  read: boolean
  onRemove: () => void
}) {
  const map = useMapChunk()
  const MapView = map.module?.MapView
  const at = snap && snap.lat !== null && snap.lon !== null
    ? { lat: snap.lat, lon: snap.lon }
    : null

  /*
    Still a real link. A plain tap opens the map over the form, so a
    half-written report is not left behind in another tab — but a middle
    click, a long press, or ctrl-click does what the reporter expected of a
    link, and it still works if the map chunk will not load.
  */
  const onCoordinates = (e: MouseEvent) => {
    if (map.failed || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    void map.open()
  }

  return (
    <li class="photorow">
      <Thumb file={file} />
      <div class="photofacts">
        <span class="photoname">{file.name}</span>
        {!read && <span class="meta">Reading the photo…</span>}
        {read && at && (
          <a href={osmLink(at.lat, at.lon)} target="_blank" rel="noreferrer" onClick={onCoordinates}>
            {map.opening ? 'Opening the map…' : `${at.lat}, ${at.lon}`}
          </a>
        )}
        {read && !at && <span class="meta">No place recorded.</span>}
        {read && (
          <span class="meta">{snap?.taken ? takenText(snap.taken) : 'No date recorded.'}</span>
        )}
      </div>
      <button type="button" class="remove" aria-label={`Remove ${file.name}`} onClick={onRemove}>
        ×
      </button>
      {MapView && at && (
        <MapView
          at={at}
          caption={snap?.taken ? `Taken ${takenText(snap.taken)}.` : undefined}
          onClose={map.close}
        />
      )}
    </li>
  )
}

/** The camera's own clock, written the way the reporter's phone writes dates. */
function takenText(at: Date): string {
  return at.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
