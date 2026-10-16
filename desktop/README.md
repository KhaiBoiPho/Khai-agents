# Khai-Agents web client

The browser frontend for Khai-Agents (React + Vite). It talks to the App
Server over HTTP and WebSocket (`src/rpc/browserRuntime.ts`); there is no
native desktop shell. The production bundle is written to
`../app_server/web_assets/`, which the App Server gateway serves.

## Develop

```sh
npm ci
npm run dev          # Vite on http://localhost:1420, proxies /api to the server
```

Run the App Server alongside it (see [docs/WEB_CLIENT.md](../docs/WEB_CLIENT.md)),
or use the Docker stack in [`docker/`](../docker).

## Checks

```sh
npm run check:protocol   # generated RPC types match protocol/
npm run typecheck
npm run lint
npm test
npm run build            # production bundle into ../app_server/web_assets
```

`npm run generate:protocol` regenerates `src/generated/` after the protocol
schema changes.
