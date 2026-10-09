#!/usr/bin/env sh
# One-time setup for the hosted deployment: secrets in .env (owner-only,
# never committed), the data directory, and the application image.
#
#   KHAI_DOMAIN=khai.example.com KHAI_DATA_DIR=/srv/khai/data ./setup.sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  : "${KHAI_DOMAIN:?set KHAI_DOMAIN (the public host name)}"
  : "${KHAI_DATA_DIR:=/srv/khai/data}"
  umask 077
  {
    echo "KHAI_DOMAIN=$KHAI_DOMAIN"
    echo "KHAI_DATA_DIR=$KHAI_DATA_DIR"
    echo "KHAI_PG_SUPERUSER_PASSWORD=$(openssl rand -hex 24)"
    echo "KHAI_PG_APP_PASSWORD=$(openssl rand -hex 24)"
    echo "KHAI_PG_DOCMOST_PASSWORD=$(openssl rand -hex 24)"
    echo "KHAI_REDIS_PASSWORD=$(openssl rand -hex 24)"
    echo "KHAI_QDRANT_API_KEY=$(openssl rand -hex 32)"
    echo "KHAI_DOCMOST_APP_SECRET=$(openssl rand -hex 32)"
    echo "KHAI_DOCMOST_ACCOUNT_SECRET=$(openssl rand -hex 32)"
    echo "# Optional: KHAI_WORKER_RUNTIME=runsc (gVisor), KHAI_WORKER_MEMORY_GB=1,"
    echo "# KHAI_WORKER_CPUS=1, KHAI_MAX_WORKERS=12, KHAI_WORKER_IDLE_SECONDS=1800"
  } > .env
  echo "Wrote $(pwd)/.env"
fi
. ./.env
mkdir -p "$KHAI_DATA_DIR/users"
chmod 711 "$KHAI_DATA_DIR" "$KHAI_DATA_DIR/users"
docker build -t "${KHAI_IMAGE:-khai-agents:latest}" ../..
echo "Ready: docker compose up -d, then open https://$KHAI_DOMAIN and register the first (administrator) account."
