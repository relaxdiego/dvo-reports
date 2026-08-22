# dvo-reports

A faster, unofficial way to report a city issue to
[reports.davaocity.gov.ph](https://reports.davaocity.gov.ph).

It is a thin client, not a replacement. You fill in a short form, it shrinks
your photos in the browser, and it passes the report to the city's own site.
Nothing is stored here.

**This project is not run by the Davao City government.** It is community
software. The city's site remains the system of record.

- Frontend: <https://report.relaxdiego.com> (Preact + TypeScript, ~11 kB gzipped)
  — staging at <https://report-staging.relaxdiego.com>
- Backend: Go, one plain HTTP handler, no framework, no dependencies

## Why

The official site is slow, and uploading photos from a phone on a mobile
connection is the slowest part of it. Two things fix most of that:

1. **Shrink photos before they leave the phone.** A camera file is 3–8 MB. A
   1600 px JPEG is a few hundred kB and just as readable.
2. **Send a small page.** The whole app is one request and a few kilobytes.

## Status

Early. Both halves are written: the backend files reports through the city's
own API, and the frontend has the sign-in step, the form, and a second tab
listing what you have already reported. None of it has yet been used against
the city's live site, so every field name is still a guess read off their
front end — see [docs/upstream.md](docs/upstream.md).

**You need an account on the city's own site first**, and the phone that goes
with it. The city will not accept a report from an anonymous citizen: you give
your e-mail address, it texts a one-time code to the phone number registered
against that address, and this app relays the code and nothing else.
Registering happens on <https://reports.davaocity.gov.ph>, not here.

## Running it

The toolchain is pinned with [devbox](https://www.jetify.com/devbox) and
loaded by [direnv](https://direnv.net), so everyone and CI get the same Go
and Node.

```sh
git clone https://github.com/relaxdiego/dvo-reports
cd dvo-reports
direnv allow          # or: devbox shell
cp .envrc.local.example .envrc.local   # optional, for local overrides
```

Then, in two terminals:

```sh
make dev-backend      # Go API on :8080
make dev-frontend     # Vite on :5173, proxying /api to :8080
```

Open <http://localhost:5173>. `make help` lists every target.

## Layout

```
backend/
  cmd/server/          the HTTP server
  internal/report/     what a report is, and what makes it valid
  internal/upstream/   the only code that knows about the city's site
  internal/api/        HTTP routes, limits, CORS
frontend/
  src/image.ts         shrinking photos in the browser
  src/api.ts           talking to the backend
  src/session.ts       the city session, kept in this browser only
  src/app.tsx          the form, and the reports already filed
docs/
  deploy.md            Cloudflare Pages, staging, and the backend host
  upstream.md          what is still unknown about the city's site
```

## Testing

```sh
make test             # Go tests and frontend tests
make lint             # go vet, gofmt, tsc
```

## Privacy

A report can carry your location, photos, and contact details. This backend
keeps none of it: the request is read into memory, passed to the city's site,
and dropped. Logs record the category, the number of photos, and the
resulting reference number — never the report itself. See
[docs/upstream.md](docs/upstream.md).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
GitHub Issues is the only place this project tracks bugs and requests. The
most useful contribution right now is documenting how the city's submit form
actually works.

Please do not paste a real report into an issue: no photographs of a real
place, no address, no contact details. The tracker is public.

## License

[Apache-2.0](LICENSE).
