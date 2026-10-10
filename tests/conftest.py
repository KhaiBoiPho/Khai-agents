"""Test-wide isolation for DeepCode's process-global SessionStore and the
application database."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

import pytest

# Every Database path a test opens gets its own PostgreSQL schema under this
# run's prefix; the session fixture below drops them at the end.
_SCHEMA_PREFIX = f"t_{secrets.token_hex(4)}"


def _test_database_url() -> str | None:
    url = os.environ.get("KHAI_TEST_DATABASE_URL", "").strip()
    if url:
        return url
    env_file = Path(__file__).resolve().parents[1] / "docker" / "stack" / ".env"
    try:
        values = dict(
            line.split("=", 1)
            for line in env_file.read_text(encoding="utf-8").splitlines()
            if "=" in line and not line.startswith("#")
        )
    except OSError:
        return None
    password = values.get("KHAI_PG_APP_PASSWORD")
    port = values.get("KHAI_PG_PORT", "5452")
    return f"postgresql://khai:{password}@127.0.0.1:{port}/khai" if password else None


_DATABASE_URL = _test_database_url()


def _test_redis_url() -> str | None:
    url = os.environ.get("KHAI_TEST_REDIS_URL", "").strip()
    if url:
        return url
    env_file = Path(__file__).resolve().parents[1] / "docker" / "stack" / ".env"
    try:
        values = dict(
            line.split("=", 1)
            for line in env_file.read_text(encoding="utf-8").splitlines()
            if "=" in line and not line.startswith("#")
        )
    except OSError:
        return None
    password = values.get("KHAI_REDIS_PASSWORD")
    port = values.get("KHAI_REDIS_PORT", "6392")
    return f"redis://:{password}@127.0.0.1:{port}/15" if password else None


TEST_REDIS_URL = _test_redis_url()


@pytest.fixture(autouse=True)
def _isolate_database(monkeypatch):
    if _DATABASE_URL:
        monkeypatch.setenv("KHAI_DATABASE_URL", _DATABASE_URL)
    monkeypatch.setenv("KHAI_DATABASE_SCHEMA_PER_PATH", _SCHEMA_PREFIX)
    monkeypatch.delenv("KHAI_MULTI_USER", raising=False)
    yield


@pytest.fixture(scope="session", autouse=True)
def _drop_test_schemas():
    yield
    if not _DATABASE_URL:
        return
    import psycopg

    from core.persistence.database import close_pools

    close_pools()
    try:
        with psycopg.connect(_DATABASE_URL, autocommit=True) as connection:
            schemas = [
                row[0]
                for row in connection.execute(
                    "SELECT nspname FROM pg_namespace WHERE starts_with(nspname, %s)",
                    (_SCHEMA_PREFIX + "_",),
                )
            ]
            # Threads a test leaked may still hold locks; never wait on them.
            connection.execute("SET lock_timeout = '5s'")
            for schema in schemas:
                try:
                    connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
                except psycopg.errors.LockNotAvailable:
                    pass
    except psycopg.Error:
        pass


@pytest.fixture(autouse=True)
def _isolate_session_store(tmp_path, monkeypatch):
    home = tmp_path / "deepcode-home"
    monkeypatch.setenv("DEEPCODE_HOME", str(home))
    monkeypatch.setenv("DEEPCODE_SESSIONS_DIR", str(home / "sessions"))
    # Keep the built-in GenOffice MCP server out of MCP plans unless a test
    # opts in (an empty GENOFFICE_BIN disables binary resolution).
    monkeypatch.setenv("GENOFFICE_BIN", "")
    # Likewise the built-in Firecrawl web search server (and its env key):
    # tests never reach the network unless they opt in.
    monkeypatch.setenv("KHAI_BUILTIN_WEBSEARCH", "0")
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    from core.providers.registry import PROVIDERS

    credential_environment_names = {
        "ANTHROPIC_API_KEY",
        "AZURE_OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GROQ_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        *(provider.env_key for provider in PROVIDERS if provider.env_key),
    }
    for name in credential_environment_names:
        monkeypatch.delenv(name, raising=False)
    import core.compat.runtime as runtime_module
    import core.sessions.store as store_module

    monkeypatch.setattr(store_module, "_DEFAULT_STORE", None)
    monkeypatch.setattr(runtime_module, "_runtime", None)
    yield


@pytest.fixture
def shared_cli_service(monkeypatch):
    """Real HTTP/WS host in a test thread, so patched model providers stay local."""
    import asyncio
    import threading
    from core.application.agent_adapter import ConfiguredAgentSessionFactory
    from core.harness.permissions import PermissionMode
    from tests.app_server.support import control_server
    from tests.app_server.test_native_client import publish

    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    contexts = []
    lock = threading.Lock()

    async def open_host(files):
        context = control_server(
            files.database.parent,
            database_name=files.database.name,
            session_factory=ConfiguredAgentSessionFactory(
                default_permission_mode=PermissionMode.DEFAULT, streaming=False
            ),
        )
        control, _ = await context.__aenter__()
        published, lease = publish(control)
        contexts.append((context, published, lease))
        return await control.status()

    def start(files, **_kwargs):
        with lock:
            if not files.running():
                return asyncio.run_coroutine_threadsafe(open_host(files), loop).result(
                    20
                )

    monkeypatch.setattr("cli.service_cli.start_service", start)
    yield

    async def cleanup():
        for context, files, lease in reversed(contexts):
            try:
                await context.__aexit__(None, None, None)
            finally:
                files.clear()
                lease.close()

    try:
        asyncio.run_coroutine_threadsafe(cleanup(), loop).result(30)
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(5)
        loop.close()
