# Build the server as a static binary, then ship it on nothing.
#
# The result is one file in an empty image: no shell, no package manager,
# nothing for an attacker to reach for. This backend relays a citizen's
# photographs and location to a government site.
#
# The Go version matches devbox.json. Keep them in step.
FROM golang:1.24-alpine AS build
WORKDIR /src

# Cached separately: dependencies change far less often than code.
COPY go.mod ./
RUN go mod download

COPY . .
# CGO off so the binary needs no libc at runtime. -s -w drop the debug
# symbols; a stack trace from production is not something we can read anyway.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /bin/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
# TLS roots, so the outbound call to the city's HTTPS API can be verified.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /bin/server /server
USER nonroot:nonroot
# Every host sets PORT; this is the fallback for `docker run` on a laptop.
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/server"]
