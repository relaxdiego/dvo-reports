# Notes for coding agents

Read this before changing anything. It records the decisions that are not
obvious from the code.

**Picking the work up cold?** Read the open issues first — they are the only
record of what is in flight. Then this file, then `docs/`. `README.md` says
how far along the project is. Nothing about the current state is written into
a file here, on purpose; see "Where work is tracked" below.

## What this is

An unofficial, faster client for `reports.davaocity.gov.ph`. A citizen fills
in a form; the backend relays the report to the city's site. The city's site
is the system of record. This project stores nothing.

## Rules that are not negotiable

- **Store nothing.** No database, no queue, no object storage, no log line
  that prints a report body, an address, a photo, or a contact detail. A
  report holds a real person's location and photographs.

  This is about this project's own machines. There is one deliberate
  exception on the reporter's own phone: `frontend/src/saved.ts` keeps a
  whole report, photographs and all, when the city refuses it and the
  reporter taps to accept. Nothing about it is sent anywhere and nothing here
  ever sees it. Read that file before touching it, and read the two rules
  about the notice below — the promise a reporter is shown has to keep
  matching what the code does.
- **Never invent a reference number in production.** If the upstream
  submission fails, the citizen is told it failed. Two clients invent one:
  `upstream.Echo`, for local development, and `upstream.NoSubmit`, which is
  the real client with filing turned off and is what staging runs so that
  practice reports stay out of the city's queue. Both say in the reference
  itself that nothing was filed. The page also names the build it is: every
  frontend build not told it is production carries a bar over the form saying
  which environment it was built for. That bar used to carry the promise as
  well and no longer does, so the reference number is now the only place a
  reporter reads it — if a build like this is ever put in front of citizens
  rather than testers, put the sentence back on the bar. See `NotTheRealSite`
  in `frontend/src/app.tsx`. Production runs neither.
- **A failed submission leaves no trace but its log line.** Nothing is
  stored, so `upstream submit failed` in `internal/api` is the whole record.
  Keep it carrying the city's own reply and everything about the attempt
  that is not the citizen's own — never the description, the address, the
  coordinates, or a photograph. Note what that reply can contain: the city
  quotes the title back, and the title is the first 100 characters of the
  description, so this one line can carry a little of the citizen's own words.
  That is a deliberate trade and it is disclosed — `README.md` and
  `sitenotice.tsx` both say so. If you narrow what is logged here, widen the
  notice to match, and never the other way round. The same handler posts a
  line to `ALERT_URL`, which is a third party: that one carries no part of the
  report at all, not even the city's reply, for exactly that reason. See
  `alert` in `internal/api`.
- **Never present this as official.** The notice above `Send report` and the
  one in `README.md` stay. The header's longer notice may be put away — its
  cross hides it for good, and this browser remembers — so the line above the
  button is the copy that has to survive: it says whose site this is as well
  as what sending binds the reporter to, it carries no cross, and there is no
  setting that removes it. Never make that copy dismissable, and never let it
  lose the word "unofficial".
- **Do not hide upstream errors from the logs, or show them to the citizen.**
  The city's site may return HTML or database errors. Log them; show the
  reporter a sentence they can act on.
- **This repository is public. Nothing secret goes in it.** No tokens, API
  keys, account IDs, or private hostnames — not in code, not in a test
  fixture, not in a doc, not in a commit message. Credentials belong in
  GitHub Actions secrets or in `.envrc.local`, which is gitignored;
  `.envrc.local.example` carries the variable names and nothing else. The
  same applies to a real citizen's report: no photograph of a real place, no
  address, no contact detail, in the repo or in an issue.

## Where work is tracked

GitHub Issues, and nowhere else. Do not create a `TODO.md`, a backlog file, a
plan file, or a checklist in the repository, and do not add one to a pull
request as a stand-in. If work needs remembering, it is an issue.

A `TODO` comment is allowed only as a note about the line it sits on. If it
describes work, open an issue and let the comment reference it.

## Driving GitHub from an agent session

What you can do on GitHub depends on the token your session holds, and that
is set up outside this repository — it is not the same on every machine.
Check with `gh auth status`, and otherwise find out by trying rather than
guessing. A maintainer's session normally has write access to code, issues,
workflows, deployments, and environments, so re-running a workflow is yours
to do:

