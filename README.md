# dvo-reports

A faster, unofficial way to report a city issue to
[reports.davaocity.gov.ph](https://reports.davaocity.gov.ph).

It is a thin client, not a replacement. You fill in a short form, it shrinks
your photos in the browser, and it passes the report to the city's own site.
Nothing is stored here.

**This project is not run by the Davao City government.** It is community
software. The city's site remains the system of record.

- Frontend: <https://dvo-reports.pages.dev> (Preact + TypeScript, ~20 kB gzipped
  on first load)
  — staging at <https://staging.dvo-reports.pages.dev>
- Backend: Go, `net/http` and nothing else — no framework, no dependencies

## Why

The official site is slow, and uploading photos from a phone on a mobile
connection is the slowest part of it. Two things fix most of that:

1. **Shrink photos before they leave the phone.** A camera file is 3–8 MB. A
   1600 px JPEG is a few hundred kB and just as readable.
2. **Send a small page.** The whole app is one request and a few kilobytes.

## Status

Working, and young. Both halves are written and deployed: the backend files
reports through the city's own API, and the frontend has the sign-in step, the
form, and a second tab listing what you have already reported. A real report
has been filed end to end through staging and reached the city with a working
reference number.

Most of what this project knows about the city's site was still read off their
front end rather than documented by them, so it can break when they change
their form. See [docs/upstream.md](docs/upstream.md), which marks what has been
confirmed against the live site and what is still a guess.

The site runs on its Cloudflare Pages URLs for now. The custom domains are
held back on purpose until it has been used by the people it is for.

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
  internal/photo/      what metadata a photo may carry onward
  internal/place/      the street name under a photo's coordinates
  internal/upstream/   the only code that knows about the city's site
  internal/api/        HTTP routes, limits, CORS
frontend/
  src/image.ts         shrinking photos in the browser
  src/api.ts           talking to the backend
  src/session.ts       the city session, kept in this browser only
  src/validate.ts      the backend's rules, mirrored for early warnings
  src/street.ts        asking OpenStreetMap what street the photos were taken on
  src/map.tsx          drawing the place the photos carry, on an OpenStreetMap map
  src/app.tsx          the form, and the reports already filed
  src/disclaimer.tsx   the terms, opened from the form
  src/sitenotice.tsx   what this site promises, and what it does not
  src/citynotice.tsx   the city's own terms, copied word for word
docs/
  deploy.md            Cloudflare Pages, staging, and the backend host
  upstream.md          what is known, and still unknown, about the city's site
```

## Testing

```sh
make test             # Go tests and frontend tests
make lint             # go vet, gofmt, tsc
make size             # check the first page load against its budget
make test-browser     # needs chromium; checks the sheets drawn over the form
```

## Privacy

A report carries your location and your photos. This backend keeps none of it:
the request is read into memory, passed to the city's site, and dropped. There
is no database. Logs record the category, the number of photos, their total
size, how long the city took, and the resulting reference number — never the
description, the address, or the coordinates.

**One exception, and it is worth knowing.** When the city refuses a report, its
reply is written to the log, because nothing is stored and that line is the
only record left to find the fault in. The city's reply can quote the report's
title back, and that title is built from the first 100 characters of your
description. So a report that *fails* can leave a short piece of your own words
in a log. A report that succeeds does not. See
[docs/upstream.md](docs/upstream.md).

**Photos carry more than the picture.** A phone writes the camera model, the
software version, every exposure setting, a private block from the
manufacturer, a second copy of the image as a thumbnail, and where the
photograph was taken. This backend removes almost all of it before the report
goes on. What it keeps is a short, deliberate list: the date and time, with the
time zone offset that makes it a real time, and the whole GPS block — the
position, and the altitude, bearing, speed and error radius that describe the
same reading. They are kept so the place a photo was taken can be checked
against the place the report names. The camera model, the software, the
settings, the thumbnail, the manufacturer's private block, and every other
embedded block are dropped. The list lives in `backend/internal/photo`, and the backend
is the only place it is applied.

**Your photos must say where they were taken.** This site starts your report
at the place written inside the photograph. You cannot type an address, and a
photo taken with the camera's location switched off is refused: you are asked
to switch it on and take the picture again. That is a deliberate choice — a
report the city can act on has to say where the problem is, and the camera is
the only thing here that knows. Once a photo has put the pin down, `Adjust`
beside the street name lets you move it, for the times the camera was a street
out.

**Two things reach a third party, and both of them are only a place.**

*The map.* Once a photo is attached, the place it recorded is drawn on a map,
and your browser asks
[OpenStreetMap](https://www.openstreetmap.org/copyright) for the squares of
map around that spot. Those requests go straight from your phone to their
servers, so they reveal roughly where the photograph was taken.

*The street name.* To put a street on your report, your browser sends the
photo's coordinates, and nothing else, to OpenStreetMap's Nominatim. That
request goes straight from your phone, so it reveals the same thing the map
squares already do, at the same moment. When Nominatim cannot name a road,
this backend asks Microsoft's Azure Maps instead; that request is made by the
backend, not by your phone, so Microsoft never sees your device or your
network address.

No other part of your report is ever sent to any of them.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
GitHub Issues is the only place this project tracks bugs and requests. The most
useful contribution right now is telling us when the city changes their form
and this client stops matching it — see
[docs/upstream.md](docs/upstream.md) for what is known about it.

Please do not paste a real report into an issue: no photographs of a real
place, no address, no contact details. The tracker is public.

## License

[Apache-2.0](LICENSE).
