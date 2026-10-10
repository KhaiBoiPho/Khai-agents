# syntax=docker/dockerfile:1
# Khai-Agents image. One image, three roles chosen by entrypoint:
#   docker/gateway-entrypoint.sh  hosted front door (docker/deploy)
#   docker/worker-entrypoint.sh   one user's backend, started by the gateway
#   docker/entrypoint.sh          single-user remote mode
# Everything is configured through the environment; nothing secret is baked in.
#
# Build, with the GenOffice document engine (docker/deploy/setup.sh does this):
#
#   docker build --build-context genoffice-src=../genoffice -t khai-agents:latest .
#
# `genoffice-src` is a GenOffice (Apache-2.0) source checkout outside this
# repository, passed as a BuildKit named context. Only its Apache-2.0 parts are
# copied (package manifests, packages/, apps/, skills/, LICENSE, NOTICE); the
# ee/ directory (Enterprise license) is never copied or built. Without the
# named context the build still succeeds and the image simply ships without
# the built-in `genoffice` MCP server (core/mcp/genoffice.py finds no binary).

FROM node:22-bookworm-slim AS web
WORKDIR /src
# Dependencies first: npm ci re-runs only when the lockfile changes.
COPY desktop/package.json desktop/package-lock.json ./desktop/
RUN npm --prefix desktop ci --no-audit --no-fund
COPY protocol ./protocol
COPY core/version.py ./core/version.py
COPY desktop ./desktop
RUN mkdir -p app_server && npm --prefix desktop run build:web

# ---------------------------------------------------------------- GenOffice
# Default: empty. Replaced by `--build-context genoffice-src=<checkout>`.
FROM scratch AS genoffice-src

# Package manifests only, so `npm ci` below stays cached until a lockfile or a
# workspace package.json changes (this stage reruns on any source change, but
# its output is byte-identical, so the COPY of it stays cached).
FROM node:22-bookworm-slim AS genoffice-manifests
RUN --mount=type=bind,from=genoffice-src,target=/ctx \
    mkdir -p /out \
    && if [ -f /ctx/packages/cli/package.json ]; then \
         cd /ctx \
         && cp package.json package-lock.json /out/ \
         && find apps packages -mindepth 2 -maxdepth 2 -name package.json \
              -exec cp --parents {} /out/ \; ; \
       fi

# xlsx-sidecar: the Rust formula engine behind `sheet read`, xlsx `info` and
# formula recalculation (pure Rust; builds on Linux).
FROM rust:1-bookworm AS genoffice-sidecar
ARG CARGO_BUILD_JOBS=2
WORKDIR /src
RUN --mount=type=bind,from=genoffice-src,target=/ctx \
    mkdir -p /out \
    && if [ -f /ctx/apps/sheets/native/xlsx-engine/Cargo.toml ]; then \
         tar -C /ctx/apps/sheets/native --exclude=target -cf - xlsx-engine | tar -xf -; \
       fi
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/xlsx-engine/target \
    if [ -f xlsx-engine/Cargo.toml ]; then \
      cd xlsx-engine \
      && cargo build --release --locked --jobs "$CARGO_BUILD_JOBS" \
      && cp target/release/xlsx-sidecar /out/ \
      && strip /out/xlsx-sidecar; \
    fi

# The CLI, built and laid out by scripts/setup-genoffice.sh's "build from
# checkout" path into /khai/tools/genoffice.
FROM node:22-bookworm-slim AS genoffice
WORKDIR /src
COPY --from=genoffice-manifests /out/ ./
# --ignore-scripts: the root postinstall downloads Electron, which the
# headless CLI never uses; esbuild finds its platform binary without it.
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
      npm ci --ignore-scripts --no-audit --no-fund; \
    fi
RUN --mount=type=bind,from=genoffice-src,target=/ctx \
    if [ -f /ctx/packages/cli/package.json ]; then \
      tar -C /ctx --exclude=node_modules --exclude=dist --exclude=target \
          -cf - package.json package-lock.json tsconfig.base.json LICENSE NOTICE \
                packages apps skills \
        | tar -xf -; \
    fi
COPY --from=genoffice-sidecar /out/ /src/apps/sheets/native/xlsx-engine/target/release/
COPY scripts/setup-genoffice.sh /khai/scripts/setup-genoffice.sh
RUN mkdir -p /khai/tools \
    && if [ -f packages/cli/package.json ]; then \
         sh /khai/scripts/setup-genoffice.sh /src; \
       else \
         echo "WARNING: no genoffice-src build context; the image ships without GenOffice" >&2; \
       fi \
    && mkdir -p /khai/tools/genoffice

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
# Document rendering (core/documents/convert.py, the `document_export` tool):
# headless LibreOffice (no GUI, no Java) exports docx/xlsx/pptx/odt/html to
# PDF; poppler's pdftoppm rasterizes pages to PNG. Fonts: DejaVu, Liberation 2
# (Arial/Times/Courier metrics) and Carlito/Caladea (Calibri/Cambria metrics),
# all covering Vietnamese. fonts-noto-core (~42 MB) is left out on purpose.
# Its own layer, so the Python and app layers below stay cached.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
       poppler-utils fontconfig \
       fonts-dejavu-core fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* \
    && fc-cache -f
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
# Node 22 runs the GenOffice CLI (the tools/genoffice/genoffice launcher finds
# it on PATH or at /usr/local/bin/node). The bundle is read-only at runtime:
# GenOffice writes only to $HOME/.genoffice (its audit log) and the OS temp
# dir, both writable in hosted workers (/data/home and the /tmp tmpfs).
COPY --from=genoffice /usr/local/bin/node /usr/local/bin/node
COPY --from=genoffice /khai/tools/genoffice /app/tools/genoffice
COPY . .
COPY --from=web /src/app_server/web_assets ./app_server/web_assets
# Workers run on a read-only filesystem and cannot cache bytecode, so it is
# compiled here once; otherwise every cold start recompiles the app.
RUN pip install --no-deps --no-build-isolation -e . \
    && python -m compileall -q -j 0 -x "/skills/builtin/|/tools/genoffice/" /app/app_server /app/core /app/cli /app/utils /app/tools /app/deepcode.py \
    && chmod +x docker/entrypoint.sh docker/gateway-entrypoint.sh docker/worker-entrypoint.sh \
    && mkdir -p /data/deepcode /workspace
VOLUME ["/data", "/workspace"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health/live" || exit 1
ENTRYPOINT ["/app/docker/entrypoint.sh"]
