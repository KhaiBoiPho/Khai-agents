#!/bin/sh
# The hosted front door (app_server/gateway/server.py): accounts,
# administration, the web client, and one worker container per user.
set -eu
: "${KHAI_PUBLIC_ORIGIN:?set KHAI_PUBLIC_ORIGIN to the public https:// URL}"
: "${KHAI_DATABASE_URL:?set KHAI_DATABASE_URL}"
: "${KHAI_REDIS_URL:?set KHAI_REDIS_URL}"
mkdir -p "${KHAI_DATA_ROOT:-/data}/users"
chmod 711 "${KHAI_DATA_ROOT:-/data}/users"
exec python -m app_server.gateway
