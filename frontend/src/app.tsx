import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ApiError, lookupPlace, myReports, reportHistory, sendCode, submitReport, verifyCode, type Place as Street } from './api'
import { forget, liveSession, needsWelcome, remember, rememberedEmail, welcomed } from './session'
import { forgetDraft, saveDraft, savedDraft } from './draft'
import type { SavedReport } from './saved'
import { validate, descriptionLength, MAX_DESCRIPTION, MAX_PHOTOS } from './validate'
import { osmLink, placeOfPhotos, readSnapshot, type Place, type Snapshot } from './exif'
import { Disclaimer } from './disclaimer'
import { SOURCE } from './sitenotice'
import { Welcome } from './welcome'
import { AddToHome, offerHomeScreen } from './addtohome'
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

const CITY_HOST = 'reports.davaocity.gov.ph'
const CITY_SITE = `https://${CITY_HOST}`

/**
 * Makes the city's site tappable inside a message the backend wrote.
 *
 * The backend's errors are plain sentences, and one of them — the address
 * with no city account — can only be acted on by going to the city's site
 * and registering. Asking a reporter on a phone to retype the host into
 * their address bar is asking most of them to give up, so the host is turned
 * into the link it is describing. Everything else is left as it arrived.
 */
function withCityLink(text: string): ComponentChildren {
  const parts = text.split(CITY_HOST)
  if (parts.length === 1) return text
  return parts.flatMap((part, i) =>
    i === 0 ? [part] : [<a key={i} href={CITY_SITE}>{CITY_HOST}</a>, part],
  )
}

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
  // A div rather than a p: the refused-photo message carries a list of the
  // steps that work, and an ol inside a p is not valid HTML. Every other
  // message here is a bare sentence and looks the same either way.
  return (
    <div class="error" role="alert">
      {children}
      <button type="button" class="x dismiss" aria-label="Dismiss this message" onClick={onDismiss}>
        {/* The cross is decoration; the button's own label is what is read out. */}
        <span aria-hidden="true">×</span>
      </button>
    </div>
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
 * Why a report was written to the phone, which is what decides how the
 * reporter is let go afterwards.
 *
 * 'put-away' is a report the city would not take. It is finished; keeping it
 * is the last thing done to it, so the form is cleared.
 *
 * 'still-writing' is the button under `Send report`, pressed at any moment.
 * That report is not finished — the whole point of pressing it is to be able
 * to stop and come back — so the form is left exactly as it is.
 */
type KeptWhen = 'put-away' | 'still-writing'

/**
 * Runs something that needs the city's session, asking the reporter for a
 * code when there is none. Returns null if they closed the sign-in instead.
 */
type WithSession = <T>(fn: (token: string) => Promise<T>) => Promise<T | null>

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
  // Asked once, before anything else, because nothing here works without an
  // account on the city's site. The answer lives in this browser, so the
  // question is read once and never again. See welcome.tsx.
  const [showWelcome, setShowWelcome] = useState(needsWelcome)

  // The stored session is the source of truth, not a state variable: it
  // outlives the page, and reading it here keeps the two from drifting.
  const requestSession = useCallback((): Promise<string | null> => {
    const live = liveSession()
    if (live) return Promise.resolve(live.token)
    return new Promise((resolve) => setAsk({ resolve }))
  }, [])

  const withSession = useCallback<WithSession>(
    async (fn) => {
      let token = await requestSession()
      if (token === null) return null
      try {
        return await fn(token)
      } catch (err) {
        // The city's session can die while a reporter is still typing. Ask
        // for a new code and do the same thing once more.
        if (!(err instanceof ApiError) || !err.expired) throw err
        forget()
        token = await requestSession()
        if (token === null) return null
        return await fn(token)
      }
    },
    [requestSession],
  )

  const [past, setPast] = useState<Past>({ at: 'unopened' })

  /*
    The reports this phone is holding because the city would not take them.
    They live up here, beside the city's list and not inside it, for two
    reasons: moving between the tabs must not lose them, and they have to be
    shown whatever the city's site is doing. The whole point of a draft is
    that it exists on a day when the list below it cannot load at all.

    Read through a dynamic import(), so a reporter who never opens this tab
    and never has a send fail does not download saved.ts — and this site
    never opens a database on their phone.
  */
  const [drafts, setDrafts] = useState<SavedReport[]>([])
  const loadDrafts = useCallback(async () => {
    try {
      const { savedReports } = await import('./saved')
      setDrafts(await savedReports())
    } catch {
      // Storage off, or nothing readable there. There is nothing to show and
      // nothing worth saying: this list is not what the reporter came for.
      setDrafts([])
    }
  }, [])

  /*
    A draft the reporter has asked to carry on with. It is handed to the form
    as its starting point, and its id goes with it so that sending it removes
    the copy on the phone rather than leaving a second one behind.
  */
  const [resumed, setResumed] = useState<SavedReport | null>(null)
  /*
    What the form is drawn under, moved on every resume.

    It cannot be built from the draft's own id. Keeping a report empties the
    form, so coming back to the same draft a second time has to fill it in
    again — and a key that has not moved is a component that is never
    rebuilt, which left the reporter looking at an empty form and their
    report still in the other tab.
  */
  const [formKey, setFormKey] = useState(0)
  const resume = useCallback((d: SavedReport) => {
    setResumed(d)
    setFormKey((n) => n + 1)
    setTab('report')
  }, [])

  const loadPast = useCallback(async () => {
    setPast({ at: 'loading', step: 'Asking the city’s site for your reports.' })
    // The city's site can take its time. Saying so beats a spinner that
    // looks the same at one second and at twenty.
    const slow = setTimeout(
      () => setPast((p) => (p.at === 'loading' ? { at: 'loading', step: 'The city’s site is slow to answer. Still waiting.' } : p)),
      5000,
    )
    try {
      const list = await withSession((token) => myReports(token))
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
        /*
          Keyed on the draft it started from, so choosing one puts the form
          back to that report rather than merging it into whatever was on the
          screen. A fresh form is the 'new' key and is the ordinary case.
        */
        <ReportTab
          key={formKey}
          withSession={withSession}
          onDisclaimer={() => setShowDisclaimer(true)}
          resumed={resumed}
          onDraftsChanged={loadDrafts}
          onShowDrafts={() => setTab('past')}
        />
      ) : (
        <PastTab
          past={past}
          onLoad={loadPast}
          withSession={withSession}
          drafts={drafts}
          onLoadDrafts={loadDrafts}
          onResume={resume}
        />
      )}
      {ask && (
        <SignIn
          onDone={(token) => {
            ask.resolve(token)
            setAsk(null)
          }}
        />
      )}
      {showDisclaimer && <Disclaimer onClose={() => setShowDisclaimer(false)} />}
      {showWelcome && (
        <Welcome
          onClose={() => {
            welcomed()
            setShowWelcome(false)
          }}
        />
      )}
      {/*
        The sha is the whole record of what is live: there is no version
        tag, so this is what a reader checks the site against. It links to
        the tree at that commit and not to the commit itself — the commit
        page is a diff of one change, and somebody asking what this site
        does with their photograph wants the whole of the code that is
        running, not the last thing that moved in it.

        The words are there because a bare sha is a door only a programmer
        can see. Anyone can read this code, so anyone should be able to
        find it.
      */}
      <footer class="build">
        {__BUILD_TIME__}{' '}
        <a href={`${SOURCE}/tree/${__BUILD_SHA__}`}>{__BUILD_SHA__} · read the code</a>
      </footer>
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
 * The running character count, on the label's own line and at the end of it.
 * A reporter who learns about the limit only when the form refuses their
 * finished text has already wasted the writing.
 *
 * The city's form puts it under the box. Here it sits beside "Describe it"
 * instead, because a line of its own between the box and the photos below
 * spent a whole row on a number that is only looked at near the limit. The
 * label's line is already there and had nothing at its end.
 *
 * The box has no `maxlength`. Stopping the keystroke is what the city does,
 * but it also truncates a pasted description without saying so, and this
 * form is often filled from notes written elsewhere. Better to let the text
 * arrive whole, say it is over, and let the reporter choose what to cut.
 *
 * It counts the trimmed text, because that is what the limit is applied to.
 */
function DescriptionCount({ text }: { text: string }) {
  const n = descriptionLength(text.trim())
  const over = n > MAX_DESCRIPTION
  return (
    <p id="description-count" class={over ? 'count over' : 'count'}>
      {n}/{MAX_DESCRIPTION}
      {over && ' — too long to send'}
    </p>
  )
}

function ReportTab({
  withSession,
  onDisclaimer,
  resumed,
  onDraftsChanged,
  onShowDrafts,
}: {
  withSession: WithSession
  onDisclaimer: () => void
  /** A report kept on this phone that the reporter has come back to. */
  resumed: SavedReport | null
  /** Told when a draft is written or removed, so the list stays true. */
  onDraftsChanged: () => Promise<void>
  /** Takes the reporter to the tab the kept report is waiting in. */
  onShowDrafts: () => void
}) {
  /*
    Started from whatever was being written in this tab before. A reporter is
    sent to their camera app to get a photograph with a place in it, and a
    phone short of memory throws this page away while they are gone. See
    draft.ts: the words come back, the photos do not, because the photos are
    still in their library.
  */
  const [draft, setDraft] = useState<Draft>(() =>
    resumed ? draftOf(resumed) : { ...emptyDraft, ...savedDraft() },
  )
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  /*
    Which copy on this phone this report is, once there is one. It starts set
    when the reporter came back to a draft, so sending it or saving it again
    works on that same copy instead of leaving a second one behind.
  */
  const [keptAs, setKeptAs] = useState<number | undefined>(resumed?.id)
  /*
    Whether the last attempt to send got no further than this phone. It is
    kept apart from the message, because it is what puts the offer to keep
    the report on the screen, and a report the reporter simply mistyped must
    not be offered a place on their phone.
  */
  const [unsent, setUnsent] = useState(false)
  const [keeping, setKeeping] = useState(false)
  const [keepError, setKeepError] = useState<string | null>(null)
  /*
    Raised the moment a report is on the phone. Writing it used to change
    nothing on the screen — the same notice, the same button — so a reporter
    who pressed it could only conclude that nothing had happened, and press
    it again. What they need to be told is the one thing the form cannot
    show: that it is not sent, and where it is waiting.
  */
  const [kept, setKept] = useState<KeptWhen | null>(null)
  // The only place the home screen offer is made. See addtohome.tsx for why
  // it is at the foot of the form and not in the header.
  const [showAddToHome, setShowAddToHome] = useState(false)

  useEffect(() => {
    saveDraft(draft)
  }, [draft.category, draft.description])

  /*
    Fetch saved.ts as soon as there is a photograph, rather than when it is
    wanted.

    The moment it is wanted is a send that has just failed, and one of the
    ways a send fails is a phone that has lost signal — which is the same
    phone that cannot fetch a chunk. Waiting until the button was pressed
    meant the offer to keep a report worked for every reporter except the one
    who most needed it. It is fetched here instead, while the page is being
    filled in and the network is still answering.

    A photograph is the right moment. Nothing can be kept before there is
    one, so this never runs for somebody who is only looking at the page, and
    attaching one has already cost more network than this does. Nothing is
    opened on the phone by the import itself: saved.ts touches IndexedDB only
    inside the calls that read or write a report.
  */
  useEffect(() => {
    if (draft.photos.length === 0) return
    void import('./saved').catch(() => {
      // Only a head start. If the chunk is still missing when the button is
      // pressed, that press is what says so.
    })
  }, [draft.photos.length])

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
    return (
      <Sent
        receipt={receipt}
        onAgain={() => {
          setReceipt(null)
          setDraft(emptyDraft)
          // The copy on the phone went with the send. Starting again must
          // not write the next report over a key that is no longer there.
          setKeptAs(undefined)
          setUnsent(false)
          setKeepError(null)
        }}
      />
    )
  }

  const onSubmit = async (e: Event) => {
    e.preventDefault()
    const problem = validate(draft)
    if (problem) {
      // The reporter's own mistake, and they can fix it here. Nothing is
      // offered a place on the phone for this.
      setUnsent(false)
      setError(problem)
      return
    }
    setError(null)
    setSending(true)
    try {
      const sent = await withSession((token) => submitReport(draft, token))
      if (sent) {
        // The city has it. Nothing is left here to come back to, and the
        // reference number on the next screen is the record now.
        forgetDraft()
        if (keptAs !== undefined) await drop(keptAs)
        setReceipt(sent)
        return
      }
      /*
        No session, and no error either: the reporter closed the sign-in
        without one. On a day when the city's site is down that is not a
        change of mind, it is the same outage arriving one step earlier —
        the code never came. Nothing was said here before, which left a
        filled-in form, an untouched button and no way to keep any of it.
      */
      setUnsent(true)
      setError('This report has not been sent. Sending needs a code from the city’s site, and the code did not arrive.')
    } catch (err) {
      setUnsent(true)
      setError(messageOf(err))
    } finally {
      setSending(false)
    }
  }

  /** Puts this report on the phone, or writes over the copy it came from. */
  const keep = async (when: KeptWhen) => {
    setKeeping(true)
    try {
      const { saveReport } = await import('./saved')
      const id = await saveReport(draft, keptAs)
      setKeepError(null)
      await onDraftsChanged()
      /*
        Held on to only when the reporter is carrying on. The next press then
        writes over this copy instead of leaving a second card behind. After
        a report is put away the form is cleared, and `startAgain` drops it.
      */
      if (when === 'still-writing') setKeptAs(id)
      setKept(when)
    } catch (err) {
      // Only on the way out. A reporter told the report is safe when it is
      // not is the one failure here that cannot be taken back.
      setKeepError(messageOf(err))
    } finally {
      setKeeping(false)
    }
  }

  /*
    Clears the form, once the report is somewhere else.

    Only ever reached from the sheet, which is only raised by a write that
    worked. A form left full after the report was put away reads as a report
    still waiting to be sent, and the reporter has two of the same thing in
    front of them with no way to tell which is which.
  */
  const startAgain = () => {
    setKept(null)
    setDraft(emptyDraft)
    setKeptAs(undefined)
    setUnsent(false)
    setError(null)
    setKeepError(null)
  }

  async function drop(id: number) {
    try {
      const { dropReport } = await import('./saved')
      await dropReport(id)
      await onDraftsChanged()
    } catch {
      // The report is with the city, which is what matters. A copy left on
      // the phone is untidy, not harmful, and the reporter can delete it.
    }
  }

  return (
    <>
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
                      ×
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div class="fieldhead">
            <label for="description">Describe it</label>
            <DescriptionCount text={draft.description} />
          </div>
          <textarea
            id="description"
            rows={4}
            /*
              The languages are named in the placeholder because a reporter
              who assumes an English-only form either writes nothing or
              spends the effort translating. The city's clerks read all
              three, and the description travels to them word for word.
            */
            placeholder="Tap to add a description. Bisaya, Tagalog, and English are accepted."
            value={draft.description}
            aria-describedby="description-count"
            onInput={(e) => set('description', (e.target as HTMLTextAreaElement).value)}
          />

          <PhotoField photos={draft.photos} facts={facts} onChange={(p) => set('photos', p)} />
          <LocationField draft={draft} set={set} fromPhotos={fromPhotos} pinKept={resumed !== null} />
        </fieldset>

        {/*
          One notice, not two. What can be done about a failed send used to
          sit in a box of its own under this one, and the two read as the
          same thing said twice: both opened by saying the city had not taken
          the report, and only the second went on to offer anything.

          The sentence the city's failure produced is kept and leads, because
          it is the part that changes — "the site did not answer" and "there
          is no city account for this address" are different problems, and
          only one of them is worth waiting out. The offer is a clause on the
          end of it rather than a second paragraph.

          Never after the form itself refused the report: a reporter who
          mistyped something fixes it here, and does not need a draft.
        */}
        {error && (
          <ErrorMessage onDismiss={() => setError(null)}>
            {error}
            {unsent && (
              <>
                {' '}
                {keptAs === undefined ? (
                  <>
                    You can also{' '}
                    <button type="button" class="linky" disabled={keeping} onClick={() => void keep('put-away')}>
                      save it as a draft
                    </button>{' '}
                    on this phone, and send it when their site is answering again.
                  </>
                ) : (
                  <>
                    An older draft is already on this phone. You can{' '}
                    <button type="button" class="linky" disabled={keeping} onClick={() => void keep('put-away')}>
                      save the changes
                    </button>{' '}
                    to it, and send it when their site is answering again.
                  </>
                )}
              </>
            )}
          </ErrorMessage>
        )}

        {/*
          The other half of the header's notice, worded the same, above the
          button rather than below it: the eye travels down to the button and
          stops there, and on a phone anything under it can be off the screen.
          See the note in the header before changing this wording.

          This copy carries both facts, not only the terms, and it is the
          reason the header's notice may be put away for good. The header is
          the notice a reporter reads on the way in; this is the one nobody
          can dismiss, on the last screen before a report leaves the phone. It
          is emphasised for the same reason the emergency line is: a small grey
          sentence above a blue button is read by nobody.
        */}
        <p class="terms">
          <strong>Unofficial site, not the city government's.</strong> Sending a report means you
          agree to the city's terms and to this site's own — see the{' '}
          <button type="button" class="linky" onClick={onDisclaimer}>
            disclaimer
          </button>
          .
        </p>
        <button class="primary" type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send report'}
        </button>
        {/*
          Keeping the report without trying to send it first, for a reporter
          who has to stop — the battery, the jeepney, somebody waiting.

          Only once there is a photograph. The words on their own already
          survive leaving for the camera app, in sessionStorage; what a
          photograph adds is the thing that cannot be got back by reopening
          the tab, and it is also what the report is built on. Before there
          is one there is nothing here worth a place on the phone.

          It stays put after a failed send. The notice above carries the same
          action as a link inside the sentence that explains it, which is
          where a reporter reading the failure will reach for it; this is
          where a reporter who has stopped reading and is looking for a
          control will. One is prose and one is a button, so neither is the
          other one repeated.
        */}
        {draft.photos.length > 0 && (
          <button
            class="secondary wide"
            type="button"
            disabled={sending || keeping}
            onClick={() => void keep('still-writing')}
          >
            {keeping ? 'Saving…' : keptAs === undefined ? 'Save draft on this phone' : 'Save the changes'}
          </button>
        )}
        {keepError && <ErrorMessage onDismiss={() => setKeepError(null)}>{keepError}</ErrorMessage>}
      </form>
      {/*
        Under the send button and outside the form, at the foot of the page.
        Nothing a reporter came here to do is pushed down by it, and it is
        not a control of the form it sits below.
      */}
      {/*
        No full stop after the link. The line is one character too long for a
        narrow phone, and the stop is what wraps — a lone dot centred under
        the link. The link reads as a call to action and needs none.
      */}
      {offerHomeScreen() && (
        <p class="offer">
          Like this app?{' '}
          <button type="button" class="linky" onClick={() => setShowAddToHome(true)}>
            Add it to your home screen
          </button>
        </p>
      )}
      {showAddToHome && <AddToHome onClose={() => setShowAddToHome(false)} />}
      {kept && (
        <KeptReport
          when={kept}
          onStay={() => setKept(null)}
          onClose={startAgain}
          onShowDrafts={() => {
            startAgain()
            onShowDrafts()
          }}
        />
      )}
    </>
  )
}

/**
 * What happens after a report is put on the phone.
 *
 * It covers the page on purpose. Writing the report down changed nothing a
 * reporter could see — the same notice, the same button — so pressing it
 * read as pressing nothing, which is the worst way for this particular
 * action to behave: the reporter is deciding whether their photographs are
 * safe enough to walk away from.
 *
 * The first thing it says is that the report has not been sent. That comes
 * before where it went, because a sheet appearing after a button press is
 * read as a success, and the success it is easiest to assume is the wrong
 * one. Only then does it say where to look, and it offers to go there
 * rather than only naming the tab.
 *
 * The way out depends on why it went up. A report the city refused is
 * finished, so the form is cleared behind it. A report kept mid-writing is
 * not — the reporter pressed the button in order to be able to stop, and the
 * commonest next thing is to carry straight on — so that ending leaves the
 * form untouched and says so.
 */
function KeptReport({
  when,
  onShowDrafts,
  onStay,
  onClose,
}: {
  when: KeptWhen
  onShowDrafts: () => void
  /** Back to the form, exactly as it was. Only offered mid-writing. */
  onStay: () => void
  /** Done with it: the form is cleared. */
  onClose: () => void
}) {
  const writing = when === 'still-writing'

  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Where this report is now">
      <div class="sheetbody">
        <h2>Draft saved on this phone</h2>
        <p>
          <strong>This report has not been sent.</strong> The city has not seen it, and it has no
          reference number yet.
        </p>
        <p>
          It is waiting at the top of <strong>My reports</strong>, marked <strong>Draft</strong>.
          Open it there to carry on, or to send it when you are ready.
        </p>
        {/*
          Each way out says what it does to the form, because the form is
          behind this sheet and cannot be seen from here. There used to be a
          line under these buttons explaining it instead: below the controls
          it described, about something not on the screen, and referring to
          "the button" while sitting under two others. Nobody could have read
          it in the order that made it make sense.

          The way out that leaves the report alone comes first when the
          reporter is still writing: they pressed this to be able to stop,
          not to be moved somewhere else, and the commonest next thing is to
          carry straight on.
        */}
        {writing ? (
          <>
            <button class="primary" type="button" onClick={onStay}>
              Keep writing
            </button>
            <button class="secondary wide" type="button" onClick={onShowDrafts}>
              Show me where it is
            </button>
          </>
        ) : (
          <>
            <button class="primary" type="button" onClick={onShowDrafts}>
              Show me where it is
            </button>
            <button class="secondary wide" type="button" onClick={onClose}>
              Start a new report
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** A kept report as the form takes it, so the reporter carries on writing. */
function draftOf(r: SavedReport): Draft {
  return {
    category: r.category,
    description: r.description,
    address: r.address,
    lat: r.lat,
    lon: r.lon,
    photos: r.photos,
  }
}

/**
 * How many reports are put on the page at once. The city sends every report
 * an account has in one reply — there is no page or limit to ask it for — so
 * this only bounds how many rows the browser builds, not what is fetched.
 */
const PAGE = 20

/**
 * Everything the reporter has to their name: what is still on this phone,
 * and what the city holds.
 *
 * The drafts come first and are drawn whatever the city's list is doing.
 * That is the whole point of them — they exist because the city's site was
 * not answering, and on the day it is still not answering the list below
 * this is an error message. A report waiting to be sent must not be reachable
 * only through a section that cannot load.
 */
function PastTab({
  past,
  onLoad,
  withSession,
  drafts,
  onLoadDrafts,
  onResume,
}: {
  past: Past
  onLoad: () => Promise<void>
  withSession: WithSession
  drafts: SavedReport[]
  onLoadDrafts: () => Promise<void>
  onResume: (d: SavedReport) => void
}) {
  // Every time this tab is opened, not only the first: the reporter may have
  // kept a report on the other tab a moment ago. It reads this phone and
  // asks nobody for anything, so it is cheap enough to do again.
  useEffect(() => { void onLoadDrafts() }, [onLoadDrafts])

  return (
    <>
      <Drafts drafts={drafts} onResume={onResume} onChanged={onLoadDrafts} />
      {/*
        Only once there is something above it to be told apart from. With no
        drafts this tab is the city's list and nothing else, and a heading
        over the whole of it says nothing a reporter did not already know.
      */}
      {drafts.length > 0 && <h3 class="listhead">Sent to the city</h3>}
      <CityReports past={past} onLoad={onLoad} withSession={withSession} />
    </>
  )
}

/**
 * The reports waiting on this phone, above the city's own list and plainly
 * apart from it. Two headings, because a reporter has to be able to tell
 * what the city has from what only their phone has: the second kind has no
 * reference number and nobody but them knows it exists.
 */
function Drafts({
  drafts,
  onResume,
  onChanged,
}: {
  drafts: SavedReport[]
  onResume: (d: SavedReport) => void
  onChanged: () => Promise<void>
}) {
  if (drafts.length === 0) return null

  return (
    <section class="drafts">
      <h3 class="listhead">Drafts on this phone</h3>
      <p class="hint">
        These are on this phone only. The city has not seen them, and they have no reference
        number. Open one to send it.
      </p>
      <ul class="reports">
        {drafts.map((d) => (
          <DraftReport key={d.id} draft={d} onResume={onResume} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  )
}

/**
 * One report waiting on this phone, drawn as the city's own cards are so
 * that the tab reads as one list — but with "Draft" where a status word goes,
 * because there is no status: nobody has it but this phone.
 *
 * Deleting takes two taps. The photographs are the part that cannot be got
 * back from anywhere else, and a single mis-tap on a phone would take them.
 */
function DraftReport({
  draft,
  onResume,
  onChanged,
}: {
  draft: SavedReport
  onResume: (d: SavedReport) => void
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    try {
      const { dropReport } = await import('./saved')
      await dropReport(draft.id)
      await onChanged()
    } catch (err) {
      setError(messageOf(err))
      setSure(false)
    }
  }

  return (
    <li class="report">
      <div class="reporttop">
        <button type="button" class="reporthead" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span class="status kept">Draft</span>
          <span class="title">{draft.description}</span>
          <span class="meta">
            {CATEGORY_LABELS[draft.category] ?? 'Kind of problem not picked'} · Saved {whenText(draft.at)}
          </span>
        </button>
      </div>
      {open && (
        <div class="reportbody">
          {draft.address && <p class="hint">Where: {draft.address}</p>}
          {draft.photos.length > 0 && (
            <ul class="thumbs">
              {draft.photos.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <Thumb group={draft.photos} at={i} />
                </li>
              ))}
            </ul>
          )}
          {error && <ErrorMessage onDismiss={() => setError(null)}>{error}</ErrorMessage>}
          <button class="primary" type="button" onClick={() => onResume(draft)}>
            Open it and send
          </button>
          {sure ? (
            <p class="sure">
              Delete this report and its photos from this phone?{' '}
              <button type="button" class="linky danger" onClick={() => void remove()}>
                Delete
              </button>{' '}
              <button type="button" class="linky" onClick={() => setSure(false)}>
                Keep it
              </button>
            </p>
          ) : (
            <button class="secondary wide" type="button" onClick={() => setSure(true)}>
              Delete this draft
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function CityReports({
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
  const box = useRef<HTMLInputElement>(null)

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
      <div class="searchbox">
        <input
          ref={box}
          id="search"
          type="search"
          aria-label="Search your reports"
          placeholder="Number, subject, or status"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        {query && (
          <button
            class="x"
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              box.current?.focus()
            }}
          >
            ×
          </button>
        )}
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

/**
 * Reloading the list, at the foot of it. It is as wide as the page because
 * it is the only thing to press there: a small square in a corner is a
 * target to hunt for on a phone, and a thumb has already reached the bottom
 * of the list by the time it is wanted.
 */
function Refresh({ onClick }: { onClick: () => void }) {
  return (
    <button class="secondary wide" type="button" onClick={onClick}>
      Refresh list
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

/**
 * Takes the three things somebody quotes when they ask about a report — its
 * reference, its title, and the day it was filed — and puts them on the
 * clipboard, so they can be pasted into a message to the city or to a
 * neighbour without being copied out by hand from a phone screen.
 *
 * Every line is labelled, and the reference goes first: the text is pasted
 * away from this page, where a bare number or a bare date says nothing
 * about what it is, and the reference is what the city asks for.
 */
function CopyReport({ report }: { report: Filed }) {
  const [said, setSaid] = useState('')

  const copy = async () => {
    const text = [
      `Reference #: ${report.reference}`,
      `Subject: ${report.title}`,
      `Date: ${copyDateText(report.filed)}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setSaid('Copied')
    } catch {
      // A browser can refuse the clipboard, and then nothing at all has
      // happened: say so rather than leaving the button looking pressed.
      setSaid('Copy failed')
    }
    setTimeout(() => setSaid(''), 2000)
  }

  return (
    <button
      type="button"
      class="copy"
      aria-live="polite"
      title="Copy the reference, subject and date"
      onClick={() => void copy()}
    >
      {said || 'Copy'}
    </button>
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
        const h = await withSession((token) =>
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
      <div class="reporttop">
        <button type="button" class="reporthead" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span class="status">{statusWord(report.status)}</span>
          <span class="title">{report.title}</span>
          <span class="meta">
            {report.reference} · {whenText(report.filed)}
          </span>
        </button>
        <CopyReport report={report} />
      </div>
      {open && (
        <div class="reportbody">
          <p>{report.description}</p>
          {report.location && <p class="hint">Where: {report.location}</p>}
          {report.photos && report.photos.length > 0 && <ReportPhotos srcs={report.photos} />}
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

/**
 * What the city has done to the report, one line per status change.
 *
 * Each status carries its own meaning, on the line under the word it
 * explains. The word alone is the city's, and ENCODED or FORREMARKS says
 * nothing to the person who filed the report; the sentence used to sit at
 * the top of the card, on its own, far from any of the words it was about.
 */
function Progress({ history }: { history: History }) {
  return (
    <>
      {history.note && <p class="note">The city says: {history.note}</p>}
      <ol class="steps">
        {history.steps.map((s, i) => (
          <li key={`${s.status}-${s.at}-${i}`}>
            <strong>{statusWord(s.status)}</strong>
            {s.office ? ` · ${s.office}` : ''}
            <span class="meta"> {whenText(s.at)}</span>
            {STATUS_MEANING[s.status] && <span class="hint">{STATUS_MEANING[s.status]}</span>}
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
function SignIn({ onDone }: { onDone: (token: string | null) => void }) {
  const [email, setEmail] = useState(rememberedEmail())
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeBox = useRef<HTMLInputElement>(null)

  /*
    The code arrives while this sheet is open, in a text message the reporter
    has to leave the page to read. Coming back to a field already waiting for
    it saves a tap at the one moment they are holding a phone in one hand.
    iOS and Android offer the code above the keyboard, and only to a focused
    field, so this is also what makes autoComplete="one-time-code" work.
  */
  useEffect(() => {
    if (stage === 'code') codeBox.current?.focus()
  }, [stage])

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
        <h2>Sign-in required</h2>
        {/*
          The way out of this sheet for somebody with no account, said before
          the field rather than under the buttons: an address the city has
          never heard of is refused, and by then they have typed it and
          waited. The link opens in its own tab because a half-written report
          and its photographs are behind this sheet, and leaving the page
          would throw them away. Their front page and not their registration
          form — see REGISTER_URL in welcome.tsx for why.
        */}
        <p>
          You need an account on the city's site. If you do not have one, register at{' '}
          <a href={CITY_SITE} target="_blank" rel="noreferrer">
            {CITY_HOST}
          </a>{' '}
          first, then come back here. This app never sees your password.
        </p>
        <fieldset disabled={busy}>
          <label for="email">The e-mail address on your city account</label>
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
              The city sends the code by text message to the phone number on that account. Have
              that phone with you.
            </p>
          )}
          {stage === 'code' && (
            <>
              <label for="code">The six-digit code</label>
              <input
                id="code"
                ref={codeBox}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onInput={(e) => setCode((e.target as HTMLInputElement).value)}
              />
              <p class="hint">
                The city should have sent you a text message. Type the code in above. It runs out
                after a few minutes.
              </p>
            </>
          )}
        </fieldset>

        {error && <ErrorMessage onDismiss={() => setError(null)}>{withCityLink(error)}</ErrorMessage>}

        {/*
          `waiting` is the spinner the rest of the page uses for a wait that
          sits inside something already on the screen, borrowed here so the
          button itself says the city is being asked. It pulses instead of
          turning for a reporter who asked for less motion.
        */}
        <button
          class={busy ? 'primary waiting' : 'primary'}
          type="submit"
          disabled={busy || !email.trim() || (stage === 'code' && !code.trim())}
        >
          {busy && <span class="spinner" aria-hidden="true" />}
          {busy
            ? stage === 'email' ? 'Requesting\u2026' : 'Signing in\u2026'
            : stage === 'email' ? 'Request a code' : 'Sign in'}
        </button>
        {stage === 'code' && (
          <button class="secondary wide" type="button" disabled={busy} onClick={() => { setStage('email'); setCode('') }}>
            Use a different address
          </button>
        )}
        <button class="secondary wide" type="button" onClick={() => onDone(null)}>Not now</button>
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
 * It says the environment's name and nothing else. The bar is for whoever is
 * testing, not for a citizen: they already know what a staging build does,
 * and one word tells them which of the two builds on their phone they have
 * opened. Naming it in one line also keeps it from pushing the form down a
 * whole sentence's worth on a phone.
 *
 * Be clear about what that gives up. This bar used to say a report sent from
 * here is not filed, and now it does not. The promise is still kept after
 * the fact — `upstream.NoSubmit` answers `NOT-FILED-nnnn` and `upstream.Echo`
 * answers `ECHO-…`, so the reference the reporter is shown says it — but it
 * is no longer said before the report is written. If this build is ever put
 * in front of citizens rather than testers, put the sentence back.
 *
 * It is never in what production serves: `__ENVIRONMENT__` is a build-time
 * constant, so the comparison above is `"production" !== "production"` there
 * and the minifier drops this and the branch that calls it.
 */
function NotTheRealSite() {
  return (
    <p class="testbanner">
      {__ENVIRONMENT__[0].toUpperCase() + __ENVIRONMENT__.slice(1)}
    </p>
  )
}

/*
  Whether the reporter has put the unofficial notice away.

  Kept in this browser, next to the city session in `session.ts`, because a
  notice that has been read stops being a notice and starts being something
  to scroll past. It is a single flag: nothing about the reporter, and
  nothing about any report. Storage is switched off in some private windows,
  and there the notice simply comes back — which is the safe way for this to
  fail.

  The key says `dismissed` and used to say `minimized`, because the cross used
  to shorten the notice rather than remove it. The name is not decoration: a
  reporter carrying the old flag has only ever agreed to a shorter notice, not
  to no notice, so they are shown the whole of it once more and can put it
  away for good if they want to.
*/
const UNOFFICIAL_KEY = 'dvo-reports.unofficial-dismissed'

function unofficialDismissed(): boolean {
  try {
    return localStorage.getItem(UNOFFICIAL_KEY) === '1'
  } catch {
    return false
  }
}

function rememberUnofficialDismissed(): void {
  try {
    localStorage.setItem(UNOFFICIAL_KEY, '1')
  } catch {
    // Nothing to do: the notice is away only for this visit.
  }
}

function Header({ onDisclaimer }: { onDisclaimer: () => void }) {
  const [dismissed, setDismissed] = useState(unofficialDismissed)

  return (
    <header>
      <h1>Davao Citizen Reporter</h1>
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
        sending binds the reporter to the city's terms and to this site's own —
        on the city's own site that is a button they press, so it cannot live
        only behind a link nobody opens, and this site's own disclaimer of
        liability is worth nothing if nobody is pointed at it as they act. The rest is the disclaimer page.

        Read once, the paragraph is only in the way of the form under it, so
        the cross takes the whole of it away and this browser remembers that.
        Neither of the two facts leaves the page with it. Both are written
        again above `Send report`, which is where they are read at the moment
        of agreeing and where the header cannot reach, having been scrolled
        off the screen by then. That copy carries no cross and cannot be put
        away. Change the wording here and change it there.
      */}
      {!dismissed && (
        <p class="unofficial">
          Unofficial site, not run by or connected to the city government. Volunteers built it to
          send your report to <a href={CITY_SITE}>reports.davaocity.gov.ph</a>. Use at your own
          risk. Sending a report means you agree to the city's terms and to this site's own — see the{' '}
          <button type="button" class="linky" onClick={onDisclaimer}>
            disclaimer
          </button>
          .
          {/*
            The same cross the rest of the page uses, in the corner the
            error's cross sits in.
          */}
          <button
            type="button"
            class="x dismiss"
            aria-label="Hide this notice"
            onClick={() => {
              setDismissed(true)
              rememberUnofficialDismissed()
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </p>
      )}
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
  pinKept,
}: {
  draft: Draft
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  /** Where the attached photos say the problem is. */
  fromPhotos: Place | null
  /**
   * Whether the pin arrived with the report rather than from the photos this
   * form has just read. A report kept on the phone stored the place its pin
   * was left on, and that may be one the reporter moved by hand; nothing
   * here can tell the two apart afterwards. Treating a kept pin as theirs
   * keeps a nudge that was made yesterday, at the cost of a re-read photo no
   * longer being able to move a pin that was the photos' own. Only one of
   * those two is a loss the reporter would notice.
   */
  pinKept: boolean
}) {
  const [street, setStreet] = useState<Street | null>(null)
  const [naming, setNaming] = useState(false)
  const [byReporter, setByReporter] = useState(pinKept)
  const [picking, setPicking] = useState(false)
  const map = useMapChunk()
  const MapHere = map.module?.MapHere
  const MapPicker = map.module?.MapPicker

  // The place is the photographs' to give, and nobody's to type. Every photo
  // attached carries one, because one that does not is turned away in the
  // field above, so the pin starts where they were taken, and follows them as
  // they are added and removed.
  //
  // The reporter may then move it themselves, and after that it is theirs:
  // another photo does not drag it back. Taking out the last photo still
  // takes the place with it, and forgets what they chose — with no
  // photograph there is nothing to file and nowhere to file it.
  useEffect(() => {
    if (!fromPhotos) {
      setByReporter(false)
      set('lat', null)
      set('lon', null)
      return
    }
    if (byReporter) return
    set('lat', fromPhotos.lat)
    set('lon', fromPhotos.lon)
  }, [fromPhotos, byReporter, set])

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

  const pick = (spot: { lat: number; lon: number }) => {
    setByReporter(true)
    set('lat', spot.lat)
    set('lon', spot.lon)
    setPicking(false)
  }

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
      {/*
        The street the report will be filed under, and the way to move the
        pin off it. The link sits beside the name because the name is what
        tells a reporter the pin is wrong: it is the sentence a city worker
        will read, and the moment to disagree with it is while reading it.

        Nobody is credited under it. OpenStreetMap asks to be credited
        wherever its data is shown, and Leaflet draws that credit in the
        corner of the map directly above this line — twice on one screen is
        one too many.

        The link waits for the map, because it opens the map. It arrives
        moments after the picture above it and never on a build where
        Leaflet failed to load, which is the one case where pressing it
        could do nothing at all.
      */}
      {at && !naming && (street?.address || MapPicker) && (
        <p class="street">
          {street?.address}
          {/*
            A real space, not a margin. The gap has to disappear when the
            link wraps onto a line of its own: a space at a line break is
            dropped, and a margin is not — it would indent the link by half
            a rem and read as a stray one.
          */}
          {MapPicker && (
            <>
              {' '}
              <button type="button" class="linky adjust" onClick={() => setPicking(true)}>
                Adjust
              </button>
            </>
          )}
        </p>
      )}
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
      {at && !byReporter && fromPhotos?.spread && (
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

      {picking && at && MapPicker && (
        <MapPicker at={at} onPick={pick} onClose={() => setPicking(false)} />
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
  /*
    The photos turned away, kept as the files themselves rather than their
    names: the message shows each one, and a phone names them all image.jpg.
  */
  const [refused, setRefused] = useState<File[]>([])
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
    setRefused(picked.filter((_, i) => !carriesPlace(snaps[i])))
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
      {photos.length > 0 && (
        <>
          <ul class="photolist">
            {photos.map((f, i) => (
              <PhotoRow
                key={`${f.name}-${i}`}
                group={photos}
                at={i}
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
        Below the photos that did get in, not above them. A reporter who
        picks four and gets one in used to meet the red box first and read
        it as being about all four — nothing above it said otherwise. Their
        own photo row, with its coordinates on it, answers "did any of that
        work?" better than a sentence can, so it goes first.

        This costs nothing in the commonest case: when every photo was
        turned away the list above is empty, so the box still sits directly
        under the label. It costs something in the rare one — four kept and
        one refused pushes it off the first screen. That is the better way
        round. Not noticing one photo was dropped leaves a report that can
        still be sent; believing all four failed makes somebody give up.
        The box is on the way down to Send report either way.

        It stays outside the block below, which disappears when the report
        is full — that is exactly when the overflow message has something to
        say. `role="alert"` is announced wherever the box sits in the
        document, so a screen reader hears it first as it always did.

        The verdict first, then the cause, then what to do about it. What was
        here before spent its first two sentences explaining the site to
        somebody standing in the street holding a phone.

        The cause is written twice, because one pick and several picks cannot
        have happened the same way. `refused` is replaced on every pick, so
        what is shown here is always one trip to the picker. Neither phone
        can bring back more than one photo from its camera: iOS takes one
        shot and hands it over, and Android's camera answers the intent
        Chrome sends it with a single file. So several at once means they
        came from the phone, and the reporter who is asked "did you take
        them just now?" is being asked about taps they did not make.

        One photo asks that question, because it is by far the commonest way
        to reach this message, and the reporter does not think of it as
        anything but taking a photo: the camera opened, they pressed the
        button. Told instead that "a picture taken inside this page" has no
        place, they read a sentence about somebody else.

        Several photos are told what is true of a photo already on the
        phone instead: location was off, or it is a screenshot, or somebody
        sent it. The steps below are the same either way, because taking
        them again in the camera app is the answer to all of it.

        The steps are numbered because they are followed with the phone in
        one hand, and a hurried reader follows a list faster than a sentence
        with three clauses in it. Location is named inside the step where
        switching it on is the thing that works. It is not offered up front:
        for the reporter who took the photo through the page, no setting
        changes anything, and sending them to Settings costs them the trip
        and leaves them back here.

        The last line is for the reporter the steps cannot help. A page
        opened inside another app — Facebook, Messenger — is in that app's
        own browser, and it can hand a photo over with the place taken out.
        Their location was on, their photo has it, and following the steps
        leaves them here again. Naming the two apps is worth the words: it
        is how somebody recognises where they are, since an in-app browser
        does not say so itself.

        The filename is gone. A phone names them all image.jpg, so it picked
        nothing out, and the pictures below say which ones far better.

        Several at once is the ordinary case, not the exception: a phone
        offers the whole library and a reporter picks four. So the message
        says "these photos" and shows every one of them, rather than
        counting them at the reporter. The count is in front of them.
      */}
      {refused.length > 0 && (
        <ErrorMessage onDismiss={() => setRefused([])}>
          <strong>
            {refused.length === 1
              ? 'This photo has no location, so it was not added.'
              : 'These photos have no location, so they were not added.'}
          </strong>
          {/*
            Under the verdict, because "which one?" is the question the
            verdict raises and a picture answers it without being read. It
            earns its place when several were picked and only some got in:
            the ones that did are in the list below, and these are the rest.
            The name is the alt text rather than a line of its own — a
            screen reader has nothing else to tell one file from another,
            and on the screen the picture says it better.
          */}
          <ul class="thumbs">
            {refused.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <Thumb group={refused} at={i} alt={f.name} />
              </li>
            ))}
          </ul>
          {refused.length === 1 ? (
            <p>
              Did you take it just now, after tapping Add photos? A photo taken that way never
              has a location, and no setting on your phone changes that.
            </p>
          ) : (
            <p>
              A photo already on your phone has no location if it was taken with location
              switched off, if it is a screenshot, or if somebody sent it to you.
            </p>
          )}
          <p>What works:</p>
          <ol class="steps">
            <li>Open your camera app.</li>
            <li>
              Take the {refused.length === 1 ? 'photo' : 'photos'} there, with location switched
              on.
            </li>
            <li>Come back here and tap Add photos.</li>
            <li>Pick the {refused.length === 1 ? 'photo' : 'photos'} you just took.</li>
          </ol>
          {refused.length === 1 && (
            <p>Screenshots, and photos other people sent you, also have no location.</p>
          )}
          <p>
            Opening this page inside another app, like Facebook or Messenger, can also remove
            the location. Open the page in Safari or Chrome instead.
          </p>
        </ErrorMessage>
      )}
      {overflow > 0 && (
        <ErrorMessage onDismiss={() => setOverflow(0)}>
          {overflow === 1 ? 'One photo was' : `${overflow} photos were`} not added: a report
          carries at most {MAX_PHOTOS}.
        </ErrorMessage>
      )}
      {/*
        Gone once the report is full, control and all. Leaving the input
        behind would keep a keyboard landing on a picker that can accept
        nothing.
      */}
      {photos.length < MAX_PHOTOS && (
        <>
          {/*
            Said before the picker opens rather than only after a photo is
            turned away, because the refusal above costs the reporter a
            picture they have already taken. Only for the first one: by the
            second they have done it once and know how.

            Gone while that refusal is on screen, which is exactly when it
            used to appear: nothing is added after one, so both were shown
            together, saying the same thing in different words directly
            underneath each other. Two wordings of one instruction read as
            two instructions, and the reporter goes looking for the
            difference.
          */}
          {photos.length === 0 && refused.length === 0 && (
            <p class="hint">
              Take the photo with your camera app first, then add it here. A photo taken from this
              page has no location, and the site needs one.
            </p>
          )}
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
  group,
  at,
  snap,
  read,
  onRemove,
}: {
  /** Every photo going with the report, so an opened one can be swiped past. */
  group: File[]
  at: number
  snap: Snapshot | null
  /** False while the photo is still being read. */
  read: boolean
  onRemove: () => void
}) {
  const file = group[at]
  const map = useMapChunk()
  const MapView = map.module?.MapView
  const place = snap && snap.lat !== null && snap.lon !== null
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
      <Thumb group={group} at={at} />
      <div class="photofacts">
        <span class="photoname">{file.name}</span>
        {!read && <span class="meta">Reading the photo…</span>}
        {read && place && (
          <a href={osmLink(place.lat, place.lon)} target="_blank" rel="noreferrer" onClick={onCoordinates}>
            {map.opening ? 'Opening the map…' : `${place.lat}, ${place.lon}`}
          </a>
        )}
        {read && !place && <span class="meta">No place recorded.</span>}
        {read && (
          <span class="meta">{snap?.taken ? takenText(snap.taken) : 'No date recorded.'}</span>
        )}
      </div>
      <button type="button" class="x remove" aria-label={`Remove ${file.name}`} onClick={onRemove}>
        <span aria-hidden="true">×</span>
      </button>
      {MapView && place && (
        <MapView
          at={place}
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

/** One picture, and the words that stand for it. */
type Pic = { src: string; alt: string }

/**
 * One photograph, as big as the screen will draw it, over the page.
 *
 * A thumbnail is three and a half rems of a picture cropped square, which is
 * enough to tell one photo from another and nothing else. What the reporter
 * is about to hand to a government site is the whole frame: a face at the
 * edge of it, a number plate, the inside of somebody's yard behind the
 * pothole. They get to look at that before they send it, on the phone they
 * took it with, rather than finding out afterwards.
 *
 * It is drawn from the file already in the page, so opening it costs nothing
 * and asks nobody for anything: the same object URL the thumbnail is using.
 *
 * Tapping anywhere closes it, which is what every photo viewer on a phone
 * does, and the cross says so for anyone who does not already know. Escape
 * closes it too, the way the map sheet behaves.
 *
 * It is handed the whole group the picture came from, not one picture, so a
 * swipe left or right moves to the photograph beside it — again, what every
 * photo viewer on a phone does. Going back to the row of squares to open the
 * next one is three taps on a phone, and comparing two photographs of the
 * same pothole is exactly what somebody about to press Send is doing. The
 * arrow keys do the same for anyone holding a keyboard, who has no swipe.
 *
 * The whole group is laid out in one row and the row is moved, rather than
 * one picture being swapped for another. That is what lets the photographs
 * follow the finger: the reporter sees the next one coming while they are
 * still dragging, so a swipe that is not going to be far enough shows itself
 * as one, and a tap never looks like a swipe that failed. Letting go settles
 * the row the rest of the way. Nothing here is fetched to do it — every
 * picture in the group is already on the page.
 */
function Lightbox({ group, at, onClose }: { group: Pic[]; at: number; onClose: () => void }) {
  const [i, setI] = useState(at)
  /** How far the finger has taken the row from where it is resting, in pixels. */
  const [drag, setDrag] = useState(0)

  /* It stops at each end rather than wrapping round, so a reporter who has
     reached the last photograph finds that out by the picture not moving,
     rather than by recognising the first one again. */
  const go = (step: number) =>
    setI((n) => Math.max(0, Math.min(group.length - 1, n + step)))

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose, group.length])

  /*
    A tap puts the picture away and a sideways drag moves along the group, and
    all that separates them is how far the finger went. Two fingers are
    neither: that is a pinch, and zooming into a photograph is half the reason
    to open it large.

    The drag is remembered because a browser may still send a click after one,
    and that click would close the photograph the reporter just swiped to.
  */
  const from = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches
    from.current = t.length === 1 ? { x: t[0].clientX, y: t[0].clientY } : null
    if (!from.current) setDrag(0)
  }

  const onTouchMove = (e: TouchEvent) => {
    const start = from.current
    if (!start || e.touches.length !== 1) return
    const dx = e.touches[0].clientX - start.x
    // Past either end there is nothing to bring on, so the row gives way only
    // a little and springs back. That is the end of the group, felt.
    const end = dx > 0 ? i === 0 : i === group.length - 1
    setDrag(end ? dx / 4 : dx)
  }

  const onTouchEnd = (e: TouchEvent) => {
    const start = from.current
    from.current = null
    setDrag(0)
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const across = Math.abs(dx)
    // Sideways, and far enough to have been meant: a thumb resting on a
    // photograph slides a few pixels, and a drag down the screen is not this.
    if (across < 45 || across <= Math.abs(t.clientY - start.y)) return
    swiped.current = true
    go(dx < 0 ? 1 : -1)
  }

  const onTap = () => {
    if (swiped.current) {
      swiped.current = false
      return
    }
    onClose()
  }

  return (
    <div
      class="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={group[i].alt}
      onClick={onTap}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* While the finger is down the row goes exactly where it is put, with
          no easing in the way; letting go hands it back to the transition. */}
      <div
        class="track"
        style={`transform:translateX(calc(${i * -100}% + ${drag}px))${drag ? ';transition:none' : ''}`}
      >
        {group.map((p) => (
          <div class="slide" key={p.src}>
            <img src={p.src} alt={p.alt} />
          </div>
        ))}
      </div>
      <button type="button" class="x" aria-label="Close" onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
      {/* Nothing else on this screen says there is another photograph to
          reach: the picture fills it, and a swipe leaves no handle to see. */}
      {group.length > 1 && <p class="count" role="status">{`${i + 1} of ${group.length}`}</p>}
    </div>
  )
}

/**
 * The same viewer, for photographs that are still on the phone.
 *
 * A thumbnail already holds an address for the one picture it draws; the rest
 * of the group has none until somebody looks at them. They are made when this
 * opens and given back when it closes, so the reporter who never opens a
 * photograph never costs the page one.
 */
function FileLightbox({ files, at, onClose }: { files: File[]; at: number; onClose: () => void }) {
  // Read once. The group cannot change while it is covering the form, and
  // making the addresses again on a re-render would blink the picture.
  const pics = useMemo(() => files.map((f) => ({ src: URL.createObjectURL(f), alt: f.name })), [])
  useEffect(() => () => pics.forEach((p) => URL.revokeObjectURL(p.src)), [pics])

  return <Lightbox group={pics} at={at} onClose={onClose} />
}

/**
 * A photograph on a past report, which lives on the city's site rather than on
 * this phone. Tapping it opens the same picture over the page.
 *
 * It stays a real link, the way the coordinates on a photo's row do: a plain
 * tap opens it here, so the list of reports is not left behind in another tab,
 * and a middle click, a long press or a ctrl-click still gives the reporter
 * the new tab they asked for. The picture that opens is the one already
 * downloaded for the thumbnail, so a tap asks the city for nothing.
 *
 * The number is all there is to tell one of these apart by. A photograph of a
 * pothole has no name here — the city does not send one — and the alt text
 * stays empty because there is nothing truthful to put in it.
 */
function ReportPhoto({ group, at }: { group: Pic[]; at: number }) {
  const [open, setOpen] = useState(false)
  const pic = group[at]

  const onOpen = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    setOpen(true)
  }

  return (
    <>
      <a
        href={pic.src}
        target="_blank"
        rel="noreferrer"
        aria-label={`Show photo ${at + 1} larger`}
        onClick={onOpen}
      >
        <img src={pic.src} alt="" loading="lazy" />
      </a>
      {open && <Lightbox group={group} at={at} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Every photograph on one past report, as a row of squares.
 *
 * The group is named here rather than inside each square, because a square
 * opened has to know what the ones beside it are: a swipe moves along this
 * list.
 */
function ReportPhotos({ srcs }: { srcs: string[] }) {
  const group = srcs.map((src, i) => ({ src, alt: `Photo ${i + 1}` }))

  return (
    <ul class="thumbs">
      {group.map((pic, i) => (
        <li key={pic.src}>
          <ReportPhoto group={group} at={i} />
        </li>
      ))}
    </ul>
  )
}

/**
 * A photo the reporter chose, small. Tapping it opens the picture above.
 *
 * The same square is used in two places, and both want this: the row of a
 * photo that is going with the report, and the message listing the ones that
 * were turned away. In the second it answers a question the thumbnail cannot
 * — a reporter who picked four and got a refusal for two needs to see which
 * two, and at this size several photos of the same street are one picture.
 */
function Thumb({ group, at, alt = '' }: { group: File[]; at: number; alt?: string }) {
  const file = group[at]
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        class="thumbtap"
        aria-label={`Show ${file.name} larger`}
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={alt} />
      </button>
      {open && <FileLightbox files={group} at={at} onClose={() => setOpen(false)} />}
    </>
  )
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
      {/*
        No link to the report on the city's site. There is no page to link
        to: following a report is another call that needs the reporter's own
        session, and the city draws the answer in a modal. This screen used
        to offer one behind a `track_url` the backend has never set — see
        "No tracking URL" in docs/upstream.md. The past reports tab is where
        a reporter follows this up.
      */}
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
/**
 * The date as the copied text carries it: a short month, so the line stays
 * short in a message, and never the reporter's own locale, because what is
 * pasted is read by somebody else.
 */
function copyDateText(s: string): string {
  const t = cityTime(s)
  if (Number.isNaN(t)) return s
  return new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
}

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