```sh
gh run list --limit 5
gh run rerun <id> --failed
gh run watch <id> --interval 15
```

**Actions secrets are not readable, by any token used here.** `gh secret list`
is refused, and that is correct — see the rule about this repository being
public. You cannot verify that `CLOUDFLARE_API_TOKEN` is set; you can only
read the failure when it is not. Ask, rather than guessing.

If the API refuses something with `403: Resource not accessible`, say so and
ask. Do not retry it in a loop, and **never make an empty or throwaway commit
just to trigger a workflow** — the history is public and permanent, and
`workflow_dispatch` exists for exactly this.

**Report the build stamp every time you deploy.** When a deploy finishes,
say which build went out, in the form the page shows it:

```
YYYY-MM-DDTHH:MM:SSZ <git-sha>
```

The bottom of the page carries that same line, so the maintainer can open
the site and check that what is live is what you just sent. Without it there
is nothing to compare: the site stores nothing, Cloudflare Pages serves each
target from one project, and a deploy that quietly did not replace the old
bundle looks exactly like one that did. The values come from
`__BUILD_TIME__` and `__BUILD_SHA__`, worked out in `frontend/vite.config.ts`
at build time; name the environment you deployed to alongside them.

## Structure

- `backend/internal/report` — the report type and its validation. No HTTP, no
  upstream knowledge. Validation here is the copy that is trusted.
- `backend/internal/upstream` — the only package that knows how the city's
  site works. It has no public API, so this code imitates its web form and
  will break when the form changes. Keep that blast radius here.
- `backend/internal/api` — routes, size limits, CORS. Handlers stay thin.
- `backend/internal/place` — names the street under a pin, so the report
  carries what the city's own form would have put in its location box. It is
  the only part of the backend that talks to anyone but the city. Azure Maps
  when `AZURE_MAPS_KEY` is set; OpenStreetMap's Nominatim otherwise, so a
  developer with no account still gets a working form, at one request a
  second because that is Nominatim's published limit.

  **This is the fallback now, not the first question.** The page asks
  Nominatim itself — see `frontend/src/street.ts` — and only comes here when
  Nominatim could not name a road. Azure stays in the backend because its
  key must never be shipped to a browser, and that is the whole reason this
  endpoint still exists.

  **Azure's answer is the nearest postal address, not the road under the
  pin, and in Davao that is often the wrong road.** Measured over 84 points,
  each the midpoint of a named road within 800 m of the Shell station on
  J. P. Laurel Avenue: Azure named the road the pin actually sits on about
  six times in ten, and answered `type: "Address"` with `confidence: "High"`
  on all 84. At the Shell station itself it answers `8000 Rimas Street`, a
  lane a hundred metres away. So `Place.Street` is always true for a Davao
  pin and `place.Fallback` never fires — do not add a distance check either,
  because the wrong-road answers are often the closest ones (`Santo Niño
  Street` matched `781 Watusi Street` two metres away). This is Azure's data,
  not the API version: `search/address/reverse` v1 gives the same answers.

  **Use this project's own Azure Maps key, never the city's.** Theirs bills
  their account.

  Be exact about what the split buys. The coordinates reach OpenStreetMap
  from the citizen's own phone, which is a change and is disclosed; they
  reach Microsoft only from this backend, so Microsoft never sees the
  citizen's device or network address. The notice in `sitenotice.tsx` names
  both services and says which is asked by whom; keep it doing that. A lookup
  that fails is not an error — the report goes with its coordinates, as it
  did before this existed.

  **Nominatim puts the barangay in `quarter`, not `suburb`.** In Davao
  `suburb` is the district above it. Both this package and `street.ts` read
  `quarter` first; they build the same line and have to keep agreeing.
- `backend/internal/photo` — **the only place photo metadata is decided.** It
  also answers whether a photograph says where it was taken, which is what
  `report.Validate` refuses a report on. It keeps a named few fields and
  drops everything else, by rebuilding the
  metadata from nothing rather than deleting from what arrived, so a tag
  survives only because that file names it. Do not add a second filter
  anywhere, and do not strip in the frontend: `frontend/src/image.ts` carries
  the original block across the resize precisely so this package can be the
  one that judges it.
