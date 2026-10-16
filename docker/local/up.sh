#!/usr/bin/env sh
# Build this checkout into an image and run it locally on 127.0.0.1:8090,
# next to the data services in ../stack (started here if needed).
#
#   docker/local/up.sh            # build + start
#   docker/local/up.sh --no-build # restart without rebuilding
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

"$repo/docker/stack/up.sh" >/dev/null

if [ "${1:-}" != "--no-build" ]; then
  genoffice_src="${GENOFFICE_SRC:-$repo/../genoffice}"
  if [ -f "$genoffice_src/packages/cli/package.json" ]; then
    docker build --build-context "genoffice-src=$genoffice_src" -t "${KHAI_IMAGE:-khai-agents:local}" "$repo"
  else
    echo "note: no GenOffice checkout at $genoffice_src; building without document creation" >&2
    docker build -t "${KHAI_IMAGE:-khai-agents:local}" "$repo"
  fi
fi

mkdir -p "$repo/.local-data/users"
set -a
. "$repo/docker/stack/.env"
KHAI_LOCAL_DATA="$repo/.local-data"
set +a
docker compose -f "$here/docker-compose.yml" up -d --wait
echo "Khai-Agents is running at http://127.0.0.1:${KHAI_LOCAL_PORT:-8090}"
