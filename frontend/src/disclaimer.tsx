/**
 * The disclaimer page: this site's terms, then the city's, then a way out.
 *
 * It covers the whole page rather than rising from the bottom, and there is
 * no scroll box inside it and no frame around anyone else's page. It is one
 * column of text from the top to the Close button at the end, so the way
 * out is at the end of the reading rather than beside the start of it.
 *
 * This site's half comes first. A reporter arriving here has been told the
 * site is unofficial and wants to know what that means for them; the city's
 * terms are what they are agreeing to once they send, and they follow.
 *
 * The two halves stay in their own files — sitenotice.tsx and citynotice.tsx
 * — and keep their own headings, so nobody has to guess whose promise is
 * whose.
 */

import { CityNotice } from './citynotice'
import { SiteNotice } from './sitenotice'

export function Disclaimer({ onClose }: { onClose: () => void }) {
  return (
    <div class="sheet full" role="dialog" aria-modal="true" aria-label="Disclaimer">
      <div class="sheetbody">
        <h2>Disclaimer</h2>
        <SiteNotice />
        <CityNotice />
        <button class="primary" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
