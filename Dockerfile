# Khai-Agents image. One image, three roles chosen by entrypoint:
#   docker/gateway-entrypoint.sh  hosted front door (docker/deploy)
#   docker/worker-entrypoint.sh   one user's backend, started by the gateway
#   docker/entrypoint.sh          single-user remote mode
# Everything is configured through the environment; nothing secret is baked in.

FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY protocol ./protocol
COPY core/version.py ./core/version.py
COPY desktop/package.json desktop/package-lock.json ./desktop/
RUN npm --prefix desktop ci --no-audit --no-fund
COPY desktop ./desktop
RUN mkdir -p app_server && npm --prefix desktop run build:web

FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DEEPCODE_HOME=/data/deepcode \
    KHAI_BIND_HOST=0.0.0.0 \
    PORT=8080
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep curl ca-certificates openssh-client \
    && rm -rf /var/lib/apt/lists/*
# The unprivileged user hosted workers run as (WORKER_UID in
# app_server/gateway/workers.py). It needs a passwd entry: getpass, git and
# ssh look the current user up by uid.
RUN groupadd --gid 10001 khai \
    && useradd --uid 10001 --gid 10001 --home-dir /data/home --no-create-home \
       --shell /usr/sbin/nologin khai
WORKDIR /app
COPY scripts/ci/requirements.lock ./scripts/ci/requirements.lock
COPY desktop/sidecar-requirements.lock ./desktop/sidecar-requirements.lock
RUN pip install -r scripts/ci/requirements.lock
COPY . .
COPY --from=web /src/app_server/web_assets ./app_server/web_assets
RUN pip install --no-deps --no-build-isolation -e . \
    && chmod +x docker/entrypoint.sh docker/gateway-entrypoint.sh docker/worker-entrypoint.sh \
    && mkdir -p /data/deepcode /workspace
VOLUME ["/data", "/workspace"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health/live" || exit 1
ENTRYPOINT ["/app/docker/entrypoint.sh"]
