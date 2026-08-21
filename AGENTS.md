# Notes for coding agents

Read this before changing anything. It records the decisions that are not
obvious from the code.

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

## Where work is tracked

GitHub Issues, and nowhere else. Do not create a `TODO.md`, a backlog file, a
plan file, or a checklist in the repository, and do not add one to a pull
request as a stand-in. If work needs remembering, it is an issue.

A `TODO` comment is allowed only as a note about the line it sits on. If it
describes work, open an issue and let the comment reference it.

## Structure

- `backend/internal/report` — the report type and its validation. No HTTP, no
  upstream knowledge. Validation here is the copy that is trusted.
- `backend/internal/upstream` — the only package that knows how the city's
  site works. It has no public API, so this code imitates its web form and
  will break when the form changes. Keep that blast radius here.
- `backend/internal/api` — routes, size limits, CORS. Handlers stay thin.
- `frontend/src/validate.ts` — mirrors the backend rules so the reporter
  learns about a problem before uploading photos. If you change one, change
  both, and remember the backend's answer is the one that counts.
- `frontend/src/image.ts` — shrinking photos before upload. This is the main
  reason the client feels fast. Do not remove it.

## Conventions

- Go: standard library only. Adding a dependency to the backend needs a
  reason in the commit message.
- Frontend: Preact, no UI framework, no component library. The bundle is
  about 8 kB gzipped; a change that doubles it needs a reason.
- Photos are sniffed with `http.DetectContentType`, not trusted from the
  upload's `Content-Type` header. This backend hands files to a government
  site.
- The toolchain is pinned in `devbox.json`. Do not add a version to CI that
  is not there.

## Before you say it works

```sh
make lint && make test
```