- `frontend/src/validate.ts` — mirrors the backend rules so the reporter
  learns about a problem before uploading photos. If you change one, change
  both, and remember the backend's answer is the one that counts. A report
  needs at least one photo and a pair of coordinates.

  **The coordinates start at the photograph, and a report cannot begin
  without one.** A photo that does not carry its own place is refused where
  it is chosen, in `PhotoField` in `app.tsx`; `backend/internal/report`
  refuses it again with `photo.HasLocation`, and that is the copy that is
  trusted. Nobody types an address, and there is no way to open a map before
  a photograph has put a place on it. This is deliberate and it turns people
  away: a camera with its location switched off is ordinary, and that
  reporter is told to switch it on rather than being allowed to say where
  they think they were. Do not add a way around that without being asked.

  **The pin can then be nudged, from the `Adjust` link beside the street
  name.** It opens `MapPicker` on the place the photographs gave, so an
  adjustment starts from the photograph rather than from nowhere. Once the
  reporter has moved it, it is theirs: `byReporter` in `LocationField` stops
  another photo dragging it back. Taking the last photo out still takes the
  place with it and forgets what they chose — with no photograph there is
  nothing to file and nowhere to file it. `Draft.address` is the street
  looked up from whatever the pin ends on, and an empty one is fine.
- `frontend/src/draft.ts` — keeps what the reporter has typed *while they are
  writing*, in `sessionStorage`, so an app switch does not lose it. The other
  half of this is `saved.ts`, which is what a report reaches when the city
  will not take it; these two are not the same mechanism and do not share a
  store. The site sends people
  out to their camera app, and a phone short of memory throws the page away
  while they are gone. **The photos are deliberately not kept.** A photo is
  let in only if it carries its own place, which means it was taken in the
  camera app and is still in the reporter's library, so picking it again
  costs two taps — and a photograph of a real place does not belong in a
  browser's storage. `sessionStorage` rather than `localStorage` because a
  phone restores it with the tab it discarded and drops it when the tab
  closes, and phones are lent to people. `sitenotice.tsx` says all of this;
  if what is kept changes, change it there too.
- `frontend/src/saved.ts` — a whole report kept on the reporter's phone
  because the city's site would not take it. **This is the only place in the
  project that keeps a photograph**, and every part of that is narrow on
  purpose: nothing is written unless the reporter taps a button, it goes no
  further than their own browser, and sending or deleting the draft ends it.
  There are two such buttons and they are the same action — one under `Send
  report`, live from the moment a photograph is attached, and one in the
  offer a failed send puts up. Only ever draw one of them at a time: two
  buttons doing one thing on one screen is a reporter deciding which is the
  real one. `sitenotice.tsx` says all of it to the
  reporter, including the two unflattering parts — that somebody else holding
  the phone can open it, and that a phone short of storage may throw it away.
  Change what is kept and change that notice in the same commit.

  IndexedDB, not `localStorage`, which is where this started: photos are
  bytes, `localStorage` holds strings, and base64 puts a phone's photographs
  well past the five megabytes an origin usually gets. The photographs are
  taken apart on the way in — the bytes as an `ArrayBuffer`, the name and
  type beside them — and rebuilt into a `File` on the way out. A browser
  stores a `File` whole, so this is more code than the shortest thing that
  works; it buys one place that says exactly what is kept, and it keeps the
  name, which travels on to the city. Do not check `instanceof ArrayBuffer`
  on what comes back out: it was built in another realm and fails that test.

  They are kept as the camera wrote them and are **not** shrunk. `api.ts`
  shrinks on the way out, so a draft is megabytes where it could be hundreds
  of kilobytes. That is deliberate: a second pass through a JPEG encoder is
  detail nobody agreed to lose, on a photograph that is often of a plate or a
  house number. When there is no room, `saveReport` throws and the reporter
  is told — unlike `draft.ts`, a failure here cannot be quiet, because they
  are about to close the page believing their photographs are safe.

  **Keeping a report raises a sheet, and what happens next depends on why.**
  A report the city refused is finished, so the form is cleared behind it. A
  report kept part-written is not — the reporter pressed the button in order
  to be able to stop — so that ending leaves the form exactly as it was. Each
  way out says what it does to the form, in its own label: the form is behind
  the sheet and cannot be seen from there, and a line of explanation under
  the buttons is read after the reporter has already pressed one.
  Writing it down
  changed nothing a reporter could see — the same notice, the same button —
  so pressing it read as pressing nothing, on the one action where they are
  deciding whether their photographs are safe to walk away from. The sheet
  says the report is *not sent* before it says where it went: a sheet after a
  button press reads as a success, and "sent" is the success easiest to
  assume. The form empties at the same moment, because a form still full of
  the report that was just put away is two of the same thing with no way to
  tell them apart. That is also why `ReportTab` is keyed on a counter and not
  on the draft's id — coming back to the same draft twice has to fill the
  form again, and a key that has not moved rebuilds nothing.

  The reports it holds are drawn at the top of the reports tab, above the
  city's own list and outside it. Keep them there: they exist because the
  city's site was not answering, and on that same day the list below them is
  an error message. A report reachable only through a section that cannot
  load is a report the reporter has lost.
