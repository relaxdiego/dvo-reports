# Deploying

Two pieces, deployed separately, in two environments.

| Environment | Frontend                    | Backend                            |
| ----------- | --------------------------- | ---------------------------------- |
| Production  | `report.relaxdiego.com`     | `api.report.relaxdiego.com`        |
| Staging     | `report-staging.relaxdiego.com` | `api.report-staging.relaxdiego.com` |

## Frontend

The static bundle goes to **Cloudflare Pages**, in one project named
`dvo-reports`. Cloudflare serves any number of branches from a single
project, which is why it is used here rather than GitHub Pages: Pages gives a
repository one site and one custom domain, so a staging site would have meant
a second repository.

`.github/workflows/ci.yml` runs the checks first, then picks the deploy
targets from what triggered it. The Cloudflare branch and the Fly app are
both named after the environment.

**Before launch** — where the project is now — a push to `main` deploys
both, so the real site is always whatever is on `main`:

| Trigger        | Environments             |
| -------------- | ------------------------ |
| Push to `main` | `staging`, `production`  |
| Tag `v*`       | `production`             |

**After launch**, set `LAUNCHED: 'true'` in the `targets` job of
`.github/workflows/ci.yml`. A push to `main` then reaches staging only, and
production moves when you tag a release:

| Trigger        | Environments |
| -------------- | ------------ |
| Push to `main` | `staging`    |
| Tag `v*`       | `production` |

```sh
git tag -a v0.2.0 -m 'v0.2.0' && git push origin v0.2.0
```

That flag is the only thing to change on launch day. Flip it before the site
is announced, not after: from then on a commit reaches citizens only through
a tag you chose to push.

Nothing is published unless `make lint`, `make test`, and `make build` pass
first: the deploy job needs the check job, which is why both live in one
workflow file. GitHub cannot express that dependency across two.

**A pull request is checked and never deployed.** No preview URL, and no
backend of its own. Code that has not been merged does not reach a server,
whether it came from this repository or a fork. Review a pull request by
running it locally:

```sh
gh pr checkout <number>
devbox run -- make lint && devbox run -- make test
devbox run -- make dev
```

A manual `workflow_dispatch` run deploys the same environments as a push to
`main` does.

### One-time setup

1. **Cloudflare Pages project** named `dvo-reports`, created with
   *Direct Upload* (not the Git integration — this workflow pushes the build):

   ```sh
   npx wrangler pages project create dvo-reports --production-branch=production
   ```

   A Direct Upload project cannot be switched to Git integration later. To
   change that decision you make a new project.

2. **Repository secrets:** `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. The token needs one permission —
   *Account · Cloudflare Pages · Edit*.

3. **GitHub Environments** named `production` and `staging`. Give
   each a variable `VITE_API_BASE` holding its backend URL. The frontend is
   baked at build time, so changing one needs a new deploy.

4. **Custom domains, after the first deploy to each branch.** A branch alias
   only exists once that branch has deployed at least once, so do this after
   the first push to `main` has deployed both.

   `report.relaxdiego.com` is the project's production domain: add it under
   *Custom domains* in the Pages project and let Cloudflare create the record.

   `report-staging.relaxdiego.com` points at a branch, which takes an extra
   step. Add it as a custom domain the same way, then open DNS for the zone,
   find the `CNAME` record named `report-staging`, and change its target from
   `dvo-reports.pages.dev` to `staging.dvo-reports.pages.dev`.

   **The record must stay proxied** (orange cloud). Cloudflare's docs are
   explicit: with an unproxied record, or DNS hosted elsewhere, the custom
   alias is served the *production* branch instead. That failure is silent —
   staging would quietly show production.

The `production` environment requires a reviewer, so every deploy to it
waits for an approval on the run. That is deliberate: it is the only thing
standing between a commit and every citizen who uses the site. Before launch
it also means the production half of a push to `main` sits and waits until
you approve it — the staging half does not wait with it, and neither holds up
the next commit's deploy.

## Backend

Two Fly apps, one per environment, built from `backend/Dockerfile`:

| Environment | Fly app                    | Config                       |
| ----------- | -------------------------- | ---------------------------- |
| Staging     | `dvo-reports-api-staging`  | `backend/fly.staging.toml`   |
| Production  | `dvo-reports-api`          | `backend/fly.production.toml`|

CI deploys them, to the same environments as the frontend and in the same
run. A pull request deploys nothing.

Both apps scale to zero. The first request after an idle period waits for the
machine to start, well under a second, and the city's own API is slower than
that. Set `min_machines_running = 1` in the config to buy it back.

### One-time setup

This needs a Fly account, so it cannot be done from a session working in this
repository.

1. **Create the two apps**, without deploying:

   ```sh
   fly apps create dvo-reports-api-staging
   fly apps create dvo-reports-api
   ```

2. **Make a deploy token** and add it as the `FLY_API_TOKEN` repository
   secret:

   ```sh
   fly tokens create deploy -a dvo-reports-api-staging
   fly tokens create deploy -a dvo-reports-api
   ```

   A token is scoped to one app, so either add both as environment-scoped
   secrets on the `staging` and `production` GitHub Environments, or use one
   org token for both. Environment-scoped is the safer of the two: a staging
   deploy then cannot touch production.

3. **Push to `main`.** CI builds the image and deploys it. The staging app
   answers at `https://dvo-reports-api-staging.fly.dev/healthz`.

