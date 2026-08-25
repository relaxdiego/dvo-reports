# Deploying

Two pieces, deployed separately, in two environments.

| Environment | Frontend                          | Backend                                  |
| ----------- | --------------------------------- | ---------------------------------------- |
| Production  | `dvo-reports.pages.dev`           | `dvo-reports-api.fly.dev`                |
| Staging     | `staging.dvo-reports.pages.dev`   | `dvo-reports-api-staging.fly.dev`        |

**These are the platforms' own URLs, and that is on purpose.** There is no
custom domain, and the name is not decided: one gets chosen once the site has
been used by the people it is for, since a public name is easier to give out
than to take back. Setting one up is written out under "One-time setup" below,
and tracked as an open issue. `ALLOWED_ORIGINS` in `backend/fly.*.toml` names
the URLs above, so it moves in the same step as the domains and not before.

## Frontend

The static bundle goes to **Cloudflare Pages**, in one project named
`dvo-reports`. Cloudflare serves any number of branches from a single
project, which is why it is used here rather than GitHub Pages: Pages gives a
repository one site and one custom domain, so a staging site would have meant
a second repository.

`.github/workflows/ci.yml` checks, builds once, then walks one run through
both environments in order. The Cloudflare branch and the Fly app are both
named after the environment.

```
check -> build -> staging -> [reviewer gate] -> production
```

Every push to `main` does all of it. Staging is reached on its own; production
waits at the `production` Environment's reviewer gate until somebody approves
the job, and **approving is the one deliberate act between a commit and a
citizen.** There is nothing to dispatch by hand, nothing to remember on launch
day, and no flag to flip.

GitHub cancels a run that nobody approves within 30 days.

**One build serves both.** The `build` job builds the backend image and the
site once, and staging and production publish those same bytes. Nothing about
an environment is baked into either half any more:

- The backend image is pushed to this repository's container registry and
  both deploys name it **by digest**, so production runs the bytes staging was
  tested with. `ALLOWED_ORIGINS` and `UPSTREAM` come from
  `backend/fly.<environment>.toml` and are applied to the machine at deploy
  time.
- The site is built with no `DEPLOY_ENV` and no `VITE_API_BASE`. Each deploy
  writes `data-env` and `data-api` into the `<html>` tag of the copy it
  publishes, and lays the blueprint tiles over the real ones for anything
  that is not production. `.github/scripts/name-environment.sh` does both, and
  is the one piece the two deploy jobs share; `frontend/src/config.ts` reads
  the two attributes when the page loads.

This is worth the indirection because a rebuild of the same commit is not the
same artifact — a base image moves, a dependency resolves differently — and
the only environment that matters is the one nobody tested.

**More than one run can be waiting at the gate.** Push twice and there are two
pending approvals, and the newest is not always the one an approver opens.
Approving a superseded run would quietly put an older commit in front of
citizens, so the production job refuses to deploy when `main` has moved past
the commit it built. That check is skipped on a manual run, which is how an
older commit is deliberately put back:

```sh
gh workflow run ci.yml --ref <sha-or-branch>
```

**There is no release tag.** The footer of the page carries the build time
and the commit sha, which says what is live more precisely than a version
would, and cannot be moved to another commit afterwards. Read it off the site,
or off `/healthz` for the backend — see "Which build is running" below. The
run's summary is not one of the places: it names the environment and the
deployment URL and never the stamp, so a run cannot tell you whether the
bundle it published actually replaced the old one.

To redeploy production without a new commit — after a `fly secrets set`, or a
publish that half-failed — start the same run again on the same ref, or
re-run the finished run's production job. Nothing has to be tagged or bumped.

### Which build is running

Both halves say so, so that anyone can check the running code against the
published code rather than trust it.

The page's footer carries the build time and the short commit sha, and the
sha links to the tree at that commit. The backend answers with its own:

```sh
curl https://dvo-reports-api-staging.fly.dev/healthz
# ok 8c63670
```

The sha reaches the binary through `--build-arg BUILD_SHA=...` in the
`build` job, which the Dockerfile passes to the linker with
`-ldflags -X main.buildSHA`. It is baked into the image, so both environments
report the same sha — which is the point: they are running the same image. There is no `.git` in the `backend/` build
context, so the toolchain cannot find it on its own. A `docker build` with no
argument, or a `go build` on a laptop, says `ok unknown` — which is honest,
and is what `make build` produces.

Both halves are deployed from one ref in one run, so the two shas normally
match. They can drift if one job fails and the other does not; comparing them
is the point of publishing both.

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

