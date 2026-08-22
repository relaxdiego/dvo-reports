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
  submission fails, the citizen is told it failed. `upstream.Echo` invents
  one, and it is for local development only.
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

An agent working here normally holds a token scoped to this repository with
write access to code, issues, workflows, deployments, and environments. So
re-running a workflow is yours to do:

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

## Structure

- `backend/internal/report` — the report type and its validation. No HTTP, no
  upstream knowledge. Validation here is the copy that is trusted.
- `backend/internal/upstream` — the only package that knows how the city's
  site works. It has no public API, so this code imitates its web form and
  will break when the form changes. Keep that blast radius here.
- `backend/internal/api` — routes, size limits, CORS. Handlers stay thin.
- `backend/internal/photo` — **the only place photo metadata is decided.** It
  keeps a named few fields and drops everything else, by rebuilding the
  metadata from nothing rather than deleting from what arrived, so a tag
  survives only because that file names it. Do not add a second filter
  anywhere, and do not strip in the frontend: `frontend/src/image.ts` carries
  the original block across the resize precisely so this package can be the
  one that judges it.
- `frontend/src/validate.ts` — mirrors the backend rules so the reporter
  learns about a problem before uploading photos. If you change one, change
  both, and remember the backend's answer is the one that counts.
- `frontend/src/image.ts` — shrinking photos before upload. This is the main
  reason the client feels fast. Do not remove it. It also copies the
  original's metadata block onto the resized photo, unread: drawing to a
  canvas would otherwise throw the date and the place away before the backend
  could judge them. The tags describing the old pixels travel with it and are
  wrong; `backend/internal/photo` drops them.
- `frontend/src/citynotice.tsx` — the city's disclaimer and privacy terms,
  copied word for word, bar one substitution the file explains. The city has
  no page to link to, so they are carried here. If you refresh the text,
  change `COPIED_ON` in the same commit: the date is what tells a reader how
  stale the copy is.
- `frontend/src/sitenotice.tsx` — this project's own notice: what it keeps,
  what it promises, and what it does not. Its sibling above carries the
  city's. Keep the two apart, so a reporter can tell whose promise is whose,
  and keep this one true rather than short — if it stops matching what the
  code does, the code is not the thing that is wrong.

  The emergency line is written twice on purpose: once on the page, in the
  header, where nobody has to go looking for it, and once at the top of this
  notice. Change one and change the other.
- `frontend/src/map.tsx` — the OpenStreetMap place picker. It is the only
  code that talks to a third party, and it is loaded with a dynamic
  `import()` so that Leaflet is fetched only by a reporter who opens the map.
  Do not import it from anywhere eagerly.

## Conventions

- Go: standard library only. Adding a dependency to the backend needs a
  reason in the commit message.
- Frontend: Preact, no UI framework, no component library. The bundle
  everybody downloads is about 13 kB gzipped; a change that doubles it needs
  a reason. Leaflet sits outside that number because it is in the map
  picker's own chunk — keep new weight behind a dynamic `import()` the same
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
