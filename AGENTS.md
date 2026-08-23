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
- **Never invent a reference number in production.** If the upstream
  submission fails, the citizen is told it failed. Two clients invent one:
  `upstream.Echo`, for local development, and `upstream.NoSubmit`, which is
  the real client with filing turned off and is what staging runs so that
  practice reports stay out of the city's queue. Both say in the reference
  itself that nothing was filed, and the page says it before that: every
  frontend build not told it is production carries a bar over the form
  saying a report sent from it is not filed. See `NotTheRealSite` in
  `frontend/src/app.tsx`. Production runs neither.
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
- **Never present this as official.** The "unofficial" notice in the header
  and in `README.md` stays.
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
  when `AZURE_MAPS_KEY` is set, which is the city's own geocoder and makes
  the wording match theirs; OpenStreetMap's Nominatim otherwise, so a
  developer with no account still gets a working form, at one request a
  second because that is Nominatim's published limit.

  **Azure does not know every street here, and Nominatim covers for it.**
  Azure's Philippine coverage stops at the named roads: a pin on an unnamed
  lane answers `Davao, Philippines 8000`, which is the right city and
  nothing else. `place.Fallback` asks Nominatim in exactly that case and
  files its answer instead, keeping Azure's when Nominatim has nothing
  better. Azure says which case it is through `Place.Street`, read from the
  feature type in its reply — anything but `Address` means it matched
  something coarser than a street. Do not ask both on every lookup: the
  common case is Azure knowing the answer, and a second question every time
  would spend Nominatim's one-a-second allowance on nothing.

  **The city's own Azure key is readable in their public JavaScript. Do not
  use it.** It bills their account, and this repository is public.

  It lives in the backend, not the browser: Nominatim wants a User-Agent
  naming the caller, a page cannot set one, and a key must never be shipped
  to a browser. Be exact about what that buys: the coordinates still reach
  Microsoft, and Nominatim on a miss, but they arrive from this backend, so
  neither service ever sees the citizen's device or network address. The
  notice in `sitenotice.tsx` names both services; keep it naming them. A
  lookup that fails is not an error — the report goes with its coordinates,
  as it did before this existed.
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

  **The coordinates come from the photograph, and from nowhere else.** A
  photo that does not carry its own place is refused where it is chosen, in
  `PhotoField` in `app.tsx`; `backend/internal/report` refuses it again with
  `photo.HasLocation`, and that is the copy that is trusted. Nobody types an
  address, nobody drags a pin, and there is no place picker to open. This is
  deliberate and it turns people away: a camera with its location switched
  off is ordinary, and that reporter is told to switch it on rather than
  being allowed to say where they think they were. Do not add a way around
  it without being asked. `Draft.address` is the street looked up from those
  coordinates, and an empty one is fine.
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

  The second fact is written twice, the way the emergency line is: once in
  the header, and once directly above `Send report`, because the header has
  been scrolled off the screen by the time anyone presses that button. A
  notice that binds somebody belongs next to the thing it binds, and it goes
  above the button rather than below it — the eye travels down to the button
  and stops, and on a phone anything under it can be off the screen. Both
  copies carry the same sentence and both open the disclaimer, so the terms
  can be read at the moment of agreeing and not only before starting. Change
  one and change the other.
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
- `frontend/src/map.tsx` — the small map drawn on the form, and the same map
  opened over it when a reporter taps the coordinates on a photo. Neither
  one chooses anything: they draw the place the photographs carry. It is the
  only code that talks to a third party, and it is loaded with a dynamic
  `import()`. Do not import it from anywhere eagerly: Leaflet is fetched once
  there is a place to draw, which means after a photo is attached, and never
  on the first page load.
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
  site on their home screen. It is offered from the `Sent` screen and from
  nowhere else: that is after the reference number, where the offer is
  earned and where it cannot be in the way of writing a report. It does not
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
  everybody downloads is about 20.8 kB gzipped, and `make size` fails above
  22 kB — CI runs it, so growing the first page load means raising the budget
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

It drives two things a real browser has to be asked about. It taps the place
on a photo's row, which opens a map over the form, and fails if anything from
the form paints over that sheet. Then it opens the disclaimer and fails if the
page behind shows through, if anything inside it scrolls on its own, or if
`Close` sits on the first screen instead of after the last of the terms. It is
not in CI, which has no browser. Run it after touching a sheet, a map, or
anything layered over anything else, and read the screenshots it names on
its last line.

Each run serves the site on a port the OS picks and writes its screenshots to
a directory of its own, so several sessions can run it at once on one machine
without driving each other's build or overwriting each other's shots. Nothing
is cleaned up afterwards: the directories are yours to read and to delete.
