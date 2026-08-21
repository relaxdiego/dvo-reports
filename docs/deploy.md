# Deploying

Two pieces, deployed separately.

| Piece    | Where                            | Address                     |
| -------- | -------------------------------- | --------------------------- |
| Frontend | GitHub Pages, custom domain      | `report.relaxdiego.com`     |
| Backend  | any host that runs an HTTP server | `api.report.relaxdiego.com` |

## Frontend

`.github/workflows/pages.yml` builds `frontend/dist` and publishes it on every
push to `main`. Three things must be set up once:

1. **Repository settings → Pages → Source: GitHub Actions.**
2. **DNS.** A `CNAME` record for `report` pointing at `relaxdiego.github.io`.
   `frontend/public/CNAME` already carries the domain, so Pages keeps it
   across deploys. Turn on "Enforce HTTPS" once the certificate is issued.
3. **Repository variable `VITE_API_BASE`** = the backend's public URL. The
   frontend is baked at build time, so changing it needs a new deploy.

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

[lwa]: https://github.com/awslabs/aws-lambda-web-adapter

### Environment

| Variable          | Default                 | Meaning                                        |
| ----------------- | ----------------------- | ---------------------------------------------- |
| `PORT`            | `8080`                  | Listen port.                                   |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the API. |

In production `ALLOWED_ORIGINS` must be `https://report.relaxdiego.com`. The
frontend and backend are on different hosts, so a wrong value here shows up
as every submission failing in the browser with a CORS error.

### A note on cold starts

A function that sleeps answers the first report slowly, which is the exact
problem this project exists to fix. If you deploy to Lambda or another
scale-to-zero runtime, either keep one instance warm or accept that the first
report of the day is slow.
