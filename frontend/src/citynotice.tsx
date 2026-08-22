/**
 * The city's own disclaimer and privacy terms, copied word for word.
 *
 * There is nothing to link to. `reports.davaocity.gov.ph` shows this text in
 * a box on its front page and has no page of its own for it: /privacy,
 * /privacy-policy and /terms all answer 404. So a reporter using this front
 * end would never see the terms they are agreeing to unless they are carried
 * here. They are the city's words, not this project's, and they are not
 * summarised or shortened.
 *
 * The city can change them whenever it likes, and nothing here would notice.
 * That is why COPIED_ON is shown next to them: a reader can tell how old
 * this copy is, and go and read the city's own if it matters. When you
 * refresh the text, change that date in the same commit.
 */

/** When the text below was last copied from the city's site. */
const COPIED_ON = '22 August 2026'

const CITY_SITE = 'https://reports.davaocity.gov.ph'

/** The heading the city puts on it. */
const TITLE = 'Disclaimer'

const OPENING =
  'By using Davao City Reports App, you hereby consent to our Privacy Policy and agree to its terms:'

/** Each of the city's paragraphs, as its own bold lead-in and its sentence. */
const TERMS: { lead: string; text: string }[] = [
  {
    lead: 'Information Collection:',
    text: 'The Davao City Reports App may collect personal information from users. The type of information collected and the reasons for its collection will be clearly communicated at the point of data entry.',
  },
  {
    lead: 'Additional Information:',
    text: 'When users contact us directly, we may receive supplementary information such as name, email address, phone number, message contents, attachments, and any other details provided.',
  },
  {
    lead: 'Account Registration:',
    text: 'During the registration process, users may be asked to provide contact information, including name, address, email address, and active contact number.',
  },
  {
    lead: 'Use of Information:',
    text: 'The information collected may be utilized for various purposes determined by the Davao City Reports App, which may include but are not limited to: improving user experience, communication with users, and enhancing app functionality.',
  },
  {
    lead: 'Privacy Policy:',
    text: "By clicking the 'Accept' button, users also consent to the Privacy Policy of the Davao City Reports App. It is recommended that users review the Privacy Policy to understand how their personal information is handled and protected.",
  },
  {
    lead: 'Disclaimer Acceptance:',
    text: 'Your continued use of the Davao City Reports App constitutes your acceptance of these terms and any updates or modifications thereto.',
  },
]

export function CityNotice({ onClose }: { onClose: () => void }) {
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label={`The city's ${TITLE.toLowerCase()}`}>
      <div class="sheetbody">
        <h2>The city's {TITLE.toLowerCase()}</h2>
        <p class="hint">
          These are the city's words, copied from <a href={CITY_SITE}>{CITY_SITE.replace('https://', '')}</a> as of{' '}
          {COPIED_ON}. The city may have changed them since, and its site has no page for them to link to.
        </p>

        <div class="notice">
          <p><strong>{OPENING}</strong></p>
          {TERMS.map((t) => (
            <p key={t.lead}>
              <strong>{t.lead}</strong> {t.text}
            </p>
          ))}
        </div>

        <p class="hint">
          Filing a report through this front end sends it to the city's site, so these terms cover it.
        </p>
        <button class="primary" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