A manual run defaults to `staging`, so dispatching one without thinking about
it cannot reach citizens.

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
   each a variable `VITE_API_BASE` holding its backend URL. It is written
   into the copy that is published, not into the build, so changing one needs
   a new deploy but not a new build.

   Give `production` a **required reviewer**. That gate is the only thing
   standing between a push to `main` and a citizen.

   Nothing else needs setting here. Which environment a copy is gets written
   from the same place the job gives `wrangler --branch`, so the bar on the
   page and the Cloudflare branch cannot disagree — it is not a variable to
   add. Any copy not named `production` shows a bar naming the environment.

4. **Custom domains — not done, not decided, and deliberately deferred.**
   Everything in this step is still ahead of the project, including picking
   the names; the site runs on the Pages URLs until then. A branch alias only
   exists once that branch has deployed at least once, so this comes after
   both branches have deployed.

   The production name is the project's production domain: add it under
   *Custom domains* in the Pages project and let Cloudflare create the record.

   The staging name points at a branch, which takes an extra step. Add it as a
   custom domain the same way, then open DNS for its zone, find the `CNAME`
   record Cloudflare created, and change its target from
   `dvo-reports.pages.dev` to `staging.dvo-reports.pages.dev`.

   **The record must stay proxied** (orange cloud). Cloudflare's docs are
   explicit: with an unproxied record, or DNS hosted elsewhere, the custom
   alias is served the *production* branch instead. That failure is silent —
   staging would quietly show production.

   **Change `ALLOWED_ORIGINS` in the same step.** Both `backend/fly.*.toml`
   name the Pages URLs today. The browser sends the new origin the moment a
   domain answers, and an origin that is not on the list fails every
   submission with a CORS error, so the two have to move together.

The `production` environment requires a reviewer, so every deploy to it
waits for an approval on the run. That is deliberate: it is the only thing
standing between a commit and every citizen who uses the site. A push to
`main` never queues at that gate, because a push only ever deploys staging.

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

3. **The container image needs no setup.** The `build` job pushes the backend
   image to `ghcr.io/relaxdiego/dvo-reports-api`, and both deploys pull it
   from there by digest. Nothing has to be set up for it: a package the
   Actions token publishes takes the visibility of the repository it is
   published from, and this repository is public, so Fly pulls it without
   credentials. That was checked by asking ghcr.io for an anonymous pull
   token and being given one.

   Public is right rather than merely convenient here: the image holds
   nothing but a binary built from source anyone can already read. Nothing
   secret reaches it — see the rule about this repository in `AGENTS.md`.
   Were the repository ever made private, the package would follow it and
   Fly would stop being able to pull; that is the thing to remember, not a
   one-time switch.

   Public is right rather than merely convenient: the repository is public and
   the image holds nothing but a binary built from that source. Nothing
   secret reaches it — see the rule about this repository in `AGENTS.md`.

   The image is not in the Fly registry, which is where a `flyctl deploy`
   would put it, because a Fly registry repository belongs to one app. The
   deploy tokens above are scoped to one app each on purpose, so the
   production app cannot pull from the staging app's repository. A neutral
   registry keeps that separation and still lets both deploy the same bytes.

4. **Push to `main`.** CI builds the image and deploys it. The staging app
   answers at `https://dvo-reports-api-staging.fly.dev/healthz`.

5. **Set `VITE_API_BASE`** on the matching GitHub Environment to the backend
   for that environment, then redeploy. The deploy job writes it into the
   page; a deploy with it unset fails rather than publishing a site that asks
   an origin serving no API.

### Environment

| Variable          | Default                 | Meaning                                          |
| ----------------- | ----------------------- | ------------------------------------------------ |
| `PORT`            | `8080`                  | Listen port. Fly sets this.                      |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the API. |
| `UPSTREAM`        | `city`                  | `nosubmit` reads the city but files nothing; `echo` answers everything without the city. |
| `UPSTREAM_BASE_URL` | the city's API        | Override for testing against a fake.             |
| `AZURE_MAPS_KEY`  | unset                   | Names the street when the page's own lookup could not. Unset falls back to OpenStreetMap. |
| `AZURE_MAPS_BASE_URL` | Azure Maps          | Override for testing the street lookup.          |
| `NOMINATIM_BASE_URL` | OpenStreetMap's      | Override for the backend's own fallback, for testing. Used whether or not Azure is configured. |
| `ALERT_URL`       | unset                   | Posted to when a report is not filed. Production only. |