4. **Set `VITE_API_BASE`** on the matching GitHub Environment to the backend
   for that environment, then redeploy the frontend. It is baked in at build
   time.

### Environment

| Variable          | Default                 | Meaning                                          |
| ----------------- | ----------------------- | ------------------------------------------------ |
| `PORT`            | `8080`                  | Listen port. Fly sets this.                      |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the API. |
| `UPSTREAM`        | `city`                  | `nosubmit` reads the city but files nothing; `echo` answers everything without the city. |
| `UPSTREAM_BASE_URL` | the city's API        | Override for testing against a fake.             |
| `AZURE_MAPS_KEY`  | unset                   | Names the street under a pin. Unset falls back to OpenStreetMap. |
| `AZURE_MAPS_BASE_URL` | Azure Maps          | Override for testing the street lookup.          |
| `NOMINATIM_BASE_URL` | OpenStreetMap's      | Override for the fallback, for testing.          |

### The street under a pin

The city's own form fills its location box by reverse geocoding the pin with
Azure Maps, and files that text. This backend does the same so a report reads
the same, using **this project's own Azure Maps key** — never the city's,
which is readable in their public JavaScript and bills their account.

`AZURE_MAPS_KEY` is a **Fly secret**, not a value in `fly.*.toml` and not a
GitHub Actions secret: the backend reads it at runtime, and CI only deploys.

```sh
fly secrets set AZURE_MAPS_KEY=... -a dvo-reports-api-staging
fly secrets set AZURE_MAPS_KEY=... -a dvo-reports-api
```

Setting a secret restarts the app. Leave it unset and the backend uses
OpenStreetMap's Nominatim instead, which needs no account and is what a
developer gets locally; it is rate limited to one request a second, which is
that service's own published limit.

Without either, nothing breaks. A report then travels with its coordinates in
the location field, which is what the city's form received before any of this
existed.

`ALLOWED_ORIGINS` is set in each `fly.*.toml`. It must name the frontend for
that environment — the two are on different hosts, so a wrong value shows up
as every submission failing in the browser with a CORS error. The list is
exact matches only. A frontend run locally is served from
`http://localhost:5173`, which is the default and is not in either deployed
list.

### What staging sends the city

**`UPSTREAM` must be `city` in production, and must never be `echo` in either
deployed environment.** Echo answers every call itself, so a citizen would be
told their report was filed when it was not, and `internal/upstream` — the
package most likely to break, because it imitates a form nobody documents —
would never run at all.

**Staging sets `UPSTREAM=nosubmit`.** That is the real city client with
filing turned off. Signing in, listing your own past reports and reading what
became of one all reach the city and are parsed by the same code production
runs, so a change on their side shows up in staging. `Submit` is the only
call that writes to their database, and it is the one that is stubbed: the
city's queue is worked by people, and a practice report is work for them. A
submission on staging comes back as `NOT-FILED-0001`, which is what the
reporter is shown, because a number that could pass for the city's would be a
lie.

**So the filing path is exercised in production, by real reports, and
nowhere else.** That is a deliberate trade: no test submissions, and the
first sign of a broken `Submit` is a citizen's report failing. What makes it
affordable is the log — `upstream submit failed` carries the city's own
reply, which of the two calls failed, the photo count and total bytes, and
how long it took. Nothing is stored, so that line is the only record the
failure leaves. See "Watching for a broken submit" below.

### Watching for a broken submit

The city's API is not documented and can change without warning. When it
does, `Submit` starts failing in production and nothing else notices, so the
log line is worth watching:

```sh
fly logs -a dvo-reports-api | grep 'upstream submit failed'
```

**Fly does not alert on what a log line says.** Their own docs are explicit:
"Fly.io doesn't include built-in alerting on metrics, so you'll need to set up
alerting yourself." The only mail Fly sends by itself is for a failed deploy
and for a machine running out of memory. Getting an email when a submission
fails needs one of:

- **Ship the logs out.** Fly's log search in Grafana keeps 7 days and cannot
  alert. A log shipper, or the Logs API, sends them to a service that can —
  Sentry, Better Stack, Axiom. Least code, one more account.
- **Count the failures and alert on the number.** The backend would expose a
  counter, Fly's Prometheus would scrape it, and a Grafana alert rule would
  mail on `increase(...) > 0`. Fly's own managed Grafana at fly-metrics.net
  cannot hold alert rules, so the rule lives in a Grafana Cloud account or a
  self-hosted one.
- **Mail from the backend.** `net/smtp` is in the standard library, so this
  adds no dependency, but it adds a secret, and a bad afternoon on the city's
  side becomes a mailbox full of identical messages unless it is rate
  limited.

None of these is built yet.

### Moving off Fly

`cmd/server` is an ordinary Go HTTP server with no cloud SDK, and the
Dockerfile is a plain multi-stage build. Anything that runs a container and
sets `PORT` will do: DigitalOcean App Platform, Cloud Run, or AWS Lambda
behind the [Lambda Web Adapter][lwa]. DigitalOcean Functions would need a
small adapter, because its Go runtime calls a `Main(...)` function rather
than serving HTTP; that adapter does not exist.

[lwa]: https://github.com/awslabs/aws-lambda-web-adapter
