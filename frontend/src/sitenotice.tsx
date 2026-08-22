/**
 * What this site is, in its own words.
 *
 * This is one half of the disclaimer page; the other is citynotice.tsx,
 * which carries the city's terms. disclaimer.tsx puts them together, this
 * one first. They stay in two files, and read as two sections, so a
 * reporter can tell whose promise is whose.
 *
 * This half has no copied-on date: these are this project's own words, so
 * when they are wrong they are wrong now and should be fixed, not dated.
 *
 * Keep it honest before keeping it short. A reporter is handing over a
 * photograph of a real place and their contact details, and the parts that
 * sound least flattering — that the report passes through a server here,
 * that nothing is promised — are the parts worth being plain about.
 *
 * The emergency line stays at the top and stays short. It is the only text
 * here that has to work on somebody who is not really reading.
 */

const CITY_SITE = 'https://reports.davaocity.gov.ph'
const SOURCE = 'https://github.com/relaxdiego/dvo-reports'

export function SiteNotice() {
  return (
    <section aria-label="What this site is">
      <h3>What this site is</h3>

      {/*
        First, and before the heading is even finished being read. The
        person this is for is frightened or in a hurry, so the instruction
        comes before the examples: they may stop reading at any word.
        911 is Davao's own Central 911, free and answered on any network.
      */}
      <p class="emergency">
        In an emergency, <strong>call 911 from any phone</strong>. Do not use this site for a
        fire, a crash, a crime, or someone hurt — reports sent here can take days to be seen.
      </p>

      <div class="notice">
        <p>
          <strong>Not official:</strong> This site is not run by the city government. It is a
          faster way to send a report to the city's own site,{' '}
          <a href={CITY_SITE}>reports.davaocity.gov.ph</a>. Your report ends up there, and that is
          the site that officially holds it. The code here is open for anyone to read.
        </p>
        <p>
          <strong>Nothing stored:</strong> Your report — the words, the address, the photos, your
          contact details — passes through this site on its way to the city. It is not kept here.
          There is no database, and no log holds a copy of anything you write. Once the city
          receives your report, the city holds it under its own terms.
        </p>
        <p>
          <strong>Your sign-in:</strong> The city sends a one-time code to your phone by text
          message. The key that keeps you signed in stays in your own browser. This site never
          sees or stores a password.
        </p>
        <p>
          <strong>Your photos:</strong> Photos are made smaller in your browser before they are
          sent, so uploads are fast. A photo can carry the place and the time it was taken. Only
          those two things go on to the city. Everything else the camera wrote — its model, its
          settings, the identifiers it puts on each photograph — is removed before your report
          leaves this site.
        </p>
        <p>
          <strong>The place is your photo's:</strong> A report from here is filed where the
          photograph says it was taken. You cannot type an address and there is no pin to move,
          so a photo taken with the camera's location switched off cannot be used here. Switch
          it on and take the picture again.
        </p>
        <p>
          <strong>No promises:</strong> This site can break, go offline, or fail to deliver a
          report. It is offered as it is, with no guarantee, and you use it at your own risk. If
          something here is broken, you can say so on <a href={SOURCE}>its page on GitHub</a>.
        </p>
        <p>
          <strong>If it matters:</strong> For a hazard, or anything urgent, use the city's own
          site or the phone number it lists. And whenever you send a report — from here or from
          anywhere — keep the reference number. It is how you follow up with the city.
        </p>
      </div>

      <p class="hint">If this site helps you report a problem faster, it has done its job.</p>
    </section>
  )
}