### The street under a pin

The reporter's browser asks OpenStreetMap's Nominatim, and files that text.
It knows Davao's lanes and the barangays around them.

The backend is the fallback, for the pins Nominatim cannot name a road for.
It asks Azure Maps, using **this project's own Azure Maps key** — never the
city's, which bills their account. Azure lives here rather than in the page
because its key must never be shipped to a browser, and that is the only
reason this endpoint still exists.

Azure was the first question until it was measured. Over 84 points around
Bajada and Agdao it named the road the pin actually sits on about six times
in ten, while reporting `type: "Address"` and `confidence: "High"` every
single time — so the backend's own fallback could never tell a good answer
from a bad one and never fired. It answers the Shell station on J. P. Laurel
Avenue with `8000 Rimas Street`. What it returns is the nearest postal
address it holds, which in this city is frequently on another lane and
carries a house number belonging to somebody else.

`AZURE_MAPS_KEY` is a **Fly secret**, not a value in `fly.*.toml` and not a
GitHub Actions secret: the backend reads it at runtime, and CI only deploys.

```sh
fly secrets set AZURE_MAPS_KEY=... -a dvo-reports-api-staging
fly secrets set AZURE_MAPS_KEY=... -a dvo-reports-api
```

Setting a secret restarts the app. Leave it unset and the backend asks
OpenStreetMap's Nominatim instead, which needs no account and is what a
developer gets locally; it is rate limited to one request a second, which is
that service's own published limit. That duplicates what the page already
asked, and is kept so the form behaves the same with and without a key.

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
does, `Submit` starts failing in production and nothing else notices. Reading
the log is how the reason is found:

```sh
fly logs -a dvo-reports-api | grep 'upstream submit failed'
```

Nobody reads a log they have no reason to open, so the backend also posts a
line to `ALERT_URL` when a report is not filed. Any address that accepts a
`POST` will do; **healthchecks.io** is what this is set up for, because its
free tier is free for good and needs nothing running anywhere:

1. Sign up and create a check named `dvo-reports submit`.
2. Set its **period** as long as it will go, and its grace time to a few
   minutes. The check is not a cron job: no news is good news here, and a
   short period would mail you for the silence.
3. Copy its ping URL and set it as a Fly secret on production only, with
   `/fail` on the end:

   ```sh
   fly secrets set ALERT_URL=https://hc-ping.com/<uuid>/fail -a dvo-reports-api
   ```

Staging files nothing, so it has nothing to report and gets no `ALERT_URL`.
Nor does a laptop: with the variable unset, nothing is posted anywhere.

The check goes down on the first failed report and mails you. It is a latch:
it stays down, and further failures do not mail you again, so an afternoon of
them is one message. Clear it in their web interface once the city is
answering again — a check nobody clears is a check nobody reads.

**The alert carries no part of the report.** Not the description, the
address, the coordinates, a photograph, nor the city's own reply, which
quotes the title back and so the first line of what the reporter wrote. It
says filing broke and which log line holds the reason. That is a rule with a
test on it: see `TestTheAlertCarriesNoPartOfTheReport`.

**The ping URL is the credential.** Anyone holding it can mark the check up
or down. It is a Fly secret, it is not in this repository, and the backend
strips it out of any error before logging it.

#### If you outgrow it

Healthchecks tells you filing broke, and nothing more; the reason is in
`fly logs`, which Fly keeps for a few days. Two ways up from there, both with
a free tier, neither set up here:

- **Sentry** (free: 5,000 errors a month, 30-day retention) groups repeats
  into one issue and keeps the error text, so the reason is in the alert
  rather than in a log you have to catch in time. It costs a dependency in
  `go.mod`, or a hand-written POST to their ingest endpoint.
- **Better Stack** (free: 3 GB of logs, kept 3 days) takes the whole log
  stream and alerts on a search of it. That means shipping logs, and the
  citizen's data is in those logs — read what leaves this machine before
  turning it on.

### Moving off Fly

`cmd/server` is an ordinary Go HTTP server with no cloud SDK, and the
Dockerfile is a plain multi-stage build. Anything that runs a container and
sets `PORT` will do: DigitalOcean App Platform, Cloud Run, or AWS Lambda
behind the [Lambda Web Adapter][lwa]. DigitalOcean Functions would need a
small adapter, because its Go runtime calls a `Main(...)` function rather
than serving HTTP; that adapter does not exist.

[lwa]: https://github.com/awslabs/aws-lambda-web-adapter
