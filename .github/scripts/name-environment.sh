#!/usr/bin/env bash
#
# Turns the one build into the copy for one environment, just before it is
# published.
#
# One bundle is built and published to both staging and production, so what
# tells a copy which one it is cannot be baked in any more. Two things are
# written here instead, and nothing else about the build differs between the
# two environments:
#
#   1. The <html> tag gets data-env and data-api. `frontend/src/config.ts`
#      reads both when the page loads — the environment decides whether the
#      bar saying this is not the real site is drawn, and the API base is
#      where the backend is.
#
#   2. The blueprint home screen tile and favicon are laid over the real ones
#      for anything that is not production, so a maintainer with both sites
#      added to one phone can tell which icon files a real report. They ride
#      along in the build under blueprint/ and are removed either way, so
#      Cloudflare never serves that directory.
#
# Both deploy jobs call this, which is the point: the part that must not
# differ between them lives in one file.
#
# Usage: name-environment.sh <dist-dir> <environment> <api-base>

set -euo pipefail

dist="${1:?the built site}"
environment="${2:?staging or production}"
api="${3-}"

if [[ ! -f "$dist/index.html" ]]; then
  echo "no $dist/index.html — was the build fetched?" >&2
  exit 1
fi

# An empty API base would leave the page asking its own origin for /api,
# which Cloudflare Pages does not serve. Better to fail here than to publish
# a site whose every request 404s.
if [[ -z "$api" ]]; then
  echo "no API base given: set VITE_API_BASE as a variable on the" \
    "$environment environment. See docs/deploy.md." >&2
  exit 1
fi

# Fails rather than guesses if the tag is not the one it expects. A silent
# miss would publish a copy pointing at no backend at all.
python3 - "$dist/index.html" "$environment" "$api" <<'PY'
import html
import pathlib
import sys

path, environment, api = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
page = path.read_text()

placeholder = '<html lang="en" data-env="development" data-api="">'
if placeholder not in page:
    sys.exit(
        f"{path} does not carry the placeholder <html> tag.\n"
        "frontend/index.html and this script have to keep agreeing."
    )

named = (
    f'<html lang="en" data-env="{html.escape(environment, quote=True)}"'
    f' data-api="{html.escape(api, quote=True)}">'
)
path.write_text(page.replace(placeholder, named))
print(f"named this copy {environment}, backend at {api}")
PY

if [[ "$environment" != "production" ]]; then
  cp "$dist"/blueprint/* "$dist"/
  echo "home screen tiles replaced with the blueprint"
fi
rm -rf "${dist:?}/blueprint"
