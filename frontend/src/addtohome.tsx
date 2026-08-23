/**
 * How to put this site on a phone's home screen.
 *
 * It is offered from the foot of the report form and nowhere else. Waiting
 * for the Sent screen meant only somebody who had already filed a report was
 * ever asked, and the icon is worth most to the reporter who has not filed
 * one yet: it is how they get back here a second time. So the offer sits
 * below the send button, after everything the form asks for, where it is
 * read last and is in the way of nothing.
 *
 * The header is still not the place for it — it already carries the
 * emergency line and the unofficial notice, and a third thing beside them
 * weakens the two that have to survive being skimmed.
 *
 * Both sets of steps are shown rather than guessing which phone this is.
 * Reading the user agent is a guess that goes wrong quietly on a browser
 * nobody thought of, and the wrong instructions are worse than two lists.
 *
 * There is no "no thanks" to remember. Whoever adds the site stops being
 * asked, because the offer is hidden once the site is opened from the icon;
 * whoever does not gets one quiet line under the button.
 */

/**
 * Whether to offer this at all.
 *
 * No on a laptop: every step below names something only a phone has. No
 * inside the home screen app itself, which is what the first two answers
 * are — the standalone display mode on Android and everywhere modern, and
 * `navigator.standalone`, which is iOS's own older way of saying it and is
 * on no other browser.
 */
export function offerHomeScreen(): boolean {
  if (media('(display-mode: standalone)')) return false
  if ((navigator as { standalone?: boolean }).standalone) return false
  return media('(pointer: coarse)')
}

// jsdom has no matchMedia at all, and the tests render the screen this sits
// under. A test that wants the offer stubs it; the rest see no offer, which
// is the same answer a desktop browser gives.
function media(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches
}

export function AddToHome({ onClose }: { onClose: () => void }) {
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Add to your home screen">
      <div class="sheetbody">
        <h2>Add this to your home screen</h2>
        <p>
          It then opens from an icon, like an app, and you do not have to type the address again.
        </p>

        <h3>iPhone and iPad, in Safari</h3>
        <ol>
          <li>Press the Share button. It is the square with an arrow pointing up.</li>
          <li>
            Scroll down the list and press <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Press <strong>Add</strong>.
          </li>
        </ol>

        <h3>Android, in Chrome</h3>
        <ol>
          <li>Press the three dots at the top right.</li>
          <li>
            Press <strong>Add to Home screen</strong>, or <strong>Install app</strong>.
          </li>
          <li>
            Press <strong>Add</strong>, or <strong>Install</strong>.
          </li>
        </ol>

        <button class="primary" type="button" onClick={onClose}>
          Close
        </button>

        {/*
          The icon has no address bar under it to say whose site this is, so
          the sheet that talks somebody into making one says it instead. The
          sign-in warning is not a detail to leave out: on an iPhone the home
          screen app keeps its own storage, so the city's session does not
          travel from Safari, and a reporter who is asked for a code again
          thinks the icon is broken.
        */}
        <p class="hint">
          The icon opens this same unofficial site. It is not an app from the city government. On an
          iPhone you may have to sign in again the first time you open it.
        </p>
      </div>
    </div>
  )
}
