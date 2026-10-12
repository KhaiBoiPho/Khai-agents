#!/usr/bin/env sh
# Start the Khai-Agents data services. The first run creates .env with
# random secrets (owner-only, ignored by git) and prints the URLs the
# application reads; later runs reuse it.
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  umask 077
  {
    echo "KHAI_PG_SUPERUSER_PASSWORD=$(openssl rand -hex 24)"
    echo "KHAI_PG_APP_PASSWORD=$(openssl rand -hex 24)"
    echo "KHAI_REDIS_PASSWORD=$(openssl rand -hex 24)"
    echo "KHAI_QDRANT_API_KEY=$(openssl rand -hex 24)"
  } > .env
fi
docker compose up -d --wait "$@"
. ./.env
echo "KHAI_DATABASE_URL=postgresql://khai:${KHAI_PG_APP_PASSWORD}@127.0.0.1:${KHAI_PG_PORT:-5452}/khai"
echo "KHAI_REDIS_URL=redis://:${KHAI_REDIS_PASSWORD}@127.0.0.1:${KHAI_REDIS_PORT:-6392}/0"
echo "KHAI_QDRANT_URL=http://127.0.0.1:${KHAI_QDRANT_PORT:-6353}"