- `frontend/src/image.ts` — shrinking photos before upload. This is the main
  reason the client feels fast. Do not remove it. It also copies the
  original's metadata block onto the resized photo, unread: drawing to a
  canvas would otherwise throw the date and the place away before the backend
  could judge them. The tags describing the old pixels travel with it and are
  wrong; `backend/internal/photo` drops them.
- `frontend/src/disclaimer.tsx` — the disclaimer page, opened from either of
  the two links on the form: the one in the header, and the one beside
  `Send report`. It covers the whole page, holds no frame of anyone
  else's site, and has no scroll box inside it: the way out is the `Close`
  button after the last of the terms, so reaching it means scrolling past
  them. It only puts the two halves below in order — this project's first,
  the city's second.

  The line on the form stays short enough to be read rather than skipped.
  Two facts have to survive that: that nobody official is behind this, and
  that sending a report means agreeing to the city's terms. On the city's
  own site the second is a button the reporter presses, so it cannot live
  only behind a link.

  Both facts are written twice, the way the emergency line is: once in the
  header, and once directly above `Send report`, because the header has been
  scrolled off the screen by the time anyone presses that button. A notice
  that binds somebody belongs next to the thing it binds, and it goes above
  the button rather than below it — the eye travels down to the button and
  stops, and on a phone anything under it can be off the screen. Both copies
  open the disclaimer, so the terms can be read at the moment of agreeing and
  not only before starting. Change one and change the other.

  **Only the header's copy can be put away.** Its cross hides the whole
  paragraph and this browser remembers, so a returning reporter never sees it
  again — that is why the copy above the button had to grow the unofficial
  half, and why that copy has no cross. A reporter who dismissed the header
  still meets both facts on the last screen before the report leaves their
  phone. The flag is `dvo-reports.unofficial-dismissed` in `localStorage`; it
  was renamed from `-minimized` when the cross stopped merely shortening the
  notice, so that somebody who had only agreed to a shorter notice is shown
  the whole of it once more.
- `frontend/src/citynotice.tsx` — the city's disclaimer and privacy terms,
  copied word for word, bar one substitution the file explains. The city has
  no page to link to, so they are carried here, and copied rather than framed
  — an iframe would show the city every reader of this page, and would go
  blank the day they refuse to be framed. The one changed word is named in
  the note above the terms, where a reader sees it: text called somebody's
  exact words has to be. If you refresh the text, change `COPIED_ON` in the
  same commit: the date is what tells a reader how stale the copy is.
- `frontend/src/sitenotice.tsx` — this project's own notice: what it keeps,
  what it promises, and what it does not. Its sibling above carries the
  city's. Keep the two apart — two files, two headings — so a reporter can
  tell whose promise is whose, and keep this one true rather than short: if
  it stops matching what the code does, the code is not the thing that is
  wrong.

  The emergency line is written twice on purpose: once on the page, in the
  header, where nobody has to go looking for it, and once at the top of this
  notice. Change one and change the other.
