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

   **The code arrives by SMS, not by e-mail.** The request is keyed on the
   e-mail address, but the city texts the code to the phone number registered
   against that address, and the two are tied together during registration.
   This was confirmed against the live site; it cannot be read from their
   front end, which is why the sign-in used to word it vaguely. A reporter
   needs that phone with them, so the app says so before asking.
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

## Reading a reporter's own reports

The city's tracking page reads two more calls with the same token
(`js/trackingView.js`). Both are GETs, so `xtk` travels as a query parameter.

1. `GET reportController?trans=getuserdetails&xtk=<token>` — every report the
   account has filed. Each item carries `controlno`, `title`, `complain`,
   `location`, `attachments` (each with a `link` and a `label`),
   `date_reported`, and `current_status`. The order is not promised, so the
   browser sorts it.
2. `GET complainController?trans=getdetails&controlno=<no>&xtk=<token>` — what
   became of one report: `data[]` of status steps, each with `status`,
   `officename`, and `startdate`; `result[]` for what an office answered; and
   `invalid.reason` or `resubmit.reason` for a status that needs one. An
   unknown control number comes back with an empty `data`, and so does one
   belonging to another reporter — the token decides whose reports can be
   read.

The `attachments` on a listed report are confirmed against the live site: a
report filed with photos comes back with a usable `link` for each one.

A dead session is `isValid: false` on both, the same as on a submission. When
the session is good the key is absent, so its absence is not a refusal.

### What a real reply looks like

The history call is the first part of the city's API this project has seen
answer for real, rather than guessed from their front end. Four things in it
are worth writing down, because none of them can be read off their code:

- **Empty means an empty array, not an empty object.** `invalid`, `resubmit`,
  and `result` come back as `[]` when there is nothing in them, and as an
  object (`invalid`, `resubmit`) or a filled array (`result`) when there is.
  A decoder that expects only the object form fails on the whole reply.
- **Timestamps are `2026-03-14 16:55:59`.** No `T`, no time zone; local time
  in Davao. Some browsers refuse that layout, so the frontend repairs it
  before reading it. `enddate` is `null` on the step in progress.
- **Text is HTML-escaped.** An office called `CITY MAYOR'S OFFICE` arrives as
  `CITY MAYOR&#039;S OFFICE`. The same goes for a report's own title,
  description, and location in the list.
- **There is a second number.** `referenceno` sits beside the control number
  and is the one the city's own staff quote back. It is empty until their
  office has issued it.

`data[]` also carries a `details` field, which on the first step repeats the
whole report body. This project does not read it: the reporter already has
their own words, and it is one more copy of a citizen's report moving through
a server that is supposed to keep none.

The status words the city uses are `REPORTED`, `ENCODED`, `FORVERIFICATION`,
`FORREMARKS`, `RECEIVED`, `PENDING`, `ONGOING`, `RESOLVED`, `COMPLETED`, plus
`INVALID` and `FORRESUBMISSION`.

**Timestamps are passed through unparsed.** `date_reported` and `startdate`
have no documented layout, and the city's own page hands them to the
browser's `Date`. This project does the same rather than guess a layout and
lose the value.

## Fields the city does not have

- **No category.** The city's form has no category, office, or department
  field. `report.Categories` is this project's own idea. The category becomes
  a prefix on the `title` built from the description — except `other`, which
  has no useful label and gets no prefix.
- **No contact field.** The city takes the reporter's contact details from
  their account. The form used to ask for one and had nowhere to send it, so
  the field is gone: asking a citizen for a contact detail that is thrown away
  is misleading, and it kept one more personal detail moving through this
  backend for no benefit.
- **No tracking URL.** Following a report is another authenticated call, and
  the city renders it in a modal. There is no page to link to, so
  `Receipt.TrackURL` stays empty. The past reports tab makes that call itself
  instead; see above.
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
