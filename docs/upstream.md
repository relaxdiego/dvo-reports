# The upstream site

`reports.davaocity.gov.ph` has no documented API. Everything this project
sends it has to be worked out from what its own web form does.

That work has not been done yet. `internal/upstream.Echo` stands in: it
accepts every valid report and invents a reference number, which is enough to
build and demonstrate the frontend.

## What is needed

1. The submit endpoint: URL, method, field names, and how photos are attached.
2. Whether a session, CSRF token, or captcha is required first.
3. The real list of categories, which replaces `report.Categories`.
4. What a successful response looks like, and where the tracking reference
   appears in it.
5. Whether a tracking URL exists for `Receipt.TrackURL`.

## Ground rules

- **One package.** All of it goes in `internal/upstream`. When the city
  changes its form, only that package breaks.
- **Be a polite client.** One request per report. No retries in a loop, no
  parallel floods, no scraping the site for anything other than what a
  submission needs.
- **Store nothing.** Reports hold a citizen's location, photos, and possibly
  their contact details. They pass through memory and are gone. Do not add a
  database, a queue, or a log line that prints the report body.
- **Never invent a reference.** If the upstream submission fails, the citizen
  must be told it failed. A fake receipt means someone believes their problem
  was reported when it was not.