- `frontend/src/street.ts` — asks OpenStreetMap what road the photographs
  were taken on. `lookupPlace` in `api.ts` calls it first and only asks the
  backend, and so Azure, when there is no road in the answer.

  **The reporter's own phone makes this request, and that is deliberate.**
  OpenStreetMap sees their device and network address as a result. It
  already did: the map above the street name is drawn from OpenStreetMap's
  tiles, fetched by the same phone at the same moment, so this tells them
  nothing new. What it buys is a road that is right — see the measurements
  under `backend/internal/place`. Azure cannot move here, because its key
  must never be in a page.

  Nominatim's policy wants a Referer **or** a User-Agent naming the caller.
  A page cannot set a User-Agent — Chromium drops the header silently, which
  was checked, not assumed — but the browser sends this site's Referer and
  Origin on its own, and that satisfies it. The policy also asks that
  answers be cached and OpenStreetMap be credited: `api.ts` keeps answers
  for the life of the page, and Leaflet draws the credit in the corner of
  the map that is on the screen directly above the street name. There is no
  second credit under the name — one screen, one credit. The one
  client-side thing the policy forbids is autocomplete; do not build one.

  It is behind a dynamic `import()`, like the map and for the same reason:
  nothing can be looked up before a photo is attached, so none of it belongs
  in the first page load.
- `frontend/src/map.tsx` — three maps out of one chunk: the small one drawn
  on the form, the same one opened over it when a reporter taps the
  coordinates on a photo, and the picker behind the `Adjust` link. The first
  two only draw the place the photographs carry; the picker is the one thing
  in the app that moves it, and only because the reporter opened it to do
  that. It is the only code that talks to a third party, and it is loaded
  with a dynamic `import()`. Do not import it from anywhere eagerly: Leaflet
  is fetched once there is a place to draw, which means after a photo is
  attached, and never on the first page load.

  **The map on the form does not move under a finger.** `MapHere` passes
  `still`, which switches off every one of Leaflet's handlers, and that is
  what keeps Leaflet's `leaflet-touch-drag` class — and the `touch-action`
  that comes with it — off the container. A thumb that lands on a map in the
  middle of a form is scrolling the form. The two sheets get the whole
  screen, so they drag as maps should.
- `frontend/brand/citizen-reporter.jpg` — the one piece of artwork. The home
  screen icon and the picture a chat app shows are both cut from it by
  `frontend/scripts/make-brand.mjs` (`make brand`), which needs a browser and
  is never run by a build: what it writes into `frontend/public` is
  committed. Change the artwork or the card's wording, run it, and commit
  what changed. None of it is in the first page load, so none of it counts
  against `make size`.

  **The favicon is the eagle's head, not the whole picture.** The eagle with
  the report card beside it turns to mush at 16 pixels — that was looked at,
  not assumed. The head keeps two strong shapes, the dark eye stripe and the
  hook of the beak, and two is all a 16-pixel square holds. `HEAD` in the
  script says where the head is as a share of the artwork's own box; replace
  the artwork and those four numbers have to be looked at again. Check any
  new favicon at 16 pixels before believing it, because nothing else will.

  **Staging gets a different home screen tile and favicon:** the same eagle
  drawn as a blueprint, traced from the artwork by the same script into
  `frontend/brand/staging`. The favicon is traced at 64 rather than 512 and
  filled rather than left as lines: fine lines found on a large drawing thin
  away to nothing by 16 pixels, and the grid becomes noise. Two identical icons on one phone are two icons a
  maintainer cannot tell apart, and only one of them files a real report.
  Those files are deliberately not in `frontend/public`, which every build
  copies: `blueprintTiles` in `frontend/vite.config.ts` lays them over the
  built ones whenever `DEPLOY_ENV` is not `production`, so `index.html` and
  `site.webmanifest` never have to know which build they are in. It runs on
  a build only — `npm run dev` serves `public/` straight from disk and shows
  the production tile.

  **The card carries the word "unofficial" in the picture itself.** A link
  shared in a group chat is read by people who never open the page, so the
  preview has to say what the header says.

  `site.webmanifest` asks for `display: standalone`, so the icon opens
  without an address bar. That is what makes it worth adding, and it costs
  something: on an iPhone a standalone web app keeps its own storage, so the
  city's session does not travel from Safari and the reporter signs in once
  more. The sheet says so before they add it. It also means no address bar
  is left to say whose site this is, which is why the header's unofficial
  notice is on every screen, the sheet repeats it, and the icon itself is
  never drawn as a seal.

  `og:image` in `frontend/index.html` has to be an absolute URL — a scraper is
  not on this site when it resolves one — and it names the production host
  even in a staging build. A staging link is not shared with citizens and
  both builds serve the same picture, so one hard-coded host is worth more
  than a build-time variable that can be forgotten and left showing nothing.
  Keep the comments in that file to one line each: it is the one HTML a
  citizen downloads, and Vite ships every byte of it.
