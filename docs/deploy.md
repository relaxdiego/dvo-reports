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
target from what triggered it:

| Trigger        | Cloudflare branch | Lands on                          |
| -------------- | ----------------- | --------------------------------- |
| Push to `main` | `staging`         | `report-staging.relaxdiego.com`   |
| Tag `v*`       | `production`      | `report.relaxdiego.com`           |
| Pull request   | `pr-<number>`     | a throwaway preview URL           |

So `main` is always live on staging, and production only moves when you tag a
release:

```sh
git tag -a v0.2.0 -m 'v0.2.0' && git push origin v0.2.0
```

Nothing is published unless `make lint`, `make test`, and `make build` pass
first: the deploy job needs the check job, which is why both live in one
workflow file. GitHub cannot express that dependency across two.

Pull requests opened from a fork get no preview. GitHub withholds secrets
from them, so the deploy could not work, and the job is skipped rather than
failing.

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

3. **GitHub Environments** named `production`, `staging`, and `preview`. Give
   each a variable `VITE_API_BASE` holding its backend URL. The frontend is
   baked at build time, so changing one needs a new deploy.

4. **Custom domains, after the first deploy to each branch.** A branch alias
   only exists once that branch has deployed at least once, so do this after
   a push to `main` (staging) and after the first `v*` tag (production).

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

Consider requiring a reviewer on the `production` environment. It is the only
thing standing between a tag and every citizen who uses the site.

## Backend

`cmd/server` is an ordinary Go HTTP server with no cloud SDK. That keeps the
hosting choice reversible:

- **Container host** (DigitalOcean App Platform, Fly.io, Cloud Run). Build
  `backend` and run `bin/server`. It reads `PORT`, which all of them set.
- **AWS Lambda** behind the [Lambda Web Adapter][lwa] layer. The adapter
  speaks HTTP to the process, so no code changes. Put a Function URL or API
  Gateway in front.
- **DigitalOcean Functions** would need a small adapter, because its Go
  runtime calls a `Main(...)` function rather than serving HTTP. That adapter
  does not exist yet.

Deploy the backend twice, once per environment, from the same commit as the
frontend that talks to it.

[lwa]: https://github.com/awslabs/aws-lambda-web-adapter

### Environment

| Variable          | Default                 | Meaning                                          |
| ----------------- | ----------------------- | ------------------------------------------------ |
| `PORT`            | `8080`                  | Listen port.                                     |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the API. |

`ALLOWED_ORIGINS` must name the frontend for that environment — the two are
on different hosts, so a wrong value shows up as every submission failing in
the browser with a CORS error. On staging it also has to include the
Cloudflare preview URLs if you want pull request previews to work against the
staging backend; those are `https://<something>.dvo-reports.pages.dev`, and
the list is exact matches only.

### A note on cold starts

A function that sleeps answers the first report slowly, which is the exact
problem this project exists to fix. If you deploy to Lambda or another
scale-to-zero runtime, either keep one instance warm or accept that the first
report of the day is slow.
