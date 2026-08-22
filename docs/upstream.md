# The upstream site

`reports.davaocity.gov.ph` has no documented API. Everything this project
sends it was worked out by reading its own front end, so every field name and
response shape here is a guess that the city's site currently agrees with.
When the city changes its form, `internal/upstream` breaks and nothing else
does. That is the point of keeping it in one package.

The API root is in `upstream.DefaultBaseURL`. It is an Azure Functions app,
named in the city site's `js/main2.js`.

## Filing a report

A report needs a signed-in reporter. There is no anonymous path.

1. `GET verify/?email=<email>&trans=sendOTP` — the city sends a one-time
   code. The account must already exist and have a verified e-mail address.
   Registering is done on the city's own site; this project does not offer
   it.
2. `GET verify?email=<email>&otp=<six digits>&trans=verifyotp` — returns a
   session token and when it expires.
3. `POST complainController` — `multipart/form-data`, carrying `trans`,
   `xtk` (the token), `contno`, `title`, `complain`, `location`,
   `coordinates`, and `imagefile` once per photo.

The token is **not** a bearer token. The city wants it as a form field on
POSTs and a query parameter on GETs.

## Two requests, one submission

The city files a report in two steps: `trans=ADD` creates it and returns the
control number, then `trans=ATTACH` re-sends the same fields with `contno`
set and the photos added. `City.Submit` does both and a caller sees one
submission.

If `ADD` succeeds and `ATTACH` fails, the report exists and has a real
reference. `Submit` returns that reference with an error wrapping
`ErrPhotosNotAttached`, and the API answers `201` with a warning. Reporting a
plain failure would tell the citizen their report was not filed when it was.

## Fields the city does not have

- **No category.** The city's form has no category, office, or department
  field. `report.Categories` is this project's own idea. The category becomes
  a prefix on the `title` built from the description — except `other`, which
  has no useful label and gets no prefix.
- **No contact field.** The city takes the reporter's contact details from
  their account, so `Report.Contact` has nowhere to go and is not sent.
- **No tracking URL.** Following a report is another authenticated call, and
  the city renders it in a modal. There is no page to link to, so
  `Receipt.TrackURL` stays empty.
- **Location is required.** The city's form refuses an empty `location`, so a
  report carrying only coordinates sends those as the location text.

## Ground rules

- **One package.** All of it goes in `internal/upstream`. When the city
  changes its form, only that package breaks.
- **Be a polite client.** One submission is at most two requests, and only
  two when there are photos. No retries in a loop, no parallel floods, no
  scraping the site for anything other than what a submission needs.
- **Store nothing.** Reports hold a citizen's location, photos, and possibly
  their contact details. The session token and the reporter's e-mail address
  are relayed and never held: they live in the reporter's own browser. Do not
  add a database, a queue, or a log line that prints the report body, the
  e-mail address, or the token.
- **Never invent a reference.** If the upstream submission fails, the citizen
  must be told it failed. A fake receipt means someone believes their problem
  was reported when it was not. `upstream.Echo` invents references and is for
  local development only; the server picks it only when `UPSTREAM=echo`.