- `frontend/src/addtohome.tsx` — the sheet telling a reporter how to put the
  site on their home screen. It is offered from the foot of the report form
  and from nowhere else: below `Send report`, after everything the form asks
  for, so it is read last and is in the way of nothing. It used to wait for
  the `Sent` screen, which meant only somebody who had already filed a report
  was ever asked — and the icon is worth most to the reporter who has not
  filed one yet, because it is how they come back a second time. It does not
  belong in the header, which already carries the emergency line and the
  unofficial notice — a third thing beside them weakens the two that have to
  survive being skimmed.

  It shows the steps for both kinds of phone rather than reading the user
  agent, because a wrong guess gives somebody instructions for a phone they
  are not holding. There is no remembered refusal to store: whoever adds the
  site stops being asked, since `offerHomeScreen` hides the offer once the
  page is opened from the icon.

## Conventions

- Go: standard library only. Adding a dependency to the backend needs a
  reason in the commit message.
- Frontend: Preact, no UI framework, no component library. The bundle
  everybody downloads is about 24.4 kB gzipped, and `make size` fails above
  25.5 kB — CI runs it, so growing the first page load means raising the budget
  in `frontend/scripts/check-size.mjs` and saying in the commit message what
  the bytes buy a reporter. Leaflet sits outside that number because it is in
  the map's own chunk — keep new weight behind a dynamic `import()` the same
  way, rather than growing the first page load.
- Photos are sniffed with `http.DetectContentType`, not trusted from the
  upload's `Content-Type` header. This backend hands files to a government
  site.
- The toolchain is pinned in `devbox.json`. Do not add a version to CI that
  is not there.

## Before you say it works

```sh
make lint && make test
```

### When the change is one the eye judges

`make test` renders nothing: jsdom has no layout, so it cannot see one thing
covering another. A map drawn on the form once painted straight over the
sheet opened above it, and every test passed.

```sh
make test-browser     # needs chromium on PATH
```

It drives four things a real browser has to be asked about. It taps the
place on a photo's row, which opens a map over the form, then the `Adjust`
link, which opens the picker, and fails if anything from the form paints over
either sheet. It also drags a finger up the map on the form and fails if that
map moves or the page does not: that map is a picture, and a thumb on it is
scrolling the form. It taps a photo's thumbnail — the one on
its row, and one in the message listing photos that were turned away — and
fails if the form paints over the picture that opens, or if the picture is
drawn barely larger than the square it came from. With two photos attached it
drags a real finger across the open one, and fails if the photograph waiting
at the side shows before it is asked for, if the row does not move under a
finger that is still down, or if the swipe closes the picture rather than
moving along the group. Then it opens the disclaimer and fails if the page
behind shows through, if anything inside it scrolls on its own, or if `Close`
sits on the first screen instead of after the last of the terms. It is not in
CI, which has no browser. Run it after touching a sheet, a map, or anything
layered over anything else, and read the screenshots it names on its last
line.

**Measure before you screenshot, never after.** Taking a screenshot while a
touch is still down moves the finger: the capture re-states the device
metrics, the browser re-reports the touch it is holding at coordinates of its
own, and the row jumps further than any finger went. A check that measured
after the shot read as passing and would have gone on doing so whatever the
code did.

The fixture photo has metadata and no pixels — that is the point of it, since
the metadata reader is tested against those exact bytes. A browser draws it as
a broken image with no size of its own, so `check-lightbox.mjs` paints a real
picture of a known size into every img on the page before it measures
anything. Nothing about how large a photograph is drawn can be read off the
fixture.

Each run serves the site on a port the OS picks and writes its screenshots to
a directory of its own, so several sessions can run it at once on one machine
without driving each other's build or overwriting each other's shots. Nothing
is cleaned up afterwards: the directories are yours to read and to delete.
