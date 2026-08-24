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
export const SOURCE = 'https://github.com/relaxdiego/dvo-reports'

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
          the site that officially holds it.
        </p>
        <p>
          <strong>Nothing stored:</strong> Your report — the words, the place, the photos, your
          contact details — passes through this site on its way to the city. It is held only long
          enough to pass it on, and then it is gone. There is no database here, and no log here
          holds your photos, your contact details, your address, or the place your photo
          carries. One thing is kept, and only when a report fails: if the city refuses your
          report, this site writes down the city's own answer, so the fault can be found and
          fixed. That answer can repeat the short title the city was given, and that title is
          built from the first part of what you wrote. A report that goes through leaves none
          of it. The city holds your report
          under its own terms, and gives you a reference number. Keep that number: because nothing
          stays here, it is your only record, and it is how you follow up with the city.
        </p>
        <p>
          <strong>What you are still writing:</strong> While you write a report, the words you have
          typed are kept in your own browser, on your own phone, so that leaving for your camera
          app does not lose them. They are not sent anywhere, and they are not kept here. Your
          photos are never kept, not even in your browser. What you typed goes when you send the
          report, and it goes when you close this tab.
        </p>
        <p>
          <strong>Your sign-in:</strong> You sign in with the e-mail address on your city account.
          The city then sends a one-time code by text message, to the phone number registered with
          that account. The key that keeps you signed in is kept in your own browser, and this site
          never sees or stores a password. That key passes through this site each time you send
          something, and is not kept here.
        </p>
        <p>
          <strong>Your photos:</strong> Photos are made smaller in your browser before they are
          sent, so uploads are fast. A photo can carry the place and the time it was taken. Only
          those two things go on to the city. Everything else the camera wrote — its model, its
          settings, the identifiers it puts on each photograph — is removed before your report
          leaves this site. Your report is filed at the place your photo carries: you cannot type a
          different address here, so if that place is wrong, use the city's own site instead. To put
          a street name on your report, your phone sends the photo's coordinates — and nothing
          else — to OpenStreetMap. OpenStreetMap therefore sees your phone and where it is
          connected from. The small map is drawn with pictures from OpenStreetMap too, asked for
          by your phone at the same moment, so it already knew which area you are looking at.
          When OpenStreetMap does not know the street, this site asks Microsoft's Azure Maps
          instead. That question is sent by this site and not by your phone, so Microsoft never
          sees your phone or where it is connected from.
        </p>
        <p>
          <strong>No promises:</strong> This site can break, go offline, or fail to deliver a
          report. It is offered free and as it is, with no guarantee of any kind, and you use it at
          your own risk. The people who build it are volunteers, and they are not responsible for
          any loss that comes from using it, including a report that never arrives. If you are not
          shown a reference number, treat the report as not sent, and send it again on the city's
          own site. For a hazard, or anything urgent, do not rely on this site: use the city's own
          site or the phone number it lists.
        </p>
        <p>
          <strong>Anyone can check:</strong> The code that runs this site is open for anyone to
          read, on <a href={SOURCE}>its page on GitHub</a>. The line at the bottom of this page
          names the exact version you are using and opens the code for it. If something here is
          broken, you can say so there.
        </p>
      </div>

      <p class="hint">If this site helps you report a problem faster, it has done its job.</p>
    </section>
  )
}
