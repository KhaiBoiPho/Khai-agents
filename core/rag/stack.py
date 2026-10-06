"""Bring the RAG storage stack (Postgres + Qdrant) up and pick a backend.

``KHAI_RAG_BACKEND`` chooses the store: ``postgres`` (default) uses
Postgres + Qdrant and falls back to the per-workspace SQLite index when the
stack cannot be reached; ``sqlite`` always uses the fallback. When the
checkout's ``docker/rag/docker-compose.yml`` and Docker are present, the
service starts the stack in the background (``KHAI_RAG_AUTOSTART=0`` to skip).
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

COMPOSE_FILE = Path(__file__).resolve().parents[2] / "docker" / "rag" / "docker-compose.yml"
DEFAULT_DSN = "postgresql://khai:khai-rag-local@127.0.0.1:5442/khai_rag"
DEFAULT_QDRANT_URL = "http://127.0.0.1:6343"

_started = threading.Event()
_starting: threading.Thread | None = None
_lock = threading.Lock()


def dsn() -> str:
    return os.environ.get("KHAI_RAG_POSTGRES_DSN", "").strip() or DEFAULT_DSN


def qdrant_url() -> str:
    return os.environ.get("KHAI_RAG_QDRANT_URL", "").strip() or DEFAULT_QDRANT_URL


def wants_postgres() -> bool:
    return os.environ.get("KHAI_RAG_BACKEND", "postgres").strip().lower() != "sqlite"


def start_in_background() -> threading.Thread | None:
    """Run ``docker compose up -d`` for the stack once, off the caller's thread."""
    global _starting
    with _lock:
        if _starting is not None or _started.is_set():
            return _starting
        if (
            not wants_postgres()
            or os.environ.get("KHAI_RAG_AUTOSTART", "1").strip() == "0"
            or not COMPOSE_FILE.is_file()
            or shutil.which("docker") is None
        ):
            _started.set()
            return None
        _starting = threading.Thread(target=_up, name="rag-stack", daemon=True)
        _starting.start()
        return _starting


def _up() -> None:
    try:
        subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d"],
            capture_output=True,
            timeout=600,
            check=True,
        )
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline and not _reachable():
            time.sleep(1)
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("RAG stack did not start: %s", exc)
    finally:
        _started.set()


def _reachable() -> bool:
    import httpx
    import psycopg

    try:
        with psycopg.connect(dsn(), connect_timeout=2):
            pass
        return httpx.get(f"{qdrant_url().rstrip('/')}/readyz", timeout=2).status_code == 200
    except Exception:  # noqa: BLE001 - any failure means "not yet"
        return False


def wait_until_started(timeout: float = 90.0) -> None:
    """Block until a background start (if any) has finished or timed out."""
    _started.wait(timeout)


__all__ = [
    "dsn",
    "qdrant_url",
    "start_in_background",
    "wait_until_started",
    "wants_postgres",
]
