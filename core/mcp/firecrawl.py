"""Built-in Firecrawl web search MCP server.

Firecrawl's hosted MCP endpoint backs DeepThink and Search mode. Khai ships
it as a *built-in*, enabled, **deferred** server: the normal agent only sees
the small activation tool until it actually asks for web search, so ordinary
Turns pay almost nothing for it. DeepThink activates it directly.

The hosted endpoint takes the API key in the URL path
(``https://mcp.firecrawl.dev/{KEY}/v2/mcp``); without a key the keyless,
rate-limited endpoint (``https://mcp.firecrawl.dev/v2/mcp``) is used.

The key never becomes part of a server definition, inventory, runtime plan
or diagnostic: definitions always carry the keyless URL, and the key is
spliced in only when a connection opens (:func:`connection_url`). Key
sources, in order:

1. the user's stored credential (user-private credential store, under
   :data:`FIRECRAWL_CREDENTIAL_ID`, write-only from clients);
2. ``$FIRECRAWL_API_KEY`` (operators/admin workers).

Because the live URL contains the key, every error or log line that may
quote it goes through :func:`redact_secrets`.
"""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Mapping
from typing import Any

from core.mcp.models import McpServerDefinition, McpServerSource

FIRECRAWL_SERVER_NAME = "firecrawl"
#: Credential-store id of the user's own Firecrawl key (not a provider).
FIRECRAWL_CREDENTIAL_ID = "websearch.firecrawl"
FIRECRAWL_API_KEY_ENV = "FIRECRAWL_API_KEY"
FIRECRAWL_KEYLESS_URL = "https://mcp.firecrawl.dev/v2/mcp"
_FIRECRAWL_KEYED_URL = "https://mcp.firecrawl.dev/{key}/v2/mcp"

#: Only these tools are exposed once activated; the rest of Firecrawl's
#: catalog (crawl jobs, browser sessions, agents) would only add schema
#: tokens to every request after activation.
FIRECRAWL_ENABLED_TOOLS: tuple[str, ...] = (
    "firecrawl_search",
    "firecrawl_scrape",
    "firecrawl_map",
)

FIRECRAWL_DESCRIPTION = (
    "Built-in Firecrawl web search: search the web and read pages. Used by "
    "DeepThink and Search mode."
)

_KEY_SHAPE = re.compile(r"^[A-Za-z0-9_\-]{8,200}$")
_URL_KEY = re.compile(r"(mcp\.firecrawl\.dev/)(?!v\d+/)[^/\s\"'<>]+(?=/)")
_FC_TOKEN = re.compile(r"\bfc-[A-Za-z0-9_\-]{6,}")
_REDACTED = "***"


def redact_secrets(text: Any) -> str:
    """Remove Firecrawl keys (URL path segment or ``fc-…`` token) from text."""

    value = str(text)
    if "firecrawl" not in value and "fc-" not in value:
        return value
    value = _URL_KEY.sub(lambda match: match.group(1) + _REDACTED, value)
    return _FC_TOKEN.sub("fc-" + _REDACTED, value)


def contains_secret(text: Any) -> bool:
    value = str(text)
    return redact_secrets(value) != value


def sanitized_exception(exc: BaseException) -> BaseException:
    """``exc`` itself, or a key-free stand-in when its message quotes a key."""

    if not contains_secret(exc):
        return exc
    clean = RuntimeError(f"{type(exc).__name__}: {redact_secrets(exc)}")
    clean.__cause__ = None
    clean.__suppress_context__ = True
    return clean


def valid_api_key(value: str) -> bool:
    """Whether ``value`` can be placed in the URL path safely."""

    return bool(_KEY_SHAPE.fullmatch(value))


def firecrawl_server_url(api_key: str | None) -> str:
    """The hosted MCP URL for ``api_key`` (keyless when absent)."""

    clean = (api_key or "").strip()
    if not clean:
        return FIRECRAWL_KEYLESS_URL
    if not valid_api_key(clean):
        raise ValueError("Firecrawl API key has an invalid format")
    return _FIRECRAWL_KEYED_URL.format(key=clean)


