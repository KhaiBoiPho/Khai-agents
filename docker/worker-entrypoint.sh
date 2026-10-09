#!/bin/sh
# One user's worker (started by the gateway, app_server/gateway/workers.py).
# Everything it may touch lives under /data: home/ (sessions, settings,
# provider keys, MCP, skills) and workspace/ (projects and files).
set -eu
: "${KHAI_WORKER_TOKEN:?the gateway must provide KHAI_WORKER_TOKEN}"
: "${KHAI_USER_ID:?the gateway must provide KHAI_USER_ID}"
mkdir -p /data/home/state /data/workspace
export HOME=/data/home DEEPCODE_HOME=/data/home
exec python -m app_server.service --port "${PORT:-8080}" --database /data/home/state/khai
