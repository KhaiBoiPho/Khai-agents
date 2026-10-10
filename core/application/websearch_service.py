"""Built-in web search (Firecrawl) settings: key and on/off switch.

The user's Firecrawl key lives in the same user-private credential store as
provider API keys, under a dedicated id. It is write-only: clients only ever
learn whether one is configured.
"""

from __future__ import annotations

from typing import Any

from core.application.errors import InvalidArgumentError
from core.mcp.firecrawl import (
    FIRECRAWL_CREDENTIAL_ID,
    FIRECRAWL_SERVER_NAME,
    resolve_api_key,
    stored_api_key,
    valid_api_key,
)

_UNSET = object()


class WebSearchService:
    def __init__(self, *, credentials: Any, mcp: Any) -> None:
        self.credentials = credentials
        self.mcp = mcp

    def _enabled(self) -> bool:
        try:
            servers = self.mcp.list().servers
        except Exception:  # noqa: BLE001 - a broken MCP config reads as off
            return False
        return any(
            server.name == FIRECRAWL_SERVER_NAME and server.enabled
            for server in servers
        )

    def status(self) -> dict[str, Any]:
        key, _source = resolve_api_key(credentials=self.credentials)
        return {
            "provider": "firecrawl",
            "configured": stored_api_key(self.credentials) is not None,
            "keyless": key is None,
            "enabled": self._enabled(),
        }

    def update(self, *, api_key: Any = _UNSET, enabled: bool | None = None) -> dict:
        if api_key is not _UNSET:
            if api_key is None:
                self.credentials.clear(FIRECRAWL_CREDENTIAL_ID)
            elif isinstance(api_key, str):
                clean = api_key.strip()
                if clean:
                    if not valid_api_key(clean):
                        raise InvalidArgumentError(
                            "Firecrawl API key has an invalid format"
                        )
                    self.credentials.set(FIRECRAWL_CREDENTIAL_ID, clean)
                # An empty string keeps the saved key ("leave blank to keep").
            else:
                raise InvalidArgumentError("apiKey must be a string or null")
        if enabled is not None:
            try:
                self.mcp.set_enabled(FIRECRAWL_SERVER_NAME, enabled=enabled)
            except InvalidArgumentError as exc:
                raise InvalidArgumentError(
                    "Built-in web search is not available on this server"
                ) from exc
        return self.status()


__all__ = ["WebSearchService"]
