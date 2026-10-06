#!/usr/bin/env sh
# Start the KhaiDocs server. The first run creates .env with random secrets;
# it stays on this machine (ignored by git) and is reused afterwards.
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  umask 077
  {
    echo "KHAIDOCS_APP_SECRET=$(openssl rand -hex 32)"
    echo "KHAIDOCS_DB_PASSWORD=$(openssl rand -hex 16)"
  } > .env
fi
docker compose up -d "$@"
echo "KhaiDocs server: http://127.0.0.1:${KHAIDOCS_PORT:-3456}"
