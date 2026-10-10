"""The user's Firecrawl key: stored write-only, spliced in only at connect time."""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from core.application.errors import InvalidArgumentError
from core.application.websearch_service import WebSearchService
from core.mcp.firecrawl import (
    FIRECRAWL_KEYLESS_URL,
    FIRECRAWL_SERVER_NAME,
    connection_url,
    firecrawl_server_definition,
    install_log_redaction,
    redact_secrets,
)
from core.mcp.models import McpServerSource
from core.providers.credentials import CredentialStore

KEY = "fc-0123456789abcdef"


class FakeMcp:
    def __init__(self) -> None:
        self.enabled = True

    def list(self):
        return SimpleNamespace(
            servers=[SimpleNamespace(name=FIRECRAWL_SERVER_NAME, enabled=self.enabled)]
        )

    def set_enabled(self, name: str, *, enabled: bool) -> None:
        assert name == FIRECRAWL_SERVER_NAME
        self.enabled = enabled


def _server(source=McpServerSource.BUILTIN):
    return SimpleNamespace(server_id=FIRECRAWL_SERVER_NAME, source=source)


def test_key_is_saved_write_only_and_used_only_when_connecting(tmp_path, monkeypatch):
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    credentials = CredentialStore(tmp_path / "credentials.json")
    service = WebSearchService(credentials=credentials, mcp=FakeMcp())

    status = service.status()
    assert status == {"provider": "firecrawl", "configured": False, "keyless": True, "enabled": True}
    assert connection_url(_server(), FIRECRAWL_KEYLESS_URL, credentials=credentials, env={}) == (
        FIRECRAWL_KEYLESS_URL
    )

    status = service.update(api_key=f"  {KEY}  ")
    assert status["configured"] is True and status["keyless"] is False
    assert KEY not in str(status)
    # The definition never carries the key; the live connection does.
    assert firecrawl_server_definition().url == FIRECRAWL_KEYLESS_URL
    assert connection_url(_server(), FIRECRAWL_KEYLESS_URL, credentials=credentials, env={}) == (
        f"https://mcp.firecrawl.dev/{KEY}/v2/mcp"
    )
    # Blank keeps the saved key; null removes it.
    assert service.update(api_key="")["configured"] is True
    assert service.update(api_key=None)["configured"] is False


def test_user_key_wins_over_the_servers_and_other_servers_are_untouched(tmp_path):
    credentials = CredentialStore(tmp_path / "credentials.json")
    env = {"FIRECRAWL_API_KEY": "fc-serverkey12345"}
    assert connection_url(_server(), FIRECRAWL_KEYLESS_URL, credentials=credentials, env=env) == (
        "https://mcp.firecrawl.dev/fc-serverkey12345/v2/mcp"
    )
    credentials.set("websearch.firecrawl", KEY)
    assert KEY in connection_url(_server(), FIRECRAWL_KEYLESS_URL, credentials=credentials, env=env)
    # A project-defined server or another URL never receives the key.
    project = _server(McpServerSource.PROJECT)
    assert connection_url(project, FIRECRAWL_KEYLESS_URL, credentials=credentials, env=env) == (
        FIRECRAWL_KEYLESS_URL
    )
    other = "https://example.com/mcp"
    assert connection_url(_server(), other, credentials=credentials, env=env) == other


def test_invalid_keys_are_refused_and_switch_toggles_the_server(tmp_path):
    service = WebSearchService(
        credentials=CredentialStore(tmp_path / "credentials.json"), mcp=FakeMcp()
    )
    with pytest.raises(InvalidArgumentError):
        service.update(api_key="bad key/with spaces")
    with pytest.raises(InvalidArgumentError):
        service.update(api_key=123)
    assert service.update(enabled=False)["enabled"] is False
    assert service.update(enabled=True)["enabled"] is True


def test_keys_are_scrubbed_from_errors_and_logs(caplog):
    url = f"https://mcp.firecrawl.dev/{KEY}/v2/mcp"
    assert KEY not in redact_secrets(f"ConnectError: {url}")
    assert KEY not in redact_secrets(f"bad token {KEY}")
    install_log_redaction()
    with caplog.at_level(logging.INFO, logger="httpx"):
        logging.getLogger("httpx").info("HTTP Request: POST %s", url)
    assert KEY not in caplog.text
