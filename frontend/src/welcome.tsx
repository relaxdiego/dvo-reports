/**
 * What a first-time visitor is told before they start.
 *
 * This app cannot register anybody. The city will not take a report from an
 * anonymous citizen, so without an account on their site nothing here works.
 * Left unsaid, a reporter finds that out at the worst moment: after writing
 * the report, attaching the photos and pressing Send, when the sign-in step
 * asks for an address the city has never heard of. All of the work first,
 * and the bad news last.
 *
 * So it is said first instead, once. The reporter puts it away and it does
 * not come back — see needsWelcome in session.ts, which also keeps it away
 * from anybody who has signed in here before. Somebody who has an account
 * does not need to be sent to get one.
 *
 * It rises from the bottom like the sign-in sheet rather than covering the
 * page like the disclaimer. This is a short thing to read on the way in, not
 * terms to be scrolled through.
 */

/**
 * The city's registration page, not their front page. Checked on 2026-08-23:
 * it answers 200 and carries the registration form itself, so a reporter
 * sent here lands on the thing they were sent for.
 */
const REGISTER_URL = 'https://reports.davaocity.gov.ph/user.html'

export function Welcome({ onClose }: { onClose: () => void }) {
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Before you start">
      <div class="sheetbody">
        <h2>You need a city account first</h2>
        <p>
          The city government does not accept a report from an anonymous citizen. This app only
          passes your report on to them, so you need an account on the city's own site before you
          can send anything from here.
        </p>
        {/*
          The main thing to do here is on somebody else's site, so it is a
          link and not a button — but it is drawn as the primary action,
          because it is the reason this sheet is open.
        */}
        <a class="gobutton" href={REGISTER_URL}>Register on the city's site</a>
        <button class="secondary wide" type="button" onClick={onClose}>
          I already have one
        </button>
        {/*
          Said here as well as in the sign-in sheet. Somebody who registers
          with a number they cannot receive a text on has to start over, and
          by then they are several minutes in.
        */}
        <p class="hint">
          Register with a mobile number you can receive a text message on. The city texts your
          sign-in code to the number held against your address, not to your inbox.
        </p>
      </div>
    </div>
  )
}
