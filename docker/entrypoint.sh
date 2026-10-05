#!/bin/sh
# Container entrypoint: seed the connections from the environment on every
# boot (idempotent), then run the app service in the foreground.
set -eu

: "${KHAI_PUBLIC_ORIGIN:?set KHAI_PUBLIC_ORIGIN to the public https:// URL}"
: "${KHAI_ACCESS_PASSWORD:?set KHAI_ACCESS_PASSWORD to the login password}"

mkdir -p "$DEEPCODE_HOME" /workspace

if [ -n "${GEMINI_API_KEY:-}" ]; then
    deepcode provider set gemini --template gemini --api-key-env GEMINI_API_KEY >/dev/null
fi
if [ -n "${NVIDIA_API_KEY:-}" ]; then
    deepcode provider set nvidia --template nvidia --api-key-env NVIDIA_API_KEY >/dev/null
fi
if [ -n "${FIRECRAWL_API_KEY:-}" ]; then
    python - <<'EOF'
import json, os, pathlib
path = pathlib.Path(os.environ["DEEPCODE_HOME"]) / "deepcode_config.json"
config = json.loads(path.read_text()) if path.exists() else {}
config.setdefault("mcpServers", {})["firecrawl"] = {
    "type": "streamableHttp",
    "url": "https://mcp.firecrawl.dev/v2/mcp",
    "bearerTokenEnvVar": "FIRECRAWL_API_KEY",
    "enabled": True,
    "approvalMode": "writes",
    "toolTimeoutSeconds": 60,
}
path.write_text(json.dumps(config, indent=2))
EOF
fi

echo "Khai-Agents: open ${KHAI_PUBLIC_ORIGIN}/login?key=<KHAI_ACCESS_PASSWORD>"
exec python -m app_server.service --port "${PORT:-8080}"