def stored_api_key(credentials: Any | None = None) -> str | None:
    """The user's stored key, or ``None`` (never raises)."""

    try:
        if credentials is None:
            from core.providers.credentials import CredentialStore

            credentials = CredentialStore()
        value = credentials.get(FIRECRAWL_CREDENTIAL_ID)
    except Exception:  # noqa: BLE001 - a broken store means "no key"
        return None
    return value.strip() if isinstance(value, str) and value.strip() else None


def env_api_key(env: Mapping[str, str] | None = None) -> str | None:
    environ = os.environ if env is None else env
    value = (environ.get(FIRECRAWL_API_KEY_ENV) or "").strip()
    return value or None


def resolve_api_key(
    *,
    credentials: Any | None = None,
    env: Mapping[str, str] | None = None,
) -> tuple[str | None, str | None]:
    """``(key, source)`` where source is ``"user"``, ``"env"`` or ``None``."""

    stored = stored_api_key(credentials)
    if stored and valid_api_key(stored):
        return stored, "user"
    from_env = env_api_key(env)
    if from_env and valid_api_key(from_env):
        return from_env, "env"
    return None, None


def firecrawl_server_definition() -> McpServerDefinition:
    """The built-in definition. Always the keyless URL: see module docs."""

    return McpServerDefinition.model_validate(
        {
            "type": "streamableHttp",
            "url": FIRECRAWL_KEYLESS_URL,
            "deferLoading": True,
            "enabledTools": list(FIRECRAWL_ENABLED_TOOLS),
            "startupTimeoutSeconds": 20,
            "toolTimeoutSeconds": 60,
            # Read-only web access; DeepThink runs it without approval cards.
            "approvalMode": "auto",
            "description": FIRECRAWL_DESCRIPTION,
        }
    )


def _same_url(left: str, right: str) -> bool:
    return left.rstrip("/").lower() == right.rstrip("/").lower()


def connection_url(
    server: Any,
    url: str,
    *,
    credentials: Any | None = None,
    env: Mapping[str, str] | None = None,
) -> str:
    """The URL to actually connect to for ``server``.

    Only the hosted keyless Firecrawl endpoint, configured as the built-in
    or as the user's own ``firecrawl`` entry (the old Connectors preset), is
    upgraded to the keyed endpoint. Any other URL is returned unchanged.
    """

    if getattr(server, "server_id", None) != FIRECRAWL_SERVER_NAME:
        return url
    if getattr(server, "source", None) not in {
        McpServerSource.BUILTIN,
        McpServerSource.USER,
    }:
        return url
    if not _same_url(url, FIRECRAWL_KEYLESS_URL):
        return url
    key, _source = resolve_api_key(credentials=credentials, env=env)
    return firecrawl_server_url(key) if key else url


class _RedactingFilter(logging.Filter):
    """Scrub keys from stdlib log records (httpx logs every request URL)."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - never drop a record over this
            return True
        if contains_secret(message):
            record.msg = redact_secrets(message)
            record.args = None
        return True


_FILTER = _RedactingFilter()
_REDACTED_LOGGERS = (
    "httpx",
    "httpcore",
    "mcp",
    "mcp.client.streamable_http",
    "mcp.client.sse",
)


def install_log_redaction() -> None:
    """Attach the key-scrubbing filter to the HTTP/MCP client loggers."""

    for name in _REDACTED_LOGGERS:
        target = logging.getLogger(name)
        if _FILTER not in target.filters:
            target.addFilter(_FILTER)


__all__ = [
    "FIRECRAWL_API_KEY_ENV",
    "FIRECRAWL_CREDENTIAL_ID",
    "FIRECRAWL_ENABLED_TOOLS",
    "FIRECRAWL_KEYLESS_URL",
    "FIRECRAWL_SERVER_NAME",
    "connection_url",
    "contains_secret",
    "env_api_key",
    "firecrawl_server_definition",
    "firecrawl_server_url",
    "install_log_redaction",
    "redact_secrets",
    "resolve_api_key",
    "sanitized_exception",
    "stored_api_key",
    "valid_api_key",
]
